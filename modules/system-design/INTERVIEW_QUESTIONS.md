# Interview Questions — System Design

25 вопросов по применению concurrency в реальных системах и смежным темам.

---

## Locking Strategies (Q1–Q6)

### Q1: В чём разница между pessimistic и optimistic locking?
**A:** Pessimistic — предполагает конфликты, блокирует ресурс заранее (synchronized, ReentrantLock). Простота, нет retry, но ограничивает throughput. Optimistic — предполагает редкие конфликты, не блокирует, проверяет версию при записи (AtomicStampedReference, version field). Высокий throughput при редких конфликтах, но обязательна retry-логика. При высокой конкуренции optimistic деградирует из-за частых retry.

### Q2: Что такое TOCTOU и как его исправить?
**A:** Time-Of-Check Time-Of-Use — между проверкой условия и действием другой поток изменил состояние. Классический пример: `if (seats > 0) book()` — между проверкой и бронированием другой поток мог забронировать последнее место. Исправление: check и act должны быть атомарны под единой блокировкой, или использовать CAS/compute-операции ConcurrentHashMap.

### Q3: Как организовать гранулярные локи per-resource без deadlock?
**A:** `ConcurrentHashMap.computeIfAbsent(id, k -> new Object())` для per-id lock объектов — computeIfAbsent атомарен, два потока не создадут два lock объекта для одного ключа. При захвате нескольких локов всегда берём их в одном порядке (например, по возрастанию ID): `UUID first = id1.compareTo(id2) < 0 ? id1 : id2`. Нарушение порядка → deadlock при A→B и B→A.

### Q4: Нужна ли retry-логика внутри synchronized блока с optimistic locking?
**A:** Нет. Pessimistic блокировка исключает конкурентный доступ, поэтому OptimisticLockException внутри synchronized невозможен — retry становится мёртвым кодом. Нельзя смешивать стратегии: либо pessimistic (synchronized без retry), либо optimistic (без synchronized с retry снаружи).

### Q5: Как реализовать idempotency для HTTP-операций?
**A:** Double-checked locking: 1) быстрая проверка без блокировки по idempotency-ключу, 2) захватить per-key lock (computeIfAbsent), 3) повторная проверка внутри блокировки, 4) выполнить операцию и сохранить результат. Храним idempotency-ключи отдельно от бизнес-данных в разных Map.

### Q6: Когда использовать ReadWriteLock вместо synchronized?
**A:** Когда операций чтения значительно больше, чем записи. ReadWriteLock позволяет нескольким читателям работать одновременно, блокируя только при записи. Не имеет смысла при 50/50 read/write или при коротких критических секциях — overhead от ReadWriteLock может быть выше, чем у synchronized. StampedLock с optimistic read быстрее для read-heavy сценариев.

---

## Cache Design (Q7–Q10)

### Q7: Как сделать thread-safe LRU-кэш?
**A:** Два подхода: 1) synchronized весь кэш — просто, но не масштабируется; 2) ReentrantReadWriteLock — read lock на get (без eviction), write lock на put/eviction. Проблема с ReadWriteLock: если get обновляет LRU-порядок, нужен write lock даже для чтения. Альтернатива: ConcurrentHashMap + ConcurrentLinkedDeque, но атомарность составных операций требует отдельной синхронизации.

### Q8: В чём проблема с `computeIfAbsent` при рекурсивных вычислениях в CHM?
**A:** ConcurrentHashMap блокирует бакет на время вычисления. Если внутри compute снова обращаться к тому же или другому ключу этого бакета — deadlock или ConcurrentModificationException. Решение: вычислить значение вне computeIfAbsent, затем putIfAbsent.

### Q9: Cache stampede — что это и как предотвратить?
**A:** При истечении популярного ключа все потоки одновременно идут в БД — N параллельных идентичных запросов. Решения: 1) single-flight (только один поток вычисляет, остальные ждут) — через per-key lock; 2) probabilistic early expiration (обновлять до истечения с вероятностью); 3) stale-while-revalidate (возвращать устаревшее, обновлять в фоне).

### Q10: Как избежать memory leak в cache с per-key локами?
**A:** `ConcurrentHashMap<Key, Lock>` накапливает локи без очистки. Решения: 1) Guava Striped<Lock> — фиксированный массив локов, ключ → индекс через хэш; 2) WeakReference — GC удаляет лок, когда нет внешних ссылок; 3) явная очистка после использования (remove после synchronized-блока, если значение уже записано).

---

## Rate Limiter (Q11–Q13)

### Q11: Как работает Token Bucket rate limiter?
**A:** Bucket ёмкостью N токенов, пополняется со скоростью R токенов/сек. Запрос потребляет 1 токен; если токенов нет — отказ или ожидание. Реализация: хранить `lastRefillTime` и `tokens` как атомарные (или под lock). При каждом запросе: `elapsed = now - lastRefill`, `tokens = min(capacity, tokens + elapsed * rate)`. Позволяет burst до N запросов.

### Q12: Token Bucket vs Leaky Bucket vs Fixed Window vs Sliding Window?
**A:** Fixed Window — счётчик сбрасывается каждую секунду, проблема: 2x burst на границе окон. Sliding Window — точнее, но дороже (хранит все timestamp-ы). Leaky Bucket — очередь с фиксированной скоростью выхода, сглаживает burst, но задерживает запросы. Token Bucket — разрешает burst до ёмкости bucket, затем rate-limited. На практике Token Bucket — баланс простоты и точности.

### Q13: Как реализовать distributed rate limiter?
**A:** Redis + Lua-скрипт (атомарность). INCR + EXPIRE для fixed window, ZADD + ZREMRANGEBYSCORE для sliding window. Lua гарантирует атомарность check-then-act без гонки между INCR и EXPIRE. Альтернативы: Redis RedLock для распределённых локов, Hazelcast, или сервис-централизатор (API Gateway).

---

## Concurrent Data Structures (Q14–Q16)

### Q15: Как сделать атомарный снимок (snapshot) concurrent структуры?
**A:** Без блокировки невозможно гарантировать консистентный snapshot для произвольных структур. Варианты: 1) read lock на весь snapshot; 2) CopyOnWriteArrayList — итератор всегда snapshot (но дорогая запись); 3) версионирование (MVCC) — каждое изменение создаёт новую версию, readers работают со старой. ConcurrentSkipListMap.entrySet() не является атомарным snapshot.

### Q16: Почему `size()` у ConcurrentLinkedQueue — O(n)?
**A:** CLQ не хранит счётчик элементов (это потребовало бы CAS на каждую операцию enqueue/dequeue). `size()` итерирует всю очередь. Если нужен счётчик — храни отдельный AtomicInteger. Аналогично: LinkedBlockingQueue хранит AtomicInteger count, поэтому size() = O(1).

---

## Database (Q17–Q21)

### Q17: Какие уровни изоляции транзакций вы знаете?
**A:** READ UNCOMMITTED — dirty read возможен. READ COMMITTED (PostgreSQL default) — нет dirty read, но non-repeatable read и phantom. REPEATABLE READ (MySQL default) — нет dirty/non-repeatable read, phantom read возможен в теории (PostgreSQL устраняет через MVCC). SERIALIZABLE — полная изоляция, как последовательное выполнение, наибольший overhead.

### Q18: Что такое lost update и как его предотвратить?
**A:** Два потока читают одно значение, оба изменяют и пишут — запись первого потока перезаписывается. Решения: 1) SELECT FOR UPDATE (pessimistic); 2) `UPDATE ... WHERE version = ?` (optimistic); 3) атомарный UPDATE без предварительного SELECT (`UPDATE accounts SET balance = balance - 100 WHERE id = ? AND balance >= 100`).

### Q19: Когда индекс не помогает?
**A:** 1) LOW cardinality (например, boolean) — полный scan быстрее; 2) функция над колонкой в WHERE (`WHERE YEAR(created_at) = 2024` — индекс не используется, нужен функциональный индекс); 3) leading wildcard (`LIKE '%text'`); 4) type mismatch (varchar vs integer); 5) небольшая таблица — optimizer выбирает seq scan.

### Q20: Что такое N+1 проблема?
**A:** 1 запрос для загрузки списка + N запросов для каждого элемента. Например, загрузить 100 заказов, затем для каждого загрузить пользователя — 101 запрос вместо 1 с JOIN. Решения: JOIN, batch loading (WHERE id IN (...)), или DataLoader (для GraphQL). ORM решают через eager loading или batch fetching.

### Q21: В чём разница между оптимистической блокировкой в приложении и в БД?
**A:** В приложении: version field в Java-объекте, проверяется в коде перед UPDATE. В БД: `UPDATE ... WHERE id=? AND version=?`, проверяется числом затронутых строк (0 строк → конфликт). БД-вариант надёжнее при нескольких инстансах приложения — нет shared state, БД — единый источник истины.

---

## Distributed Systems (Q22–Q25)

### Q22: Что такое CAP теорема?
**A:** В случае сетевого раздела (Partition) распределённая система вынуждена выбирать между Consistency (все узлы видят одинаковые данные) и Availability (система отвечает на все запросы). CP-системы (ZooKeeper, etcd) — при разделе недоступны. AP-системы (Cassandra, DynamoDB) — при разделе возвращают possibly stale данные. В нормальной работе доступны оба свойства.

### Q23: Как реализовать Saga pattern?
**A:** Saga разбивает длинную транзакцию на цепочку локальных транзакций, каждая публикует событие или вызывает следующий шаг. При сбое — компенсирующие транзакции в обратном порядке. Choreography: сервисы реагируют на события (Event-Driven, слабая связность, сложная отладка). Orchestration: центральный coordinator управляет шагами (проще debug, но coupling).

### Q24: Что такое Outbox Pattern?
**A:** Проблема: нельзя атомарно записать в БД и опубликовать событие в Kafka. Outbox: в одной транзакции пишем в бизнес-таблицу И в таблицу outbox (в той же БД). Отдельный process/poller читает outbox и публикует в Kafka, затем помечает запись как sent. Гарантирует at-least-once delivery.

### Q25: Circuit Breaker — зачем и когда открывается?
**A:** Защищает от каскадных сбоев: если downstream сервис медленный/недоступный — быстро возвращаем ошибку вместо ожидания timeout. Состояния: CLOSED (нормальная работа) → OPEN (при превышении threshold ошибок, быстрые отказы) → HALF-OPEN (пробный запрос) → CLOSED или снова OPEN. Resilience4j, Hystrix. Разница от Retry: Retry повторяет, Circuit Breaker прекращает попытки на время.

---

## Event Sourcing (Q26–Q28)

### Q26: Что такое Backward и Forward compatibility в Event Sourcing?
**A:** Backward — новый код читает старые события: добавлять поля только как optional с дефолтом, не удалять required, не переименовывать. Forward — старый код читает новые события: игнорировать неизвестные поля; в Jackson требуется `@JsonIgnoreProperties(ignoreUnknown = true)`, иначе бросит `UnrecognizedPropertyException`. Full = пересечение (обе стороны). Transitive — совместимость между любыми версиями, а не только соседними. Confluent Schema Registry поддерживает все режимы (`BACKWARD`, `FORWARD`, `FULL`, `_TRANSITIVE`).
> Greg Young — Versioning in an Event Sourced System

### Q27: Что такое upcasting и когда его использовать?
**A:** Upcasting — преобразование raw old event до десериализации: заполнить новое поле дефолтом, переименовать ключ, разбить старое поле на два, склеить два в одно. Применяется при строго типизированных событиях, когда weak-schema (Avro/Protobuf) не используется или нужна сложная миграция, которую сама Avro Schema Resolution не вытянет. Альтернативы: версионирование типа события (`OrderCreatedV1` / `OrderCreatedV2` как разные классы), параллельные поля с `@Deprecated` на время миграции.

### Q28: Зачем нужны snapshots в Event Sourcing?
**A:** Restore состояния агрегата = replay всех его событий с начала. При тысячах событий на агрегат replay становится медленным (linear scan). Snapshot — материализованное состояние агрегата после N-ного события, хранится отдельно. Restore = load snapshot + replay только tail после N. Trade-off: дополнительное место и invalidation snapshots при изменении структуры события vs скорость восстановления. Обычно snapshot берётся каждые 100–1000 событий.

---

## Functional Programming (Q29–Q32)

### Q29: Что такое Higher-Order Function?
**A:** Функция, которая принимает функцию как аргумент или возвращает функцию. Следствие first-class functions (функции — значения первого класса). В Java: `Stream.map(Function)`, `Function.andThen(Function)`, `Comparator.comparing(KeyExtractor)`, любая фабрика лямбд. Польза: композиция и абстракция over behaviour без наследования — вместо template method в иерархии классов передаём стратегию как функцию.

### Q30: Зачем в Java 8 появились default методы?
**A:** Чтобы эволюционировать `Collection` API без breaking change. Добавить `Collection.stream()` как abstract сломало бы все классы, реализующие `Collection` напрямую (включая чужой код в библиотеках). Default метод даёт реализацию прямо в интерфейсе, наследуется автоматически. Эта же фича включила functional-style утилиты: `Predicate.and/or`, `Function.compose/andThen`, `Comparator.thenComparing`. Diamond problem (два интерфейса с одинаковой сигнатурой default) — compile error, нужно явно override и можно делегировать через `InterfaceA.super.method()`. Java допустила multiple inheritance of behaviour, но не state.

### Q31: Что такое Referential Transparency и зачем она нужна?
**A:** Выражение referentially transparent, если его можно заменить результатом без изменения поведения программы. Эквивалентно: pure function + immutable inputs. Польза: компилятор/runtime могут мемоизировать, переупорядочивать, выполнять параллельно без data races; код проще рассуждать о нём (equational reasoning — подставлять равные на равные). Нарушают RT: `Random`, `System.currentTimeMillis`, любой IO, обращение к мутабельному shared state.

### Q32: Поддерживает ли JVM Tail Call Optimization?
**A:** Нет. Глубокая хвостовая рекурсия → `StackOverflowError`. Причины: верификатор байткода рассчитывает на честный стек, `SecurityManager` должен видеть полный stack trace, бинарная совместимость. Workarounds: переписать в цикл, trampoline pattern (вернуть `Thunk`, разворачивать в `while`), Kotlin `tailrec` (компилятор Kotlin сам превращает в цикл на уровне байткода — JVM ничего не знает). JEP 416 предлагал TCO — не принят.
