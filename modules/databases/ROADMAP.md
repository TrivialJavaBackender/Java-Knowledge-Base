# databases — Roadmap

## Порядок прохождения

| Приоритет | Тема | Частота на собесах |
|-----------|------|--------------------|
| 1 | Transactions, ACID, Isolation levels, MVCC | ★★★★★ |
| 2 | Indexes (B-tree, GIN, EXPLAIN ANALYZE) | ★★★★★ |
| 3 | Replication (leader-follower, quorum) | ★★★★ |
| 4 | Sharding (consistent hashing, resharding) | ★★★★ |
| 5 | Storage engines (LSM vs B-tree, WAL) | ★★★★ |
| 6 | Database types (RDBMS/NoSQL families) | ★★★ |
| 7 | ORM patterns, N+1 | ★★★ |

---

## Модуль 1: Transactions & Isolation

📖 Теория: [theory/TRANSACTIONS.md](theory/TRANSACTIONS.md)

- [ ] ACID — что реализует БД, что — приложение
- [ ] WAL — как обеспечивает Atomicity + Durability
- [ ] Аномалии: dirty / non-repeatable / phantom / write skew / lost update
- [ ] READ COMMITTED (PostgreSQL default) — non-repeatable + phantom возможны
- [ ] REPEATABLE READ — snapshot isolation, защита от phantom в PostgreSQL (строже стандарта)
- [ ] SERIALIZABLE через SSI (PostgreSQL) — детект rw-зависимостей, retry на 40001
- [ ] MVCC: xmin/xmax, версии tuple, VACUUM, wraparound
- [ ] FOR UPDATE / FOR SHARE / NOWAIT / SKIP LOCKED — паттерн job queue
- [ ] EXCLUDE constraint + GIST — атомарная проверка range overlap
- [ ] Savepoints, Propagation.NESTED
- [ ] Retry на SQLSTATE 40001 / 40P01 с jitter

---

## Модуль 2: Indexes & Query Planning

📖 Теория: [theory/INDEXES.md](theory/INDEXES.md)

- [ ] B-tree: leftmost prefix, range queries, Index-Only Scan, INCLUDE
- [ ] Hash — только =, на длинных ключах
- [ ] GIN — jsonb / arrays / full-text inverted
- [ ] GiST — ranges (EXCLUDE), geo (PostGIS), lossy/recheck
- [ ] BRIN — append-only, корреляция с физическим порядком
- [ ] Partial / Expression индексы
- [ ] pg_trgm — `LIKE '%middle%'`, similarity
- [ ] EXPLAIN ANALYZE: Seq vs Index vs Index-Only vs Bitmap Heap Scan
- [ ] Hash Join vs Nested Loop vs Merge Join — когда какой
- [ ] Когда индекс НЕ помогает: low cardinality, функция над колонкой, leading wildcard, type mismatch

---

## Модуль 3: Database Types

📖 Теория: [theory/DATABASE_TYPES.md](theory/DATABASE_TYPES.md)

- [ ] RDBMS (PostgreSQL — ORDBMS) vs NoSQL families
- [ ] KV (Redis/DynamoDB), Document (MongoDB), Wide-column (Cassandra), Graph (Neo4j), Time-series (Influx), Search (Elastic)
- [ ] OLTP vs OLAP vs HTAP
- [ ] Columnar storage — почему быстрее AVG/SUM, хуже INSERT
- [ ] Redis: все 8 структур + типичные паттерны
- [ ] Redis vs Memcached
- [ ] ORM: Active Record vs Data Mapper, Identity Map, Unit of Work
- [ ] N+1 query problem + решения (JOIN FETCH, @EntityGraph, @BatchSize, DTO)
- [ ] LazyInitializationException

---

## Модуль 4: Storage Engines

📖 Теория: [theory/STORAGE_ENGINES.md](theory/STORAGE_ENGINES.md)

- [ ] B-tree storage: in-place updates, leaf splits, read-friendly
- [ ] LSM-tree: memtable + SSTable, immutable + compaction
- [ ] Compaction strategies: leveled (RocksDB / Cassandra LCS) vs tiered (Cassandra STCS)
- [ ] WAL: write-ahead semantics, group commit, fsync
- [ ] InnoDB clustered index vs PostgreSQL heap + index
- [ ] RocksDB как embedded engine (Kafka Streams, TiKV, CockroachDB)
- [ ] Bloom filter в LSM как оптимизация point lookup

---

## Модуль 5: Replication

📖 Теория: [theory/REPLICATION.md](theory/REPLICATION.md)

- [ ] Single-leader: PostgreSQL streaming replication, MySQL binlog
- [ ] Sync vs async replication — durability vs latency
- [ ] Replication lag, read-your-writes (sticky session, чтение с leader)
- [ ] Multi-leader: cross-DC, конфликты, LWW / CRDT / app-level resolution
- [ ] Leaderless (Dynamo-style): quorum R + W > N, sloppy quorum, hinted handoff
- [ ] Failover: orchestrator-based (Orchestrator/PgPool), consensus-based (Patroni)
- [ ] Split-brain prevention: fencing, STONITH, witness
- [ ] Logical vs physical replication
- [ ] CDC (Change Data Capture): Debezium через WAL/binlog

---

## Модуль 6: Sharding

📖 Теория: [theory/SHARDING.md](theory/SHARDING.md)

- [ ] Range sharding: hot spots при неравномерных ключах
- [ ] Hash sharding: uniform, нет range queries
- [ ] Directory sharding: lookup service, гибкость + complexity
- [ ] Geo sharding (data residency)
- [ ] **Consistent hashing**: ring + virtual nodes, minimize remap on resize
- [ ] **Rendezvous hashing** (HRW): alternative, проще ribbon
- [ ] Resharding: dual-write, CDC-based migration
- [ ] Hot-key / celebrity-user mitigations: request coalescing, sticky sharding, key splitting
- [ ] Secondary indexes на sharded data: local (scatter-gather) vs global
- [ ] Cross-shard joins — нет, через application или denormalization
