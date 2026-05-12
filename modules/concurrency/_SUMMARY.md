# Concurrency — Semantic Summary

## Core Model
- JMM: happens-before defines visibility; without it, reads may observe stale values
- Threads share heap (objects), not stack (locals, parameters)
- Monitor = mutual exclusion lock + condition variable (wait/notify)

## Key Concepts
- **JMM / visibility**: volatile (visibility, not atomicity), synchronized (happens-before on unlock→lock), final fields
- **Locks**: ReentrantLock (explicit, timed, interruptible), ReadWriteLock (concurrent reads), StampedLock (optimistic read)
- **CAS / atomics**: AtomicInteger/AtomicReference, CAS loop, ABA problem → AtomicStampedReference
- **Concurrent collections**: ConcurrentHashMap (segmented CAS), BlockingQueue (producer-consumer), CopyOnWriteArrayList (read-heavy)
- **Executors**: ThreadPoolExecutor (corePool/maxPool/queue/keepAlive), CompletableFuture (async pipeline), ForkJoinPool (work-stealing)
- **Synchronizers**: CountDownLatch (one-shot gate), CyclicBarrier (reusable rendezvous), Semaphore (permits), Phaser (dynamic parties)
- **Virtual threads**: M:N model, park without blocking carrier thread; pinning occurs only on synchronized + native frames

## Important Invariants
- volatile guarantees visibility AND ordering (happens-before), but NOT atomicity of compound operations
- CAS is atomic but subject to ABA; loop until success or add stamp
- ForkJoin tasks must be independent (no side-channel shared state between subtasks)
- Virtual threads use platform thread (carrier) pool; synchronized + blocking = carrier pinning = thread pool starvation
- double-checked locking requires volatile on the field to avoid partially constructed object visibility

## Common Pitfalls
- Deadlock: circular lock acquisition order → enforce global lock ordering
- Livelock: threads keep retrying and yielding to each other → add randomized backoff
- Starvation: unfair lock grants → use `new ReentrantLock(true)` (fair mode)
- Lock on wrong monitor (e.g., `synchronized(new Object())`) → no mutual exclusion
- Calling wait() outside synchronized block → IllegalMonitorStateException

## Related Modules
- `kotlin-coroutines` — coroutines as lightweight alternative to threads; virtual threads are complementary
- `system-design` — distributed locks (Redisson, database locks) as extension of local locking
