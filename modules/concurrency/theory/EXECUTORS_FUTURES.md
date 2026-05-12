# Executors, Future, CompletableFuture — Полная теория

---

## 0. Виды thread pools — сравнение

| Фабричный метод | core | max | Queue | keepAlive | Когда использовать |
|---|---|---|---|---|---|
| `newFixedThreadPool(n)` | n | n | LinkedBlockingQueue (∞) | — | Предсказуемая нагрузка, CPU-bound |
| `newCachedThreadPool()` | 0 | MAX_INT | SynchronousQueue | 60s | Короткие burst-задачи, I/O-bound |
| `newSingleThreadExecutor()` | 1 | 1 | LinkedBlockingQueue (∞) | — | Гарантированный порядок |
| `newScheduledThreadPool(n)` | n | MAX_INT | DelayedWorkQueue | — | Периодические/отложенные задачи |
| `newWorkStealingPool()` | — | — | work-stealing deque | — | Параллельные CPU-задачи, рекурсия |
| `newVirtualThreadPerTaskExecutor()` | — | — | — | — | Java 21+, много I/O-bound задач |

### Опасности

**newFixedThreadPool** — очередь **неограничена** (`LinkedBlockingQueue`).
При медленных consumer'ах очередь растёт → OOM.
✅ Исправление: `ThreadPoolExecutor` с `ArrayBlockingQueue`.

**newCachedThreadPool** — создаёт поток на каждую задачу.
При 10 000 concurrent задач → 10 000 потоков → OOM / thrashing.
✅ Исправление: ограничить через `Semaphore` или заменить на FixedThreadPool.

**newSingleThreadExecutor** — тоже с unbounded queue.
Если задача бросит `Error`, поток пересоздаётся, но задача теряется.

**newWorkStealingPool** — каждый поток выполняет свои задачи LIFO, но крадёт у других FIFO. Нет гарантии порядка. Блокирующие задачи голодят пул (carrier threads заняты).

### Алгоритм принятия задачи (ThreadPoolExecutor)

```
submit(task)
  ├─ workers < corePoolSize?    → создать core-поток, выполнить
  ├─ queue.offer(task)?         → положить в очередь
  ├─ workers < maxPoolSize?     → создать non-core поток, выполнить
  └─ RejectionHandler!
```

### Шпаргалка выбора пула

```
CPU-bound, фиксированный параллелизм → newFixedThreadPool(nCPU)
Короткие burst I/O задачи           → newCachedThreadPool() + Semaphore
Периодические задачи (cron-like)    → newScheduledThreadPool(n)
Рекурсивное разбиение / D&C         → ForkJoinPool / newWorkStealingPool
I/O-bound, Java 21+                 → newVirtualThreadPerTaskExecutor()
Гарантия порядка                    → newSingleThreadExecutor()
Нужен back-pressure                 → ThreadPoolExecutor + ArrayBlockingQueue + CallerRunsPolicy
```

---

## 1. Executor Framework — архитектура

```
                    ┌──────────┐
                    │ Executor │ — void execute(Runnable)
                    └────┬─────┘
                         │
               ┌─────────┴──────────┐
               │  ExecutorService    │ — submit(), shutdown(), invokeAll()
               └─────────┬──────────┘
                    ┌─────┴──────┐
                    │            │
  ┌─────────────────┴──┐   ┌────┴──────────────────┐
  │ ThreadPoolExecutor  │   │ScheduledThreadPool    │
  │                     │   │Executor               │
  └─────────────────────┘   └───────────────────────┘
                    │
            ┌───────┴────────┐
            │  ForkJoinPool  │ — work-stealing
            └────────────────┘
```

---

## 2. ThreadPoolExecutor — 7 параметров

```java
new ThreadPoolExecutor(
    int corePoolSize,       // минимум потоков (всегда живы)
    int maximumPoolSize,    // максимум потоков
    long keepAliveTime,     // время жизни потоков > corePoolSize
    TimeUnit unit,          // единица keepAliveTime
    BlockingQueue<Runnable> workQueue,  // очередь задач
    ThreadFactory threadFactory,        // как создавать потоки
    RejectedExecutionHandler handler    // что делать при переполнении
)
```

### Алгоритм принятия задачи

```
Новая задача submit()
      │
      ▼
  workers < corePoolSize?
      ├─ Да → Создай новый поток, выполни задачу
      │
      ▼ Нет
  Очередь не полна?
      ├─ Да → Положи задачу в очередь
      │
      ▼ Нет
  workers < maximumPoolSize?
      ├─ Да → Создай новый поток, выполни задачу
      │
      ▼ Нет
  Rejection Policy!
```

**Критически важно для собеседования:** порядок — core → queue → max → reject.

### Rejection Policies

| Policy | Поведение | Когда использовать |
|---|---|---|
| `AbortPolicy` | Бросает `RejectedExecutionException` | Default. Fail-fast. |
| `CallerRunsPolicy` | Задача выполняется в вызывающем потоке | Back-pressure. Замедляет producer. |
| `DiscardPolicy` | Молча отбрасывает | Можно потерять задачу — редко подходит |
| `DiscardOldestPolicy` | Удаляет самую старую из очереди, ставит новую | Для "свежие данные важнее" |

### Что Executors создаёт внутри

```java
// ❌ newFixedThreadPool — unbounded queue → OOM
new ThreadPoolExecutor(n, n, 0, MILLISECONDS, new LinkedBlockingQueue<>())
//                                              ^^^^^^^^^^^^^^^^^^^^^^^^
//                                              capacity = Integer.MAX_VALUE!

// ❌ newCachedThreadPool — unbounded threads → тысячи потоков
new ThreadPoolExecutor(0, Integer.MAX_VALUE, 60s, new SynchronousQueue<>())
//                        ^^^^^^^^^^^^^^^^^
//                        Может создать миллион потоков!

// ❌ newSingleThreadExecutor — тоже unbounded queue
new ThreadPoolExecutor(1, 1, 0, MILLISECONDS, new LinkedBlockingQueue<>())

// ✅ Правильно — всё bounded
new ThreadPoolExecutor(
    10, 20, 60, SECONDS,
    new ArrayBlockingQueue<>(100),          // bounded!
    new ThreadPoolExecutor.CallerRunsPolicy() // back-pressure
)
```

### Жизненный цикл

```
  RUNNING → SHUTDOWN → TIDYING → TERMINATED
     │          │
     └──────────┴─→ STOP → TIDYING → TERMINATED

shutdown():     Не принимает новые задачи, дорабатывает существующие
shutdownNow():  Не принимает новые, прерывает выполняющиеся, возвращает невыполненные
awaitTermination():  Ждёт завершения с таймаутом

// Правильный shutdown
executor.shutdown();
if (!executor.awaitTermination(60, SECONDS)) {
    executor.shutdownNow();
    executor.awaitTermination(10, SECONDS);
}
```

> **Источник:** JCP §8.3, Javadoc ThreadPoolExecutor

---

## 3. ScheduledExecutorService

```java
ScheduledExecutorService ses = Executors.newScheduledThreadPool(4);

// Одноразовая задержка
ses.schedule(() -> doWork(), 5, SECONDS);

// Повторяющаяся — фиксированная ЧАСТОТА
ses.scheduleAtFixedRate(() -> doWork(),
    0,    // initialDelay
    10,   // period
    SECONDS);
// Если task занимает 3s: запуск в 0s, 10s, 20s, 30s...
// Если task занимает 15s: запуск в 0s, 15s, 30s, 45s... (без наложения!)

// Повторяющаяся — фиксированная ЗАДЕРЖКА
ses.scheduleWithFixedDelay(() -> doWork(),
    0,    // initialDelay
    10,   // delay после завершения
    SECONDS);
// Если task занимает 3s: запуск в 0s, 13s, 26s, 39s...
// delay отсчитывается от КОНЦА предыдущего запуска
```

**scheduleAtFixedRate vs scheduleWithFixedDelay:**
- `AtFixedRate`: "каждые N секунд" (по часам). Drift: если задача дольше периода — следующая сразу после.
- `WithFixedDelay`: "через N секунд после завершения предыдущей". Гарантирует паузу.

> **Источник:** Javadoc ScheduledExecutorService

---

## 4. Future<V>

```java
public interface Future<V> {
    boolean cancel(boolean mayInterruptIfRunning);
    boolean isCancelled();
    boolean isDone();
    V get() throws InterruptedException, ExecutionException;           // блокирует!
    V get(long timeout, TimeUnit unit) throws TimeoutException;        // блокирует!
}
```

### Проблемы Future

```java
Future<String> future = executor.submit(() -> fetchData());

// ❌ Блокирует вызывающий поток!
String result = future.get();

// ❌ Нельзя создать цепочку
// ❌ Нельзя комбинировать несколько futures
// ❌ Нельзя обработать ошибку без try-catch
// ❌ Нельзя выполнить callback по завершении

// Единственный способ проверить без блокировки:
if (future.isDone()) {
    String result = future.get(); // уже не блокирует
}
```

### cancel() — нюансы

```java
future.cancel(false);  // НЕ прерывает выполняющуюся задачу, только предотвращает старт
future.cancel(true);   // Вызывает Thread.interrupt() на выполняющем потоке
// НО: задача должна проверять Thread.interrupted()!

// После cancel:
future.isDone() == true      // всегда
future.isCancelled() == true // если cancel вернул true
future.get() → CancellationException
```

> **Источник:** JCP §6.3.2, Javadoc Future

---

## 5. Future / FutureTask / CompletableFuture — сравнение

| | `Future<V>` | `FutureTask<V>` | `CompletableFuture<V>` |
|---|---|---|---|
| Что такое | Интерфейс | Реализует `Future` + `Runnable` | Реализует `Future` + `CompletionStage` |
| Завершить вручную | ❌ | ❌ (только через `run()`) | ✅ `complete(v)` |
| Запустить вручную | ❌ | ✅ `run()` | ❌ |
| Гарантия "1 раз" | — | ✅ повторные `run()` — no-op | — |
| Цепочки / callback | ❌ | ❌ | ✅ |
| Комбинирование | ❌ | ❌ | ✅ `allOf`, `anyOf` |
| Обработка ошибок | try-catch на `get()` | try-catch на `get()` | `exceptionally`, `handle` |

### FutureTask

`FutureTask` оборачивает `Callable` и запускается вручную через `run()`.
Ключевое свойство: сколько бы раз ни вызвали `run()` — `Callable` выполнится **ровно 1 раз**, остальные вызовы — no-op. Это делает его незаменимым для паттерна "вычисли один раз среди N конкурентных потоков".

```java
// Паттерн: "вычисли один раз, лок не держи"
private final ConcurrentHashMap<K, FutureTask<V>> futures = new ConcurrentHashMap<>();

V getOrCompute(K key, Callable<V> loader) throws Exception {
    // computeIfAbsent атомарно кладёт задачу — только один FutureTask на ключ
    FutureTask<V> task = futures.computeIfAbsent(key, k -> new FutureTask<>(loader));
    task.run();       // первый вызов запускает loader, остальные — no-op
    V value = task.get(); // блокирует пока не готово
    futures.remove(key);  // почистить после использования
    return value;
}
```

**Почему не `synchronized` + проверка?**
```
Поток A: нет в кэше → вычисляет... (долго)
Поток B: нет в кэше → вычисляет... (долго)  ← оба запускают loader!

С FutureTask:
Поток A: computeIfAbsent → создаёт FutureTask → run() → вычисляет...
Поток B: computeIfAbsent → возвращает тот же FutureTask → run() → no-op → get() ждёт A
```

**Когда использовать FutureTask:**
- Нужна гарантия "один раз" без удержания лока во время вычисления
- Ленивая инициализация дорогого ресурса
- Кэш с конкурентной загрузкой

---

## 6. CompletableFuture — полный разбор

### Создание

```java
// Async с результатом
CompletableFuture<String> cf = CompletableFuture.supplyAsync(() -> compute());
CompletableFuture<String> cf = CompletableFuture.supplyAsync(() -> compute(), myExecutor);

// Async без результата
CompletableFuture<Void> cf = CompletableFuture.runAsync(() -> doWork());

// Уже завершённые
CompletableFuture<String> cf = CompletableFuture.completedFuture("value");
CompletableFuture<String> cf = CompletableFuture.failedFuture(new RuntimeException());

// Ручное завершение
CompletableFuture<String> cf = new CompletableFuture<>();
cf.complete("value");           // завершить с результатом
cf.completeExceptionally(ex);   // завершить с ошибкой
```

### Цепочки — полная карта методов

```
                          ┌────────────────────────────────────┐
                          │        CompletableFuture<T>        │
                          └──────────────┬─────────────────────┘
                                         │
    ┌────────────────────────────────────┼──────────────────────────────────┐
    │                                    │                                  │
    ▼                                    ▼                                  ▼
  Transform                         Compose                            Consume
  (возвращает значение)             (возвращает CF)                    (void)
    │                                    │                                  │
  thenApply(T→U) → CF<U>          thenCompose(T→CF<U>) → CF<U>      thenAccept(T→void)
  thenApplyAsync(T→U)             thenComposeAsync(T→CF<U>)         thenAcceptAsync
                                                                     thenRun(Runnable)
```

### thenApply vs thenCompose (КЛЮЧЕВОЙ ВОПРОС)

```java
// thenApply — аналог map. Функция возвращает ЗНАЧЕНИЕ.
CF<String> name = CF.supplyAsync(() -> getUserId())
    .thenApply(id -> "User-" + id);   // id → String
// Тип: CF<String>

// thenCompose — аналог flatMap. Функция возвращает CF.
CF<Profile> profile = CF.supplyAsync(() -> getUserId())
    .thenCompose(id -> fetchProfile(id));  // id → CF<Profile>
// Тип: CF<Profile>

// ❌ Если бы использовали thenApply с функцией, возвращающей CF:
CF<CF<Profile>> nested = CF.supplyAsync(() -> getUserId())
    .thenApply(id -> fetchProfile(id));  // id → CF<Profile>
// Тип: CF<CF<Profile>> — вложенный! Не то, что нужно.
```

### Комбинирование

```java
// Два CF → один результат
CF<String> combined = cf1.thenCombine(cf2, (r1, r2) -> r1 + " " + r2);

// Два CF → void
cf1.thenAcceptBoth(cf2, (r1, r2) -> process(r1, r2));

// Два CF → выполни Runnable когда оба завершены
cf1.runAfterBoth(cf2, () -> cleanup());

// Первый из двух
cf1.applyToEither(cf2, result -> transform(result));
cf1.acceptEither(cf2, result -> consume(result));
cf1.runAfterEither(cf2, () -> doSomething());
```

### allOf / anyOf

```java
// Ждать ВСЕ — возвращает CF<Void>
CF<Void> all = CompletableFuture.allOf(cf1, cf2, cf3);
all.thenRun(() -> {
    // Все завершены, получаем результаты через join()
    String r1 = cf1.join();  // не блокирует — уже завершено
    String r2 = cf2.join();
    String r3 = cf3.join();
});

// Ждать ЛЮБОЙ — возвращает CF<Object> (!)
CF<Object> any = CompletableFuture.anyOf(cf1, cf2, cf3);
any.thenAccept(result -> {
    String fastest = (String) result;  // нужен каст!
});
```

### Обработка ошибок

```java
// exceptionally — перехватить ошибку, вернуть fallback
cf.exceptionally(ex -> {
    log.error("Failed", ex);
    return defaultValue;
});

// handle — получить и результат, и ошибку (один будет null)
cf.handle((result, ex) -> {
    if (ex != null) return defaultValue;
    return transform(result);
});

// whenComplete — побочный эффект (логирование), не меняет результат
cf.whenComplete((result, ex) -> {
    if (ex != null) log.error("Failed", ex);
    else log.info("Got: " + result);
});
```

### Async суффикс — где выполняется код

```java
cf.thenApply(fn);        // В потоке, который завершил предыдущую стадию
                          // ИЛИ в вызывающем потоке (если уже завершена)
cf.thenApplyAsync(fn);    // В ForkJoinPool.commonPool()
cf.thenApplyAsync(fn, executor);  // В указанном executor

// ⚠️ thenApply может выполниться в ЛЮБОМ потоке!
// Если нужна гарантия — используй Async вариант.
```

### Таймауты (Java 9+)

```java
cf.orTimeout(5, SECONDS);              // TimeoutException через 5 секунд
cf.completeOnTimeout(defaultVal, 5, SECONDS);  // default через 5 секунд
```

### Типичные паттерны

```java
// 1. Retry pattern
CompletableFuture<String> retry(Supplier<CF<String>> action, int maxRetries) {
    CF<String> cf = action.get();
    for (int i = 0; i < maxRetries; i++) {
        cf = cf.exceptionallyCompose(ex -> action.get());  // Java 12+
    }
    return cf;
}

// 2. Первый успешный из нескольких (Java 9+ anyOf + filter errors)
// В Java 21: CompletableFuture.anySuccessful() — не существует, нужно вручную

// 3. Собрать все результаты в список
List<CF<String>> futures = urls.stream()
    .map(url -> CF.supplyAsync(() -> fetch(url)))
    .toList();

CF<List<String>> allResults = CF.allOf(futures.toArray(new CF[0]))
    .thenApply(v -> futures.stream()
        .map(CF::join)
        .toList());
```

> **Источник:** Javadoc CompletableFuture, JCP §6

---

## 7. ForkJoinPool — подробно

### Work-Stealing

```
Thread-1 deque:  [Task-A] [Task-B] [Task-C]  ← fork() добавляет сюда
                     ↑                  ↑
                   steal              execute
                   (снизу)            (сверху, LIFO)

Thread-2 deque:  [пусто]
                     ↑
                   ворует Task-A из Thread-1 (FIFO)
```

- Каждый поток: свой deque задач
- Выполнение: LIFO (последняя forked задача первой — лучшая локальность)
- Stealing: FIFO (крадёт самую старую — обычно самую крупную)

### RecursiveTask vs RecursiveAction

```java
// RecursiveTask<V> — возвращает результат
class SumTask extends RecursiveTask<Long> {
    protected Long compute() {
        if (small) return directCompute();
        SumTask left = new SumTask(firstHalf);
        SumTask right = new SumTask(secondHalf);
        left.fork();              // Запусти в другом потоке
        Long rightResult = right.compute();  // Выполни в текущем
        Long leftResult = left.join();       // Дождись результата
        return leftResult + rightResult;
    }
}

// RecursiveAction — без результата (void)
class SortAction extends RecursiveAction {
    protected void compute() {
        if (small) { Arrays.sort(array, lo, hi); return; }
        // fork/compute/join
    }
}
```

### commonPool()

```java
ForkJoinPool.commonPool()  // Shared pool, используется:
// - parallel streams
// - CompletableFuture.supplyAsync() (без указания executor)

// Parallelism = Runtime.getRuntime().availableProcessors() - 1
// Можно настроить: -Djava.util.concurrent.ForkJoinPool.common.parallelism=N

// ⚠️ Если задачи в commonPool блокируются (I/O), это замедляет ВСЕ parallel streams!
```

> **Источник:** JCP §8.1, Javadoc ForkJoinPool

---

## 8. Invoking Collections of Tasks

```java
// invokeAll — все задачи, ждать всех
List<Future<String>> futures = executor.invokeAll(callables);
// Блокирует пока ВСЕ не завершатся (или таймаут)
// Все futures уже isDone() == true

// invokeAny — первый успешный результат
String result = executor.invokeAny(callables);
// Возвращает результат первого успешно завершённого
// Отменяет остальные задачи

// ExecutorCompletionService — результаты по мере готовности
var ecs = new ExecutorCompletionService<String>(executor);
for (Callable<String> c : tasks) ecs.submit(c);
for (int i = 0; i < tasks.size(); i++) {
    Future<String> f = ecs.take();  // первый завершённый
    process(f.get());
}
```

> **Источник:** JCP §6.3.5, Javadoc ExecutorCompletionService

---

## 9. Шпаргалка: что использовать

```
Задача → результат?
  ├─ Нет  → execute(Runnable) / runAsync()
  └─ Да
      ├─ Нужна цепочка/композиция? → CompletableFuture
      ├─ Простой результат?         → submit() → Future<T>
      └─ Divide & conquer?          → ForkJoinPool + RecursiveTask

Сколько задач?
  ├─ Много одинаковых → ThreadPoolExecutor (bounded queue!)
  ├─ По расписанию    → ScheduledExecutorService
  ├─ I/O-bound, Java 21+ → Executors.newVirtualThreadPerTaskExecutor()
  └─ CPU-bound, parallel → ForkJoinPool

CompletableFuture: какой метод?
  ├─ T → U (синхронно)          → thenApply
  ├─ T → CF<U> (async)          → thenCompose
  ├─ T → void                   → thenAccept
  ├─ Два CF → результат         → thenCombine
  ├─ Ждать все                  → allOf
  ├─ Первый из нескольких       → anyOf
  ├─ Обработать ошибку          → exceptionally / handle
  └─ Побочный эффект            → whenComplete
```

---

## Источники

**Спецификации / JEP:**
- [JEP 266: More Concurrency Updates (JDK 9)](https://openjdk.org/jeps/266) — добавление `CompletionStage`, `orTimeout`, `completeOnTimeout`, `Flow`.
- [JEP 444: Virtual Threads (JDK 21)](https://openjdk.org/jeps/444) — `Executors.newVirtualThreadPerTaskExecutor()` и взаимодействие с `ForkJoinPool`.

**Официальная документация:**
- [`ThreadPoolExecutor` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html) — описание алгоритма принятия задач (core → queue → max → reject).
- [`ScheduledExecutorService` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ScheduledExecutorService.html) — точная семантика `scheduleAtFixedRate` vs `scheduleWithFixedDelay`.
- [`CompletableFuture` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletableFuture.html)
- [`ForkJoinPool` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ForkJoinPool.html)

**Books / papers:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 6 (Task Execution), Ch. 7 (Cancellation and Shutdown), Ch. 8 (Applying Thread Pools).
- *Effective Java*, 3rd ed. (Bloch) — Item 80 («Prefer executors, tasks, and streams to threads»).
- [Doug Lea — «A Java Fork/Join Framework» (PPoPP 2000)](https://gee.cs.oswego.edu/dl/papers/fj.pdf) — теоретическая основа `ForkJoinPool`, work-stealing deque, scan/steal protocol.

**Engineering blogs / posts:**
- [Tomasz Nurkiewicz — «CompletableFuture» series](https://www.nurkiewicz.com/2013/05/java-8-completablefuture-in-action.html) — практические сценарии (retry, timeouts, allOf-collect).
- [Brian Goetz — «Concurrency past and present» (devoxx talks)](https://www.youtube.com/watch?v=YxmDCeFouxM) — про эволюцию `ExecutorService` к virtual threads.
- [Heinz Kabutz — «ExecutorService — 10 tips and tricks»](https://www.javaspecialists.eu/archive/Issue222.html)
- [Inside.java — «Async programming with virtual threads vs reactive»](https://inside.java/2022/10/13/the-age-of-virtual-threads/) — Ron Pressler/Brian Goetz о миграции с CompletableFuture-цепочек.
