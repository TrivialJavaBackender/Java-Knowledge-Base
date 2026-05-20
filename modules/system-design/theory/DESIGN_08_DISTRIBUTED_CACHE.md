# Design Problem: Distributed Cache (Memcached/Redis Cluster)

Shared cache across N application instances. Главные challenges: data distribution (consistent hashing), replication для HA, cache invalidation.

> **Scope**: design-уровень. Cache patterns, eviction algorithms, Caffeine/Redis deep — см. [`caching-deep-dive/`](../../../caching-deep-dive/).

---

## 1. Requirements

### Functional
- GET key → value
- PUT key value [TTL]
- DELETE key
- (Optional) Counters (INCR), structured (Hash, List, Set, ZSet)

### Non-functional
- **Low latency** — p99 < 10 ms
- **High throughput** — 100K-1M ops/sec
- **Scalable** — add nodes for capacity
- **Available** — node failure не loses всех данных
- **Eventual consistency OK** — cache есть «approximation», DB — source of truth

---

## 2. Estimation

```
1B items cached, avg 1 KB each → 1 TB working set
1M ops/sec peak across cluster

Single Redis node:
  - 100K-1M ops/sec (network bound > 1 Gbps)
  - ~ 100 GB RAM practical limit
  
→ Need 10-20 shards to handle 1 TB / 1M ops
```

---

## 3. Architecture

```
Client (smart, knows topology)
  ↓
  ├── Node 1 (shard 0, primary)
  ├── Node 2 (shard 1, primary)
  ├── Node 3 (shard 2, primary)
  ├── Replica of Node 1 (shard 0, replica)
  ├── Replica of Node 2 (shard 1, replica)
  └── Replica of Node 3 (shard 2, replica)

Reads → primary (or replica для read scaling)
Writes → primary
Async replication primary → replica
```

---

## 4. Distribution — Consistent Hashing

Key → shard mapping via consistent hashing.

См. [`SHARDING.md` (databases)](../../databases/theory/SHARDING.md#consistent-hashing) и [`caching-deep-dive/DISTRIBUTED_CACHING.md`](../../../caching-deep-dive/theory/DISTRIBUTED_CACHING.md) для теории.

```python
ring = ConsistentHashRing(virtual_nodes_per_real=200)
ring.add_node("node1")
ring.add_node("node2")
ring.add_node("node3")

shard = ring.get_node(key)  # hash(key) → walk ring → найти node
```

**Adding node:** перемещается только `1/N` ключей.

**Redis Cluster подход:** 16384 hash slots, статически распределены по nodes. Move slot → migrate keys (online).

---

## 5. Client-side vs server-side routing

### Client-side (Memcached style)

Client computes shard, connects directly к right node.

- ✓ Fastest (1 hop)
- ✗ Client must know topology, handle membership changes

### Proxy-based (Twemproxy, mcrouter)

Client sends к proxy, proxy routes.

- ✓ Simple client
- ✗ Extra hop, proxy adds latency

### Server-side cluster (Redis Cluster, mongos-style)

Any node receives request, redirects если нужно («MOVED slot to nodeX»).

- ✓ Client just needs initial node list
- ✗ Possible extra hop

---

## 6. Replication

### Sync vs async

- **Sync** — write returns after replica confirms. Slower, no data loss on primary failure.
- **Async** — write returns immediately. Faster, may lose recent writes on failover.

Cache typically: **async** (cache loss tolerable, refilled from DB).

### Replica count

- 1 replica — recover from one node failure, no read scaling
- 2+ replicas — read load balanced, higher tolerance

Trade-off: storage cost × (N+1).

---

## 7. Failure handling

### Node down

- Replica promoted to primary
- Client (or cluster) updates topology
- Failed node — when comes back, replicates from new primary

### Whole shard down

- All data in that shard lost (cache, OK)
- Or restored from snapshot
- During recovery: cache misses, DB load spike

### Network partition

- Minority partition stops accepting writes (split-brain prevention)
- Cluster reconfigured when partition heals

---

## 8. Cache invalidation

См. [`caching-deep-dive/CONSISTENCY.md`](../../../caching-deep-dive/theory/CONSISTENCY.md) для теории.

### Patterns

- **TTL-only** — entries expire automatically; eventual consistency
- **Write-through invalidation** — application updates cache + DB атомарно (with order: DB then cache, или CAS)
- **CDC-based** — Debezium streams DB changes → invalidate cache (more loosely coupled)
- **Versioned keys** — append version к key (`user:123:v5`), new data → new key, old key expires

### Patterns most apps use

1. Cache-aside (lazy loading): read miss → DB → put in cache
2. TTL для freshness bound
3. Active invalidation only для critical (price changes, etc.)

---

## 9. Hot key problem

Single key receiving disproportionate traffic.

### Mitigations

- **Replication** — replicate hot key на all/multiple nodes
- **Key splitting** — `user:bieber:tweets:0..9`, randomize on write/read
- **Local cache** — app instances cache hot keys в process memory
- **Tiered caching** — L1 in-process, L2 distributed

См. [`caching-deep-dive/ANTI_PATTERNS.md`](../../../caching-deep-dive/theory/ANTI_PATTERNS.md#hot-key) для деталей.

---

## 10. Persistence (optional)

Pure cache — RAM only. Some use cases need persistence:

- **Redis RDB** — periodic snapshot
- **Redis AOF** — append-only log
- **Tradeoff:** Persistence adds latency, cost. Most cache designs skip.

См. [`caching-deep-dive/REDIS.md`](../../../caching-deep-dive/theory/REDIS.md).

---

## 11. Eviction policies

When cache full, evict items.

- **LRU** — Least Recently Used. Standard, good for most workloads.
- **LFU** — Least Frequently Used. Better для stable hot set.
- **TTL** — fixed expiration time
- **FIFO** — simple, but often inferior to LRU
- **W-TinyLFU** (Caffeine default) — best research, used in modern caches
- **Allkeys-random** — Redis option (when keys all equally important)

См. [`caching-deep-dive/EVICTION_POLICIES.md`](../../../caching-deep-dive/theory/EVICTION_POLICIES.md).

---

## 12. Monitoring

Critical metrics:
- **Hit ratio** (target > 90%)
- **Latency** p50/p99
- **Memory usage** per shard
- **Eviction rate** — high = cache undersized
- **Hot keys** — periodic scan top-N

Per-shard imbalance signals bad hash key distribution.

---

## 13. Trade-offs

### Memcached vs Redis

| | Memcached | Redis |
|---|---|---|
| Data types | String only | String, Hash, List, Set, ZSet, Stream, ... |
| Persistence | None | RDB / AOF |
| Replication | Client-side (3rd party) | Built-in |
| Cluster | mcrouter / Twemproxy | Redis Cluster |
| Single-threaded | Multi-threaded | Single-threaded (per shard) |
| Use case | Pure caching | Caching + data structures + pub/sub + Lua |

Modern: Redis dominates. Memcached used by legacy or pure-cache simplicity.

### Centralized vs near-cache

- **Centralized** (this design) — one cache, all apps share
- **Near-cache** (per-app L1 + shared L2) — faster local lookup, complex invalidation
- **Replicated** — all data on all nodes (only небольшие dataset)

Hazelcast / Apache Ignite support near-cache pattern.

---

## 14. Anti-patterns

- **Cache as primary store** — без DB underneath, cache loss = data loss
- **Massive single key** (big key) — blocks event loop, см. `caching-deep-dive/ANTI_PATTERNS.md`
- **No TTL on user-generated keys** — потенциальный memory leak
- **Sync invalidation на критическом пути** — adds latency to writes

---

## Источники

- *System Design Interview Vol. 2* (Alex Xu) — chapter on distributed cache
- [Hello Interview — Distributed Cache](https://www.hellointerview.com/learn/system-design/problem-breakdowns/distributed-cache)
- [Redis Cluster Specification](https://redis.io/docs/management/scaling/)
- [Facebook — Scaling Memcache at Facebook](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf) — classic paper
- [Hazelcast Documentation](https://docs.hazelcast.com/)
- [Apache Ignite Documentation](https://ignite.apache.org/docs/latest/)
- См. также весь модуль [`caching-deep-dive/`](../../../caching-deep-dive/)
