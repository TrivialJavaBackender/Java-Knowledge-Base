# Interview Questions — Databases

Вопросы по реляционным и NoSQL базам, транзакциям, индексам, storage engines, репликации и шардингу.

> **Историческая справка:** Q1–Q5 ранее жили в `system-design/INTERVIEW_QUESTIONS.md` как Q17–Q21. При миграции номера могут не сохраниться в Leitner-стейте — это ожидаемо.

---

## Transactions & Isolation (Q1–Q4)

### Q1: Какие уровни изоляции транзакций вы знаете?
**A:** READ UNCOMMITTED — dirty read возможен. READ COMMITTED (PostgreSQL default) — нет dirty read, но non-repeatable read и phantom возможны. REPEATABLE READ (MySQL default) — нет dirty/non-repeatable read, phantom возможен в стандарте ANSI (но в PostgreSQL устраняется через snapshot isolation). SERIALIZABLE — полная изоляция, как последовательное выполнение. В PostgreSQL реализован через SSI (Serializable Snapshot Isolation, Cahill 2008) — не блокирует, но требует retry на SQLSTATE 40001.
> Berenson et al. (1995) — A Critique of ANSI SQL Isolation Levels

### Q2: Что такое lost update и как его предотвратить?
**A:** Два потока читают одно значение, оба изменяют и пишут — запись первого перезаписывается. Решения: 1) `SELECT ... FOR UPDATE` (pessimistic, блокировка строки); 2) `UPDATE ... WHERE version = ?` с проверкой числа затронутых строк (optimistic); 3) атомарный UPDATE без предварительного SELECT (`UPDATE accounts SET balance = balance - 100 WHERE id = ? AND balance >= 100`). В PostgreSQL REPEATABLE READ ловит lost update как 40001 ошибку — нужна retry-логика с jitter.

### Q3: Что такое write skew и как его предотвратить?
**A:** Write skew — каждая транзакция корректна по отдельности (читает одно, пишет другое), но вместе нарушают инвариант. Пример: «хотя бы один доктор на дежурстве» — T1 и T2 проверяют count=2, оба снимают своего доктора, count=0. REPEATABLE READ от write skew **не защищает** (snapshot isolation видит «свою» картину). Решения: SERIALIZABLE (SSI), материализация конфликта через INSERT в lock-таблицу + FOR UPDATE, EXCLUDE constraint для range-overlap.

### Q4: Что такое MVCC и зачем нужен VACUUM?
**A:** Multi-Version Concurrency Control: при UPDATE PostgreSQL не перезаписывает строку, а создаёт новую версию tuple с xmin/xmax. Старая помечается «удалённой» текущей транзакцией. Readers никогда не блокируют writers — каждый видит свою версию. VACUUM собирает мёртвые tuple'ы (старые версии) — без него таблица «пухнет» (bloat). VACUUM FULL физически удаляет с ACCESS EXCLUSIVE lock — нужен только при сильном bloat. Transaction ID — 32-bit счётчик: при wraparound (~2 млрд) PostgreSQL переходит в аварийный режим — autovacuum «замораживает» старые tuple для предотвращения.

---

## Indexes & Query Planning (Q5–Q8)

### Q5: Когда индекс не помогает?
**A:** 1) Low cardinality (boolean, gender) — Seq Scan дешевле; 2) функция/выражение над колонкой в WHERE (`WHERE YEAR(created_at) = 2024`) — нужен expression index; 3) leading wildcard (`LIKE '%text'`) — нужен pg_trgm GIN; 4) type mismatch (varchar vs integer); 5) маленькая таблица — оптимизатор выбирает seq scan; 6) устаревшая статистика — нужен `ANALYZE`. Проверка: `EXPLAIN ANALYZE` → если `Seq Scan` вместо ожидаемого `Index Scan` — копать причину.

### Q6: B-tree vs Hash vs GIN vs GiST vs BRIN — когда какой?
**A:** **B-tree** (default) — equality + range + LIKE 'prefix%', сортировка, Index-Only Scan через INCLUDE. **Hash** — только `=` на длинных ключах (UUID, токены), компактнее B-tree. **GIN** — inverted index для jsonb/arrays/full-text: быстрые запросы, медленные обновления, большой размер. **GiST** — extensible для ranges (EXCLUDE constraint), geo (PostGIS), быстрые обновления, lossy с recheck. **BRIN** — min/max по блокам, размер в 100× меньше B-tree, но работает только при физической упорядоченности (append-only логи).

### Q7: В чём разница Index Scan, Index-Only Scan и Bitmap Heap Scan?
**A:** **Index Scan** — читает индекс, для каждой найденной записи идёт в heap за остальными колонками; хорош при низкой селективности. **Index-Only Scan** — все нужные колонки в индексе (через INCLUDE или covering); heap не нужен → в разы быстрее. **Bitmap Heap Scan** — сначала собирает bitmap страниц из индекса (или нескольких индексов через AND/OR), потом одним проходом читает heap; хорош при средней селективности и при объединении индексов.

### Q8: Что такое N+1 query problem?
**A:** 1 запрос для загрузки списка + N запросов для каждого элемента. Например, 100 заказов + для каждого SELECT пользователя = 101 запрос. Невидим на уровне domain-модели — обращение `order.getUser()` обычный геттер. Решения по приоритету: 1) `JOIN FETCH` (один SQL с join); 2) `@EntityGraph` (декларативно, переиспользуемо); 3) `@BatchSize(50)` или `hibernate.default_batch_fetch_size` (N+1 → ceil(N/batch)+1); 4) DTO projection — не грузить Entity вообще. Подвох с `JOIN FETCH + LIMIT`: Hibernate грузит **всё в память** и режет в Java — двухзапросный паттерн.

---

## Database Types & ORM (Q9–Q11)

### Q9: RDBMS vs NoSQL — когда что?
**A:** RDBMS — когда нужны строгая схема, ACID-транзакции, complex queries с joins, foreign key constraints. NoSQL — когда нужен horizontal scale, гибкая схема, специфический access pattern (KV для сессий, document для каталогов, wide-column для time-series, graph для социальных сетей, search для full-text). PostgreSQL хорошо справляется с большинством «NoSQL»-задач: jsonb, GIN, arrays, full-text — не торопись переключаться.

### Q10: В чём преимущество колоночных БД для аналитики?
**A:** В строковых БД строка хранится физически последовательно — `SELECT AVG(salary)` читает все колонки. В колоночных каждая колонка отдельно — читается только `salary`, в 10-100× меньше I/O. Однородная колонка лучше сжимается (RLE, dictionary encoding) — числа одного диапазона, строки из словаря. Векторизованное выполнение через SIMD на батчах. Цена: INSERT/UPDATE медленнее, плохо для OLTP. Примеры: ClickHouse, BigQuery, Redshift, DuckDB, Parquet формат.

### Q11: Что такое Identity Map и Unit of Work в ORM?
**A:** **Identity Map** — кэш загруженных объектов в одной сессии: гарантия «одна строка БД = один объект в памяти», `findById(1)` дважды → один и тот же object reference, второй вызов без SQL. **Unit of Work** — отслеживает изменения за «работу» (request/transaction), при flush/commit одним батчем шлёт UPDATE/INSERT/DELETE. Hibernate Session = Identity Map + Unit of Work + Dirty Checking. Подвох: Identity Map видит **только свою транзакцию** — concurrent UPDATE из другой сессии не виден до `refresh()`.

---

## Storage Engines (Q12–Q14)

### Q12: LSM-tree vs B-tree — когда что?
**A:** **B-tree** (PostgreSQL/InnoDB) — in-place updates, leaf splits/merges, read-friendly: 1 point lookup = O(log n) с малой константой, range scan тривиален. **LSM-tree** (RocksDB/Cassandra/HBase) — append-only memtable → flush в SSTable → background compaction. Запись быстрее (sequential disk), но read требует поиска в memtable + всех SSTable (через Bloom filter оптимизация). Write amplification из-за compaction. Выбор: write-heavy + sequential reads → LSM; read-heavy + complex queries → B-tree. Современные DBs часто гибрид (PostgreSQL TOAST, MySQL Change Buffer).

### Q13: Зачем нужен WAL и что такое group commit?
**A:** **Write-Ahead Log** — изменения сначала пишутся в append-only лог, потом применяются к данным. Гарантирует Atomicity (rollback по логу) и Durability (recovery после crash). Без fsync лога нет гарантии Durability — поэтому `synchronous_commit=on` ждёт fsync. **Group commit** — пакетная запись логов нескольких транзакций одним fsync: повышает throughput в сотни раз ценой малой latency-задержки. PostgreSQL: `commit_delay`, MySQL: `innodb_flush_log_at_trx_commit=1` + binlog group commit.

### Q14: Что такое compaction в LSM-tree и какие стратегии бывают?
**A:** Compaction — фоновое слияние SSTable: удаление tombstones, дедупликация ключей, удаление устаревших версий. **Leveled compaction** (RocksDB, Cassandra LCS) — фиксированные уровни L0/L1/.../Ln, размер растёт в 10× по уровням; меньше read amplification, больше write amplification. **Size-tiered** (Cassandra STCS) — sst'ы группируются по схожему размеру; меньше write amp, больше space amp. **Time-window** (Cassandra TWCS) — для time-series, окна не пересекаются. Trade-off: write/read/space amplification.

---

## Replication (Q15–Q17)

### Q15: Single-leader vs multi-leader vs leaderless — когда что?
**A:** **Single-leader** (PostgreSQL/MySQL): все записи на leader, реплики для чтения. Простая семантика, понятный failover, но leader — bottleneck для write throughput. **Multi-leader** (cross-DC active-active): пишут на разные узлы, конфликты при concurrent write одного ключа → разрешение LWW / app-level / CRDT. Сложно. **Leaderless** (Dynamo: Cassandra/Riak): любой узел принимает write, через quorum R+W>N достигается consistency; eventual через read repair + hinted handoff + anti-entropy.

### Q16: Что такое replication lag и read-your-writes consistency?
**A:** Replication lag — отставание replica от leader (в секундах/lag-байтах WAL). Может вызвать «прочитал старое после write» (классический баг профиля). Решения: **read-your-writes** через sticky session (один user → одна replica с привязкой), чтение с leader для критичных операций (профиль после редактирования), bounded staleness check (`pg_last_xact_replay_timestamp()` vs leader), session-level monotonic reads (`SELECT pg_last_wal_replay_lsn() >= my_write_lsn`).

### Q17: Что такое CDC и как работает Debezium?
**A:** **Change Data Capture** — стриминг изменений из БД как поток событий. Debezium читает WAL PostgreSQL (через logical replication slot) или binlog MySQL → публикует в Kafka. Гарантия — at-least-once. Используется для: 1) cache invalidation; 2) search index sync (Elasticsearch); 3) outbox-like паттерн без отдельной таблицы; 4) data lake ingestion; 5) materialized views в другой БД. Преимущество над dual-write — атомарность (один источник правды — БД), без потерянных событий при сбое kafka.

---

## Sharding (Q18–Q21)

### Q18: Range vs Hash vs Directory sharding — trade-off?
**A:** **Range** (`user_id 0-1M → shard0, 1M-2M → shard1`): хорошо для range queries, плохо для неравномерных ключей → hot spots. **Hash** (`shard = hash(key) % N`): равномерное распределение, нет range queries — летят на все шарды (scatter-gather). **Directory** (lookup service): гибкость + сложность + lookup-service как SPOF. **Geo** (по региону): data residency / GDPR. Выбор: для timeline (Twitter) — hash по user_id; для time-series — range по time; для multi-tenant SaaS — directory по tenant_id.

### Q19: Что такое consistent hashing и зачем virtual nodes?
**A:** Consistent hashing — ключи и узлы кладутся на одно «кольцо» хэшей; ключ принадлежит первому узлу по часовой стрелке. При добавлении/удалении узла перераспределяется только **K/N** ключей (не всё, как в `% N`). Проблема naive: неравномерность из-за случайных хэшей → одни узлы получают больше нагрузки. Решение — **virtual nodes**: каждый физический узел представлен 100-200 точками на кольце → распределение усредняется + при добавлении узла нагрузка перетекает со многих, а не одного.

### Q20: Что делать с hot key (celebrity user) при шардировании?
**A:** Если все запросы летят на один shard (Justin Bieber tweets, popular video): **1) Request coalescing** в кэше / API (одна downstream вместо N); **2) Sticky sharding** — несколько shard'ов для одного hot key, читает любой, пишет primary; **3) Key splitting** — разбить hot key на N виртуальных (`user:bieber:0..9`), пишущий выбирает случайный, читающий — все; **4) Caching** перед БД (Redis с реплицированием hot keys); **5) Asymmetric replication** — больше реплик для hot user. Детектирование — мониторинг per-key QPS.

### Q21: Как делать resharding в работающей системе?
**A:** Splitting hot shard — самый частый сценарий. Варианты: **1) Dual-write** — приложение пишет в старый и новый shard, читает из старого; после backfill — переключение чтения. **2) CDC-based migration** — backfill через snapshot + streaming изменений через Debezium до точки переключения. **3) Vitess-style** — middleware скрывает sharding от приложения, делает online split. **4) Append-only resharding** — новые данные идут в новый shard, старые остаются (приложение знает routing). Ключевые требования: zero downtime, idempotent reads, consistent cutover.

---

## Источники

- *Designing Data-Intensive Applications* (Martin Kleppmann, O'Reilly 2017) — Ch. 5 (Replication), Ch. 6 (Partitioning), Ch. 7 (Transactions), Ch. 11 (Stream Processing).
- *Database Internals* (Alex Petrov, O'Reilly 2019) — LSM, B-tree, WAL, replication.
- *PostgreSQL 16 Documentation* — [Concurrency Control](https://www.postgresql.org/docs/16/mvcc.html), [Indexes](https://www.postgresql.org/docs/16/indexes.html).
- [*Use The Index, Luke!* (Markus Winand)](https://use-the-index-luke.com/) — индексы и план выполнения.
- [Vlad Mihalcea — High-Performance Java Persistence](https://vladmihalcea.com/) — ORM patterns, N+1, locking.
- [Jepsen analyses](https://jepsen.io/analyses) — реальные гарантии БД под partition.
- [Confluent — Debezium docs](https://debezium.io/documentation/) — CDC.
