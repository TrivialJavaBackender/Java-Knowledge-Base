# Progress Tracker — kotlin-coroutines

## Статус модулей

| Модуль | Статус | Дата начала | Дата завершения |
|--------|--------|-------------|-----------------|
| 1. Основы (suspend, builders) | ⬜ не начат | — | — |
| 2. Scope & Context | ⬜ не начат | — | — |
| 3. Dispatchers | ⬜ не начат | — | — |
| 4. Structured Concurrency | ⬜ не начат | — | — |
| 5. Cancellation & Exceptions | ⬜ не начат | — | — |
| 6. Flow | ⬜ не начат | — | — |
| 7. Flow Advanced (StateFlow / SharedFlow) | ⬜ не начат | — | — |
| 8. Channels | ⬜ не начат | — | — |
| 9. Suspend Internals (CPS) | ⬜ не начат | — | — |
| 10. Testing & Interop | ⬜ не начат | — | — |

## Упражнения

| # | Упражнение | Тема | Статус |
|---|-----------|------|--------|
| 01 | Basics | suspend, async/await, runBlocking | ⬜ |
| 02 | ScopeContext | CoroutineScope, lifecycle, cancel on close | ⬜ |
| 03 | Dispatchers | withContext, IO vs Default, limitedParallelism | ⬜ |
| 04 | StructuredConcurrency | coroutineScope vs supervisorScope | ⬜ |
| 05 | CancellationExceptions | cooperative cancel, NonCancellable, handler | ⬜ |
| 06 | Flow | cold flow, operators, lazy collection | ⬜ |
| 07 | FlowAdvanced | StateFlow counter, SharedFlow event bus | ⬜ |
| 08 | Channels | Channel pipeline, select, fan-out | ⬜ |
| 09 | SuspendInternals | suspendCancellableCoroutine bridge | ⬜ |
| 10 | TestingInterop | runTest virtual time + CompletableFuture interop | ⬜ |

## Теория

| Файл | Тема | Изучено |
|------|------|---------|
| [theory/BASICS.md](theory/BASICS.md) | suspend, launch/async/runBlocking/withContext, Job | ⬜ |
| [theory/SCOPE_CONTEXT.md](theory/SCOPE_CONTEXT.md) | CoroutineScope, CoroutineContext, элементы, наследование | ⬜ |
| [theory/DISPATCHERS.md](theory/DISPATCHERS.md) | Default/IO/Main/Unconfined, limitedParallelism | ⬜ |
| [theory/STRUCTURED_CONCURRENCY.md](theory/STRUCTURED_CONCURRENCY.md) | coroutineScope, supervisorScope, SupervisorJob | ⬜ |
| [theory/CANCELLATION_EXCEPTIONS.md](theory/CANCELLATION_EXCEPTIONS.md) | cooperative cancel, withTimeout, ExceptionHandler | ⬜ |
| [theory/FLOW.md](theory/FLOW.md) | cold streams, операторы, flowOn, retry | ⬜ |
| [theory/FLOW_ADVANCED.md](theory/FLOW_ADVANCED.md) | StateFlow, SharedFlow, shareIn/stateIn, WhileSubscribed | ⬜ |
| [theory/CHANNELS.md](theory/CHANNELS.md) | Channel capacity, produce, select, fan-out/fan-in | ⬜ |
| [theory/SUSPEND_INTERNALS.md](theory/SUSPEND_INTERNALS.md) | CPS, state machine, suspendCancellableCoroutine | ⬜ |
| [theory/TESTING_INTEROP.md](theory/TESTING_INTEROP.md) | runTest, virtual time, CF/Rx interop | ⬜ |
| [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md) | 30+ вопросов для собеседований | ⬜ |

## Вопросы для собеседований

| Секция | Вопросы | Изучено |
|--------|---------|---------|
| Основы и suspend | Q1–Q4 | ⬜ |
| Scope & Context | Q5–Q7 | ⬜ |
| Dispatchers | Q8–Q10 | ⬜ |
| Structured concurrency | Q11–Q14 | ⬜ |
| Cancellation & exceptions | Q15–Q18 | ⬜ |
| Flow | Q19–Q23 | ⬜ |
| StateFlow / SharedFlow | Q24–Q26 | ⬜ |
| Channels | Q27–Q29 | ⬜ |
| Suspend internals & testing | Q30–Q31 | ⬜ |

---
Легенда: ⬜ не начато | 🔄 в процессе | ✅ завершено
