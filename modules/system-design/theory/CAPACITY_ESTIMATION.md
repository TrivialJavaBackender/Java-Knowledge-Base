# Оценка ёмкости (прикидочные расчёты)

Способность быстро оценить «сколько» — критичный навык для system design интервью и реальной работы. Цель — приблизительные числа в правильном **порядке величины**, не точные.

> **Scope**: методика, типичные расчёты. Конкретные latency / cost numbers — [LATENCY_NUMBERS.md](LATENCY_NUMBERS.md).

---

## Алгоритм estimation

```
1. Определить параметры (DAU, размер сообщения, retention, ...)
2. Декомпозировать в QPS / storage / bandwidth / RAM
3. Применить ratios (read/write ratio, peak/average)
4. Округлить до powers of two
5. Сравнить с capacities (нужно 1 server / 10 / 1000)
```

**Правила:**
- 100K seconds ≈ 1 day (точно: 86,400)
- Year ≈ 30M seconds (точно: 31.5M)
- Используй K/M/B/T notation, не точные числа
- При неопределённости — диапазон («10-100K QPS»)

---

## Шаблон расчётов

### Шаг 1 — Active users → traffic

```
DAU (Daily Active Users) = 10M
Average requests per DAU per day = 100
→ Total requests/day = 10M × 100 = 1B = 10^9
→ Average QPS = 10^9 / 86400 ≈ 12K QPS

Peak factor (peak / avg) = 2-3× обычно (some apps — 10-100× для flash sales)
→ Peak QPS ≈ 36K QPS
```

### Шаг 2 — Storage

```
Average record size = 1 KB
Records per day = 100M (например, посты)
Daily storage = 100M × 1KB = 100 GB / day

Retention = 5 years
Total storage = 100 GB × 365 × 5 = 180 TB
Plus replication factor 3 = 540 TB raw storage
```

### Шаг 3 — Bandwidth

```
Egress (out from servers) = QPS × response_size
At peak: 36K × 10 KB response = 360 MB/sec = 2.88 Gbps
→ Need 10 Gbps NIC headroom × N servers
```

### Шаг 4 — RAM (для кэша)

```
Hot set = 20% of users active in 1 hour = 2M users
Per-user data cached = 5 KB
→ Cache RAM needed = 2M × 5KB = 10 GB

→ Fits in single Redis node (32 GB instance), but plan for HA → 3 nodes
```

---

## Разобранный пример: лента Twitter

**Параметры:**
- 300M DAU
- Average 100 tweets read per user / day
- Average 1 tweet sent per user / day (10% are tweeters)
- Tweet size = 280 chars + metadata = ~ 500 bytes
- Retention indefinite (но recent = hot)

**Estimation:**

```
READS:
  300M × 100 = 30B reads/day
  Avg QPS = 30B / 86400 ≈ 350K QPS
  Peak QPS (2×) ≈ 700K QPS

WRITES:
  300M × 1 × 10% = 30M writes/day
  Avg QPS = 30M / 86400 ≈ 350 writes/sec
  Peak = 700 writes/sec (much less than reads — read-heavy!)

→ Read/Write ratio ≈ 1000:1

STORAGE:
  Writes × size: 30M × 500B = 15 GB/day
  Yearly: 5.5 TB/year
  10 years: 55 TB raw, 165 TB with RF=3
  → Easily on a few sharded DBs

BANDWIDTH:
  Reads × tweet size: 700K QPS × 500B = 350 MB/s out = 2.8 Gbps
  → Single CDN PoP может справиться, multi-region для latency

KEY DECISIONS:
  Read-heavy → aggressive caching (Redis), fan-out on write для feed
  Celebrity problem: top 1% accounts получают 99% reads → key splitting
```

---

## Разобранный пример: распределённый кэш

**Параметры:**
- 1M items cached
- Average item size = 10 KB
- Hot working set = 20% (200K items)
- Required cache hit ratio = 99%
- Cache target latency p99 = 1 ms

**Estimation:**

```
RAM for hot set:
  200K × 10KB = 2 GB
  
RAM for full dataset:
  1M × 10KB = 10 GB

→ For 99% hit ratio с LRU, нужно cache ≈ 90-95% dataset
   (working set theorem)
→ Need 9 GB RAM, рекомендация 16 GB instance (headroom + LRU overhead)

QPS:
  Assume 100K QPS read
  → Single Redis node can handle (100K-1M ops/sec)
  → Network: 100K × 10KB = 1 GB/s = 8 Gbps → close to limit
  → Better: Redis Cluster с 3 shards, каждый ~ 30K QPS, 3 Gbps

For HA:
  Each shard primary + 1 replica = 6 nodes
  + Sentinel (3 nodes) for monitoring
```

---

## Разобранный пример: сокращатель URL

**Параметры:**
- 100M URLs created/year
- 10:1 read/write ratio (100M writes/year → 1B reads/year)
- Lifetime = unlimited

**Estimation:**

```
WRITES:
  100M / year / 31.5M sec = ~3 writes/sec average
  Peak (10×) ≈ 30 writes/sec
  → Trivial QPS

READS:
  1B / year / 31.5M = ~32 reads/sec average
  Peak ≈ 320 reads/sec
  Trivial.

STORAGE:
  Per URL: short_code (8 bytes) + long_url (avg 100 bytes) + metadata (50 bytes) = ~200 bytes
  10 years × 100M URLs = 1B URLs × 200B = 200 GB
  → Single PostgreSQL instance, easily fits

KEY GENERATION:
  62^6 = 56 billion (long enough for 10+ years)
  62^7 = 3.5 trillion (forever)
  → Use base62 encoding of incrementing counter or hash

CACHE:
  Top 20% most popular URLs cached → 200M URLs × 200B = 40 GB cache
  Realistic hot set = top 1% → 2 GB → fits in single Redis node easily
```

**Insight:** для URL shortener инфраструктура не challenge — design о другом (ID generation, redirects with low latency, analytics).

---

## Шпаргалка по степеням двойки

| 2^n | Decimal | Use case |
|-----|---------|----------|
| 2^10 | ~10^3 | K |
| 2^20 | ~10^6 | M |
| 2^30 | ~10^9 | G |
| 2^40 | ~10^12 | T |
| 2^50 | ~10^15 | P |
| 2^60 | ~10^18 | E |

**Tactic:** на интервью считай в K/M/G — никогда не пиши длинные числа. `10^9` лучше чем `1,000,000,000`.

---

## Read/Write ratios (по типам систем)

| System | R:W |
|--------|-----|
| Twitter timeline | ~ 1000:1 (читают много, постят мало) |
| Reddit | ~ 100:1 |
| Email | ~ 1:1 |
| Logging system | ~ 1:1000 (пишут много, читают мало) |
| Bank transactions | ~ 10:1 |
| Analytics dashboard | ~ 1:10000 (ingestion >> reads) |

→ Read-heavy → caching, read replicas. Write-heavy → sharding, LSM-based stores (Cassandra, ScyllaDB).

---

## Пиковые и средние коэффициенты

| Pattern | Peak/Avg |
|---------|----------|
| Stable B2B service | 1.5-2× |
| Consumer web | 2-3× |
| Time-zone concentrated (US/EU) | 3-5× |
| Flash sale, event | 10-100× |
| Black Friday e-commerce | 50-100× |

→ Always estimate at **peak**, не average. Auto-scaling, capacity planning.

---

## Проверки на здравый смысл

После расчёта проверь себя:

1. **Сравни с реальностью**: 100K QPS — это 100M req/day. Если результат «1B writes/sec» — что-то не так (или ты Netflix).
2. **Bandwidth check**: 10 Gbps NIC = 1.25 GB/s. Если расчёт > 10 Gbps на single instance — нужно distribution.
3. **Storage growth**: «1 PB» означает много железа. Подумай, нужны ли все данные горячие, или часть архивная.
4. **CPU bound vs IO bound**: 100K QPS трудно с CPU-heavy operations (encryption на каждый), легко если просто proxy.

---

## Частые ошибки на собеседовании

- **Считаешь только average, не peak** — миграция в prod failt в первую же пик-нагрузку
- **Игнорируешь replication factor** — данные × 3 для RF=3
- **Не учитываешь overhead** (индексы +30-50% от raw data в RDBMS, GIN/GiST в 2-5× от B-tree)
- **Запоминаешь стандартные числа без понимания** — на вопрос «почему 10K QPS на PG?» нет ответа
- **Слишком много знаков точности** — `12,847 QPS` outputs «not a feel», `~13K QPS` лучше
- **Слепо доверяешь cloud autoscaling** — autoscaling не помогает, если single instance не справляется (DB pinned scale)

---

## Источники

- [donnemartin/system-design-primer — Powers of two table](https://github.com/donnemartin/system-design-primer#powers-of-two-table)
- [Alex Xu — System Design Interview Vol. 1, Ch. 2 «Back-of-the-envelope estimation»](https://blog.bytebytego.com/p/system-design-interview-books-volume)
- [Jeff Dean — Numbers Every Programmer Should Know](https://research.google/people/jeff/)
- [Hello Interview — Back of the Envelope Calculations](https://www.hellointerview.com/learn/system-design/in-a-hurry/back-of-the-envelope-calculations)
- *Designing Data-Intensive Applications* (Kleppmann, 2017) — Ch. 1 «Reliable, Scalable, Maintainable»
