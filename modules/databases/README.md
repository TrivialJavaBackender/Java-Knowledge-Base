# databases

Подготовка к интервью по теме **Databases** — реляционные и NoSQL базы, транзакции, индексы, репликация, шардирование, storage engines. Покрывает то, что часто спрашивают на senior-собесах: от изоляции и MVCC в PostgreSQL до consistent hashing и LSM-tree.

## Структура

```
modules/databases/
├── theory/
│   ├── TRANSACTIONS.md         # ACID, isolation levels, MVCC, EXCLUDE, FOR UPDATE, SSI, savepoints
│   ├── INDEXES.md              # B-tree/Hash/GIN/GiST/BRIN/partial/expression/pg_trgm, EXPLAIN ANALYZE
│   ├── DATABASE_TYPES.md       # RDBMS/KV/Document/Wide-column/Graph/TS/Search, OLTP/OLAP, ORM patterns
│   ├── STORAGE_ENGINES.md      # LSM-tree vs B-tree, WAL, compaction, RocksDB/InnoDB
│   ├── REPLICATION.md          # leader-follower / multi-leader / leaderless, sync vs async, failover
│   └── SHARDING.md             # range/hash/directory, consistent hashing, resharding, hot-key
├── README.md
├── ROADMAP.md
├── PROGRESS.md
├── _SUMMARY.md
└── INTERVIEW_QUESTIONS.md
```

> **Чисто теоретический модуль.** Нет `pom.xml`, нет упражнений — материал изучается через теорию + interview-questions + flashcards.

## Темы (NO OVERLAP)

В этом модуле — **БД-фундамент**: транзакции, индексы, типы баз, storage engines, репликация, шардирование.

Уже покрыто в других модулях (ссылаемся, не дублируем):

- **Spring Data JPA, Hibernate L1/L2/Query cache, N+1 в JPA** → [`modules/spring-frameworks/`](../spring-frameworks/)
- **Caching patterns, eviction, Redis, consistent hashing (как cache distribution)** → [`modules/caching-deep-dive/`](../caching-deep-dive/)
- **Kafka, schema evolution** → [`modules/system-design/`](../system-design/theory/kafka.md)
- **CAP/PACELC, Lamport clocks, quorum** → [`modules/system-design/`](../system-design/theory/distributed_systems.md)
- **Pessimistic vs optimistic locking в коде** → [`modules/concurrency/`](../concurrency/)

## TODO для следующих итераций

- Object storage (S3 model)
- Distributed SQL (Spanner / CockroachDB / YugabyteDB)
- Columnar (ClickHouse / Snowflake / BigQuery / Druid / Pinot)
- Time-series (Influx / Timescale / Prometheus storage)
- Vector DBs (pgvector / Pinecone / Weaviate / Milvus)
- ETL/CDC в глубине (Debezium, Airbyte, Fivetran)
- Database internals deep (B-tree split/merge, query optimizer, statistics)

## Прогресс

См. [PROGRESS.md](PROGRESS.md) и [ROADMAP.md](ROADMAP.md).

## Интервью-вопросы

См. [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md) — формат `qa-bold`.

## Semantic Summary

См. [_SUMMARY.md](_SUMMARY.md) — semantic compression.
