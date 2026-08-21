# Kotlin Coroutines — Interview Prep

Площадка для практики Kotlin Coroutines перед техническими собеседованиями.
Покрывает suspend, structured concurrency, Flow / StateFlow / SharedFlow, Channel, и интероп с Java.

> Тема **virtual threads / `StructuredTaskScope`** живёт в `modules/concurrency/` (не дублируется здесь — это JVM-уровень).
> Тема **`CompletableFuture`** — там же; здесь только мост (`await()`, `future { }`) в [theory/INTEROP.md](theory/INTEROP.md).
> Тема **`synchronized` / `ReentrantLock` / `j.u.c.Semaphore`** — тоже там; здесь корутинные
> `Mutex`/`Semaphore` в [theory/SHARED_STATE.md](theory/SHARED_STATE.md).

## Структура проекта

```
├── ROADMAP.md                          # 10 модулей с чеклистами и ссылками на теорию
├── INTERVIEW_QUESTIONS.md              # 30+ вопросов с ответами
│
├── theory/                             # Теория по каждому модулю
│   ├── WHY_COROUTINES.md               # зачем корутины: потоки → колбеки → futures → suspend
│   ├── BASICS.md                       # suspend, launch/async/runBlocking/withContext
│   ├── SCOPE_CONTEXT.md                # CoroutineScope, CoroutineContext, наследование
│   ├── DISPATCHERS.md                  # Default/IO/Main/Unconfined, limitedParallelism
│   ├── STRUCTURED_CONCURRENCY.md       # coroutineScope vs supervisorScope
│   ├── CANCELLATION_EXCEPTIONS.md      # cooperative cancel, NonCancellable, handler
│   ├── FLOW.md                         # cold streams, операторы, flowOn, retry
│   ├── FLOW_ADVANCED.md                # StateFlow, SharedFlow, shareIn/stateIn
│   ├── CHANNELS.md                     # Channel capacity, produce, select
│   ├── SUSPEND_INTERNALS.md            # CPS, кто возобновляет, почему поток свободен
│   ├── SHARED_STATE.md                 # Mutex, Semaphore, confinement, актор
│   ├── FLOW_INTERNALS.md               # SafeCollector, AbortFlowException, fusion
│   ├── BACKEND_PATTERNS.md             # дедлайны, лимиты, retry, single-flight, shutdown
│   ├── INTEROP.md                      # колбеки, CompletableFuture, JDBC, Reactor/Rx
│   ├── TESTING_INTEROP.md              # runTest, virtual time, backgroundScope
│   ├── QUIZ_PREDICT_OUTPUT.md          # 18 «что напечатает» + 12 «найди баг»
│   ├── CHEATSHEET.md                   # таблицы на последние 15 минут
│   └── MOCK_INTERVIEW.md               # сценарий мок-собеседования на 60 минут
│
├── src/main/kotlin/exercises/
    ├── Ex01  Basics — параллельная загрузка через async/await
    ├── Ex02  ScopeContext — Service с cancel в close()
    ├── Ex03  Dispatchers — CPU + IO pipeline + limitedParallelism
    ├── Ex04  StructuredConcurrency — coroutineScope vs supervisorScope
    ├── Ex05  CancellationExceptions — cooperative cancel + cleanup
    ├── Ex06  Flow — paginated cold flow + операторы
    ├── Ex07  FlowAdvanced — Counter ViewModel + Event Bus
    ├── Ex08  Channels — bounded pipeline + select
    ├── Ex09  SuspendInternals — мост Java callback → suspend
    ├── Ex10  TestingInterop — runTest debounce + CF↔Deferred
    ├── Ex11  SharedState — гонка и 4 способа её вылечить
    ├── Ex12  ResilientCalls — retry с backoff + гонка реплик
    ├── Ex13  BoundedParallelism — parallelMap (список) и mapParallel (Flow)
    ├── Ex14  SingleFlight — дедупликация одновременных загрузок
    ├── Ex15  RateLimiter — скользящее окно permits/window
    ├── Ex16  GracefulShutdown — корректная остановка сервиса
    ├── Ex17  CustomFlowOperators — свои chunked(size, timeout) и throttleFirst
    └── Ex18  CallbackFlowBridge — callbackFlow + awaitClose + shareIn
│
└── src/test/kotlin/exercises/          # JUnit-тесты к Ex11–Ex18 (54 теста)
```

## Темы

| Тема | Ключевые API | Упражнения | Теория |
|------|--------------|-----------|--------|
| Зачем корутины | — | — | [WHY_COROUTINES](theory/WHY_COROUTINES.md) |
| Основы | `suspend`, `launch`, `async`, `runBlocking`, `withContext`, `Job` | 01 | [BASICS](theory/BASICS.md) |
| Scope & Context | `CoroutineScope`, `CoroutineContext`, `Job`, `CoroutineName` | 02 | [SCOPE_CONTEXT](theory/SCOPE_CONTEXT.md) |
| Dispatchers | `Dispatchers.Default/IO/Main/Unconfined`, `limitedParallelism` | 03 | [DISPATCHERS](theory/DISPATCHERS.md) |
| Structured Concurrency | `coroutineScope`, `supervisorScope`, `SupervisorJob` | 04 | [STRUCTURED_CONCURRENCY](theory/STRUCTURED_CONCURRENCY.md) |
| Cancellation & Exceptions | `cancel`, `ensureActive`, `NonCancellable`, `withTimeout`, `CoroutineExceptionHandler` | 05 | [CANCELLATION_EXCEPTIONS](theory/CANCELLATION_EXCEPTIONS.md) |
| Flow | `Flow`, `flowOn`, `catch`, `flatMap*`, `combine`, `buffer`, `debounce` | 06 | [FLOW](theory/FLOW.md) |
| StateFlow / SharedFlow | `StateFlow`, `SharedFlow`, `shareIn`, `stateIn`, `WhileSubscribed` | 07 | [FLOW_ADVANCED](theory/FLOW_ADVANCED.md) |
| Channels | `Channel`, `produce`, `select`, capacity, fan-out/in | 08 | [CHANNELS](theory/CHANNELS.md) |
| Suspend Internals | `Continuation`, CPS, `suspendCancellableCoroutine` | 09 | [SUSPEND_INTERNALS](theory/SUSPEND_INTERNALS.md) |
| Testing | `runTest`, `TestDispatcher`, `backgroundScope`, `currentTime` | 10 | [TESTING_INTEROP](theory/TESTING_INTEROP.md) |
| Shared State | `Mutex`, `Semaphore`, `limitedParallelism(1)`, актор | 11 | [SHARED_STATE](theory/SHARED_STATE.md) |
| Flow Internals | `SafeCollector`, `AbortFlowException`, fusion | 17 | [FLOW_INTERNALS](theory/FLOW_INTERNALS.md) |
| Бэкенд-паттерны | `Semaphore`, `CompletableDeferred`, `runInterruptible`, shutdown | 12–16 | [BACKEND_PATTERNS](theory/BACKEND_PATTERNS.md) |
| Интероп | `suspendCancellableCoroutine`, `await()`, `future { }`, `callbackFlow` | 18 | [INTEROP](theory/INTEROP.md) |

## Как работать

Каждый файл упражнения содержит TODO с описанием задачи. Реализуй, затем запусти:

```bash
# Компиляция
mvn compile

# Запуск конкретного упражнения
mvn exec:java -Dexec.mainClass="exercises.Ex01_BasicsKt"

# Тесты (Ex11–Ex18). Пока задача не решена, тест красный — это ожидаемое состояние.
mvn test
mvn test -Dtest=Ex14SingleFlightTest
```

Упражнения Ex01–Ex10 проверяются запуском `main()` и code review; Ex11–Ex18 покрыты тестами:
«зелёный тест» — объективный критерий готовности.

Команды в CLAUDE.md:
- `"проверь kotlin-coroutines Ex01"` — проверка реализации + запуск
- `"следующий"` / `"next"` — следующий незавершённый модуль
- `"квиз"` / `"quiz"` — 5 случайных вопросов из INTERVIEW_QUESTIONS.md

## Code review — на что смотреть

`mvn exec:java -Dexec.mainClass="exercises.ExNN_…Kt"`, для Ex11–Ex18 — `mvn test -Dtest=ExNN…Test`.

Смотри: structured concurrency (`coroutineScope` vs `supervisorScope`), кооперативную отмену и
проброс `CancellationException` (включая `runCatching`), утечки scope, корректность `Dispatchers`
и блокирующие вызовы не на своём пуле, ограничение конкурентности внешних вызовов, неограниченные
буферы (`Channel(UNLIMITED)`, `buffer(UNLIMITED)`), anti-паттерны `Flow`/`Channel`, инжект
диспетчеров ради тестируемости. Полный чек-лист — в
[theory/BACKEND_PATTERNS.md](theory/BACKEND_PATTERNS.md) §10.

## Стек

- Kotlin 2.2.21 / JVM 21
- kotlinx-coroutines-core 1.10.2
- kotlinx-coroutines-test 1.10.2 (test scope)
- Maven 3.9
- JUnit 5

## Источники

- Roman Elizarov, "Structured Concurrency" — KotlinConf 2019
- Roman Elizarov, "Cold flows, hot channels" — Medium 2020
- [kotlinlang.org/docs/coroutines-overview.html](https://kotlinlang.org/docs/coroutines-overview.html)
- KEEP-176 (Coroutines proposal)
- Vsevolod Tolstopyatov, "Concurrent coroutines" — KotlinConf 2021
