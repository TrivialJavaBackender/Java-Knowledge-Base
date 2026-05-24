# Stream Processing

Обработка непрерывных потоков данных в реальном времени: MapReduce → Spark → Flink → Kafka Streams. Архитектурные паттерны: Lambda vs Kappa, stream-table duality, event-time vs processing-time.

> **Scope:** концепции stream processing. Kafka как broker — в [`kafka.md`](kafka.md). CDC и репликация — в [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md).

---

## MapReduce (концептуальная основа)

Google, 2004 — парадигмальный сдвиг для batch-обработки.

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

**Hadoop** — open source MapReduce + HDFS. Batch (часы–дни). Сейчас уже legacy — вытеснен Spark / Flink.

---

## Spark

Apache Spark (UC Berkeley, 2010) — обобщение MapReduce с in-memory-вычислениями и lazy DAG.

### RDD (Resilient Distributed Dataset)

Иммутабельная partitioned-коллекция. Вычисления через transformations + actions.

```python
rdd = sc.textFile("s3://logs/2024/*.log")
errors = rdd.filter(lambda line: "ERROR" in line)  # lazy transformation
count = errors.count()                              # action — запускает выполнение
```

### DataFrame / Dataset

Высокоуровневые API со схемой. Catalyst optimizer строит более эффективный execution plan.

```python
df = spark.read.parquet("s3://events/")
result = df.filter(df.severity == "ERROR").groupBy("service").count()
```

### Shuffle

Группировка / join требуют shuffle — пересылку данных между узлами по `hash(key)`. Самая дорогая операция в Spark. Минимизировать: broadcast joins, pre-partitioning.

### Spark Streaming → Structured Streaming

- **Spark Streaming** (legacy) — micro-batch (1–30 сек). API DStream.
- **Structured Streaming** (рекомендуется) — тот же DataFrame API + continuous processing.

### Use cases

- ETL-пайплайны (S3 → трансформации → DWH)
- ML-пайплайны (Spark MLlib)
- Batch и near-real-time аналитика
- **Pinterest, Netflix, Uber** — крупные пользователи Spark

---

## Flink

Apache Flink — **настоящий streaming** (per-event, не micro-batch). Лучше для low-latency и exactly-once.

### Ключевые особенности

- **Event time vs processing time** — обработка по времени **события**, не по времени прихода (для late events / out-of-order)
- **Watermarks** — эвристика «событий старше X больше не будет»
- **State** — keyed state на ключ (counter, list, map)
- **Exactly-once** — через checkpointing + 2PC с sinks

### Watermarks

```
События приходят с timestamps:
  t=1, t=3, t=2 (не по порядку), t=5, t=4 (опоздавшее)

Watermark = «все события старше T мы уже видели»:
  после t=5 watermark двигается до T=3 (допустимое опоздание 2 сек)
  → окно [0, 3] закрывается, эмитим результат

  приходит t=4:
    если настроен allowed_lateness — событие принимается, результат обновляется
    иначе — отбрасывается
```

### Use cases

- **Uber** — real-time pricing
- **Netflix** — Mantis (на Flink) для operational monitoring
- **Alibaba** — аналитика Singles' Day
- **Lyft** — real-time matching

---

## Kafka Streams

Библиотека (не отдельный кластер) поверх Kafka. Java/Kotlin-приложение + Streams DSL.

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

Embedded RocksDB per task. Состояние сохраняется через **changelog topic** (репликация в Kafka).

### Преимущества

- ✓ Простота — нет отдельного кластера
- ✓ Тесная интеграция с Kafka (exactly-once через transactional producer)
- ✓ Stateful processing
- ✗ Только Kafka как source / sink
- ✗ Беднее функционально, чем Flink

### Сравнение

| | Spark | Flink | Kafka Streams |
|---|---|---|---|
| Модель | Micro-batch (Structured Streaming) / batch | True streaming | True streaming |
| Latency | Секунды | Миллисекунды | Миллисекунды |
| Cluster | Spark cluster (Mesos / YARN / K8s) | Flink cluster | Библиотека в приложении (без отдельного кластера) |
| Source / Sink | Любые (S3, JDBC, Kafka, …) | Любые | Только Kafka |
| State | Spark backend | Flink state backends (RocksDB) | RocksDB + Kafka changelog |
| Exactly-once | В Structured Streaming — да | Нативно | Нативно |
| Window time | И event time, и processing time | Оба | Оба |

---

## Stream vs Batch

| | Batch | Stream |
|---|---|---|
| Latency | Часы | Секунды–миллисекунды |
| Данные | Конечные, ограниченные | Бесконечные, unbounded |
| Re-runs | Просто | Сложно (состояние, время) |
| Use case | DWH ETL, отчёты | Real-time alerts, dashboards |
| Инструменты | Spark, Hadoop, dbt | Flink, Kafka Streams, Storm |

### Когда хватает batch

- Отчёты, аналитика «вчера / прошлая неделя»
- Тяжёлые join'ы на огромных датасетах
- Обучение ML-моделей (не serving)

### Когда нужен stream

- Fraud detection (per-transaction)
- Real-time bidding (ads)
- Live dashboards
- IoT-события
- Алёрты

---

## Lambda Architecture

Сочетание batch + stream ради точности и скорости.

```
Source (Kafka)
   ├──→ Speed layer (stream, приближённое) → Serving (recent)
   └──→ Batch layer (Spark, точное)        → Serving (исторические)

Query: union speed + batch
```

- ✓ Лучшее из двух миров: свежее + точное историческое
- ✗ **Дублирование кода** (batch и streaming-версии одной логики)
- ✗ Сложность поддержки

Использовалась в Twitter, Netflix (исторически). Сейчас часто заменяется на Kappa.

---

## Kappa Architecture

Только stream. Stream-задача может reprocess'ить с начала Kafka log.

```
Source (Kafka, infinite retention)
   ↓
Stream processing (Flink)
   ↓
Serving

Reprocessing: перезапустить streaming job с offset 0
```

- ✓ Один codebase
- ✓ Проще
- ✗ Reprocess с offset 0 при багфиксе может занять часы

Jay Kreps (CEO Confluent) предложил Kappa в 2014.

---

## Stream-Table Duality

Базовое наблюдение: **stream ↔ table** взаимно конвертируемы.

```
Stream событий → накопить → Table (state)
Table → лог изменений → Stream (CDC)
```

Следствия:
- Materialized views = аггрегация поверх stream
- База данных = compacted log
- CDC (Debezium) превращает writes в БД в stream-события

Подробно: статья Jay Kreps «The Log» (must-read).

---

## Window операций

В streaming агрегации делаются над **временными окнами**.

### Tumbling windows

Фиксированные, не пересекающиеся.

```
[0–60 сек] [60–120 сек] [120–180 сек] ...
```

Use case: счётчики в минуту.

### Hopping (sliding) windows

Пересекающиеся, фиксированный размер + шаг.

```
[0–60 сек], [10–70 сек], [20–80 сек], … (size=60, hop=10)
```

Use case: rolling-среднее за минуту, обновляется каждые 10 секунд.

### Session windows

Динамические — группировка событий, близких по времени (gap < threshold).

```
события: 0, 5, 10, … (gap=30 сек) …, 45, 50, 55, …
sessions: [0, 5, 10], [45, 50, 55]
```

Use case: анализ сессий пользователей.

### Global window

Все события в одном окне (требует кастомного trigger).

---

## State management

Stream processing — stateful. Состояние per key:

- **Counter** — count событий per user
- **List** — последние события per user
- **Map** — feature store

Где хранится состояние:
- **Embedded RocksDB** — Flink, Kafka Streams. Локальный SSD, репликация через Kafka changelog
- **Внешнее хранилище** — Redis, Cassandra (медленнее, но shared)

**Checkpoints** — периодический снапшот всего состояния для recovery после crash. Flink делает асинхронные checkpoints через алгоритм Чэнди — Лэмпорта.

---

## Exactly-once в streaming

Сложнее, чем в batch. Требует:
1. Идемпотентного чтения source (offset'ы tracked)
2. Идемпотентной записи в sink (transactional или idempotent operations)
3. Атомарного checkpoint между ними
4. На рестарте — продолжить с последнего checkpoint и replay'ить tail

**Kafka Streams + Kafka sink:** нативный exactly-once через transactional producer.

**Flink + внешний sink** (Postgres, Elasticsearch): требуется либо 2-phase commit sink, либо idempotent (UPSERT по ключу) запись.

---

## Источники

- [Dean, Ghemawat (2004) — «MapReduce: Simplified Data Processing on Large Clusters»](https://research.google/pubs/pub62/)
- [Zaharia et al. (2012) — «Resilient Distributed Datasets» (Spark RDD paper)](https://www.usenix.org/system/files/conference/nsdi12/nsdi12-final138.pdf)
- [Carbone et al. (2017) — «State Management in Apache Flink»](https://www.vldb.org/pvldb/vol10/p1718-carbone.pdf)
- [Jay Kreps — «The Log: What every software engineer should know about real-time data's unifying abstraction»](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)
- [Jay Kreps — «Questioning the Lambda Architecture» (Kappa proposal)](https://www.oreilly.com/radar/questioning-the-lambda-architecture/)
- *Streaming Systems* (Tyler Akidau, Slava Chernyak, Reuven Lax — O'Reilly 2018) — главная книга по теме
- *Designing Data-Intensive Applications* (Kleppmann, 2017) — глава 11
- [Apache Flink Documentation](https://flink.apache.org/learn-flink/)
- [Kafka Streams Documentation](https://kafka.apache.org/documentation/streams/)
