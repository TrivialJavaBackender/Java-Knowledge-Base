# Kotlin Coroutines — Semantic Summary

## Core Model
- Coroutine = suspendable computation, not a thread; many coroutines share few threads
- Structured concurrency: child coroutines complete before their parent; failures propagate upward
- suspend function = compiled to CPS state machine; continuation resumes on next suspension point

## Key Concepts
- **Builders**: `launch` (fire-and-forget, returns Job), `async` (returns Deferred), `runBlocking` (bridges to blocking)
- **withContext**: switch dispatcher for a block; suspends, does not create child scope
- **Dispatchers**: Default (CPU-bound, #cores threads), IO (blocking IO, elastic pool), Main (UI thread), Unconfined (resume on caller thread)
- **Scope / Context**: CoroutineScope owns lifetime; CoroutineContext = map of elements (Job + Dispatcher + name + handler)
- **Structured concurrency**: `coroutineScope` — first failure cancels siblings and propagates; `supervisorScope` — siblings isolated
- **Cancellation**: cooperative via `isActive`/`ensureActive`; CancellationException must propagate (not swallowed); `withTimeout` throws on expiry
- **Flow**: cold stream — only runs when collected; `flowOn` changes upstream dispatcher; operators are non-blocking
- **Hot flows**: StateFlow (current value holder), SharedFlow (broadcast, configurable replay); `shareIn`/`stateIn` for conversion
- **Channel**: typed FIFO; rendezvous/buffered/unlimited/conflated capacity; `produce` for fan-out, actor for fan-in

## Important Invariants
- `CancellationException` must NOT be caught without re-throw (it signals cooperative shutdown)
- `coroutineScope` re-throws first child exception; `supervisorScope` lets other children continue
- `flowOn` only changes the dispatcher of operators ABOVE it in the chain, not below
- `StateFlow` never emits equal consecutive values (equality-based deduplication)
- DataLoader in graphql-kotlin must not call `runBlocking` inside suspend resolver
- `GlobalScope` leaks — prefer scoped coroutine builders

## Common Pitfalls
- `runBlocking` on Android/server main thread blocks the event loop
- Catching `CancellationException` and not re-throwing breaks structured cancellation
- Using `Dispatchers.Default` for blocking IO saturates the CPU pool — use `Dispatchers.IO`
- Launching in `GlobalScope` without tracking Job → uncontrolled lifetime
- `async` exceptions are deferred to `await()` — unwaited Deferred silently loses exceptions

## Related Modules
- `concurrency` — platform/virtual threads; JMM visibility (relevant when mixing coroutines with shared mutable state)
- `spring-frameworks` — coroutine integration with Spring WebFlux, suspend controller methods
