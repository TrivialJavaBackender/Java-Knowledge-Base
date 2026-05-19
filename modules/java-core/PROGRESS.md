# Progress Tracker — java-core

## Статус модулей

| Модуль | Статус | Дата начала | Дата завершения |
|--------|--------|-------------|-----------------|
| 1. Memory & GC (GARBAGE_COLLECTION, JVM_MEMORY_AREAS) | ⬜ не начат | — | — |
| 2. Class Loading & JIT (CLASS_LOADERS, JIT_COMPILATION) | ⬜ не начат | — | — |
| 3. Strings & Bytecode (STRING_INTERNALS, BYTECODE_INVOKEDYNAMIC) | ⬜ не начат | — | — |
| 4. Reflection & JPMS (REFLECTION_HANDLES, JPMS_MODULES) | ⬜ не начат | — | — |
| 5. Type System & Contracts (GENERICS_ERASURE, EQUALS_HASHCODE_COMPARABLE) | ⬜ не начат | — | — |
| 6. Exceptions & Modern Java (EXCEPTION_INTERNALS, MODERN_JAVA_FEATURES) | ⬜ не начат | — | — |
| 7. Native & Serialization (FOREIGN_MEMORY_VECTOR, SERIALIZATION) | ⬜ не начат | — | — |
| 8. JMM Reference (cross-ref to `concurrency`) | ⬜ не начат | — | — |

## Теория

| # | Тема | Файл | Статус |
|---|------|------|--------|
| 01 | Garbage Collection — algorithms, generations, write barriers | `theory/GARBAGE_COLLECTION.md` | ⬜ |
| 02 | JVM Memory Areas — heap, metaspace, code cache, off-heap | `theory/JVM_MEMORY_AREAS.md` | ⬜ |
| 03 | Class Loaders — hierarchy, parent delegation, leaks | `theory/CLASS_LOADERS.md` | ⬜ |
| 04 | JIT Compilation — C1/C2/tiered, escape analysis, deopt, GraalVM | `theory/JIT_COMPILATION.md` | ⬜ |
| 05 | String Internals — pool, intern, compact strings, concat | `theory/STRING_INTERNALS.md` | ⬜ |
| 06 | Bytecode & invokedynamic — class file, opcodes, MethodHandle | `theory/BYTECODE_INVOKEDYNAMIC.md` | ⬜ |
| 07 | Reflection / MethodHandle / VarHandle | `theory/REFLECTION_HANDLES.md` | ⬜ |
| 08 | JPMS — modules, requires/exports/opens, jlink | `theory/JPMS_MODULES.md` | ⬜ |
| 09 | Generics & Type Erasure — bridge methods, PECS, capture | `theory/GENERICS_ERASURE.md` | ⬜ |
| 10 | equals/hashCode/Comparable — контракты, TreeMap pitfalls | `theory/EQUALS_HASHCODE_COMPARABLE.md` | ⬜ |
| 11 | Exception Internals — stack trace cost, try-with-resources, Helpful NPE | `theory/EXCEPTION_INTERNALS.md` | ⬜ |
| 12 | Modern Java Features — records, sealed, pattern matching, var | `theory/MODERN_JAVA_FEATURES.md` | ⬜ |
| 13 | Foreign Memory & Vector API — FFM, SIMD | `theory/FOREIGN_MEMORY_VECTOR.md` | ⬜ |
| 14 | Serialization — Serializable, gadget chains, JEP 290/415 | `theory/SERIALIZATION.md` | ⬜ |
| 15 | JMM — cross-reference to `concurrency` | `theory/JMM_REFERENCE.md` | ⬜ |

---
Легенда: ⬜ не начато | 🔄 в процессе | ✅ завершено
