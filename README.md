# Interview Prep

Подготовка к backend-собеседованиям. Четыре модуля — теория, упражнения, вопросы.

---

## Модули

| | Модуль | Роадмап | Вопросы |
|---|--------|---------|---------|
| ⚙️ | [Concurrency](modules/concurrency/README.md) | [ROADMAP](modules/concurrency/ROADMAP.md) | [32 вопроса](modules/concurrency/INTERVIEW_QUESTIONS.md) |
| 🏗️ | [System Design](modules/system-design/README.md) | [ROADMAP](modules/system-design/ROADMAP.md) | [25 вопросов](modules/system-design/INTERVIEW_QUESTIONS.md) |
| 🐳 | [Infrastructure](modules/infrastructure/README.md) | [ROADMAP](modules/infrastructure/ROADMAP.md) | [36 вопросов](modules/infrastructure/INTERVIEW_QUESTIONS.md) |
| 🍃 | [Spring Frameworks](modules/spring-frameworks/README.md) | [ROADMAP](modules/spring-frameworks/ROADMAP.md) | [17 вопросов](modules/spring-frameworks/INTERVIEW_QUESTIONS.md) |

---

## ⚙️ Concurrency

**[→ README](modules/concurrency/README.md) · [ROADMAP](modules/concurrency/ROADMAP.md) · [Вопросы](modules/concurrency/INTERVIEW_QUESTIONS.md)**

### Теория

| Модуль | Файл |
|--------|------|
| 0. Зачем конкурентность | [WHY_CONCURRENCY.md](modules/concurrency/theory/WHY_CONCURRENCY.md) |
| 1. Основы потоков | [THREADS_BASICS.md](modules/concurrency/theory/THREADS_BASICS.md) |
| 2. Модель памяти | [MEMORY_MODEL.md](modules/concurrency/theory/MEMORY_MODEL.md) |
| 3. Внутренности j.u.c. | [JUC_INTERNALS.md](modules/concurrency/theory/JUC_INTERNALS.md) |
| 4. Locks | [LOCKS.md](modules/concurrency/theory/LOCKS.md) |
| 5. Atomic / CAS | [ATOMIC_CAS.md](modules/concurrency/theory/ATOMIC_CAS.md) |
| 6. Concurrent Collections | [CONCURRENT_COLLECTIONS.md](modules/concurrency/theory/CONCURRENT_COLLECTIONS.md) |
| 7. Synchronizers | [SYNCHRONIZERS.md](modules/concurrency/theory/SYNCHRONIZERS.md) |
| 8. Пулы потоков | [EXECUTORS_FUTURES.md](modules/concurrency/theory/EXECUTORS_FUTURES.md) |
| 9. CompletableFuture | [ASYNC_COMPOSITION.md](modules/concurrency/theory/ASYNC_COMPOSITION.md) |
| 10. Проблемы и диагностика | [PROBLEMS.md](modules/concurrency/theory/PROBLEMS.md) |
| 11. Virtual Threads | [VIRTUAL_THREADS.md](modules/concurrency/theory/VIRTUAL_THREADS.md) |

### Упражнения (Kotlin)

| # | Файл | Тема |
|---|------|------|
| 01 | [Ex01_ThreadBasics.kt](modules/concurrency/src/main/kotlin/exercises/Ex01_ThreadBasics.kt) | Потоки, synchronized, wait/notify |
| 02 | [Ex02_ProducerConsumer.kt](modules/concurrency/src/main/kotlin/exercises/Ex02_ProducerConsumer.kt) | Bounded buffer, wait/notify |
| 03 | [Ex03_ReentrantLockCache.kt](modules/concurrency/src/main/kotlin/exercises/Ex03_ReentrantLockCache.kt) | ReentrantLock, Condition, LRU-кэш |
| 04 | [Ex04_ReadWriteLock.kt](modules/concurrency/src/main/kotlin/exercises/Ex04_ReadWriteLock.kt) | MetricsStore, lock downgrade |
| 05 | [Ex05_AtomicCounter.kt](modules/concurrency/src/main/kotlin/exercises/Ex05_AtomicCounter.kt) | CAS, Treiber Stack, LongAdder |
| 06 | [Ex06_ConcurrentMapWordCount.kt](modules/concurrency/src/main/kotlin/exercises/Ex06_ConcurrentMapWordCount.kt) | CHM merge, COWAL event bus |
| 07 | [Ex07_BlockingQueuePipeline.kt](modules/concurrency/src/main/kotlin/exercises/Ex07_BlockingQueuePipeline.kt) | Pipeline, poison pill |
| 08 | [Ex08_CompletableFutureChain.kt](modules/concurrency/src/main/kotlin/exercises/Ex08_CompletableFutureChain.kt) | CF цепочки, allOf, anyOf |
| 09 | [Ex09_ForkJoinMergeSort.kt](modules/concurrency/src/main/kotlin/exercises/Ex09_ForkJoinMergeSort.kt) | ForkJoinPool, RecursiveTask |
| 10 | [Ex10_Synchronizers.kt](modules/concurrency/src/main/kotlin/exercises/Ex10_Synchronizers.kt) | Latch, Barrier, Semaphore, Exchanger |
| 11 | [Ex11_DeadlockDetection.kt](modules/concurrency/src/main/kotlin/exercises/Ex11_DeadlockDetection.kt) | Deadlock, ThreadMXBean |
| 12 | [Ex12_VirtualThreads.kt](modules/concurrency/src/main/kotlin/exercises/Ex12_VirtualThreads.kt) | Virtual Threads, pinning |
| 13 | [Ex13_ConcurrentHashMapAdvanced.kt](modules/concurrency/src/main/kotlin/exercises/Ex13_ConcurrentHashMapAdvanced.kt) | computeIfAbsent, merge, bulk ops |
| 14 | [Ex14_BlockingQueuesDeep.kt](modules/concurrency/src/main/kotlin/exercises/Ex14_BlockingQueuesDeep.kt) | SynchronousQ, PriorityBQ, DelayQ |
| 15 | [Ex15_ConcurrentSkipListAndSets.kt](modules/concurrency/src/main/kotlin/exercises/Ex15_ConcurrentSkipListAndSets.kt) | SkipListMap, newKeySet, COWAS |
| 16 | [Ex16_ExecutorServiceDeep.kt](modules/concurrency/src/main/kotlin/exercises/Ex16_ExecutorServiceDeep.kt) | Все виды пулов, rejection policies |
| 17 | [Ex17_CompletableFutureAdvanced.kt](modules/concurrency/src/main/kotlin/exercises/Ex17_CompletableFutureAdvanced.kt) | thenCombine, retry, timeout |
| 18 | [Ex18_ScheduledExecutorAndForkJoin.kt](modules/concurrency/src/main/kotlin/exercises/Ex18_ScheduledExecutorAndForkJoin.kt) | Rate limiter, map-reduce |

---

## 🏗️ System Design

**[→ README](modules/system-design/README.md) · [ROADMAP](modules/system-design/ROADMAP.md) · [Вопросы](modules/system-design/INTERVIEW_QUESTIONS.md)**

### Теория

| Файл | Тема |
|------|------|
| [database_transactions.md](modules/system-design/theory/database_transactions.md) | ACID, транзакции, изоляция, аномалии, savepoints, MVCC |
| [database_indexes.md](modules/system-design/theory/database_indexes.md) | B-Tree, GIN, pg_trgm, EXPLAIN ANALYZE |
| [databases_types.md](modules/system-design/theory/databases_types.md) | Типы БД, NoSQL, OLAP, Redis, ORM (Identity Map, Unit of Work) |
| [distributed_systems.md](modules/system-design/theory/distributed_systems.md) | CAP, консистентность, шардинг, репликация |
| [microservice_patterns.md](modules/system-design/theory/microservice_patterns.md) | Saga, Outbox, Circuit Breaker, sync vs async, деплой стратегии |
| [kafka.md](modules/system-design/theory/kafka.md) | Kafka: гарантии доставки, порядок, exactly-once, HA/ISR |
| [solid_oop.md](modules/system-design/theory/solid_oop.md) | SOLID, DIP + Jackson Adapter, Event Sourcing schema evolution |
| [http_networking.md](modules/system-design/theory/http_networking.md) | HTTP 1.1/2.0, кэш, REST vs WS, шифрование, IPv4/IPv6 |
| [stream_api.md](modules/system-design/theory/stream_api.md) | Stream API, functional interfaces, Optional, parallel streams |
| [auth_security.md](modules/system-design/theory/auth_security.md) | JWT, OAuth2 (Spring Security → см. spring-frameworks) |
| [testing.md](modules/system-design/theory/testing.md) | Пирамида тестов, JUnit, Mockito, performance, security, chaos |

### Упражнения (Java)

| Пакет | Файл | Тема |
|-------|------|------|
| reservations | [ReservationService.java](modules/system-design/src/main/java/by/pavel/reservations/ReservationService.java) | Pessimistic locking, TOCTOU |
| bank | [BankServiceImpl.java](modules/system-design/src/main/java/by/pavel/bank/BankServiceImpl.java) | Optimistic locking, idempotency |
| cache | [LRUCache.java](modules/system-design/src/main/java/by/pavel/cache/LRUCache.java) | Thread-safe LRU cache |
| orderbook | [OrderBookService.java](modules/system-design/src/main/java/by/pavel/orderbook/OrderBookService.java) | Concurrent order book |
| scheduler | [SimpleTaskScheduler.java](modules/system-design/src/main/java/by/pavel/scheduler/SimpleTaskScheduler.java) | ScheduledExecutorService |
| ratelimiter | [TokenBucketRateLimiter.java](modules/system-design/src/main/java/by/pavel/ratelimiter/TokenBucketRateLimiter.java) | Token bucket |

---

## 🐳 Infrastructure

**[→ README](modules/infrastructure/README.md) · [ROADMAP](modules/infrastructure/ROADMAP.md) · [Вопросы](modules/infrastructure/INTERVIEW_QUESTIONS.md)**

### Теория

| Файл | Тема |
|------|------|
| [DOCKER.md](modules/infrastructure/theory/DOCKER.md) | Dockerfile, multi-stage, compose, networking |
| [KUBERNETES.md](modules/infrastructure/theory/KUBERNETES.md) | Pod, Deployment, Services, HPA, probes |
| [HELM.md](modules/infrastructure/theory/HELM.md) | Charts, values, hooks, conditionals |
| [OBSERVABILITY.md](modules/infrastructure/theory/OBSERVABILITY.md) | Logs, metrics, traces — три столпа |
| [LOGGING.md](modules/infrastructure/theory/LOGGING.md) | Logback JSON, MDC, correlation ID |
| [METRICS.md](modules/infrastructure/theory/METRICS.md) | Micrometer, Prometheus, PromQL, Grafana |
| [CLOUD.md](modules/infrastructure/theory/CLOUD.md) | Regions, AZ, self-hosted vs managed DB, cloud pros/cons |

### Упражнения

#### Docker
| # | Задача |
|---|--------|
| 01 | [Базовый Dockerfile](modules/infrastructure/exercises/docker/Ex01_SimpleDockerfile/TASK.md) |
| 02 | [Multi-stage build](modules/infrastructure/exercises/docker/Ex02_MultiStageDockerfile/TASK.md) |
| 03 | [docker-compose](modules/infrastructure/exercises/docker/Ex03_DockerCompose/TASK.md) |
| 04 | [Networking](modules/infrastructure/exercises/docker/Ex04_DockerNetworking/TASK.md) |
| 05 | [Volumes](modules/infrastructure/exercises/docker/Ex05_DockerVolumes/TASK.md) |
| 06 | [Оптимизация](modules/infrastructure/exercises/docker/Ex06_DockerOptimization/TASK.md) |
| 07 | [Security](modules/infrastructure/exercises/docker/Ex07_DockerSecurity/TASK.md) |

#### Kubernetes
| # | Задача |
|---|--------|
| 08 | [Pod и Deployment](modules/infrastructure/exercises/kubernetes/Ex08_PodAndDeployment/TASK.md) |
| 09 | [ConfigMap и Secret](modules/infrastructure/exercises/kubernetes/Ex09_ConfigMapsSecrets/TASK.md) |
| 10 | [Probes](modules/infrastructure/exercises/kubernetes/Ex10_Probes/TASK.md) |
| 11 | [HPA](modules/infrastructure/exercises/kubernetes/Ex11_HPA/TASK.md) |
| 12 | [Namespaces](modules/infrastructure/exercises/kubernetes/Ex12_Namespaces/TASK.md) |
| 13 | [Resource Limits](modules/infrastructure/exercises/kubernetes/Ex13_ResourceLimits/TASK.md) |
| 14 | [Services](modules/infrastructure/exercises/kubernetes/Ex14_Services/TASK.md) |

#### Helm
| # | Задача |
|---|--------|
| 15 | [Базовый chart](modules/infrastructure/exercises/helm/Ex15_BasicChart/TASK.md) |
| 16 | [Values и шаблоны](modules/infrastructure/exercises/helm/Ex16_ValuesAndTemplates/TASK.md) |
| 17 | [Helm hooks](modules/infrastructure/exercises/helm/Ex17_HelmHooks/TASK.md) |
| 18 | [Условная шаблонизация](modules/infrastructure/exercises/helm/Ex18_HelmConditionals/TASK.md) |

#### Logging
| # | Задача |
|---|--------|
| 19 | [Logback JSON](modules/infrastructure/exercises/logging/Ex19_LogbackJson/TASK.md) |
| 20 | [Correlation ID](modules/infrastructure/exercises/logging/Ex20_CorrelationId/TASK.md) |
| 21 | [Structured Logging](modules/infrastructure/exercises/logging/Ex21_StructuredLogging/TASK.md) |
| 22 | [MDC propagation](modules/infrastructure/exercises/logging/Ex22_MDCContext/TASK.md) |
| 23 | [Log levels](modules/infrastructure/exercises/logging/Ex23_LogLevels/TASK.md) |
| 24 | [Loki + Grafana](modules/infrastructure/exercises/logging/Ex24_LokiIntegration/TASK.md) |

#### Metrics
| # | Задача |
|---|--------|
| 25 | [Counter и Gauge](modules/infrastructure/exercises/metrics/Ex25_MicrometerCounterGauge/TASK.md) |
| 26 | [Histogram / p95 / p99](modules/infrastructure/exercises/metrics/Ex26_Histogram/TASK.md) |
| 27 | [Custom HealthIndicator](modules/infrastructure/exercises/metrics/Ex27_CustomEndpoint/TASK.md) |
| 28 | [Prometheus config](modules/infrastructure/exercises/metrics/Ex28_PrometheusConfig/TASK.md) |
| 29 | [Grafana dashboard](modules/infrastructure/exercises/metrics/Ex29_GrafanaDashboard/TASK.md) |
| 30 | [PromQL запросы](modules/infrastructure/exercises/metrics/Ex30_PromQL/TASK.md) |

---

## 🍃 Spring Frameworks

**[→ README](modules/spring-frameworks/README.md) · [ROADMAP](modules/spring-frameworks/ROADMAP.md) · [Вопросы](modules/spring-frameworks/INTERVIEW_QUESTIONS.md)**

### Теория

| Файл | Тема |
|------|------|
| [SPRING_CORE_DI.md](modules/spring-frameworks/theory/SPRING_CORE_DI.md) | IoC, DI, Bean Scopes, AOP (прокси, self-invocation), GoF паттерны |
| [SPRING_BOOT.md](modules/spring-frameworks/theory/SPRING_BOOT.md) | Starters, Auto-Configuration, @Conditional, Actuator, Profiles |
| [SPRING_MVC_REST.md](modules/spring-frameworks/theory/SPRING_MVC_REST.md) | DispatcherServlet, REST, Validation, Filters vs Interceptors, CORS |
| [SPRING_DATA_JPA.md](modules/spring-frameworks/theory/SPRING_DATA_JPA.md) | JPA, Hibernate кэши L1/L2/Query, N+1, @Transactional, Propagation |
| [SPRING_SECURITY.md](modules/spring-frameworks/theory/SPRING_SECURITY.md) | Filter Chain, аутентификация изнутри, JWT, Method Security, CSRF |
| [SPRING_CLOUD.md](modules/spring-frameworks/theory/SPRING_CLOUD.md) | Config, Eureka, Gateway, Feign, Circuit Breaker, Tracing |

### Смежные темы в других модулях

| Тема | Модуль |
|------|--------|
| JWT структура, OAuth2 потоки | [system-design/theory/auth_security.md](modules/system-design/theory/auth_security.md) |
| Circuit Breaker паттерн, Saga, Outbox | [system-design/theory/microservice_patterns.md](modules/system-design/theory/microservice_patterns.md) |
| Distributed Tracing, Observability | [infrastructure/theory/OBSERVABILITY.md](modules/infrastructure/theory/OBSERVABILITY.md) |
