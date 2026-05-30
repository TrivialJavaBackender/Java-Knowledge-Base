# Kotlin Coroutines — Interview Prep

Площадка для практики Kotlin Coroutines перед техническими собеседованиями.
Покрывает suspend, structured concurrency, Flow / StateFlow / SharedFlow, Channel, и интероп с Java.

> Тема **virtual threads / `StructuredTaskScope`** живёт в `modules/concurrency/` (не дублируется здесь — это JVM-уровень).
> Тема **`CompletableFuture`** — там же; здесь только interop bridge (`await()`, `future { }`).

## Структура проекта

```
├── ROADMAP.md                          # 10 модулей с чеклистами и ссылками на теорию
├── INTERVIEW_QUESTIONS.md              # 30+ вопросов с ответами
│
├── theory/                             # Теория по каждому модулю
│   ├── BASICS.md                       # suspend, launch/async/runBlocking/withContext
│   ├── SCOPE_CONTEXT.md                # CoroutineScope, CoroutineContext, наследование
│   ├── DISPATCHERS.md                  # Default/IO/Main/Unconfined, limitedParallelism
│   ├── STRUCTURED_CONCURRENCY.md       # coroutineScope vs supervisorScope
│   ├── CANCELLATION_EXCEPTIONS.md      # cooperative cancel, NonCancellable, handler
│   ├── FLOW.md                         # cold streams, операторы, flowOn, retry
│   ├── FLOW_ADVANCED.md                # StateFlow, SharedFlow, shareIn/stateIn
│   ├── CHANNELS.md                     # Channel capacity, produce, select
│   ├── SUSPEND_INTERNALS.md            # CPS, state machine, suspendCancellableCoroutine
│   └── TESTING_INTEROP.md              # runTest, virtual time, CF/Rx interop
│
└── src/main/kotlin/exercises/
    ├── Ex01  Basics — параллельная загрузка через async/await
    ├── Ex02  ScopeContext — Service с cancel в close()
    ├── Ex03  Dispatchers — CPU + IO pipeline + limitedParallelism
    ├── Ex04  StructuredConcurrency — coroutineScope vs supervisorScope
    ├── Ex05  CancellationExceptions — cooperative cancel + cleanup
    ├── Ex06  Flow — paginated cold flow + операторы
    ├── Ex07  FlowAdvanced — Counter ViewModel + Event Bus
    ├── Ex08  Channels — bounded pipeline + select
    ├── Ex09  SuspendInternals — мост Java callback → suspend
    └── Ex10  TestingInterop — runTest debounce + CF↔Deferred
```

## Темы

| Тема | Ключевые API | Упражнения | Теория |
|------|--------------|-----------|--------|
| Основы | `suspend`, `launch`, `async`, `runBlocking`, `withContext`, `Job` | 01 | [BASICS](theory/BASICS.md) |
| Scope & Context | `CoroutineScope`, `CoroutineContext`, `Job`, `CoroutineName` | 02 | [SCOPE_CONTEXT](theory/SCOPE_CONTEXT.md) |
| Dispatchers | `Dispatchers.Default/IO/Main/Unconfined`, `limitedParallelism` | 03 | [DISPATCHERS](theory/DISPATCHERS.md) |
| Structured Concurrency | `coroutineScope`, `supervisorScope`, `SupervisorJob` | 04 | [STRUCTURED_CONCURRENCY](theory/STRUCTURED_CONCURRENCY.md) |
| Cancellation & Exceptions | `cancel`, `ensureActive`, `NonCancellable`, `withTimeout`, `CoroutineExceptionHandler` | 05 | [CANCELLATION_EXCEPTIONS](theory/CANCELLATION_EXCEPTIONS.md) |
| Flow | `Flow`, `flowOn`, `catch`, `flatMap*`, `combine`, `buffer`, `debounce` | 06 | [FLOW](theory/FLOW.md) |
| StateFlow / SharedFlow | `StateFlow`, `SharedFlow`, `shareIn`, `stateIn`, `WhileSubscribed` | 07 | [FLOW_ADVANCED](theory/FLOW_ADVANCED.md) |
| Channels | `Channel`, `produce`, `select`, capacity, fan-out/in | 08 | [CHANNELS](theory/CHANNELS.md) |
| Suspend Internals | `Continuation`, CPS, `suspendCancellableCoroutine` | 09 | [SUSPEND_INTERNALS](theory/SUSPEND_INTERNALS.md) |
| Testing & Interop | `runTest`, `TestDispatcher`, `await()`, `future { }` | 10 | [TESTING_INTEROP](theory/TESTING_INTEROP.md) |

## Как работать

Каждый файл упражнения содержит TODO с описанием задачи. Реализуй, затем запусти:

```bash
# Компиляция
mvn compile

# Запуск конкретного упражнения
mvn exec:java -Dexec.mainClass="exercises.Ex01_BasicsKt"
```

Команды в CLAUDE.md:
- `"проверь kotlin-coroutines Ex01"` — проверка реализации + запуск
- `"следующий"` / `"next"` — следующий незавершённый модуль
- `"квиз"` / `"quiz"` — 5 случайных вопросов из INTERVIEW_QUESTIONS.md

## Code review — на что смотреть

`mvn exec:java -Dexec.mainClass="exercises.ExNN_…Kt"`. Смотри: structured concurrency (`coroutineScope` vs `supervisorScope`), кооперативную отмену и обработку `CancellationException`, утечки scope, корректность `Dispatchers`, anti-паттерны `Flow`/`Channel`.

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
