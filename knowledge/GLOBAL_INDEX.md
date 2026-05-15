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

## System Design

- ACID → modules/system-design/theory/database_transactions.md
- isolation levels (READ COMMITTED / REPEATABLE READ / SERIALIZABLE) → modules/system-design/theory/database_transactions.md
- distributed transactions / 2PC → modules/system-design/theory/database_transactions.md
- B-tree index → modules/system-design/theory/database_indexes.md
- MVCC → modules/system-design/theory/database_indexes.md
- index-only scan → modules/system-design/theory/database_indexes.md
- RDBMS vs NoSQL → modules/system-design/theory/databases_types.md
- CAP theorem → modules/system-design/theory/distributed_systems.md
- distributed locks → modules/system-design/theory/distributed_systems.md
- Saga pattern → modules/system-design/theory/microservice_patterns.md
- Outbox pattern → modules/system-design/theory/microservice_patterns.md
- Circuit Breaker pattern → modules/system-design/theory/microservice_patterns.md
- Strangler Fig → modules/system-design/theory/microservice_patterns.md
- Kafka (topics/partitions/consumer groups) → modules/system-design/theory/kafka.md
- Kafka replication / ISR → modules/system-design/theory/kafka.md
- JWT → modules/system-design/theory/identity_providers.md
- OAuth2 (protocol concepts) → modules/system-design/theory/identity_providers.md
- OIDC (protocol concepts) → modules/system-design/theory/identity_providers.md
- SAML 2.0 → modules/system-design/theory/identity_providers.md
- Keycloak / IdP → modules/system-design/theory/identity_providers.md
- bcrypt / Argon2 (password hashing) → modules/system-design/theory/identity_providers.md
- Vault → modules/system-design/theory/secrets_management.md
- envelope encryption → modules/system-design/theory/secrets_management.md
- mTLS / TLS termination → modules/system-design/theory/secrets_management.md
- SOLID principles → modules/system-design/theory/solid_oop.md
- Stream API (Java) → modules/system-design/theory/stream_api.md
- testing pyramid (Unit/Integration/E2E) → modules/system-design/theory/testing.md
- HTTP/TCP/DNS fundamentals → modules/system-design/theory/http_networking.md
- event sourcing → modules/system-design/theory/microservice_patterns.md
- event store / snapshot (event sourcing) → modules/system-design/theory/microservice_patterns.md
- schema evolution → modules/system-design/theory/kafka.md
- backward / forward compatibility → modules/system-design/theory/kafka.md
- upcasting → modules/system-design/theory/kafka.md
- Schema Registry / Avro / Protobuf → modules/system-design/theory/kafka.md
- higher-order function (HOF) → modules/system-design/theory/stream_api.md
- first-class functions → modules/system-design/theory/stream_api.md
- referential transparency → modules/system-design/theory/stream_api.md
- currying / partial application → modules/system-design/theory/stream_api.md
- default method (Java) → modules/system-design/theory/stream_api.md
- tail recursion / TCO → modules/system-design/theory/stream_api.md

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
- Hibernate L1 cache (session) → modules/spring-frameworks/theory/SPRING_DATA_JPA.md
- Hibernate L2 cache (shared) → modules/spring-frameworks/theory/SPRING_DATA_JPA.md
- Hibernate Query cache → modules/spring-frameworks/theory/SPRING_DATA_JPA.md
- N+1 problem (JPA) → modules/spring-frameworks/theory/SPRING_DATA_JPA.md
- Spring Data repositories → modules/spring-frameworks/theory/SPRING_DATA_JPA.md
- Filter Chain (Spring Security) → modules/spring-frameworks/theory/SPRING_SECURITY.md
- SecurityContext → modules/spring-frameworks/theory/SPRING_SECURITY.md
- OAuth2 (Spring impl) → modules/spring-frameworks/theory/SPRING_SECURITY.md
- Method Security (@PreAuthorize) → modules/spring-frameworks/theory/SPRING_SECURITY.md
- Eureka → modules/spring-frameworks/theory/SPRING_CLOUD.md
- Spring Cloud Gateway → modules/spring-frameworks/theory/SPRING_CLOUD.md
- OpenFeign → modules/spring-frameworks/theory/SPRING_CLOUD.md
- Resilience4j Circuit Breaker (Spring) → modules/spring-frameworks/theory/SPRING_CLOUD.md
- Spring Cloud Config → modules/spring-frameworks/theory/SPRING_CLOUD.md

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
- Kubernetes control plane → modules/infrastructure/theory/KUBERNETES.md
- Pod / Deployment / Service / Ingress → modules/infrastructure/theory/KUBERNETES.md
- kubelet → modules/infrastructure/theory/KUBERNETES.md
- Helm chart / values / release → modules/infrastructure/theory/HELM.md
- Helm templating → modules/infrastructure/theory/HELM.md
- Observability (three pillars) → modules/infrastructure/theory/OBSERVABILITY.md
- distributed tracing → modules/infrastructure/theory/OBSERVABILITY.md
- trace context propagation → modules/infrastructure/theory/OBSERVABILITY.md
- Counter / Gauge / Histogram → modules/infrastructure/theory/METRICS.md
- Prometheus → modules/infrastructure/theory/METRICS.md
- structured logging (JSON) → modules/infrastructure/theory/LOGGING.md
- log aggregation → modules/infrastructure/theory/LOGGING.md
- cloud regions / availability zones → modules/infrastructure/theory/CLOUD.md

---

## Disambiguated Concepts

Concepts that legitimately appear in multiple modules — canonical owner listed first:

| Concept | Canonical Owner | Secondary Reference |
|---------|----------------|---------------------|
| N+1 problem | graphql-kotlin/DATALOADER_NPLUS1.md (GraphQL context) | spring-frameworks/SPRING_DATA_JPA.md (JPA context) |
| OAuth2 | system-design/identity_providers.md (protocol) | spring-frameworks/SPRING_SECURITY.md (implementation) |
| Circuit Breaker | system-design/microservice_patterns.md (pattern) | spring-frameworks/SPRING_CLOUD.md (Resilience4j impl) |
| CDC | caching-deep-dive/CONSISTENCY.md (cache invalidation) | system-design/distributed_systems.md (event streaming) |
| CoroutineScope vs coroutineScope | kotlin-coroutines/SCOPE_CONTEXT.md (interface type) | kotlin-coroutines/STRUCTURED_CONCURRENCY.md (builder function) |
