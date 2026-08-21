# Kotlin Coroutines — Roadmap

Структурированный план для повторения Kotlin Coroutines.
Теория в папке `theory/`. Каждый модуль — чеклист с ссылками на теорию и упражнения.

**Если начинаешь с нуля** — читай [theory/WHY_COROUTINES.md](theory/WHY_COROUTINES.md) (модуль 0):
он объясняет, какую задачу корутины решают и чем они лучше колбеков и `CompletableFuture`.
Без этого остальные модули читаются как справочник API.

---

## Порядок прохождения

| Приоритет | Модуль | Частота на собесах |
|-----------|--------|--------------------|
| 0 | Модуль 0: Зачем корутины (мотивация) | — (фундамент) |
| 1 | Модуль 1: Основы (suspend, builders) | ★★★★★ |
| 2 | Модуль 4: Structured Concurrency | ★★★★★ |
| 3 | Модуль 5: Cancellation & Exceptions | ★★★★★ |
| 4 | Модуль 6: Flow | ★★★★★ |
| 5 | Модуль 3: Dispatchers | ★★★★☆ |
| 6 | Модуль 7: Flow Advanced (StateFlow/SharedFlow) | ★★★★☆ |
| 7 | Модуль 11: Shared State (Mutex, Semaphore, confinement) | ★★★★☆ |
| 8 | Модуль 13: Бэкенд-паттерны | ★★★★☆ |
| 9 | Модуль 2: Scope & Context | ★★★☆☆ |
| 10 | Модуль 8: Channels | ★★★☆☆ |
| 11 | Модуль 10: Testing | ★★★☆☆ |
| 12 | Модуль 14: Интероп с существующим кодом | ★★★☆☆ |
| 13 | Модуль 9: Suspend Internals (кто возобновляет) | ★★☆☆☆ |
| 14 | Модуль 12: Flow Internals (fusion, инварианты) | ★★☆☆☆ |

---

## Модуль 0: Зачем корутины

📖 Теория: [theory/WHY_COROUTINES.md](theory/WHY_COROUTINES.md)

- [ ] Модель «поток на запрос» и чем она платит
- [ ] Колбеки: почему ломаются `try/catch`, `finally` и композиция
- [ ] `CompletableFuture`: что чинит и что оставляет
- [ ] Главный тезис: корутина — колбек, сгенерированный компилятором
- [ ] Чего корутины НЕ делают (блокирующий вызов остаётся блокирующим)
- [ ] Когда корутины не нужны
- [ ] Как мигрировать существующий код: с краёв внутрь

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
- [ ] Жизненный цикл `Job`; `join()` vs `await()` при ошибке
- [ ] `CoroutineStart`: LAZY / ATOMIC / UNDISPATCHED и их сценарии
- [ ] Правила дизайна suspend-API (кто задаёт диспетчер, `suspend` vs `Flow`)

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
- [ ] Контекст — indexed set, а не `Map`: типизированный ключ, `CombinedContext`
- [ ] Почему наследуется всё, кроме `Job`
- [ ] `ThreadLocal.asContextElement()` / `ThreadContextElement` (MDC)
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
- [ ] Диспетчер как `ContinuationInterceptor`; воркеры `CoroutineScheduler`
- [ ] Диспетчер на виртуальных потоках (`asCoroutineDispatcher`)

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
- [ ] Почему возвращаемый тип suspend-функции — `Any?`; `COROUTINE_SUSPENDED` и fast path
- [ ] Кто возобновляет корутину: `delay` → таймер → `DispatchedContinuation` → воркер
- [ ] Трамплин `BaseContinuationImpl.resumeWith` и почему нет `StackOverflowError`
- [ ] Почему поток не блокируется — и где граница честности
- [ ] Почему suspend "free" — анализ стоимости
- [ ] Stack trace recovery, debug режим, `DebugProbes.dumpCoroutines()`

**Упражнения:**
- [ ] [Ex09: SuspendInternals](src/main/kotlin/exercises/Ex09_SuspendInternals.kt) — мост Java callback → suspend

---

## Модуль 10: Testing

📖 Теория: [theory/TESTING_INTEROP.md](theory/TESTING_INTEROP.md)

- [ ] `runTest` — точка входа в тест корутин
- [ ] `StandardTestDispatcher` vs `UnconfinedTestDispatcher`
- [ ] Виртуальное время: `runCurrent`, `advanceTimeBy`, `advanceUntilIdle`
- [ ] `backgroundScope` — почему тест зависает на горячем потоке
- [ ] Проверка параллельности через `currentTime` и конкурентности через `AtomicInteger`
- [ ] Подмена `Dispatchers.Main` через `setMain` / `resetMain`
- [ ] Тестирование `StateFlow`/`SharedFlow` (launch+toList или Turbine)
- [ ] Interop с `CompletableFuture`: `await()`, `future { }`
- [ ] Interop с RxJava: `.await()`, `.asFlow()`, `rxSingle { }`
- [ ] `runInterruptible` для блокирующего Java API

**Упражнения:**
- [ ] [Ex10: TestingInterop](src/main/kotlin/exercises/Ex10_TestingInterop.kt) — runTest debounce + CF↔Deferred

---

## Модуль 11: Shared State (Mutex, Semaphore, confinement)

📖 Теория: [theory/SHARED_STATE.md](theory/SHARED_STATE.md)

- [ ] Почему гонка возможна даже на одном потоке
- [ ] Арсенал по возрастанию цены: immutable → атомики → confinement → `Mutex` → `Semaphore` → актор
- [ ] Почему `synchronized` нельзя вокруг suspend, а `ReentrantLock` — плохо
- [ ] `Mutex` не реентерабельный
- [ ] `Mutex` vs `Semaphore`: взаимное исключение против лимита
- [ ] Правила против дедлоков

**Упражнения:**
- [ ] [Ex11: SharedState](src/main/kotlin/exercises/Ex11_SharedState.kt) — гонка и четыре способа её вылечить

---

## Модуль 12: Flow Internals

📖 Теория: [theory/FLOW_INTERNALS.md](theory/FLOW_INTERNALS.md)

- [ ] `Flow` — один suspend-метод `collect`; операторы как обёртки
- [ ] `SafeCollector` и инвариант «эмиссия из своей корутины»
- [ ] `AbortFlowException` и exception transparency
- [ ] Fusion: `flowOn` + `buffer` + `conflate` → один `ChannelFlow`
- [ ] Устройство `SharedFlow` (кольцевой буфер + слоты) и `StateFlow` (значение + версия)
- [ ] Когда `channelFlow` дороже `flow` и зачем нужен всё равно

**Упражнения:**
- [ ] [Ex17: CustomFlowOperators](src/main/kotlin/exercises/Ex17_CustomFlowOperators.kt) — свои `chunked` и `throttleFirst`

---

## Модуль 13: Бэкенд-паттерны

📖 Теория: [theory/BACKEND_PATTERNS.md](theory/BACKEND_PATTERNS.md)

- [ ] Дедлайн на границе операции и деградация некритичных вызовов
- [ ] Четыре способа ограничить параллелизм и когда какой
- [ ] Retry: backoff, jitter, идемпотентность, проброс отмены
- [ ] Retry vs circuit breaker — какую разную проблему решают
- [ ] Single-flight и почему не `async` в чужом scope
- [ ] JDBC: `limitedParallelism` под пул + `runInterruptible`
- [ ] Graceful shutdown: три шага
- [ ] MDC / `requestId` в логах корутин
- [ ] Чек-лист код-ревью асинхронного кода

**Упражнения:**
- [ ] [Ex12: ResilientCalls](src/main/kotlin/exercises/Ex12_ResilientCalls.kt) — retry с backoff + гонка реплик
- [ ] [Ex13: BoundedParallelism](src/main/kotlin/exercises/Ex13_BoundedParallelism.kt) — parallelMap и mapParallel
- [ ] [Ex14: SingleFlight](src/main/kotlin/exercises/Ex14_SingleFlight.kt) — дедупликация загрузок
- [ ] [Ex15: RateLimiter](src/main/kotlin/exercises/Ex15_RateLimiter.kt) — скользящее окно
- [ ] [Ex16: GracefulShutdown](src/main/kotlin/exercises/Ex16_GracefulShutdown.kt) — корректная остановка

---

## Модуль 14: Интероп с существующим кодом

📖 Теория: [theory/INTEROP.md](theory/INTEROP.md)

- [ ] Колбек → suspend: `suspendCancellableCoroutine` + `invokeOnCancellation`
- [ ] `CompletableFuture` ↔ корутины (всё в `kotlinx-coroutines-core`)
- [ ] Блокирующий Java-API: `withContext(io) { runInterruptible { … } }`
- [ ] Поток событий → `callbackFlow` + `awaitClose`
- [ ] Наружу: `future { }`, `mono { }`, `asPublisher()`
- [ ] Правила: мост живёт на границе, отмена доезжает до конца

**Упражнения:**
- [ ] [Ex18: CallbackFlowBridge](src/main/kotlin/exercises/Ex18_CallbackFlowBridge.kt) — `callbackFlow` + `shareIn`

---

## Материалы для самопроверки

- [ ] [theory/QUIZ_PREDICT_OUTPUT.md](theory/QUIZ_PREDICT_OUTPUT.md) — 18 задач «что напечатает» + 12 «найди баг»
- [ ] [theory/CHEATSHEET.md](theory/CHEATSHEET.md) — таблицы и формулировки на последние 15 минут
- [ ] [theory/MOCK_INTERVIEW.md](theory/MOCK_INTERVIEW.md) — сценарий мок-собеседования на 60 минут
- [ ] [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md) — банк вопросов с ответами

---

## Файлы теории

| Файл | Модуль |
|------|--------|
| [theory/WHY_COROUTINES.md](theory/WHY_COROUTINES.md) | Модуль 0 |
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
| [theory/SHARED_STATE.md](theory/SHARED_STATE.md) | Модуль 11 |
| [theory/FLOW_INTERNALS.md](theory/FLOW_INTERNALS.md) | Модуль 12 |
| [theory/BACKEND_PATTERNS.md](theory/BACKEND_PATTERNS.md) | Модуль 13 |
| [theory/INTEROP.md](theory/INTEROP.md) | Модуль 14 |
| [theory/QUIZ_PREDICT_OUTPUT.md](theory/QUIZ_PREDICT_OUTPUT.md) | самопроверка |
| [theory/CHEATSHEET.md](theory/CHEATSHEET.md) | самопроверка |
| [theory/MOCK_INTERVIEW.md](theory/MOCK_INTERVIEW.md) | самопроверка |
