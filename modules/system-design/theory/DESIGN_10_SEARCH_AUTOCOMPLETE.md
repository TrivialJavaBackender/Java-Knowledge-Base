# Design Problem: Search Autocomplete (Typeahead)

Suggest queries as user types. Google search box, Amazon product search, Twitter mentions. Latency-critical (50-100 ms per keystroke), ranking by popularity.

> **Scope**: design-level. Trie теория — [`TRIE.md`](TRIE.md).

---

## 1. Requirements

### Functional
- Suggest top-K query completions для prefix
- Update suggestions с каждым keystroke
- Rank by popularity (most-searched first)
- Personalization (optional)
- Real-time updates (new trending queries appear)

### Non-functional
- **Sub-100 ms response** — < 50 ms ideally
- **High throughput** — каждый keystroke = request × millions of users
- **Scalability** — billions of search queries history

---

## 2. Estimation

```
500M searches / day
Average 4 keystrokes per query = 2B keystroke autocomplete requests / day
  = ~ 25K QPS avg, 100K QPS peak

Unique queries: ~ 100M (long tail)
Top 1M cover ~ 95% queries (Zipfian distribution)

Trie size:
  100M queries × avg 20 chars × 1 byte = 2 GB raw chars
  With tree overhead + top-K cached per node: ~ 20 GB total
  → Fits in RAM (single node 64 GB)
```

---

## 3. API

```http
GET /api/v1/autocomplete?q=brown+f&limit=10
→ 200 [
  { suggestion: "brown fox", count: 12345 },
  { suggestion: "brown furniture", count: 8901 },
  { suggestion: "brown fox jumps over", count: 5432 },
  ...
]
```

---

## 4. Architecture

```
User typing → throttle (debounce 50-100 ms keystrokes)
  ↓
LB → Autocomplete Service (read replicas)
  ↓
In-memory Trie + Top-K cache
  ↓ (refresh periodically)
Trie Builder (batch job)
  ↑
Query Log Aggregator → counts per query per day
  ↑
Raw search logs (Kafka)
```

---

## 5. Trie с pre-computed top-K

См. [`TRIE.md`](TRIE.md) для базовой теории.

Каждый Trie node хранит **top-K suggestions** для своего prefix:

```python
class TrieNode:
    children: dict
    top_k_suggestions: list[(string, score)]  # pre-sorted by score
```

Query `"app"`:
- Navigate to node for "app"
- Return `node.top_k_suggestions` (instant)

**Trade-off:**
- ✓ O(L) query time + return K — very fast
- ✗ Memory: per-node top-K cache
- ✗ Update: changing score may require updating multiple ancestor nodes

---

## 6. Trie build pipeline

### Offline (batch)

```
Daily Spark job:
  Raw search logs → aggregation:
    query → count over last 30 days
  Build trie:
    insert each (query, count) → update top-K в ancestor nodes
  Serialize trie → S3
```

### Online refresh

```
Autocomplete service:
  At startup: download latest trie from S3, load into memory
  Periodically: check for updates, reload (blue-green to avoid downtime)
```

### Real-time partial updates

For trending (e.g., breaking news terms — «Earthquake»), pure offline laggy.

```
Recent queries (last 1 hour) → streaming aggregation (Flink) →
  Updates к «hot» trie (separate in-memory) →
  Merge results from offline trie + hot trie at query time
```

---

## 7. Storage

### Trie (in-memory)

- Single binary serialized format
- Per app instance load same blob
- ~ 20 GB for 100M queries → fits 64 GB instance

### Persistence (cold)

- S3 blob — re-built daily
- Smaller queries DB (PostgreSQL / Cassandra) для drill-down analytics

### Search logs

- Kafka topic with retention (e.g., 30 days)
- Archive к S3 + columnar (Parquet) для analytics

---

## 8. Distributed serving

### Sharding by prefix

Если trie не помещается на single node — shard by prefix:

```
Shard 0: prefixes a-d
Shard 1: prefixes e-h
Shard 2: prefixes i-l
...

Router dispatches query к correct shard based on first character
```

But for total fan-out (e.g., suggestion crossing shards), need merge.

### Replicate read-only

Trie is immutable per refresh. Many read replicas for high QPS.

```
N replicas, each loads same trie
Round-robin requests
Refresh: blue/green deploy, new replicas with new trie come up
```

---

## 9. Personalization

Add user-specific suggestions on top of global popular.

```
At query time:
  global_suggestions = trie.top_k(prefix, K=15)
  user_history = redis.lrange(f"history:{user_id}", 0, -1)  # recent searches
  user_matching = filter(lambda s: s.startswith(prefix), user_history)
  
  merge: prefer user_matching, fill rest with global
```

Or use ML model with features (location, time of day, language, recent activity).

---

## 10. Anti-patterns / Bad words

- Filter explicit / harmful queries
- Block trademark abuse (Coca-Cola won't allow «Pepsi» suggestion)
- Hide queries with very low count (likely spam / typos)

---

## 11. Caching layer

Top prefixes («a», «am», «ama», «amaz») — millions of QPS.

```
Application-level cache (Caffeine LRU) на каждый app instance
TTL: 5 minutes (trade-off freshness vs hit rate)

Top 1000 prefixes covered → 90% queries served from cache without trie traversal
```

---

## 12. Failure modes

| Scenario | Handling |
|----------|----------|
| Trie rebuild fails | Use yesterday's trie; alert ops |
| Hot prefix overload | Scale up replicas; geographic CDN edge caching for read-only |
| New trending term not in trie | Hot trie (streaming) covers; merge results |
| User input has emojis / unicode | Normalize at ingestion + query time |

---

## 13. Trade-offs

### Pre-computed top-K vs query-time ranking

- **Pre-computed** — fast, but stale (rebuilt daily); cannot personalize aggressively
- **Query-time** — slower, but real-time + personalization possible

Hybrid: pre-computed + late-binding personalization re-rank.

### Trie vs search engine

- **Trie** — perfect для prefix matching, hand-tuned ranking
- **Elasticsearch / Solr** — fuzzy matching, edge n-gram tokenizer работает aналогично; out-of-box features
- **DAWG** (Directed Acyclic Word Graph) — еще compact, но harder to update

Modern: Elasticsearch Completion Suggester (FST-backed) widely used. Pure trie остаётся когда нужен fine control.

---

## 14. Real-world examples

- **Google search autocomplete** — kustom trie + ML + personalization
- **Amazon search** — product catalog Trie + category boosting
- **Twitter mentions** — special case (user handles)
- **LinkedIn typeahead** — Cleo (open-sourced)
- **Elasticsearch Completion Suggester** — FST-based, used by many smaller services

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — Ch. 13 «Design a Search Autocomplete System»
- [LinkedIn Cleo open source](https://github.com/linkedin/cleo)
- [Elasticsearch Completion Suggester](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-suggesters.html#completion-suggester)
- [Hello Interview — Twitter typeahead](https://www.hellointerview.com/learn/system-design/problem-breakdowns)
- См. также [`TRIE.md`](TRIE.md), [`INVERTED_INDEX.md`](INVERTED_INDEX.md)
