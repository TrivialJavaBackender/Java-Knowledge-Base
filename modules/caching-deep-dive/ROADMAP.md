# caching-deep-dive — Roadmap

## Порядок прохождения

| Приоритет | Модуль | Частота на собесах |
|-----------|--------|--------------------|
| 1 | Cache patterns (cache-aside / read-through / write-*) | ★★★★★ |
| 2 | Eviction policies (LRU/LFU/W-TinyLFU) | ★★★★★ |
| 3 | Caffeine (production JVM cache) | ★★★★★ |
| 4 | Redis (structures, persistence, cluster) | ★★★★★ |
| 5 | Anti-patterns (stampede / penetration / avalanche) | ★★★★★ |
| 6 | Consistency & invalidation | ★★★★ |
| 7 | Distributed caching (sharding, near-cache) | ★★★★ |
| 8 | HTTP / CDN cache (Cache-Control, ETag) | ★★★ |
| 9 | Basics (CPU/page cache, метрики) | ★★ |

---

## Модуль 1: Basics — иерархия и метрики

📖 Теория: [theory/BASICS.md](theory/BASICS.md)

- [ ] CPU L1/L2/L3 caches, cache lines, false sharing (overview)
- [ ] OS page cache
- [ ] JVM heap caches
- [ ] Distributed/edge caches
- [ ] Метрики: hit ratio, miss ratio, latency, throughput, eviction rate

---

## Модуль 2: Cache Patterns

📖 Теория: [theory/CACHE_PATTERNS.md](theory/CACHE_PATTERNS.md)

- [ ] Cache-aside (lazy loading)
- [ ] Read-through
- [ ] Write-through
- [ ] Write-behind / write-back
- [ ] Refresh-ahead

**Упражнения:**
- [ ] [Ex01: Cache-aside basic](src/main/kotlin/exercises/Ex01_CacheAsideBasic.kt)
- [ ] [Ex07: Write-through vs write-behind](src/main/kotlin/exercises/Ex07_WriteThroughVsBehind.kt)

---

## Модуль 3: Eviction Policies

📖 Теория: [theory/EVICTION_POLICIES.md](theory/EVICTION_POLICIES.md)

- [ ] LRU, LFU, FIFO, Random
- [ ] ARC, 2Q
- [ ] TinyLFU, W-TinyLFU (Caffeine)
- [ ] TTL vs TTI, size-based vs weight-based

**Упражнения:**
- [ ] [Ex02: LRU from scratch](src/main/kotlin/exercises/Ex02_LruFromScratch.kt)
- [ ] [Ex03: LFU from scratch](src/main/kotlin/exercises/Ex03_LfuFromScratch.kt)
- [ ] [Ex04: TTL cache](src/main/kotlin/exercises/Ex04_TtlCache.kt)

---

## Модуль 4: Caffeine

📖 Теория: [theory/CAFFEINE.md](theory/CAFFEINE.md)

- [ ] `Caffeine.newBuilder()` API
- [ ] `expireAfterWrite` / `expireAfterAccess` / `expireAfter` (custom)
- [ ] `LoadingCache` vs `AsyncLoadingCache`
- [ ] `refreshAfterWrite` (proactive refresh)
- [ ] `RemovalListener`, statistics, `Weigher`
- [ ] Сравнение с Guava Cache

**Упражнения:**
- [ ] [Ex05: Caffeine loading](src/main/kotlin/exercises/Ex05_CaffeineLoading.kt)

---

## Модуль 5: Redis

📖 Теория: [theory/REDIS.md](theory/REDIS.md)

- [ ] Структуры: string / hash / list / set / zset / stream / bitmap / hyperloglog
- [ ] Persistence: RDB vs AOF, fsync policies
- [ ] Eviction: `maxmemory-policy` (allkeys-lru, volatile-lfu, etc.)
- [ ] Pub/Sub, Streams (consumer groups)
- [ ] Replication, Sentinel, Cluster (16384 slots, resharding, MOVED/ASK)
- [ ] Lua scripts (atomicity), pipelining, transactions (MULTI/EXEC/WATCH)

---

## Модуль 6: Distributed Caching

📖 Теория: [theory/DISTRIBUTED_CACHING.md](theory/DISTRIBUTED_CACHING.md)

- [ ] Centralized (Redis/Memcached) vs replicated (Hazelcast/Infinispan)
- [ ] Near-cache (L1 локальный + L2 удалённый)
- [ ] Sharding: client-side (consistent hashing) vs server-side (Redis Cluster)
- [ ] Кросс-нодовая инвалидация (pub/sub, gossip)

**Упражнения:**
- [ ] [Ex08: Two-level cache](src/main/kotlin/exercises/Ex08_TwoLevelCache.kt)
- [ ] [Ex10: Consistent hashing](src/main/kotlin/exercises/Ex10_ConsistentHashing.kt)

---

## Модуль 7: Consistency

📖 Теория: [theory/CONSISTENCY.md](theory/CONSISTENCY.md)

- [ ] Invalidation strategies: TTL, event-driven, CDC (Debezium)
- [ ] Double-write problem (DB + cache update порядок)
- [ ] Versioned keys (`user:42:v3`)
- [ ] Stale-while-revalidate
- [ ] Eventual consistency и допустимый стэйл

---

## Модуль 8: HTTP / CDN Cache

📖 Теория: [theory/HTTP_CDN_CACHE.md](theory/HTTP_CDN_CACHE.md)

- [ ] `Cache-Control`: max-age, s-maxage, no-cache vs no-store, public/private, immutable
- [ ] `ETag` / `If-None-Match` / weak vs strong
- [ ] `Last-Modified` / `If-Modified-Since`
- [ ] `Vary`
- [ ] CDN: pull vs push, edge invalidation, versioned URLs (`?v=hash`) vs purge
- [ ] 304 negotiation

**Упражнения:**
- [ ] [Ex09: HTTP ETag](src/main/kotlin/exercises/Ex09_HttpEtag.kt)

---

## Модуль 9: Anti-patterns

📖 Теория: [theory/ANTI_PATTERNS.md](theory/ANTI_PATTERNS.md)

- [ ] Cache stampede / thundering herd → single-flight, mutex, early refresh
- [ ] Cache penetration → bloom filter, negative cache
- [ ] Cache breakdown (hot key TTL expiry) → mutex on rebuild
- [ ] Cache avalanche (массовый expiry) → jitter TTL
- [ ] Hot keys / big keys
- [ ] Кэш над кэшом, кэширование изменчивых данных

**Упражнения:**
- [ ] [Ex06: Stampede protection](src/main/kotlin/exercises/Ex06_StampedeProtection.kt)
