# Java Concurrency — Вопросы для собеседований

Источники: JCP = "Java Concurrency in Practice" (Goetz), JLS = Java Language Specification, JD = Javadoc

---

## 1. Основы потоков и synchronized

### Q1: Чем отличается `Runnable` от `Callable`?
**A:** `Runnable.run()` — void, не бросает checked exceptions. `Callable.call()` — возвращает значение и может бросить Exception. `Callable` используется с `ExecutorService.submit()`, возвращает `Future<T>`.
> JCP §6.3.2

### Q2: Что такое monitor в Java? Как работает synchronized?
**A:** Каждый объект в Java имеет встроенный монитор (intrinsic lock). `synchronized` захватывает монитор объекта. Только один поток может владеть монитором. `synchronized` — reentrant: поток может повторно захватить уже захваченный им монитор. При synchronized-методе — монитор `this` (или `Class` для static).
> JLS §17.1, JCP §2.3.2

### Q3: Почему wait/notify должны вызываться внутри synchronized?
**A:** Потому что они работают с монитором объекта. `wait()` атомарно отпускает монитор и усыпляет поток. Без `synchronized` будет `IllegalMonitorStateException`. Это предотвращает lost wakeup race condition: между проверкой условия и вызовом wait() другой поток может вызвать notify().
> JCP §14.2.2

### Q4: В чём разница между `notify()` и `notifyAll()`?
**A:** `notify()` будит один произвольный поток, `notifyAll()` — все ждущие. Почти всегда следует использовать `notifyAll()`, потому что `notify()` может привести к «hijacked signal» — пробудится поток, которому уведомление не предназначено, и сигнал будет потерян для нужного потока.
> JCP §14.2.4

### Q5: Что такое daemon thread?
**A:** Фоновый поток. JVM завершается, когда остались только daemon-потоки. Создаётся через `thread.isDaemon = true` ДО `start()`. GC, finalizer — daemon threads.
> Javadoc Thread

---

## 2. volatile и Java Memory Model

### Q6: Что гарантирует volatile?
**A:** **Visibility** — запись в volatile переменную видна всем потокам немедленно (flush в main memory). **Ordering** — запись в volatile создаёт happens-before отношение с последующим чтением той же переменной. НЕ гарантирует атомарность: `volatile int count; count++` — НЕ атомарно (read-modify-write).
> JLS §17.4.5, JCP §3.1.4

### Q7: Что такое happens-before?
**A:** Отношение частичного порядка между операциями, определённое JMM. Если операция A happens-before B, то результаты A гарантированно видны B. Ключевые правила:
1. Внутри одного потока: program order
2. `synchronized`: unlock HB lock того же монитора
3. `volatile`: запись HB чтения той же переменной
4. `Thread.start()` HB первая операция в потоке
5. Последняя операция потока HB `join()`
6. Транзитивность: A HB B, B HB C → A HB C
> JLS §17.4.5, JCP §16.1

### Q8: Что такое false sharing и как его избежать?
**A:** Когда две переменные, используемые разными потоками, попадают в одну кэш-линию (64 байта). Изменение одной инвалидирует кэш-линию для другого ядра, хотя данные не связаны. Решение: `@Contended` аннотация (Java 8+), padding.
> JCP §Appendix A

---

## 3. Atomic и CAS

### Q9: Как работает CAS (Compare-And-Swap)?
**A:** Атомарная CPU-инструкция (CMPXCHG на x86). Три параметра: адрес, ожидаемое значение (expected), новое значение (new). Если текущее значение == expected → записывает new, возвращает true. Иначе ничего не делает, возвращает false. `AtomicInteger.compareAndSet()` — обёртка над CAS.
> JCP §15.3

### Q10: Что такое ABA-проблема? Как решить?
**A:** Поток читает A, другой поток меняет A→B→A. CAS видит A и думает что ничего не менялось, хотя состояние могло измениться. Решение: `AtomicStampedReference` — хранит версию (stamp) вместе со ссылкой. CAS проверяет и значение, и stamp.
> JCP §15.4.4

### Q11: Когда использовать LongAdder вместо AtomicLong?
**A:** `LongAdder` быстрее при высоком contention (много потоков инкрементируют). Внутри хранит массив ячеек (Cell[]), каждый поток инкрементирует свою ячейку, sum() складывает все. Минус: `sum()` не точен в момент конкурентных записей. Используй `AtomicLong` когда нужен точный get() и CAS, `LongAdder` — для статистики/метрик.
> Javadoc LongAdder

---

## 4. Concurrent Collections

### Q12: Как работает ConcurrentHashMap в Java 8?
**A:** Массив Node[], каждый bucket — связный список или TreeBin (при >8 элементах). Блокировка на уровне bucket'а через `synchronized(node)` (не сегменты как в Java 7). `putVal` использует CAS для пустого bucket'а и synchronized для существующего. Не допускает null ключи и значения (в отличие от HashMap).
> JD ConcurrentHashMap, исходники OpenJDK

### Q13: Зачем ConcurrentHashMap запрещает null?
**A:** Неоднозначность: `map.get(key) == null` — ключа нет или значение null? В однопоточном HashMap можно проверить `containsKey()`, но в concurrent среде между get и containsKey другой поток мог изменить map. Doug Lea: "null in concurrent collections is a recipe for hidden bugs."
> Doug Lea's Concurrency FAQ

### Q14: Что такое weakly consistent iterator?
**A:** Итератор ConcurrentHashMap гарантирует: не бросит ConcurrentModificationException, отразит состояние map на момент создания итератора, МОЖЕТ (но не обязан) отразить изменения после создания. В отличие от fail-fast итераторов HashMap.
> JD ConcurrentHashMap

### Q15: Когда использовать CopyOnWriteArrayList?
**A:** Когда чтений намного больше, чем записей. Каждая мутация создаёт новую копию массива → дорого для записи, но итератор никогда не бросит CME и не нужна синхронизация для чтения. Пример: список listeners/observers.
> JCP §5.2.3

### Q16: Какие BlockingQueue реализации и когда какую?
**A:**
- `ArrayBlockingQueue` — bounded, fair/unfair, backed by array. Для классического producer-consumer.
- `LinkedBlockingQueue` — optionally bounded (default Integer.MAX_VALUE), обычно выше throughput чем ABQ.
- `PriorityBlockingQueue` — unbounded, элементы по приоритету.
- `SynchronousQueue` — zero capacity, put блокируется пока кто-то не сделает take. Для handoff.
- `DelayQueue` — элементы доступны только после задержки.
> JCP §5.3

---

## 5. ExecutorService и пулы потоков

### Q17: Почему нельзя использовать `Executors.newFixedThreadPool()` в продакшене?
**A:** Внутри использует `LinkedBlockingQueue` (unbounded). При быстром поступлении задач и медленной обработке очередь растёт бесконечно → OutOfMemoryError. `Executors.newCachedThreadPool()` — другая проблема: maxPoolSize = Integer.MAX_VALUE, может создать слишком много потоков. Лучше создавать `ThreadPoolExecutor` напрямую с bounded queue и rejection policy.
> JCP §8.3.2, Alibaba Java Coding Guidelines

### Q18: Какие rejection policies есть у ThreadPoolExecutor?
**A:**
- `AbortPolicy` (default) — бросает `RejectedExecutionException`
- `CallerRunsPolicy` — задача выполняется в вызывающем потоке (back-pressure)
- `DiscardPolicy` — молча отбрасывает задачу
- `DiscardOldestPolicy` — удаляет самую старую задачу из очереди, ставит новую
> JD ThreadPoolExecutor

### Q19: В чём разница thenApply vs thenCompose в CompletableFuture?
**A:** `thenApply(fn)` — fn возвращает значение T → `CF<T>`. Аналог `map`. `thenCompose(fn)` — fn возвращает `CF<T>` → `CF<T>` (flatMap). Если fn уже возвращает CompletableFuture, используй thenCompose, иначе получишь `CF<CF<T>>`.
> JD CompletableFuture

### Q20: Как работает ForkJoinPool и work-stealing?
**A:** Каждый поток имеет deque задач. Когда deque пуст — поток «ворует» задачи из хвоста deque другого потока. Fork() кладёт подзадачу в свой deque, compute() выполняет синхронно, join() ждёт результат. `commonPool()` используется parallel streams. Для CPU-bound задач: parallelism = кол-во ядер.
> JCP §11.4, JD ForkJoinPool

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
> JCP §5.5.1-5.5.2

### Q22: Зачем нужен Semaphore?
**A:** Ограничение количества одновременных доступов к ресурсу. `acquire()` уменьшает permits, `release()` увеличивает. Permits может быть >1 (в отличие от Lock). Бинарный семафор (permits=1) ≈ Lock, но non-reentrant и без владельца (любой поток может release).
> JCP §5.5.3

---

## 7. Deadlock и проблемы многопоточности

### Q23: Какие 4 условия необходимы для deadlock (условия Коффмана)?
**A:**
1. **Mutual exclusion** — ресурс занят эксклюзивно
2. **Hold and wait** — поток держит ресурс и ждёт другой
3. **No preemption** — ресурс нельзя отобрать принудительно
4. **Circular wait** — циклическая зависимость A→B→...→A

Убери любое из 4 — deadlock невозможен. На практике проще всего предотвратить circular wait (упорядочить блокировки).
> JCP §10.1.1

### Q24: Как обнаружить deadlock?
**A:**
- `ThreadMXBean.findDeadlockedThreads()` — программно
- `jstack <pid>` — дамп стеков, показывает "Found one Java-level deadlock"
- `jconsole` / `VisualVM` — GUI
- Thread dump через `kill -3 <pid>` (Unix) или Ctrl+Break (Windows)
> JCP §10.2

### Q25: Что такое livelock? Пример?
**A:** Потоки активны (не заблокированы), но не прогрессируют — постоянно реагируют на действия друг друга. Пример: два потока пытаются избежать deadlock'а через tryLock, отпускают блокировки одновременно и повторяют → бесконечный цикл. Решение: добавить случайную задержку (backoff).
> JCP §10.3.3

### Q26: Что такое starvation? Как предотвратить?
**A:** Поток не может получить доступ к ресурсу неопределённо долго. Причины: unfair locks (потоки с более высоким приоритетом всегда выигрывают), длительные synchronized блоки. Решение: fair locks (`ReentrantLock(true)`), избегать priority manipulation, минимизировать scope блокировки.
> JCP §10.3.1

### Q27: В чём разница race condition и data race?
**A:** **Race condition** — результат зависит от порядка выполнения потоков (логическая ошибка). Пример: check-then-act (`if (!map.containsKey(k)) map.put(k, v)`). **Data race** — два потока обращаются к одной переменной, хотя бы один пишет, без happens-before. Data race — undefined behavior по JMM. Race condition может быть без data race (с корректной синхронизацией, но неверной логикой).
> JLS §17.4.5, JCP §2.2

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
> JCP §13.4

### Q29: Что такое StampedLock? Когда использовать?
**A:** Lock с 3 режимами: write lock, read lock, optimistic read. Optimistic read НЕ блокирует — получаешь stamp, читаешь данные, проверяешь `validate(stamp)`. Если невалидный — fallback на обычный read lock. Быстрее ReadWriteLock при редких записях. НЕ reentrant, нельзя использовать с Condition.
> Javadoc StampedLock (Java 8+)

---

## 9. Virtual Threads (Java 21+)

### Q30: Чем виртуальные потоки отличаются от платформенных?
**A:** Platform thread = OS thread (1:1). Virtual thread — легковесный, управляется JVM (M:N scheduling). Миллионы виртуальных потоков на нескольких carrier threads. Блокирующие операции (sleep, I/O) не блокируют carrier — виртуальный поток unmount. Идеальны для I/O-bound задач.
> JEP 444

### Q31: Что такое pinning? Когда виртуальный поток "прибит"?
**A:** Виртуальный поток не может unmount от carrier при: (1) выполнении внутри `synchronized` блока, (2) вызове native метода. Используй `ReentrantLock` вместо `synchronized` с виртуальными потоками. Pinning можно обнаружить через `-Djdk.tracePinnedThreads=full`.
> JEP 444, JEP 491 (Java 24 — synchronized pinning removed)

### Q32: ThreadLocal vs ScopedValue?
**A:** `ThreadLocal` — переменная привязана к потоку, mutable, наследуется через `InheritableThreadLocal`. Проблема с virtual threads: миллионы потоков = миллионы копий. `ScopedValue` (preview) — immutable, автоматически ограничен scope'ом, эффективнее для structured concurrency.
> JEP 481

---

## 10. Applied Concurrency Patterns

Перенесено из `system-design` (правило NO OVERLAP): прикладные паттерны для упражнений `applied/{reservations,bank,cache,orderbook,scheduler,ratelimiter}/`.

### Q33: В чём разница между pessimistic и optimistic locking?
**A:** Pessimistic предполагает конфликты и блокирует ресурс заранее (`synchronized`, `ReentrantLock`) — простая логика, retry не нужен, но throughput ограничен сериализацией. Optimistic считает конфликты редкими: операция выполняется без блокировки, при коммите проверяется версия (`AtomicStampedReference`, version-поле в БД). Высокий throughput при низком contention, но обязательна retry-логика, и при высоком contention деградирует из-за частых rollback'ов.
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
**A:** `ConcurrentHashMap.computeIfAbsent` блокирует bucket на время выполнения mapping-функции. Если внутри mapping-функции снова обратиться к этому же ключу (или к другому ключу в том же bucket'е) через любой compute-метод — deadlock или `IllegalStateException` (JDK 9+ детектирует reentrant modification). Решение: вычислить значение **вне** `computeIfAbsent`, затем `putIfAbsent`. Или использовать другую структуру (`Caffeine`).
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
- **Token Bucket** — разрешает burst до ёмкости bucket'а, затем rate-limited. Баланс простоты и точности; де-факто стандарт (AWS, Stripe).

### Q45: Как реализовать distributed rate limiter?
**A:** Redis + Lua-скрипт обеспечивает атомарность check-then-act без гонок. Для fixed window: `INCR` + `EXPIRE` в одном Lua-блоке. Для sliding window: `ZADD timestamp` + `ZREMRANGEBYSCORE` (удалить старее окна) + `ZCARD` (текущее число). Альтернативы: Redis RedLock для распределённых локов (с известными caveat'ами Martin Kleppmann), Hazelcast `IAtomicLong`, или централизованный rate-limit сервис (API Gateway, Envoy `local_ratelimit` + `global_ratelimit`).
> Stripe Engineering — Scaling your API with rate limiters

### Q46: Как сделать атомарный snapshot concurrent структуры?
**A:** Без блокировки атомарный snapshot произвольной структуры **невозможен**. Варианты: (1) **read lock** на весь snapshot — простой, но блокирует записи; (2) **CopyOnWriteArrayList** / **CopyOnWriteArraySet** — итератор всегда snapshot на момент создания (дорогая запись); (3) **MVCC** — каждое изменение создаёт новую версию, readers работают со старой (`ConcurrentSkipListMap` даёт weakly-consistent итератор, но не atomic snapshot); (4) ImmutableMap с volatile reference и copy-on-write на верхнем уровне.

### Q47: Почему `size()` у ConcurrentLinkedQueue — O(n)?
**A:** CLQ — non-blocking lock-free очередь на CAS, она **не хранит** счётчик размера. Поддерживать атомарный счётчик потребовало бы CAS на каждый enqueue/dequeue — дополнительная contention-точка, обнуляющая преимущество lock-free. Поэтому `size()` итерирует всю очередь, что O(n) и даёт лишь приблизительный результат под нагрузкой. Если нужен O(1) размер — храните `AtomicInteger` отдельно или используйте `LinkedBlockingQueue` (у неё `size()` = O(1) ценой блокировки на push/pop).
> JD ConcurrentLinkedQueue

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
