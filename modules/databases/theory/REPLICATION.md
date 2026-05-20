# Replication

Репликация — копирование данных между узлами для durability, read scaling, и fault tolerance. Главный вопрос — **где разрешён write** (один узел / несколько / любой) и **когда write считается успешным** (sync / async / quorum).

> **Scope**: топологии репликации, sync vs async, replication lag, failover, CDC. Низкоуровневый WAL — см. [STORAGE_ENGINES.md](STORAGE_ENGINES.md). CAP/PACELC/quorum теория — см. [system-design/theory/distributed_systems.md](../../system-design/theory/distributed_systems.md).

---

## Зачем репликация нужна

Четыре цели, часто пересекаются:

1. **Durability** — данные не пропадут, если один узел сгорит. RAID — на уровне диска; репликация — на уровне узла/DC.
2. **Read scaling** — несколько реплик отвечают на чтение; write остаётся узким местом, но 80% workload — чтения.
3. **Low latency** — реплика рядом с пользователем (geo-replication).
4. **High availability** — при падении одного узла другой берёт нагрузку.

> Репликация **не решает** проблему ёмкости (storage size, write throughput) — для этого нужно **шардирование** (см. [SHARDING.md](SHARDING.md)).

---

## Single-leader (Primary-Replica)

**Принцип:** один узел принимает writes (leader/primary/master), остальные — read-only реплики, синхронизирующиеся с лидером.

```
Client writes → Leader → replication stream → Replicas
Client reads  → Leader (для consistency) или → Replicas (eventual)
```

**Реализации:**
- **PostgreSQL** — streaming replication (физическая, через WAL), logical replication (через pgoutput decoder)
- **MySQL** — binlog-based (statement / row / mixed)
- **MongoDB replica set** — oplog-based, primary + secondaries + arbiter
- **Redis** — primary + replicas (RDB snapshot + command stream)

**Сильные стороны:**
- Простая семантика — один источник правды для writes
- Транзакции работают как на single-node
- Conflict-free — writes идут в одном порядке через leader
- Понятный failover (один кандидат → новый leader)

**Слабые стороны:**
- Leader — single point для write throughput
- Failover — несколько секунд downtime (детектирование + promotion)
- Stale reads с реплик (replication lag)

---

## Sync vs Async replication

Когда write считается успешным?

### Async replication

Leader подтверждает COMMIT клиенту **сразу после записи в локальный WAL**. Реплики догоняют когда смогут.

```
Client → Leader: COMMIT
Leader → local fsync ✓ → Client: OK
Leader → Replica (async, в фоне)
```

- ✓ Низкая latency commit (1 fsync)
- ✗ Потеря данных при failover: если leader умер до отправки на replica → промоутнутый replica не имеет последних commits
- ✗ Replication lag — stale reads с реплик

### Synchronous replication

Leader ждёт подтверждения от replica (или N реплик) **до подтверждения клиенту**.

```
Client → Leader: COMMIT
Leader → local fsync ✓
Leader → Replica → replica fsync ✓ → ack
Leader → Client: OK
```

- ✓ Zero data loss при failover (если хотя бы одна sync replica жива)
- ✗ Latency commit = max(leader fsync, replica round-trip + fsync) — обычно +1-10ms
- ✗ Доступность падает: если sync replica недоступна, leader блокируется или переходит в degraded mode

### Semi-sync / quorum sync

Компромисс: leader ждёт `K` реплик из `N`, не все.

- **MySQL semi-sync** — leader ждёт хотя бы одну replica подтвердила приём (не fsync) перед ack клиенту
- **PostgreSQL synchronous_commit = remote_write/remote_apply** + `synchronous_standby_names` с условиями (`ANY 2 (replica_a, replica_b, replica_c)`)
- **MongoDB write concern** `w: majority` — wait for majority of replica set

Финтех / payment systems обычно используют sync на одну local replica + async на DR-replica.

---

## Replication lag и его последствия

Async replication — replica всегда отстаёт. Lag измеряется в **секундах** или **байтах WAL**. При больших нагрузках может расти до минут.

**Симптомы для пользователя:**

| Сценарий | Проблема | Решение |
|----------|----------|---------|
| User обновляет профиль, перезагружает страницу — видит старое | Read after write violation | Sticky session, чтение с leader для своих writes |
| Дашборд показывает разные числа в разных виджетах | Inconsistent reads | Bounded staleness check, версионирование данных |
| User видит, что его сообщение в чате «пропало» (потом появляется) | Monotonic reads violation | Один пользователь — одна replica с привязкой |

### Read-your-writes consistency

Гарантия: пользователь всегда видит результат **своих** writes.

Реализации:
1. **Чтение с leader** для критичных операций (профиль, корзина, баланс)
2. **Sticky session**: один user → одна replica → если она получила write, она же отдаёт read
3. **LSN-based check**: после write клиент запоминает LSN (PostgreSQL `pg_current_wal_lsn()`); при read проверяет `pg_last_wal_replay_lsn() >= my_lsn`; если нет — fallback на leader
4. **Quorum reads** (если есть): R + W > N → пересечение гарантирует свежие данные

### Monotonic reads

Гарантия: пользователь не видит «откат во времени» — последовательные reads показывают одинаковую или более новую версию.

Реализации:
- Sticky session
- Хранить версионный токен у клиента, проверять replica.version >= client.version

### Causal consistency

Если A → B (A повлияло на B), все видят их в этом порядке. Vector clocks или happens-before tracking. См. [distributed_systems.md](../../system-design/theory/distributed_systems.md#lamport-timestamps--vector-clocks).

---

## Multi-leader replication

Несколько узлов принимают writes одновременно. Используется для:
- **Cross-DC active-active** — каждый DC имеет свой leader, синхронизация peer-to-peer
- **Multi-region** — leader близкий к пользователю, низкая latency
- **Edge / offline-first** — клиент = leader (Couchbase Mobile, IPFS)

```
DC1 Leader ↔ DC2 Leader ↔ DC3 Leader
   ↓           ↓           ↓
 Readers    Readers     Readers
```

**Конфликты** неизбежны: concurrent writes одного ключа в разных DC. Разрешение:

### Last-Write-Wins (LWW)

Каждая запись имеет wall-clock timestamp; «выигрывает» с наибольшим timestamp. Cassandra default.

- ✓ Просто, без app-логики
- ✗ Зависит от синхронизации часов (NTP) — clock skew → потеря concurrent writes
- ✗ «Молчаливая» потеря данных — ни одна сторона не знает что её write потерян

### Application-level resolution

При конфликте БД возвращает обе версии, приложение решает (merge, выбор последнего по бизнес-логике, показ пользователю «выберите версию»).

- ✓ Гибкость, нет потерь
- ✗ Сложность в коде каждого resolver'а
- Реализации: Riak siblings, CouchDB conflict docs, Dynamo concurrent versions

### CRDTs (Conflict-free Replicated Data Types)

Структуры данных с математически гарантированным merge без потерь. Подробнее в [system-design/theory/distributed/CRDT.md](../../system-design/theory/distributed/CRDT.md).

Базовые типы:
- **G-Counter** (Grow-only counter) — monotonic increment, merge = max per node
- **PN-Counter** — increment + decrement
- **G-Set** (Grow-only set) — merge = union
- **OR-Set** (Observed-Remove Set) — add + remove с tag, merge корректен
- **LWW-Register** — LWW по полю
- **CRDT-Map**, **RGA** (Replicated Growable Array), **Yjs/Automerge** — для collaborative editing

**Use cases:** real-time collab (Figma, Google Docs через Y.js / Automerge), shopping carts (Riak), offline-first apps.

### Topology

- **Star/Hub-and-spoke** — central node (плохо: SPOF)
- **Ring** — каждый знает следующего (lag растёт с расстоянием)
- **All-to-all (mesh)** — каждый с каждым (N² connections, но самая robustness)

---

## Leaderless replication (Dynamo-style)

Любой узел принимает writes; клиент или координатор шлёт N реплик, ждёт W подтверждений. Чтение — с R реплик, выбирает свежайшую версию.

```
Client write → Coordinator → N nodes (parallel)
                          ← W acks (synchronous)

Client read → Coordinator → R nodes
                         ← R responses → pick latest (by timestamp or version vector)
```

**Quorum:** R + W > N → strong consistency (read и write пересекаются хотя бы в одной replica).

**Реализации:** Cassandra, Riak, Voldemort, DynamoDB.

**Механизмы согласования:**

### Read repair

При чтении, если разные replicas вернули разные версии, координатор пишет свежайшую обратно на отставшие. Подходит для популярных ключей (которые читаются).

### Hinted handoff

Если replica недоступна при write, координатор сохраняет hint у соседа. Когда replica оживает — hint передаётся ей. Async компенсация недоступности.

### Anti-entropy / Merkle trees

Периодический фоновый процесс сравнивает данные между replicas: каждая строит Merkle tree (hash от подмножеств), сравнивает корни, спускается по веткам разногласия, синхронизирует расхождения. Cassandra `nodetool repair`.

Подробнее: [system-design/theory/algorithms/MERKLE_TREE.md](../../system-design/theory/algorithms/MERKLE_TREE.md).

### Sloppy quorum

Если из N replicas доступны меньше W, координатор шлёт на «соседей» (не настоящих owners), пометив hint. Жертвует строгим quorum'ом ради availability.

- ✓ Запись принимается при partial outage
- ✗ Strong consistency не гарантирована — sloppy узел не входит в R при чтении

---

## Failover

Что происходит при падении leader.

### Manual failover

DBA вручную:
1. Убеждается, что старый leader **точно** мёртв (split-brain risk)
2. Выбирает кандидата с минимальным lag
3. Promotes (например, `pg_promote()`)
4. Переключает приложения / load balancer
5. Реинтегрирует старый leader как replica

✓ Контроль, нет ложных срабатываний
✗ MTTR — минуты-часы

### Automatic failover

Внешний агент (Orchestrator, Patroni, Sentinel, replica set primary election) детектирует и переключает автоматически.

**Шаги:**
1. **Detection** — health check, heartbeat timeout (5-30 секунд)
2. **Election** — выбрать кандидата (с min lag, или через Raft)
3. **Fencing** — гарантировать, что старый leader не примет writes (STONITH — Shoot The Other Node In The Head; или VIP отзыв; или fencing token)
4. **Promotion**
5. **Reconfig** — клиенты узнают нового leader (через DNS, service discovery, или driver-side)

✓ MTTR — секунды
✗ Risk: false positive (сетевой glitch → ненужный failover), split-brain если fencing не сработал

**Реализации:**
- **PostgreSQL**: Patroni (Raft + etcd/Consul), repmgr, pg_auto_failover
- **MySQL**: Orchestrator (Vitess), MHA (deprecated), Group Replication
- **MongoDB**: built-in (replica set election через Raft в 4.x+)
- **Redis**: Sentinel (для primary-replica), Redis Cluster (для sharded)

### Split-brain

**Сценарий:** network partition между leader и replicas. Replicas думают leader мёртв → выбирают нового. Старый leader всё ещё принимает writes от клиентов своей стороны partition. → две независимые истории.

**Prevention:**
- **Quorum-based election** (Raft, ZAB) — для promotion нужна majority узлов; меньшая partition не сможет выбрать leader
- **Fencing** — fencing token (monotonic), stale leader не сможет коммитить writes без actual token
- **STONITH** — физическое выключение старого leader (через iLO/IPMI/cloud API)
- **Witness / arbiter** — нечётное число узлов (3 / 5) для решающего голоса

**GitHub 2018 incident:** 43-секундная сетевая partition между East/West coast → split-brain MySQL → 24 часа на reconciliation, ~4% данных за окно требовали ручной обработки.

---

## CDC (Change Data Capture)

**Цель:** превратить БД в источник событий для downstream систем (cache invalidation, search index, data lake, microservice integration), не привязываясь к dual-write проблеме.

### Polling-based CDC

Приложение читает таблицу с `updated_at > last_poll`. Простой, но:
- ✗ Лаг — интервал polling
- ✗ Пропускает удаления (DELETE row → нет updated_at)
- ✗ Concurrent writes между чтением — eventual consistency

### Log-based CDC

Читает internal replication log БД (WAL/binlog), парсит, публикует.

**Debezium** — самый популярный: connectors для PostgreSQL (logical decoding через `pgoutput`/`wal2json`), MySQL (binlog), MongoDB (oplog), SQL Server, Oracle. Публикует в Kafka.

```
PostgreSQL → WAL → Debezium PG connector → Kafka topic per table
                                              ↓
              [Elasticsearch] [Redis cache] [Snowflake DWH] [microservice]
```

**Гарантии:** at-least-once delivery, ordering per row (если используется правильный partition key — обычно PK).

**Use cases:**
- **Outbox without table** — вместо отдельной outbox-таблицы и worker'а, Debezium читает изменения основных таблиц напрямую
- **Cache invalidation** — при UPDATE → событие → инвалидация Redis-ключа
- **Search index sync** — синхронизация Elasticsearch с PostgreSQL
- **Materialized views** в другой БД (event-driven projection)
- **Data lake ingestion** — append-only stream в S3/HDFS как parquet
- **Microservice integration** — без direct database access

**Ограничения:**
- Schema changes (ALTER TABLE) — нужны connector restart, иногда manual recovery
- Initial snapshot — может занять часы для большой таблицы
- DB load — logical replication на PG имеет overhead (write amp + WAL retention)
- Eventual consistency между PG и downstream

### Trigger-based CDC

DB-trigger на INSERT/UPDATE/DELETE пишет в audit-таблицу, worker читает.

- ✓ Работает на любой БД (даже без replication log API)
- ✗ Trigger overhead, замедление writes
- ✗ Lost при truncate / direct heap manipulation

---

## Logical vs Physical replication

### Physical (binary)

Транслирует физические изменения страниц (PostgreSQL WAL byte-for-byte, MySQL binlog в row format).

- ✓ Полная точность, включая системные изменения (VACUUM, autovacuum)
- ✗ Replica должна быть точной копией структуры (тот же major version, та же arch)
- ✗ Нельзя реплицировать подмножество (отдельные таблицы)
- Используется для: HA standby, point-in-time recovery

### Logical (statement-level / row-level)

Транслирует логические операции (INSERT/UPDATE/DELETE с values).

- ✓ Кросс-версия (можно реплицировать с PG 14 на PG 16 для upgrade)
- ✓ Подмножество (отдельные таблицы, columns)
- ✓ Можно трансформировать по пути
- ✗ Не реплицирует DDL (нужны hooks), системные данные
- Используется для: zero-downtime upgrade, sharding migration, CDC

PostgreSQL: `pg_create_logical_replication_slot()`, publications + subscriptions (PG 10+).
MySQL: binlog в `ROW` format — обычно используется как «logical».

---

## Практическая стратегия

| Сценарий | Топология |
|----------|-----------|
| OLTP standalone | Single-leader + 1-2 async replicas |
| OLTP финтех | Single-leader + 1 sync replica (same DC) + 1 async (DR DC) |
| Read-heavy web app | Single-leader + N async replicas + LB с health check |
| Multi-region active-active | Multi-leader или Spanner-like (Cockroach/Yugabyte) |
| Edge / IoT / mobile | Multi-leader / leaderless, CRDT для merge |
| Analytics / DWH | One-way logical replication + columnar store (ClickHouse) |
| Migration / upgrade | Logical replication + dual-write → cutover |
| Cache / search sync | CDC (Debezium) → Kafka → consumers |

---

## Источники

**Books:**
- *Designing Data-Intensive Applications* (Martin Kleppmann, 2017) — Ch. 5 (Replication) — главный источник.
- *Database Internals* (Alex Petrov, 2019) — Part II (Distributed Systems): replication, consensus, anti-entropy.

**Papers:**
- [DeCandia et al. (2007) — «Dynamo: Amazon's Highly Available Key-value Store» (SOSP)](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — оригинал leaderless с quorum + hinted handoff.
- [Corbett et al. (2012) — «Spanner: Google's Globally-Distributed Database» (OSDI)](https://research.google/pubs/pub39966/) — multi-region strong consistency через TrueTime.

**Engineering docs / postmortems:**
- [PostgreSQL — Streaming Replication](https://www.postgresql.org/docs/16/warm-standby.html) + [Logical Replication](https://www.postgresql.org/docs/16/logical-replication.html)
- [MySQL Replication Documentation](https://dev.mysql.com/doc/refman/8.0/en/replication.html)
- [MongoDB Replica Sets](https://www.mongodb.com/docs/manual/replication/)
- [Cassandra — Consistency Levels and Read Repair](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html)
- [Debezium Documentation](https://debezium.io/documentation/)
- [GitHub blog — «October 21 post-incident analysis» (2018)](https://github.blog/2018-10-30-oct21-post-incident-analysis/) — split-brain MySQL после network partition.

**Jepsen analyses** — реальные гарантии БД под partition: [PostgreSQL](https://jepsen.io/analyses/postgresql-12.3), [Cassandra](https://aphyr.com/posts/294-jepsen-cassandra), [MongoDB](https://jepsen.io/analyses/mongodb-4.2.6).
