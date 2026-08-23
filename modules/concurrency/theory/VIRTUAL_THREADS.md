# Виртуальные потоки (JDK 21+)

> **Какую проблему решает.** Модель «поток на запрос» проста и отлаживаема, но упирается в цену
> потока ОС. Виртуальные потоки делают поток дешёвым — и возвращают возможность писать
> блокирующий линейный код при десятках тысяч одновременных запросов.
> **Кому это надо.** Тому, кто на JDK 21 выбирает между пулом, `CompletableFuture` и виртуальными
> потоками; тому, кто мигрирует существующий сервис; и тому, у кого спросят про pinning.
> **Когда НЕ надо.** Для задач, которые считают: ядер не прибавится. И там, где нужен точный
> контроль над потоками (привязка к ядру, приоритеты, свои `ThreadFactory` с состоянием).

Механика блокировки, на которой всё держится, — в [`JUC_INTERNALS.md §8`](JUC_INTERNALS.md).
Все замеры и статусы проверены прогоном на **Temurin 21.0.9** и **Temurin 24.0.2**.

---

## 1. Задача

Из [`WHY_CONCURRENCY.md`](WHY_CONCURRENCY.md): при 1000 rps и 300 мс на запрос нужно 300
одновременных обработок. При 10 000 rps — уже 3000. Платформенный поток стоит 2 МБ резерва стека и
~22 мкс на создание, а ядро планирует их само, ничего не зная о запросах.

Было два выхода, и оба неудобны: не блокировать поток (асинхронный стиль — код перестаёт быть
обычным, [`ASYNC_COMPOSITION.md`](ASYNC_COMPOSITION.md)) или ограничить конкурентность пулом
(деградирует задержка). Виртуальные потоки — третий: **оставить блокирующий код и сделать поток
дешёвым**.

---

## 2. Что это такое

```
Платформенный поток:  Thread ──1:1── поток ОС ── ядро процессора
                      2 МБ стека, планирует ядро, потолок — тысячи

Виртуальный поток:    Thread ──M:N── поток-носитель (платформенный) ── ядро
                      стек в куче, планирует JVM, потолок — миллионы
```

Виртуальный поток — это обычный `java.lang.Thread`, у которого стек живёт **в куче** в виде
продолжения (continuation). Когда поток блокируется, JVM снимает его с носителя (unmount) и
сохраняет продолжение; когда операция готова — возвращает на свободный носитель (mount).

Носители — это `ForkJoinPool`, число которых по умолчанию равно числу ядер (видно по имени потока:
`VirtualThread[#21]/runnable@ForkJoinPool-1-worker-1`).

```java
Thread.ofVirtual().name("vt-1").start(() -> doWork());       // один поток
Executors.newVirtualThreadPerTaskExecutor();                 // поток на задачу
Thread.ofVirtual().factory();                                // ThreadFactory для чужого API
```

Свойства, которые отличаются от платформенных (проверено):

```
isDaemon = true                                   ← всегда демон
setDaemon(false) -> IllegalArgumentException      ← сделать недемоном нельзя
priority после setPriority(MIN) = 5               ← приоритет игнорируется
```

Отсюда важное следствие: виртуальные потоки **не удерживают JVM от завершения**. Ждать их окончания
нужно явно — `join()`, `CountDownLatch` или закрытие `ExecutorService` (у него `close()` в
try-with-resources как раз ждёт завершения всех задач).

---

## 3. Что даёт на практике

Замер из [`WHY_CONCURRENCY.md §3.2`](WHY_CONCURRENCY.md) — создать и дождаться 10 000 потоков:

```
платформенные: ~220 мс   (~22 мкс на поток)
виртуальные:    ~15 мс   (~1.5 мкс на поток)
```

Тот же тест на 300 задач по 300 мс: пул на 300 платформенных потоков — 333 мс, виртуальные — 316 мс,
но без 300 стеков по 2 МБ.

Предел проверяется прямо:

```java
// Million.java — java -Xmx2g Million.java
try (var ex = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 1_000_000; i++) ex.submit(() -> { Thread.sleep(1000); done.countDown(); });
}
```

```
1 000 000 виртуальных потоков по 1 с: 10226 мс
```

Миллион потоков действительно создаётся и работает — на платформенных это невозможно в принципе.
Но обратите внимание: не 1 секунда, а 10. Виртуальные потоки дёшевы, а не бесплатны: миллион
объектов-продолжений, миллион таймеров и очередь планировщика тоже чего-то стоят.

---

## 4. Pinning — единственная серьёзная ловушка

### Механизм

Виртуальный поток снимается с носителя, только если блокировка проходит через `LockSupport.park`
(см. [`JUC_INTERNALS.md §8`](JUC_INTERNALS.md)). Через `park` блокируется **весь**
`java.util.concurrent`. А `synchronized` до JDK 24 блокировался инструкцией `monitorenter` внутри
виртуальной машины, которая про виртуальные потоки не знала, — носитель оставался занят.

Второй случай, где снять поток нельзя, — **вызов нативного метода** (JNI): нативный кадр стека
скопировать в кучу невозможно.

### Замер

100 виртуальных потоков, каждый спит 100 мс под **собственным** локом (конкуренции нет вовсе):

```
### JDK 21 (10 ядер → 10 носителей):
synchronized  : 1051 мс      ← 100 задач / 10 носителей × 100 мс, параллельности нет
ReentrantLock :  105 мс
без лока      :  106 мс

### JDK 24 (JEP 491):
synchronized  :  110 мс      ← починено
ReentrantLock :  105 мс
```

Замедление ровно в 10 раз — это отношение «сто задач к десяти носителям».

### Диагностика

```bash
java -Djdk.tracePinnedThreads=short  -jar app.jar     # стек места, где прибило
java -Djdk.tracePinnedThreads=full   -jar app.jar     # полный стек
```

Реальный вывод на JDK 21:

```
VirtualThread[#35]/runnable@ForkJoinPool-1-worker-10 reason:MONITOR
    Pin.lambda$main$0(Pin.java:9) <== monitors:1
```

`reason:MONITOR` — прибило на `synchronized`; `reason:NATIVE` — на нативном вызове. Строка указывает
точное место. В JFR то же самое видно событием `jdk.VirtualThreadPinned`.

### Что делать

| JDK | Что делать |
|---|---|
| 21–23 | заменить `synchronized` на `ReentrantLock` **в путях, где есть блокирующие операции**; в библиотечном коде — везде |
| 24+ | ничего: JEP 491 снял ограничение для `synchronized` |
| любой | нативные вызовы остаются причиной pinning — выносить их на платформенный пул |

Важная оговорка: `synchronized` **вокруг быстрой операции в памяти** безвреден и на JDK 21 — носитель
занят микросекунды. Переписывать весь код не нужно; ищите `synchronized` вокруг ввода-вывода.

---

## 5. Что меняется в архитектуре

### Пул перестаёт быть регулятором нагрузки

Это самый важный сдвиг, и его чаще всего упускают. В модели с пулом «10 потоков» одновременно
означало и «10 задач», и «не больше 10 запросов к БД», и «не больше 10 обращений к внешнему API».
Один параметр ограничивал всё сразу.

Виртуальных потоков может быть миллион — и все они одновременно постучатся в базу.

```java
// ❌ Было: пул ограничивал всё сразу
ExecutorService pool = Executors.newFixedThreadPool(20);

// ✅ Стало: потоков сколько угодно, ограничиваем РЕСУРС, а не потоки
ExecutorService ex = Executors.newVirtualThreadPerTaskExecutor();
Semaphore dbLimit  = new Semaphore(20);      // ровно под размер пула соединений
Semaphore apiLimit = new Semaphore(50);      // ровно под лимит внешнего API

dbLimit.acquire();
try { return jdbc.query(sql); } finally { dbLimit.release(); }
```

Про `Semaphore` как ограничитель — [`SYNCHRONIZERS.md §3`](SYNCHRONIZERS.md).

### «Пул виртуальных потоков» — антипаттерн

```java
// ❌ Бессмысленно: виртуальные потоки не надо переиспользовать
Executors.newFixedThreadPool(200, Thread.ofVirtual().factory());
```

Пул существует, чтобы не создавать дорогие потоки заново. Виртуальный поток стоит 1.5 мкс —
переиспользовать нечего. Более того, пул возвращает обе проблемы: искусственное ограничение
конкурентности и переживание `ThreadLocal` между задачами
([`THREADS_BASICS.md §7`](THREADS_BASICS.md)).

### Пул соединений к БД становится главным ограничителем

Раньше пул потоков был меньше или равен пулу соединений, и очередь за соединением почти не
возникала. Теперь тысячи виртуальных потоков будут ждать соединения — и ждать будут долго, если
таймаут получения выставлен щедро. Проверьте: `connectionTimeout` в HikariCP, размер пула,
метрики ожидания.

---

## 6. Чего виртуальные потоки не дают

- **Ускорения вычислений.** Ядер не прибавилось. Для задач, которые считают, правильный ответ —
  `ForkJoinPool` или пул размером с число ядер ([`EXECUTORS_FUTURES.md`](EXECUTORS_FUTURES.md)).
- **Безопасности при общем состоянии.** Гонки, дедлоки, видимость — всё то же самое. Более того,
  их становится проще получить: конкурентность выросла на порядки.
- **Автоматической защиты от перегрузки.** См. §5: ограничивать надо явно.
- **Бесплатной памяти.** Стек в куче — тоже память, и приостановленный поток держит все свои объекты.

---

## 7. `ScopedValue` вместо `ThreadLocal` — и его статус

`ThreadLocal` при миллионе потоков — это миллион копий значения. Предлагаемая замена:

```java
static final ScopedValue<User> CURRENT = ScopedValue.newInstance();

ScopedValue.where(CURRENT, user).run(() -> {
    handle(request);          // CURRENT.get() доступен здесь и во всех вложенных вызовах
});                           // на выходе значение убирается автоматически
```

| | `ThreadLocal` | `ScopedValue` |
|---|---|---|
| Изменяемость | изменяемый | неизменяемый |
| Область действия | вся жизнь потока | только внутри блока |
| Очистка | нужен `remove()` в `finally` | автоматически |
| Наследование | `InheritableThreadLocal` (копирование) | видно в дочерних задачах структурного блока |

> **Статус (проверено прогоном).** `ScopedValue` — **preview** и на JDK 21, и на JDK 24: без
> `--enable-preview` код не компилируется на обеих версиях. В продакшене на JDK 21 это означает
> `ThreadLocal` с обязательным `remove()`.

---

## 8. `StructuredTaskScope` — и его статус

Идея: дочерние задачи живут строго внутри блока родителя, а отмена и ошибки идут по дереву.

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    StructuredTaskScope.Subtask<Profile> p = scope.fork(() -> fetchProfile(id));
    StructuredTaskScope.Subtask<Orders>  o = scope.fork(() -> fetchOrders(id));

    scope.join();              // дождаться обеих
    scope.throwIfFailed();     // если любая упала — пробросить

    return render(p.get(), o.get());
}   // выход из try гарантирует: обе задачи завершены или отменены
```

Что это даёт против `CompletableFuture`: нет утечек фоновых задач, отмена сквозная, стектрейс
не рвётся, и время жизни задач видно прямо в структуре кода.

> **Статус (проверено прогоном).** `StructuredTaskScope` — **preview** и на JDK 21, и на JDK 24.
> Без `--enable-preview` не компилируется ни там, ни там:
>
> ```
> STS.java:1: error: StructuredTaskScope is a preview API and is disabled by default.
> ```
>
> API между версиями менялся (в JDK 21 `fork()` возвращал `Supplier<T>`, с JDK 22 —
> `Subtask<T>`), и продолжает меняться. Знать концепцию для собеседования нужно; закладываться
> на неё в продакшене — нет.
>
> Прогнать пример на JDK 21 можно так:
> `java --enable-preview --source 21 STS.java`

Готовый аналог, доступный без preview, — структурная конкурентность в корутинах Kotlin
([`kotlin-coroutines/STRUCTURED_CONCURRENCY.md`](../../kotlin-coroutines/theory/STRUCTURED_CONCURRENCY.md)).

---

## 9. Как мигрировать

1. **Начните с точки входа.** Замените пул обработчиков запросов на
   `newVirtualThreadPerTaskExecutor()`. В Spring Boot 3.2+ это один параметр:
   `spring.threads.virtual.enabled=true`.
2. **Расставьте семафоры** на всё, что было неявно ограничено размером пула: БД, внешние API,
   тяжёлые операции с памятью.
3. **Найдите pinning**: запустите нагрузочный тест с `-Djdk.tracePinnedThreads=short` и почините
   найденные места (`synchronized` вокруг ввода-вывода → `ReentrantLock`).
4. **Проверьте `ThreadLocal`**: убедитесь, что есть `remove()`, и что размер хранимого невелик.
5. **Оставьте пулы** для задач, которые считают, и для нативных вызовов.
6. **Пересмотрите таймауты и размер пула соединений** — ожидание переехало из очереди пула потоков
   в очередь за соединением.

---

## 10. Шпаргалка

```
Много блокирующего ввода-вывода, JDK 21+   → виртуальные потоки, поток на задачу
Ограничить нагрузку                        → Semaphore на ресурс, НЕ размер пула
Задачи считают                             → обычный пул / ForkJoinPool, VT не помогут
synchronized вокруг ввода-вывода (JDK 21-23) → заменить на ReentrantLock
Диагностика                                → -Djdk.tracePinnedThreads=short, событие jdk.VirtualThreadPinned
Контекст запроса                           → ThreadLocal + remove() (ScopedValue пока preview)
Группа связанных задач                     → StructuredTaskScope (тоже preview) либо CompletableFuture
Пул виртуальных потоков                    → так не делают
Дождаться завершения                       → явно: они всегда демоны
```

---

## 11. Упражнения

- [`Ex12: VirtualThreads`](../src/main/kotlin/exercises/Ex12_VirtualThreads.kt) — массовое создание,
  pinning, сравнение с платформенными.

---

## Вопросы для самопроверки

1. Где живёт стек виртуального потока и что происходит при блокировке?
2. Сколько потоков-носителей по умолчанию? Как это увидеть?
3. Почему `ReentrantLock` не прибивает виртуальный поток, а `synchronized` на JDK 21 — прибивает?
4. Почему в замере получилось замедление ровно в 10 раз?
5. Как найти pinning в работающем приложении?
6. Виртуальные потоки — демоны. Какое практическое следствие?
7. Почему «пул виртуальных потоков» бессмысленен?
8. Что перестаёт ограничивать размер пула после перехода на виртуальные потоки? Чем заменить?
9. Финализированы ли `ScopedValue` и `StructuredTaskScope` в JDK 24? Как проверить самому?
10. Для каких задач виртуальные потоки не дают ничего?

---

## Источники

**JEP (эволюция Loom):**
- [JEP 444: Virtual Threads (Final, JDK 21)](https://openjdk.org/jeps/444) — текущая стабильная редакция; разделы Motivation и Pinning.
- [JEP 491: Synchronize Virtual Threads without Pinning (JDK 24)](https://openjdk.org/jeps/491)
- [JEP 481: Scoped Values (Third Preview, JDK 23)](https://openjdk.org/jeps/481) · [JEP 487 (Fourth Preview, JDK 24)](https://openjdk.org/jeps/487)
- [JEP 480: Structured Concurrency (Third Preview, JDK 23)](https://openjdk.org/jeps/480) · [JEP 499 (Fourth Preview, JDK 24)](https://openjdk.org/jeps/499)

**Официальная документация:**
- [Core Libraries: Virtual Threads (JDK 21)](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html) — в том числе `-Djdk.tracePinnedThreads`.
- [`Thread.ofVirtual()`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Thread.Builder.OfVirtual.html) · [`Executors.newVirtualThreadPerTaskExecutor`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor())
- [Project Loom (OpenJDK)](https://openjdk.org/projects/loom/)

**Доклады и разборы:**
- [Ron Pressler — «State of Loom»](https://cr.openjdk.org/~rpressler/loom/loom/sol1_part1.html) — каноническое объяснение мотивации.
- [Inside.java — «The Age of Virtual Threads»](https://inside.java/2022/10/13/the-age-of-virtual-threads/)
- [Brian Goetz — «Project Loom: Modern Concurrency for the JVM»](https://www.youtube.com/watch?v=EO9oMiL1fFo)
