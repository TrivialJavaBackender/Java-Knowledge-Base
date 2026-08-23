# Что ломается в многопоточном коде и как это найти

> **Какую проблему решает.** Перечисляет отказы, свойственные только конкурентному коду — зависания,
> голодание, утечки — и, главное, показывает, **как их диагностировать на живом процессе**, а не
> угадывать по логам.
> **Кому это надо.** Всем, кто дежурит по сервису: эти отказы не воспроизводятся на ноутбуке и
> проявляются под нагрузкой.
> **Когда НЕ надо.** Правила видимости и гонок — не здесь, а в [`MEMORY_MODEL.md`](MEMORY_MODEL.md).

Гонка данных и состояние гонки разобраны в [`MEMORY_MODEL.md §7`](MEMORY_MODEL.md),
ложное разделение — в [`ATOMIC_CAS.md §3`](ATOMIC_CAS.md). Здесь — проблемы **живости**:
код корректен, но система не двигается.

Все дампы ниже сняты с реальных процессов на Temurin 21.0.9.

---

## 1. Взаимная блокировка (deadlock)

Два потока держат по ресурсу и ждут ресурс друг друга. Никто не сдвинется никогда.

```java
// Классика: перевод денег между счетами, взятыми в разном порядке
synchronized (from) { synchronized (to)   { … } }    // поток 1: A, затем B
synchronized (to)   { synchronized (from) { … } }    // поток 2: B, затем A
```

### Четыре условия Коффмана

Deadlock возможен, только если выполнены **все четыре** одновременно. Значит, достаточно нарушить
любое одно:

| Условие | Что означает | Как нарушить |
|---|---|---|
| Взаимное исключение | ресурс нельзя разделить | неизменяемость, копия на поток, версионность вместо лока |
| Удержание и ожидание | держу одно, жду второе | брать все локи разом либо не брать второй под первым |
| Неотбираемость | нельзя отнять принудительно | `tryLock` с таймаутом — поток сам отступает |
| Круговое ожидание | A ждёт B, B ждёт A | **глобальный порядок захвата** |

На практике борются с двумя последними.

### Порядок захвата — основной приём

```java
// Упорядочиваем по стабильному признаку — например, по идентификатору счёта
Account first  = from.id() < to.id() ? from : to;
Account second = from.id() < to.id() ? to   : from;
synchronized (first) { synchronized (second) { transfer(from, to, amount); } }
```

Если естественного порядка нет, используют `System.identityHashCode()` плюс «замок-арбитр» на редкий
случай совпадения хеш-кодов (приём из *Java Concurrency in Practice* §10.1.2).

### Таймаут вместо ожидания

```java
if (lockA.tryLock(50, MILLISECONDS)) {
    try {
        if (lockB.tryLock(50, MILLISECONDS)) {
            try { doWork(); return; } finally { lockB.unlock(); }
        }
    } finally { lockA.unlock(); }
}
Thread.sleep(ThreadLocalRandom.current().nextInt(20, 60));   // случайная пауза — против livelock (§3)
```

Это превращает вечное зависание в обычную ошибку, которую видно в логе и в метриках.
Доступно только явным локам ([`LOCKS.md`](LOCKS.md)) — у `synchronized` таймаута нет.

### Не вызывать чужой код под локом

```java
// ❌ Слушатель может взять другой лок — и вы получите deadlock, о котором не знали
synchronized (this) { listeners.forEach(l -> l.onChange(state)); }

// ✅ Скопировать под локом, вызвать снаружи (open call)
List<Listener> snapshot;
synchronized (this) { snapshot = List.copyOf(listeners); }
snapshot.forEach(l -> l.onChange(state));
```

---

## 2. Как найти deadlock на живом процессе

### Дамп потоков

```bash
jcmd <pid> Thread.print          # предпочтительный способ
jstack <pid>                     # то же, более старый инструмент
kill -3 <pid>                    # дамп в stdout процесса (Unix)
```

JVM **сама находит** циклы ожидания и печатает их в начале дампа. Реальный вывод для примера выше:

```
Found one Java-level deadlock:
=============================
"перевод-1":
  waiting to lock monitor 0x0000000c06955ce0 (object 0x000000070e8180a8, a java.lang.Object),
  which is held by "перевод-2"

"перевод-2":
  waiting to lock monitor 0x0000000c06955c00 (object 0x000000070e8240a0, a java.lang.Object),
  which is held by "перевод-1"

Java stack information for the threads listed above:
===================================================
"перевод-1":
	at Dead.lambda$main$0(Dead.java:5)
	- waiting to lock <0x000000070e8180a8> (a java.lang.Object)
	- locked <0x000000070e8240a0> (a java.lang.Object)
```

Как это читать:

- **`waiting to lock <0x…8180a8>`** — какого монитора ждём.
- **`- locked <0x…8240a0>`** — что при этом уже держим. Именно пара «жду одно, держу другое»
  и образует цикл.
- Состояние потока — `BLOCKED (on object monitor)`.
- Адреса объектов совпадают крест-накрест — это и есть круговое ожидание.

Явные локи находятся так же, только формулировка другая:

```
"rl-1":
  waiting for ownable synchronizer 0x000000031007f4c8,
  (a java.util.concurrent.locks.ReentrantLock$NonfairSync), which is held by "rl-2"
```

Отсюда практическое следствие: **осмысленные имена потоков** (`payment-worker-3`, а не `Thread-17`)
экономят время в тот момент, когда оно дороже всего.

### Программно

```java
ThreadMXBean bean = ManagementFactory.getThreadMXBean();
long[] ids = bean.findDeadlockedThreads();          // и мониторы, и явные локи
if (ids != null) {
    for (ThreadInfo info : bean.getThreadInfo(ids, true, true))
        log.error("deadlock: {} ждёт {}", info.getThreadName(), info.getLockName());
}
```

Полезно повесить это на периодическую проверку и отдавать метрикой — тогда о зависании узнаёте вы,
а не пользователи. (Не забудьте про ловушку из
[`EXECUTORS_FUTURES.md §7.2`](EXECUTORS_FUTURES.md): периодическая задача умирает от первого
исключения.)

### Чего дамп НЕ покажет

**Голодание пула JVM не считает взаимной блокировкой.** Если задача, выполняющаяся в пуле, ждёт
результата другой задачи того же пула, а свободных потоков нет — система стоит намертво, но
формально каждый поток просто «ждёт данные»:

```java
// ❌ Пул на 2 потока; внешняя задача ждёт внутреннюю, а место для внутренней уже занято
ExecutorService pool = Executors.newFixedThreadPool(2);
pool.submit(() -> {
    Future<String> inner = pool.submit(() -> load());
    return inner.get();                                  // ждёт вечно
});
```

В дампе это выглядит как потоки в `WAITING` на `Object.wait`/`park` — и никакого
«Found one Java-level deadlock». Опознаётся по косвенным признакам: все потоки пула заняты,
очередь растёт, процессор простаивает.

**Правило.** Задача не должна ждать результата другой задачи того же пула. Либо отдельный пул для
вложенных задач, либо композиция без блокировки (`thenCompose`, см.
[`ASYNC_COMPOSITION.md §5`](ASYNC_COMPOSITION.md)).

---

## 3. Livelock

Потоки **активны**, но не продвигаются: каждый реагирует на действия другого и откатывается.

```java
while (!done) {
    if (!lockB.tryLock()) {
        lockA.unlock();       // вежливо уступаем...
        lockA.lock();         // ...и оба одновременно повторяем то же самое
        continue;
    }
}
```

Отличие от deadlock — в симптоме: при deadlock процессор **простаивает**, при livelock он
**загружен на 100%**, а полезной работы нет. По дампу потоки выглядят `RUNNABLE`.

Лечение — **случайная пауза** перед повтором. Детерминированная задержка не помогает: потоки просто
синхронно повторят конфликт.

```java
Thread.sleep(ThreadLocalRandom.current().nextInt(baseMs, baseMs * 2));
```

Тот же принцип лежит в основе повторов с экспоненциальной паузой (backoff) в сетевых протоколах:
без случайной составляющей клиенты повторяют запросы синхронно и добивают сервер.

---

## 4. Голодание

Поток не получает ресурс никогда или получает его исчезающе редко.

| Причина | Проявление | Лечение |
|---|---|---|
| Несправедливый лок, короткие секции | один поток постоянно обгоняет очередь (barging, [`JUC_INTERNALS.md §6`](JUC_INTERNALS.md)) | `new ReentrantLock(true)` — ценой пропускной способности |
| Длинная критическая секция | остальные стоят в `BLOCKED` | вынести ввод-вывод из-под лока |
| `notify()` вместо `notifyAll()` | сигнал достаётся «не тому» потоку | `notifyAll()` или отдельные `Condition` |
| Все потоки пула заняты медленной зависимостью | быстрые запросы не обслуживаются | отдельные пулы (bulkhead), [`EXECUTORS_FUTURES.md §3`](EXECUTORS_FUTURES.md) |

Последняя строка — самая частая в продакшене и самая обидная: один медленный внешний сервис
«съедает» пул, и падает **всё** приложение, включая функциональность, которая от него не зависит.

Про приоритеты потоков: `Thread.setPriority()` — подсказка планировщику ОС, которая на разных
платформах работает по-разному, а у виртуальных потоков игнорируется полностью. Как средство борьбы
с голоданием — не рассматривается.

---

## 5. Утечка потоков

Потоки создаются и не завершаются. Симптом — медленный рост числа потоков в метриках, затем
`OutOfMemoryError: unable to create native thread`.

Типичные источники:

```java
// ❌ Пул создаётся на каждый запрос и не закрывается
public Result handle(Request r) {
    ExecutorService pool = Executors.newFixedThreadPool(4);   // +4 потока навсегда
    …                                                          // shutdown() нет
}

// ❌ Поток ждёт вечно на неограниченном take() и не реагирует на остановку
while (true) { process(queue.take()); }

// ❌ Задача проглотила InterruptedException — остановка не работает
catch (InterruptedException e) { }                            // см. THREADS_BASICS.md §4
```

Как обнаружить:

```bash
jcmd <pid> Thread.print | grep -c '"'                 # сколько потоков сейчас
jcmd <pid> Thread.print | grep 'java.lang.Thread.State' | sort | uniq -c   # в каком состоянии
```

Растущее число потоков с одинаковым именем — почти всегда утечка пула.

---

## 6. Инструменты

### Дамп потоков — первое, что делают

```bash
jcmd <pid> Thread.print > dump1.txt
sleep 10
jcmd <pid> Thread.print > dump2.txt      # два дампа с интервалом
```

Два дампа важнее одного: если стек потока за 10 секунд не изменился, он действительно висит,
а не просто попал под снимок.

Что смотреть:

- распределение по состояниям: много `BLOCKED` — конкуренция за лок; всё в `WAITING` — работы нет
  или голодание пула; много `RUNNABLE` — либо считаем, либо livelock;
- повторяющийся кадр стека в нескольких потоках — это и есть узкое место;
- напоминание из [`THREADS_BASICS.md §2`](THREADS_BASICS.md): поток, заблокированный на сетевом
  чтении, показан как `RUNNABLE`.

### Java Flight Recorder — когда нужна история, а не снимок

```bash
java -XX:StartFlightRecording=duration=60s,filename=rec.jfr -jar app.jar
jcmd <pid> JFR.start name=diag settings=profile      # или на живом процессе
jcmd <pid> JFR.dump name=diag filename=rec.jfr
```

События, относящиеся к конкурентности:

| Событие | О чём |
|---|---|
| `jdk.JavaMonitorEnter` | ожидание монитора `synchronized` дольше порога — где именно конкуренция |
| `jdk.JavaMonitorWait` | ожидание в `Object.wait` |
| `jdk.ThreadPark` | ожидание в `LockSupport.park` — то есть на любом локе из j.u.c. |
| `jdk.ThreadStart` / `jdk.ThreadEnd` | утечка потоков видна как рост без завершений |
| `jdk.VirtualThreadPinned` | виртуальный поток прибит к носителю ([`VIRTUAL_THREADS.md`](VIRTUAL_THREADS.md)) |

Преимущество JFR перед дампом: он показывает **сколько суммарно** времени потрачено на ожидание
конкретного монитора, а не только «в этот момент кто-то ждал».

### Проверка инвариантов до продакшена

Гонки не ловятся обычными тестами — нужен `jcstress`
([`MEMORY_MODEL.md §8`](MEMORY_MODEL.md)). Минимальная замена в обычном тесте — «стартовый пистолет»
на `CountDownLatch` ([`SYNCHRONIZERS.md §1`](SYNCHRONIZERS.md)) и много повторений.

---

## 7. Шпаргалка

```
Процессор простаивает, ничего не движется   → deadlock: jcmd <pid> Thread.print
Процессор на 100%, прогресса нет            → livelock: добавить случайную паузу
Пул занят, очередь растёт, процессор простаивает → голодание пула (в дампе НЕ виден как deadlock)
Число потоков растёт                        → утечка: забытый shutdown() или проглоченное прерывание
Одни запросы обслуживаются, другие нет      → голодание: разделить пулы (bulkhead)

Профилактика deadlock:
  глобальный порядок захвата локов
  tryLock с таймаутом и случайной паузой
  не вызывать чужой код под локом
  никакого ввода-вывода под локом
  задача не ждёт другую задачу того же пула
```

---

## 8. Упражнения

- [`Ex11: DeadlockDetection`](../src/main/kotlin/exercises/Ex11_DeadlockDetection.kt) — создать
  deadlock, обнаружить через `ThreadMXBean`, исправить порядком захвата.

---

## Вопросы для самопроверки

1. Назовите четыре условия Коффмана. Как нарушить каждое?
2. Как упорядочить захват локов, если у объектов нет естественного порядка?
3. Что искать в дампе потоков, чтобы подтвердить deadlock? Какие две строки образуют цикл?
4. Находит ли `jcmd` deadlock на `ReentrantLock`? Как он выглядит в выводе?
5. Задача в пуле ждёт другую задачу того же пула. Найдёт ли это `jcmd`? Как опознать?
6. Чем livelock отличается от deadlock по загрузке процессора?
7. Почему случайная пауза лечит livelock, а фиксированная — нет?
8. Почему один медленный внешний сервис способен уронить всё приложение? Что с этим делать?
9. Как по дампу отличить «пул простаивает» от «пул голодает»?
10. Зачем снимать два дампа подряд?
11. Какие события JFR относятся к конкурентности и что даёт JFR сверх дампа?

---

## Источники

**Спецификации и документация:**
- [`ThreadMXBean#findDeadlockedThreads` (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.management/java/lang/management/ThreadMXBean.html#findDeadlockedThreads()) — находит и мониторы, и явные локи.
- [`jcmd` (JDK 21 tools reference)](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jcmd.html) · [`jstack`](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jstack.html)
- [JDK Flight Recorder — список событий](https://docs.oracle.com/en/java/javase/21/jfapi/) — `jdk.JavaMonitorEnter`, `jdk.ThreadPark`, `jdk.VirtualThreadPinned`.

**Papers / книги:**
- [Coffman, Elphick, Shoshani (1971) — «System Deadlocks» (ACM Computing Surveys 3(2))](https://dl.acm.org/doi/10.1145/356586.356588) — оригинал четырёх условий.
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 10 (Avoiding Liveness Hazards) — приём
  с `identityHashCode` и «замком-арбитром»; Ch. 11 (Performance and Scalability).
- *Release It!*, 2nd ed. (Michael Nygard, 2018) — «Blocked Threads» и «Bulkheads»: те же отказы
  с точки зрения эксплуатации.

**Разборы:**
- [OpenJDK jcstress](https://github.com/openjdk/jcstress) — проверка конкурентных инвариантов.
- [Netflix — «Performance under load»](https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581) — почему фиксированные пулы плохо переносят деградацию зависимостей.
