# Storage Engines

Storage engine — слой БД, который превращает SQL/API-операции в физические I/O на диске. Выбор engine определяет write/read amplification, задержку хвостовых запросов (latency tail), recovery time, способ репликации.

> **Scope**: B-tree vs LSM-tree, Write-Ahead Log, compaction strategies, embedded engines (RocksDB/InnoDB). Index-уровневая теория — см. [INDEXES.md](INDEXES.md). MVCC и tuple-формат PostgreSQL — см. [TRANSACTIONS.md](TRANSACTIONS.md).

---

## B-tree storage engines

**Принцип:** данные хранятся в сбалансированных страницах фиксированного размера (обычно 8KB/16KB). UPDATE — in-place перезапись страницы (с WAL логированием для recovery). Поиск — O(log n) с малой константой.

**Реализации:**
- **InnoDB** (MySQL/MariaDB) — clustered index: PK определяет физический порядок строк, вторичные индексы ссылаются на PK, не на rowid. Хорошо для PK-range queries, плохо для случайных INSERT по большому PK.
- **PostgreSQL heap + B-tree index** — heap не упорядочен (TID = (page, offset)); индексы ссылаются на TID. MVCC создаёт новые tuple-версии вместо in-place update — поэтому в PG нет кластерных индексов (физический порядок постоянно нарушается UPDATE'ами).
- **SQL Server / Oracle** — clustered index как в InnoDB, плюс heap-organized как в PG (на выбор).

**Сильные стороны:**
- Read-friendly: 1 point lookup = 3-4 страницы (root → internal → leaf → heap)
- Range scan тривиален: листовые страницы связаны в двусвязный список
- Index-Only Scan через covering index
- Предсказуемая задержка — нет background compaction

**Слабые стороны:**
- Random write на UPDATE/INSERT в середину дерева — `page split` дорог (read-modify-write 2 страниц + WAL)
- При INSERT с random PK (UUID v4) — fragmentation, ~50% утилизация страницы (B+ tree fill factor)
- Write amplification ~ 1× (одна логическая запись = 1-2 физических, но WAL удваивает)

**Меры противодействия:**
- **Sequential UUID** (UUIDv7, ULID, Snowflake) → INSERT идёт в конец → no page splits
- **FILLFACTOR** — оставлять free space в странице для будущих UPDATE без split
- **CLUSTER** в PostgreSQL (одноразовый, ACCESS EXCLUSIVE lock) — переупорядочивает физически по индексу

---

## LSM-tree storage engines

**Принцип** (Log-Structured Merge-tree, O'Neil 1996): все записи идут в **memtable** (in-memory sorted structure, обычно red-black tree или skip list); при заполнении memtable сбрасывается на диск как **SSTable** (Sorted String Table — immutable отсортированный файл). Background **compaction** сливает SSTables для удаления дубликатов и tombstones.

```
WRITE:
  1. WAL append (для durability при crash)
  2. memtable insert (sorted)
  3. memtable full → seal → flush as immutable SSTable (level 0)

READ:
  1. memtable lookup
  2. immutable memtables (если есть pending flush)
  3. SSTables по уровням L0 → L1 → ... → Ln (Bloom filter для пропуска)

COMPACTION (background):
  L0 SSTable + overlapping L1 SSTable → новый L1 SSTable
  (удалить дубликаты, tombstones, устаревшие versions)
```

**Реализации:**
- **RocksDB** (Facebook fork LevelDB) — embedded LSM. Используется в: TiKV, CockroachDB (Pebble — Go-port), Kafka Streams (state store), MyRocks (MySQL plugin), Cassandra 4+ (через storage proxy).
- **Cassandra** — Dynamo-style + LSM (через storage proxy). Per-table SSTables, compaction стратегии настраиваются.
- **HBase** — на Hadoop, MemStore + HFile (LSM на HDFS).
- **ScyllaDB** — C++ Cassandra-compatible с shard-per-CPU.

**Сильные стороны:**
- Write-friendly: append-only, sequential I/O → высокая пропускная способность записи (sequential disk ~ 500 MB/s vs random ~ 1 MB/s на HDD; на SSD разница меньше, но всё ещё есть)
- Compression — целые SSTable сжимаются лучше, чем разрозненные страницы
- Snapshot тривиален — SSTable immutable, hard link или copy-on-write

**Слабые стороны:**
- **Read amplification** — point lookup в worst case проверяет memtable + N SSTable; Bloom filter снижает до ~1 false positive на 100 запросов, но всё равно >1 I/O
- **Write amplification** — каждая запись прошла через N compaction уровней; на leveled compaction ~ 10-30×
- **Space amplification** — копии старых версий до compaction; tombstones до полного прохода
- **Compaction storms** — burst write → большой L0 → compaction съедает CPU/IO → проблемы с задержкой хвостовых запросов
- Range scan дороже, чем B-tree (читать все SSTable перекрытые range'ом)

---

## Compaction strategies (LSM)

Compaction — главный tuning knob LSM-trees. Компромисс между **write amplification**, **read amplification**, **space amplification**.

### Size-Tiered Compaction (STCS) — Cassandra default до 2.0

SSTables группируются по схожему размеру. Когда накапливается N (обычно 4) SSTable одного размера — сливаются в одну большего. По мере роста таблицы — больше уровней.

```
L1 (мелкие):  [128MB] [128MB] [128MB] [128MB] → compact → L2 [512MB]
L2:           [512MB] [512MB] [512MB] [512MB] → compact → L3 [2GB]
```

- ✓ **Low write amp** (~ 2-3×) — данные перезаписываются редко
- ✗ **High space amp** (~ 2×) — до compaction живут N копий
- ✗ **Read amp** растёт с уровнями (нужно проверить все)
- Хорошо для: write-heavy, временные данные с TTL

### Leveled Compaction (LCS) — RocksDB default, Cassandra LCS

Фиксированные уровни L0/L1/.../Ln, размер каждого следующего в 10× больше. Внутри уровня (кроме L0) SSTables **не перекрываются** по range — каждый ключ в L_k встречается ровно в одной SSTable.

```
L0:  [overlap allowed]
L1:  [a-c] [d-f] [g-j]    ← non-overlapping, ~ 100MB each, total ~ 1GB
L2:  [a-a5] [a5-b] ...    ← total ~ 10GB
L3:  ...                  ← total ~ 100GB
```

- ✗ **High write amp** (~ 10-30×) — данные многократно перезаписываются между уровнями
- ✓ **Low space amp** (~ 1.1×) — без дубликатов между уровнями
- ✓ **Predictable read** — 1 SSTable на уровень (плюс L0)
- Хорошо для: read-heavy с устоявшимся датасетом

### Time-Window Compaction (TWCS) — Cassandra TWCS

Для time-series. SSTables группируются по окнам времени (например, 1 час). Окна не пересекаются → compaction только внутри окна. Старые окна удаляются TTL целиком (drop SSTable, не compact).

- ✓ Минимальная write amp
- ✓ Эффективный TTL drop (целая SSTable)
- ✗ Range query по нескольким окнам — читает несколько SSTable
- Хорошо для: метрики, логи, IoT events

### Universal Compaction (RocksDB)

Похоже на STCS, но с верхней границей по количеству уровней. Используется когда space amp не критичен.

---

## Bloom filter — оптимизация LSM-read

**Проблема:** point lookup `GET key` в LSM требует проверить memtable + все SSTable. Большинство ключей нет в большинстве SSTable → лишние I/O.

**Решение:** на каждой SSTable хранится in-memory **Bloom filter** (probabilistic set):
- `mightContain(key) = true` — возможно, есть (false positive ~ 1%)
- `mightContain(key) = false` — гарантированно нет (no false negative)

→ Проверка Bloom O(1) в RAM до диска, отсекает 99% «нет в этой SSTable» → 1 SSTable на лookup вместо N.

Размер: ~ 10 bits/key для 1% FP rate. Для 1B ключей = 1.25 GB RAM — приемлемо.

Подробнее по Bloom filter и его вариантам см. [system-design/theory/algorithms/PROBABILISTIC_STRUCTURES.md](../../system-design/theory/algorithms/PROBABILISTIC_STRUCTURES.md).

---

## Write-Ahead Log (WAL)

**Принцип:** изменения сначала пишутся в append-only лог на диск (`fsync`), потом применяются к данным (heap pages / memtable). Гарантирует:
- **Atomicity**: при crash в середине транзакции — лог говорит «было COMMIT или нет?»; если нет — undo через лог (или просто не apply)
- **Durability**: после `COMMIT` лог на диске — данные не потеряются, даже если data pages ещё в page cache

```
Transaction:
  1. BEGIN — записать BEGIN-record в WAL buffer
  2. UPDATE — записать "old → new" в WAL buffer + изменить page в memory
  3. COMMIT — записать COMMIT-record + fsync WAL до возврата клиенту
  4. (фон) checkpoint — flush dirty pages в data files
  5. (фон) WAL cleanup — обрезать WAL до последнего checkpoint

Crash recovery:
  1. Найти последний checkpoint
  2. REDO: применить все WAL-записи после checkpoint
  3. UNDO: откатить незакоммиченные транзакции
```

**PostgreSQL:** WAL — основа всего: streaming replication, point-in-time recovery, logical replication (через `pgoutput` decoder), CDC через Debezium. `pg_wal/` директория.

**MySQL InnoDB:** двойной лог:
- `ib_logfile*` — InnoDB redo log (физический, для recovery страниц)
- `binlog` — logical replication log (на уровне statements или rows)

**LSM:** WAL обязателен (memtable в RAM теряется при crash). После crash — recovery через replay WAL до состояния memtable; SSTable durable независимо.

### Synchronous commit

```ini
# PostgreSQL
synchronous_commit = on    # ждать fsync WAL до return клиенту (default)
synchronous_commit = off   # не ждать → возможна потеря последних транзакций при crash (microseconds window)
synchronous_commit = local # ждать локальный fsync, не ждать replica ACK
synchronous_commit = remote_write # ждать пока replica приняла WAL (но не выполнила fsync)
synchronous_commit = remote_apply # ждать пока replica применила (read-your-writes на standby)
```

Компромисс: надёжность данных vs задержка коммита. Финтех — обычно `on` + sync replica. Аналитика — `off` приемлемо.

### Group commit

**Проблема:** `fsync` дорог (1-10ms на HDD, 100µs-1ms на SSD). Каждый COMMIT с одной транзакцией — fsync = bottleneck.

**Решение:** batch несколько COMMIT'ов одним fsync. PostgreSQL: `commit_delay = 100µs` + `commit_siblings = 5` — если в текущей транзакции есть 5+ active sibling, подождать 100µs и сделать общий fsync. MySQL: `innodb_flush_log_at_trx_commit = 1` (durable) + автоматический group commit с binlog.

Эффект: пропускная способность растёт в 10-100×, задержка индивидуальной транзакции +100µs.

---

## InnoDB vs PostgreSQL — storage layouts

| | InnoDB (MySQL) | PostgreSQL (heap + index) |
|---|---|---|
| Primary key | Кластерный индекс — строки физически в порядке PK | Heap — строки в порядке INSERT (плюс UPDATE creates new TID) |
| Secondary index | Хранит PK как pointer (двойной lookup при `SELECT *`) | Хранит TID (page, offset) — прямой доступ |
| UPDATE | In-place если влезает; иначе off-page (BLOB-like) | **Always new tuple** (MVCC) — старая помечается xmax, новая получает xmin |
| Old versions | Undo log (`ibdata1`/`undo_001`) — для consistent reads и rollback | **In-heap** — старые tuple лежат рядом до VACUUM |
| Index ↔ row | Через PK → 2 lookups | Через TID → 1 lookup, но HOT updates требуют heap scan на индексе |
| Page split impact | Меняет все secondary index? Нет — они ссылаются на PK | Меняет все индексы? Нет — TID стабилен (UPDATE создаёт новый TID, обновляет индексы) |

**HOT (Heap-Only Tuple) updates** в PG — если UPDATE не меняет indexed columns и новая версия влезает в ту же страницу, индексы не трогаются → быстрее. Маркер `_hot_update` в WAL.

---

## RocksDB как embedded engine

RocksDB — не самостоятельная БД, а **embedded library** (как SQLite). Хранит данные локально на одном узле. Транзакции и репликация — выше по стеку.

**Где используется:**
- **TiKV** (distributed transactional KV) — Raft + RocksDB per shard
- **CockroachDB** — раньше RocksDB, сейчас Pebble (Go port)
- **MyRocks** — MySQL storage engine на RocksDB (замена InnoDB для write-heavy)
- **Kafka Streams** — state store через RocksDB (changelog в Kafka topic)
- **Cassandra 4+** — экспериментальный bag store на RocksDB
- **ScyllaDB** — частичная интеграция

**Что предоставляет:**
- LSM-tree с настраиваемой compaction strategy
- Column families (виртуальные partitioning внутри одной БД)
- Snapshots, backups, replication через SST file ingestion
- Transactions (single-node, через WriteBatchWithIndex или Pessimistic/Optimistic transactions)
- Tunable: bloom filter bits/key, block cache size, write buffer, levels, target file size

---

## Сравнительная таблица

| | B-tree (InnoDB/PG) | LSM-tree (RocksDB/Cass) |
|---|---|---|
| Пропускная способность записи | Средняя (random I/O) | Высокая (sequential append) |
| Задержка чтения | Низкая, предсказуемая | Переменная (Bloom + multi-level) |
| Write amplification | ~ 1× | 10-30× (leveled) или 2-3× (sized) |
| Space amplification | Низкая (page-level free space) | 1.1× (LCS) до 2× (STCS) |
| Range scan | Очень эффективно | Дороже (multi-SSTable) |
| Сжатие | Page-level (хуже) | SSTable-level (лучше) |
| Восстановление после сбоя | WAL replay (быстро) | WAL → memtable replay (быстро) |
| Снапшот | Сложнее (versioning) | Тривиально (immutable SST) |
| Лучше всего подходит для | OLTP, сложных запросов | Write-heavy, time-series, KV |

---

## Источники

**Books:**
- *Database Internals* (Alex Petrov, O'Reilly 2019) — Part I (Storage Engines): B-trees, LSM, WAL, transactions.
- *Designing Data-Intensive Applications* (Martin Kleppmann, 2017) — Ch. 3 (Storage and Retrieval).
- *Transaction Processing: Concepts and Techniques* (Jim Gray, Andreas Reuter, 1992) — фундаментальная книга по WAL и recovery (ARIES algorithm).

**Papers:**
- [O'Neil et al. (1996) — «The Log-Structured Merge-Tree (LSM-Tree)»](https://www.cs.umb.edu/~poneil/lsmtree.pdf) — оригинал.
- [Mohan et al. (1992) — «ARIES: A Transaction Recovery Method Supporting Fine-Granularity Locking and Partial Rollbacks Using Write-Ahead Logging»](https://www.cs.berkeley.edu/~brewer/cs262/Aries.pdf) — основа recovery в InnoDB/PG/SQL Server.
- [Sears, Ramakrishnan (2012) — «bLSM: A General Purpose Log Structured Merge Tree» (SIGMOD)](http://www.cs.cmu.edu/~chensm/Big_Data_reading_group/papers/blsm-sigmod12.pdf).

**Engineering blogs / docs:**
- [RocksDB Wiki](https://github.com/facebook/rocksdb/wiki) — Compaction, Bloom filters, Column families, tuning guide.
- [«WiscKey: Separating Keys from Values in SSD-Conscious Storage» (Lu et al., FAST '16)](https://www.usenix.org/system/files/conference/fast16/fast16-papers-lu.pdf) — современная оптимизация LSM для SSD.
- [PostgreSQL — WAL Internals](https://www.postgresql.org/docs/16/wal-internals.html)
- [MySQL InnoDB Storage Engine](https://dev.mysql.com/doc/refman/8.0/en/innodb-storage-engine.html)
- [«How Discord Stores Trillions of Messages» (Discord blog, 2023)](https://discord.com/blog/how-discord-stores-trillions-of-messages) — переход с Cassandra на ScyllaDB, тюнинг LSM compaction.
