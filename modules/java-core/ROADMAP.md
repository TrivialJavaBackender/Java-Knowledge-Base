# java-core — Roadmap

## Порядок прохождения

| Приоритет | Тема | Частота на собесах |
|-----------|------|--------------------|
| 1 | Garbage Collection (G1/ZGC/Shenandoah, generations) | ★★★★★ |
| 2 | JVM Memory Areas (heap, metaspace, off-heap, контейнеры) | ★★★★★ |
| 3 | Class Loaders (delegation, leaks) | ★★★★ |
| 4 | JIT Compilation (tiered, escape analysis, deopt) | ★★★★ |
| 5 | String Internals (pool, intern, compact strings) | ★★★★ |
| 6 | equals/hashCode/Comparable contracts | ★★★★ |
| 7 | Modern Java Features (records, sealed, pattern matching) | ★★★★ |
| 8 | Generics & Type Erasure (bridge methods, PECS) | ★★★ |
| 9 | Exception Internals (Helpful NPE, try-with-resources) | ★★★ |
| 10 | Reflection / MethodHandle / VarHandle | ★★★ |
| 11 | Bytecode & invokedynamic | ★★★ |
| 12 | JPMS (modules, jlink) | ★★ |
| 13 | Serialization (gadget chains) | ★★ |
| 14 | Foreign Memory & Vector API | ★★ |
| 15 | JMM (canonical в `concurrency`) | ★★★★★ → см. `concurrency` |

---

## Модуль 1: Memory & GC

📖 Теория: [theory/GARBAGE_COLLECTION.md](theory/GARBAGE_COLLECTION.md), [theory/JVM_MEMORY_AREAS.md](theory/JVM_MEMORY_AREAS.md)

- [ ] Generational hypothesis, Eden/Survivor/Old, TLAB
- [ ] Mark-sweep, mark-compact, copying, tri-color invariant
- [ ] Write barriers, card table, remembered set, SATB vs incremental update
- [ ] Collectors: Serial, Parallel, G1, ZGC, Shenandoah, Epsilon (когда выбирать)
- [ ] Safepoints, STW phases, time-to-safepoint
- [ ] GC tuning: `-Xms/-Xmx`, `MaxGCPauseMillis`, MaxRAMPercentage
- [ ] Heap, metaspace, code cache, native memory (NMT)
- [ ] Direct ByteBuffer и off-heap allocation
- [ ] JVM в контейнерах: `UseContainerSupport`, MaxRAMPercentage, OOMKilled
- [ ] Reference types: Soft / Weak / Phantom, Cleaner

---

## Модуль 2: Class Loading & JIT

📖 Теория: [theory/CLASS_LOADERS.md](theory/CLASS_LOADERS.md), [theory/JIT_COMPILATION.md](theory/JIT_COMPILATION.md)

- [ ] ClassLoader hierarchy: Bootstrap / Platform / App / Custom
- [ ] Parent delegation и его нарушения (Tomcat, OSGi)
- [ ] Class lifecycle: loading → linking (verification/preparation/resolution) → initialization
- [ ] `ClassNotFoundException` vs `NoClassDefFoundError`
- [ ] ClassLoader leaks: ThreadLocal, JDBC driver, MBean, ServiceLoader
- [ ] HotSpot JIT pipeline: Interpreter → C1 → C2
- [ ] Tiered compilation, levels 0–4
- [ ] Escape analysis, scalar replacement, lock elision
- [ ] Deoptimization (CHA invalidation, unstable_if, class_check)
- [ ] GraalVM: Graal JIT + Native Image (AOT closed-world)
- [ ] Polymorphic call sites: mono / bi / megamorphic

---

## Модуль 3: Strings & Bytecode

📖 Теория: [theory/STRING_INTERNALS.md](theory/STRING_INTERNALS.md), [theory/BYTECODE_INVOKEDYNAMIC.md](theory/BYTECODE_INVOKEDYNAMIC.md)

- [ ] String pool, intern(), `-XX:StringTableSize`
- [ ] Compact strings (JEP 254): byte[] + coder
- [ ] StringConcatFactory (JEP 280): invokedynamic для `+`
- [ ] substring 7u6 fix, charset pitfalls, StandardCharsets
- [ ] Class file format (constant pool, methods, attributes)
- [ ] Stack-based execution, operand stack, locals
- [ ] Invoke* opcodes: virtual / static / special / interface / **dynamic**
- [ ] `invokedynamic`: BootstrapMethod, CallSite, ConstantCallSite
- [ ] LambdaMetafactory: как создаётся lambda class
- [ ] javap, ASM, ByteBuddy для bytecode-инспекции

---

## Модуль 4: Reflection & JPMS

📖 Теория: [theory/REFLECTION_HANDLES.md](theory/REFLECTION_HANDLES.md), [theory/JPMS_MODULES.md](theory/JPMS_MODULES.md)

- [ ] Reflection API: Class, Method, Field, performance cost
- [ ] `setAccessible(true)`, JPMS strong encapsulation, `--add-opens`
- [ ] MethodHandle: invokeExact vs invoke, composition combinators
- [ ] VarHandle: access modes (plain/opaque/acquire-release/volatile)
- [ ] AtomicFieldUpdater (legacy) → VarHandle
- [ ] Annotation processing (compile-time vs runtime)
- [ ] JPMS: module-info, requires/exports/opens, transitive, static
- [ ] Named / automatic / unnamed modules
- [ ] `jlink` minimal runtime, `jdeps`
- [ ] Migration patterns (bottom-up vs top-down)

---

## Модуль 5: Type System & Contracts

📖 Теория: [theory/GENERICS_ERASURE.md](theory/GENERICS_ERASURE.md), [theory/EQUALS_HASHCODE_COMPARABLE.md](theory/EQUALS_HASHCODE_COMPARABLE.md)

- [ ] Type erasure: что нельзя из-за неё (new T(), new T[], instanceof T)
- [ ] Bridge methods (synthetic)
- [ ] Wildcards: extends / super / unbounded
- [ ] PECS (Producer-Extends, Consumer-Super)
- [ ] Capture conversion, helper methods
- [ ] Reifiable vs non-reifiable types
- [ ] F-bounded polymorphism (`<T extends Comparable<T>>`)
- [ ] Super-type tokens (Gafter trick) — `TypeReference`
- [ ] equals контракт: reflex/symm/trans/consistent/null
- [ ] hashCode контракт, согласованность с equals
- [ ] Comparable vs Comparator, TreeMap pitfall (BigDecimal)
- [ ] Modern Comparator API: `comparing`, `thenComparing`, `nullsFirst`
- [ ] Records — автогенерация equals/hashCode

---

## Модуль 6: Exceptions & Modern Java

📖 Теория: [theory/EXCEPTION_INTERNALS.md](theory/EXCEPTION_INTERNALS.md), [theory/MODERN_JAVA_FEATURES.md](theory/MODERN_JAVA_FEATURES.md)

- [ ] Throwable hierarchy: Error / Exception / RuntimeException
- [ ] Checked vs unchecked, политика выбора
- [ ] `fillInStackTrace` cost, exceptions-as-flow-control
- [ ] `-XX:-OmitStackTraceInFastThrow`
- [ ] Helpful NullPointerException (JEP 358)
- [ ] try-with-resources, suppressed exceptions, AutoCloseable
- [ ] Sealed exception hierarchies
- [ ] Records (JEP 395): canonical / compact constructor, accessors, ограничения
- [ ] Sealed classes/interfaces (JEP 409): permits, ADT
- [ ] Pattern matching: instanceof (16), switch (21), record patterns (21), `_` (22)
- [ ] Text blocks (JEP 378): indentation rules
- [ ] `var` (JEP 286): где можно/нельзя

---

## Модуль 7: Native & Serialization

📖 Теория: [theory/FOREIGN_MEMORY_VECTOR.md](theory/FOREIGN_MEMORY_VECTOR.md), [theory/SERIALIZATION.md](theory/SERIALIZATION.md)

- [ ] FFM API: Arena (confined/shared/auto), MemorySegment, ValueLayout
- [ ] MemoryLayout: structured off-heap, VarHandle integration
- [ ] Foreign Linker: downcall / upcall, замена JNI
- [ ] Vector API: SPECIES_PREFERRED, masked operations, SIMD intrinsics
- [ ] Серилизация: serialVersionUID, transient
- [ ] writeObject/readObject, writeReplace/readResolve, serialization proxy
- [ ] Gadget chains (Commons Collections, Spring, Groovy)
- [ ] JEP 290 / 415: serialization filter
- [ ] Records и serialization (canonical constructor)
- [ ] Альтернативы: JSON / Protobuf / Avro

---

## Модуль 8: JMM Reference

📖 Теория: [theory/JMM_REFERENCE.md](theory/JMM_REFERENCE.md)

> Только pointer на канонических владельцев. Реальное изучение — в `concurrency`.

- [ ] Прочитать cross-reference и понять разделение зон
- [ ] Канонический материал в [`modules/concurrency/theory/MEMORY_MODEL.md`](../concurrency/theory/MEMORY_MODEL.md)
