# Числа задержки, которые должен знать каждый программист

Таблица «сколько что стоит» — основа планирования ёмкости и архитектурных решений. Jeff Dean популяризовал в 2009; цифры обновляются под современное железо (SSD, NVMe, быстрые NIC).

---

## Каноничная таблица (обновлённая для 2025)

```
L1 cache reference                          ~1 ns       (regs: 0.3 ns)
Branch mispredict                           ~3 ns
L2 cache reference                          ~4 ns       (4-5× L1)
Mutex lock / unlock (uncontended)           ~17 ns
L3 cache reference                          ~12 ns
Main memory reference (RAM, random)         ~100 ns     (cache miss: 25× L1)

Compress 1 KB with Snappy                   ~2 µs       (2000 ns)
Send 1 KB over 1 Gbps network               ~10 µs      (latency, not full bandwidth)

Read 1 MB sequentially from RAM             ~3 µs
Read 4 KB random from NVMe SSD              ~10 µs      (was 150 µs on SATA SSD in 2012)
Read 1 MB sequentially from NVMe SSD        ~200 µs
Round trip in same datacenter               ~500 µs
Read 1 MB sequentially from HDD (legacy)    ~10 ms      (1000× slower than RAM)
Disk seek (HDD, legacy)                     ~10 ms

Round trip US East ↔ US West                ~70 ms      (cross-coast)
Round trip US ↔ EU                          ~80-150 ms
Round trip US ↔ APAC                        ~150-300 ms

DNS lookup (cold)                           ~50-100 ms
TLS handshake (TLS 1.3 0-RTT)                ~0 ms       (with session resumption)
TLS handshake (TLS 1.3 cold)                 ~100 ms     (1 RT)
TLS handshake (TLS 1.2 cold)                 ~200 ms     (2 RT)
```

### Important orders of magnitude

| Operation | Latency | Relative |
|-----------|---------|----------|
| L1 cache | 1 ns | 1× |
| L2 cache | 4 ns | 4× |
| L3 cache | 12 ns | 12× |
| RAM | 100 ns | 100× |
| NVMe SSD random read | 10 µs | 10,000× |
| Datacenter network RT | 500 µs | 500,000× |
| HDD seek | 10 ms | 10,000,000× |
| Cross-region network RT | 150 ms | 150,000,000× |

**Insight:** разница RAM → SSD → network → cross-region растёт в **сотни/тысячи раз** каждая ступень. Поэтому **локальность** (cache, page cache, near-cache) даёт огромный выигрыш.

---

## Следствия для архитектуры

### Cache аggressively

Hit ratio 95% → 95% запросов = `1 µs` (RAM access), 5% = `10 ms` (DB). Average = `0.5 ms` вместо `10 ms` без кэша → 20× speedup.

```
Effective latency = hit_ratio × cache_lat + (1-hit_ratio) × db_lat
                  = 0.95 × 0.001 ms + 0.05 × 10 ms = 0.5 ms
```

См. [`caching-deep-dive/BASICS.md`](../../caching-deep-dive/theory/BASICS.md) для cache hierarchy.

### Sequential > Random

Sequential disk read = 200 µs/MB. Random = 10 µs/4KB = 2.5 ms/MB → 12× slower.

→ Поэтому LSM-trees (append-only), columnar storage (последовательный scan колонки), log-structured filesystems быстрее для analytics.

### Batching и pipelining

Каждый network RT в datacenter = 500 µs. Если делаешь 100 sequential `GET` к Redis → 50 ms. Pipelining (batch 100) → 1 RT = 500 µs (100× speedup).

```
sequential:   100 × 500µs = 50 ms
pipelined:    1 × 500µs + 100 × processing = ~600 µs
```

См. Redis pipelining, gRPC streaming, JDBC batch insert.

### Avoid cross-region calls in hot path

Каждый cross-region call = 80-150 ms. Если в request flow есть один такой — уже за 200ms response time.

→ Multi-region активно реплицируется (хоть и eventual consistent), critical state локально.

### TLS 1.3 + session resumption

TLS 1.2 cold = 2 RT = 200 ms (на US ↔ EU). TLS 1.3 cold = 1 RT = 100 ms. TLS 1.3 0-RTT (session resume) = **0 ms** (можно начать application data сразу).

→ Для mobile / API-heavy — обязательно session resumption.

### HTTP/2 multiplexing

HTTP/1.1: 6 параллельных connections × N requests. HTTP/2: один connection, N streams параллельно. Меньше TLS handshake overhead, лучше head-of-line.

---

## Universal Scalability Law (Нил Гюнтер)

```
C(N) = N / (1 + α(N-1) + βN(N-1))

где:
  α = contention (sequential portion, Amdahl)
  β = coherence (inter-node sync overhead)
```

- При `β = 0` — это закон Amdahl (limit `1/α`)
- При `β > 0` — есть **negative scalability**: добавление узлов **уменьшает** throughput сверх определённой точки (из-за coherence overhead)

**Practical:** в distributed systems coherence (replication, gossip, consensus) растёт нелинейно. После определённого размера cluster добавление узла увеличивает latency.

→ Cassandra рекомендует ≤ 100 nodes per cluster для balance. K8s — 5000 nodes хард-лимит. PostgreSQL streaming replication ~ 5-10 replicas comfortably.

---

## Степени двойки (для оценки ёмкости)

| Power | Value | Memorable |
|-------|-------|-----------|
| 2^10 | 1,024 | ~1 K |
| 2^16 | 65,536 | ~64 K |
| 2^20 | 1,048,576 | ~1 M |
| 2^24 | 16,777,216 | ~16 M |
| 2^30 | 1,073,741,824 | ~1 G |
| 2^32 | 4,294,967,296 | ~4 G (32-bit int max) |
| 2^40 | 1,099,511,627,776 | ~1 T |
| 2^50 | ~1.13 × 10^15 | ~1 P |

**Use case:** «storage for 100M users × 1 KB profile each» = `100M × 1KB = 100 GB`. Если 10 KB → 1 TB. Если 1 MB photo each → 100 TB.

### Storage capacities

| Size | Bytes | Use case |
|------|-------|----------|
| KB | ~10^3 | Single record, small JSON |
| MB | ~10^6 | Image, large document |
| GB | ~10^9 | RAM, small DB |
| TB | ~10^12 | Single-node SSD, mid-size DB |
| PB | ~10^15 | Big data warehouse, video archive |
| EB | ~10^18 | Internet-scale (Facebook ~ 300 PB, YouTube ~ 1 EB total) |

---

## Диапазоны QPS / TPS (по типам систем)

| System | QPS / TPS |
|--------|-----------|
| Single PostgreSQL primary | 10K writes, 50K reads (with optimization) |
| Single Redis node | 100K-1M ops |
| Single Kafka broker | 100K-1M msg |
| Single CDN PoP | 100K-1M req |
| nginx serving static | 1M+ req |
| Google Search (peak) | 100K QPS |
| Twitter timeline reads | 300K QPS (2017 data) |
| Facebook feed | 1M+ QPS |
| YouTube | 5K hours of video uploaded/min |

---

## Соображения стоимости

Latency и пропускная способность — не единственные оси. Cost часто решает архитектуру:

- **AWS S3 storage** ~ $0.023 / GB / month (standard)
- **AWS S3 egress** ~ $0.09 / GB (внешний интернет) → 1 TB = $90 per transfer
- **AWS data transfer cross-region** ~ $0.02-0.09 / GB
- **EC2 m6i.large** ~ $0.10 / hour (~ $70/month)
- **RDS PostgreSQL db.r6g.large** ~ $0.30 / hour (~ $220/month)
- **CloudFront** ~ $0.085 / GB (10 TB+ tier — $0.025)

**CDN economics:** moving from `origin → user` (egress paid) to `origin → CDN (one-time) → users (CDN edge)` (cheaper egress) — типичная экономия 60-80% для static assets.

---

## Источники

- [Jeff Dean — Numbers Every Programmer Should Know](https://research.google/people/jeff/) (оригинал 2009, slides)
- [Peter Norvig — Teach Yourself Programming in Ten Years](https://norvig.com/21-days.html) — содержит обновлённую таблицу
- [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832) — community-updated gist
- [Brendan Gregg — Systems Performance](https://www.brendangregg.com/sysperfbook.html) — глубокое погружение
- [Neil Gunther — Guerrilla Capacity Planning](http://www.perfdynamics.com/Manifesto/USLscalability.html) — Universal Scalability Law
- [HPBN (High Performance Browser Networking) — Ilya Grigorik](https://hpbn.co/) — networking latency на практике
- [AWS pricing pages](https://aws.amazon.com/pricing/) — current cost data
