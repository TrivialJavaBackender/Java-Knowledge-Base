# java-core

Подготовка к интервью по теме **Deep Java internals** — JVM, GC, JIT, class loading, bytecode, language features, off-heap. Модуль покрывает темы, которые часто появляются на senior-собесах, но редко прописаны в туториалах.

## Структура

```
modules/java-core/
├── theory/                       # 15 файлов теории
│   ├── GARBAGE_COLLECTION.md     # GC algorithms, generations, write barriers, safepoints
│   ├── JVM_MEMORY_AREAS.md       # heap, metaspace, code cache, off-heap, container sizing
│   ├── CLASS_LOADERS.md          # hierarchy, parent delegation, lifecycle, classloader leaks
│   ├── JIT_COMPILATION.md        # tiered C1/C2, escape analysis, deopt, GraalVM, Native Image
│   ├── STRING_INTERNALS.md       # String pool, intern, compact strings, StringConcatFactory
│   ├── BYTECODE_INVOKEDYNAMIC.md # class file, opcodes, invokedynamic, MethodHandle, lambda
│   ├── REFLECTION_HANDLES.md     # Reflection cost, MethodHandle, VarHandle access modes
│   ├── JPMS_MODULES.md           # module-info, exports/opens, automatic modules, jlink
│   ├── GENERICS_ERASURE.md       # type erasure, bridge methods, PECS, wildcards, capture
│   ├── EQUALS_HASHCODE_COMPARABLE.md  # contracts, TreeMap pitfalls, modern Comparator API
│   ├── EXCEPTION_INTERNALS.md    # fillInStackTrace, try-with-resources, Helpful NPE, sealed
│   ├── MODERN_JAVA_FEATURES.md   # records, sealed, pattern matching, text blocks, var
│   ├── FOREIGN_MEMORY_VECTOR.md  # FFM API (Arena, MemorySegment), Vector API, SIMD
│   ├── SERIALIZATION.md          # Serializable, serialVersionUID, gadget chains, JEP 290/415
│   └── JMM_REFERENCE.md          # cross-ref only — JMM owned by `concurrency`
├── PROGRESS.md
├── ROADMAP.md
├── INTERVIEW_QUESTIONS.md
└── _SUMMARY.md
```

> **Чисто теоретический модуль.** Нет `pom.xml`, нет упражнений — материал изучается через теорию + interview-questions + flashcards.

## Темы (NO OVERLAP)

В этом модуле — **JVM internals и язык Java**: GC, JIT, ClassLoaders, JPMS, bytecode, modern features, off-heap.

Уже покрыто в других модулях (ссылаемся, не дублируем):

- **JMM, happens-before, volatile, synchronized, locks, atomics, virtual threads** → [`modules/concurrency/`](../concurrency/)
- **Hibernate L1/L2/Query cache, Spring AOP, IoC, Bean lifecycle** → [`modules/spring-frameworks/`](../spring-frameworks/)
- **JVM observability (Prometheus, JFR, OpenTelemetry), JVM в Docker/K8s** → [`modules/infrastructure/`](../infrastructure/)
- **Kotlin-specific: coroutines, suspend, Flow** → [`modules/kotlin-coroutines/`](../kotlin-coroutines/)

## Прогресс

См. [PROGRESS.md](PROGRESS.md) и [ROADMAP.md](ROADMAP.md).

## Интервью-вопросы

См. [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md) — Q&A по всем 15 темам, формат `qa-bold`.

## Semantic Summary

См. [_SUMMARY.md](_SUMMARY.md) — semantic compression для быстрого восстановления контекста.
