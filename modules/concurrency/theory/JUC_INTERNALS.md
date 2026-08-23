# Как устроен весь `java.util.concurrent`: одна машина на все классы

> **Какую проблему решает.** `java.util.concurrent` выглядит как три десятка несвязанных классов,
> которые приходится зубрить. На деле почти все они — это **один механизм** с разной трактовкой
> одного числа. Этот файл показывает механизм, после чего остальные файлы модуля читаются как
> варианты применения, а не как список.
> **Кому это надо.** Тому, кто хочет отвечать «что физически делает поток, когда `lock()` не
> удался», понимать, откуда берётся pinning виртуальных потоков, и писать собственные
> синхронизаторы.
> **Когда НЕ надо.** Для повседневного применения `ReentrantLock` и `Semaphore` эти детали не нужны:
> API самодостаточен. Читайте, когда нужен ответ «почему», а не «как вызвать».

Все утверждения ниже сверены с исходниками **JDK 21.0.9** (`$JAVA_HOME/lib/src.zip`). Указаны файл
и номер строки — при желании откройте и проверьте.

---

## 1. Вопрос, на который отвечает файл

```java
lock.lock();     // а если лок уже занят другим потоком — что происходит дальше?
queue.take();    // а если очередь пуста — где «спит» поток?
latch.await();   // а кто и как его разбудит?
future.get();    // и почему это выглядит одинаково во всех трёх случаях?
```

Ответ во всех четырёх случаях один и тот же, потому что за всеми четырьмя стоит один класс —
`AbstractQueuedSynchronizer` (AQS), и один способ усыпить поток — `LockSupport.park()`.

---

## 2. Быстрый путь: одно число и CAS

В основе AQS лежит единственное поле:

```java
// AbstractQueuedSynchronizer.java:537
/** The synchronization state. */
private volatile int state;
```

Всё, что делает конкретный синхронизатор — придаёт этому числу смысл и определяет, при каком
значении поток пропускают дальше. Вот весь захват незанятого `ReentrantLock`:

```java
// ReentrantLock.java, Sync.tryLock()
final boolean tryLock() {
    Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {                                   // лок свободен
        if (compareAndSetState(0, 1)) {             // одна атомарная инструкция CPU
            setExclusiveOwnerThread(current);
            return true;                            // всё, мы внутри
        }
    } else if (getExclusiveOwnerThread() == current) {
        if (++c < 0) throw new Error("Maximum lock count exceeded");
        setState(c);                                // реентерабельный захват: просто +1
        return true;
    }
    return false;
}
```

Обратите внимание на два факта:

- **Незанятый лок не стоит почти ничего.** Успешный `compareAndSetState(0, 1)` — это одна
  инструкция процессора (`CMPXCHG` на x86, `LDXR/STXR` на ARM). Ни системного вызова, ни
  планировщика, ни очереди. Это и есть fast path.
- **Реентерабельность — это просто счётчик.** `state` для `ReentrantLock` — количество вложенных
  захватов; `unlock` уменьшает его на 1, и лок освобождается только при переходе в 0. Отсюда
  правило «сколько `lock()`, столько и `unlock()`».

---

## 3. Медленный путь: очередь и `park`

Если CAS не удался, поток нельзя просто «покрутить в цикле» — он может ждать секунды. Его надо снять
с процессора. Этим занимается `AbstractQueuedSynchronizer.acquire`:

```java
// AbstractQueuedSynchronizer.java:1022
public final void acquire(int arg) {
    if (!tryAcquire(arg))              // быстрый путь из §2
        acquire(null, arg, false, false, false, 0L);   // медленный
}
```

Медленный путь — бесконечный цикл, который по шагам делает следующее (комментарий в исходнике
перечисляет их явно, `AbstractQueuedSynchronizer.java:704`, комментарий на 712):

1. Если наш узел — первый в очереди, ещё раз пробуем `tryAcquire`: вдруг уже освободили.
2. Если не вышло — создаём узел и ставим его в **хвост двусвязной очереди ожидающих**
   (`casTail`). Очередь — вариант алгоритма CLH.
3. Немного **крутимся вхолостую**: `Thread.onSpinWait()`. Это подсказка процессору «я в цикле
   ожидания» (на x86 — инструкция `PAUSE`), она экономит энергию и не мешает соседнему
   гиперпотоку. Смысл: если лок вот-вот освободится, дешевле подождать, чем идти в ядро.
4. Помечаем узел как `WAITING` — это разрешение нас будить.
5. **Засыпаем**: `LockSupport.park(this)`.

Пробуждение — зеркально:

```java
// AbstractQueuedSynchronizer.java:1092
public final boolean release(int arg) {
    if (tryRelease(arg)) {         // например, state 1 → 0
        signalNext(head);          // разбудить первого в очереди
        return true;
    }
    return false;
}

// AbstractQueuedSynchronizer.java:641
private static void signalNext(Node h) {
    Node s;
    if (h != null && (s = h.next) != null && s.status != 0) {
        s.getAndUnsetStatus(WAITING);
        LockSupport.unpark(s.waiter);      // вот кто будит
    }
}
```

### Что такое `park` на уровне ОС

`LockSupport.park()` для платформенного потока вызывает `Unsafe.park`, а тот — примитив ожидания
операционной системы (на Linux — `futex`, на macOS/BSD — `pthread_cond_wait`). Результат:
**планировщик ядра снимает поток с процессора и не ставит его обратно, пока не придёт сигнал.**
Пока поток «стоит на локе», он не тратит процессорное время — но занимает свой стек (2 МБ на этой
машине, см. [`WHY_CONCURRENCY.md`](WHY_CONCURRENCY.md)) и одно место в таблице потоков ОС.

Цена перехода — примерно то самое переключение контекста, ~1.2 мкс из замера в
[`WHY_CONCURRENCY.md §3.3`](WHY_CONCURRENCY.md). Именно поэтому шаг 3 (короткое активное ожидание)
существует: сотня холостых тактов дешевле похода в ядро.

---

## 4. Почему `park`/`unpark` не теряют сигнал

Наивная схема «уснуть, если условие не выполнено» содержит гонку: между проверкой условия и засыпанием
другой поток может успеть подать сигнал — и наш поток уснёт навсегда. `wait/notify` решает это тем,
что требует держать монитор. У `park`/`unpark` монитора нет, поэтому используется другой приём.

Javadoc `LockSupport.park` (JDK 21):

> *Disables the current thread for thread scheduling purposes **unless the permit is available**.
> If the permit is available then it is consumed and the call returns immediately.*

У каждого потока есть **одно разрешение** (permit), как у семафора на единицу:

- `unpark(t)` — выдаёт разрешение потоку `t`. Если разрешение уже есть, второе не накапливается.
- `park()` — если разрешение есть, забирает его и **сразу возвращается**; если нет — засыпает.

Отсюда главное свойство: **`unpark`, вызванный до `park`, не теряется.** Поток, который «опоздал»
уснуть, просто не уснёт. Гонки «разбудили раньше, чем уснул» не существует.

Тот же javadoc перечисляет три причины возврата из `park`: `unpark`, прерывание и **spurious wakeup**
(«the call spuriously, that is, for no reason, returns»). Поэтому там же сказано:

> *Callers should re-check the conditions which caused the thread to park in the first place.*

Это и есть источник правила «`wait` только внутри `while`, никогда внутри `if`» — оно
не про `wait`, а про любой примитив ожидания. Ровно так устроен `acquire`: `park` стоит внутри
`for (;;)`, и после пробуждения условие проверяется заново.

---

## 5. Одно число — весь пакет

Разные синхронизаторы отличаются только тем, **что означает `state`** и какая проверка пускает поток
дальше. Проверьте по исходникам — там буквально по десять строк на класс.

| Класс | Смысл `state` | Пропускает, когда |
|---|---|---|
| `ReentrantLock` | число вложенных захватов владельцем | `state == 0` либо владелец — мы сами |
| `Semaphore` | количество свободных разрешений | `state - запрошенное >= 0` |
| `CountDownLatch` | сколько ещё событий ждём | `state == 0` |
| `ReentrantReadWriteLock` | **два счётчика в одном int**: старшие 16 бит — читатели, младшие 16 — писатель | читателей пускают, если нет писателя |
| `FutureTask` | **не на AQS**: свой `volatile int state` (`NEW`, `COMPLETING`, `NORMAL`, `EXCEPTIONAL`, `CANCELLED`, `INTERRUPTING`, `INTERRUPTED`) и прямой вызов `LockSupport.park` | задача завершена |
| `CyclicBarrier` | **не на AQS**: `ReentrantLock` + `Condition` | пришли все участники |

Последние две строки важны: даже там, где AQS не используется, схема та же — одно `volatile`-поле
состояния, CAS для перехода и `LockSupport.park` для ожидания (`FutureTask.java:92` и `:500`).
`FutureTask` отказался от AQS в Java 7 ради более простого кода — но не от механизма.

Три подтверждения из исходников:

```java
// Semaphore.java:183 — «свободные разрешения»
final int nonfairTryAcquireShared(int acquires) {
    for (;;) {
        int available = getState();
        int remaining = available - acquires;
        if (remaining < 0 || compareAndSetState(available, remaining))
            return remaining;                     // < 0 → в очередь и park
    }
}

// CountDownLatch.java, Sync — «сколько осталось»
protected int tryAcquireShared(int acquires) { return (getState() == 0) ? 1 : -1; }

// ReentrantReadWriteLock.java:263 — два счётчика в одном слове
static final int SHARED_SHIFT   = 16;
static int sharedCount(int c)    { return c >>> SHARED_SHIFT; }   // читатели
static int exclusiveCount(int c) { return c & EXCLUSIVE_MASK; }   // писатель
```

Раскладка `ReentrantReadWriteLock` заодно объясняет ограничение из javadoc: 65 535 одновременных
читателей и 65 535 вложенных захватов на запись — больше в 16 бит не помещается.

**Практический вывод.** Если понадобится собственный синхронизатор («пропускать не больше N, но
с приоритетом», «ждать, пока три условия из пяти»), не изобретайте `wait/notify` — унаследуйте
`AbstractQueuedSynchronizer` и реализуйте `tryAcquire`/`tryRelease`. Очередь, парковка, таймауты,
прерывания и отмена уже написаны.

---

## 6. Справедливость и «влезание без очереди»

Из §3 видно, что перед постановкой в очередь поток **ещё раз пробует `tryAcquire`**. Значит,
только что пришедший поток может захватить лок раньше того, кто уже час стоит в очереди. Это
называется **barging** — влезание без очереди, и по умолчанию оно разрешено.

Почему так сделано: разбудить поток из `park` стоит переключения контекста (~1.2 мкс), а за это время
пришедший поток успел бы войти и выйти. Отдавать лок «правильному» потоку означает каждый раз платить
за поход в ядро.

`new ReentrantLock(true)` включает справедливый режим: перед захватом проверяется, есть ли кто-то в
очереди, и если есть — новичок сразу встаёт в хвост. Порядок FIFO соблюдается, но каждая передача
лока — это обязательное пробуждение, поэтому пропускная способность падает (в литературе — в разы,
на реальных нагрузках зависит от длины критической секции).

**Правило.** Справедливый режим нужен, когда критическая секция длинная и голодание реально
наблюдается. В остальных случаях он ухудшает и пропускную способность, и среднюю задержку.
`synchronized` справедливым не бывает вообще.

---

## 7. Сколько это стоит

Замер из [`WHY_CONCURRENCY.md §4.1`](WHY_CONCURRENCY.md) — 8 потоков, миллион инкрементов каждый:

| Способ | Время | Что происходит внутри |
|---|---|---|
| `LongAdder` | 5–6 мс | у каждого потока своя ячейка, конкуренции почти нет |
| `synchronized` | 41–74 мс | адаптивное активное ожидание в самой JVM, затем монитор |
| `ReentrantLock` | 64–66 мс | `Thread.onSpinWait` + очередь AQS + `park` |
| `AtomicLong` | 234–247 мс | CAS без блокировки, но одна строка кэша на 8 ядер |

Два неочевидных вывода:

1. **«Без блокировок» не значит «быстро».** `AtomicLong` в 4 раза медленнее лока: при высокой
   конкуренции CAS не проходит с первого раза, цикл повторяется, а строка кэша перекидывается между
   ядрами. Разбор — в [`ATOMIC_CAS.md`](ATOMIC_CAS.md).
2. **`synchronized` не медленнее `ReentrantLock`.** Утверждение «`ReentrantLock` быстрее при высокой
   конкуренции» пришло из времён Java 5; с тех пор JVM научилась оптимизировать монитор, и в этом
   замере он выигрывает. Разброс у `synchronized` (41–74 мс) заметно больше — это как раз работа
   адаптивных эвристик JVM. Выбирайте `ReentrantLock` не за скорость, а за возможности:
   `tryLock`, таймаут, прерываемость, несколько `Condition` — см. [`LOCKS.md`](LOCKS.md).

---

## 8. Точка стыковки с виртуальными потоками

Это самое практически важное следствие всего файла. Вот полный текст `LockSupport.park()` в JDK 21:

```java
// LockSupport.java:367
public static void park() {
    if (Thread.currentThread().isVirtual()) {
        VirtualThreads.park();          // снять с потока-носителя, сохранить продолжение в куче
    } else {
        U.park(false, 0L);              // futex / pthread_cond — заблокировать поток ОС
    }
}
```

Одна развилка объясняет всё поведение Loom:

- **Весь `java.util.concurrent` блокируется через `park`** — значит, для виртуального потока
  блокировка на `ReentrantLock`, `Semaphore`, `BlockingQueue`, `CountDownLatch`, `Future.get()`
  превращается в снятие с потока-носителя. Носитель освобождается и берёт другую задачу.
- **`synchronized` блокируется не через `park`**, а через инструкцию `monitorenter` внутри
  виртуальной машины, которая (до JDK 24) про виртуальные потоки не знала. Носитель оставался
  занят — это и есть **pinning**.

Проверяется за десять секунд. 100 виртуальных потоков, каждый на 100 мс уходит в `sleep`, каждый
под **собственным** локом (конкуренции нет вовсе):

```java
// Pin.java — java Pin.java
run("synchronized ", () -> { Object m = new Object(); synchronized (m) { sleep(100); } });
run("ReentrantLock", () -> { var l = new ReentrantLock(); l.lock(); try { sleep(100); } finally { l.unlock(); } });
run("без лока     ", () -> sleep(100));
```

```
### JDK 21 (10 ядер → 10 потоков-носителей):
synchronized  : 1051 мс      ← 100 задач / 10 носителей × 100 мс: параллельности нет
ReentrantLock :  105 мс      ← все 100 сняты с носителей, ждут одновременно
без лока      :  106 мс

### JDK 24 (JEP 491):
synchronized  :  110 мс      ← починено, pinning больше нет
ReentrantLock :  105 мс
без лока      :  106 мс
```

Десятикратная разница — ровно отношение «сто задач к десяти носителям». Механизм не абстрактный:
он виден в числах.

**Правило (для JDK 21–23).** В коде, который может выполняться в виртуальном потоке, не держите
`synchronized` вокруг блокирующих операций. Библиотечный код — тем более: среда выполнения ему
неизвестна. Диагностика и подробности — в [`VIRTUAL_THREADS.md`](VIRTUAL_THREADS.md).

---

## 9. Шпаргалка

```
state + CAS                     → быстрый путь, одна инструкция, без ядра
не вышло → очередь + onSpinWait → короткое активное ожидание, пока лок «вот-вот» освободится
всё ещё нет → LockSupport.park  → планировщик ОС снимает поток с процессора
release → signalNext → unpark   → будит первого в очереди
permit у park                   → unpark до park не теряется
spurious wakeup                 → любое ожидание проверяется в цикле, никогда в if
barging                         → новичок может обогнать очередь; fair(true) это запрещает ценой скорости
park знает про виртуальные потоки, monitorenter (до JDK 24) — нет  → отсюда pinning
```

Формулировки, которые хорошо звучат на собеседовании:

1. «`java.util.concurrent` — это `volatile int state`, CAS и очередь ожидающих; классы отличаются
   лишь тем, что означает это число».
2. «Незанятый лок стоит одну инструкцию процессора; в ядро мы идём, только когда реально надо ждать».
3. «`unpark` выдаёт потоку разрешение, поэтому сигнал, пришедший раньше засыпания, не теряется».
4. «`ReentrantLock` не прибивает виртуальный поток, потому что блокируется через `park`, а
   `synchronized` до JDK 24 блокировался через `monitorenter` в самой VM».

---

## Вопросы для самопроверки

1. Что происходит при `lock.lock()`, если лок свободен? Сколько это стоит?
2. Что делает поток, если лок занят — по шагам, до момента, когда он перестаёт занимать процессор?
3. Зачем в `acquire` есть короткое активное ожидание перед `park`?
4. Почему `unpark`, вызванный до `park`, не теряется? Что было бы, если бы терялся?
5. Что означает `state` у `Semaphore`? У `CountDownLatch`? У `ReentrantReadWriteLock`?
6. Откуда берётся ограничение «не более 65 535 читателей» у `ReentrantReadWriteLock`?
7. Что такое barging и почему он включён по умолчанию?
8. Почему `ReentrantLock` не прибивает виртуальный поток к носителю, а `synchronized` на JDK 21 —
   прибивает? Как это измерить?

---

## Источники

**Первоисточники:**
- [Doug Lea — «The java.util.concurrent Synchronizer Framework» (2005)](https://gee.cs.oswego.edu/dl/papers/aqs.pdf) — статья, описывающая замысел AQS.
- [Craig, Landin, Hagersten — CLH lock (1993–1994)](https://people.cs.pitt.edu/~melhem/courses/2410p/papers/mcs.pdf) — алгоритм очереди, лежащий в основе.

**Исходники JDK 21** (`$JAVA_HOME/lib/src.zip`):
- `java/util/concurrent/locks/AbstractQueuedSynchronizer.java` — `state` (537), `acquire` (1022),
  `release` (1092), `signalNext` (641), медленный путь `acquire(Node,…)` (704).
- `java/util/concurrent/locks/LockSupport.java` — `park` (367), `unpark` (176).
- `java/util/concurrent/locks/ReentrantLock.java` — `Sync.tryLock`.
- `java/util/concurrent/locks/ReentrantReadWriteLock.java` — раскладка `state` (263).
- `java/util/concurrent/Semaphore.java` (183), `java/util/concurrent/CountDownLatch.java`,
  `java/util/concurrent/FutureTask.java` (92, 500), `java/util/concurrent/CyclicBarrier.java` (159).

**Официальная документация:**
- [`LockSupport` Javadoc (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/LockSupport.html) — семантика разрешения и spurious wakeup.
- [`AbstractQueuedSynchronizer` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html) — как писать свой синхронизатор.
- [JEP 491: Synchronize Virtual Threads without Pinning (JDK 24)](https://openjdk.org/jeps/491) — что именно чинили и почему проблема существовала.

**Книги:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 14 (Building Custom Synchronizers).
- *The Art of Multiprocessor Programming*, 2nd ed. (Herlihy, Shavit, 2020) — Ch. 7 (Spin Locks and
  Contention) — почему активное ожидание иногда выгоднее засыпания.
