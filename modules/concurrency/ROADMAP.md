# Java Concurrency Roadmap

План прохождения. Теория — в `theory/`, упражнения — в `src/main/kotlin/exercises/`
и `src/main/java/applied/`.

Модуль построен вокруг одного сквозного примера: **сервис принимает 1000 запросов в секунду,
каждый запрос — три вызова по 100 мс**. Из него выводится всё остальное: сколько нужно потоков,
чем платит блокировка, как ограничить нагрузку, как не блокироваться вовсе.

---

## Порядок прохождения

| Приоритет | Модуль | Зачем | Частота на собесах |
|-----------|--------|-------|--------------------|
| 1 | Модуль 0: Зачем конкурентность | без этого остальное — набор API | ★★★☆☆ |
| 2 | Модуль 1: Потоки и `synchronized` | база для всего | ★★★★★ |
| 3 | Модуль 2: Модель памяти | самый частый блок вопросов | ★★★★★ |
| 4 | Модуль 3: Внутренности j.u.c. | объясняет сразу все классы пакета | ★★★☆☆ |
| 5 | Модуль 6: Concurrent Collections | где живёт общее состояние | ★★★★★ |
| 6 | Модуль 5: Atomic и CAS | как обойтись без лока и когда не стоит | ★★★★★ |
| 7 | Модуль 8: Пулы потоков | главный настраиваемый параметр сервиса | ★★★★☆ |
| 8 | Модуль 10: Проблемы и диагностика | что делать, когда всё встало | ★★★★☆ |
| 9 | Модуль 9: Асинхронная композиция | `CompletableFuture` изнутри | ★★★★☆ |
| 10 | Модуль 4: Локи | выбор инструмента и его цена | ★★★☆☆ |
| 11 | Модуль 7: Синхронизаторы | координация, а не взаимное исключение | ★★★☆☆ |
| 12 | Модуль 11: Виртуальные потоки | что меняется на JDK 21 | ★★★☆☆ (растёт) |

Если времени мало: модули 2, 6, 8, 10 закрывают большую часть вопросов на собеседовании.
Если хочется понять, а не запомнить: модули 0, 2, 3, 9 — там объяснения механизмов.

---

## Модуль 0: Зачем конкурентность и чем мы платим

📖 [theory/WHY_CONCURRENCY.md](theory/WHY_CONCURRENCY.md)

- [ ] Закон Литтла: сколько запросов в системе одновременно → [§2](theory/WHY_CONCURRENCY.md)
- [ ] Цена потока в цифрах: стек, создание, переключение контекста → [§3](theory/WHY_CONCURRENCY.md)
- [ ] Почему больше потоков ≠ быстрее: закон Амдала, Universal Scalability Law → [§4](theory/WHY_CONCURRENCY.md)
- [ ] Одна задача — четыре стиля: пул / колбеки / `CompletableFuture` / виртуальные потоки → [§5](theory/WHY_CONCURRENCY.md)
- [ ] Задержка против пропускной способности → [§6](theory/WHY_CONCURRENCY.md)
- [ ] Когда конкурентность НЕ нужна → [§7](theory/WHY_CONCURRENCY.md)

---

## Модуль 1: Потоки, `synchronized`, `wait/notify`

📖 [theory/THREADS_BASICS.md](theory/THREADS_BASICS.md)

- [ ] Жизненный цикл потока и что он значит в дампе → [§2](theory/THREADS_BASICS.md)
- [ ] `start` / `join` / демон-потоки → [§3](theory/THREADS_BASICS.md)
- [ ] Прерывание как протокол отмены: почему поток нельзя убить → [§4](theory/THREADS_BASICS.md)
- [ ] Что делать с `InterruptedException` (два допустимых варианта) → [§4.3](theory/THREADS_BASICS.md)
- [ ] `synchronized`: монитор, реентерабельность, типичные ошибки → [§5](theory/THREADS_BASICS.md)
- [ ] `wait` / `notify` / `notifyAll` — и почему всегда в цикле → [§6](theory/THREADS_BASICS.md)
- [ ] `ThreadLocal` и утечка в пуле потоков → [§7](theory/THREADS_BASICS.md)

**Упражнения:**
- [ ] [Ex01: ThreadBasics](src/main/kotlin/exercises/Ex01_ThreadBasics.kt)
- [ ] [Ex02: ProducerConsumer](src/main/kotlin/exercises/Ex02_ProducerConsumer.kt)

---

## Модуль 2: Модель памяти Java

📖 [theory/MEMORY_MODEL.md](theory/MEMORY_MODEL.md)

- [ ] Флаг остановки, который не работает: подъём чтения из цикла → [§1](theory/MEMORY_MODEL.md)
- [ ] Переупорядочивание: оба потока видят 0 → [§2](theory/MEMORY_MODEL.md)
- [ ] Почему «`volatile` сбрасывает кэш» — неверная модель → [§3](theory/MEMORY_MODEL.md)
- [ ] Happens-before как контракт; транзитивность → [§4](theory/MEMORY_MODEL.md)
- [ ] Что `volatile` даёт и чего не даёт → [§5](theory/MEMORY_MODEL.md)
- [ ] Безопасная публикация, `final`-поля, двойная проверка блокировки → [§6](theory/MEMORY_MODEL.md)
- [ ] Гонка данных против состояния гонки → [§7](theory/MEMORY_MODEL.md)
- [ ] Как это проверять: `jcstress` → [§8](theory/MEMORY_MODEL.md)

---

## Модуль 3: Внутренности `java.util.concurrent`

📖 [theory/JUC_INTERNALS.md](theory/JUC_INTERNALS.md)

- [ ] Быстрый путь: `state` + CAS → [§2](theory/JUC_INTERNALS.md)
- [ ] Медленный путь: очередь AQS и `LockSupport.park` → [§3](theory/JUC_INTERNALS.md)
- [ ] Семантика разрешения у `park`/`unpark`; ложные пробуждения → [§4](theory/JUC_INTERNALS.md)
- [ ] Одно число — весь пакет: что означает `state` у каждого класса → [§5](theory/JUC_INTERNALS.md)
- [ ] Справедливость и barging → [§6](theory/JUC_INTERNALS.md)
- [ ] Стык с виртуальными потоками: откуда берётся pinning → [§8](theory/JUC_INTERNALS.md)

---

## Модуль 4: Явные локи

📖 [theory/LOCKS.md](theory/LOCKS.md)

- [ ] Сначала: а нужен ли лок вообще? → [§1](theory/LOCKS.md)
- [ ] `ReentrantLock` против `synchronized` — возможности, а не скорость → [§2](theory/LOCKS.md)
- [ ] `Condition`: несколько очередей ожидания → [§3](theory/LOCKS.md)
- [ ] `ReentrantReadWriteLock` и главный миф о нём (с замером) → [§4](theory/LOCKS.md)
- [ ] Понижение блокировки; почему повышение невозможно → [§4](theory/LOCKS.md)
- [ ] `StampedLock` и оптимистичное чтение → [§5](theory/LOCKS.md)
- [ ] Правила безопасной работы с локами → [§6](theory/LOCKS.md)

**Упражнения:**
- [ ] [Ex03: ReentrantLockCache](src/main/kotlin/exercises/Ex03_ReentrantLockCache.kt)
- [ ] [Ex04: ReadWriteLock](src/main/kotlin/exercises/Ex04_ReadWriteLock.kt)

---

## Модуль 5: Atomic и CAS

📖 [theory/ATOMIC_CAS.md](theory/ATOMIC_CAS.md)

- [ ] CAS как инструкция процессора; CAS-цикл → [§1](theory/ATOMIC_CAS.md)
- [ ] Цена CAS: сколько попыток пропадает под конкуренцией → [§2](theory/ATOMIC_CAS.md)
- [ ] Ложное разделение строки кэша (с замером) → [§3](theory/ATOMIC_CAS.md)
- [ ] Семейство `Atomic`; почему функция в `updateAndGet` должна быть чистой → [§4](theory/ATOMIC_CAS.md)
- [ ] Проблема ABA и `AtomicStampedReference` → [§5](theory/ATOMIC_CAS.md)
- [ ] `LongAdder` и `Striped64`: как обойти конкуренцию → [§6](theory/ATOMIC_CAS.md)
- [ ] `VarHandle` и режимы доступа (plain / opaque / acquire-release / volatile) → [§7](theory/ATOMIC_CAS.md)
- [ ] Структуры без блокировок и когда их НЕ писать → [§8](theory/ATOMIC_CAS.md)

**Упражнения:**
- [ ] [Ex05: AtomicCounter](src/main/kotlin/exercises/Ex05_AtomicCounter.kt)

---

## Модуль 6: Потокобезопасные коллекции

📖 [theory/CONCURRENT_COLLECTIONS.md](theory/CONCURRENT_COLLECTIONS.md)

- [ ] Что происходит с `HashMap` под конкуренцией → [§1](theory/CONCURRENT_COLLECTIONS.md)
- [ ] Четыре стратегии потокобезопасности → [§2](theory/CONCURRENT_COLLECTIONS.md)
- [ ] `ConcurrentHashMap`: лок на бин, два порога древовидности → [§3](theory/CONCURRENT_COLLECTIONS.md)
- [ ] `computeIfAbsent`: гарантия «один раз» и запрет рекурсии → [§3](theory/CONCURRENT_COLLECTIONS.md)
- [ ] Почему `null` запрещён; почему `size()` приблизителен → [§3](theory/CONCURRENT_COLLECTIONS.md)
- [ ] Когда конкурентная коллекция — неправильный ответ → [§4](theory/CONCURRENT_COLLECTIONS.md)
- [ ] `BlockingQueue`: выбор по задаче → [§5](theory/CONCURRENT_COLLECTIONS.md)
- [ ] `CopyOnWriteArrayList`, `ConcurrentSkipListMap`, `ConcurrentLinkedQueue` → [§6–8](theory/CONCURRENT_COLLECTIONS.md)
- [ ] `Collections.synchronizedXxx` и две его ловушки → [§9](theory/CONCURRENT_COLLECTIONS.md)

**Упражнения:**
- [ ] [Ex06: ConcurrentMapWordCount](src/main/kotlin/exercises/Ex06_ConcurrentMapWordCount.kt)
- [ ] [Ex07: BlockingQueuePipeline](src/main/kotlin/exercises/Ex07_BlockingQueuePipeline.kt)
- [ ] [Ex13: CHM Advanced](src/main/kotlin/exercises/Ex13_ConcurrentHashMapAdvanced.kt)
- [ ] [Ex14: BlockingQueues Deep](src/main/kotlin/exercises/Ex14_BlockingQueuesDeep.kt)
- [ ] [Ex15: SkipList & Sets](src/main/kotlin/exercises/Ex15_ConcurrentSkipListAndSets.kt)

---

## Модуль 7: Синхронизаторы

📖 [theory/SYNCHRONIZERS.md](theory/SYNCHRONIZERS.md)

- [ ] Все пять — один AQS с разным смыслом `state` → [вводная](theory/SYNCHRONIZERS.md)
- [ ] `CountDownLatch` и приём «стартовый пистолет» → [§1](theory/SYNCHRONIZERS.md)
- [ ] `CyclicBarrier` и его хрупкость → [§2](theory/SYNCHRONIZERS.md)
- [ ] `Semaphore`: почему это не лок и зачем он на бэкенде → [§3](theory/SYNCHRONIZERS.md)
- [ ] `Phaser`, `Exchanger` → [§4–5](theory/SYNCHRONIZERS.md)
- [ ] Что из этого действительно нужно → [§6](theory/SYNCHRONIZERS.md)

**Упражнения:**
- [ ] [Ex10: Synchronizers](src/main/kotlin/exercises/Ex10_Synchronizers.kt)

---

## Модуль 8: Пулы потоков

📖 [theory/EXECUTORS_FUTURES.md](theory/EXECUTORS_FUTURES.md)

- [ ] Зачем пул и чем опасна очередь → [§1](theory/EXECUTORS_FUTURES.md)
- [ ] `ctl`: откуда берётся порядок core → очередь → max → отказ → [§2](theory/EXECUTORS_FUTURES.md)
- [ ] Как выбрать размер пула и что важнее формулы → [§3](theory/EXECUTORS_FUTURES.md)
- [ ] Очередь и четыре политики отказа; обратное давление → [§4](theory/EXECUTORS_FUTURES.md)
- [ ] Что прячут фабрики `Executors` → [§5](theory/EXECUTORS_FUTURES.md)
- [ ] Корректная остановка пула → [§6](theory/EXECUTORS_FUTURES.md)
- [ ] Три ловушки: `submit` против `execute`, смерть периодической задачи, `ThreadLocal` → [§7](theory/EXECUTORS_FUTURES.md)
- [ ] `AtFixedRate` против `WithFixedDelay` → [§8](theory/EXECUTORS_FUTURES.md)
- [ ] `ForkJoinPool`: work-stealing, `asyncMode`, `commonPool`, `ManagedBlocker` → [§9](theory/EXECUTORS_FUTURES.md)
- [ ] `invokeAll` / `invokeAny` / `ExecutorCompletionService` → [§10](theory/EXECUTORS_FUTURES.md)

**Упражнения:**
- [ ] [Ex09: ForkJoinMergeSort](src/main/kotlin/exercises/Ex09_ForkJoinMergeSort.kt)
- [ ] [Ex16: ExecutorService Deep](src/main/kotlin/exercises/Ex16_ExecutorServiceDeep.kt)
- [ ] [Ex18: Scheduled & ForkJoin](src/main/kotlin/exercises/Ex18_ScheduledExecutorAndForkJoin.kt)

---

## Модуль 9: Асинхронная композиция (`CompletableFuture`)

📖 [theory/ASYNC_COMPOSITION.md](theory/ASYNC_COMPOSITION.md)

- [ ] Четыре попытки решить одну задачу: блокировка → `Future` → колбеки → `CompletableFuture` → [§1](theory/ASYNC_COMPOSITION.md)
- [ ] Внутри: два поля, стек Трейбера, `postComplete` → [§2](theory/ASYNC_COMPOSITION.md)
- [ ] Где выполнится `thenApply` — и почему это следствие, а не правило → [§3](theory/ASYNC_COMPOSITION.md)
- [ ] Карта методов, выведенная из типов; `thenApply` против `thenCompose` → [§4](theory/ASYNC_COMPOSITION.md)
- [ ] Суффикс `Async` и ловушка `commonPool`; почему `join()` в стадии опасен → [§5](theory/ASYNC_COMPOSITION.md)
- [ ] `CompletionException` против `ExecutionException`; позиция `exceptionally` → [§6](theory/ASYNC_COMPOSITION.md)
- [ ] Чего не делают `cancel(true)` и `orTimeout` → [§7](theory/ASYNC_COMPOSITION.md)
- [ ] Рецепты: повтор, деградация, «первый успешный» → [§7–8](theory/ASYNC_COMPOSITION.md)

**Упражнения:**
- [ ] [Ex08: CompletableFutureChain](src/main/kotlin/exercises/Ex08_CompletableFutureChain.kt)
- [ ] [Ex17: CF Advanced](src/main/kotlin/exercises/Ex17_CompletableFutureAdvanced.kt)

---

## Модуль 10: Проблемы и диагностика

📖 [theory/PROBLEMS.md](theory/PROBLEMS.md)

- [ ] Взаимная блокировка: четыре условия Коффмана и как нарушить каждое → [§1](theory/PROBLEMS.md)
- [ ] Как найти deadlock: чтение реального дампа потоков → [§2](theory/PROBLEMS.md)
- [ ] Чего дамп НЕ покажет: голодание пула → [§2](theory/PROBLEMS.md)
- [ ] Livelock и почему помогает случайная пауза → [§3](theory/PROBLEMS.md)
- [ ] Голодание, в том числе голодание пула из-за медленной зависимости → [§4](theory/PROBLEMS.md)
- [ ] Утечка потоков → [§5](theory/PROBLEMS.md)
- [ ] Инструменты: `jcmd`, два дампа подряд, события JFR → [§6](theory/PROBLEMS.md)

**Упражнения:**
- [ ] [Ex11: DeadlockDetection](src/main/kotlin/exercises/Ex11_DeadlockDetection.kt)

---

## Модуль 11: Виртуальные потоки (JDK 21+)

📖 [theory/VIRTUAL_THREADS.md](theory/VIRTUAL_THREADS.md)

- [ ] Что это такое: стек в куче, mount/unmount, потоки-носители → [§2](theory/VIRTUAL_THREADS.md)
- [ ] Что даёт на практике: замеры, миллион потоков → [§3](theory/VIRTUAL_THREADS.md)
- [ ] Pinning: механизм, замер, диагностика, JDK 24 → [§4](theory/VIRTUAL_THREADS.md)
- [ ] Пул перестаёт быть регулятором нагрузки → [§5](theory/VIRTUAL_THREADS.md)
- [ ] Чего виртуальные потоки не дают → [§6](theory/VIRTUAL_THREADS.md)
- [ ] `ScopedValue` и `StructuredTaskScope` — и их реальный статус → [§7–8](theory/VIRTUAL_THREADS.md)
- [ ] Порядок миграции → [§9](theory/VIRTUAL_THREADS.md)

**Упражнения:**
- [ ] [Ex12: VirtualThreads](src/main/kotlin/exercises/Ex12_VirtualThreads.kt)

---

## Прикладная часть (Java)

Задачи «как в проде», с тестами: `src/main/java/applied/`.
Запуск: `mvn test -Dtest=ClassName`.

- [ ] `reservations` — бронирование с проверкой доступности (TOCTOU)
- [ ] `bank` — переводы, оптимистичная блокировка, порядок захвата
- [ ] `cache` — LRU с конкурентной загрузкой
- [ ] `orderbook` — биржевой стакан, атомарный снимок
- [ ] `scheduler` — планировщик задач
- [ ] `ratelimiter` — ограничитель частоты (token bucket)

Вопросы по этой части — раздел 10 в [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md).

---

## Самопроверка

- [ ] [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md) — 82 вопроса с ответами и источниками.
- [ ] Вопросы в конце каждого файла теории — они проверяют понимание механизма, а не запоминание API.
- [ ] Замеры из теории воспроизводимы: каждый прогоняется одной командой `java Файл.java`.
      Повторите у себя — цифры будут другие, выводы те же.

---

## Файлы теории

| Файл | Модуль | О чём |
|------|--------|-------|
| [WHY_CONCURRENCY.md](theory/WHY_CONCURRENCY.md) | 0 | зачем и чем платим |
| [THREADS_BASICS.md](theory/THREADS_BASICS.md) | 1 | поток, прерывание, `synchronized`, `wait/notify`, `ThreadLocal` |
| [MEMORY_MODEL.md](theory/MEMORY_MODEL.md) | 2 | видимость, happens-before, публикация |
| [JUC_INTERNALS.md](theory/JUC_INTERNALS.md) | 3 | AQS, `park`/`unpark`, стык с Loom |
| [LOCKS.md](theory/LOCKS.md) | 4 | `ReentrantLock`, `Condition`, `ReadWriteLock`, `StampedLock` |
| [ATOMIC_CAS.md](theory/ATOMIC_CAS.md) | 5 | CAS, цена, `LongAdder`, `VarHandle` |
| [CONCURRENT_COLLECTIONS.md](theory/CONCURRENT_COLLECTIONS.md) | 6 | `ConcurrentHashMap`, очереди, COW, skip list |
| [SYNCHRONIZERS.md](theory/SYNCHRONIZERS.md) | 7 | latch, barrier, semaphore, phaser, exchanger |
| [EXECUTORS_FUTURES.md](theory/EXECUTORS_FUTURES.md) | 8 | пулы, очереди, отказы, `ForkJoinPool` |
| [ASYNC_COMPOSITION.md](theory/ASYNC_COMPOSITION.md) | 9 | `CompletableFuture` изнутри |
| [PROBLEMS.md](theory/PROBLEMS.md) | 10 | deadlock, livelock, голодание, диагностика |
| [VIRTUAL_THREADS.md](theory/VIRTUAL_THREADS.md) | 11 | Loom, pinning, миграция |
