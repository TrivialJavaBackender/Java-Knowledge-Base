# JMM — Reference

---

**Этот файл — намеренно короткий cross-reference.** Java Memory Model (JMM) принадлежит модулю [`concurrency`](../../concurrency/) согласно правилу NO OVERLAP. Здесь только указатели на канонических владельцев.

---

## 1. Что такое JMM (one-paragraph)

JMM — раздел JLS §17, описывающий **partial-order на действиях памяти** (reads, writes, lock/unlock, thread start/join) — *happens-before*. JMM определяет, какие записи **видны** какому потоку, в каком порядке, и какие оптимизации компилятора/CPU **разрешены** при условии соблюдения happens-before. Без JMM concurrent-код был бы непереносим — JVM на ARM, x86, POWER даёт разные re-ordering по умолчанию; JMM абстрагирует это.

## 2. Куда смотреть

| Концепт | Файл |
|---|---|
| happens-before, sequential consistency, JMM partial order | [`modules/concurrency/theory/MEMORY_MODEL.md`](../../concurrency/theory/MEMORY_MODEL.md) |
| `volatile`, semantics, fence injection | [`modules/concurrency/theory/MEMORY_MODEL.md`](../../concurrency/theory/MEMORY_MODEL.md) |
| `synchronized`, monitor enter/exit memory effects | [`modules/concurrency/theory/MEMORY_MODEL.md`](../../concurrency/theory/MEMORY_MODEL.md) |
| `final` field safe publication | [`modules/concurrency/theory/MEMORY_MODEL.md`](../../concurrency/theory/MEMORY_MODEL.md) |
| ReentrantLock, ReadWriteLock, StampedLock, Condition | [`modules/concurrency/theory/LOCKS.md`](../../concurrency/theory/LOCKS.md) |
| CAS, Compare-And-Swap, ABA problem | [`modules/concurrency/theory/ATOMIC_CAS.md`](../../concurrency/theory/ATOMIC_CAS.md) |
| Atomic-классы, AtomicReference, ABA | [`modules/concurrency/theory/ATOMIC_CAS.md`](../../concurrency/theory/ATOMIC_CAS.md) |
| Race condition, deadlock, livelock | [`modules/concurrency/theory/PROBLEMS.md`](../../concurrency/theory/PROBLEMS.md) |
| Virtual threads, M:N model, StructuredTaskScope | [`modules/concurrency/theory/VIRTUAL_THREADS.md`](../../concurrency/theory/VIRTUAL_THREADS.md) |

## 3. Почему JMM не в java-core

JMM описывает **взаимодействие потоков**. Все, кому JMM нужен, изучают одновременно:
- volatile / synchronized / final;
- happens-before и locks;
- atomic-операции и lock-free;
- concurrent коллекции;
- visibility и memory ordering.

Эти темы образуют единый corpus в `concurrency`. Дублировать JMM в `java-core` (как «JVM internal») означало бы повторять half of `concurrency`. Поэтому в `java-core`:
- **VarHandle access modes** (plain/opaque/acquire-release/volatile) лежит в [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md) — это API-аспект;
- **GC write barriers** лежат в [`GARBAGE_COLLECTION.md`](GARBAGE_COLLECTION.md) — это runtime-аспект GC;
- **JIT lock elision / lock coarsening** лежит в [`JIT_COMPILATION.md`](JIT_COMPILATION.md) — это optimization-аспект.

Но **сама модель** (happens-before, volatile semantics, lock-acquire-release) — только в `concurrency`.

## 4. Practical: если спросят на собесе JMM в контексте java-core

Объясни модель **в двух фразах**:
> JMM определяет partial-order *happens-before* на действиях памяти. Если действие `a` happens-before `b`, то эффекты `a` видны при выполнении `b`. Без happens-before компилятор/CPU могут реоrdering операции для производительности. `volatile`, `synchronized`, `Thread.start`/`join`, `final`-init, lock release/acquire — устанавливают happens-before.

Подробности — см. `modules/concurrency/theory/MEMORY_MODEL.md`.

## Related

- VarHandle (atomic access in java-core context) → [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md)
- GC barriers (cardtable, SATB) — не JMM, но смежная тема → [`GARBAGE_COLLECTION.md`](GARBAGE_COLLECTION.md)
- JIT lock elision / coarsening → [`JIT_COMPILATION.md`](JIT_COMPILATION.md)
