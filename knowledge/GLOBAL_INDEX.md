# Global Concept Index

Canonical concept → owner file map. One concept, one owner. Other modules must link, not redefine.

## Concurrency

- зачем конкурентность / цена потока → modules/concurrency/theory/WHY_CONCURRENCY.md
- закон Литтла (Little's law) → modules/concurrency/theory/WHY_CONCURRENCY.md
- закон Амдала / Universal Scalability Law → modules/concurrency/theory/WHY_CONCURRENCY.md
- latency vs throughput (в конкурентности) → modules/concurrency/theory/WHY_CONCURRENCY.md
- thread lifecycle → modules/concurrency/theory/THREADS_BASICS.md
- synchronized → modules/concurrency/theory/THREADS_BASICS.md
- wait/notify → modules/concurrency/theory/THREADS_BASICS.md
- interrupt / кооперативная отмена потока → modules/concurrency/theory/THREADS_BASICS.md
- ThreadLocal → modules/concurrency/theory/THREADS_BASICS.md
- JMM → modules/concurrency/theory/MEMORY_MODEL.md
- happens-before → modules/concurrency/theory/MEMORY_MODEL.md
- volatile → modules/concurrency/theory/MEMORY_MODEL.md
- memory reordering / store buffer → modules/concurrency/theory/MEMORY_MODEL.md
- safe publication → modules/concurrency/theory/MEMORY_MODEL.md
- final field semantics → modules/concurrency/theory/MEMORY_MODEL.md
- double-checked locking → modules/concurrency/theory/MEMORY_MODEL.md
- data race vs race condition → modules/concurrency/theory/MEMORY_MODEL.md
- jcstress → modules/concurrency/theory/MEMORY_MODEL.md
- AbstractQueuedSynchronizer (AQS) → modules/concurrency/theory/JUC_INTERNALS.md
- LockSupport park/unpark → modules/concurrency/theory/JUC_INTERNALS.md
- CLH queue → modules/concurrency/theory/JUC_INTERNALS.md
- barging / fair vs unfair → modules/concurrency/theory/JUC_INTERNALS.md
- spurious wakeup → modules/concurrency/theory/JUC_INTERNALS.md
- Thread.onSpinWait → modules/concurrency/theory/JUC_INTERNALS.md
- ReentrantLock → modules/concurrency/theory/LOCKS.md
- ReadWriteLock → modules/concurrency/theory/LOCKS.md
- StampedLock / optimistic read → modules/concurrency/theory/LOCKS.md
- Condition → modules/concurrency/theory/LOCKS.md
- lock downgrade → modules/concurrency/theory/LOCKS.md
- lock pinning (virtual threads) → modules/concurrency/theory/LOCKS.md
- CAS (Compare-And-Swap) → modules/concurrency/theory/ATOMIC_CAS.md
- AtomicInteger / AtomicReference → modules/concurrency/theory/ATOMIC_CAS.md
- ABA problem → modules/concurrency/theory/ATOMIC_CAS.md
- lock-free concurrency → modules/concurrency/theory/ATOMIC_CAS.md
- LongAdder / Striped64 → modules/concurrency/theory/ATOMIC_CAS.md
- false sharing / @Contended → modules/concurrency/theory/ATOMIC_CAS.md
- VarHandle / access modes → modules/concurrency/theory/ATOMIC_CAS.md
- Treiber stack → modules/concurrency/theory/ATOMIC_CAS.md
- ConcurrentHashMap → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- BlockingQueue → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- CopyOnWriteArrayList → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- ConcurrentSkipListMap → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- weakly consistent iterator → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- Collections.synchronizedXxx → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- CountDownLatch → modules/concurrency/theory/SYNCHRONIZERS.md
- CyclicBarrier → modules/concurrency/theory/SYNCHRONIZERS.md
- Semaphore → modules/concurrency/theory/SYNCHRONIZERS.md
- Phaser → modules/concurrency/theory/SYNCHRONIZERS.md
- Exchanger → modules/concurrency/theory/SYNCHRONIZERS.md
- ThreadPoolExecutor → modules/concurrency/theory/EXECUTORS_FUTURES.md
- FixedThreadPool / CachedThreadPool → modules/concurrency/theory/EXECUTORS_FUTURES.md
- pool sizing (размер пула потоков) → modules/concurrency/theory/EXECUTORS_FUTURES.md
- rejection policy / CallerRunsPolicy → modules/concurrency/theory/EXECUTORS_FUTURES.md
- ForkJoinPool → modules/concurrency/theory/EXECUTORS_FUTURES.md
- work-stealing → modules/concurrency/theory/EXECUTORS_FUTURES.md
- ManagedBlocker → modules/concurrency/theory/EXECUTORS_FUTURES.md
- ScheduledExecutorService → modules/concurrency/theory/EXECUTORS_FUTURES.md
- ExecutorCompletionService → modules/concurrency/theory/EXECUTORS_FUTURES.md
- CompletableFuture → modules/concurrency/theory/ASYNC_COMPOSITION.md
- CompletionStage → modules/concurrency/theory/ASYNC_COMPOSITION.md
- thenApply vs thenCompose → modules/concurrency/theory/ASYNC_COMPOSITION.md
- ForkJoinPool.commonPool (ловушка) → modules/concurrency/theory/ASYNC_COMPOSITION.md
- Future vs FutureTask → modules/concurrency/theory/ASYNC_COMPOSITION.md
- deadlock → modules/concurrency/theory/PROBLEMS.md
- livelock → modules/concurrency/theory/PROBLEMS.md
- starvation → modules/concurrency/theory/PROBLEMS.md
- race condition → modules/concurrency/theory/PROBLEMS.md
- Coffman conditions → modules/concurrency/theory/PROBLEMS.md
- thread dump / jcmd Thread.print → modules/concurrency/theory/PROBLEMS.md
- thread pool starvation → modules/concurrency/theory/PROBLEMS.md
- JFR events (concurrency) → modules/concurrency/theory/PROBLEMS.md
- virtual threads → modules/concurrency/theory/VIRTUAL_THREADS.md
- platform threads → modules/concurrency/theory/VIRTUAL_THREADS.md
- M:N threading model → modules/concurrency/theory/VIRTUAL_THREADS.md
- StructuredTaskScope → modules/concurrency/theory/VIRTUAL_THREADS.md
- ScopedValue → modules/concurrency/theory/VIRTUAL_THREADS.md

## Kotlin Coroutines

- suspend function → modules/kotlin-coroutines/theory/BASICS.md
- launch / async / runBlocking → modules/kotlin-coroutines/theory/BASICS.md
- withContext → modules/kotlin-coroutines/theory/BASICS.md
- Job / Deferred → modules/kotlin-coroutines/theory/BASICS.md
- Dispatchers (Default/IO/Main/Unconfined) → modules/kotlin-coroutines/theory/DISPATCHERS.md
- limitedParallelism → modules/kotlin-coroutines/theory/DISPATCHERS.md
- CoroutineScope → modules/kotlin-coroutines/theory/SCOPE_CONTEXT.md
- CoroutineContext → modules/kotlin-coroutines/theory/SCOPE_CONTEXT.md
- ContinuationInterceptor → modules/kotlin-coroutines/theory/SCOPE_CONTEXT.md
- structured concurrency → modules/kotlin-coroutines/theory/STRUCTURED_CONCURRENCY.md
- coroutineScope (builder function) → modules/kotlin-coroutines/theory/STRUCTURED_CONCURRENCY.md
- supervisorScope → modules/kotlin-coroutines/theory/STRUCTURED_CONCURRENCY.md
- SupervisorJob → modules/kotlin-coroutines/theory/STRUCTURED_CONCURRENCY.md
- cooperative cancellation → modules/kotlin-coroutines/theory/CANCELLATION_EXCEPTIONS.md
- CancellationException → modules/kotlin-coroutines/theory/CANCELLATION_EXCEPTIONS.md
- withTimeout / withTimeoutOrNull → modules/kotlin-coroutines/theory/CANCELLATION_EXCEPTIONS.md
- CoroutineExceptionHandler → modules/kotlin-coroutines/theory/CANCELLATION_EXCEPTIONS.md
- NonCancellable → modules/kotlin-coroutines/theory/CANCELLATION_EXCEPTIONS.md
- Flow (cold stream) → modules/kotlin-coroutines/theory/FLOW.md
- flow operators (map/filter/transform/flatMap) → modules/kotlin-coroutines/theory/FLOW.md
- flowOn → modules/kotlin-coroutines/theory/FLOW.md
- backpressure → modules/kotlin-coroutines/theory/FLOW.md
- StateFlow → modules/kotlin-coroutines/theory/FLOW_ADVANCED.md
- SharedFlow → modules/kotlin-coroutines/theory/FLOW_ADVANCED.md
- shareIn / stateIn → modules/kotlin-coroutines/theory/FLOW_ADVANCED.md
- WhileSubscribed → modules/kotlin-coroutines/theory/FLOW_ADVANCED.md
- Channel → modules/kotlin-coroutines/theory/CHANNELS.md
- produce / actor → modules/kotlin-coroutines/theory/CHANNELS.md
- fan-out / fan-in → modules/kotlin-coroutines/theory/CHANNELS.md
- select expression → modules/kotlin-coroutines/theory/CHANNELS.md
- CPS (Continuation-Passing Style) → modules/kotlin-coroutines/theory/SUSPEND_INTERNALS.md
- state machine (coroutine) → modules/kotlin-coroutines/theory/SUSPEND_INTERNALS.md
- suspendCancellableCoroutine → modules/kotlin-coroutines/theory/SUSPEND_INTERNALS.md
- runTest → modules/kotlin-coroutines/theory/TESTING_INTEROP.md
- TestDispatcher / virtual time → modules/kotlin-coroutines/theory/TESTING_INTEROP.md
- backgroundScope (тесты) → modules/kotlin-coroutines/theory/TESTING_INTEROP.md
- мотивация корутин / callback hell → modules/kotlin-coroutines/theory/WHY_COROUTINES.md
- когда корутины не нужны → modules/kotlin-coroutines/theory/WHY_COROUTINES.md
- COROUTINE_SUSPENDED / fast path → modules/kotlin-coroutines/theory/SUSPEND_INTERNALS.md
- Continuation.resumeWith → modules/kotlin-coroutines/theory/SUSPEND_INTERNALS.md
- механика возобновления (DispatchedContinuation, трамплин) → modules/kotlin-coroutines/theory/SUSPEND_INTERNALS.md
- DebugProbes.dumpCoroutines → modules/kotlin-coroutines/theory/SUSPEND_INTERNALS.md
- CoroutineContext как indexed set (CombinedContext) → modules/kotlin-coroutines/theory/SCOPE_CONTEXT.md
- ThreadContextElement / asContextElement → modules/kotlin-coroutines/theory/SCOPE_CONTEXT.md
- Mutex (kotlinx.coroutines.sync) → modules/kotlin-coroutines/theory/SHARED_STATE.md
- Semaphore (kotlinx.coroutines.sync) → modules/kotlin-coroutines/theory/SHARED_STATE.md
- thread confinement (limitedParallelism(1)) → modules/kotlin-coroutines/theory/SHARED_STATE.md
- актор на Channel → modules/kotlin-coroutines/theory/SHARED_STATE.md
- Flow fusion (ChannelFlow) → modules/kotlin-coroutines/theory/FLOW_INTERNALS.md
- SafeCollector / Flow invariant → modules/kotlin-coroutines/theory/FLOW_INTERNALS.md
- AbortFlowException / exception transparency → modules/kotlin-coroutines/theory/FLOW_INTERNALS.md
- callback → suspend bridge (suspendCancellableCoroutine) → modules/kotlin-coroutines/theory/INTEROP.md
- CompletableFuture interop (await / future / asDeferred) → modules/kotlin-coroutines/theory/INTEROP.md
- runInterruptible → modules/kotlin-coroutines/theory/INTEROP.md
- callbackFlow / awaitClose → modules/kotlin-coroutines/theory/INTEROP.md
- single-flight (дедупликация загрузок) → modules/kotlin-coroutines/theory/BACKEND_PATTERNS.md
- coroutine rate limiter → modules/kotlin-coroutines/theory/BACKEND_PATTERNS.md
- graceful shutdown (coroutine scope) → modules/kotlin-coroutines/theory/BACKEND_PATTERNS.md
- MDCContext / requestId в логах корутин → modules/kotlin-coroutines/theory/BACKEND_PATTERNS.md

## Caching

- cache hierarchy (CPU→JVM→distributed→CDN) → modules/caching-deep-dive/theory/BASICS.md
- locality of reference → modules/caching-deep-dive/theory/BASICS.md
- hit ratio / miss ratio → modules/caching-deep-dive/theory/BASICS.md
- cache-aside → modules/caching-deep-dive/theory/CACHE_PATTERNS.md
- read-through → modules/caching-deep-dive/theory/CACHE_PATTERNS.md
- write-through → modules/caching-deep-dive/theory/CACHE_PATTERNS.md
- write-behind (write-back) → modules/caching-deep-dive/theory/CACHE_PATTERNS.md
- refresh-ahead → modules/caching-deep-dive/theory/CACHE_PATTERNS.md
- LRU → modules/caching-deep-dive/theory/EVICTION_POLICIES.md
- LFU → modules/caching-deep-dive/theory/EVICTION_POLICIES.md
- FIFO eviction → modules/caching-deep-dive/theory/EVICTION_POLICIES.md
- ARC → modules/caching-deep-dive/theory/EVICTION_POLICIES.md
- 2Q → modules/caching-deep-dive/theory/EVICTION_POLICIES.md
- TinyLFU → modules/caching-deep-dive/theory/EVICTION_POLICIES.md
- W-TinyLFU → modules/caching-deep-dive/theory/EVICTION_POLICIES.md
- TTL / TTI → modules/caching-deep-dive/theory/EVICTION_POLICIES.md
- weight-based eviction → modules/caching-deep-dive/theory/EVICTION_POLICIES.md
- Caffeine → modules/caching-deep-dive/theory/CAFFEINE.md
- LoadingCache → modules/caching-deep-dive/theory/CAFFEINE.md
- AsyncLoadingCache → modules/caching-deep-dive/theory/CAFFEINE.md
- expireAfterWrite / expireAfterAccess → modules/caching-deep-dive/theory/CAFFEINE.md
- refreshAfterWrite → modules/caching-deep-dive/theory/CAFFEINE.md
- RemovalListener → modules/caching-deep-dive/theory/CAFFEINE.md
- Weigher (Caffeine) → modules/caching-deep-dive/theory/CAFFEINE.md
- Redis → modules/caching-deep-dive/theory/REDIS.md
- Redis data structures (string/hash/list/set/zset/stream) → modules/caching-deep-dive/theory/REDIS.md
- RDB / AOF persistence → modules/caching-deep-dive/theory/REDIS.md
- Redis Sentinel → modules/caching-deep-dive/theory/REDIS.md
- Redis Cluster → modules/caching-deep-dive/theory/REDIS.md
- Lua scripting (Redis) → modules/caching-deep-dive/theory/REDIS.md
- pipelining (Redis) → modules/caching-deep-dive/theory/REDIS.md
- caching topologies (centralized vs replicated) → modules/caching-deep-dive/theory/DISTRIBUTED_CACHING.md
- consistent hashing → modules/caching-deep-dive/theory/DISTRIBUTED_CACHING.md
- rendezvous hashing → modules/caching-deep-dive/theory/DISTRIBUTED_CACHING.md
- near-cache → modules/caching-deep-dive/theory/DISTRIBUTED_CACHING.md
- cross-node invalidation → modules/caching-deep-dive/theory/DISTRIBUTED_CACHING.md
- double-write problem → modules/caching-deep-dive/theory/CONSISTENCY.md
- TTL eventual consistency → modules/caching-deep-dive/theory/CONSISTENCY.md
- CDC (Change Data Capture, caching context) → modules/caching-deep-dive/theory/CONSISTENCY.md
- versioned keys → modules/caching-deep-dive/theory/CONSISTENCY.md
- stale-while-revalidate → modules/caching-deep-dive/theory/CONSISTENCY.md
- Cache-Control → modules/caching-deep-dive/theory/HTTP_CDN_CACHE.md
- ETag / If-None-Match → modules/caching-deep-dive/theory/HTTP_CDN_CACHE.md
- Last-Modified → modules/caching-deep-dive/theory/HTTP_CDN_CACHE.md
- Vary header → modules/caching-deep-dive/theory/HTTP_CDN_CACHE.md
- CDN purge → modules/caching-deep-dive/theory/HTTP_CDN_CACHE.md
- versioned URLs → modules/caching-deep-dive/theory/HTTP_CDN_CACHE.md
- cache stampede → modules/caching-deep-dive/theory/ANTI_PATTERNS.md
- cache penetration → modules/caching-deep-dive/theory/ANTI_PATTERNS.md
- cache breakdown → modules/caching-deep-dive/theory/ANTI_PATTERNS.md
- cache avalanche → modules/caching-deep-dive/theory/ANTI_PATTERNS.md
- hot key → modules/caching-deep-dive/theory/ANTI_PATTERNS.md
- big key → modules/caching-deep-dive/theory/ANTI_PATTERNS.md

## Java Core

- Garbage Collection algorithms (Serial/Parallel/CMS/G1/ZGC/Shenandoah/Epsilon) → modules/java-core/theory/GARBAGE_COLLECTION.md
- generational hypothesis / Eden / Survivor / Old / Metaspace → modules/java-core/theory/GARBAGE_COLLECTION.md
- TLAB (Thread-Local Allocation Buffer) → modules/java-core/theory/GARBAGE_COLLECTION.md
- write barrier (GC) / card table / remembered set → modules/java-core/theory/GARBAGE_COLLECTION.md
- SATB vs incremental update → modules/java-core/theory/GARBAGE_COLLECTION.md
- tri-color invariant → modules/java-core/theory/GARBAGE_COLLECTION.md
- safepoint → modules/java-core/theory/GARBAGE_COLLECTION.md
- STW (Stop-The-World) → modules/java-core/theory/GARBAGE_COLLECTION.md
- Cleaner / reference types (Soft/Weak/Phantom) → modules/java-core/theory/GARBAGE_COLLECTION.md
- JVM heap layout → modules/java-core/theory/JVM_MEMORY_AREAS.md
- Metaspace / Compressed Class Space → modules/java-core/theory/JVM_MEMORY_AREAS.md
- Code Cache → modules/java-core/theory/JVM_MEMORY_AREAS.md
- thread stack / `-Xss` → modules/java-core/theory/JVM_MEMORY_AREAS.md
- direct ByteBuffer / off-heap memory → modules/java-core/theory/JVM_MEMORY_AREAS.md
- Native Memory Tracking (NMT) → modules/java-core/theory/JVM_MEMORY_AREAS.md
- MaxRAMPercentage / UseContainerSupport → modules/java-core/theory/JVM_MEMORY_AREAS.md
- ClassLoader hierarchy (Bootstrap/Platform/App/Custom) → modules/java-core/theory/CLASS_LOADERS.md
- parent delegation → modules/java-core/theory/CLASS_LOADERS.md
- class loading lifecycle (loading/linking/initialization) → modules/java-core/theory/CLASS_LOADERS.md
- ClassNotFoundException vs NoClassDefFoundError → modules/java-core/theory/CLASS_LOADERS.md
- classloader leak → modules/java-core/theory/CLASS_LOADERS.md
- ServiceLoader (SPI) → modules/java-core/theory/CLASS_LOADERS.md
- ModuleLayer → modules/java-core/theory/CLASS_LOADERS.md
- HotSpot JIT pipeline (Interpreter / C1 / C2) → modules/java-core/theory/JIT_COMPILATION.md
- tiered compilation → modules/java-core/theory/JIT_COMPILATION.md
- escape analysis → modules/java-core/theory/JIT_COMPILATION.md
- scalar replacement → modules/java-core/theory/JIT_COMPILATION.md
- lock elision / lock coarsening → modules/java-core/theory/JIT_COMPILATION.md
- deoptimization → modules/java-core/theory/JIT_COMPILATION.md
- CHA (Class Hierarchy Analysis) → modules/java-core/theory/JIT_COMPILATION.md
- GraalVM / Graal compiler / JVMCI → modules/java-core/theory/JIT_COMPILATION.md
- GraalVM Native Image / AOT → modules/java-core/theory/JIT_COMPILATION.md
- polymorphic call site (mono/bi/megamorphic) → modules/java-core/theory/JIT_COMPILATION.md
- String pool / String.intern() → modules/java-core/theory/STRING_INTERNALS.md
- Compact Strings (JEP 254) → modules/java-core/theory/STRING_INTERNALS.md
- StringConcatFactory (JEP 280) → modules/java-core/theory/STRING_INTERNALS.md
- JVM class file format / constant pool → modules/java-core/theory/BYTECODE_INVOKEDYNAMIC.md
- JVM bytecode (opcodes) → modules/java-core/theory/BYTECODE_INVOKEDYNAMIC.md
- invokedynamic → modules/java-core/theory/BYTECODE_INVOKEDYNAMIC.md
- MethodHandle → modules/java-core/theory/BYTECODE_INVOKEDYNAMIC.md
- LambdaMetafactory → modules/java-core/theory/BYTECODE_INVOKEDYNAMIC.md
- hidden classes (JEP 371) → modules/java-core/theory/BYTECODE_INVOKEDYNAMIC.md
- Java Reflection API → modules/java-core/theory/REFLECTION_HANDLES.md
- setAccessible / `--add-opens` → modules/java-core/theory/REFLECTION_HANDLES.md
- VarHandle / access modes → modules/java-core/theory/REFLECTION_HANDLES.md
- AtomicFieldUpdater (legacy) → modules/java-core/theory/REFLECTION_HANDLES.md
- annotation processing (compile-time) → modules/java-core/theory/REFLECTION_HANDLES.md
- JPMS / Java Platform Module System → modules/java-core/theory/JPMS_MODULES.md
- module-info.java → modules/java-core/theory/JPMS_MODULES.md
- requires / requires transitive / requires static → modules/java-core/theory/JPMS_MODULES.md
- exports / opens (qualified) → modules/java-core/theory/JPMS_MODULES.md
- named / automatic / unnamed module → modules/java-core/theory/JPMS_MODULES.md
- jlink / jdeps → modules/java-core/theory/JPMS_MODULES.md
- type erasure → modules/java-core/theory/GENERICS_ERASURE.md
- bridge method (synthetic) → modules/java-core/theory/GENERICS_ERASURE.md
- PECS (Producer-Extends, Consumer-Super) → modules/java-core/theory/GENERICS_ERASURE.md
- wildcard capture conversion → modules/java-core/theory/GENERICS_ERASURE.md
- reifiable vs non-reifiable types → modules/java-core/theory/GENERICS_ERASURE.md
- F-bounded polymorphism → modules/java-core/theory/GENERICS_ERASURE.md
- super-type token (TypeReference) → modules/java-core/theory/GENERICS_ERASURE.md
- equals/hashCode contract → modules/java-core/theory/EQUALS_HASHCODE_COMPARABLE.md
- Comparable vs Comparator → modules/java-core/theory/EQUALS_HASHCODE_COMPARABLE.md
- Comparator API (comparing/thenComparing/nullsFirst) → modules/java-core/theory/EQUALS_HASHCODE_COMPARABLE.md
- TreeMap inconsistent with equals → modules/java-core/theory/EQUALS_HASHCODE_COMPARABLE.md
- Throwable.fillInStackTrace → modules/java-core/theory/EXCEPTION_INTERNALS.md
- try-with-resources / addSuppressed → modules/java-core/theory/EXCEPTION_INTERNALS.md
- AutoCloseable vs Closeable → modules/java-core/theory/EXCEPTION_INTERNALS.md
- checked vs unchecked exceptions → modules/java-core/theory/EXCEPTION_INTERNALS.md
- OmitStackTraceInFastThrow → modules/java-core/theory/EXCEPTION_INTERNALS.md
- Helpful NullPointerException (JEP 358) → modules/java-core/theory/EXCEPTION_INTERNALS.md
- sealed exception hierarchy → modules/java-core/theory/EXCEPTION_INTERNALS.md
- Records (JEP 395) → modules/java-core/theory/MODERN_JAVA_FEATURES.md
- Sealed classes/interfaces (JEP 409) → modules/java-core/theory/MODERN_JAVA_FEATURES.md
- pattern matching for instanceof → modules/java-core/theory/MODERN_JAVA_FEATURES.md
- pattern matching for switch (JEP 441) → modules/java-core/theory/MODERN_JAVA_FEATURES.md
- record patterns (JEP 440) → modules/java-core/theory/MODERN_JAVA_FEATURES.md
- unnamed pattern `_` → modules/java-core/theory/MODERN_JAVA_FEATURES.md
- text blocks (JEP 378) → modules/java-core/theory/MODERN_JAVA_FEATURES.md
- `var` local-variable type inference (JEP 286) → modules/java-core/theory/MODERN_JAVA_FEATURES.md
- switch expression (JEP 361) → modules/java-core/theory/MODERN_JAVA_FEATURES.md
- Foreign Function & Memory API (FFM, JEP 454) → modules/java-core/theory/FOREIGN_MEMORY_VECTOR.md
- Arena (confined/shared/auto/global) → modules/java-core/theory/FOREIGN_MEMORY_VECTOR.md
- MemorySegment / ValueLayout / MemoryLayout → modules/java-core/theory/FOREIGN_MEMORY_VECTOR.md
- Foreign Linker (downcall/upcall) → modules/java-core/theory/FOREIGN_MEMORY_VECTOR.md
- Vector API (SIMD) → modules/java-core/theory/FOREIGN_MEMORY_VECTOR.md
- Java Serialization (Serializable) → modules/java-core/theory/SERIALIZATION.md
- serialVersionUID → modules/java-core/theory/SERIALIZATION.md
- writeObject / readObject / writeReplace / readResolve → modules/java-core/theory/SERIALIZATION.md
- serialization proxy pattern → modules/java-core/theory/SERIALIZATION.md
- gadget chain (deserialization vulnerability) → modules/java-core/theory/SERIALIZATION.md
- JEP 290 / JEP 415 serialization filter → modules/java-core/theory/SERIALIZATION.md
- Externalizable → modules/java-core/theory/SERIALIZATION.md

## Databases

- ACID → modules/databases/theory/TRANSACTIONS.md
- isolation levels (READ COMMITTED / REPEATABLE READ / SERIALIZABLE) → modules/databases/theory/TRANSACTIONS.md
- MVCC → modules/databases/theory/TRANSACTIONS.md
- write skew / phantom read / lost update / dirty read → modules/databases/theory/TRANSACTIONS.md
- SSI (Serializable Snapshot Isolation) → modules/databases/theory/TRANSACTIONS.md
- EXCLUDE constraint → modules/databases/theory/TRANSACTIONS.md
- FOR UPDATE / SKIP LOCKED → modules/databases/theory/TRANSACTIONS.md
- B-tree index → modules/databases/theory/INDEXES.md
- Hash / GIN / GiST / BRIN index → modules/databases/theory/INDEXES.md
- index-only scan / covering index → modules/databases/theory/INDEXES.md
- partial index / expression index → modules/databases/theory/INDEXES.md
- pg_trgm (trigram, similarity search) → modules/databases/theory/INDEXES.md
- EXPLAIN ANALYZE → modules/databases/theory/INDEXES.md
- RDBMS vs NoSQL → modules/databases/theory/DATABASE_TYPES.md
- OLTP vs OLAP vs HTAP → modules/databases/theory/DATABASE_TYPES.md
- columnar storage → modules/databases/theory/DATABASE_TYPES.md
- Redis data structures (deep) → modules/caching-deep-dive/theory/REDIS.md (canonical); brief overview in modules/databases/theory/DATABASE_TYPES.md
- ORM patterns (Active Record / Data Mapper / Identity Map / Unit of Work) → modules/databases/theory/DATABASE_TYPES.md
- N+1 problem (JPA context) → modules/databases/theory/DATABASE_TYPES.md (canonical theory) + modules/hibernate-jpa/theory/FETCHING_NPLUS1.md (Hibernate implementation)
- LazyInitializationException → modules/hibernate-jpa/theory/FETCHING_NPLUS1.md
- LSM-tree vs B-tree → modules/databases/theory/STORAGE_ENGINES.md
- WAL (Write-Ahead Log) → modules/databases/theory/STORAGE_ENGINES.md
- compaction strategies (LCS, STCS, TWCS) → modules/databases/theory/STORAGE_ENGINES.md
- RocksDB (embedded engine) → modules/databases/theory/STORAGE_ENGINES.md
- InnoDB clustered index vs PostgreSQL heap → modules/databases/theory/STORAGE_ENGINES.md
- single-leader / multi-leader / leaderless replication → modules/databases/theory/REPLICATION.md
- sync vs async replication → modules/databases/theory/REPLICATION.md
- replication lag / read-your-writes / monotonic reads → modules/databases/theory/REPLICATION.md
- failover (manual / automatic / split-brain) → modules/databases/theory/REPLICATION.md
- CDC (Change Data Capture, Debezium) → modules/databases/theory/REPLICATION.md (canonical for DB perspective); also referenced in modules/caching-deep-dive/theory/CONSISTENCY.md (cache invalidation) and modules/system-design/theory/microservice_patterns.md (Outbox alternative)
- range vs hash vs directory sharding → modules/databases/theory/SHARDING.md
- consistent hashing (DB sharding context) → modules/databases/theory/SHARDING.md (cross-ref to caching-deep-dive/DISTRIBUTED_CACHING.md)
- rendezvous hashing (HRW) → modules/databases/theory/SHARDING.md
- resharding (dual-write, CDC-based, Vitess-style) → modules/databases/theory/SHARDING.md
- hot key / celebrity user mitigations → modules/databases/theory/SHARDING.md

## System Design

- distributed transactions / 2PC → modules/system-design/theory/microservice_patterns.md
- CAP theorem → modules/system-design/theory/distributed_systems.md
- PACELC → modules/system-design/theory/distributed_systems.md
- Lamport / vector clocks → modules/system-design/theory/distributed_systems.md
- quorum (R + W > N) → modules/system-design/theory/distributed_systems.md
- distributed locks → modules/system-design/theory/distributed_systems.md
- idempotency key → modules/system-design/theory/RELIABILITY_PATTERNS.md
- Saga pattern → modules/system-design/theory/microservice_patterns.md
- Outbox pattern → modules/system-design/theory/microservice_patterns.md
- Circuit Breaker pattern → modules/system-design/theory/microservice_patterns.md
- Strangler Fig → modules/system-design/theory/microservice_patterns.md
- API Gateway → modules/system-design/theory/microservice_patterns.md
- Service Discovery → modules/system-design/theory/microservice_patterns.md
- Bulkhead → modules/system-design/theory/microservice_patterns.md
- Kafka (topics/partitions/consumer groups) → modules/system-design/theory/kafka.md
- Kafka replication / ISR → modules/system-design/theory/kafka.md
- exactly-once / idempotent producer / transactional producer → modules/system-design/theory/kafka.md
- log compaction → modules/system-design/theory/kafka.md
- schema evolution → modules/system-design/theory/kafka.md
- backward / forward compatibility → modules/system-design/theory/kafka.md
- upcasting → modules/system-design/theory/kafka.md
- Schema Registry / Avro / Protobuf → modules/system-design/theory/kafka.md
- KRaft → modules/system-design/theory/kafka.md
- event sourcing → modules/system-design/theory/microservice_patterns.md
- event store / snapshot (event sourcing) → modules/system-design/theory/microservice_patterns.md
- CQRS → modules/system-design/theory/microservice_patterns.md
- JWT → modules/system-design/theory/identity_providers.md
- OAuth2 (protocol concepts) → modules/system-design/theory/identity_providers.md
- OIDC (protocol concepts) → modules/system-design/theory/identity_providers.md
- SAML 2.0 → modules/system-design/theory/identity_providers.md
- Keycloak / IdP → modules/system-design/theory/identity_providers.md
- bcrypt / Argon2 (password hashing) → modules/system-design/theory/identity_providers.md
- HTTP/TCP/DNS fundamentals → modules/system-design/theory/http_networking.md
- HTTP/2 / HTTP/3 / QUIC → modules/system-design/theory/http_networking.md
- WebSocket protocol → modules/system-design/theory/http_networking.md
- TLS 1.3 → modules/system-design/theory/http_networking.md

### Scaling fundamentals

- vertical / horizontal scaling → modules/system-design/theory/SCALING.md
- DNS (record types, GeoDNS, DNSSEC) → modules/system-design/theory/DNS.md
- CDN (pull/push, edge cache, signed URLs, multi-CDN) → modules/system-design/theory/CDN.md
- load balancer (L4/L7, algorithms, anycast) → modules/system-design/theory/LOAD_BALANCER.md
- reverse proxy (Nginx/HAProxy/Envoy/Traefik) → modules/system-design/theory/REVERSE_PROXY.md
- latency numbers (Jeff Dean) → modules/system-design/theory/LATENCY_NUMBERS.md
- Universal Scalability Law (USL, Gunther) → modules/system-design/theory/LATENCY_NUMBERS.md
- capacity estimation / back-of-envelope → modules/system-design/theory/CAPACITY_ESTIMATION.md
- powers of two table → modules/system-design/theory/CAPACITY_ESTIMATION.md
- interview framework (SD interview methodology) → modules/system-design/theory/INTERVIEW_FRAMEWORK.md

### Distributed primitives (advanced)

- Raft consensus → modules/system-design/theory/CONSENSUS.md
- Paxos / Multi-Paxos → modules/system-design/theory/CONSENSUS.md
- ZAB (ZooKeeper Atomic Broadcast) → modules/system-design/theory/CONSENSUS.md
- FLP impossibility → modules/system-design/theory/CONSENSUS.md
- leader election (Bully / Raft-based / ZK ephemeral znodes / lease-based) → modules/system-design/theory/LEADER_ELECTION.md
- fencing token → modules/system-design/theory/LEADER_ELECTION.md
- STONITH (split-brain prevention) → modules/system-design/theory/LEADER_ELECTION.md
- gossip protocol (SWIM, anti-entropy) → modules/system-design/theory/GOSSIP_PROTOCOL.md
- CRDT (G-Counter, PN-Counter, OR-Set, LWW-Register) → modules/system-design/theory/CRDT.md
- multi-region architecture (active-active, active-passive, Spanner-like) → modules/system-design/theory/MULTI_REGION.md
- TrueTime (Google Spanner) → modules/system-design/theory/MULTI_REGION.md

### Reliability patterns

- exponential backoff + full jitter (AWS recipe) → modules/system-design/theory/RELIABILITY_PATTERNS.md
- retry storm / retry budget → modules/system-design/theory/RELIABILITY_PATTERNS.md
- hedged requests (Tail at Scale, Dean & Barroso) → modules/system-design/theory/RELIABILITY_PATTERNS.md
- DLQ (Dead Letter Queue) → modules/system-design/theory/RELIABILITY_PATTERNS.md
- load shedding → modules/system-design/theory/RELIABILITY_PATTERNS.md
- adaptive concurrency (Netflix concurrency-limits) → modules/system-design/theory/RELIABILITY_PATTERNS.md
- graceful degradation → modules/system-design/theory/RELIABILITY_PATTERNS.md
- error budget burn rate alerts → modules/infrastructure/theory/OBSERVABILITY.md (canonical), modules/system-design/theory/RELIABILITY_PATTERNS.md (reference)

### Algorithms для SD

- Bloom filter / Counting Bloom / Cuckoo filter → modules/system-design/theory/PROBABILISTIC_STRUCTURES.md
- Count-Min Sketch → modules/system-design/theory/PROBABILISTIC_STRUCTURES.md
- HyperLogLog (approximate count distinct) → modules/system-design/theory/PROBABILISTIC_STRUCTURES.md
- Top-K (Misra-Gries, Space-Saving) → modules/system-design/theory/PROBABILISTIC_STRUCTURES.md
- Geohash → modules/system-design/theory/GEOSPATIAL.md
- S2 (Google) → modules/system-design/theory/GEOSPATIAL.md
- H3 (Uber, hexagonal) → modules/system-design/theory/GEOSPATIAL.md
- Quadtree / R-tree → modules/system-design/theory/GEOSPATIAL.md
- Trie (prefix tree, autocomplete) → modules/system-design/theory/TRIE.md
- Patricia / Radix tree → modules/system-design/theory/TRIE.md
- inverted index (Lucene/Elasticsearch fundamentals) → modules/system-design/theory/INVERTED_INDEX.md
- BM25 ranking → modules/system-design/theory/INVERTED_INDEX.md
- Merkle tree (anti-entropy, SPV proofs) → modules/system-design/theory/MERKLE_TREE.md

### Communication patterns

- long polling vs SSE vs WebSocket vs gRPC streaming → modules/system-design/theory/COMMUNICATION_PATTERNS.md
- backpressure (Reactive Streams) → modules/system-design/theory/COMMUNICATION_PATTERNS.md
- webhooks (HMAC signing, idempotency, retry) → modules/system-design/theory/WEBHOOKS.md

### Streaming / Modern

- MapReduce → modules/system-design/theory/STREAM_PROCESSING.md
- Spark (RDD, Catalyst, Structured Streaming) → modules/system-design/theory/STREAM_PROCESSING.md
- Flink (event-time, watermarks, exactly-once) → modules/system-design/theory/STREAM_PROCESSING.md
- Lambda vs Kappa architecture → modules/system-design/theory/STREAM_PROCESSING.md
- stream-table duality → modules/system-design/theory/STREAM_PROCESSING.md
- ML model serving (online vs batch inference) → modules/system-design/theory/ML_SERVING.md
- feature store (Feast, Tecton) → modules/system-design/theory/ML_SERVING.md
- shadow deployment / canary (ML) → modules/system-design/theory/ML_SERVING.md
- vector database (pgvector, Pinecone, Weaviate, Milvus) → modules/system-design/theory/VECTOR_DBS_RAG.md
- ANN (HNSW, IVF, PQ) → modules/system-design/theory/VECTOR_DBS_RAG.md
- RAG (Retrieval-Augmented Generation) → modules/system-design/theory/VECTOR_DBS_RAG.md
- embedding models → modules/system-design/theory/VECTOR_DBS_RAG.md

### Security beyond auth

- DDoS protection (volumetric, protocol, application) → modules/system-design/theory/DDOS_WAF.md
- SYN cookies → modules/system-design/theory/DDOS_WAF.md
- WAF (OWASP CRS, ModSecurity, Cloudflare/AWS WAF) → modules/system-design/theory/DDOS_WAF.md
- bot management → modules/system-design/theory/DDOS_WAF.md
- CORS / CSRF / CSP (SD context) → modules/system-design/theory/DDOS_WAF.md
- Zero Trust / BeyondCorp → modules/system-design/theory/DDOS_WAF.md

### Design Problems (templates)

- URL shortener (TinyURL/bit.ly) → modules/system-design/theory/DESIGN_01_URL_SHORTENER.md
- news feed (Twitter/Instagram) → modules/system-design/theory/DESIGN_02_NEWS_FEED.md
- chat messenger (WhatsApp/Slack) → modules/system-design/theory/DESIGN_03_CHAT_MESSENGER.md
- ride sharing (Uber/Lyft) → modules/system-design/theory/DESIGN_04_RIDE_SHARING.md
- video streaming (Netflix/YouTube) → modules/system-design/theory/DESIGN_05_VIDEO_STREAMING.md
- file storage (Dropbox/Google Drive) → modules/system-design/theory/DESIGN_06_FILE_STORAGE.md
- distributed rate limiter → modules/system-design/theory/DESIGN_07_RATE_LIMITER.md
- distributed cache → modules/system-design/theory/DESIGN_08_DISTRIBUTED_CACHE.md
- notification system → modules/system-design/theory/DESIGN_09_NOTIFICATION_SYSTEM.md
- search autocomplete → modules/system-design/theory/DESIGN_10_SEARCH_AUTOCOMPLETE.md
- web crawler → modules/system-design/theory/DESIGN_11_WEB_CRAWLER.md
- KV store (Dynamo-style) → modules/system-design/theory/DESIGN_12_KV_STORE.md
- payment ledger / double-entry bookkeeping → modules/system-design/theory/DESIGN_13_PAYMENT_LEDGER.md
- leaderboard (Redis ZSET) → modules/system-design/theory/DESIGN_14_LEADERBOARD.md

## Software Engineering

- SOLID principles → modules/software-engineering/theory/SOLID_OOP.md
- Adapter pattern (Jackson example) → modules/software-engineering/theory/SOLID_OOP.md
- Stream API (Java) → modules/software-engineering/theory/STREAM_API_FP.md
- Collectors / teeing → modules/software-engineering/theory/STREAM_API_FP.md
- Optional usage patterns → modules/software-engineering/theory/STREAM_API_FP.md
- higher-order function (HOF) → modules/software-engineering/theory/STREAM_API_FP.md
- first-class functions → modules/software-engineering/theory/STREAM_API_FP.md
- referential transparency → modules/software-engineering/theory/STREAM_API_FP.md
- pure functions / immutability → modules/software-engineering/theory/STREAM_API_FP.md
- currying / partial application → modules/software-engineering/theory/STREAM_API_FP.md
- default method (Java) → modules/software-engineering/theory/STREAM_API_FP.md
- tail recursion / TCO → modules/software-engineering/theory/STREAM_API_FP.md
- testing pyramid (Unit/Integration/E2E) → modules/software-engineering/theory/TESTING.md
- JUnit 5 → modules/software-engineering/theory/TESTING.md
- Mockito (mock/stub/spy/captor) → modules/software-engineering/theory/TESTING.md
- TestContainers → modules/software-engineering/theory/TESTING.md
- contract testing (Pact) → modules/software-engineering/theory/TESTING.md
- performance testing (k6/Gatling/JMeter) → modules/software-engineering/theory/TESTING.md
- SAST / DAST / pentest → modules/software-engineering/theory/TESTING.md
- chaos engineering → modules/software-engineering/theory/TESTING.md (introduction); deep practical patterns in modules/system-design/theory/distributed_systems.md (real-world failures) and modules/infrastructure/ (K8s chaos)
- mutation testing (PIT) → modules/software-engineering/theory/TESTING.md

## Spring

- IoC container → modules/spring-frameworks/theory/SPRING_CORE_DI.md
- DI (Dependency Injection) → modules/spring-frameworks/theory/SPRING_CORE_DI.md
- Bean lifecycle / scopes → modules/spring-frameworks/theory/SPRING_CORE_DI.md
- AOP → modules/spring-frameworks/theory/SPRING_CORE_DI.md
- Auto-Configuration → modules/spring-frameworks/theory/SPRING_BOOT.md
- Starters → modules/spring-frameworks/theory/SPRING_BOOT.md
- Spring Boot Actuator → modules/spring-frameworks/theory/SPRING_BOOT.md
- Profiles → modules/spring-frameworks/theory/SPRING_BOOT.md
- DispatcherServlet → modules/spring-frameworks/theory/SPRING_MVC_REST.md
- HandlerMapping / HandlerAdapter → modules/spring-frameworks/theory/SPRING_MVC_REST.md
- HttpMessageConverter → modules/spring-frameworks/theory/SPRING_MVC_REST.md
- @Transactional → modules/spring-frameworks/theory/SPRING_DATA_JPA.md
- Spring Data repositories → modules/spring-frameworks/theory/SPRING_DATA_JPA.md
- Spring Cache abstraction (@Cacheable, не путать с Hibernate L2) → modules/spring-frameworks/theory/SPRING_DATA_JPA.md
- Filter Chain (Spring Security) → modules/spring-frameworks/theory/SPRING_SECURITY.md
- SecurityContext → modules/spring-frameworks/theory/SPRING_SECURITY.md
- OAuth2 (Spring impl) → modules/spring-frameworks/theory/SPRING_SECURITY.md
- Method Security (@PreAuthorize) → modules/spring-frameworks/theory/SPRING_SECURITY.md
- Eureka → modules/spring-frameworks/theory/SPRING_CLOUD.md
- Spring Cloud Gateway → modules/spring-frameworks/theory/SPRING_CLOUD.md
- OpenFeign → modules/spring-frameworks/theory/SPRING_CLOUD.md
- Resilience4j Circuit Breaker (Spring) → modules/spring-frameworks/theory/SPRING_CLOUD.md
- Spring Cloud Config → modules/spring-frameworks/theory/SPRING_CLOUD.md

## Hibernate / JPA

- JPA vs Hibernate (spec vs provider) → modules/hibernate-jpa/theory/JPA_VS_HIBERNATE.md
- EntityManagerFactory / SessionFactory → modules/hibernate-jpa/theory/JPA_VS_HIBERNATE.md
- EntityManager / Session → modules/hibernate-jpa/theory/JPA_VS_HIBERNATE.md
- persistence unit / persistence.xml / bootstrap → modules/hibernate-jpa/theory/JPA_VS_HIBERNATE.md
- Hibernate dialect → modules/hibernate-jpa/theory/JPA_VS_HIBERNATE.md
- hbm2ddl.auto (DDL-auto modes) → modules/hibernate-jpa/theory/JPA_VS_HIBERNATE.md
- persistence context (L1) / entity lifecycle states → modules/hibernate-jpa/theory/ENTITY_LIFECYCLE.md
- persist / merge / remove / detach / refresh → modules/hibernate-jpa/theory/ENTITY_LIFECYCLE.md
- dirty checking / snapshot → modules/hibernate-jpa/theory/ENTITY_LIFECYCLE.md
- flush modes (AUTO / COMMIT / MANUAL) → modules/hibernate-jpa/theory/ENTITY_LIFECYCLE.md
- flush internals (write-behind, action queue, flush ordering) → modules/hibernate-jpa/theory/ENTITY_LIFECYCLE.md
- auto-flush / query flush / partial flush → modules/hibernate-jpa/theory/ENTITY_LIFECYCLE.md
- @Entity / @Embeddable mapping → modules/hibernate-jpa/theory/MAPPINGS_ASSOCIATIONS.md
- JPA associations (owning vs inverse side, mappedBy) → modules/hibernate-jpa/theory/MAPPINGS_ASSOCIATIONS.md
- cascade types / orphanRemoval → modules/hibernate-jpa/theory/MAPPINGS_ASSOCIATIONS.md
- @Column / @Table / @JoinColumn (advanced) → modules/hibernate-jpa/theory/ADVANCED_MAPPINGS.md
- @Enumerated (ORDINAL/STRING) / @Temporal / @Lob / @Transient / @Access → modules/hibernate-jpa/theory/ADVANCED_MAPPINGS.md
- @AttributeOverride / @AssociationOverride → modules/hibernate-jpa/theory/ADVANCED_MAPPINGS.md
- @Convert / @AttributeConverter → modules/hibernate-jpa/theory/ADVANCED_MAPPINGS.md
- @SecondaryTable → modules/hibernate-jpa/theory/ADVANCED_MAPPINGS.md
- @Formula / @Where / @SQLRestriction / @Filter / @FilterDef (Hibernate) → modules/hibernate-jpa/theory/ADVANCED_MAPPINGS.md
- @CreationTimestamp / @UpdateTimestamp / @Generated / insertable-updatable → modules/hibernate-jpa/theory/ADVANCED_MAPPINGS.md
- collection semantics (bag vs list vs set, PersistentBag/Set/List) → modules/hibernate-jpa/theory/COLLECTIONS.md
- MultipleBagFetchException → modules/hibernate-jpa/theory/COLLECTIONS.md
- ordered (@OrderBy) vs sorted (@SortNatural/@SortComparator) collections → modules/hibernate-jpa/theory/COLLECTIONS.md
- @OrderColumn vs @OrderBy / collection dirty checking / extra lazy → modules/hibernate-jpa/theory/COLLECTIONS.md
- @ElementCollection / @CollectionTable / @MapKey → modules/hibernate-jpa/theory/COLLECTIONS.md
- entity identity / equals/hashCode (business key, proxy-safe, Lombok) → modules/hibernate-jpa/theory/ENTITY_IDENTITY_EQUALS.md
- id generation strategies (IDENTITY/SEQUENCE/TABLE/UUID, pooled/hi-lo) → modules/hibernate-jpa/theory/IDENTIFIERS_INHERITANCE.md
- @NaturalId / natural id cache / byNaturalId lookup → modules/hibernate-jpa/theory/IDENTIFIERS_INHERITANCE.md
- JPA inheritance (SINGLE_TABLE / JOINED / TABLE_PER_CLASS) → modules/hibernate-jpa/theory/IDENTIFIERS_INHERITANCE.md
- @MappedSuperclass vs @Embeddable vs entity inheritance → modules/hibernate-jpa/theory/IDENTIFIERS_INHERITANCE.md
- composite keys (@EmbeddedId / @IdClass) → modules/hibernate-jpa/theory/COMPOSITE_KEYS.md
- derived identifiers / @MapsId / shared primary key → modules/hibernate-jpa/theory/COMPOSITE_KEYS.md
- @PrimaryKeyJoinColumn / composite foreign keys → modules/hibernate-jpa/theory/COMPOSITE_KEYS.md
- surrogate vs natural/composite keys → modules/hibernate-jpa/theory/COMPOSITE_KEYS.md
- FetchType LAZY / EAGER → modules/hibernate-jpa/theory/FETCHING_NPLUS1.md
- Hibernate proxy / bytecode enhancement → modules/hibernate-jpa/theory/FETCHING_NPLUS1.md
- JOIN FETCH / @EntityGraph (fetch vs load graph) → modules/hibernate-jpa/theory/FETCHING_NPLUS1.md
- @BatchSize / default_batch_fetch_size / @Fetch(SUBSELECT) → modules/hibernate-jpa/theory/FETCHING_NPLUS1.md
- N+1 problem (Hibernate implementation) → modules/hibernate-jpa/theory/FETCHING_NPLUS1.md
- LazyInitializationException → modules/hibernate-jpa/theory/FETCHING_NPLUS1.md
- Hibernate L1 cache (persistence context) → modules/hibernate-jpa/theory/CACHING.md
- Hibernate L2 cache (shared, region factory) → modules/hibernate-jpa/theory/CACHING.md
- Hibernate Query cache → modules/hibernate-jpa/theory/CACHING.md
- cache concurrency strategies (READ_ONLY / NONSTRICT / READ_WRITE / TRANSACTIONAL) → modules/hibernate-jpa/theory/CACHING.md
- @Cache / @Cacheable (Hibernate L2) → modules/hibernate-jpa/theory/CACHING.md
- EntityTransaction (resource-local vs JTA) → modules/hibernate-jpa/theory/TRANSACTIONS_LOCKING.md
- @Version / optimistic locking (JPA) → modules/hibernate-jpa/theory/TRANSACTIONS_LOCKING.md
- LockModeType / pessimistic locking (JPA) → modules/hibernate-jpa/theory/TRANSACTIONS_LOCKING.md
- OptimisticLockType (versionless) / lock timeout / scope → modules/hibernate-jpa/theory/TRANSACTIONS_LOCKING.md
- JPQL / HQL → modules/hibernate-jpa/theory/QUERYING.md
- Criteria API / JPA metamodel → modules/hibernate-jpa/theory/QUERYING.md
- native query / @SqlResultSetMapping → modules/hibernate-jpa/theory/QUERYING.md
- DTO constructor expression / Tuple projection → modules/hibernate-jpa/theory/QUERYING.md
- keyset / seek pagination → modules/hibernate-jpa/theory/QUERYING.md
- JPQL bulk update/delete (persistence context desync) → modules/hibernate-jpa/theory/QUERYING.md
- JPQL subqueries / correlated / EXISTS / functions (FUNCTION()) → modules/hibernate-jpa/theory/QUERYING.md
- implicit vs explicit JPQL joins / polymorphic queries (TYPE()) → modules/hibernate-jpa/theory/QUERYING.md
- JDBC batching (jdbc.batch_size, order_inserts/order_updates, insert vs update batching) → modules/hibernate-jpa/theory/PERFORMANCE_PITFALLS.md
- batch_versioned_data (batching @Version updates) → modules/hibernate-jpa/theory/PERFORMANCE_PITFALLS.md
- batch flush/clear pattern (memory control in bulk insert) → modules/hibernate-jpa/theory/PERFORMANCE_PITFALLS.md
- StatelessSession → modules/hibernate-jpa/theory/PERFORMANCE_PITFALLS.md
- Open Session In View (OSIV) anti-pattern → modules/hibernate-jpa/theory/PERFORMANCE_PITFALLS.md
- read-only queries (setReadOnly) → modules/hibernate-jpa/theory/PERFORMANCE_PITFALLS.md

## GraphQL

- SDL (Schema Definition Language) → modules/graphql-kotlin/theory/BASICS.md
- Query / Mutation / Subscription → modules/graphql-kotlin/theory/BASICS.md
- resolver → modules/graphql-kotlin/theory/BASICS.md
- introspection → modules/graphql-kotlin/theory/BASICS.md
- DataLoader → modules/graphql-kotlin/theory/DATALOADER_NPLUS1.md
- N+1 problem (GraphQL) → modules/graphql-kotlin/theory/DATALOADER_NPLUS1.md
- batching / deduplication (DataLoader) → modules/graphql-kotlin/theory/DATALOADER_NPLUS1.md
- code-first schema → modules/graphql-kotlin/theory/GRAPHQL_KOTLIN_SPRING.md
- GraphQLContext → modules/graphql-kotlin/theory/GRAPHQL_KOTLIN_SPRING.md
- suspend resolvers → modules/graphql-kotlin/theory/GRAPHQL_KOTLIN_SPRING.md
- custom scalars → modules/graphql-kotlin/theory/GRAPHQL_KOTLIN_SPRING.md
- Apollo Federation → modules/graphql-kotlin/theory/FEDERATION.md
- subgraph → modules/graphql-kotlin/theory/FEDERATION.md
- @key / @external / @requires → modules/graphql-kotlin/theory/FEDERATION.md
- entity resolver → modules/graphql-kotlin/theory/FEDERATION.md
- supergraph / router → modules/graphql-kotlin/theory/FEDERATION.md

## Infrastructure

- Docker (images/layers/registry) → modules/infrastructure/theory/DOCKER.md
- container vs VM → modules/infrastructure/theory/DOCKER.md
- Linux namespaces (PID/mount/network/IPC/UTS/user) → modules/infrastructure/theory/DOCKER.md
- cgroups (v1/v2) → modules/infrastructure/theory/DOCKER.md
- OverlayFS / UnionFS / copy-on-write (image layers) → modules/infrastructure/theory/DOCKER.md
- BuildKit → modules/infrastructure/theory/DOCKER.md
- multi-stage build → modules/infrastructure/theory/DOCKER.md
- distroless image → modules/infrastructure/theory/DOCKER.md
- OCI Image / Runtime spec → modules/infrastructure/theory/DOCKER.md
- containerd / CRI-O / runc → modules/infrastructure/theory/DOCKER.md
- multi-arch image (linux/amd64,linux/arm64) → modules/infrastructure/theory/DOCKER.md
- rootless containers / Podman → modules/infrastructure/theory/DOCKER.md
- PID 1 problem (tini, init in container) → modules/infrastructure/theory/DOCKER.md
- Kubernetes control plane → modules/infrastructure/theory/KUBERNETES.md
- reconciliation loop → modules/infrastructure/theory/KUBERNETES.md
- declarative vs imperative (K8s) → modules/infrastructure/theory/KUBERNETES.md
- etcd → modules/infrastructure/theory/KUBERNETES.md
- kube-apiserver / kube-scheduler / kube-controller-manager → modules/infrastructure/theory/KUBERNETES.md
- kube-proxy (iptables/IPVS/eBPF modes) → modules/infrastructure/theory/KUBERNETES.md
- Pod / Deployment / Service / Ingress → modules/infrastructure/theory/KUBERNETES.md
- ReplicaSet → modules/infrastructure/theory/KUBERNETES.md
- StatefulSet → modules/infrastructure/theory/KUBERNETES.md
- DaemonSet → modules/infrastructure/theory/KUBERNETES.md
- Job / CronJob → modules/infrastructure/theory/KUBERNETES.md
- pause container → modules/infrastructure/theory/KUBERNETES.md
- init container / sidecar pattern → modules/infrastructure/theory/KUBERNETES.md
- kubelet → modules/infrastructure/theory/KUBERNETES.md
- liveness / readiness / startup probes → modules/infrastructure/theory/KUBERNETES.md
- ConfigMap / Secret → modules/infrastructure/theory/KUBERNETES.md
- requests / limits / QoS classes → modules/infrastructure/theory/KUBERNETES.md
- OOMKilled → modules/infrastructure/theory/KUBERNETES.md
- HPA / VPA / Cluster Autoscaler → modules/infrastructure/theory/KUBERNETES.md
- EndpointSlices → modules/infrastructure/theory/KUBERNETES.md
- CoreDNS → modules/infrastructure/theory/KUBERNETES.md
- Gateway API → modules/infrastructure/theory/KUBERNETES.md
- NetworkPolicy → modules/infrastructure/theory/KUBERNETES.md
- PV / PVC / StorageClass / CSI → modules/infrastructure/theory/KUBERNETES.md
- Taints / Tolerations / Affinity → modules/infrastructure/theory/KUBERNETES.md
- TopologySpreadConstraints → modules/infrastructure/theory/KUBERNETES.md
- Helm chart / values / release → modules/infrastructure/theory/HELM.md
- Helm templating → modules/infrastructure/theory/HELM.md
- Helm hooks (pre/post install/upgrade/rollback) → modules/infrastructure/theory/HELM.md
- sub-chart / library chart / umbrella chart → modules/infrastructure/theory/HELM.md
- Kustomize (alternative to Helm) → modules/infrastructure/theory/HELM.md
- Argo CD / GitOps → modules/infrastructure/theory/HELM.md
- Observability (three pillars) → modules/infrastructure/theory/OBSERVABILITY.md
- monitoring vs observability → modules/infrastructure/theory/OBSERVABILITY.md
- SLI / SLO / SLA → modules/infrastructure/theory/OBSERVABILITY.md
- error budget → modules/infrastructure/theory/OBSERVABILITY.md
- burn rate alerts → modules/infrastructure/theory/OBSERVABILITY.md
- distributed tracing → modules/infrastructure/theory/OBSERVABILITY.md
- trace / span → modules/infrastructure/theory/OBSERVABILITY.md
- head-based / tail-based sampling → modules/infrastructure/theory/OBSERVABILITY.md
- W3C TraceContext (traceparent / tracestate) → modules/infrastructure/theory/OBSERVABILITY.md
- trace context propagation → modules/infrastructure/theory/OBSERVABILITY.md
- OpenTelemetry (SDK / API / Collector) → modules/infrastructure/theory/OBSERVABILITY.md
- exemplars (Prometheus + trace_id) → modules/infrastructure/theory/OBSERVABILITY.md
- wide events (Honeycomb-style) → modules/infrastructure/theory/OBSERVABILITY.md
- Counter / Gauge / Histogram / Summary → modules/infrastructure/theory/METRICS.md
- Prometheus → modules/infrastructure/theory/METRICS.md
- push vs pull model (Prometheus vs StatsD) → modules/infrastructure/theory/METRICS.md
- exposition format / OpenMetrics → modules/infrastructure/theory/METRICS.md
- service discovery (kubernetes_sd, file_sd) → modules/infrastructure/theory/METRICS.md
- PromQL (instant vector, range vector) → modules/infrastructure/theory/METRICS.md
- rate() vs irate() → modules/infrastructure/theory/METRICS.md
- histogram_quantile → modules/infrastructure/theory/METRICS.md
- cardinality (Prometheus cardinality bomb) → modules/infrastructure/theory/METRICS.md
- Micrometer (facade) → modules/infrastructure/theory/METRICS.md
- recording rules / alerting rules → modules/infrastructure/theory/METRICS.md
- Alertmanager → modules/infrastructure/theory/METRICS.md
- RED / USE method / Four Golden Signals → modules/infrastructure/theory/METRICS.md
- Thanos / Cortex / Mimir / VictoriaMetrics (long-term storage) → modules/infrastructure/theory/METRICS.md
- structured logging (JSON) → modules/infrastructure/theory/LOGGING.md
- 12-Factor stdout logging → modules/infrastructure/theory/LOGGING.md
- log aggregation → modules/infrastructure/theory/LOGGING.md
- MDC (Mapped Diagnostic Context) → modules/infrastructure/theory/LOGGING.md
- correlation ID (X-Request-ID) → modules/infrastructure/theory/LOGGING.md
- ELK vs Loki → modules/infrastructure/theory/LOGGING.md
- log-and-throw anti-pattern → modules/infrastructure/theory/LOGGING.md
- PII / GDPR / PCI-DSS / HIPAA (what not to log) → modules/infrastructure/theory/LOGGING.md
- cloud regions / availability zones → modules/infrastructure/theory/CLOUD.md
- IaaS / PaaS / SaaS / FaaS → modules/infrastructure/theory/CLOUD.md
- HA vs DR (high availability vs disaster recovery) → modules/infrastructure/theory/CLOUD.md
- RPO / RTO → modules/infrastructure/theory/CLOUD.md
- managed DB / DBaaS → modules/infrastructure/theory/CLOUD.md
- Infrastructure as Code / Terraform (state, drift, locking) → modules/infrastructure/theory/CLOUD.md
- vendor lock-in → modules/infrastructure/theory/CLOUD.md
- cloud-native patterns (stateless, immutable, externalised state) → modules/infrastructure/theory/CLOUD.md
- Vault (Seal/Unseal, auth methods, dynamic secrets) → modules/infrastructure/theory/SECRETS.md
- envelope encryption (KEK + DEK) → modules/infrastructure/theory/SECRETS.md
- bootstrap problem (IAM, SA token, AppRole) → modules/infrastructure/theory/SECRETS.md
- SOPS (encrypted-secrets-in-git) → modules/infrastructure/theory/SECRETS.md
- mTLS / TLS termination → modules/infrastructure/theory/SECRETS.md
- K8s Secrets (encryption at rest, ESO, Sealed Secrets) → modules/infrastructure/theory/SECRETS.md
- Terraform state encryption → modules/infrastructure/theory/SECRETS.md

## Go

### Tooling & Language Core
- go toolchain (build/run/install/test/vet/fmt) → modules/go/theory/TOOLING_MODULES.md
- go env / cross-compilation (GOOS/GOARCH) → modules/go/theory/TOOLING_MODULES.md
- Go modules (go.mod / go.sum) → modules/go/theory/TOOLING_MODULES.md
- semantic import versioning (/v2) → modules/go/theory/TOOLING_MODULES.md
- MVS (Minimal Version Selection) → modules/go/theory/TOOLING_MODULES.md
- go.work (multi-module workspace) → modules/go/theory/TOOLING_MODULES.md
- project layout (package=dir, internal/, cmd/) → modules/go/theory/TOOLING_MODULES.md
- GOPATH → modules evolution → modules/go/theory/TOOLING_MODULES.md
- var / := / zero values → modules/go/theory/BASICS.md
- const / iota → modules/go/theory/BASICS.md
- byte / rune / no implicit conversions → modules/go/theory/BASICS.md
- for (only loop) / range → modules/go/theory/BASICS.md
- switch (no auto-break, fallthrough) → modules/go/theory/BASICS.md
- functions (multiple return, named returns, variadic) → modules/go/theory/BASICS.md
- exported vs unexported (capitalization) → modules/go/theory/BASICS.md

### Types, Interfaces, Errors
- struct / empty struct{} → modules/go/theory/TYPES_STRUCTS_METHODS.md
- value vs pointer receiver → modules/go/theory/TYPES_STRUCTS_METHODS.md
- embedding (method promotion, composition over inheritance) → modules/go/theory/TYPES_STRUCTS_METHODS.md
- struct comparability / struct tags → modules/go/theory/TYPES_STRUCTS_METHODS.md
- type definition vs type alias → modules/go/theory/TYPES_STRUCTS_METHODS.md
- constructor functions (NewX idiom) → modules/go/theory/TYPES_STRUCTS_METHODS.md
- implicit interface implementation (structural typing) → modules/go/theory/INTERFACES.md
- empty interface / any → modules/go/theory/INTERFACES.md
- type assertion (comma-ok) / type switch → modules/go/theory/INTERFACES.md
- interface value internals (itab + data pointer) → modules/go/theory/INTERFACES.md
- nil-interface trap (typed nil) → modules/go/theory/INTERFACES.md
- method set (T vs *T) → modules/go/theory/INTERFACES.md
- accept interfaces, return structs → modules/go/theory/INTERFACES.md
- error interface (errors as values) → modules/go/theory/ERRORS_PANIC.md
- sentinel errors / custom error types → modules/go/theory/ERRORS_PANIC.md
- error wrapping (%w / errors.Is / errors.As / errors.Join) → modules/go/theory/ERRORS_PANIC.md
- panic / recover → modules/go/theory/ERRORS_PANIC.md
- defer (LIFO, arg evaluation, named return) → modules/go/theory/ERRORS_PANIC.md

### Data Structures
- arrays vs slices (slice header, append growth, aliasing, three-index) → modules/go/theory/SLICES_MAPS_STRINGS.md
- nil vs empty slice → modules/go/theory/SLICES_MAPS_STRINGS.md
- maps (comma-ok, randomized iteration, nil-map) → modules/go/theory/SLICES_MAPS_STRINGS.md
- strings (UTF-8, len=bytes, byte vs rune, strings.Builder) → modules/go/theory/SLICES_MAPS_STRINGS.md

### Concurrency
- goroutine (go f()) → modules/go/theory/GOROUTINES_CHANNELS.md
- channel (buffered/unbuffered, send/receive/close/range) → modules/go/theory/GOROUTINES_CHANNELS.md
- select (default, nil-channel) → modules/go/theory/GOROUTINES_CHANNELS.md
- runtime deadlock detection → modules/go/theory/GOROUTINES_CHANNELS.md
- CSP model → modules/go/theory/GOROUTINES_CHANNELS.md
- worker pool / fan-out / fan-in / pipeline → modules/go/theory/CONCURRENCY_PATTERNS.md
- bounded parallelism (semaphore channel) → modules/go/theory/CONCURRENCY_PATTERNS.md
- context.Context (cancellation/deadline/values) → modules/go/theory/CONCURRENCY_PATTERNS.md
- sync (WaitGroup/Mutex/RWMutex/Once/Cond/Map/Pool) → modules/go/theory/CONCURRENCY_PATTERNS.md
- sync/atomic → modules/go/theory/CONCURRENCY_PATTERNS.md
- errgroup (golang.org/x/sync) → modules/go/theory/CONCURRENCY_PATTERNS.md
- rate limiting (token bucket, time.Ticker) → modules/go/theory/CONCURRENCY_PATTERNS.md
- goroutine leak → modules/go/theory/CONCURRENCY_PATTERNS.md

### Runtime (Scheduler, Memory, GC)
- GMP scheduler (Goroutine/Machine/Processor) → modules/go/theory/SCHEDULER.md
- work-stealing (Go runtime) → modules/go/theory/SCHEDULER.md
- goroutine preemption (cooperative/async) → modules/go/theory/SCHEDULER.md
- netpoller / sysmon / hand-off P → modules/go/theory/SCHEDULER.md
- GOMAXPROCS → modules/go/theory/SCHEDULER.md
- Go memory model (happens-before в Go) → modules/go/theory/MEMORY_GC.md
- data race detector (-race / TSan) → modules/go/theory/MEMORY_GC.md
- escape analysis (Go) → modules/go/theory/MEMORY_GC.md
- goroutine stack growth → modules/go/theory/MEMORY_GC.md
- Go GC (concurrent tri-color, non-moving) → modules/go/theory/MEMORY_GC.md
- GOGC / GOMEMLIMIT / pacer → modules/go/theory/MEMORY_GC.md

### Generics
- type parameters / generics (Go 1.18) → modules/go/theory/GENERICS.md
- constraints (any / comparable / type sets / ~T / unions) → modules/go/theory/GENERICS.md
- cmp.Ordered / x/exp/constraints → modules/go/theory/GENERICS.md
- no parameterized methods (Go) → modules/go/theory/GENERICS.md
- GC shape stenciling + dictionaries → modules/go/theory/GENERICS.md
- type inference (Go generics) → modules/go/theory/GENERICS.md

### Stdlib, HTTP, Testing
- io.Reader/Writer/Closer (composition, TeeReader, MultiWriter) → modules/go/theory/STDLIB_CORE.md
- bufio / os / fmt verbs / strconv / strings.Builder / bytes.Buffer → modules/go/theory/STDLIB_CORE.md
- time (Duration, layout 2006, Timer/Ticker, monotonic) → modules/go/theory/STDLIB_CORE.md
- sort / slices / maps → modules/go/theory/STDLIB_CORE.md
- encoding/json (struct tags, omitempty, Encoder/Decoder, custom Marshal) → modules/go/theory/STDLIB_CORE.md
- net/http server (Handler, HandlerFunc, ServeMux, timeouts) → modules/go/theory/NET_HTTP.md
- net/http routing 1.22 (method+pattern, wildcards, PathValue) → modules/go/theory/NET_HTTP.md
- net/http middleware (func(Handler) Handler chain) → modules/go/theory/NET_HTTP.md
- net/http client (Client/Transport, resp.Body close, timeouts) → modules/go/theory/NET_HTTP.md
- graceful shutdown (signal.NotifyContext, Server.Shutdown) → modules/go/theory/NET_HTTP.md
- table-driven tests / t.Run subtests / t.Parallel → modules/go/theory/TESTING_GO.md
- Go benchmarks (b.N, benchstat, sink) → modules/go/theory/TESTING_GO.md
- Go fuzzing (f.Fuzz) / testable examples (// Output:) → modules/go/theory/TESTING_GO.md
- net/http/httptest → modules/go/theory/TESTING_GO.md

### Idioms & Performance
- naming conventions (MixedCaps, -er, getters без Get) → modules/go/theory/IDIOMS_PATTERNS.md
- Go Proverbs → modules/go/theory/IDIOMS_PATTERNS.md
- functional options pattern → modules/go/theory/IDIOMS_PATTERNS.md
- make the zero value useful → modules/go/theory/IDIOMS_PATTERNS.md
- package design (internal/, doc.go, API minimalism) → modules/go/theory/IDIOMS_PATTERNS.md
- iota enums + Stringer / go generate → modules/go/theory/IDIOMS_PATTERNS.md
- pprof (CPU/heap/goroutine/block/mutex) → modules/go/theory/PERFORMANCE_PROFILING.md
- benchmarking / benchstat / sink → modules/go/theory/PERFORMANCE_PROFILING.md
- escape analysis (-gcflags=-m practical) → modules/go/theory/PERFORMANCE_PROFILING.md
- sync.Pool / allocation reduction → modules/go/theory/PERFORMANCE_PROFILING.md
- go tool trace (execution tracer) → modules/go/theory/PERFORMANCE_PROFILING.md
- GODEBUG / runtime/metrics → modules/go/theory/PERFORMANCE_PROFILING.md
- goroutine/memory leak diagnostics → modules/go/theory/PERFORMANCE_PROFILING.md

## Design Patterns (GoF)

- GoF pattern taxonomy (creational/structural/behavioral) → modules/design-patterns/theory/INTRO.md
- UML for patterns (class + sequence, association/aggregation/composition/inheritance/realization) → modules/design-patterns/theory/INTRO.md
- GoF principles (program to interface, favor composition over inheritance, encapsulate what varies) → modules/design-patterns/theory/INTRO.md
- GRASP responsibilities (Information Expert, Creator, Controller, Low Coupling, High Cohesion, Polymorphism, Pure Fabrication, Indirection, Protected Variations) → modules/design-patterns/theory/INTRO.md
- when a pattern is warranted / over-engineering criterion → modules/design-patterns/theory/INTRO.md
- Factory Method → modules/design-patterns/theory/CREATIONAL.md
- Abstract Factory → modules/design-patterns/theory/CREATIONAL.md
- Builder (fluent, validation in build(), vs static factory) → modules/design-patterns/theory/CREATIONAL.md
- Prototype (clone vs copy constructor) → modules/design-patterns/theory/CREATIONAL.md
- Singleton (pattern; eager/holder/DCL+volatile/enum, serialization safety) → modules/design-patterns/theory/CREATIONAL.md
- Adapter (object vs class adapter) → modules/design-patterns/theory/STRUCTURAL.md
- Bridge (Abstraction/Implementor, two axes) → modules/design-patterns/theory/STRUCTURAL.md
- Composite (part-whole, transparent vs safe) → modules/design-patterns/theory/STRUCTURAL.md
- Decorator (dynamic responsibilities, java.io) → modules/design-patterns/theory/STRUCTURAL.md
- Facade → modules/design-patterns/theory/STRUCTURAL.md
- Flyweight (intrinsic/extrinsic state) → modules/design-patterns/theory/STRUCTURAL.md
- Proxy (virtual/protection/remote/smart) → modules/design-patterns/theory/STRUCTURAL.md
- Strategy → modules/design-patterns/theory/BEHAVIORAL_1.md
- State (state machine) → modules/design-patterns/theory/BEHAVIORAL_1.md
- Template Method (hook methods, Hollywood principle) → modules/design-patterns/theory/BEHAVIORAL_1.md
- Chain of Responsibility → modules/design-patterns/theory/BEHAVIORAL_1.md
- Command (undo/redo, task queues) → modules/design-patterns/theory/BEHAVIORAL_2.md
- Observer (GoF subject/observer, push/pull) → modules/design-patterns/theory/BEHAVIORAL_2.md
- Mediator → modules/design-patterns/theory/BEHAVIORAL_2.md
- Memento → modules/design-patterns/theory/BEHAVIORAL_2.md
- Iterator (GoF pattern, external vs internal iteration) → modules/design-patterns/theory/BEHAVIORAL_3.md
- Visitor (double dispatch, expression problem) → modules/design-patterns/theory/BEHAVIORAL_3.md
- Interpreter (grammar/AST) → modules/design-patterns/theory/BEHAVIORAL_3.md
- pattern selection / pairwise comparisons (Strategy vs State, Adapter vs Bridge vs Proxy vs Decorator, Factory vs Builder) → modules/design-patterns/theory/COMPARISONS.md
- OOP/design anti-patterns (God Object, anemic domain model, poltergeist, golden hammer, over-engineering/patternitis) → modules/design-patterns/theory/ANTIPATTERNS.md
- code smells (Fowler: long method, feature envy, primitive obsession, shotgun surgery, divergent change) → modules/design-patterns/theory/ANTIPATTERNS.md
- Singleton as global mutable state (anti-pattern) → modules/design-patterns/theory/ANTIPATTERNS.md

## Domain-Driven Design (DDD)

### Введение
- DDD (essential vs accidental complexity) → modules/ddd/theory/INTRO.md
- strategic vs tactical DDD → modules/ddd/theory/INTRO.md
- when DDD is worth it / over-engineering criterion → modules/ddd/theory/INTRO.md
- DDD-lite (minimal viable DDD) → modules/ddd/theory/INTRO.md

### Стратегическое проектирование
- subdomains (Core / Supporting / Generic) → modules/ddd/theory/STRATEGIC_DESIGN.md
- Ubiquitous Language → modules/ddd/theory/STRATEGIC_DESIGN.md
- Bounded Context → modules/ddd/theory/STRATEGIC_DESIGN.md
- Context Map (9 relationship patterns) → modules/ddd/theory/STRATEGIC_DESIGN.md
- Shared Kernel → modules/ddd/theory/STRATEGIC_DESIGN.md
- Open Host Service (OHS) → modules/ddd/theory/STRATEGIC_DESIGN.md
- Published Language → modules/ddd/theory/STRATEGIC_DESIGN.md
- Anticorruption Layer (ACL) → modules/ddd/theory/STRATEGIC_DESIGN.md
- Partnership / Customer–Supplier / Conformist / Separate Ways / Big Ball of Mud → modules/ddd/theory/STRATEGIC_DESIGN.md

### Discovery
- Event Storming (Big Picture / Process / Design level) → modules/ddd/theory/EVENT_STORMING.md
- Event Storming color grammar → modules/ddd/theory/EVENT_STORMING.md
- pivotal events / swimlanes → modules/ddd/theory/EVENT_STORMING.md
- Domain Storytelling → modules/ddd/theory/EVENT_STORMING.md
- Example Mapping → modules/ddd/theory/EVENT_STORMING.md
- Bounded Context Canvas → modules/ddd/theory/EVENT_STORMING.md

### Тактические паттерны
- Value Object (DDD) → modules/ddd/theory/TACTICAL_PATTERNS.md
- Entity (DDD) → modules/ddd/theory/TACTICAL_PATTERNS.md
- Domain Event → modules/ddd/theory/TACTICAL_PATTERNS.md
- Repository (DDD, aggregate collection) → modules/ddd/theory/TACTICAL_PATTERNS.md
- Factory (DDD, aggregate assembly) → modules/ddd/theory/TACTICAL_PATTERNS.md
- Domain Service → modules/ddd/theory/TACTICAL_PATTERNS.md
- Application Service (use case) → modules/ddd/theory/TACTICAL_PATTERNS.md
- Command (DDD) → modules/ddd/theory/TACTICAL_PATTERNS.md
- Specification pattern → modules/ddd/theory/TACTICAL_PATTERNS.md
- Policy (domain Strategy) → modules/ddd/theory/TACTICAL_PATTERNS.md
- Module (package-by-feature) → modules/ddd/theory/TACTICAL_PATTERNS.md

### Проектирование агрегатов
- Aggregate / Aggregate Root → modules/ddd/theory/AGGREGATE_DESIGN.md
- Vernon's four aggregate rules → modules/ddd/theory/AGGREGATE_DESIGN.md
- consistency boundary (transactional vs eventual) → modules/ddd/theory/AGGREGATE_DESIGN.md
- one-aggregate-per-transaction rule → modules/ddd/theory/AGGREGATE_DESIGN.md
- reference by identity → modules/ddd/theory/AGGREGATE_DESIGN.md
- set-based validation (cross-aggregate uniqueness) → modules/ddd/theory/AGGREGATE_DESIGN.md
- aggregate size / choosing the root → modules/ddd/theory/AGGREGATE_DESIGN.md
- optimistic concurrency by aggregate version → modules/ddd/theory/AGGREGATE_DESIGN.md

### Архитектура
- Hexagonal Architecture (Ports & Adapters) → modules/ddd/theory/ARCHITECTURE.md
- Onion Architecture → modules/ddd/theory/ARCHITECTURE.md
- Clean Architecture → modules/ddd/theory/ARCHITECTURE.md
- driving vs driven adapters → modules/ddd/theory/ARCHITECTURE.md
- Composition Root → modules/ddd/theory/ARCHITECTURE.md
- dependency inversion (architectural) → modules/ddd/theory/ARCHITECTURE.md
- DDD & microservices (BC ↔ service, database-per-service, modular monolith) → modules/ddd/theory/ARCHITECTURE.md

### Интеграция контекстов
- Domain Event vs Integration Event → modules/ddd/theory/INTEGRATION_PATTERNS.md
- event translator (domain → contract) → modules/ddd/theory/INTEGRATION_PATTERNS.md
- eventual consistency between contexts (DDD framing) → modules/ddd/theory/INTEGRATION_PATTERNS.md
- (Outbox / Saga / CQRS / Event Sourcing — mechanics owned by system-design/microservice_patterns.md; DDD framing here)

### Функциональный DDD
- make illegal states unrepresentable → modules/ddd/theory/FUNCTIONAL_DDD.md
- algebraic data types (domain modeling: product/sum) → modules/ddd/theory/FUNCTIONAL_DDD.md
- functional core / imperative shell → modules/ddd/theory/FUNCTIONAL_DDD.md
- decide / evolve → modules/ddd/theory/FUNCTIONAL_DDD.md
- parse don't validate / smart constructor → modules/ddd/theory/FUNCTIONAL_DDD.md
- Result / Either for domain errors → modules/ddd/theory/FUNCTIONAL_DDD.md
- railway-oriented programming → modules/ddd/theory/FUNCTIONAL_DDD.md

### Supple Design
- supple design → modules/ddd/theory/SUPPLE_DESIGN.md
- intention-revealing interfaces → modules/ddd/theory/SUPPLE_DESIGN.md
- side-effect-free functions / assertions → modules/ddd/theory/SUPPLE_DESIGN.md
- closure of operations → modules/ddd/theory/SUPPLE_DESIGN.md
- conceptual contours / standalone classes → modules/ddd/theory/SUPPLE_DESIGN.md
- knowledge crunching → modules/ddd/theory/SUPPLE_DESIGN.md
- model exploration whirlpool → modules/ddd/theory/SUPPLE_DESIGN.md
- refactoring toward deeper insight / breakthrough → modules/ddd/theory/SUPPLE_DESIGN.md
- distillation / Segregated Core → modules/ddd/theory/SUPPLE_DESIGN.md

### Антипаттерны (DDD-specific)
- anemic domain model (DDD deep treatment) → modules/ddd/theory/ANTIPATTERNS.md
- God Aggregate → modules/ddd/theory/ANTIPATTERNS.md
- bypassing the aggregate root → modules/ddd/theory/ANTIPATTERNS.md
- Repository-per-table (DAO thinking) → modules/ddd/theory/ANTIPATTERNS.md
- domain model leakage (outward) → modules/ddd/theory/ANTIPATTERNS.md
- infrastructure leakage (inward) → modules/ddd/theory/ANTIPATTERNS.md
- bloated Shared Kernel → modules/ddd/theory/ANTIPATTERNS.md
- DDD-for-DDD's-sake / over-modeling → modules/ddd/theory/ANTIPATTERNS.md

---

## Disambiguated Concepts

Concepts that legitimately appear in multiple modules — canonical owner listed first:

| Concept | Canonical Owner | Secondary Reference |
|---------|----------------|---------------------|
| N+1 problem (canonical theory) | databases/DATABASE_TYPES.md | hibernate-jpa/FETCHING_NPLUS1.md (Hibernate impl) · graphql-kotlin/DATALOADER_NPLUS1.md (GraphQL context) · spring-frameworks/SPRING_DATA_JPA.md (Spring Data EntityGraph) |
| LazyInitializationException | hibernate-jpa/FETCHING_NPLUS1.md (mechanism + fixes) | databases/DATABASE_TYPES.md (brief mention) |
| Hibernate L1/L2/Query cache | hibernate-jpa/CACHING.md (levels, concurrency strategies, providers) | spring-frameworks/SPRING_DATA_JPA.md (Spring integration, vs Spring Cache) |
| optimistic / pessimistic locking | hibernate-jpa/TRANSACTIONS_LOCKING.md (JPA @Version / LockModeType) | databases/TRANSACTIONS.md (DB-level isolation, FOR UPDATE / SKIP LOCKED) |
| Identity Map / Unit of Work | databases/DATABASE_TYPES.md (ORM patterns) | hibernate-jpa/ENTITY_LIFECYCLE.md (persistence context realization) |
| @Transactional | spring-frameworks/SPRING_DATA_JPA.md (Spring AOP, propagation) | hibernate-jpa/TRANSACTIONS_LOCKING.md (JPA EntityTransaction model) |
| equals/hashCode | java-core/EQUALS_HASHCODE_COMPARABLE.md (general Java contract) | hibernate-jpa/ENTITY_IDENTITY_EQUALS.md (entity identity, proxy-safe, business key) · hibernate-jpa/COMPOSITE_KEYS.md (composite id class) |
| write-behind | caching-deep-dive/CACHE_PATTERNS.md (cache write pattern) | hibernate-jpa/ENTITY_LIFECYCLE.md (Hibernate flush strategy) |
| OAuth2 | system-design/identity_providers.md (protocol) | spring-frameworks/SPRING_SECURITY.md (implementation) |
| Circuit Breaker | system-design/microservice_patterns.md (pattern) | spring-frameworks/SPRING_CLOUD.md (Resilience4j impl) |
| CDC | databases/REPLICATION.md (DB perspective + Debezium) | caching-deep-dive/CONSISTENCY.md (cache invalidation) · system-design/microservice_patterns.md (Outbox alternative) |
| consistent hashing | caching-deep-dive/DISTRIBUTED_CACHING.md (cache distribution) | databases/SHARDING.md (DB sharding context) |
| Redis (deep) | caching-deep-dive/REDIS.md | databases/DATABASE_TYPES.md (high-level KV overview) |
| CoroutineScope vs coroutineScope | kotlin-coroutines/SCOPE_CONTEXT.md (interface type) | kotlin-coroutines/STRUCTURED_CONCURRENCY.md (builder function) |
| механика приостановки потока/корутины | concurrency/JUC_INTERNALS.md (AQS, park/unpark, поток ОС) | kotlin-coroutines/SUSPEND_INTERNALS.md (Continuation, CPS, кто возобновляет) |
| ограничение конкурентности | concurrency/SYNCHRONIZERS.md (Semaphore, j.u.c.) | kotlin-coroutines/BACKEND_PATTERNS.md (корутинный вариант) · system-design/RELIABILITY_PATTERNS.md (bulkhead как паттерн) |
| размер пула потоков / закон Литтла | concurrency/EXECUTORS_FUTURES.md (формула, ctl, очередь) | system-design/RELIABILITY_PATTERNS.md (адаптивные лимиты) |
| false sharing / строка кэша | concurrency/ATOMIC_CAS.md (замер, @Contended, Striped64) | caching-deep-dive (CPU-кэш как уровень иерархии) |
| Semaphore | concurrency/SYNCHRONIZERS.md (j.u.c., блокирующий) | kotlin-coroutines/SHARED_STATE.md (kotlinx.coroutines.sync, suspend) |
| взаимное исключение | concurrency/LOCKS.md (монитор, ReentrantLock) | kotlin-coroutines/SHARED_STATE.md (Mutex: почему не synchronized, нереентерабельность) |
| CompletableFuture | concurrency/ASYNC_COMPOSITION.md (устройство, цепочки, ловушки) | kotlin-coroutines/INTEROP.md (мост await/future/asDeferred) |
| exponential backoff + jitter | system-design/RELIABILITY_PATTERNS.md (рецепт, retry budget) | kotlin-coroutines/BACKEND_PATTERNS.md (корутинная реализация) |
| cache stampede / single-flight | caching-deep-dive/ANTI_PATTERNS.md (явление) | kotlin-coroutines/BACKEND_PATTERNS.md (single-flight на Mutex + CompletableDeferred) |
| Circuit Breaker | system-design/microservice_patterns.md (паттерн) | spring-frameworks/SPRING_CLOUD.md (Resilience4j) · kotlin-coroutines/BACKEND_PATTERNS.md (набросок + отличие от retry) |
| virtual threads | concurrency/VIRTUAL_THREADS.md (устройство, pinning, StructuredTaskScope) | kotlin-coroutines/DISPATCHERS.md (VT как диспетчер через asCoroutineDispatcher) |
| JMM | concurrency/MEMORY_MODEL.md (happens-before, volatile, публикация, гонки) | java-core/JMM_REFERENCE.md (cross-ref only) · concurrency/THREADS_BASICS.md (применение synchronized) |
| VarHandle | java-core/REFLECTION_HANDLES.md (API + access modes) | concurrency/ATOMIC_CAS.md (atomic operations использование) |
| ClassLoader leak | java-core/CLASS_LOADERS.md (mechanism + diagnostic) | spring-frameworks/SPRING_BOOT.md (DevTools hot-reload contexts) |
| lock elision / lock coarsening | java-core/JIT_COMPILATION.md (JIT optimization) | concurrency/LOCKS.md (synchronized semantics) |
| write barrier | java-core/GARBAGE_COLLECTION.md (GC card table / SATB) | (CPU memory barrier — отдельная тема, в concurrency не покрыта) |
| ByteBuffer (direct) / off-heap | java-core/JVM_MEMORY_AREAS.md (allocation model) | java-core/FOREIGN_MEMORY_VECTOR.md (modern replacement) |
| Reflection (perf cost) | java-core/REFLECTION_HANDLES.md | spring-frameworks/SPRING_CORE_DI.md (DI internals использование) |
| goroutines / M:N scheduler | go/SCHEDULER.md (GMP, netpoller, work-stealing) | concurrency/VIRTUAL_THREADS.md (JVM virtual threads, M:N model) |
| happens-before / memory model | concurrency/MEMORY_MODEL.md (JMM, general) | go/MEMORY_GC.md (Go memory model: channels/mutex/Once guarantees) |
| tri-color GC / write barrier | java-core/GARBAGE_COLLECTION.md (general invariant) | go/MEMORY_GC.md (Go concurrent non-moving impl, GOGC/GOMEMLIMIT) |
| generics implementation | java-core/GENERICS_ERASURE.md (Java type erasure) | go/GENERICS.md (GC-shape stenciling + dictionaries) |
| testing tooling | software-engineering/TESTING.md (pyramid, general philosophy) | go/TESTING_GO.md (testing pkg, table-driven, benchmarks, fuzzing) |
| HTTP (protocol vs stdlib) | system-design/http_networking.md (HTTP protocol) | go/NET_HTTP.md (Go net/http server/client/middleware) |
| data race / deadlock (Go tooling) | concurrency/PROBLEMS.md (general definitions) | go/MEMORY_GC.md (-race) · go/GOROUTINES_CHANNELS.md (runtime deadlock detection) |
| GoF Adapter pattern | design-patterns/STRUCTURAL.md (object vs class adapter, full pattern) | software-engineering/SOLID_OOP.md (ISP/Jackson illustration) |
| Singleton | design-patterns/CREATIONAL.md (pattern intent + thread-safe variants) | concurrency/THREADS_BASICS.md (DCL/volatile, publication) · java-core/SERIALIZATION.md (readResolve/enum) · design-patterns/ANTIPATTERNS.md (global mutable state) |
| Proxy (GoF vs framework) | design-patterns/STRUCTURAL.md (pattern: virtual/protection/remote) | spring-frameworks/SPRING_CORE_DI.md (AOP dynamic proxy) · hibernate-jpa/FETCHING_NPLUS1.md (lazy proxy) |
| Observer vs Reactive Streams | design-patterns/BEHAVIORAL_2.md (GoF Subject/Observer) | kotlin-coroutines/FLOW.md (Flow) · system-design/COMMUNICATION_PATTERNS.md (Reactive Streams, backpressure) |
| Flyweight vs String pool | design-patterns/STRUCTURAL.md (pattern: intrinsic/extrinsic) | java-core/STRING_INTERNALS.md (String pool, Integer cache impl) |
| anemic domain model | design-patterns/ANTIPATTERNS.md (OOP smell listing) | ddd/ANTIPATTERNS.md (DDD deep: rich model, invariants in aggregate, when acceptable) |
| Factory (GoF vs DDD) | design-patterns/CREATIONAL.md (Factory Method / Abstract Factory) | ddd/TACTICAL_PATTERNS.md (DDD factory: encapsulate aggregate assembly) |
| Repository | ddd/TACTICAL_PATTERNS.md (collection abstraction over aggregates) | databases/DATABASE_TYPES.md (Data Mapper / Identity Map / Unit of Work) · hibernate-jpa/JPA_VS_HIBERNATE.md (impl) |
| Primitive Obsession | design-patterns/ANTIPATTERNS.md (Fowler code smell) | ddd/TACTICAL_PATTERNS.md (typed IDs / Value Object as the fix) |
| Strategy vs domain Policy | design-patterns/BEHAVIORAL_1.md (GoF Strategy) | ddd/TACTICAL_PATTERNS.md (domain Policy framing) |
| Outbox / Saga / CQRS / Event Sourcing | system-design/microservice_patterns.md (distributed-systems mechanics) | ddd/INTEGRATION_PATTERNS.md (DDD modeling framing: aggregate boundary → events) |
| Hexagonal / Ports & Adapters | ddd/ARCHITECTURE.md (ports/adapters, Composition Root) | (Onion / Clean — same idea, same file) |
| functional core / FP basics | software-engineering/STREAM_API_FP.md (pure functions, immutability, HOF) | ddd/FUNCTIONAL_DDD.md (illegal-states-unrepresentable, ADT domain modeling, decide/evolve) |
