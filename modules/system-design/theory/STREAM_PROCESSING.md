# Stream Processing

Обработка непрерывных потоков данных в реальном времени: MapReduce → Spark → Flink → Kafka Streams. Архитектурные паттерны: Lambda vs Kappa, stream-table duality, event-time vs processing-time.

> **Scope**: концепции stream processing. Kafka как broker — [`kafka.md`](kafka.md). CDC и replication — [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md).

---

## MapReduce (концептуальная основа)

Google 2004 — paradigm shift для batch processing.

```
INPUT  → MAP (k1, v1) → list((k2, v2))
                              ↓ shuffle (group by k2)
       → REDUCE (k2, list(v2)) → list((k3, v3)) → OUTPUT
```

**Пример word count:**
```
MAP("hello world hello") → [(hello,1), (world,1), (hello,1)]
SHUFFLE → (hello, [1,1]), (world, [1])
REDUCE → (hello, 2), (world, 1)
```

**Hadoop** — open source MapReduce + HDFS. Batch (часы-дни). Сейчас legacy — Spark / Flink заменили.

---

## Spark

Apache Spark (UC Berkeley, 2010) — генерализация MapReduce + in-memory + lazy DAG.

### RDD (Resilient Distributed Dataset)

Иммутабельная partitioned коллекция. Computations через transformations + actions.

```python
rdd = sc.textFile("s3://logs/2024/*.log")
errors = rdd.filter(lambda line: "ERROR" in line)  # lazy transformation
count = errors.count()                              # action — triggers execution
```

### DataFrame / Dataset

Высокоуровневые API с schema. Catalyst optimizer → лучше plan execution.

```python
df = spark.read.parquet("s3://events/")
result = df.filter(df.severity == "ERROR").groupBy("service").count()
```

### Shuffle

Группировка/join требует shuffle — пересылка данных между nodes по hash(key). Самая дорогая операция в Spark. Минимизируй: broadcast joins, pre-partitioning.

### Spark Streaming → Structured Streaming

- **Spark Streaming** (legacy) — micro-batch (1-30 sec). DStream API.
- **Structured Streaming** (рекомендация) — same DataFrame API + continuous processing.

### Use cases

- ETL pipelines (S3 → transformations → data warehouse)
- ML pipelines (Spark MLlib)
- Batch + near-real-time analytics
- **Pinterest, Netflix, Uber** — major Spark users

---

## Flink

Apache Flink — **true streaming** (per-event, не micro-batch). Лучше для low-latency и exactly-once.

### Key features

- **Event time vs processing time** — обработка по времени **события**, не по времени прихода (для late events / out-of-order)
- **Watermarks** — heuristic «больше нет событий старше X»
- **State** — keyed state per key (counter, list, map)
- **Exactly-once** — через checkpointing + 2PC с sinks

### Watermarks

```
events arrive with timestamps:
  t=1, t=3, t=2 (out of order), t=5, t=4 (late)

watermark = "all events before T are seen":
  after t=5 watermark moves to T=3 (allow 2 sec lateness)
  → window [0, 3] closes, emits result
  
  t=4 arrives:
    if allowed_lateness configured: late event accepted, output updated
    else: dropped
```

### Use cases

- **Uber** — real-time pricing
- **Netflix** — Mantis (Flink-based) for operational monitoring
- **Alibaba** — Single's Day analytics
- **Lyft** — real-time matching

---

## Kafka Streams

Library (не отдельный cluster) на Kafka. Java/Kotlin app + Streams DSL.

```kotlin
val builder = StreamsBuilder()
builder.stream<String, String>("orders")
    .filter { _, v -> v.contains("paid") }
    .groupBy { _, v -> extractCustomer(v) }
    .count()
    .toStream()
    .to("customer-paid-count")
```

### State stores

Embedded RocksDB per task. State persistent через **changelog topic** (replicate to Kafka).

### Преимущества

- ✓ Простота — нет отдельного cluster
- ✓ Tightly integrated с Kafka (exactly-once via transactional producer)
- ✓ Stateful processing
- ✗ Только Kafka как source/sink
- ✗ Менее богатый, чем Flink

### Сравнение

| | Spark | Flink | Kafka Streams |
|---|---|---|---|
| Model | Micro-batch (Structured Streaming) / Batch (default) | True streaming | True streaming |
| Latency | Seconds | Milliseconds | Milliseconds |
| Cluster | Spark cluster (Mesos/YARN/K8s) | Flink cluster | App library (no extra) |
| Source/Sink | Any (S3, JDBC, Kafka, ...) | Any | Kafka only |
| State | Spark backend | Flink state backends (RocksDB) | RocksDB + Kafka changelog |
| Exactly-once | Structured Streaming yes | Native | Native |
| Window time | Both | Both | Both |

---

## Stream vs Batch

| | Batch | Stream |
|---|---|---|
| Latency | Hours | Seconds-ms |
| Data | Finite, bounded | Infinite, unbounded |
| Re-runs | Easy | Hard (state, time) |
| Use case | DWH ETL, reports | Real-time alerts, dashboards |
| Tools | Spark, Hadoop, dbt | Flink, Kafka Streams, Storm |

### Когда batch достаточен

- Reports, аналитика «вчера/прошлая неделя»
- Heavy joins на огромных datasets
- ML training (не serving)

### Когда нужен stream

- Fraud detection (per-transaction)
- Real-time bidding (ads)
- Live dashboards
- IoT events
- Alerting

---

## Lambda Architecture

Combine batch + stream для accuracy + speed.

```
Source (Kafka)
   ├──→ Speed layer (stream, approximate) → Serving (recent)
   └──→ Batch layer (Spark, accurate)   → Serving (historical)
   
Query: union speed + batch
```

- ✓ Best of both: recent low-latency + accurate historical
- ✗ **Duplicate code** (batch + streaming versions same logic)
- ✗ Сложность maintenance

Использовалась в Twitter, Netflix (раньше). Сейчас часто заменяют на Kappa.

---

## Kappa Architecture

Только stream. Stream может re-process от начала Kafka log.

```
Source (Kafka, infinite retention)
   ↓
Stream processing (Flink)
   ↓
Serving
   
Reprocessing: rerun streaming job from offset 0
```

- ✓ Single codebase
- ✓ Simpler
- ✗ Re-process от offset 0 при логике bug fix — может занять часы

Jay Kreps (Confluent CEO) proposed Kappa 2014.

---

## Stream-Table Duality

Foundational insight: **stream ↔ table** взаимно конвертируемы.

```
Stream of events → накопить → Table (state)
Table → log of changes → Stream (CDC)
```

Implications:
- Materialized views = aggregation поверх stream
- Database = compacted log
- CDC (Debezium) превращает DB writes в stream events

Подробно: Jay Kreps' «The Log» article (must-read).

---

## Window операций

В streaming агрегации происходят над **окнами времени**.

### Tumbling windows

Фиксированные, не перекрывающиеся.

```
[0-60s] [60-120s] [120-180s] ...
```

Use: per-minute counts.

### Hopping (Sliding) windows

Перекрывающиеся, фиксированный размер + step.

```
[0-60s], [10-70s], [20-80s], ... (size=60, hop=10)
```

Use: 1-minute rolling average updated every 10s.

### Session windows

Динамические — group events близких по времени (gap < threshold).

```
events: 0, 5, 10, ... (gap=30s) ..., 45, 50, 55, ...
sessions: [0,5,10], [45,50,55]
```

Use: user session analysis.

### Global window

Все события в одном окне (требует custom trigger).

---

## State management

Stream processing — stateful. State per key:

- **Counter** — count events per user
- **List** — recent events per user
- **Map** — feature store

State storage:
- **Embedded RocksDB** — Flink, Kafka Streams. Local SSD, replication через Kafka changelog
- **External store** — Redis, Cassandra (slower, но shared)

**Checkpoints** — periodic snapshot всего state, для recovery после crash. Flink checkpoints async через Chandy-Lamport algorithm.

---

## Exactly-once в streaming

Сложнее, чем в batch. Требует:
1. Idempotent reads from source (offsets tracked)
2. Idempotent writes to sink (transactional или idempotent operations)
3. Atomic checkpoint between
4. На рестарте — resume from last checkpoint, replay tail

**Kafka Streams + Kafka sink**: native exactly-once через transactional producer.

**Flink + external sink** (Postgres, ElasticSearch): требует 2-phase commit sink или idempotent (UPSERT с key) writes.

---

## Источники

- [Dean, Ghemawat (2004) — «MapReduce: Simplified Data Processing on Large Clusters»](https://research.google/pubs/pub62/)
- [Zaharia et al. (2012) — «Resilient Distributed Datasets» (Spark RDD paper)](https://www.usenix.org/system/files/conference/nsdi12/nsdi12-final138.pdf)
- [Carbone et al. (2017) — «State Management in Apache Flink»](https://www.vldb.org/pvldb/vol10/p1718-carbone.pdf)
- [Jay Kreps — «The Log: What every software engineer should know about real-time data's unifying abstraction»](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)
- [Jay Kreps — «Questioning the Lambda Architecture» (Kappa proposal)](https://www.oreilly.com/radar/questioning-the-lambda-architecture/)
- *Streaming Systems* (Tyler Akidau, Slava Chernyak, Reuven Lax — O'Reilly 2018) — главная книга
- *Designing Data-Intensive Applications* (Kleppmann, 2017) — Ch. 11
- [Apache Flink Documentation](https://flink.apache.org/learn-flink/)
- [Kafka Streams Documentation](https://kafka.apache.org/documentation/streams/)
