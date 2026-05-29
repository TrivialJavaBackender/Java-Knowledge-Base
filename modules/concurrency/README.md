# Java Concurrency — Interview Prep

Площадка для практики Java Concurrency перед техническими собеседованиями.
Покрывает все основные классы, концепции и типичные вопросы из `java.util.concurrent`.

## Структура проекта

```
├── ROADMAP.md                          # 8 модулей с чеклистами и ссылками на теорию
├── PROGRESS.md                         # Трекер прогресса (модули, упражнения, теория)
├── INTERVIEW_QUESTIONS.md              # 32 вопроса с ответами и источниками (JCP, JLS)
│
├── theory/                             # Теория по каждому модулю
│   ├── THREADS_BASICS.md               # Потоки, synchronized, volatile, wait/notify, JMM
│   ├── LOCKS.md                        # ReentrantLock, ReadWriteLock, StampedLock, Condition
│   ├── ATOMIC_CAS.md                   # CAS, Atomic*, LongAdder vs AtomicLong, ABA
│   ├── CONCURRENT_COLLECTIONS.md       # CHM, BlockingQueue, CopyOnWrite, SkipList
│   ├── EXECUTORS_FUTURES.md            # Все пулы, ThreadPoolExecutor, CompletableFuture, ForkJoin
│   ├── SYNCHRONIZERS.md                # CountDownLatch, CyclicBarrier, Semaphore, Phaser
│   ├── PROBLEMS.md                     # Deadlock, livelock, race condition, JMM
│   └── VIRTUAL_THREADS.md              # VT, pinning, ScopedValue, StructuredTaskScope
│
└── src/main/kotlin/exercises/
    ├── Ex01  Thread basics, synchronized, wait/notify (ping-pong)
    ├── Ex02  Producer-Consumer — bounded buffer на wait/notify
    ├── Ex03  ReentrantLock + Condition — LRU-кэш, getOrCompute, lock downgrade
    ├── Ex04  ReadWriteLock — MetricsStore, consistency demo, benchmark
    ├── Ex05  CAS, lock-free Treiber Stack, AtomicLong vs LongAdder
    ├── Ex06  ConcurrentHashMap merge, CopyOnWriteArrayList event bus
    ├── Ex07  BlockingQueue pipeline (ABQ + LBQ, poison pill)
    ├── Ex08  CompletableFuture: цепочки, allOf, anyOf, exceptionally
    ├── Ex09  ForkJoinPool, RecursiveTask — merge sort + max finder
    ├── Ex10  CountDownLatch, CyclicBarrier, Semaphore, Exchanger
    ├── Ex11  Deadlock: создание, обнаружение (ThreadMXBean), исправление
    ├── Ex12  Virtual Threads, pinning, benchmark (Java 21+)
    ├── Ex13  CHM: computeIfAbsent, merge, bulk ops, compute vs merge
    ├── Ex14  BlockingQueue: SynchronousQ, PriorityBQ, DelayQ, TransferQ, fair ABQ
    ├── Ex15  ConcurrentSkipListMap, newKeySet, CopyOnWriteArraySet
    ├── Ex16  Все виды thread pools, rejection policies, invokeAll/Any/CompletionService
    ├── Ex17  CompletableFuture: thenCombine, handle, retry+backoff, timeout, race
    └── Ex18  ScheduledExecutor (rate vs delay), rate limiter, ForkJoin map-reduce
```

## Темы

| Тема | Ключевые классы | Упражнения | Теория |
|------|----------------|-----------|--------|
| Потоки и синхронизация | `Thread`, `synchronized`, `volatile`, `wait/notify` | 01, 02 | [THREADS_BASICS](theory/THREADS_BASICS.md) |
| Locks | `ReentrantLock`, `ReadWriteLock`, `StampedLock`, `Condition` | 03, 04 | [LOCKS](theory/LOCKS.md) |
| Atomic & CAS | `AtomicInteger`, `AtomicReference`, `LongAdder` | 05 | [ATOMIC_CAS](theory/ATOMIC_CAS.md) |
| Concurrent Collections | `ConcurrentHashMap`, `CopyOnWriteArrayList`, `BlockingQueue` | 06, 07, 13, 14, 15 | [CONCURRENT_COLLECTIONS](theory/CONCURRENT_COLLECTIONS.md) |
| Executors & Futures | `ThreadPoolExecutor`, `CompletableFuture`, `ForkJoinPool` | 08, 09, 16, 17, 18 | [EXECUTORS_FUTURES](theory/EXECUTORS_FUTURES.md) |
| Synchronizers | `CountDownLatch`, `CyclicBarrier`, `Semaphore`, `Phaser` | 10 | [SYNCHRONIZERS](theory/SYNCHRONIZERS.md) |
| Проблемы | Deadlock, livelock, race condition, JMM | 11 | [PROBLEMS](theory/PROBLEMS.md) |
| Virtual Threads | `Thread.ofVirtual()`, pinning, `ScopedValue` | 12 | [VIRTUAL_THREADS](theory/VIRTUAL_THREADS.md) |

## Как работать

Каждый файл упражнения содержит TODO с описанием задачи. Реализуй, затем запусти:

```bash
# Компиляция
mvn compile

# Запуск конкретного упражнения
mvn exec:java -Dexec.mainClass="exercises.Ex01_ThreadBasicsKt"
```

Команды в CLAUDE.md:
- `"проверь Ex01"` — проверка реализации + запуск
- `"следующий"` / `"next"` — следующий незавершённый модуль
- `"квиз"` / `"quiz"` — 5 случайных вопросов из INTERVIEW_QUESTIONS.md

## Code review — на что смотреть

- **Kotlin Ex01–Ex18** (`mvn exec:java`): race condition, неправильные локи, утечки, корректность `wait/notify`, видимость (`volatile` / happens-before).
- **Applied (Java, `src/main/java/applied/{reservations,bank,cache,orderbook,scheduler,ratelimiter}`)**: тесты `mvn test -Dtest=ClassName`; смотри thread safety, стратегию локов, корректность под конкуренцией.

## Стек

- Kotlin 2.2 / JVM 21
- Maven 3.9
- JUnit 5

## Источники

- *Java Concurrency in Practice* — Brian Goetz et al.
- Java Language Specification §17 (Memory Model)
- OpenJDK source code
- JEP 444 (Virtual Threads), JEP 481 (ScopedValue)
