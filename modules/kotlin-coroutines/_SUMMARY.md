# Kotlin Coroutines — Semantic Summary

## Core Model
- Coroutine = a compiler-generated callback, not a lightweight thread: `suspend fun f(): R` compiles to `Object f(Continuation<? super R>)` returning either `R` or `COROUTINE_SUSPENDED`
- Suspension is an ordinary `return`: the thread is released, state lives in the continuation object on the heap
- Resumption is initiated by whoever produced the result (timer, another coroutine, callback thread); the dispatcher decides *where*, not *who*
- Structured concurrency: parents await children; cancellation and failures travel the Job tree

## Key Concepts
- **Builders**: `launch` → Job; `async` → Deferred; `withContext` → switch context, no parallelism; `runBlocking` → bridge to blocking code
- **Dispatchers**: Default (CPU, #cores), IO (blocking, ≤64, shares Default's pool), Main (UI), Unconfined (resume on caller thread); `limitedParallelism(n)` = view with a cap
- **Context**: immutable *indexed set* — typed keys, every element is itself a context, stored as a `CombinedContext` linked list (map-like API, not a `Map`); everything is inherited except `Job`
- **Scope**: holds a context and defines coroutine lifetime; builders are extensions on it
- **Cancellation**: cooperative; `CancellationException` is a signal, not an error; suspend cleanup needs `NonCancellable`
- **Flow**: cold stream, one `collect` method; hot: StateFlow (value + version, conflated) / SharedFlow (ring buffer + subscriber slots)
- **Channel**: hot queue, each item to exactly one receiver; `close()` vs `cancel()`
- **Shared state**: coroutine `Mutex` (non-reentrant) / `Semaphore` / `limitedParallelism(1)` confinement / actor
- **Backend patterns**: request deadline, bounded concurrency, retry + backoff + jitter, single-flight, graceful shutdown

## Important Invariants
- `CancellationException` must be re-thrown, never swallowed (`runCatching` swallows it)
- `coroutineScope` re-throws the first child failure; `supervisorScope` isolates *direct* children only
- `flowOn` affects upstream only; it also adds buffering
- `StateFlow` skips `equals`-equal values; mutating the held object emits nothing
- Catching `Throwable` around `emit` breaks `take`/`first` (exception transparency, `AbortFlowException`)
- A race is possible on a single-threaded dispatcher: a suspension point can split read-modify-write
- `synchronized` is invalid around suspend calls — a monitor belongs to a thread, a coroutine does not

## Common Pitfalls
- Blocking calls on `Dispatchers.Default` starve the CPU pool — use IO + `runInterruptible`
- `GlobalScope` — no owner, no cancellation, no inherited context
- Unwaited `Deferred` silently loses its exception; `CoroutineExceptionHandler` works only on a root coroutine
- Unbounded concurrency over a large list exhausts pools and overloads downstream services
- `ThreadLocal`/MDC is lost after the first suspension unless wrapped in `asContextElement()`
- Hard-wired dispatchers make tests run in real time instead of virtual

## Related Modules
- `concurrency` — platform/virtual threads, JVM locks, `CompletableFuture`, JMM visibility
- `system-design` — backoff/jitter recipe, circuit breaker; `caching-deep-dive` — cache stampede
- `spring-frameworks` — coroutines in Spring WebFlux, suspend controller methods
