# Java Core — Semantic Summary

## Core Model
JVM как многослойная среда: **class loading → linking → bytecode execution → JIT compilation → memory management → GC**. Каждый слой имеет собственные структуры (`Class` через ClassLoader, методы в Code Cache, объекты в Heap) и собственные «дешёвые/дорогие» операции. Понимание стоимости каждого слоя — основа perf-engineering и debugging.

## Key Concepts
- **GC**: G1 default, ZGC / Shenandoah для low-latency; generations (Eden / Survivor / Old / Metaspace); TLAB allocation; write barriers + card table / remembered set; SATB vs incremental update; safepoints
- **Memory areas**: heap (GC-managed) + metaspace (native) + code cache + thread stacks (`-Xss`) + direct/off-heap; контейнерные `MaxRAMPercentage`, `UseContainerSupport`
- **ClassLoaders**: Bootstrap → Platform → App → Custom; parent delegation; class lifecycle (loading/linking/init); leaks через ThreadLocal/JDBC/MBean
- **JIT**: tiered C1→C2; escape analysis → scalar replacement / lock elision; deoptimization; GraalVM Native Image AOT (closed-world)
- **Strings**: pool (heap since 7), `intern()`, compact strings byte[]+coder (JEP 254), `StringConcatFactory` invokedynamic (JEP 280)
- **Bytecode**: class file, constant pool, stack-based VM, invoke{virtual,static,special,interface,dynamic}; lambda через LambdaMetafactory; hidden classes (JEP 371)
- **Reflection / MethodHandle / VarHandle**: рост стоимости падает; VarHandle = модерный atomic-доступ с access modes (plain/opaque/acquire-release/volatile)
- **JPMS**: module-info, requires (transitive/static), exports (qualified), opens (для reflection); named / automatic / unnamed; jlink, jdeps
- **Generics**: type erasure compile-time; bridge methods; wildcards + PECS; super-type tokens (`TypeReference`)
- **equals/hashCode/Comparable**: контракты + согласованность; records (JEP 395) — auto-generated; TreeMap inconsistent с equals
- **Exceptions**: `fillInStackTrace` дорог; `OmitStackTraceInFastThrow` HotSpot opt; Helpful NPE (JEP 358); try-with-resources + suppressed; sealed exceptions
- **Modern features**: records, sealed, pattern matching (instanceof/switch/record patterns), text blocks, `var`
- **FFM API** (JEP 454): Arena + MemorySegment + Linker; замена JNI и `Unsafe`; **Vector API** для SIMD
- **Serialization**: gadget chains → ysoserial; JEP 290 / 415 filter; records auto-safe; альтернативы JSON / Protobuf

## Important Invariants
- **equals/hashCode**: `equal → equal hash`; consistent; согласованность с TreeMap требует `compareTo == 0 ↔ equals`
- **parent delegation**: предотвращает подмену core-классов; defineClass от двух разных CL → два разных `Class` объекта
- **JIT speculation**: assumptions (monomorphic call site, CHA) могут быть нарушены → deoptimization; затем перекомпиляция
- **GC tri-color invariant**: нет белой ссылки из чёрного; поддерживается write barrier
- **Safepoint**: все потоки должны достичь safepoint до начала STW; tight loop без safepoint = pause time bug
- **Records**: canonical constructor — единственный entry point; нельзя обойти invariant через deserialization

## Common Pitfalls
- **Classloader leak** при webapp redeploy (`Metaspace` → OOME): JDBC driver, ThreadLocal в shared pool, MBean без unregister
- **`String.intern()` abuse** раздувает StringTable; полезен только при реальной hot-set дубликатов
- **Reflection breaks JPMS** в 16+: нужно `--add-opens` или `opens` в module-info
- **`fillInStackTrace` в hot path** = exceptions-as-flow-control антипаттерн (10–100 µs на throw)
- **Java Serialization gadget chains** → never deserialize untrusted input; JEP 290 filter обязателен
- **Finalizer use-after-free** (deprecated) → использовать `Cleaner` (JEP 264)
- **Heap == container limit** → OOMKilled на metaspace + code cache + thread stacks
- **JIT C2 не компилирует** методы > 8000 байт bytecode; разбивать на меньшие
- **TreeMap с BigDecimal** — `compareTo("1.0")` vs `compareTo("1.00")` сольют ключи

## Related Modules
- **`concurrency`** — JMM (happens-before, volatile, synchronized), locks, atomics, virtual threads, structured concurrency. См. [`JMM_REFERENCE.md`](theory/JMM_REFERENCE.md).
- **`spring-frameworks`** — Hibernate L1/L2/Query cache, Spring IoC bean lifecycle, AOP (через CGLIB / bytecode generation на base ASM).
- **`infrastructure`** — JVM в контейнерах (cgroups, OOMKilled), Prometheus JVM metrics, GC logs ingestion, JFR/OpenTelemetry tracing.
- **`kotlin-coroutines`** — Kotlin-specific runtime над JVM; suspend internals (CPS) — компиляция через bytecode-трансформацию.
- **`system-design`** — Java Stream API, SOLID, общие функциональные паттерны.
