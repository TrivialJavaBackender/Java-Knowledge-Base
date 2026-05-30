# Global Concept Index

Canonical concept → owner file map. One concept, one owner. Other modules must link, not redefine.

## Concurrency

- JMM → modules/concurrency/theory/THREADS_BASICS.md
- happens-before → modules/concurrency/theory/THREADS_BASICS.md
- volatile → modules/concurrency/theory/THREADS_BASICS.md
- synchronized → modules/concurrency/theory/THREADS_BASICS.md
- wait/notify → modules/concurrency/theory/THREADS_BASICS.md
- thread lifecycle → modules/concurrency/theory/THREADS_BASICS.md
- ReentrantLock → modules/concurrency/theory/LOCKS.md
- ReadWriteLock → modules/concurrency/theory/LOCKS.md
- StampedLock → modules/concurrency/theory/LOCKS.md
- Condition → modules/concurrency/theory/LOCKS.md
- lock pinning (virtual threads) → modules/concurrency/theory/LOCKS.md
- CAS (Compare-And-Swap) → modules/concurrency/theory/ATOMIC_CAS.md
- AtomicInteger / AtomicReference → modules/concurrency/theory/ATOMIC_CAS.md
- ABA problem → modules/concurrency/theory/ATOMIC_CAS.md
- lock-free concurrency → modules/concurrency/theory/ATOMIC_CAS.md
- ConcurrentHashMap → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- BlockingQueue → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- CopyOnWriteArrayList → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- ConcurrentSkipListMap → modules/concurrency/theory/CONCURRENT_COLLECTIONS.md
- CountDownLatch → modules/concurrency/theory/SYNCHRONIZERS.md
- CyclicBarrier → modules/concurrency/theory/SYNCHRONIZERS.md
- Semaphore → modules/concurrency/theory/SYNCHRONIZERS.md
- Phaser → modules/concurrency/theory/SYNCHRONIZERS.md
- Exchanger → modules/concurrency/theory/SYNCHRONIZERS.md
- ThreadPoolExecutor → modules/concurrency/theory/EXECUTORS_FUTURES.md
- FixedThreadPool / CachedThreadPool → modules/concurrency/theory/EXECUTORS_FUTURES.md
- CompletableFuture → modules/concurrency/theory/EXECUTORS_FUTURES.md
- ForkJoinPool → modules/concurrency/theory/EXECUTORS_FUTURES.md
- work-stealing → modules/concurrency/theory/EXECUTORS_FUTURES.md
- deadlock → modules/concurrency/theory/PROBLEMS.md
- livelock → modules/concurrency/theory/PROBLEMS.md
- starvation → modules/concurrency/theory/PROBLEMS.md
- race condition → modules/concurrency/theory/PROBLEMS.md
- Coffman conditions → modules/concurrency/theory/PROBLEMS.md
- virtual threads → modules/concurrency/theory/VIRTUAL_THREADS.md
- platform threads → modules/concurrency/theory/VIRTUAL_THREADS.md
- M:N threading model → modules/concurrency/theory/VIRTUAL_THREADS.md
- StructuredTaskScope → modules/concurrency/theory/VIRTUAL_THREADS.md

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
| JMM | concurrency/THREADS_BASICS.md (happens-before, volatile, synchronized) | java-core/JMM_REFERENCE.md (cross-ref only) |
| VarHandle | java-core/REFLECTION_HANDLES.md (API + access modes) | concurrency/ATOMIC_CAS.md (atomic operations использование) |
| ClassLoader leak | java-core/CLASS_LOADERS.md (mechanism + diagnostic) | spring-frameworks/SPRING_BOOT.md (DevTools hot-reload contexts) |
| lock elision / lock coarsening | java-core/JIT_COMPILATION.md (JIT optimization) | concurrency/LOCKS.md (synchronized semantics) |
| write barrier | java-core/GARBAGE_COLLECTION.md (GC card table / SATB) | (CPU memory barrier — отдельная тема, в concurrency не покрыта) |
| ByteBuffer (direct) / off-heap | java-core/JVM_MEMORY_AREAS.md (allocation model) | java-core/FOREIGN_MEMORY_VECTOR.md (modern replacement) |
| Reflection (perf cost) | java-core/REFLECTION_HANDLES.md | spring-frameworks/SPRING_CORE_DI.md (DI internals использование) |
