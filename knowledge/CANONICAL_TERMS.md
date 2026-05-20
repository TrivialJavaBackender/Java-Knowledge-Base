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
