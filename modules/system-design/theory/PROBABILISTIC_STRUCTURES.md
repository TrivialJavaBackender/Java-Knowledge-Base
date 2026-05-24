# Probabilistic Data Structures

Структуры с приближёнными ответами в обмен на меньший memory/CPU. Используются на scale, где точные алгоритмы не помещаются в RAM.

---

## Bloom Filter

**Цель:** проверить «может ли элемент быть в множестве?» с low memory cost. **No false negatives** (если говорит «нет» — точно нет), **false positives возможны** (если говорит «да» — может быть нет).

### Структура

- Bit array размером `m`
- `k` hash functions
- Размер `m` определяется по `n` (expected items) и `p` (acceptable false positive rate)

```
m = -n * ln(p) / (ln(2))^2
k = (m/n) * ln(2)

Для n=1M, p=1% → m=9.6M bits (1.2 MB), k=7 hash functions
```

### Операции

```
add(x):
  for h_i in hash_functions:
    bits[h_i(x) % m] = 1

contains(x) → bool:
  for h_i in hash_functions:
    if bits[h_i(x) % m] == 0:
      return False  # 100% guaranteed not present
  return True  # possibly present (could be false positive)
```

### Use cases

- **Cache penetration prevention** — перед запросом к DB проверить Bloom: «есть такой userId?» Если Bloom говорит «нет» → 100% не в DB, skip query
- **Deduplication** — URL crawler: «видели этот URL?»
- **CDN** — does this URL exist in origin (negative cache)
- **LSM-tree** point lookup optimization (Cassandra, RocksDB)
- **Bitcoin SPV** clients — filter relevant transactions

### Ограничения

- ✗ **Нельзя удалять** элементы из стандартного Bloom (обнуление битов ломает другие элементы)
- ✗ Доля false positive растёт со временем, если добавили больше, чем планировали
- ✗ Нельзя итерироваться по элементам

### Counting Bloom Filter

Вместо bits — counters. `add` increments, `remove` decrements. Можно удалять, но 4-8× больше memory.

### Cuckoo Filter (альтернатива)

- ✓ Поддерживает delete
- ✓ Меньше памяти, чем Counting Bloom, при одинаковом FP rate
- ✗ Insert может упасть при высоком load factor
- Используется в современных системах как замена Counting Bloom

---

## Count-Min Sketch (CMS)

**Цель:** оценить **frequency** элемента в потоке. Approximate counting в constant memory.

### Структура

`d × w` matrix counters. `d` hash functions, каждая maps в одну из `w` columns.

```
        col 0  col 1  col 2  ...  col w-1
row 0   [count][count][count] ... [count]
row 1   [count][count][count] ... [count]
...
row d-1 [count][count][count] ... [count]
```

### Операции

```
add(x):
  for i in 0..d:
    matrix[i][hash_i(x) % w] += 1

count(x) → estimate:
  return min(matrix[i][hash_i(x) % w] for i in 0..d)
       # min — лучшая оценка (минимум collisions)
```

### Свойства

- **Overestimates** (никогда не undercounts)
- Error bounded: `ε ≈ 2/w`, probability of bound exceeded: `δ ≈ 1/e^d`

### Use cases

- **Heavy hitters** — top-K queries в streaming
- **Network traffic analysis** — какие IP отправляют больше всего
- **Database query optimization** — frequency for index selectivity
- **Recommender systems** — co-occurrence counts

### Top-K

CMS + heap = `top_K`:
- CMS tracks frequencies
- Min-heap размером K хранит current top K
- Each item: estimate freq, if > min(heap) → update heap

---

## HyperLogLog (HLL)

**Цель:** approximate count distinct elements. `count_distinct` точно требует O(n) memory (HashSet); HLL — O(log log n) memory.

### Idea

- Hash каждый element → uniform random bits
- Track **maximum number of leading zeros** в hashes — corresponds к approximate log2(distinct count)
- Multiple hash functions / partitions → average для accuracy

### Размер

**~12 KB для error 2%, 1+ billion distinct elements**. Compare к HashSet: 1B items × 8 bytes = 8 GB.

### Операции

```
add(x):
  h = hash(x)
  partition = h % m       # m = 16384 для standard
  rest = h / m
  leading_zeros = count_leading_zeros(rest)
  registers[partition] = max(registers[partition], leading_zeros)

count_distinct() → estimate:
  harmonic_mean(registers) * m * α  # bias correction
```

### Use cases

- **Unique visitors** counting (Redis `PFCOUNT`)
- **Cardinality в analytics** (Druid, BigQuery — built-in `APPROX_COUNT_DISTINCT`)
- **DDoS detection** — unique source IPs
- **Privacy** — Apple uses HLL variants для differential privacy

### Redis HyperLogLog

```redis
PFADD visitors 'user:123'
PFADD visitors 'user:456'
PFCOUNT visitors          → ~ 2

PFMERGE result visitors_day1 visitors_day2  # union без duplicate
PFCOUNT result            → union cardinality
```

---

## Other approximate structures

### Top-K (Misra-Gries / Space-Saving)

Streaming top-K with bounded memory. `O(K)` space, suitable when K is small (top 100, 1000).

### MinHash

Approximate Jaccard similarity (set similarity). Two sets — sample fingerprints — compare counts of overlapping.

**Use case:** plagiarism detection, near-duplicate document detection.

### Quotient Filter

Modern alternative to Bloom — better cache locality, supports delete.

---

## Сравнительная таблица

| Structure | Use case | Memory | False rate | Notes |
|-----------|----------|--------|------------|-------|
| **Bloom Filter** | Membership query | ~1.2 MB / 1M @ 1% | False positives | No delete (standard) |
| **Counting Bloom** | Membership with delete | 4-8× Bloom | Same | Supports delete |
| **Cuckoo Filter** | Better Bloom | Less than Counting Bloom | Same | Supports delete, modern |
| **Count-Min Sketch** | Frequency | KB-MB range | Overestimates | Approximate frequencies |
| **HyperLogLog** | Count distinct | ~12 KB / billion | ±2% | Cardinality only |
| **Top-K (Misra-Gries)** | Top-K items | O(K) | Approximate | When K is small |
| **MinHash** | Set similarity | O(k) per set | Approximate | Jaccard estimation |

---

## Когда НЕ использовать

Приближённое ≠ точное. Не используй, если:

- **Нужна строгая корректность** — финансовые транзакции (никаких false positive или false negative)
- **Маленький датасет** — overhead не оправдан (используй HashSet, HashMap)
- **Нужны точные счётчики** для биллинга — HyperLogLog даёт приближение; нужны exact counters

**Паттерн:** приближённые структуры в hot-path (cache, dedup, real-time-аналитика), точные — в batch (ночные агрегаты, финансовое закрытие).

---

## Real-world systems

- **Redis** — Bloom Filter (RedisBloom module), HyperLogLog (`PFADD`/`PFCOUNT`)
- **Cassandra** — Bloom Filter per SSTable для read optimization
- **PostgreSQL** — Bloom filter index extension (`bloom` extension)
- **BigQuery** — `APPROX_COUNT_DISTINCT` (HLL)
- **Apache Druid** — HLL для COUNT DISTINCT в queries
- **Snowflake** — built-in approximate functions
- **Facebook** — Apache Pinot for approximate top-K в feeds
- **Akamai / Cloudflare** — CMS для real-time traffic analysis

---

## Источники

**Papers:**
- [Bloom (1970) — «Space/Time Trade-offs in Hash Coding with Allowable Errors»](https://web.archive.org/web/20120307010822/http://www.cs.upc.edu/~diaz/p422-bloom.pdf) — оригинал
- [Cormode, Muthukrishnan (2005) — «An Improved Data Stream Summary: The Count-Min Sketch»](http://dimacs.rutgers.edu/~graham/pubs/papers/cmsoft.pdf)
- [Flajolet et al. (2007) — «HyperLogLog: the analysis of a near-optimal cardinality estimation algorithm»](http://algo.inria.fr/flajolet/Publications/FlFuGaMe07.pdf)
- [Fan et al. (2014) — «Cuckoo Filter: Practically Better Than Bloom»](https://www.cs.cmu.edu/~dga/papers/cuckoo-conext2014.pdf)

**Engineering:**
- [Cloudflare — Probabilistic algorithms in DDoS protection](https://blog.cloudflare.com/when-bloom-filters-dont-bloom/)
- [Discord — Why Discord is switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust) — Bloom filter performance critical path
- [Redis Bloom Filter documentation](https://redis.io/docs/data-types/probabilistic/bloom-filter/)
- [PostgreSQL bloom extension](https://www.postgresql.org/docs/current/bloom.html)

**Books:**
- *Data Streaming Algorithms* (S. Muthukrishnan, 2005) — academic textbook
- *Database Internals* (Petrov, 2019) — Bloom в LSM context
