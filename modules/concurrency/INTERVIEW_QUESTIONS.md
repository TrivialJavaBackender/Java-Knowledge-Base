# Java Concurrency — Вопросы для собеседований

Источники: JCP = "Java Concurrency in Practice" (Goetz), JLS = Java Language Specification, JD = Javadoc

---

## 1. Основы потоков и synchronized

### Q1: Чем отличается `Runnable` от `Callable`?
**A:** `Runnable.run()` — void, не бросает checked exceptions. `Callable.call()` — возвращает значение и может бросить Exception. `Callable` используется с `ExecutorService.submit()`, возвращает `Future<T>`.
> JCP §6.3.2

### Q2: Что такое monitor в Java? Как работает synchronized?
**A:** Каждый объект в Java имеет встроенный монитор (intrinsic lock). `synchronized` захватывает монитор объекта. Только один поток может владеть монитором. `synchronized` — reentrant: поток может повторно захватить уже захваченный им монитор. При synchronized-методе — монитор `this` (или `Class` для static).
> theory/THREADS_BASICS.md §5

### Q3: Почему wait/notify должны вызываться внутри synchronized?
**A:** Потому что они работают с монитором объекта. `wait()` атомарно отпускает монитор и усыпляет поток. Без `synchronized` будет `IllegalMonitorStateException`. Это предотвращает lost wakeup race condition: между проверкой условия и вызовом wait() другой поток может вызвать notify().
> theory/THREADS_BASICS.md §6

### Q4: В чём разница между `notify()` и `notifyAll()`?
**A:** `notify()` будит один произвольный поток, `notifyAll()` — все ждущие. Почти всегда следует использовать `notifyAll()`, потому что `notify()` может привести к «hijacked signal» — пробудится поток, которому уведомление не предназначено, и сигнал будет потерян для нужного потока.
> theory/THREADS_BASICS.md §6

### Q5: Что такое daemon thread?
**A:** Фоновый поток. JVM завершается, когда остались только daemon-потоки. Создаётся через `thread.isDaemon = true` ДО `start()`. GC, finalizer — daemon threads.
> theory/THREADS_BASICS.md §3

### Q83: Что физически делает `interrupt()`, если поток спит в `sleep()`, а что — если он крутится в обычном цикле?
**A:** `interrupt()` всегда поднимает флаг прерывания. Дальше зависит от того, где поток находится: если он спит в `sleep()`, `wait()`, `join()` или `park()` — эти методы прерывают ожидание немедленно; `sleep`/`wait`/`join` при этом бросают `InterruptedException` и **сбрасывают флаг обратно в false**, а `LockSupport.park()` просто возвращается, оставляя флаг поднятым. Если поток в этот момент считает в обычном цикле — ничего не происходит: флаг просто выставлен, а цикл, который его не проверяет (`while (!Thread.currentThread().isInterrupted())`), не узнает о запросе и не остановится сам по себе.
> theory/THREADS_BASICS.md §4

### Q84: Чем плохо `catch (InterruptedException e) {}`, и как правильно реагировать, если метод не может пробросить исключение дальше?
**A:** `sleep`/`wait`/`join` при прерывании сбрасывают флаг, поэтому пустой `catch` не просто «съедает» исключение — он единственный источник сигнала об отмене, и без него код выше по стеку (например, цикл пула, решающий, пора ли завершаться) никогда не узнает, что была команда остановиться. Если сигнатура метода позволяет — `InterruptedException` пробрасывается как есть. Если нет (например, реализация `Runnable.run()`) — единственный правильный вариант: вызвать `Thread.currentThread().interrupt()` в `catch`, чтобы восстановить флаг, и после этого завершить цикл или метод.
> theory/THREADS_BASICS.md §4

### Q85: Остановит ли `interrupt()` поток, застрявший в `socket.getInputStream().read()`?
**A:** Нет. Прерывание — это протокол, который понимают только методы, специально написанные под него (`sleep`, `wait`, `join`, `park`, каналы `java.nio`). Обычное блокирующее чтение сокета ничего не знает о флаге прерывания и продолжит ждать данные бесконечно. Рабочие способы прервать такое ожидание: закрыть ресурс из другого потока (`socket.close()` заставит `read()` бросить `SocketException`), использовать `InterruptibleChannel`, либо изначально выставить таймаут на уровне клиента (`setSoTimeout`, таймауты `HttpClient`).
> theory/THREADS_BASICS.md §4

### Q86: Значит ли состояние `RUNNABLE` в дампе потоков, что поток прямо сейчас выполняется на процессоре?
**A:** Нет. `RUNNABLE` означает «выполняется или готов к выполнению» — JVM не различает эти два случая. Поток, заблокированный на чтении из сокета или на другом системном вызове, тоже показан как `RUNNABLE`, потому что ожидание происходит в нативном коде, о котором JVM ничего не сообщает. Судить о загрузке процессора по числу потоков в `RUNNABLE` нельзя — нужны отдельные CPU-метрики или профилировщик. А вот `BLOCKED` (ждёт монитор `synchronized`) и `WAITING`/`TIMED_WAITING` (ждёт события) — это гарантированно не работа на процессоре.
> theory/THREADS_BASICS.md §2

---

## 2. volatile и Java Memory Model

### Q6: Что гарантирует volatile?
**A:** **Visibility** — запись в volatile переменную видна всем потокам немедленно (flush в main memory). **Ordering** — запись в volatile создаёт happens-before отношение с последующим чтением той же переменной. НЕ гарантирует атомарность: `volatile int count; count++` — НЕ атомарно (read-modify-write).
> theory/MEMORY_MODEL.md §5

### Q7: Что такое happens-before?
**A:** Отношение частичного порядка между операциями, определённое JMM. Если операция A happens-before B, то результаты A гарантированно видны B. Ключевые правила:
1. Внутри одного потока: program order
2. `synchronized`: unlock HB lock того же монитора
3. `volatile`: запись HB чтения той же переменной
4. `Thread.start()` HB первая операция в потоке
5. Последняя операция потока HB `join()`
6. Транзитивность: A HB B, B HB C → A HB C
> theory/MEMORY_MODEL.md §4

### Q8: Что такое false sharing и как его избежать?
**A:** Когда две переменные, используемые разными потоками, попадают в одну кэш-линию (64 байта). Изменение одной инвалидирует кэш-линию для другого ядра, хотя данные не связаны. Решение: `@Contended` аннотация (Java 8+), padding.
> theory/ATOMIC_CAS.md §3

---

## 3. Atomic и CAS

### Q9: Как работает CAS (Compare-And-Swap)?
**A:** Атомарная CPU-инструкция (CMPXCHG на x86). Три параметра: адрес, ожидаемое значение (expected), новое значение (new). Если текущее значение == expected → записывает new, возвращает true. Иначе ничего не делает, возвращает false. `AtomicInteger.compareAndSet()` — обёртка над CAS.
> theory/ATOMIC_CAS.md §1

### Q10: Что такое ABA-проблема? Как решить?
**A:** Поток читает A, другой поток меняет A→B→A. CAS видит A и думает что ничего не менялось, хотя состояние могло измениться. Решение: `AtomicStampedReference` — хранит версию (stamp) вместе со ссылкой. CAS проверяет и значение, и stamp.
> theory/ATOMIC_CAS.md §5

### Q11: Когда использовать LongAdder вместо AtomicLong?
**A:** `LongAdder` быстрее при высоком contention (много потоков инкрементируют). Внутри хранит массив ячеек (Cell[]), каждый поток инкрементирует свою ячейку, sum() складывает все. Минус: `sum()` не точен в момент конкурентных записей. Используй `AtomicLong` когда нужен точный get() и CAS, `LongAdder` — для статистики/метрик.
> theory/ATOMIC_CAS.md §6

### Q93: Чем `VarHandle.getAcquire()`/`setRelease()` дешевле обычного `volatile`, если happens-before гарантия та же?
**A:** `volatile` реализован через самый дорогой барьер памяти — `StoreLoad`, который упорядочивает запись относительно **всех** последующих операций, в том числе на других полях. Режимы `acquire`/`release` у `VarHandle` дают ровно ту гарантию, которая нужна для типичной публикации данных («всё, записанное до `setRelease`, видно после `getAcquire` того же поля»), но не требуют полного `StoreLoad`-барьера — они дешевле, потому что упорядочивают меньше. `VarHandle` вообще даёт выбор из четырёх уровней силы (`plain` → `opaque` → `acquire/release` → `volatile`) для каждого конкретного обращения к полю, а не один режим сразу на всё поле, как обычный модификатор `volatile`. Именно в этом стиле написаны внутренности `ConcurrentHashMap` и AQS.
> theory/ATOMIC_CAS.md §7

### Q94: Как устроен lock-free стек (стек Трейбера) на `AtomicReference`, и где в нём прячется ABA?
**A:** `push` и `pop` — это CAS-цикл над указателем на вершину (`top`): прочитать текущую вершину, подготовить новый узел (для `push`) или взять `next` (для `pop`), и попытаться атомарно подменить `top`, повторяя при неудаче. Прогресс гарантирован без единой блокировки. ABA прячется в `pop`: между чтением `old = top.get()` и `compareAndSet(old, old.next)` другой поток может вытащить `old`, вытащить ещё несколько узлов и положить обратно узел с тем же адресом — CAS увидит то же значение `old` и решит, что ничего не изменилось, хотя `old.next` уже указывает не туда. Решение то же, что и вообще для `AtomicReference`, — `AtomicStampedReference`, добавляющий версию к сравниваемому значению.
> theory/ATOMIC_CAS.md §8

---

## 4. Concurrent Collections

### Q12: Как работает ConcurrentHashMap в Java 8?
**A:** Массив Node[], каждый bucket — связный список или TreeBin (при >8 элементах). Блокировка на уровне корзины (bucket) через `synchronized(node)` (не сегменты как в Java 7). `putVal` использует CAS для пустого корзины (bucket) и synchronized для существующего. Не допускает null ключи и значения (в отличие от HashMap).
> theory/CONCURRENT_COLLECTIONS.md §3

### Q13: Зачем ConcurrentHashMap запрещает null?
**A:** Неоднозначность: `map.get(key) == null` — ключа нет или значение null? В однопоточном HashMap можно проверить `containsKey()`, но в concurrent среде между get и containsKey другой поток мог изменить map. Doug Lea: "null in concurrent collections is a recipe for hidden bugs."
> theory/CONCURRENT_COLLECTIONS.md §3

### Q14: Что такое weakly consistent iterator?
**A:** Итератор ConcurrentHashMap гарантирует: не бросит ConcurrentModificationException, отразит состояние map на момент создания итератора, МОЖЕТ (но не обязан) отразить изменения после создания. В отличие от fail-fast итераторов HashMap.
> theory/CONCURRENT_COLLECTIONS.md §9

### Q15: Когда использовать CopyOnWriteArrayList?
**A:** Когда чтений намного больше, чем записей. Каждая мутация создаёт новую копию массива → дорого для записи, но итератор никогда не бросит CME и не нужна синхронизация для чтения. Пример: список listeners/observers.
> theory/CONCURRENT_COLLECTIONS.md §6

### Q16: Какие BlockingQueue реализации и когда какую?
**A:**
- `ArrayBlockingQueue` — bounded, fair/unfair, backed by array. Для классического producer-consumer.
- `LinkedBlockingQueue` — optionally bounded (default Integer.MAX_VALUE), обычно выше throughput чем ABQ.
- `PriorityBlockingQueue` — unbounded, элементы по приоритету.
- `SynchronousQueue` — zero capacity, put блокируется пока кто-то не сделает take. Для handoff.
- `DelayQueue` — элементы доступны только после задержки.
> theory/CONCURRENT_COLLECTIONS.md §5

### Q95: Назовите три ситуации, когда `ConcurrentHashMap` — избыточный или неверный выбор.
**A:** (1) Коллекция заполняется один раз и дальше только читается — обычная `HashMap`, опубликованная через `final`-поле или `Map.copyOf()`, не нуждается в синхронизации вовсе, а `ConcurrentHashMap` платит за защиту, которая не используется. (2) Нужна атомарность **нескольких операций сразу**, например «переложить элемент из одной карты в другую», — ни одна конкурентная коллекция такого не даёт, каждая её операция атомарна только сама по себе, нужен лок вокруг обеих карт. (3) Конкуренции почти нет, а критические секции короткие — на таких данных обычный `synchronized` иногда обходит более сложные механизмы просто потому, что сложность не окупается. Правило: не усложняйте, пока не измерили.
> theory/CONCURRENT_COLLECTIONS.md §4

---

## 5. ExecutorService и пулы потоков

### Q17: Почему нельзя использовать `Executors.newFixedThreadPool()` в продакшене?
**A:** Внутри использует `LinkedBlockingQueue` (unbounded). При быстром поступлении задач и медленной обработке очередь растёт бесконечно → OutOfMemoryError. `Executors.newCachedThreadPool()` — другая проблема: maxPoolSize = Integer.MAX_VALUE, может создать слишком много потоков. Лучше создавать `ThreadPoolExecutor` напрямую с bounded queue и rejection policy.
> theory/EXECUTORS_FUTURES.md §5

### Q18: Какие rejection policies есть у ThreadPoolExecutor?
**A:**
- `AbortPolicy` (default) — бросает `RejectedExecutionException`
- `CallerRunsPolicy` — задача выполняется в вызывающем потоке (back-pressure)
- `DiscardPolicy` — молча отбрасывает задачу
- `DiscardOldestPolicy` — удаляет самую старую задачу из очереди, ставит новую
> theory/EXECUTORS_FUTURES.md §4

### Q19: В чём разница thenApply vs thenCompose в CompletableFuture?
**A:** `thenApply(fn)` — fn возвращает значение T → `CF<T>`. Аналог `map`. `thenCompose(fn)` — fn возвращает `CF<T>` → `CF<T>` (flatMap). Если fn уже возвращает CompletableFuture, используй thenCompose, иначе получишь `CF<CF<T>>`.
> theory/ASYNC_COMPOSITION.md §4

### Q20: Как работает ForkJoinPool и work-stealing?
**A:** Каждый поток имеет deque задач. Когда deque пуст — поток «ворует» задачи из хвоста deque другого потока. Fork() кладёт подзадачу в свой deque, compute() выполняет синхронно, join() ждёт результат. `commonPool()` используется parallel streams. Для CPU-bound задач: parallelism = кол-во ядер.
> theory/EXECUTORS_FUTURES.md §9

---

## 6. Synchronizers

### Q21: CountDownLatch vs CyclicBarrier?
**A:**
| | CountDownLatch | CyclicBarrier |
|---|---|---|
| Переиспользование | Одноразовый | Многоразовый (reset) |
| Кто делает countdown | Любой поток | Только участники (await) |
| Barrier action | Нет | Да (Runnable при достижении) |
| Сценарий | "Ждать N событий" | "Все потоки на точке синхронизации" |
> theory/SYNCHRONIZERS.md §2

### Q22: Зачем нужен Semaphore?
**A:** Ограничение количества одновременных доступов к ресурсу. `acquire()` уменьшает permits, `release()` увеличивает. Permits может быть >1 (в отличие от Lock). Бинарный семафор (permits=1) ≈ Lock, но non-reentrant и без владельца (любой поток может release).
> theory/SYNCHRONIZERS.md §3

---

## 7. Deadlock и проблемы многопоточности

### Q23: Какие 4 условия необходимы для deadlock (условия Коффмана)?
**A:**
1. **Mutual exclusion** — ресурс занят эксклюзивно
2. **Hold and wait** — поток держит ресурс и ждёт другой
3. **No preemption** — ресурс нельзя отобрать принудительно
4. **Circular wait** — циклическая зависимость A→B→...→A

Убери любое из 4 — deadlock невозможен. На практике проще всего предотвратить circular wait (упорядочить блокировки).
> theory/PROBLEMS.md §1

### Q24: Как обнаружить deadlock?
**A:**
- `ThreadMXBean.findDeadlockedThreads()` — программно
- `jstack <pid>` — дамп стеков, показывает "Found one Java-level deadlock"
- `jconsole` / `VisualVM` — GUI
- Thread dump через `kill -3 <pid>` (Unix) или Ctrl+Break (Windows)
> theory/PROBLEMS.md §2

### Q25: Что такое livelock? Пример?
**A:** Потоки активны (не заблокированы), но не прогрессируют — постоянно реагируют на действия друг друга. Пример: два потока пытаются избежать deadlock через tryLock, отпускают блокировки одновременно и повторяют → бесконечный цикл. Решение: добавить случайную задержку (backoff).
> theory/PROBLEMS.md §3

### Q26: Что такое starvation? Как предотвратить?
**A:** Поток не может получить доступ к ресурсу неопределённо долго. Причины: unfair locks (потоки с более высоким приоритетом всегда выигрывают), длительные synchronized блоки. Решение: fair locks (`ReentrantLock(true)`), избегать priority manipulation, минимизировать scope блокировки.
> theory/PROBLEMS.md §4

### Q27: В чём разница race condition и data race?
**A:** **Race condition** — результат зависит от порядка выполнения потоков (логическая ошибка). Пример: check-then-act (`if (!map.containsKey(k)) map.put(k, v)`). **Data race** — два потока обращаются к одной переменной, хотя бы один пишет, без happens-before. Data race — undefined behavior по JMM. Race condition может быть без data race (с корректной синхронизацией, но неверной логикой).
> theory/MEMORY_MODEL.md §7

### Q87: Почему `while (true) { process(queue.take()); }` — типичный источник утечки потоков?
**A:** `take()` на пустой очереди блокирует поток бесконечно, а цикл не содержит способа выйти при остановке приложения. Если такой поток создаётся без пула (например, новый `Thread` на каждый запрос) и не помечен как daemon, он не даст JVM завершиться и будет висеть в `WAITING` вечно. Утечка накапливается медленно и незаметно: число потоков в метриках растёт, пока не наступит `OutOfMemoryError: unable to create native thread`. Та же проблема возникает, если поток реагирует на прерывание, но `InterruptedException` внутри проглочена пустым `catch`, — тогда даже вызов `interrupt()` снаружи не поможет его остановить.
> theory/PROBLEMS.md §5

---

## 8. Locks

### Q28: ReentrantLock vs synchronized?
**A:**
| | synchronized | ReentrantLock |
|---|---|---|
| Синтаксис | Блок/метод | Явный lock/unlock |
| tryLock | Нет | Да (с таймаутом) |
| Interruptible | Нет | `lockInterruptibly()` |
| Fairness | Unfair only | Fair/unfair |
| Condition | 1 (wait/notify) | Множество Condition |
| Производительность | ~Одинаково с Java 6+ |
| Рекомендация | По умолчанию | Когда нужны фичи выше |
> theory/LOCKS.md §2

### Q29: Что такое StampedLock? Когда использовать?
**A:** Lock с 3 режимами: write lock, read lock, optimistic read. Optimistic read НЕ блокирует — получаешь stamp, читаешь данные, проверяешь `validate(stamp)`. Если невалидный — fallback на обычный read lock. Быстрее ReadWriteLock при редких записях. НЕ reentrant, нельзя использовать с Condition.
> theory/LOCKS.md §5

### Q98: Зачем `ReentrantLock` даёт несколько объектов `Condition`, если `synchronized` + `wait/notifyAll` уже решают задачу «подождать условия»?
**A:** У обычного монитора **одна** очередь ожидания на объект. В ограниченном буфере есть два разных события — «есть место» и «есть данные», и `notifyAll()` вынужден будить всех подряд: производители просыпаются на сигнал для потребителей, проверяют своё условие, видят, что оно ложно, и снова засыпают впустую. `Condition` от `ReentrantLock` даёт отдельную очередь на каждое событие (`notFull`, `notEmpty`): `notFull.signal()` будит ровно одного производителя, а не всех подряд. Внутри `await()` продолжает действовать то же правило `while`, что и у `wait()`, — ложные пробуждения возможны и здесь. Именно так изнутри устроен `ArrayBlockingQueue`: один `ReentrantLock` и два `Condition`.
> theory/LOCKS.md §3

---

## 9. Virtual Threads (Java 21+)

### Q30: Чем виртуальные потоки отличаются от платформенных?
**A:** Platform thread = OS thread (1:1). Virtual thread — легковесный, управляется JVM (M:N scheduling). Миллионы виртуальных потоков на нескольких carrier threads. Блокирующие операции (sleep, I/O) не блокируют carrier — виртуальный поток unmount. Идеальны для I/O-bound задач.
> theory/VIRTUAL_THREADS.md §2

### Q31: Что такое pinning? Когда виртуальный поток "прибит"?
**A:** Виртуальный поток не может unmount от carrier при: (1) выполнении внутри `synchronized` блока, (2) вызове native метода. Используй `ReentrantLock` вместо `synchronized` с виртуальными потоками. Pinning можно обнаружить через `-Djdk.tracePinnedThreads=full`.
> theory/VIRTUAL_THREADS.md §4

### Q32: ThreadLocal vs ScopedValue?
**A:** `ThreadLocal` — переменная привязана к потоку, mutable, наследуется через `InheritableThreadLocal`. Проблема с virtual threads: миллионы потоков = миллионы копий. `ScopedValue` (preview) — immutable, автоматически ограничен областью видимости, эффективнее для structured concurrency.
> theory/VIRTUAL_THREADS.md §7

### Q88: Пул был `newFixedThreadPool(20)`, перешли на виртуальные потоки — чем теперь ограничивать конкурентность?
**A:** Раньше размер пула одновременно ограничивал и число задач, и число обращений к БД, и нагрузку на внешний API — один параметр держал всё сразу. С `newVirtualThreadPerTaskExecutor()` потоков может быть миллион, и все они одновременно постучатся в те же ресурсы. Правильный приём — ограничивать явно **то, что реально ограничено**, а не потоки: отдельный `Semaphore` под размер пула соединений к БД, отдельный `Semaphore` под лимит внешнего API. Заодно пул соединений (например, HikariCP) становится главным узким местом вместо пула потоков — его размер и таймауты требуют отдельного внимания.
> theory/VIRTUAL_THREADS.md §5

### Q89: Если запустить миллион виртуальных потоков, которые считают, а не ждут ввод-вывод, ускорится ли программа?
**A:** Нет, и это частая ошибка. Виртуальные потоки решают проблему дороговизны **ожидания** (блокирующий ввод-вывод дёшево снимает поток с носителя), но не добавляют вычислительных ядер. Для CPU-bound задачи миллион виртуальных потоков будут по очереди делить те же несколько носителей (`ForkJoinPool` размером в число ядер) — конкуренция за процессор останется такой же, как при обычном пуле, только сверху добавятся накладные расходы на переключение между виртуальными потоками. Для вычислений правильный инструмент — `ForkJoinPool` или пул размером с число ядер, а не виртуальные потоки.
> theory/VIRTUAL_THREADS.md §6

### Q90: Что даёт `StructuredTaskScope` сверх обычного связывания задач через `CompletableFuture`, и можно ли на него закладываться в продакшене?
**A:** Идея — дочерние задачи живут строго внутри блока родителя: `scope.join()` гарантирует, что при выходе из `try` все подзадачи либо завершены, либо отменены, а `throwIfFailed()` (в `ShutdownOnFailure`) сквозно распространяет отмену на ещё бегущие подзадачи при первой же ошибке. У `CompletableFuture` при падении одной ветви остальные продолжают жить сами по себе — источник утечек фоновых задач. Но статус важен: `StructuredTaskScope` — preview-API и на JDK 21, и на JDK 24 (нужен `--enable-preview`), а сигнатура `fork()` уже менялась между версиями (`Supplier<T>` → `Subtask<T>`). Концепцию знать для собеседования нужно, закладываться в продакшене — нет.
> theory/VIRTUAL_THREADS.md §8

---

## 10. Applied Concurrency Patterns

Перенесено из `system-design` (правило NO OVERLAP): прикладные паттерны для упражнений `applied/{reservations,bank,cache,orderbook,scheduler,ratelimiter}/`.

### Q33: В чём разница между pessimistic и optimistic locking?
**A:** Pessimistic предполагает конфликты и блокирует ресурс заранее (`synchronized`, `ReentrantLock`) — простая логика, retry не нужен, но throughput ограничен сериализацией. Optimistic считает конфликты редкими: операция выполняется без блокировки, при коммите проверяется версия (`AtomicStampedReference`, version-поле в БД). Высокий throughput при низком contention, но обязательна retry-логика, и при высоком contention деградирует из-за частых откатов.
> JCP §15.3

### Q34: Что такое TOCTOU и как его исправить?
**A:** Time-Of-Check Time-Of-Use — между проверкой условия и действием другой поток успел изменить состояние. Классический пример: `if (seats > 0) book()` — между `if` и `book` другой поток мог занять последнее место. Исправление: check и act выполняются атомарно под единой блокировкой (`synchronized(lock) { if (seats>0) book(); }`) или через CAS / compute-операции `ConcurrentHashMap` (`compute`, `computeIfPresent`).

### Q35: Как организовать гранулярные локи per-resource без deadlock?
**A:** `ConcurrentHashMap.computeIfAbsent(id, k -> new Object())` для создания per-id лок-объектов — `computeIfAbsent` атомарен, два потока не создадут два разных лока для одного ключа. При захвате нескольких локов всегда брать их в стабильном порядке (например, по возрастанию ID): `var first = id1.compareTo(id2) < 0 ? id1 : id2`. Нарушение порядка → циклическая зависимость → deadlock.
> JCP §10.1.2 («Lock Ordering»)

### Q36: Нужна ли retry-логика внутри synchronized блока с optimistic locking?
**A:** Нет. Pessimistic блокировка исключает конкурентный доступ, поэтому `OptimisticLockException` внутри `synchronized` невозможен — retry становится мёртвым кодом. Смешивать стратегии нельзя: либо pessimistic (`synchronized` без retry), либо optimistic (без `synchronized`, с retry снаружи). Смесь даёт ложное впечатление надёжности и усложняет рассуждения о корректности.

### Q37: Как реализовать idempotency для HTTP-операций через double-checked locking?
**A:** Алгоритм: (1) быстрая проверка кэша результатов без блокировки по idempotency-ключу; (2) если не найдено — захватить per-key лок через `computeIfAbsent`; (3) внутри лока **повторная** проверка кэша (другой поток мог записать пока мы ждали лок); (4) выполнить операцию и сохранить результат; (5) при необходимости очистить лок-объект. Idempotency-ключи и бизнес-данные хранятся в разных Map, чтобы TTL и eviction не пересекались.
> Stripe API — Idempotency Keys

### Q38: Когда использовать ReadWriteLock вместо synchronized?
**A:** Когда операций чтения **существенно** больше, чем записи, и критические секции длинные. `ReadWriteLock` позволяет нескольким читателям работать одновременно, блокируя только при записи. Бесполезен при коротких критических секциях (overhead acquire/release выше выгоды) и при balance 50/50 (write-lock starves читателей). Для read-heavy с очень короткими секциями — `StampedLock` с `tryOptimisticRead()` ещё быстрее: читаем без блокировки, валидируем stamp в конце.
> JCP §13.3

### Q39: Как сделать thread-safe LRU-кэш?
**A:** Два подхода: (1) `synchronized` оборачивает весь кэш — просто, но не масштабируется при высокой нагрузке; (2) `ReentrantReadWriteLock` — read lock на `get` (только если get не обновляет порядок!), write lock на `put` и eviction. Проблема: классический LRU обновляет порядок при `get` — значит нужен write lock даже для чтения, и преимущество ReadWriteLock теряется. Альтернатива: использовать готовый Caffeine (W-TinyLFU) или `ConcurrentLinkedDeque` + `ConcurrentHashMap` с дополнительной синхронизацией для составных операций.

### Q40: В чём проблема с `computeIfAbsent` при рекурсивных вычислениях в ConcurrentHashMap?
**A:** `ConcurrentHashMap.computeIfAbsent` блокирует bucket на время выполнения mapping-функции. Если внутри mapping-функции снова обратиться к этому же ключу (или к другому ключу в том же корзине (bucket)) через любой compute-метод — deadlock или `IllegalStateException` (JDK 9+ детектирует reentrant modification). Решение: вычислить значение **вне** `computeIfAbsent`, затем `putIfAbsent`. Или использовать другую структуру (`Caffeine`).
> JDK-8161372

### Q41: Cache stampede — что это и как предотвратить?
**A:** При истечении TTL популярного ключа все ждущие потоки одновременно идут в БД → N параллельных идентичных запросов → каскадный сбой. Митигации: (1) **single-flight** — только один поток вычисляет, остальные ждут результат (per-key lock + future); (2) **probabilistic early expiration** — обновлять до истечения с вероятностью, растущей по мере приближения к TTL (XFetch); (3) **stale-while-revalidate** — возвращать устаревшее значение пока фоновый поток обновляет. Подробнее — `modules/caching-deep-dive/theory/ANTI_PATTERNS.md`.

### Q42: Как избежать memory leak в кэше с per-key локами?
**A:** `ConcurrentHashMap<Key, Lock>` накапливает локи без очистки → утечка пропорционально количеству ключей. Решения: (1) **Guava `Striped<Lock>`** — фиксированный массив N локов, ключ → `hash(key) % N`; коллизии возможны, но память константна; (2) **WeakReference**-значения — GC удаляет лок, когда нет внешних ссылок; (3) явная очистка через `remove(key)` после критической секции (при условии что nobody else holds the reference); (4) `Caffeine` с `expireAfterAccess` для самих локов.

### Q43: Как работает Token Bucket rate limiter?
**A:** Bucket ёмкостью `N` токенов, пополняется со скоростью `R` токенов/сек. Каждый запрос потребляет 1 токен; если токенов нет — отказ или ожидание. Реализация (lazy refill): хранить `lastRefillTime` и `tokens`; при каждом запросе вычислить `elapsed = now - lastRefill`, `tokens = min(capacity, tokens + elapsed * rate)`, обновить `lastRefillTime`. Атомарно через `synchronized` или `AtomicReference<State>` с CAS-loop. Позволяет burst до `N` запросов, после — rate-limited.

### Q44: Token Bucket vs Leaky Bucket vs Fixed Window vs Sliding Window?
**A:**
- **Fixed Window** — счётчик сбрасывается каждую секунду. Проблема: 2× burst на границе окон (1000 req в последний ms окна + 1000 в первый ms следующего).
- **Sliding Window** — точнее, но дорого: хранить timestamps всех запросов (или sliding window counter с интерполяцией).
- **Leaky Bucket** — очередь с фиксированной скоростью «утечки» (обработки). Сглаживает burst, но задерживает запросы (latency).
- **Token Bucket** — разрешает burst до ёмкости корзины (bucket), затем rate-limited. Баланс простоты и точности; де-факто стандарт (AWS, Stripe).

### Q45: Как реализовать distributed rate limiter?
**A:** Redis + Lua-скрипт обеспечивает атомарность check-then-act без гонок. Для fixed window: `INCR` + `EXPIRE` в одном Lua-блоке. Для sliding window: `ZADD timestamp` + `ZREMRANGEBYSCORE` (удалить старее окна) + `ZCARD` (текущее число). Альтернативы: Redis RedLock для распределённых локов (с известными оговорками Martin Kleppmann), Hazelcast `IAtomicLong`, или централизованный rate-limit сервис (API Gateway, Envoy `local_ratelimit` + `global_ratelimit`).
> Stripe Engineering — Scaling your API with rate limiters

### Q46: Как сделать атомарный snapshot concurrent структуры?
**A:** Без блокировки атомарный snapshot произвольной структуры **невозможен**. Варианты: (1) **read lock** на весь snapshot — простой, но блокирует записи; (2) **CopyOnWriteArrayList** / **CopyOnWriteArraySet** — итератор всегда snapshot на момент создания (дорогая запись); (3) **MVCC** — каждое изменение создаёт новую версию, readers работают со старой (`ConcurrentSkipListMap` даёт weakly-consistent итератор, но не atomic snapshot); (4) ImmutableMap с volatile reference и copy-on-write на верхнем уровне.

### Q47: Почему `size()` у ConcurrentLinkedQueue — O(n)?
**A:** CLQ — non-blocking lock-free очередь на CAS, она **не хранит** счётчик размера. Поддерживать атомарный счётчик потребовало бы CAS на каждый enqueue/dequeue — дополнительная contention-точка, обнуляющая преимущество lock-free. Поэтому `size()` итерирует всю очередь, что O(n) и даёт лишь приблизительный результат под нагрузкой. Если нужен O(1) размер — храните `AtomicInteger` отдельно или используйте `LinkedBlockingQueue` (у неё `size()` = O(1) ценой блокировки на push/pop).
> JD ConcurrentLinkedQueue

---

## 11. Внутренности `java.util.concurrent`

### Q48: Что физически происходит, когда поток вызывает `lock.lock()`, а лок занят?
**A:** Сначала быстрый путь: `compareAndSetState(0, 1)` — одна атомарная инструкция процессора, без обращения к ядру. Если не удалось, поток создаёт узел и ставит его в хвост двусвязной очереди ожидающих внутри AQS, немного крутится вхолостую (`Thread.onSpinWait()` — вдруг лок вот-вот освободится), помечает узел как `WAITING` и вызывает `LockSupport.park()`. Для платформенного потока `park` уходит в `Unsafe.park` → примитив ожидания ОС (futex / pthread_cond), и планировщик ядра снимает поток с процессора. Освобождение зеркально: `release` → `tryRelease` → `signalNext(head)` → `LockSupport.unpark(следующий)`.
> theory/JUC_INTERNALS.md §3

### Q49: Что означает поле `state` у `ReentrantLock`, `Semaphore`, `CountDownLatch`, `ReentrantReadWriteLock`?
**A:** Это одно `volatile int` в AQS, которому каждый синхронизатор придаёт свой смысл. `ReentrantLock` — счётчик вложенных захватов владельцем (0 = свободен). `Semaphore` — количество свободных разрешений. `CountDownLatch` — сколько событий ещё ждём (пропускает при 0). `ReentrantReadWriteLock` — два счётчика в одном слове: старшие 16 бит — читатели, младшие 16 — вложенность писателя; отсюда и ограничение в 65 535 одновременных читателей. Классы отличаются только реализацией `tryAcquire`/`tryRelease`.
> theory/JUC_INTERNALS.md §5

### Q50: Зачем у `park`/`unpark` семантика разрешения (permit)?
**A:** Она устраняет гонку «сигнал пришёл раньше засыпания». У каждого потока есть одно разрешение: `unpark(t)` его выдаёт, `park()` — забирает и возвращается немедленно, если разрешение уже есть. Поэтому `unpark`, вызванный до `park`, не теряется: поток просто не уснёт. Без этого свойства пришлось бы, как в `wait/notify`, держать монитор ради атомарности «проверил условие + уснул».
> theory/JUC_INTERNALS.md §4

### Q51: Почему любое ожидание проверяется в цикле `while`, а не в `if`?
**A:** Две причины. Первая — ложное пробуждение: javadoc `LockSupport.park` прямо допускает возврат «for no reason», и то же верно для `Object.wait`. Вторая — даже при настоящем сигнале между пробуждением и получением монитора условие мог изменить третий поток. Так устроен и сам AQS: `LockSupport.park` стоит внутри `for (;;)`, и после пробуждения `tryAcquire` вызывается заново.
> theory/JUC_INTERNALS.md §4

### Q52: Что такое barging и почему он включён по умолчанию?
**A:** Влезание без очереди: перед постановкой в очередь поток ещё раз пробует захватить лок, поэтому только что пришедший может обогнать того, кто давно ждёт. Причина — экономическая: разбудить спящий поток стоит переключения контекста (~1 мкс), а пришедший уже на процессоре и успел бы войти и выйти. `new ReentrantLock(true)` включает справедливый режим — порядок FIFO соблюдается, но каждая передача лока требует пробуждения, и пропускная способность падает. `synchronized` справедливым не бывает вообще.
> theory/JUC_INTERNALS.md §6

### Q53: Почему `ReentrantLock` не прибивает виртуальный поток к носителю, а `synchronized` на JDK 21 прибивает?
**A:** Всё в `java.util.concurrent` блокируется через `LockSupport.park()`, а этот метод в JDK 21 содержит развилку: `if (Thread.currentThread().isVirtual()) VirtualThreads.park(); else U.park(...)`. Для виртуального потока это снятие с носителя. `synchronized` блокируется инструкцией `monitorenter` внутри JVM, которая до JDK 24 про виртуальные потоки не знала — носитель оставался занят. Измеряется просто: 100 виртуальных потоков, каждый спит 100 мс под собственным локом, дают 1051 мс с `synchronized` и 105 мс с `ReentrantLock` (JDK 21, 10 ядер); на JDK 24 после JEP 491 — 110 мс в обоих случаях.
> theory/JUC_INTERNALS.md §8

### Q54: Правда ли, что `ReentrantLock` быстрее `synchronized` при высокой конкуренции?
**A:** Это утверждение времён Java 5, сегодня неверно. На 8 потоках по миллиону инкрементов замер даёт `synchronized` 41–74 мс против `ReentrantLock` 64–66 мс — монитор скорее выигрывает, хотя разброс у него больше (работа адаптивных эвристик JVM). Выбирать `ReentrantLock` следует не за скорость, а за возможности: `tryLock`, таймаут, `lockInterruptibly`, несколько `Condition` — и за отсутствие pinning на JDK 21–23.
> theory/JUC_INTERNALS.md §7

### Q55: Зачем `Thread.onSpinWait()` и почему AQS крутится вхолостую перед `park`?
**A:** `onSpinWait` — подсказка процессору «я в цикле ожидания» (инструкция `PAUSE` на x86), она снижает энергопотребление и не мешает соседнему гиперпотоку. AQS делает короткое активное ожидание, потому что поход в ядро стоит переключения контекста, а критические секции обычно короткие: если лок освободится через сотню тактов, дешевле подождать, чем засыпать и просыпаться.
> theory/JUC_INTERNALS.md §3

---

## 12. Асинхронная композиция

### Q56: Из каких полей состоит `CompletableFuture` и как он работает?
**A:** Из двух: `volatile Object result` (значение либо обёртка `AltResult` с исключением) и `volatile Completion stack` — стек Трейбера зависимых действий. `thenApply` смотрит на `result`: если он уже есть — выполняет функцию **немедленно в вызывающем потоке**; если нет — создаёт пустой `CompletableFuture`, кладёт узел `UniApply` на стек и сразу возвращается. Когда кто-то его завершает, `postComplete()` снимает стек и выполняет накопленные действия — циклом, а не рекурсией, чтобы длинная цепочка не переполнила стек. То есть `CompletableFuture` — это стек колбеков, написанный руками.
> theory/ASYNC_COMPOSITION.md §2

### Q57: В каком потоке выполнится `thenApply`?
**A:** В том, у кого оказался результат. Если на момент вызова результат уже готов — в вызывающем потоке, синхронно. Если нет — в том потоке, который потом вызовет `complete()` (это может быть поток HTTP-клиента, таймера, чужой библиотеки). Гарантий нет никаких, поэтому нельзя класть в неасинхронные стадии долгую или блокирующую работу — вы займёте чужой поток. Предсказуемость даёт только `thenApplyAsync(fn, executor)` с явным пулом.
> theory/ASYNC_COMPOSITION.md §3

### Q58: Чем `thenApply` отличается от `thenCompose`?
**A:** Типом функции. `thenApply` принимает `T → U` и заворачивает результат: если функция сама вернёт `CompletableFuture`, получится `CF<CF<U>>`, который придётся разворачивать вручную. `thenCompose` принимает `T → CF<U>` и разворачивает сам, давая `CF<U>`. Это соотношение `map` и `flatMap`, но проще запоминать по типу результата: функция возвращает значение — `thenApply`, функция возвращает `CompletableFuture` — `thenCompose`.
> theory/ASYNC_COMPOSITION.md §4

### Q59: Чем опасен `ForkJoinPool.commonPool()`?
**A:** Это общий ресурс JVM: его делят `parallelStream()` и все `supplyAsync`/`*Async` без явного executor. Параллелизм по умолчанию — `availableProcessors() - 1`. Если занять его блокирующими задачами, страдает код в совершенно другом месте программы: в замере параллельный поток данных из 8 элементов по 100 мс занял 830 мс вместо ~100, потому что свободных потоков не осталось. Правило: в приложении всегда передавайте собственный `Executor`.
> theory/ASYNC_COMPOSITION.md §5

### Q60: Почему `join()` внутри стадии — ошибка?
**A:** Стадия выполняется в потоке пула. Если внутри неё вызвать `join()` на другом `CompletableFuture`, задача которого ждёт свободного потока того же пула, получится взаимная блокировка через пул: поток занят ожиданием задачи, которой негде выполниться. Чем меньше пул, тем вероятнее. Правильно связать стадии без блокировки — `thenCompose`.
> theory/ASYNC_COMPOSITION.md §5

### Q61: Почему `join()` бросает `CompletionException`, а `get()` — `ExecutionException`?
**A:** `get()` объявлен в интерфейсе `Future` и обязан бросать проверяемое `ExecutionException`. `join()` — собственный метод `CompletableFuture`, он бросает непроверяемое `CompletionException`, чтобы его можно было вызывать внутри лямбд без `try/catch`. Настоящая причина в обоих случаях лежит в `getCause()`. Практическое следствие: в `exceptionally`/`handle` приходит обёртка, и её нужно разворачивать перед проверкой типа.
> theory/ASYNC_COMPOSITION.md §6

### Q62: Что делает `cancel(true)` у `CompletableFuture` и что делает `orTimeout`?
**A:** Ни то, ни другое не останавливает уже выполняющуюся работу. Javadoc `CompletableFuture.cancel` говорит дословно: «this value has no effect in this implementation because interrupts are not used to control processing» — отменяется сам объект `CompletableFuture`, а задача в пуле дорабатывает до конца и занимает поток. `orTimeout` точно так же завершает его ошибкой `TimeoutException`, но задача продолжает выполняться. Настоящий таймаут возможен только на уровне клиента (HTTP, JDBC, драйвер), который умеет закрыть соединение. Отличие от `FutureTask` (результата `ExecutorService.submit`): там `cancel(true)` действительно вызывает `Thread.interrupt()`.
> theory/ASYNC_COMPOSITION.md §7

### Q63: Почему `anyOf` не годится для «взять первый успешный ответ из трёх реплик»?
**A:** `anyOf` завершается по первому **завершившемуся** этапу, включая упавший. Если быстрая реплика ответила ошибкой за 50 мс, а медленная успехом за 300 мс, `anyOf` вернёт ошибку. «Первый успешный» собирается вручную: подписаться на все через `whenComplete`, при первом успехе завершить общий `CompletableFuture`, а счётчик оставшихся использовать, чтобы сообщить об ошибке, только когда упали все.
> theory/ASYNC_COMPOSITION.md §7

### Q99: Как реализовать повтор с задержкой (retry) поверх `CompletableFuture`, не блокируя поток на время паузы?
**A:** Блокирующий `Thread.sleep()` между попытками испортил бы весь смысл асинхронного кода — он занял бы поток пула на время паузы. Правильная схема: при ошибке (`exceptionallyCompose`, Java 12+) вернуть новую `CompletableFuture`, которая сама завершится через нужную задержку и запустит следующую попытку — например, через `CompletableFuture.delayedExecutor(ms, unit)` (штатный способ «выполнить через N мс» без своего `ScheduledExecutorService`, появился в Java 9). Каждая попытка возвращает новый `CompletableFuture`, и цепочка `exceptionallyCompose` разворачивается сама, не блокируя ни один поток на время ожидания между попытками.
> theory/ASYNC_COMPOSITION.md §8

---

## 13. Пулы под нагрузкой

### Q64: Что хранится в поле `ctl` у `ThreadPoolExecutor` и зачем такая упаковка?
**A:** Один `AtomicInteger`: старшие 3 бита — состояние пула (`RUNNING`, `SHUTDOWN`, `STOP`, `TIDYING`, `TERMINATED`), младшие 29 — число живых потоков. Упаковка нужна, чтобы одним атомарным чтением получить и состояние, и счётчик согласованно — иначе между проверкой «пул ещё работает?» и «сколько потоков?» мог бы вклиниться `shutdown()`. Отсюда же формальный потолок `maximumPoolSize` — 2²⁹−1.
> theory/EXECUTORS_FUTURES.md §2

### Q65: Пул создан как `core=10, max=100` с обычной `LinkedBlockingQueue`. Сколько потоков будет под нагрузкой?
**A:** Десять. Порядок приёма задачи — core → очередь → max → отказ: новый поток сверх `corePoolSize` создаётся, **только если очередь отказалась принять задачу**. Неограниченная `LinkedBlockingQueue` не отказывается никогда, поэтому `maximumPoolSize` не работает вовсе, а перегрузка копится в куче до `OutOfMemoryError`. Именно поэтому `Executors.newFixedThreadPool` не годится для продакшена — опасен не размер пула, а неограниченная очередь.
> theory/EXECUTORS_FUTURES.md §2

### Q66: Как посчитать размер пула для задач, которые ждут ввода-вывода?
**A:** Формула из JCP §8.2: `N = Nядер × Uцелевая × (1 + W/C)`, где `W` — время ожидания, `C` — время вычислений. Либо через закон Литтла: `L = λ × W` (интенсивность × время пребывания). Но обе формулы дают лишь верхнюю границу: на практике размер чаще диктуется внешним ограничением — размером пула соединений к БД, лимитом внешнего API, памятью. Берут минимум из формулы и внешних ограничений, а под разные зависимости заводят отдельные пулы (bulkhead).
> theory/EXECUTORS_FUTURES.md §3

### Q67: Куда девается исключение из `submit(Runnable)`?
**A:** В `Future`, и больше никуда. `submit` заворачивает задачу в `FutureTask`, который ловит любое исключение и сохраняет его; `UncaughtExceptionHandler` при этом не вызывается — с точки зрения потока исключения не было. Если результат никто не запрашивает (а при `Runnable` обычно не запрашивают), ошибка исчезает бесследно. `execute(Runnable)` ведёт себя иначе: исключение долетает до `UncaughtExceptionHandler` потока. Правило: не нужен результат — используйте `execute`, либо обязательно читайте `Future`, либо оборачивайте тело задачи в `try/catch`.
> theory/EXECUTORS_FUTURES.md §7

### Q68: Периодическая задача бросила исключение. Что будет со следующими запусками?
**A:** Их не будет. Javadoc `ScheduledExecutorService` формулирует прямо: «Subsequent executions are suppressed» — задача отменяется навсегда, и молча: `Future` переходит в `isDone() == true`, а причина видна только через `get()`, который обычно никто не вызывает. Это классический продакшен-инцидент «фоновая синхронизация работала полгода и однажды перестала». Правило: тело периодической задачи всегда целиком оборачивается в `try/catch (Throwable)`.
> theory/EXECUTORS_FUTURES.md §7

### Q69: Чем `CallerRunsPolicy` отличается от остальных политик по смыслу?
**A:** Остальные решают судьбу задачи (отклонить, выбросить), а `CallerRunsPolicy` регулирует **источник нагрузки**: задача выполняется в вызывающем потоке, и пока он занят, он не принимает новые запросы. Это простейший работающий механизм обратного давления (backpressure) в JDK: перегрузка естественным образом замедляет поставщика вместо того, чтобы копиться в очереди.
> theory/EXECUTORS_FUTURES.md §4

### Q70: Почему `Executors.newWorkStealingPool()` работает не в LIFO-режиме?
**A:** Эта фабрика создаёт `ForkJoinPool` с `asyncMode = true`, а по javadoc конструктора такой режим «establishes local first-in-first-out scheduling mode for forked tasks that are never joined». То есть локальная очередь становится FIFO. LIFO для своих задач и FIFO для краж — это поведение **обычного** `ForkJoinPool` и `commonPool`; `asyncMode` предназначен для потока независимых событий, а не для рекурсивного деления.
> theory/EXECUTORS_FUTURES.md §9

### Q71: Почему `ThreadLocal` в пуле потоков — источник двух разных проблем?
**A:** Потоки пула переиспользуются, а `ThreadLocal` привязан к потоку, а не к задаче. Первая проблема — утечка данных между задачами: следующий запрос увидит контекст предыдущего (например, идентификатор чужого пользователя), что уже является дефектом безопасности. Вторая — утечка памяти: значение живёт, пока жив поток, а потоки пула живут вечно; ключи в `ThreadLocalMap` слабые, а значения — обычные ссылки. Лечение одно: `finally { tl.remove(); }`, именно `remove()`, а не `set(null)`.
> theory/THREADS_BASICS.md §7

### Q96: Задача выполняется 15 секунд, период задан как 10 секунд. Чем `scheduleAtFixedRate` будет отличаться от `scheduleWithFixedDelay`?
**A:** `scheduleAtFixedRate` планирует старты «по часам» от начального момента (0, 10, 20…) независимо от длительности самой задачи — если задача не укладывается в период, следующий запуск стартует сразу после окончания предыдущего: наложения не будет, но запуски опоздают (при 15-секундной задаче и периоде 10 старты будут 0, 15, 30…). `scheduleWithFixedDelay` всегда выдерживает паузу **после окончания** предыдущего запуска — старты будут 0, 25, 50… Выбор зависит от смысла: важна частота (heartbeat, метрики) — `AtFixedRate`; важно не нагружать систему подряд (тяжёлая синхронизация с БД) — `WithFixedDelay`.
> theory/EXECUTORS_FUTURES.md §8

### Q97: Чем `ExecutorCompletionService` полезнее, чем просто перебрать `List<Future<T>>` в порядке отправки?
**A:** `future.get()` в цикле по списку блокируется в **том порядке, в котором задачи были отправлены** — если первая задача самая медленная, а вторая и третья давно готовы, вызывающий код всё равно будет ждать первую, прежде чем увидеть уже готовые результаты. `ExecutorCompletionService` кладёт завершившиеся задачи во внутреннюю очередь, и `take()` отдаёт **первую готовую**, независимо от порядка отправки. Для задач разной длительности это позволяет начать обработку результата сразу, как только он готов, а не ждать самую медленную из пачки.
> theory/EXECUTORS_FUTURES.md §10

---

## 14. Модель памяти (углублённо)

### Q72: Почему цикл `while (running) {}` не завершается без `volatile`? Дело в кэше?
**A:** Нет. Кэши процессоров когерентны — ядро не может «не увидеть» чужую запись. Проблема возникает раньше, на уровне компилятора: JIT видит, что внутри цикла `running` не изменяется, и поднимает чтение за пределы цикла (loop hoisting), фактически превращая код в `boolean local = running; while (local) {}`. Это законная оптимизация в отсутствие синхронизации. Проверяется прогоном: без `volatile` поток висит вечно, с `volatile` он делает миллиарды итераций в секунду и видит изменение мгновенно — то есть никакой кэш «не сбрасывался» дольше секунды.
> theory/MEMORY_MODEL.md §1

### Q73: Могут ли два потока, выполняя `x=1; r1=y` и `y=1; r2=x`, оба прочитать 0?
**A:** Да. Перебор всех порядков «на бумаге» такого результата не даёт, но на реальном железе он воспроизводится: в прогоне на 200 000 повторений случай `r1==0 && r2==0` встретился 810 раз. Причины две и обе легальны: запись попадает в буфер записи ядра и становится видимой другим не сразу (переупорядочивание `StoreLoad` разрешено и на x86, и на ARM), плюс между независимыми записью и чтением нет зависимости по данным, и JIT вправе поменять их местами.
> theory/MEMORY_MODEL.md §2

### Q74: Что на самом деле делает `volatile`?
**A:** Две вещи: запрещает компилятору оптимизировать доступ к полю (держать в регистре, поднимать из цикла, переставлять) и заставляет JIT вставить нужные барьеры памяти. Формулировка «сбрасывает кэш в основную память» описывает несуществующий механизм. Правильная формулировка — «устанавливает отношение happens-before». Дополнительно `volatile` даёт атомарность чтения и записи `long`/`double`, которой у обычных 64-битных полей по JLS §17.7 нет.
> theory/MEMORY_MODEL.md §3

### Q75: Поле `data` не помечено `volatile`, а флаг `ready` — помечен. Почему после `if (ready)` данные видны?
**A:** По транзитивности happens-before. Запись `data` предшествует записи `ready` по порядку программы; запись `volatile ready` предшествует его чтению по правилу `volatile`; чтение `ready` предшествует чтению `data` снова по порядку программы. Цепочка даёт `запись data → чтение data`. Именно поэтому обычно синхронизируют один флаг, а видимость получают для всех данных — и именно поэтому значения в `ConcurrentHashMap` не обязаны быть `volatile`.
> theory/MEMORY_MODEL.md §4

### Q76: Какую гарантию дают `final`-поля и когда она теряется?
**A:** JLS §17.5: если объект не «утёк» из конструктора, любой поток, получивший ссылку, увидит его `final`-поля полностью инициализированными — **без всякой синхронизации**. Это делает неизменяемые объекты самым дешёвым способом обойтись без локов. Гарантия теряется, если ссылка на `this` покидает конструктор (регистрация слушателя, запуск потока, передача в чужой метод) — тогда другой поток может увидеть объект до «заморозки» полей.
> theory/MEMORY_MODEL.md §6

### Q77: Как вообще тестировать конкурентный код на корректность?
**A:** Обычным тестом — почти никак: гонка проявляется раз на миллионы операций и зависит от JIT, железа и нагрузки. Минимум — «стартовый пистолет» на `CountDownLatch`, чтобы потоки срывались одновременно, плюс много повторений и подсчёт «невозможных» исходов. Промышленный инструмент — `jcstress` из OpenJDK: он генерирует обвязку, прогоняет пары операций миллионы раз в разных режимах JIT и раскладывает исходы на ожидаемые, приемлемые и запрещённые моделью памяти.
> theory/MEMORY_MODEL.md §8

---

## 15. Цена конкурентности

### Q78: Сколько одновременных запросов находится в сервисе на 1000 rps при времени обработки 300 мс? Сколько нужно потоков?
**A:** По закону Литтла `L = λ × W = 1000 × 0.3 = 300`. Это не оценка, а тождество для любой стабильной системы. При модели «поток на запрос» нужно 300 потоков — не 10 и не 50. Проверяется прямо: 300 задач по 300 мс на пуле из 10 потоков занимают 9117 мс, на пуле из 50 — 1825 мс, на пуле из 300 — 333 мс. Пул меньше нужного не «немного медленнее», а превращает параллельное ожидание в последовательное.
> theory/WHY_CONCURRENCY.md §2

### Q79: Восемь потоков увеличивают общий `AtomicLong` и работают медленнее одного потока без синхронизации. Как это возможно, если блокировок нет?
**A:** Дело в когерентности кэшей. Каждый CAS требует получить строку кэша в эксклюзивное владение, то есть отобрать её у остальных ядер; строка перекидывается между ядрами, и полезная работа теряется на её пересылке. Измеряется числом попыток: при одном потоке 1.00 попытки CAS на инкремент, при восьми — 4.66, а время растёт с 3 мс до 284 мс. Восемь потоков на восьми ядрах сделали ту же работу в 26 раз медленнее одного. Вывод: «lock-free» — это гарантия прогресса, а не обещание скорости.
> theory/ATOMIC_CAS.md §2

### Q80: Чем закон Амдала отличается от Universal Scalability Law?
**A:** Закон Амдала учитывает только последовательную долю `p` и даёт потолок ускорения `1/p`: кривая выходит на плато. USL (модель Гантера) добавляет второе слагаемое — стоимость согласования между участниками, растущую как `N²`. Из-за него кривая имеет **максимум**: после некоторого числа потоков каждый следующий делает систему медленнее. Замер с `AtomicLong` — ровно этот эффект; закон Амдала такого не предсказывает.
> theory/WHY_CONCURRENCY.md §4

### Q81: Улучшает ли добавление потоков задержку одного запроса?
**A:** Нет. Пропускная способность растёт, пока есть свободные ресурсы, но 300 мс останутся 300 мс. Уменьшить задержку можно только распараллеливанием работы **внутри** запроса — например, тремя одновременными вызовами вместо трёх последовательных. Хуже того, при перегрузке цели конфликтуют: неограниченная очередь удерживает пропускную способность, но задержка растёт неограниченно, потому что запрос ждёт в очереди.
> theory/WHY_CONCURRENCY.md §6

### Q82: Что такое ложное разделение и как понять, что оно есть?
**A:** Единица когерентности — не переменная, а строка кэша (64 байта на x86, 128 на Apple Silicon). Два потока, пишущие в **разные** переменные, лежащие в одной строке, всё равно дерутся за неё. Замер: четыре потока пишут в соседние элементы `AtomicLongArray` — 230 мс; те же потоки с шагом 16 `long` (128 байт) — 52 мс, замедление от 3 до 12 раз, целиком паразитное. Признак: несколько потоков часто пишут в элементы одного массива или соседние поля объекта. Лечение — разнести по строкам кэша (`@jdk.internal.vm.annotation.Contended` с `-XX:-RestrictContended` либо ручной шаг). `sun.misc.Contended` не существует с Java 9.
> theory/ATOMIC_CAS.md §3

### Q91: Из чего складывается «потолок» примерно в 10 000 платформенных потоков на JVM?
**A:** Из трёх независимых ограничений сразу, а не из одного жёсткого лимита. Память: каждый поток резервирует стек (типично 2 МБ адресного пространства, задаётся `-Xss`), и 10 000 потоков — это уже 20 ГБ резерва. Время создания: платформенный поток создаётся через системный вызов и работу планировщика ядра (~22 мкс на измеренной машине) против ~1.5 мкс у виртуального (просто объект в куче). Цена переключения контекста при блокировке (~1.2 мкс, порядка 3000 тактов процессора): при десятках тысяч переключений в секунду планировщик ОС сам становится заметной нагрузкой. Для 300 потоков всё это не проблема, для 10 000 одновременных соединений — уже да, отсюда и выросли асинхронный стиль и виртуальные потоки.
> theory/WHY_CONCURRENCY.md §3

### Q92: Назовите ситуации, когда добавление конкурентности не даёт выигрыша или делает хуже.
**A:** Пять случаев: (1) сервер приложений уже держит пул потоков на уровне контейнера — свой пул внутри одного запроса не нужен; (2) узкое место не процессор, а внешний ресурс (БД, диск) — потоки просто выстроятся в очередь за тем же соединением; (3) полезная работа короче накладных расходов на передачу задачи в пул (десятки микросекунд против единиц); (4) данные общие и часто изменяются — потоки начинают конкурировать за одну строку кэша и могут работать на порядок медленнее одного потока (см. `AtomicLong`); (5) нужен строгий порядок обработки — поддерживать его на N потоках само по себе съедает весь потенциальный выигрыш. Конкурентность — это размен сложности на пропускную способность, а не бесплатное ускорение.
> theory/WHY_CONCURRENCY.md §7

---

## Шпаргалка: топ-10 тем по частоте на собеседованиях

1. `synchronized` vs `ReentrantLock` (Q2, Q28)
2. `volatile` и happens-before (Q6, Q7)
3. `ConcurrentHashMap` внутреннее устройство (Q12, Q13)
4. `ThreadPoolExecutor` параметры и проблемы (Q17, Q18)
5. Deadlock — условия, обнаружение, предотвращение (Q23, Q24)
6. `CompletableFuture` — цепочки (Q19)
7. CAS и AtomicInteger (Q9, Q10)
8. `CountDownLatch` vs `CyclicBarrier` (Q21)
9. Race condition vs data race (Q27)
10. Virtual Threads (Q30, Q31)
