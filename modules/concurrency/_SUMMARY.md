# Concurrency — Semantic Summary

## Core Model
- Весь `java.util.concurrent` — одна машина: `volatile int state` + CAS (быстрый путь) + очередь AQS
  + `LockSupport.park/unpark` (медленный). Классы отличаются лишь смыслом `state`.
- `LockSupport.park()` ветвится по `Thread.isVirtual()` — стык j.u.c. с Loom и причина pinning
  у `synchronized` (до JDK 24).
- JMM — контракт: переупорядочивать можно всё, что не нарушает happens-before. «volatile сбрасывает
  кэш» — неверно: кэши когерентны, дело в оптимизациях компилятора и барьерах.
- `CompletableFuture` — стек колбеков на CAS: поля `result` и `stack`, `postComplete` — трамплин.

## Key Concepts
- Сколько потоков: `L = λW` (Литтл); для ожидающих `N = Nядер × U × (1 + W/C)`, но предел задаёт
  внешний ресурс (пул соединений, лимит API).
- Цена: поток ≈ 2 МБ стека, ~22 мкс создание, ~1.2 мкс переключение; виртуальный ≈ 1.5 мкс.
- CAS не бесплатен: 8 потоков → 4.66 попытки на инкремент, `AtomicLong` вчетверо медленнее лока;
  `LongAdder` (`Striped64` + `@Contended`) быстрее в 40 раз ценой неточного `sum()`.
- `ConcurrentHashMap`: лок на бин (сегменты — это Java 7); дерево требует и `TREEIFY_THRESHOLD = 8`,
  и `MIN_TREEIFY_CAPACITY = 64`; рекурсивный `computeIfAbsent` → `IllegalStateException`.
- `ThreadPoolExecutor`: `ctl` = состояние (3 бита) + число потоков (29); приём core → очередь → max
  → отказ, поэтому неограниченная очередь обнуляет `maximumPoolSize`.
- Виртуальные потоки: пул больше не регулятор нагрузки — ограничиваем ресурс через `Semaphore`.
  `ScopedValue` и `StructuredTaskScope` — preview и в JDK 24.

## Important Invariants
- Нет happens-before → результат не определён. `volatile` даёт порядок и атомарность 64-битных
  полей, но не атомарность `count++`.
- `final`-поля видны целиком, если `this` не утёк из конструктора.
- Любое ожидание — в цикле (ложные пробуждения); `unpark` до `park` не теряется.
- `ReadWriteLock` выигрывает только при длинной критической секции; при короткой он в 7–9 раз
  медленнее `synchronized`.
- `CompletableFuture.cancel(true)` не прерывает задачу, `orTimeout` не останавливает работу.

## Common Pitfalls
- `submit(Runnable)` прячет исключение в `Future`; периодическая задача умирает от первого исключения.
- `ThreadLocal` в пуле переживает задачу → утечка данных и памяти; нужен `remove()` в `finally`.
- Блокировка в `commonPool` тормозит `parallelStream` в другом месте программы.
- Задача, ждущая задачу того же пула, — зависание, которое `jcmd` не считает deadlock.
- Ложное разделение строки кэша: замедление в 3–12 раз. `sun.misc.Contended` не существует с Java 9.

## Related Modules
- `kotlin-coroutines` — та же задача на уровне языка; `INTEROP.md` — мост к `CompletableFuture`.
- `system-design` — надёжность поверх этих примитивов. `java-core` — JIT и оптимизации.
