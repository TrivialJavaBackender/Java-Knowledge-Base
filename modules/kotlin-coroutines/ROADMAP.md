# Kotlin Coroutines — Roadmap

Структурированный план для повторения Kotlin Coroutines.
Теория в папке `theory/`. Каждый модуль — чеклист с ссылками на теорию и упражнения.

---

## Порядок прохождения

| Приоритет | Модуль | Частота на собесах |
|-----------|--------|--------------------|
| 1 | Модуль 1: Основы (suspend, builders) | ★★★★★ |
| 2 | Модуль 4: Structured Concurrency | ★★★★★ |
| 3 | Модуль 5: Cancellation & Exceptions | ★★★★★ |
| 4 | Модуль 6: Flow | ★★★★★ |
| 5 | Модуль 3: Dispatchers | ★★★★☆ |
| 6 | Модуль 7: Flow Advanced (StateFlow/SharedFlow) | ★★★★☆ |
| 7 | Модуль 2: Scope & Context | ★★★☆☆ |
| 8 | Модуль 8: Channels | ★★★☆☆ |
| 9 | Модуль 10: Testing & Interop | ★★★☆☆ |
| 10 | Модуль 9: Suspend Internals (CPS) | ★★☆☆☆ |

---

## Модуль 1: Основы (suspend, builders)

📖 Теория: [theory/BASICS.md](theory/BASICS.md)

- [ ] Что такое корутина, чем отличается от потока
- [ ] `suspend` функции — что компилятор делает
- [ ] `runBlocking` — мост, когда использовать
- [ ] `launch` — fire-and-forget, `Job`
- [ ] `async` — параллельная декомпозиция, `Deferred`
- [ ] `withContext` — смена контекста, последовательно
- [ ] `delay` vs `Thread.sleep`
- [ ] Жизненный цикл `Job`

**Упражнения:**
- [ ] [Ex01: Basics](src/main/kotlin/exercises/Ex01_Basics.kt) — параллельная загрузка через async/await

---

## Модуль 2: Scope & Context

📖 Теория: [theory/SCOPE_CONTEXT.md](theory/SCOPE_CONTEXT.md)

- [ ] `CoroutineContext` — Job, Dispatcher, Name, ExceptionHandler
- [ ] Композиция через `+`, наследование при запуске дочерней
- [ ] `CoroutineScope` — обёртка над контекстом
- [ ] Создание собственного scope для класса-владельца
- [ ] Готовые scope: GlobalScope (delicate), MainScope, viewModelScope
- [ ] `coroutineContext` внутри suspend-функции
- [ ] Структурная зависимость родитель-ребёнок

**Упражнения:**
- [ ] [Ex02: ScopeContext](src/main/kotlin/exercises/Ex02_ScopeContext.kt) — Service с cancel в close()

---

## Модуль 3: Dispatchers

📖 Теория: [theory/DISPATCHERS.md](theory/DISPATCHERS.md)

- [ ] `Default` (CPU), `IO` (blocking), `Main` (UI), `Unconfined`
- [ ] `withContext(dispatcher)` — fast path при том же диспатчере
- [ ] `limitedParallelism(N)` — bounded view
- [ ] Разделение пулов: Default vs IO с Kotlin 1.7+
- [ ] Когда `IO.limitedParallelism` правильно (HikariCP, rate limit)

**Упражнения:**
- [ ] [Ex03: Dispatchers](src/main/kotlin/exercises/Ex03_Dispatchers.kt) — CPU+IO pipeline

---

## Модуль 4: Structured Concurrency

📖 Теория: [theory/STRUCTURED_CONCURRENCY.md](theory/STRUCTURED_CONCURRENCY.md)

- [ ] Что гарантирует структурированная конкурентность
- [ ] `coroutineScope { }` — fail-fast
- [ ] `supervisorScope { }` — fail-isolated
- [ ] `SupervisorJob` в долгоживущих scope
- [ ] Распространение отмены и исключений
- [ ] Когда что использовать

**Упражнения:**
- [ ] [Ex04: StructuredConcurrency](src/main/kotlin/exercises/Ex04_StructuredConcurrency.kt) — coroutineScope vs supervisorScope

---

## Модуль 5: Cancellation & Exceptions

📖 Теория: [theory/CANCELLATION_EXCEPTIONS.md](theory/CANCELLATION_EXCEPTIONS.md)

- [ ] Кооперативная отмена; `ensureActive`, `yield`, `isActive`
- [ ] `CancellationException` — особенный, не глотать
- [ ] Cleanup в `finally` через `withContext(NonCancellable)`
- [ ] `withTimeout` / `withTimeoutOrNull`
- [ ] Распространение исключений по `Job` иерархии
- [ ] `CoroutineExceptionHandler` — где работает, где нет
- [ ] `async` vs `launch` — разная семантика для exceptions
- [ ] `runCatching` и почему оно опасно в корутинах

**Упражнения:**
- [ ] [Ex05: CancellationExceptions](src/main/kotlin/exercises/Ex05_CancellationExceptions.kt) — cooperative cancel + cleanup

---

## Модуль 6: Flow

📖 Теория: [theory/FLOW.md](theory/FLOW.md)

- [ ] Cold streams, builders (`flow`, `flowOf`, `asFlow`, `channelFlow`, `callbackFlow`)
- [ ] Промежуточные операторы: map, filter, transform, take, onEach, scan, distinctUntilChanged
- [ ] flatMapConcat / flatMapMerge / flatMapLatest
- [ ] Терминальные операторы: collect, toList, first, fold, launchIn
- [ ] `flowOn` — смена upstream диспатчера
- [ ] Обработка ошибок: `catch`, `retry`, `retryWhen`
- [ ] Backpressure: `buffer`, `conflate`, `collectLatest`
- [ ] `combine`, `zip`, `merge`

**Упражнения:**
- [ ] [Ex06: Flow](src/main/kotlin/exercises/Ex06_Flow.kt) — paginated cold flow + transform

---

## Модуль 7: Flow Advanced (StateFlow / SharedFlow)

📖 Теория: [theory/FLOW_ADVANCED.md](theory/FLOW_ADVANCED.md)

- [ ] Hot vs Cold — отличия
- [ ] `StateFlow` — initial value, distinctUntilChanged, replay=1
- [ ] `MutableStateFlow.update { }` для атомарных изменений
- [ ] `SharedFlow` — replay, extraBufferCapacity, onBufferOverflow
- [ ] `tryEmit` vs `emit`
- [ ] `shareIn` / `stateIn` — превратить cold в hot
- [ ] `SharingStarted.WhileSubscribed(timeout)` для UI
- [ ] Анти-паттерны (replay для одноразовых событий)

**Упражнения:**
- [ ] [Ex07: FlowAdvanced](src/main/kotlin/exercises/Ex07_FlowAdvanced.kt) — counter ViewModel + event bus

---

## Модуль 8: Channels

📖 Теория: [theory/CHANNELS.md](theory/CHANNELS.md)

- [ ] Что такое `Channel<T>`, отличие от `BlockingQueue`
- [ ] Capacity типы: RENDEZVOUS, UNLIMITED, BUFFERED, CONFLATED, N
- [ ] `onBufferOverflow`: SUSPEND, DROP_OLDEST, DROP_LATEST
- [ ] `produce { }` — корутинный builder
- [ ] `actor { }` (`@ObsoleteCoroutinesApi`)
- [ ] `select { }` — `onReceive`, `onSend`, `onAwait`, `onTimeout`
- [ ] Pipeline / Fan-out / Fan-in / Poison pill
- [ ] Channel vs Flow — когда что

**Упражнения:**
- [ ] [Ex08: Channels](src/main/kotlin/exercises/Ex08_Channels.kt) — bounded pipeline + select

---

## Модуль 9: Suspend Internals (CPS)

📖 Теория: [theory/SUSPEND_INTERNALS.md](theory/SUSPEND_INTERNALS.md)

- [ ] `Continuation<T>` — главный примитив
- [ ] CPS-трансформация — что делает компилятор
- [ ] State machine — как локальные переменные становятся полями
- [ ] `COROUTINE_SUSPENDED` маркер
- [ ] `suspendCoroutine` — мост из callback API
- [ ] `suspendCancellableCoroutine` + `invokeOnCancellation`
- [ ] Почему suspend "free" — анализ стоимости
- [ ] Stack trace recovery, debug режим

**Упражнения:**
- [ ] [Ex09: SuspendInternals](src/main/kotlin/exercises/Ex09_SuspendInternals.kt) — мост Java callback → suspend

---

## Модуль 10: Testing & Interop

📖 Теория: [theory/TESTING_INTEROP.md](theory/TESTING_INTEROP.md)

- [ ] `runTest` — точка входа в тест корутин
- [ ] `StandardTestDispatcher` vs `UnconfinedTestDispatcher`
- [ ] Виртуальное время: `runCurrent`, `advanceTimeBy`, `advanceUntilIdle`
- [ ] Подмена `Dispatchers.Main` через `setMain` / `resetMain`
- [ ] Тестирование `StateFlow`/`SharedFlow` (launch+toList или Turbine)
- [ ] Interop с `CompletableFuture`: `await()`, `future { }`
- [ ] Interop с RxJava: `.await()`, `.asFlow()`, `rxSingle { }`
- [ ] `runInterruptible` для блокирующего Java API

**Упражнения:**
- [ ] [Ex10: TestingInterop](src/main/kotlin/exercises/Ex10_TestingInterop.kt) — runTest debounce + CF↔Deferred

---

## Файлы теории

| Файл | Модуль |
|------|--------|
| [theory/BASICS.md](theory/BASICS.md) | Модуль 1 |
| [theory/SCOPE_CONTEXT.md](theory/SCOPE_CONTEXT.md) | Модуль 2 |
| [theory/DISPATCHERS.md](theory/DISPATCHERS.md) | Модуль 3 |
| [theory/STRUCTURED_CONCURRENCY.md](theory/STRUCTURED_CONCURRENCY.md) | Модуль 4 |
| [theory/CANCELLATION_EXCEPTIONS.md](theory/CANCELLATION_EXCEPTIONS.md) | Модуль 5 |
| [theory/FLOW.md](theory/FLOW.md) | Модуль 6 |
| [theory/FLOW_ADVANCED.md](theory/FLOW_ADVANCED.md) | Модуль 7 |
| [theory/CHANNELS.md](theory/CHANNELS.md) | Модуль 8 |
| [theory/SUSPEND_INTERNALS.md](theory/SUSPEND_INTERNALS.md) | Модуль 9 |
| [theory/TESTING_INTEROP.md](theory/TESTING_INTEROP.md) | Модуль 10 |
