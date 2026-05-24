# Design Problem: Distributed Key-Value Store (Dynamo-style)

Распределённый KV-store — DynamoDB, Cassandra, Riak. Главные компоненты: consistent hashing, репликация, кворумы, eventual consistency, anti-entropy.

---

## 1. Requirements

### Functional
- PUT key value
- GET key
- DELETE key
- Range-запросы? Обычно нет (чистый NoSQL KV).
- TTL?

### Non-functional
- **Масштаб** — добавляем узлы, capacity растёт
- **High availability** — переживает падение узлов (AP в CAP)
- **Низкая latency** — p99 reads < 10 мс
- **Eventually consistent** допустима
- **Durable** — переживает диск, сбой региона

---

## 2. Estimation

```
1B элементов, в среднем 1 КБ = 1 ТБ
Пик: 100K reads/sec, 10K writes/sec
RF = 3 → 3 ТБ суммарного реплицированного хранилища
~10–20 узлов по 200 ГБ
```

---

## 3. Архитектура

Dynamo-style: **нет лидера, все узлы peers**.

```
Client (smart-клиент со знанием топологии)
  ↓
Coordinator (любой узел) →
Реплики для ключа:
  Node A (replica 1)
  Node B (replica 2)
  Node C (replica 3)

Gossip protocol для membership-кластера
```

---

## 4. Consistent Hashing

```
Кольцо hash-значений [0, 2^64)
У каждого узла несколько **virtual nodes** (vnodes) — 100–200 на физический узел

PUT(key, value):
  partition_key = hash(key)
  replicas = следующие N узлов по часовой стрелке
  пишем во все N replicas
```

Детали — в [`SHARDING.md` (databases)](../../databases/theory/SHARDING.md#consistent-hashing).

Добавление / удаление узла перемещает только `1/N` ключей.

---

## 5. Репликация

**N replicas** на ключ — соседние узлы на кольце.

```
N = 3 типично
Replicas: следующие 3 уникальных физических узла после partition_key
```

### Sloppy quorum

Если replica недоступна — write принимается на «соседний» узел с hint. Когда replica оживает — handoff (hinted handoff).

```
Если primary replica down:
  Coordinator выбирает следующий доступный узел
  Метит write как hint: «это для оригинальной replica X»
  Когда X восстановится — получает все pending hinted writes
```

---

## 6. Quorum read / write (R + W > N)

```
N = 3, W = 2, R = 2 → strong consistency
  PUT ждёт ack от 2 из 3 replicas
  GET читает 2 из 3, берёт более свежую (по timestamp)
  Оба пересекаются хотя бы по 1 replica → чтение видит последний write

N = 3, W = 1, R = 1 → eventual consistency, низкая latency, высокая availability
  Каждая операция работает с одной replica
  Может вернуть stale-данные
```

Настраивается per operation — приложения сами выбирают strict (финансовое) vs lenient (cache-like).

---

## 7. Read repair

Когда GET возвращает противоречивые версии (у replicas разные значения):

```
GET key →
  replica A: value=X, timestamp=t1
  replica B: value=Y, timestamp=t2 > t1
  replica C: value=X, timestamp=t1

Coordinator возвращает Y (свежее).
**Read repair:** в фоне обновляет A и C на Y.
```

Обеспечивает eventual convergence без отдельной anti-entropy.

---

## 8. Anti-Entropy (Merkle trees)

Периодический фоновый sync между replicas. Эффективное обнаружение расхождений.

Подробнее — в [`MERKLE_TREE.md`](MERKLE_TREE.md) и [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md#anti-entropy--merkle-trees).

```
Каждая replica строит Merkle tree своих данных:
  Сравниваются корневые хэши.
  Различаются → рекурсивно спускаемся по дереву, находим различия.
  Sync'аем только их.
```

`nodetool repair` в Cassandra запускает именно это.

---

## 9. Conflict resolution

Конкурентные writes → конфликты. Подходы:

### Last-Write-Wins (LWW) — дефолт Cassandra

Timestamp на каждом write. Победил тот, у кого timestamp больше.

- ✓ Просто
- ✗ Расхождение часов → тихая потеря данных
- ✗ Concurrent-обновления теряются

### Vector Clocks (Riak, оригинальный Dynamo)

У каждой версии — vector clock. Конфликтующие версии возвращаются приложению — приложение само резолвит.

- ✓ Без потери данных
- ✗ Сложно для приложения
- См. [`distributed_systems.md`](distributed_systems.md#lamport-timestamps--vector-clocks)

### CRDT

См. [`CRDT.md`](CRDT.md). Математически гарантированный merge. Riak поддерживает CRDT-типы.

---

## 10. Gossip Protocol

Cluster membership без центрального координатора. См. [`GOSSIP_PROTOCOL.md`](GOSSIP_PROTOCOL.md).

```
Каждый узел периодически (раз в секунду):
  Выбирает случайного peer
  Обменивается состоянием кластера: кто жив, версия schema, кому принадлежат tokens
  Все узлы постепенно сходятся

Failure detection: phi accrual detector (подозрительность копится с пропущенными heartbeat'ами)
```

---

## 11. Data Model

### Pure KV

```
PUT key value [TTL]
GET key → value
DELETE key
```

### Wide-column (Cassandra, HBase)

Разрешает несколько колонок в строке, time-series-запросы:

```
PUT key column1 value1 [TS1]
PUT key column2 value2 [TS2]
GET key column1
GET key columns BETWEEN c1 AND c5
```

Полезно, когда у строк много timestamped значений (например, user_id → metric_name → time-series).

---

## 12. Storage engine

Большинство Dynamo-style используют **LSM-tree** для write-heavy нагрузок.

См. [`databases/STORAGE_ENGINES.md`](../../databases/theory/STORAGE_ENGINES.md#lsm-tree-storage-engines).

- Memtable + SSTable
- Стратегии compaction (LCS, STCS, TWCS)
- Bloom filter per SSTable

---

## 13. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| Узел упал | Replicas обслуживают; hinted handoff проигрывает на recovery |
| Сетевой раздел | Sloppy quorum продолжает работать, если R/W достижимы; конвергенция позже |
| Полный сбой DC | Реплики в другом DC обслуживают (multi-DC replication) |
| Постоянная потеря узла | Стримим данные на replacement-узел с других replicas |
| Конфликт при разделе | CRDT авторазрешает, или приложение читает несколько версий и выбирает |

---

## 14. Tunable Consistency

```
Cassandra Consistency Levels:
  ANY: write принят любым узлом (или hinted)
  ONE: ack от 1 replica
  QUORUM: majority (например, 2 из 3)
  ALL: все replicas

Паттерн:
  CL_READ + CL_WRITE > RF → strong consistency
  Меньший CL → выше availability, ниже latency, возможно stale-данные
```

---

## 15. Multi-DC

Async-репликация в удалённый DC. См. [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md#multi-leader-replication).

```
Локальный DC: RF=3, strong reads/writes
Удалённый DC: RF=3, async-реплика
Read locality: предпочитаем локальные реплики
Cross-DC reads (для consistency check): по требованию
```

---

## 16. Trade-offs

### Strong vs Eventual

- **Strong (R+W>N)** — медленнее, ниже availability при сбоях
- **Eventual** — быстрее, доступнее, может вернуть stale

Per operation в Cassandra: «сессионные чтения — strong, аналитика — weak».

### Latency vs durability

- Sync-репликация на N replicas — медленно, но надёжно
- Async — быстро, но возможна потеря на failover

### Wide-column vs pure KV

- Wide-column добавляет выразительность запросов
- Pure KV проще и быстрее

---

## 17. Real-world

- **Amazon DynamoDB** — managed, эволюция от оригинального Dynamo paper
- **Apache Cassandra** — open source Dynamo + LSM + wide-column
- **ScyllaDB** — совместима с Cassandra, переписана на C++, быстрее
- **Riak** (deprecated) — настоящий Dynamo c CRDT
- **etcd / Consul** — другой стиль (Raft, strong consistency)

---

## Источники

- [DeCandia et al. (2007) — «Dynamo: Amazon's Highly Available Key-value Store»](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — must-read
- *System Design Interview Vol. 1* (Alex Xu) — глава 6 «Design a Key-Value Store»
- *Designing Data-Intensive Applications* (Kleppmann) — главы 5, 6, 9
- [Cassandra Documentation — Architecture](https://cassandra.apache.org/doc/latest/cassandra/architecture/index.html)
- [Discord — Trillions of Messages with ScyllaDB](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- См. [`databases/`](../../databases/) — Replication, Sharding, Storage Engines
