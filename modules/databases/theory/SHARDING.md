# Sharding (Horizontal Partitioning)

Шардирование — разделение данных по нескольким узлам по значению некоторого ключа. В отличие от **репликации** (копии того же набора), шардирование делит набор: shard1 хранит часть, shard2 — другую часть, без пересечения.

> **Scope**: стратегии шардирования, consistent hashing, rendezvous hashing, resharding, hot-key mitigations. Cache-side consistent hashing — см. [caching-deep-dive/DISTRIBUTED_CACHING.md](../../caching-deep-dive/theory/DISTRIBUTED_CACHING.md). CAP/quorum теория — [system-design/distributed_systems.md](../../system-design/theory/distributed_systems.md).

---

## Когда шардирование нужно

Шардирование решает три проблемы, которые **не решает** репликация:

1. **Размер хранилища** — single node не вмещает датасет (десятки TB / петабайты)
2. **Пропускная способность записи** — single leader не справляется (>50k writes/sec)
3. **Рабочий набор в памяти** — индексы и hot data не влезают в RAM одного узла

Если ни одна из проблем не наблюдается — **не шардируйте**. Шардинг добавляет сложность (cross-shard transactions, secondary indexes, joins), которая часто превышает выгоду.

> **Rule of thumb:** vertical scaling до 4-8 TB / 32-64 cores → 1 read-replica → 2-3 read-replicas → шардинг. Большинство приложений никогда не выходит за этот лимит.

---

## Стратегии шардирования

### Диапазонное шардирование (Range sharding)

Ключи делятся по диапазонам.

```
shard0: user_id 0     - 999999
shard1: user_id 1M    - 1.99M
shard2: user_id 2M    - 2.99M
```

- ✓ **Range queries** работают тривиально (`WHERE user_id BETWEEN 500k AND 1.5M` → 2 shards)
- ✓ Ordered traversal (timeline, pagination)
- ✗ **Hot spots** при неравномерных ключах: timestamp-based ключ → все INSERT в последний shard
- ✗ Manual rebalance — диапазоны меняются при росте

**Реализации:** HBase, BigTable, MongoDB (с range shard key), CockroachDB.

**Workaround для timestamp hot spot:** добавить prefix randomness (`{random_byte}:{timestamp}` → распределяется по shards).

### Хэш-шардирование (Hash sharding)

Ключ хэшируется, по результату определяется shard.

```
shard = hash(user_id) % N_shards
```

- ✓ **Uniform distribution** — статистически равномерное распределение
- ✗ **Range queries** = scatter-gather (читать все shards и мержить)
- ✗ Resharding (`% N`) перераспределяет **все** ключи — катастрофично

**Реализации:** Cassandra (с RandomPartitioner / Murmur3Partitioner), Redis Cluster (через CRC16 % 16384 slots), MongoDB (с hashed shard key).

**Resharding fix:** consistent hashing вместо `% N` (см. ниже).

### Справочное шардирование (Directory / Lookup sharding)

Отдельный сервис хранит mapping `key → shard_id`.

```
Lookup service: { user:123 → shard5, user:456 → shard2, ... }
```

- ✓ **Максимальная гибкость** — можно вручную перенести hot user на отдельный shard
- ✓ Online migration — обновил mapping, никто не заметил
- ✗ Lookup service = SPOF (нужно реплицировать)
- ✗ Дополнительная задержка (1 lookup перед каждым query)
- ✗ Сложность

**Реализации:** Vitess (для MySQL), Couchbase vBuckets (с master coordinator), Foursquare (раньше).

### Географическое шардирование (Geographic sharding)

Ключи делятся по географии — пользователь EU в EU-shard, US в US-shard.

- ✓ **Data residency** (GDPR — данные EU не покидают EU)
- ✓ Низкая задержка для локальных чтений
- ✗ Cross-region queries (пользователь путешествует) — сложно
- ✗ Несбалансированные регионы

**Реализации:** Spanner zones, CockroachDB regions, custom через directory.

### Составное шардирование (Composite sharding)

Иерархическое: `region → tenant → user`. Используется в multi-tenant SaaS.

---

## Consistent Hashing (согласованное хэширование)

**Проблема naive hash sharding:** `shard = hash(key) % N`. При изменении N (добавление/удаление узла) — пересчёт всех ключей. Если N был 4, стал 5, ключ с `hash(k) = 7` уходил на shard 3, теперь — на shard 2. Перетасовка **K × (N-1) / N** ключей → весь датасет фактически нужно мигрировать.

**Идея consistent hashing (Karger 1997):** ключи и узлы — точки на **кольце хэшей** (например, `[0, 2³²)`). Ключ принадлежит первому узлу по часовой стрелке.

```
        node_a (hash = 100)
       ↗
key1 (hash = 90) → node_a (next on ring)
key2 (hash = 250) → node_b (hash = 200)
key3 (hash = 800) → node_c (hash = 500)
```

При добавлении узла перераспределяется только **K/N** ключей — те, что попадают в новый сегмент кольца. Остальные остаются на месте.

```
Was:    node_a─────────────node_b─────────────node_c (ring)
Add:    node_a────[NEW]────node_b─────────────node_c
                   ↑
                   Только ключи между node_a и NEW перетекают на NEW
```

**Проблема:** случайные хэши узлов → неравномерное распределение по кольцу. Один узел может занимать 50% кольца, другой — 5%.

**Решение — Virtual Nodes (vnodes):** каждый физический узел представлен N точками (100-500) на кольце. Распределение усредняется → +/- 5% от равномерного.

```
node_a: 100 vnodes по всему кольцу
node_b: 100 vnodes
node_c: 100 vnodes
```

Дополнительные бонусы vnodes:
- **Неоднородные узлы** — мощный узел получает больше vnodes, слабый — меньше → пропорциональная нагрузка
- **Failure recovery** — при падении узла его vnodes распределяются по **всем** остальным, не одному → нет перегрузки соседа
- **Добавление узла** — новый узел забирает кусочки у **всех** существующих равномерно

**Реализации:**
- **DynamoDB** — оригинальная статья (vnodes + replication)
- **Cassandra** — `num_tokens` (default 256)
- **Riak** — `ring_creation_size` (default 64 partitions, distributed across nodes)
- **Memcached client-side** — Ketama hash (vnodes ~ 160 на сервер)
- **Redis** — НЕ использует consistent hashing, использует hash slot (16384 slots статически assigned to nodes)

**Memcached с consistent hashing — самый чистый пример** (Ketama, libketama-compatible clients).

---

## Rendezvous Hashing (HRW — хэширование по наибольшему весу)

Альтернатива consistent hashing, проще в реализации. Для каждого ключа:

```python
def shard_for(key, nodes):
    return max(nodes, key=lambda n: hash(n + key))
```

Каждая пара `(node, key)` имеет свой weight (`hash(node + key)`); ключ принадлежит узлу с наибольшим weight.

- ✓ **Простота** — нет кольца, нет vnodes
- ✓ Resilient — при удалении узла его ключи распределяются по **всем** остальным (для каждого выбирается новый max)
- ✓ Взвешенные узлы — добавить weight в формулу
- ✗ Lookup O(N) — нужно вычислить hash для **каждого** узла (не пройти по структуре)
- ✗ N ключей × N узлов = O(N²) на сравнение для большого N (но обычно N узлов ≤ 1000)

**Use cases:** CDN routing (узел кэширования для URL), HDFS replica placement, modern distributed caches.

**Когда выбрать HRW vs consistent hashing:** HRW — меньше код, тривиальная балансировка веса. CH — лучше для очень больших N и lookup-heavy workload (можно построить дерево по кольцу).

---

## Горячий ключ / Celebrity user problem

**Сценарий:** один shard получает непропорционально много трафика. Twitter — Justin Bieber tweets; видео — viral on TikTok; e-commerce — flash sale на один товар.

**Detection:**
- Per-key QPS monitoring (top-K через Count-Min Sketch)
- Skewness metrics — отношение p99 к p50 нагрузки на shards
- Heat maps shard utilization

**Mitigations (по порядку усложнения):**

### 1. Request coalescing / single-flight

Если 1000 одновременных запросов на одного и того же hot user — собирать в один backend запрос (см. [caching-deep-dive/ANTI_PATTERNS.md → cache stampede](../../caching-deep-dive/theory/ANTI_PATTERNS.md#cache-stampede)).

```kotlin
// pseudo-Kotlin
val cache = ConcurrentHashMap<UserId, CompletableFuture<User>>()
fun loadUser(id: UserId): User {
    return cache.computeIfAbsent(id) { fetchFromDb(id).whenComplete { _, _ -> cache.remove(id) } }.get()
}
```

### 2. Агрессивное кэширование горячих ключей

Реплицированный near-cache во всех app-инстансах. Trade-off: stale data, но если запрос только на read — приемлемо.

### 3. Sticky sharding (реплики для чтения с горячего шарда)

Hot shard имеет больше read replicas; load balancer направляет на любую. Помогает только для read-heavy hot key.

### 4. Разбиение ключа (Key splitting)

Hot key разбивается на N виртуальных ключей.

```
user:bieber:tweets  →  user:bieber:tweets:0
                       user:bieber:tweets:1
                       ...
                       user:bieber:tweets:9
```

- Write: пишущий выбирает random sub-key
- Read: читающий запрашивает **все** sub-keys и объединяет
- Эффективно для timeline / counter / log — то, что и так fan-out на read.

### 5. Асимметричная репликация

Hot key реплицируется на больше узлов. Применяется при leaderless (Cassandra) или с custom logic.

### 6. Статическое партиционирование горячего пути

Hot tenants выделяются на dedicated shards (через directory sharding) — изолированы от общего пула.

---

## Решардинг (Resharding)

Самая сложная операция в шардированной системе. Сценарии:

- Splitting hot shard (один shard перегружен)
- Adding new shards (datasize рос)
- Decommissioning (cost reduction)
- Schema migration с изменением shard key

### Naive resharding — почему ломается

`% N` → `% (N+1)` пересчитывает ~99% ключей. Нужно остановить writes, мигрировать всё, переключить.

→ В проде недопустимо. Применимо только в greenfield / dev.

### Паттерны онлайн-решардинга

#### 1. Dual-write

Приложение пишет в **оба** старых и новых shards:

```
1. Backfill: скопировать существующие данные old → new (snapshot)
2. Dual-write mode: writes идут в old AND new (latency × 2, но consistent)
3. Verification: validate new shard matches old
4. Switch reads: traffic переключается на new
5. Stop writes to old
6. Cleanup old shard
```

- ✓ Понятная семантика
- ✗ Code complexity на app side (нужно знать про оба)
- ✗ Задержка × 2 на write
- ✗ Обработка частичных сбоев сложна (написалось в old, не в new → divergence)

#### 2. CDC-based resharding

Используем CDC (Debezium → Kafka) для миграции:

```
1. Take snapshot of old shard data
2. Apply snapshot to new shard
3. Start CDC stream from old shard, replay all changes since snapshot
4. When CDC lag → 0, freeze writes on old (briefly)
5. Drain CDC stream до конца
6. Switch traffic to new shard
7. Unfreeze
```

- ✓ App code не меняется (если есть transparent routing)
- ✓ Минимальное время простоя (секунды на cutover)
- ✗ Требует CDC infra
- ✗ Schema changes между old и new — отдельная задача

#### 3. Vitess-style middleware

Vitess (Google → CNCF) — middleware для MySQL sharding. Координирует resharding автоматически:

- VSchema описывает sharding
- Workflows: SplitClone (backfill) → SplitDiff (verify) → MigrateServedTypes (switch)
- App видит unified API, не знает про физические shards

Аналоги: **CockroachDB** (auto-rebalance ranges), **YugabyteDB**, **TiDB** (через Placement Driver), **MongoDB sharded cluster** (через `moveChunk`).

#### 4. Append-only resharding

Новые данные идут в новые shards, старые остаются. Приложение знает про routing rule.

```
До:   user_id 0-1M       → shard0
После: user_id 0-1M       → shard0 (старые)
       user_id 1M-2M      → shard1 (новые)
       user_id 2M-...     → shard2 (новые)
```

- ✓ Минимальная миграция
- ✗ Routing logic усложняется со временем
- ✗ Hot shard остаётся hot (старые пользователи всё ещё там)

---

## Вторичные индексы на шардированных данных

Что делать с `WHERE email = 'x@y.com'`, если shard key — `user_id`?

### Локальные вторичные индексы

Каждый shard ведёт **свой** локальный индекс по `email`. Query без shard key → **scatter-gather**: запрос отправляется на все shards, результаты сливаются.

- ✓ Просто, нет cross-shard coordination
- ✗ Задержка = max(per-shard latency) — медленный shard тормозит весь запрос
- ✗ Scaling — добавление shards = больше fan-out
- Реализации: Cassandra secondary index, MongoDB local index

### Глобальные вторичные индексы

Отдельный «индекс-shard» (по `email`) хранит mapping `email → user_id`. Query: shard lookup на email-index → найти user_id → shard lookup на user-shard.

- ✓ Targeted lookup, нет scatter-gather
- ✗ Cross-shard write (нужно атомарно обновить и user-shard, и email-index) — нужны distributed transactions или eventual consistency
- ✗ Дополнительная инфраструктура
- Реализации: DynamoDB Global Secondary Index, Spanner secondary index, Cassandra Materialized Views (deprecated из-за consistency проблем)

### Через поисковый движок

Sync через CDC → Elasticsearch. Search идёт в ES, fetch full row — в primary БД.

- ✓ Search-specific optimizations (full-text, faceting, ranking)
- ✗ Eventual consistency между primary и ES
- ✗ Two systems to operate

---

## Межшардовые запросы (Cross-shard queries)

Joins, transactions, aggregations через shards — все «дорогие».

**Подходы:**

1. **Avoid** — denormalize, дублировать данные внутри shard. Cassandra-way.
2. **Application-level join** — query каждого shard, merge в коде. Подходит для маленьких N.
3. **Pre-computed aggregates** — denormalized сводки, обновляемые через CDC.
4. **Distributed transactions** (2PC, Saga) — для writes; redacent. См. [system-design/microservice_patterns.md](../../system-design/theory/microservice_patterns.md).
5. **Distributed SQL** (Spanner, Cockroach, Yugabyte) — DBMS делает scatter-gather прозрачно.

**Антипаттерн:** наивное `SELECT ... JOIN` через shards в шардированной системе. Задержка = max per-shard + стоимость слияния.

---

## Шардирование на практике

### Twitter timeline (упрощённо)

- Shard key = `user_id`
- Hash sharding → user's tweets живут в одном shard
- Timeline (fan-out on write): при tweet, push в timeline каждого follower (cross-shard write)
- Hot user (celebrity) — fan-out on read: timeline computed at read time для followers of celebrities
- Подробнее: [system-design/design_problems/02_news_feed.md](../../system-design/design_problems/02_news_feed.md)

### Cassandra ring

- 16384 vnodes (default 256 per node × 64 nodes)
- Murmur3 hash, consistent hashing
- Replication factor 3 → каждый ключ на 3 соседних vnodes по кольцу
- Tunable consistency: QUORUM read+write (R+W>N)

### Redis Cluster

- 16384 hash slots статически распределены по узлам
- Client computes `slot = CRC16(key) mod 16384`
- При resharding — slots мигрируют между узлами online (`CLUSTER SETSLOT`)
- Hash tags `{user:1}:tweets` → slot вычисляется только по части в `{}` → группировка ключей в один slot

### DynamoDB

- Hash partitioning (no virtual nodes — adaptive partitioning)
- Hot partition detection — auto split (но adaptive capacity reactive, не proactive)
- Global Secondary Indexes
- 10 GB max per partition (раньше) → auto-split

---

## Источники

**Books:**
- *Designing Data-Intensive Applications* (Martin Kleppmann, 2017) — Ch. 6 (Partitioning).
- *Database Internals* (Alex Petrov, 2019) — Part II.

**Papers:**
- [Karger et al. (1997) — «Consistent Hashing and Random Trees: Distributed Caching Protocols for Relieving Hot Spots on the World Wide Web» (STOC)](https://www.akamai.com/site/en/documents/research-paper/consistent-hashing-and-random-trees-distributed-caching-protocols-for-relieving-hot-spots-on-the-world-wide-web-technical-publication.pdf) — оригинал consistent hashing.
- [Thaler, Ravishankar (1998) — «Using Name-Based Mappings to Increase Hit Rates» (IEEE TON)](https://www.cs.umass.edu/~ramesh/Site/PUBLICATIONS_files/TR-97-018.pdf) — rendezvous hashing.
- [DeCandia et al. (2007) — «Dynamo» (SOSP)](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — vnodes, sharding + replication.
- [Lamport (2019) — «Time, Clocks, and the Ordering of Events in a Distributed System»](https://lamport.azurewebsites.net/pubs/time-clocks.pdf) — для cross-shard ordering.

**Engineering blogs:**
- [Discord — «How Discord Stores Billions of Messages» (2017)](https://discord.com/blog/how-discord-stores-billions-of-messages) — миграция MongoDB → Cassandra, выбор shard key.
- [Discord — «How Discord Stores Trillions of Messages» (2023)](https://discord.com/blog/how-discord-stores-trillions-of-messages) — Cassandra → ScyllaDB.
- [Slack — «Real-time Messaging at Scale» (2020)](https://slack.engineering/real-time-messaging/) — sharding пользователей и каналов.
- [Pinterest — «Sharding Pinterest: How we scaled our MySQL fleet»](https://medium.com/pinterest-engineering/sharding-pinterest-how-we-scaled-our-mysql-fleet-3f341e96ca6f)
- [Vitess Architecture](https://vitess.io/docs/architecture/) — sharding middleware для MySQL.
- [CockroachDB — Cluster Topology Patterns](https://www.cockroachlabs.com/docs/stable/topology-patterns.html)

**Documentation:**
- [Cassandra — Data Distribution and Replication](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html)
- [Redis Cluster Specification](https://redis.io/docs/management/scaling/)
- [MongoDB Sharding](https://www.mongodb.com/docs/manual/sharding/)
