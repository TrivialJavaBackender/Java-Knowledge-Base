# Interview Questions — Databases

Вопросы по реляционным и NoSQL базам, транзакциям, индексам, движкам хранилища, репликации и шардингу.

> **Историческая справка:** Q1–Q5 ранее жили в `system-design/INTERVIEW_QUESTIONS.md` как Q17–Q21. При миграции номера могут не сохраниться в Leitner-стейте — это ожидаемо.

---

## Транзакции и изоляция (Q1–Q4)

### Q1: Какие уровни изоляции транзакций вы знаете?
**A:** READ UNCOMMITTED — dirty read возможен. READ COMMITTED (PostgreSQL default) — нет dirty read, но non-repeatable read и phantom возможны. REPEATABLE READ (MySQL default) — нет dirty/non-repeatable read, phantom возможен в стандарте ANSI (но в PostgreSQL устраняется через snapshot isolation). SERIALIZABLE — полная изоляция, как последовательное выполнение. В PostgreSQL реализован через SSI (Serializable Snapshot Isolation, Cahill 2008) — не блокирует, но требует retry на SQLSTATE 40001.
> theory/TRANSACTIONS.md §3

### Q2: Что такое lost update и как его предотвратить?
**A:** Два потока читают одно значение, оба изменяют и пишут — запись первого перезаписывается. Решения: 1) `SELECT ... FOR UPDATE` (pessimistic, блокировка строки); 2) `UPDATE ... WHERE version = ?` с проверкой числа затронутых строк (optimistic); 3) атомарный UPDATE без предварительного SELECT (`UPDATE accounts SET balance = balance - 100 WHERE id = ? AND balance >= 100`). В PostgreSQL REPEATABLE READ ловит lost update как 40001 ошибку — нужна retry-логика с jitter.
> theory/TRANSACTIONS.md §2

### Q3: Что такое write skew и как его предотвратить?
**A:** Write skew — каждая транзакция корректна по отдельности (читает одно, пишет другое), но вместе нарушают инвариант. Пример: «хотя бы один доктор на дежурстве» — T1 и T2 проверяют count=2, оба снимают своего доктора, count=0. REPEATABLE READ от write skew **не защищает** (snapshot isolation видит «свою» картину). Решения: SERIALIZABLE (SSI), материализация конфликта через INSERT в lock-таблицу + FOR UPDATE, EXCLUDE constraint для range-overlap.
> theory/TRANSACTIONS.md §2

### Q4: Что такое MVCC и зачем нужен VACUUM?
**A:** Multi-Version Concurrency Control: при UPDATE PostgreSQL не перезаписывает строку, а создаёт новую версию tuple с xmin/xmax. Старая помечается «удалённой» текущей транзакцией. Readers никогда не блокируют writers — каждый видит свою версию. VACUUM собирает мёртвые кортежи (старые версии) — без него таблица «пухнет» (bloat). VACUUM FULL физически удаляет с ACCESS EXCLUSIVE lock — нужен только при сильном bloat. Transaction ID — 32-bit счётчик: при wraparound (~2 млрд) PostgreSQL переходит в аварийный режим — autovacuum «замораживает» старые tuple для предотвращения.
> theory/TRANSACTIONS.md §9

### Q22: Как SSI в PostgreSQL обнаруживает конфликт при SERIALIZABLE, если транзакции не блокируют друг друга?
**A:** PostgreSQL для SERIALIZABLE использует SSI — вместо классических 2PL-локов транзакции выполняются оптимистично на своих snapshot'ах, а движок отслеживает rw-зависимости (кто прочитал то, что позже изменила другая транзакция). Если в графе зависимостей образуется цикл — это признак невозможности сериализовать историю, и одна из транзакций откатывается с `ERROR 40001`. В отличие от 2PL, где конфликт предотвращается блокировкой заранее (и возможен deadlock), SSI не блокирует чтения и записи вообще — платит за это нагрузкой на детектор зависимостей (~10-30% throughput) и обязательной retry-логикой в приложении.
> theory/TRANSACTIONS.md §6

### Q23: Почему `FOR UPDATE SKIP LOCKED` подходит для очереди задач, а обычный `FOR UPDATE` — нет?
**A:** Обычный `SELECT ... FOR UPDATE` при конкурентном доступе нескольких воркеров к одной и той же строке заставляет остальных ждать освобождения блокировки — воркеры выстраиваются в очередь за одной строкой, throughput не растёт. `SKIP LOCKED` меняет семантику: если строка уже заблокирована другой транзакцией, она просто пропускается, и воркер получает следующую свободную. Это превращает `SELECT ... WHERE status='pending' FOR UPDATE SKIP LOCKED LIMIT 1` в диспетчер задач без ожидания — N воркеров разбирают очередь параллельно, не блокируя друг друга.
> theory/TRANSACTIONS.md §7

### Q24: Почему для проверки пересечения диапазонов бронирований не хватает UNIQUE-constraint или FOR UPDATE, и как это решает EXCLUDE?
**A:** UNIQUE проверяет точное совпадение значений, а не пересечение интервалов — два бронирования `[10:00,12:00)` и `[10:30,11:30)` не равны, но конфликтуют. `SELECT ... FOR UPDATE` тоже не спасает при первой вставке: блокировать нечего, потому что конфликтующей строки ещё нет в таблице. `EXCLUDE USING GIST (table_id WITH =, time_range WITH &&)` работает иначе — GiST-индекс на INSERT атомарно проверяет, пересекается ли новый диапазон с уже существующими по оператору `&&`, и если да — бросает ошибку прямо на уровне constraint, без явных блокировок и без SERIALIZABLE.
> theory/TRANSACTIONS.md §8

### Q25: Почему retry на SQLSTATE 40001/40P01 обязателен, и зачем в backoff нужен jitter?
**A:** Коды `40001` (serialization failure) и `40P01` (deadlock detected) — не баг приложения, а штатный побочный эффект оптимистичных механизмов изоляции (SSI, REPEATABLE READ) и параллельных блокировок: транзакция физически не может быть закоммичена в этом порядке и должна быть повторена целиком. Фиксированная задержка перед повтором опасна тем, что множество одновременно откатившихся транзакций делают retry синхронно — получается retry storm, который снова упирается в тот же конфликт. Jitter (случайная добавка к экспоненциальной задержке) размазывает повторные попытки во времени и снижает вероятность повторного столкновения тех же транзакций.
> theory/TRANSACTIONS.md §10

### Q26: Чем `Propagation.NESTED` в Spring отличается от `REQUIRES_NEW`, и как это связано с savepoints в PostgreSQL?
**A:** PostgreSQL не поддерживает вложенные `BEGIN` — вместо этого есть `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` внутри одной физической транзакции. `Propagation.NESTED` в Spring реализуется именно через savepoint: если внутренний метод бросает исключение, откатывается только код до savepoint, а внешняя транзакция продолжается и может закоммититься. `REQUIRES_NEW` — это совсем другая физическая транзакция (отдельное соединение/COMMIT), независимая от внешней: откат внутренней никак не влияет на внешнюю, но и закоммититься она может раньше внешней. Практическое следствие: NESTED дешевле (одно соединение, один COMMIT) и подходит для «попробовать и откатить кусок», а REQUIRES_NEW нужен, когда результат внутренней операции должен пережить откат внешней.
> theory/TRANSACTIONS.md §11

---

## Индексы и планирование запросов (Q5–Q8)

### Q5: Когда индекс не помогает?
**A:** 1) Low cardinality (boolean, gender) — Seq Scan дешевле; 2) функция/выражение над колонкой в WHERE (`WHERE YEAR(created_at) = 2024`) — нужен expression index; 3) leading wildcard (`LIKE '%text'`) — нужен pg_trgm GIN; 4) type mismatch (varchar vs integer); 5) маленькая таблица — оптимизатор выбирает seq scan; 6) устаревшая статистика — нужен `ANALYZE`. Проверка: `EXPLAIN ANALYZE` → если `Seq Scan` вместо ожидаемого `Index Scan` — копать причину.
> theory/INDEXES.md §10

### Q6: B-tree vs Hash vs GIN vs GiST vs BRIN — когда какой?
**A:** **B-tree** (default) — equality + range + LIKE 'prefix%', сортировка, Index-Only Scan через INCLUDE. **Hash** — только `=` на длинных ключах (UUID, токены), компактнее B-tree. **GIN** — inverted index для jsonb/arrays/full-text: быстрые запросы, медленные обновления, большой размер. **GiST** — extensible для ranges (EXCLUDE constraint), geo (PostGIS), быстрые обновления, lossy с recheck. **BRIN** — min/max по блокам, размер в 100× меньше B-tree, но работает только при физической упорядоченности (append-only логи).
> theory/INDEXES.md §2

### Q7: В чём разница Index Scan, Index-Only Scan и Bitmap Heap Scan?
**A:** **Index Scan** — читает индекс, для каждой найденной записи идёт в heap за остальными колонками; хорош при низкой селективности. **Index-Only Scan** — все нужные колонки в индексе (через INCLUDE или covering); heap не нужен → в разы быстрее. **Bitmap Heap Scan** — сначала собирает bitmap страниц из индекса (или нескольких индексов через AND/OR), потом одним проходом читает heap; хорош при средней селективности и при объединении индексов.
> theory/INDEXES.md §10

### Q27: Почему в PostgreSQL невозможен настоящий кластерный индекс, и чем это компенсируется?
**A:** Кластерный индекс подразумевает, что строки физически лежат в порядке ключа — это то, что делает InnoDB. В PostgreSQL это несовместимо с MVCC: UPDATE не перезаписывает строку на месте, а создаёт новый tuple там, где нашлось свободное место в куче, — физический порядок нарушается уже первым же UPDATE после переупорядочивания. Команда `CLUSTER` может физически пересортировать таблицу один раз, но берёт `ACCESS EXCLUSIVE` lock и не поддерживает порядок автоматически — после первого UPDATE эффект начинает деградировать. Вместо кластеризации PostgreSQL компенсирует стоимость lookup через Index-Only Scan и covering-индексы (`INCLUDE`) — если все нужные колонки есть в индексе, обращение к heap вообще не требуется.
> theory/INDEXES.md §1

### Q28: Почему GIN-индекс — плохой выбор для часто обновляемой колонки?
**A:** GIN хранит инвертированный список: для каждого элемента составного значения (ключа jsonb, элемента массива, лексемы) — список строк, где он встречается. Любое изменение индексируемого значения означает переписать записи для всех его элементов в инвертированном списке, а не одну запись, как в B-tree, — «медленные обновления» оказываются не фигурой речи, а операцией порядка O(число элементов) на каждый UPDATE/INSERT. Поэтому GIN оправдан для редко изменяемых, часто читаемых данных (каталоги с тегами, архив для полнотекстового поиска) и рискован для полей, обновляемых в каждой транзакции.
> theory/INDEXES.md §4

### Q29: Как partial index уменьшает не только размер, но и время выполнения запроса, и какое условие обязательно для его использования?
**A:** Partial index строится не по всей таблице, а только по строкам, прошедшим WHERE (`CREATE INDEX ON orders(user_id) WHERE status != 'completed'`) — если таких строк 10% от таблицы, индекс физически в разы меньше, а значит меньше страниц читать и меньше уровней дерева B-tree. Выгода не автоматическая: планировщик применит индекс, только если условие запроса логически покрывается условием индекса (совпадает или является более строгим подмножеством) — запрос без этого WHERE или с несовместимым условием индекс просто не увидит и пойдёт в Seq Scan по всей таблице.
> theory/INDEXES.md §7

### Q30: Как устроен pg_trgm изнутри, и почему он делает быстрым `LIKE '%text%'`, который обычный B-tree построить не может?
**A:** B-tree индексирует значение целиком в лексикографическом порядке, поэтому полезен для `LIKE 'prefix%'` (можно сузить диапазон по префиксу), но бесполезен для `LIKE '%text%'` — искомая подстрока может начинаться где угодно. pg_trgm разбивает строку на все триграммы (тройки подряд идущих символов, включая границы) и индексирует их через GIN или GiST — поиск подстроки превращается в поиск строк, содержащих нужный набор триграмм, что сводится к обычному inverted-index lookup. Побочный эффект того же механизма — оператор `%` даёт нечёткий поиск по похожести (доля общих триграмм), а не только точный substring-матч.
> theory/INDEXES.md §9

### Q8: Что такое N+1 query problem?
**A:** 1 запрос для загрузки списка + N запросов для каждого элемента. Например, 100 заказов + для каждого SELECT пользователя = 101 запрос. Невидим на уровне domain-модели — обращение `order.getUser()` обычный геттер. Решения по приоритету: 1) `JOIN FETCH` (один SQL с join); 2) `@EntityGraph` (декларативно, переиспользуемо); 3) `@BatchSize(50)` или `hibernate.default_batch_fetch_size` (N+1 → ceil(N/batch)+1); 4) DTO projection — не грузить Entity вообще. Подвох с `JOIN FETCH + LIMIT`: Hibernate грузит **всё в память** и режет в Java — двухзапросный паттерн.
> theory/DATABASE_TYPES.md §6

---

## Типы баз данных и ORM (Q9–Q11)

### Q9: RDBMS vs NoSQL — когда что?
**A:** RDBMS — когда нужны строгая схема, ACID-транзакции, complex queries с joins, foreign key constraints. NoSQL — когда нужен horizontal scale, гибкая схема, специфический access pattern (KV для сессий, document для каталогов, wide-column для time-series, graph для социальных сетей, search для full-text). PostgreSQL хорошо справляется с большинством «NoSQL»-задач: jsonb, GIN, arrays, full-text — не торопись переключаться.
> theory/DATABASE_TYPES.md §2

### Q10: В чём преимущество колоночных БД для аналитики?
**A:** В строковых БД строка хранится физически последовательно — `SELECT AVG(salary)` читает все колонки. В колоночных каждая колонка отдельно — читается только `salary`, в 10-100× меньше I/O. Однородная колонка лучше сжимается (RLE, dictionary encoding) — числа одного диапазона, строки из словаря. Векторизованное выполнение через SIMD на батчах. Цена: INSERT/UPDATE медленнее, плохо для OLTP. Примеры: ClickHouse, BigQuery, Redshift, DuckDB, Parquet формат.
> theory/DATABASE_TYPES.md §4

### Q11: Что такое Identity Map и Unit of Work в ORM?
**A:** **Identity Map** — кэш загруженных объектов в одной сессии: гарантия «одна строка БД = один объект в памяти», `findById(1)` дважды → один и тот же object reference, второй вызов без SQL. **Unit of Work** — отслеживает изменения за «работу» (request/transaction), при flush/commit одним батчем шлёт UPDATE/INSERT/DELETE. Hibernate Session = Identity Map + Unit of Work + Dirty Checking. Подвох: Identity Map видит **только свою транзакцию** — concurrent UPDATE из другой сессии не виден до `refresh()`.
> theory/DATABASE_TYPES.md §6

### Q31: Почему одна и та же СУБД плохо справляется одновременно с OLTP и OLAP нагрузкой, и как HTAP-системы это обходят?
**A:** OLTP — короткие транзакции по немногим строкам (найти/обновить один заказ), для которых оптимален row-store: вся строка лежит подряд, читается одним I/O. OLAP — агрегаты по немногим колонкам, но по огромному числу строк (`AVG(salary)` по всей таблице), для которых row-store вынужден читать и ненужные колонки — здесь выигрывает column-store, где нужная колонка лежит физически отдельно и хорошо сжимается. Это архитектурный компромисс на уровне физического layout, а не настройки: одна структура хранения не может быть одновременно оптимальной для точечного доступа по строке и для сканирования по колонке. HTAP-системы (TiDB, SingleStore) решают это не «одним волшебным форматом», а держа **обе** копии данных — row-store для OLTP-пути и column-store (обновляемую почти в реальном времени) для аналитики — и раздают запрос нужному движку под капотом.
> theory/DATABASE_TYPES.md §3

### Q32: Почему sliding-window rate limiter в Redis реализуют через Sorted Set, а не через простой счётчик с TTL?
**A:** Счётчик `INCR` + `EXPIRE` даёт fixed-window limiter: окно жёстко привязано к границе времени, и это позволяет протащить в 2 раза больше запросов, чем лимит, если они кучкуются на стыке двух окон (конец одной минуты + начало следующей). Sorted Set хранит **каждый запрос отдельным элементом** со score = его timestamp: `ZADD` добавляет новый запрос, `ZREMRANGEBYSCORE` перед подсчётом выбрасывает всё, что старше `now - window`, а `ZCARD` даёт точное число запросов в **скользящем**, а не фиксированном окне. Цена — O(log N) на операцию и память на каждый отдельный запрос вместо одного числа, но лимит соблюдается честно в любой момент времени, а не только на границах окна.
> theory/DATABASE_TYPES.md §5

---

## Движки хранилища (Q12–Q14)

### Q12: LSM-tree vs B-tree — когда что?
**A:** **B-tree** (PostgreSQL/InnoDB) — in-place updates, leaf splits/merges, read-friendly: 1 point lookup = O(log n) с малой константой, range scan тривиален. **LSM-tree** (RocksDB/Cassandra/HBase) — append-only memtable → flush в SSTable → background compaction. Запись быстрее (sequential disk), но read требует поиска в memtable + всех SSTable (через Bloom filter оптимизация). Write amplification из-за compaction. Выбор: write-heavy + sequential reads → LSM; read-heavy + complex queries → B-tree. Современные DBs часто гибрид (PostgreSQL TOAST, MySQL Change Buffer).
> theory/STORAGE_ENGINES.md §8

### Q13: Зачем нужен WAL и что такое group commit?
**A:** **Write-Ahead Log** — изменения сначала пишутся в append-only лог, потом применяются к данным. Гарантирует Atomicity (rollback по логу) и Durability (recovery после crash). Без fsync лога нет гарантии Durability — поэтому `synchronous_commit=on` ждёт fsync. **Group commit** — пакетная запись логов нескольких транзакций одним fsync: повышает пропускную способность в сотни раз ценой малой задержки. PostgreSQL: `commit_delay`, MySQL: `innodb_flush_log_at_trx_commit=1` + binlog group commit.
> theory/STORAGE_ENGINES.md §5

### Q14: Что такое compaction в LSM-tree и какие стратегии бывают?
**A:** Compaction — фоновое слияние SSTable: удаление tombstones, дедупликация ключей, удаление устаревших версий. **Leveled compaction** (RocksDB, Cassandra LCS) — фиксированные уровни L0/L1/.../Ln, размер растёт в 10× по уровням; меньше read amplification, больше write amplification. **Size-tiered** (Cassandra STCS) — SSTable-файлы группируются по схожему размеру; меньше write amp, больше space amp. **Time-window** (Cassandra TWCS) — для time-series, окна не пересекаются. Trade-off: write/read/space amplification.
> theory/STORAGE_ENGINES.md §3

### Q33: Почему UUID v4 в качестве первичного ключа деградирует производительность B-tree движка, и как это чинят?
**A:** Вставка в середину дерева, а не в конец, требует физического `page split` — прочитать/переписать сразу несколько страниц плюс WAL-запись, что кратно дороже, чем append в конец. UUID v4 полностью случаен, поэтому каждый INSERT попадает в случайное место дерева — почти каждая вставка рискует вызвать split, а страницы в итоге используются в среднем на ~50% (fill factor деградирует). Решение — использовать упорядоченные во времени идентификаторы (UUIDv7, ULID, Snowflake, autoincrement/sequence): они монотонно возрастают, поэтому вставки идут в конец дерева, split почти не нужен, страницы утилизируются полностью.
> theory/STORAGE_ENGINES.md §1

### Q34: Как Bloom filter ускоряет point lookup в LSM-tree, и почему false positive допустим, а false negative — нет?
**A:** GET по ключу в LSM в худшем случае должен проверить memtable и все SSTable на диске, потому что заранее неизвестно, в какой из них лежит ключ — большинство таких проверок впустую. Bloom filter — вероятностная структура в RAM на каждую SSTable: `mightContain(key)` может ошибочно ответить «да» для отсутствующего ключа (false positive, ~1% при типичной настройке), но никогда не ответит «нет» для существующего (false negative невозможен по построению — иначе индекс потерял бы реальные данные). Это позволяет перед каждым диск-I/O сначала спросить фильтр в RAM: «нет» — гарантированно пропустить эту SSTable, «да» (даже если иногда ошибочно) — пойти проверить на диске. В результате из N SSTable реально читается лишь та доля, где Bloom сказал «может быть».
> theory/STORAGE_ENGINES.md §4

### Q35: Что такое HOT-update в PostgreSQL, и почему он быстрее обычного UPDATE, если PostgreSQL всегда создаёт новую версию строки?
**A:** Из-за MVCC любой UPDATE в PostgreSQL создаёт новый tuple, а не переписывает старый на месте — казалось бы, значит нужно обновить и все вторичные индексы, ссылающиеся на старую версию. HOT (Heap-Only Tuple) — оптимизация для случая, когда UPDATE не меняет ни одной проиндексированной колонки и новая версия строки помещается на ту же страницу heap, что и старая: тогда новый tuple связывается со старым прямой ссылкой внутри страницы, и ни один индекс трогать не нужно — они по-прежнему указывают на ту же страницу. Практическое следствие: если обновляемая колонка входит хоть в один индекс, HOT не сработает, и обновление снова обходится по цене «новый tuple + правка всех индексов».
> theory/STORAGE_ENGINES.md §6

---

## Репликация (Q15–Q17)

### Q15: Single-leader vs multi-leader vs leaderless — когда что?
**A:** **Single-leader** (PostgreSQL/MySQL): все записи на leader, реплики для чтения. Простая семантика, понятный failover, но leader — узкое место для пропускной способности записи. **Multi-leader** (cross-DC active-active): пишут на разные узлы, конфликты при concurrent write одного ключа → разрешение LWW / app-level / CRDT. Сложно. **Leaderless** (Dynamo: Cassandra/Riak): любой узел принимает write, через quorum R+W>N достигается consistency; eventual через read repair + hinted handoff + anti-entropy.
> theory/REPLICATION.md §10

### Q16: Что такое replication lag и read-your-writes consistency?
**A:** Replication lag — отставание replica от leader (в секундах/lag-байтах WAL). Может вызвать «прочитал старое после write» (классический баг профиля). Решения: **read-your-writes** через sticky session (один user → одна replica с привязкой), чтение с leader для критичных операций (профиль после редактирования), bounded staleness check (`pg_last_xact_replay_timestamp()` vs leader), session-level monotonic reads (`SELECT pg_last_wal_replay_lsn() >= my_write_lsn`).
> theory/REPLICATION.md §4

### Q17: Что такое CDC и как работает Debezium?
**A:** **Change Data Capture** — стриминг изменений из БД как поток событий. Debezium читает WAL PostgreSQL (через logical replication slot) или binlog MySQL → публикует в Kafka. Гарантия — at-least-once. Используется для: 1) cache invalidation; 2) search index sync (Elasticsearch); 3) outbox-like паттерн без отдельной таблицы; 4) data lake ingestion; 5) materialized views в другой БД. Преимущество над dual-write — атомарность (один источник правды — БД), без потерянных событий при сбое kafka.
> theory/REPLICATION.md §8

### Q36: Почему `synchronous_commit` — не бинарный переключатель, а спектр режимов, и где на нём типично останавливаются?
**A:** На одном конце — чисто async: leader коммитит после локального fsync, реплики догоняют в фоне — минимальная задержка, но при падении leader до отправки WAL реплике теряются последние коммиты. На другом — строгий sync: leader ждёт fsync на реплике, что даёт zero data loss, но задержку каждого коммита, равную RTT + fsync реплики, и риск, что при недоступности sync-реплики leader вообще заблокируется. Между ними — режимы вроде `remote_write`/`remote_apply` (ждать не fsync, а лишь получение/применение записи репликой) и semi-sync (ждать подтверждения приёма от одной реплики без fsync) — они сокращают окно потери данных, не платя полную цену синхронного fsync. На практике финтех-системы комбинируют: sync на одну близкую реплику (durability при failover) + async на удалённую DR-реплику (без просадки latency трансконтинентальным RTT).
> theory/REPLICATION.md §3

### Q37: Почему автоматический failover без fencing опаснее, чем его отсутствие, и как решается split-brain?
**A:** Автоматический failover детектирует «недоступность» leader по таймауту heartbeat — но недоступность для мониторинга не значит, что leader действительно мёртв: это может быть временный network partition, за которым старый leader продолжает как ни в чём не бывало принимать записи от своей части клиентов. Если новый leader выбран и продолжает принимать записи параллельно со старым — получаются две независимые, расходящиеся истории данных (split-brain), которые потом нельзя слить автоматически (GitHub 2018 — 24 часа ручной сверки, ~4% данных). Решение — fencing: гарантировать, что старый leader физически не сможет закоммитить запись после потери лидерства — через монотонный fencing token, отзыв VIP или STONITH. Сам выбор нового leader должен требовать кворума большинства узлов (Raft/ZAB) — тогда меньшая часть partition просто не наберёт голосов для избрания, и split-brain невозможен по построению.
> theory/REPLICATION.md §7

### Q38: Почему для zero-downtime апгрейда версии PostgreSQL используют логическую репликацию, а не физическую?
**A:** Физическая репликация транслирует WAL побайтово на уровне страниц — реплика обязана быть той же мажорной версии и архитектуры, что и leader, потому что формат страниц может отличаться между версиями. Логическая репликация транслирует не байты страниц, а логические операции (INSERT/UPDATE/DELETE со значениями) через publication/subscription — приёмник интерпретирует их как обычные SQL-операции, поэтому версии издателя и подписчика могут различаться. Это же свойство даёт возможность реплицировать не всю базу, а подмножество таблиц, и трансформировать данные по пути — чего физическая репликация в принципе не может, так как копирует всё «как есть» вплоть до системных изменений типа VACUUM.
> theory/REPLICATION.md §9

---

## Шардирование (Q18–Q21)

### Q18: Range vs Hash vs Directory sharding — trade-off?
**A:** **Range** (`user_id 0-1M → shard0, 1M-2M → shard1`): хорошо для range queries, плохо для неравномерных ключей → hot spots. **Hash** (`shard = hash(key) % N`): равномерное распределение, нет range queries — летят на все шарды (scatter-gather). **Directory** (lookup service): гибкость + сложность + lookup-service как SPOF. **Geo** (по региону): data residency / GDPR. Выбор: для timeline (Twitter) — hash по user_id; для time-series — range по time; для multi-tenant SaaS — directory по tenant_id.
> theory/SHARDING.md §2

### Q19: Что такое consistent hashing и зачем virtual nodes?
**A:** Consistent hashing — ключи и узлы кладутся на одно «кольцо» хэшей; ключ принадлежит первому узлу по часовой стрелке. При добавлении/удалении узла перераспределяется только **K/N** ключей (не всё, как в `% N`). Проблема naive: неравномерность из-за случайных хэшей → одни узлы получают больше нагрузки. Решение — **virtual nodes**: каждый физический узел представлен 100-200 точками на кольце → распределение усредняется + при добавлении узла нагрузка перетекает со многих, а не одного.
> theory/SHARDING.md §3

### Q20: Что делать с hot key (celebrity user) при шардировании?
**A:** Если все запросы летят на один shard (Justin Bieber tweets, popular video): **1) Request coalescing** в кэше / API (одна downstream вместо N); **2) Sticky sharding** — несколько шардов для одного hot key, читает любой, пишет primary; **3) Key splitting** — разбить hot key на N виртуальных (`user:bieber:0..9`), пишущий выбирает случайный, читающий — все; **4) Caching** перед БД (Redis с реплицированием hot keys); **5) Asymmetric replication** — больше реплик для hot user. Детектирование — мониторинг per-key QPS.
> theory/SHARDING.md §5

### Q21: Как делать resharding в работающей системе?
**A:** Splitting hot shard — самый частый сценарий. Варианты: **1) Dual-write** — приложение пишет в старый и новый shard, читает из старого; после backfill — переключение чтения. **2) CDC-based migration** — backfill через snapshot + streaming изменений через Debezium до точки переключения. **3) Vitess-style** — middleware скрывает sharding от приложения, делает online split. **4) Append-only resharding** — новые данные идут в новый shard, старые остаются (приложение знает routing). Ключевые требования: zero downtime, idempotent reads, consistent cutover.
> theory/SHARDING.md §6

### Q39: Чем rendezvous hashing (HRW) выгодно отличается от consistent hashing, и какова его цена?
**A:** Consistent hashing требует virtual nodes, чтобы сгладить неравномерность распределения по кольцу, — без них узлы получают ощутимо разную долю ключей просто из-за случайности хэшей. HRW обходится без кольца вообще: для ключа перебираются все узлы, вычисляется `hash(node + key)`, и ключ достаётся узлу с максимальным значением — распределение получается равномерным без искусственного размножения точек. При удалении узла его ключи не концентрируются на соседе по кольцу, а расходятся по всем оставшимся узлам (для каждого просто пересчитывается новый максимум) — более резилентно, чем consistent hashing. Цена — lookup требует O(N) хэшей (по одному на каждый узел) вместо O(log N) обхода структуры кольца, поэтому HRW предпочтителен при небольшом/среднем числе узлов, а consistent hashing — при очень большом N и lookup-heavy нагрузке.
> theory/SHARDING.md §4

### Q40: В чём компромисс между локальным и глобальным вторичным индексом на шардированных данных?
**A:** Локальный вторичный индекс каждый shard строит только по своим строкам — запрос без shard key (`WHERE email = ...`) не может знать, на каком шарде искать, поэтому уходит на все шарды (scatter-gather), и его latency равна максимуму среди всех ответивших шардов, а добавление шардов увеличивает fan-out. Глобальный вторичный индекс (DynamoDB GSI, Spanner) — отдельная структура, хранящая mapping `email → shard key`, что даёт целевой lookup без обращения ко всем шардам — но запись при этом должна атомарно обновить и основной shard, и индекс-структуру, что требует распределённой транзакции или согласия на eventual consistency между ними. Выбор — это выбор, где платить: на чтении (scatter-gather у локального) или на записи (cross-shard coordination у глобального).
> theory/SHARDING.md §7

### Q41: Почему наивный JOIN через шарды особенно плох, и какие есть практические альтернативы?
**A:** JOIN, разнесённый по шардам, требует либо перекачать часть данных с одного шарда на другой перед соединением, либо смёрджить результаты приложением — в обоих случаях задержка становится не «время одного запроса», а `max(per-shard latency) + стоимость слияния`, и она растёт с числом задействованных шардов вместо того, чтобы оставаться константой. Практические альтернативы: денормализация — заранее дублировать нужные для join данные внутри одного шарда (Cassandra-way); application-level join — читать из каждого шарда отдельно и соединять в коде (годится при малом N); precomputed aggregates — пересчитывать нужные сводки асинхронно через CDC заранее; и distributed SQL (Spanner, CockroachDB) — где scatter-gather join делает сама СУБД прозрачно для приложения, ценой сложности внутри движка.
> theory/SHARDING.md §8

---

## Источники

- *Designing Data-Intensive Applications* (Martin Kleppmann, O'Reilly 2017) — Ch. 5 (Replication), Ch. 6 (Partitioning), Ch. 7 (Transactions), Ch. 11 (Stream Processing).
- *Database Internals* (Alex Petrov, O'Reilly 2019) — LSM, B-tree, WAL, replication.
- *PostgreSQL 16 Documentation* — [Concurrency Control](https://www.postgresql.org/docs/16/mvcc.html), [Indexes](https://www.postgresql.org/docs/16/indexes.html).
- [*Use The Index, Luke!* (Markus Winand)](https://use-the-index-luke.com/) — индексы и план выполнения.
- [Vlad Mihalcea — High-Performance Java Persistence](https://vladmihalcea.com/) — ORM patterns, N+1, locking.
- [Jepsen analyses](https://jepsen.io/analyses) — реальные гарантии БД под partition.
- [Confluent — Debezium docs](https://debezium.io/documentation/) — CDC.
