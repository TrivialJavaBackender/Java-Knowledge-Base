# Canonical Terms

Preferred terminology for this repository. Reuse these terms exactly to ensure consistent retrieval and avoid semantic drift.

## Preferred Terms

- **ARC** — Adaptive Replacement Cache (eviction policy)
- **ABA problem** — ABA problem in CAS-based lock-free algorithms
- **backpressure** — flow control mechanism in reactive/streaming pipelines
- **big key** — oversized Redis key that blocks the event loop
- **cache avalanche** — mass simultaneous expiry causing DB overload
- **cache breakdown** — single hot key expiry causing thundering herd on DB
- **cache hierarchy** — ordered levels: CPU cache → JVM heap → distributed cache → CDN
- **cache penetration** — queries for non-existent keys bypassing cache entirely
- **cache stampede** — concurrent cache miss causing parallel DB reads for same key
- **CAS** — Compare-And-Swap (atomic hardware instruction)
- **CDC** — Change Data Capture
- **consistent hashing** — ring-based key distribution minimizing remap on node changes
- **cooperative cancellation** — coroutine cancellation via isActive/ensureActive checks
- **CPS** — Continuation-Passing Style (coroutine compilation transform)
- **distributed caching** — caching layer shared across multiple service instances
- **double-write problem** — race between cache and DB writes causing inconsistency
- **happens-before** — JMM partial order defining visibility guarantees
- **hit ratio** — fraction of cache lookups served from cache (not DB)
- **hot key** — single cache key receiving disproportionate traffic
- **ISR** — In-Sync Replicas (Kafka replication)
- **JMM** — Java Memory Model
- **near-cache** — local in-process cache in front of a distributed cache
- **N+1 problem** — 1 list query + N item queries due to missing batching
- **read-through** — cache loads missing entries from DB automatically
- **refresh-ahead** — proactive background refresh before TTL expiry
- **rendezvous hashing** — highest-random-weight hashing (alternative to consistent hashing)
- **single-flight** — deduplicate concurrent identical requests (prevents stampede)
- **stale-while-revalidate** — serve stale data while refreshing in background
- **structured concurrency** — parent scope waits for all children; failures propagate
- **supervisorScope** — structured concurrency scope that isolates child failures
- **TTI** — Time-To-Idle (evict after inactivity)
- **TTL** — Time-To-Live (evict after fixed duration)
- **versioned keys** — cache keys with version suffix to enable instant invalidation
- **W-TinyLFU** — Window TinyLFU admission + frequency eviction policy (Caffeine default)
- **write-behind** — async delayed writes to DB after cache update (also: write-back)
- **write-through** — synchronous write to cache and DB together

### Infrastructure

- **reconciliation loop** — controller pattern: continually compare desired state (etcd) with actual state and apply diff
- **OOMKilled** — Linux kernel kills a process when its cgroup exceeds memory limit (status used in Kubernetes)
- **kube-proxy** — per-node component implementing Service abstraction (iptables / IPVS / eBPF modes)
- **kubelet** — per-node agent that reconciles Pod spec with running containers via CRI
- **CRI (Container Runtime Interface)** — gRPC API between kubelet and container runtime (containerd, CRI-O)
- **OCI (Open Container Initiative)** — standards body owning Image Spec and Runtime Spec; foundation for Docker/containerd/podman
- **distroless** — minimal container image containing only runtime + certs (no shell, no package manager)
- **OverlayFS** — Linux union filesystem used for Docker layered images (lowerdir/upperdir/workdir/merged)
- **BuildKit** — modern Docker builder with parallel stages, cache mounts, secret mounts, SBOM
- **PID 1 problem** — in containers PID 1 is special: doesn't get default signal handlers, doesn't reap zombies; solved by `tini` or `docker run --init`
- **scrape** — Prometheus pull operation; server periodically fetches `/metrics` from each target
- **cardinality bomb** — Prometheus OOM caused by high-cardinality labels (`user_id`, full URLs)
- **W3C TraceContext** — standardized HTTP header format for trace propagation (`traceparent`, `tracestate`)
- **head-based sampling** — tracing sampling decision made at trace start, in SDK
- **tail-based sampling** — tracing sampling decision made after full trace collected, in Collector
- **error budget** — `1 − SLO`; allowable failure rate before deploy freeze
- **burn rate alert** — multi-window multi-burn-rate alert detecting both sharp spikes and slow drains of error budget
- **exemplar** — side-channel annotation on Prometheus histogram bucket carrying a trace_id (Prometheus 2.26+)
- **wide event** — single rich event with 50+ fields per request; alternative to three-pillars decomposition (Honeycomb-style)
- **structured logging** — log records as JSON objects with named fields (not free-text strings)
- **MDC** — Mapped Diagnostic Context; thread-local map of contextual fields auto-injected into log records (SLF4J/Logback)
- **correlation ID** — business-level request identifier propagated through services (often `X-Request-ID`); distinct from technical `trace_id`
- **RPO** — Recovery Point Objective; how much data loss is acceptable
- **RTO** — Recovery Time Objective; how long the system can be down

### System Design

- **PACELC** — at Partition: Availability or Consistency? Else (normal): Latency or Consistency? (Abadi 2010, extends CAP)
- **HNSW** — Hierarchical Navigable Small World (ANN algorithm for vector search; default in many vector DBs)
- **HLL** — HyperLogLog (approximate count distinct in ~12 KB)
- **CMS** — Count-Min Sketch (approximate frequency estimation)
- **H3** — Uber's hexagonal hierarchical geospatial indexing (use H3 not "hex grid")
- **S2** — Google's spherical geometry library (use S2 not "S2 geometry")
- **W3C TraceContext** — already in Infrastructure section, used here too
- **fan-out on write** vs **fan-out on read** — feed generation strategies; не «push fanout» / «pull fanout»
- **retry storm** — cascading retries amplifying load (use this, не «retry cascade»)
- **hedged request** — duplicate request after p95 to reduce p99 (Tail at Scale, Dean & Barroso)
- **load shedding** — intentional request rejection under overload (use «load shedding» не «backpressure» — different concepts)
- **fencing token** — monotonic token preventing stale leader writes (NOT «epoch token»)
- **TrueTime** — Google Spanner's synchronized clocks API (capitalized)
- **MapReduce** — Google's batch processing paradigm (capitalize first M and R)
- **CRDT** — Conflict-free Replicated Data Type (use acronym in headings)
- **RAG** — Retrieval-Augmented Generation (use acronym, not «retrieval augmented»)
- **ANN** — Approximate Nearest Neighbor (in context of vector search)
- **idempotency key** — client-generated unique key для retry safety (use «idempotency key», NOT «request ID»)
- **Saga choreography vs orchestration** — pattern variants; не «event-driven saga» (too vague)

### Databases

- **MVCC** — Multi-Version Concurrency Control; tuple versioning via xmin/xmax
- **SSI** — Serializable Snapshot Isolation (PostgreSQL, Cahill 2008); detects rw-dependencies
- **write skew** — anomaly where individual transactions are correct but together violate invariant
- **LSM-tree** — Log-Structured Merge-tree (O'Neil 1996); memtable + SSTable + compaction
- **WAL** — Write-Ahead Log; durability + atomicity primitive
- **LCS / STCS / TWCS** — Leveled / Size-Tiered / Time-Window Compaction Strategy
- **read-your-writes** — consistency model: user sees own writes (one of Adya spectrum)
- **monotonic reads** — consistency: reads don't go back in time
- **hot key** — single cache key receiving disproportionate traffic (also used for DB partitions)
- **hot partition** — shard receiving disproportionate load; mitigations: request coalescing, key splitting, sticky sharding
- **celebrity problem** — class of hot key/partition driven by user popularity (Justin Bieber tweets)
- **rendezvous hashing** — Highest Random Weight (HRW); alternative to consistent hashing
- **N+1 problem** — 1 list query + N item queries due to missing batching; canonical theory in databases/DATABASE_TYPES.md
- **CDC** — Change Data Capture; Debezium-style streaming of DB changes

### Software Engineering

- **SOLID** — SRP / OCP / LSP / ISP / DIP (canonical acronym order)
- **LSP** — Liskov Substitution Principle; subtype contract preservation
- **DIP** — Dependency Inversion Principle (depend on abstractions); distinct from DI (technique)
- **referential transparency** — expression can be replaced by its value without changing program behaviour
- **higher-order function (HOF)** — accepts or returns a function
- **first-class functions** — functions as values (assignable, passable, returnable)
- **default method (Java)** — interface method with implementation (JEP 126, Java 8); enables Collection API evolution
- **tail call optimization (TCO)** — NOT supported by JVM; workarounds: loop, trampoline, Kotlin `tailrec`
- **testing pyramid** — many unit / some integration / few E2E (Cohn). Inverse = "ice cream cone" antipattern
- **mutation testing** — introduce code mutations; measure if tests catch them; PIT tool
- **contract testing** — consumer-driven contracts (Pact); replaces brittle E2E for microservices
- **SAST / DAST** — Static / Dynamic Application Security Testing

### Java Core

- **TLAB** — Thread-Local Allocation Buffer; per-thread bump-the-pointer allocation в Eden, без synchronization
- **safepoint** — точка в bytecode/JIT-коде, где поток может быть безопасно остановлен GC/JFR/debugger; обычно вставляется в backward branches и returns
- **write barrier** — runtime-hook на запись reference-поля, поддерживающий GC-метаданные (card table / SATB queue); **в GC контексте**, не путать с CPU memory barrier
- **card table** — bitmap-структура, где card ≈ 512 байт heap; помечается грязной при write barrier
- **SATB** — Snapshot-At-The-Beginning (G1 concurrent mark); барьер сохраняет старое значение перед перезаписью
- **escape analysis** — JIT-анализ, определяющий выход объекта из метода/потока; включает scalar replacement, lock elision, lock coarsening
- **deoptimization** — JIT откатывается в interpreter при нарушении speculative assumption (unstable_if, class_check, CHA invalidation)
- **CHA** — Class Hierarchy Analysis; JIT анализ для inline виртуальных вызовов
- **parent delegation** — стандартное правило `ClassLoader.loadClass`: спросить родителя до попытки загрузить самому
- **type erasure** — generics стираются в bytecode до Object/upper-bound (compile-time only)
- **bridge method** — synthetic метод, генерируемый компилятором для совместимости override + erasure (ACC_BRIDGE flag)
- **PECS** — Producer-Extends, Consumer-Super (Bloch rule для wildcard generics)
- **Compact Strings** — `String` хранит `byte[]` + coder (LATIN1/UTF16) с JEP 254
- **StringConcatFactory** — bootstrap для `+` concatenation через invokedynamic (JEP 280)
- **invokedynamic** — JVM-инструкция с lazy bootstrap call site; используется для lambda, string concat, pattern matching, record methods
- **MethodHandle** — typed function pointer с linkage в runtime (`java.lang.invoke`)
- **VarHandle** — typed accessor с access modes (plain/opaque/acquire-release/volatile/atomic ops); замена `Unsafe`/AtomicFieldUpdater
- **LambdaMetafactory** — bootstrap для lambda; создаёт hidden class через `defineHiddenClass`
- **JPMS** — Java Platform Module System (Java 9+)
- **Helpful NPE** — JVM-флаг `-XX:+ShowCodeDetailsInExceptionMessages` (default 14+), показывает какое выражение было null
- **record** — final immutable nominal tuple с canonical constructor и auto-generated equals/hashCode/toString (JEP 395)
- **sealed class** — закрытая иерархия с `permits`; subclass должен быть final / sealed / non-sealed (JEP 409)
- **pattern matching** — flow-scoping binding в `instanceof` (JEP 394), `switch` (JEP 441), record patterns (JEP 440)
- **text block** — multi-line string literal `"""..."""` с common-leading-whitespace stripping (JEP 378)
- **FFM API** — Foreign Function & Memory API (stable Java 22, JEP 454); замена JNI и `Unsafe`
- **MemorySegment** — typed view над off-heap (или onto heap) memory; lifetime через Arena
- **Arena** — lifetime scope для FFM allocations; confined / shared / auto / global
- **Vector API** — SIMD operations в pure Java; использует AVX-2/AVX-512/NEON intrinsics в JIT
- **GraalVM Native Image** — AOT-компиляция Java → standalone executable (closed-world assumption)
- **gadget chain** — цепочка существующих в classpath классов, чьи `readObject` дают RCE при deserialization

### Engineering Process

- **WSJF** — Weighted Shortest Job First: приоритет = cost of delay / длительность работы (Reinertsen, SAFe)
- **cost of delay** — денежная цена одной недели задержки поставки; основа WSJF, не «важность»
- **WIP limit** — верхняя граница числа одновременно взятых в работу задач на колонку или на человека
- **Little's Law** — L = λ × W: среднее число задач в системе = поток на входе × среднее время прохождения
- **trunk-based development** — интеграция в основную ветку не реже раза в день, ветки живут часы
- **feature flag** — переключатель, отделяющий развёртывание кода от включения функциональности
- **deploy ≠ release** — код в проде и функциональность, доступная пользователю, — два разных события
- **release train** — фиксированное расписание релизов: не готово к отправлению — едет следующим
- **release branch** — ветка, срезанная от основной под конкретный релиз; стабилизация без блокировки основной
- **blameless postmortem** — разбор инцидента, направленный на условия отказа, а не на действия людей
- **error budget** — допустимая доля отказов, вытекающая из SLO; владелец концепта — modules/infrastructure/theory/OBSERVABILITY.md
- **DORA metrics** — четыре метрики доставки: deployment frequency, lead time for changes, change failure rate, failed deployment recovery time
- **technical debt quadrant** — классификация Фаулера по осям «осознанно / неосознанно» и «разумно / безрассудно»
- **Definition of Done (DoD)** — условия, при которых инкремент считается готовым; обязательство артефакта «инкремент»
- **Definition of Ready (DoR)** — условия, при которых задачу можно брать в спринт; не термин Scrum Guide
- **Sprint Goal** — единая цель спринта; обязательство артефакта «бэклог спринта»
- **Product Goal** — долгосрочная цель продукта; обязательство артефакта «бэклог продукта»
- **story point** — относительная мера объёма работы, сравнимая только внутри одной команды
- **cycle time** — от начала работы над задачей до её готовности (подмножество lead time)
- **lead time** — от появления заявки до поставки пользователю
- **cumulative flow diagram (CFD)** — накопительная диаграмма потока: показывает рост очередей и WIP во времени
- **Goodhart's law** — когда метрика становится целью, она перестаёт быть хорошей метрикой

### CI/CD

- **конвейер (pipeline)** — граф заданий, запускаемый событием в репозитории; не «пайплайн»
- **задание (job)** — единица планирования конвейера: исполняется целиком на одном исполнителе
- **этап (stage)** — группа заданий, объединённых барьером; в Actions барьера нет, есть `needs`
- **шаг (step)** — команда внутри задания; состояние между шагами общее, между заданиями — нет
- **исполнитель (runner / agent)** — машина, на которой выполняется задание; названия продуктов остаются как есть: GitLab Runner, Jenkins agent, GitHub-hosted runner
- **эфемерный исполнитель** — исполнитель, уничтожаемый после задания; отсюда необходимость кэша и артефактов как явных механизмов
- **артефакт задания** — файл, явно переданный из одного задания в другое; не то же самое, что кэш
- **кэш конвейера** — переиспользуемое между прогонами содержимое, адресуемое ключом; ускорение без гарантии наличия
- **реестр образов (container registry)** — хранилище образов; не «реджистри», не «регистри»
- **дайджест образа (digest)** — `sha256:` содержимого манифеста; единственный неизменяемый идентификатор образа
- **тег образа** — изменяемая метка, указывающая на дайджест; может быть переставлена в любой момент
- **продвижение артефакта (promotion)** — перенос одного и того же собранного артефакта на следующее окружение; не «промоушен», не «промоут»
- **доставка толчком (push)** — конвейер сам применяет изменение в целевой среде, имея её креденшелы
- **доставка вытягиванием (pull)** — агент внутри целевой среды сам забирает желаемое состояние из Git
- **согласование (reconciliation)** — непрерывное приведение фактического состояния к желаемому; та же форма, что в modules/infrastructure/theory/KUBERNETES.md
- **расхождение (drift)** — разница между желаемым состоянием в Git и фактическим в среде; та же форма, что в modules/infrastructure/theory/CLOUD.md
- **репозиторий конфигурации** — отдельный репозиторий с манифестами окружений; источник истины при доставке вытягиванием
- **GitOps** — доставка вытягиванием с историей желаемого состояния в Git; владелец модели — modules/ci-cd, владелец механики «Argo применяет чарт» — modules/infrastructure/theory/HELM.md
- **OIDC-федерация** — обмен короткоживущего токена конвейера на доступ в облако без хранимого ключа
- **BuildKit** — сборщик образов по умолчанию в современном Docker: параллельные этапы, монтирование кэша и секретов
- **Kaniko** — сборка образа внутри контейнера без демона Docker и без привилегий
- **DinD (Docker-in-Docker)** — запуск демона Docker внутри контейнера сборки; требует привилегированного режима
- **layered jar** — разложение исполняемого jar Spring Boot на слои по частоте изменения (`-Djarmode=tools`)
- **SBOM** — машиночитаемый список компонентов артефакта (SPDX, CycloneDX)
- **SLSA** — уровни гарантий происхождения артефакта; произносится «салса»
- **provenance (происхождение)** — подписанное утверждение о том, чем и из чего собран артефакт
- **merge queue** — очередь, собирающая кандидата вместе с текущей основной веткой перед слиянием
- **matrix build** — размножение одного задания по комбинациям параметров
- **fail fast** — порядок этапов, при котором дешёвая проверка падает раньше дорогой
- **окружение по требованию** — временное окружение, создаваемое на пулл-реквест и удаляемое с ним

## Avoid

| Use instead | Do NOT use |
|-------------|------------|
| cache stampede | "thundering herd" (in caching context), "cache miss storm", "dogpile effect" |
| cache breakdown | "hot key expiry problem" |
| distributed caching | "distributed cache system", "distributed cache layer" |
| W-TinyLFU | "Window Tiny LFU", "WindowTinyLFU" |
| consistent hashing | "consistent hash ring" (acceptable in prose, prefer the short form in headings) |
| write-behind | "write-back" (use only as alias, not as primary term) |
| starvation | "thread starvation deadlock" (starvation and deadlock are distinct) |
| thread pool starvation | "thread pool exhaustion" |
| cooperative cancellation | "coroutine cancellation" (too vague) |
| CAS | "compare and swap" (use acronym in headings/indexes) |
| JMM | "Java memory model" (use acronym in headings/indexes) |
| N+1 problem | "N+1 query problem", "N+1 select problem" |
| DataLoader | "data loader", "dataloader" |
| Apollo Federation | "GraphQL federation" (ambiguous) |
| reconciliation loop | "reconcile loop", "control loop" (control loop is too generic) |
| OOMKilled | "Out of memory killed" (use canonical capitalization) |
| kube-proxy | "kubeproxy", "kube proxy" (use the hyphenated form) |
| OCI | "Open Containers Initiative" (singular "Container") |
| cardinality bomb | "cardinality explosion", "high cardinality issue" (bomb is the canonical metaphor) |
| W3C TraceContext | "W3C Trace Context", "traceparent header standard" |
| head-based sampling | "head sampling", "upfront sampling" |
| tail-based sampling | "tail sampling", "post-hoc sampling" |
| error budget | "error budget burn" (use "budget" alone, not "burn") |
| RPO / RTO | "recovery point", "recovery time" (use the acronyms in headings/indexes) |
| structured logging | "JSON logging" (structured is preferred — JSON is a format choice) |
| correlation ID | "request ID" (acceptable as alias; prefer correlation ID when discussing pattern) |
| TLAB | "thread-local heap", "per-thread eden region" (TLAB is the canonical term) |
| write barrier (GC) | не путать с CPU memory barrier — в GC контексте это runtime hook на reference write |
| type erasure | "generic erasure", "erased generics" |
| Compact Strings | "compressed strings" (это другой VM-флаг времён JRockit, путаница) |
| StringConcatFactory | "string concat invokedynamic factory" (use the canonical class name) |
| JPMS | "Jigsaw" (это codename проекта, JPMS — canonical) |
| record | "data class" (это Kotlin термин; для Java — record) |
| VarHandle | "atomic handle" (использовать VarHandle) |
| MethodHandle | "method pointer", "method reference" (last термин уже занят `::`) |
| FFM API | "Panama API" (Panama — overall project, FFM — конкретный API) |
| Helpful NPE | "informative NPE", "detailed NPE" (canonical — Helpful) |
| gadget chain | "deserialization chain", "exploit chain" (gadget chain — устоявшийся термин в security) |
| GraalVM Native Image | "Graal native build", "ahead-of-time image" (use the canonical product name) |
| pattern matching | "pattern match" (matching — gerund form) |
| WSJF | "weighted shortest job", "WSJF score" (WSJF — уже аббревиатура модели) |
| cost of delay | "стоимость промедления", "цена опоздания" (cost of delay — каноническая форма) |
| WIP limit | "лимит задач", "ограничение параллелизма" (WIP-лимит — канонический термин Kanban) |
| trunk-based development | "trunk development", "мастер-разработка", "TBD" (аббревиатура занята) |
| deploy ≠ release | "деплой = релиз" (разделение — суть практики feature flag) |
| blameless postmortem | "постмортем без вины", "no-blame разбор" |
| DORA metrics | "четыре ключевые метрики DevOps", "Accelerate metrics" (DORA — канонический источник) |
| technical debt | "костыли", "legacy" (legacy — про возраст кода, долг — про осознанный размен) |
| Definition of Done | "определение готовности" (это список условий, а не определение) |
| velocity | "производительность команды", "скорость разработки" (velocity — безразмерная и несравнимая между командами) |
| Daily Scrum | "статус-митинг", "планёрка" (Scrum Guide: событие разработчиков, не отчёт менеджеру) |
| Sprint Review | "демо" (демонстрация — часть события, а не всё событие) |
| refinement | "груминг", "grooming" (термин выведен из Scrum Guide в 2011 году) |
| release branch | "ветка релиза", "стабильная ветка" (release branch — каноническая форма) |
| Little's Law | "закон очередей", "формула Литтла" (закон Литтла — каноническая русская форма) |
| pipeline | «пайплайн» (канонический перевод — конвейер) |
| job | «джоба», «джобка» (канонический перевод — задание) |
| runner | «раннер», «ранер» (канонический перевод — исполнитель) |
| container registry | «реджистри», «регистри» (канонический перевод — реестр образов) |
| digest | «хэш образа», «сумма образа» (дайджест — каноническая форма; тег и дайджест не синонимы) |
| promotion | «промоушен», «промоут», «промоутить» (канонический перевод — продвижение артефакта) |
| GitOps | «гитопс», «Git-Ops» (GitOps — каноническая форма продукта практики) |
| drift | «дрифт», «дрейф конфигурации» (канонический перевод — расхождение) |
| reconciliation | «реконсиляция», «ресинхронизация» (канонический перевод — согласование) |
| DinD | «docker в docker», «вложенный докер» (DinD — устоявшаяся аббревиатура) |
| SLSA | «SALSA», «уровни SLSA-цепочки» (SLSA — канонический акроним) |
| merge queue | «очередь мержа», «мерж-очередь» (merge queue — каноническая форма) |
