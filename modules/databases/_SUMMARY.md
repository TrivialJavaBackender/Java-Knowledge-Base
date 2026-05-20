# Databases — Semantic Summary

## Core Model
БД — это **storage engine** (как лежат байты на диске) + **transactions** (как координируются изменения) + **indexes** (как быстро находить нужное) + **distribution** (replication для надёжности, sharding для масштаба). Каждый уровень имеет свои trade-off, и большинство интервью-вопросов сводится к «почему одно, а не другое».

## Key Concepts
- **ACID**: Atomicity (WAL), Consistency (constraints), Isolation (levels), Durability (fsync). Локальная гарантия — на одном узле. Для распределённых — Saga/2PC/eventual.
- **Isolation levels** (ANSI + анализ Berenson 1995): READ UNCOMMITTED → READ COMMITTED → REPEATABLE READ → SERIALIZABLE. Аномалии: dirty read, non-repeatable read, phantom, write skew. PostgreSQL: RC (default) — non-repeatable + phantom; RR — snapshot isolation, защита от phantom; SERIALIZABLE — SSI (Cahill 2008).
- **MVCC**: версии tuple через xmin/xmax. Readers не блокируют writers. VACUUM собирает мёртвые tuple. Transaction ID wraparound — 32-bit lim.
- **Locking primitives**: FOR UPDATE (эксклюзивный), FOR SHARE, FOR UPDATE NOWAIT, FOR UPDATE SKIP LOCKED (job queue). EXCLUDE constraint + GIST — атомарная проверка range-пересечений.
- **B-tree** — default index, range queries, sorted. **Hash** — только `=`. **GIN** — inverted index для jsonb/array/full-text. **GiST** — extensible, для ranges/geo/full-text (slow). **BRIN** — min/max по блокам, для append-only. **Partial/Expression** — индекс по подмножеству или результату.
- **EXPLAIN ANALYZE** — Seq Scan vs Index Scan vs Index-Only Scan vs Bitmap Heap Scan; cost/rows/loops; Hash Join vs Nested Loop vs Merge Join.
- **Database families**: RDBMS (PostgreSQL/MySQL), KV (Redis/DynamoDB), Document (MongoDB), Wide-column (Cassandra), Graph (Neo4j), Time-series (Influx/Timescale), Search (Elastic). OLTP vs OLAP vs HTAP. Columnar — лучше сжатие, AVG быстрее.
- **Redis**: String/Hash/List/Set/ZSet/Bitmap/HyperLogLog/Stream. RDB/AOF persistence. Sentinel/Cluster. Lua для атомарности.
- **ORM patterns**: Active Record vs Data Mapper, Identity Map, Unit of Work. **N+1** — главная боль ORM; решения: JOIN FETCH, @EntityGraph, @BatchSize, DTO projection. **LazyInitializationException** — обращение к LAZY collection после закрытия persistence context.
- **Storage engines**: B-tree (read-friendly, in-place updates, MySQL InnoDB/PostgreSQL) vs LSM-tree (write-optimized, append-only + compaction, RocksDB/Cassandra/HBase). WAL = Write-Ahead Log для recovery. Group commit для throughput.
- **Replication**: single-leader (PostgreSQL/MySQL), multi-leader (Cassandra cross-DC), leaderless/Dynamo (Cassandra/Riak quorum). Sync vs async — durability vs latency. Replication lag — read-your-writes через sticky session или чтение с leader.
- **Sharding**: range (ordered, hot spots), hash (uniform, no range queries), directory (lookup service), geo. **Consistent hashing** (ring + virtual nodes) — minimize remap on node changes. **Rendezvous hashing** — alternative. Resharding — splitting hot shard. Hot-key mitigations: request coalescing, key splitting, sticky sharding.

## Important Invariants
- MVCC: readers never block writers; каждая транзакция видит snapshot на момент своего старта (RR) или старта запроса (RC)
- B-tree: все листовые узлы на одной глубине (балансировка через split/merge)
- WAL: лог идёт **перед** изменениями на диск — гарантия atomicity и durability при crash
- Quorum read+write: R + W > N → strong consistency
- LSM compaction: tombstones окончательно удаляются только после прохождения через все уровни
- EXCLUDE constraint: атомарность проверки через GIST-индекс, не нужен FOR UPDATE или SERIALIZABLE
- @JoinFetch + LIMIT: Hibernate грузит **всё в память** и режет в Java — двухзапросный паттерн

## Common Pitfalls
- **Lost update в READ COMMITTED**: `SELECT count` + `UPDATE`; защита через атомарный UPDATE с условием или FOR UPDATE
- **REPEATABLE READ ≠ phantom-free** в стандарте ANSI, но в PostgreSQL — free (snapshot)
- **B-tree на boolean** или другой low-cardinality — оптимизатор предпочтёт Seq Scan
- **LIKE '%middle%'** не использует B-tree — нужен pg_trgm GIN
- **VACUUM не справляется** при долгих транзакциях → bloat → wraparound risk
- **Cassandra last-write-wins** на основе wall-clock timestamp — потеря concurrent writes
- **Multi-leader replication** в одну строку из двух DC → conflict, нужна стратегия разрешения (LWW / app-level / CRDT)
- **Resharding онлайн** — splitting hot shard, нужна стратегия dual-write или CDC
- **B-tree split на UUID PK** в InnoDB — random insert → page splits → fragmentation; решение — sequential UUID (UUIDv7) или ULID
- **N+1 query** — самая частая perf-проблема в ORM проектах

## Related Modules
- **`spring-frameworks`** — Spring Data JPA, Hibernate L1/L2/Query cache, @Transactional propagation, N+1 в JPA-контексте
- **`caching-deep-dive`** — Redis deep, consistent hashing для cache distribution, cache-DB consistency
- **`system-design`** — Kafka (events), CAP/PACELC, distributed_systems primitives, microservice_patterns (Saga/Outbox)
- **`concurrency`** — pessimistic vs optimistic locking как технические паттерны (синхронизация в памяти)
- **`infrastructure`** — managed databases (RDS/Aurora/Cloud SQL), DBaaS, IaC для БД
