# Caching Deep Dive — Semantic Summary

## Core Model
- Multi-level cache hierarchy: CPU cache → JVM heap (Caffeine) → distributed (Redis) → CDN
- Primary metrics: hit ratio, latency per level, eviction rate
- Cache exists to reduce latency and DB load — not to be a source of truth

## Key Concepts
- **Patterns**: cache-aside (lazy load), read-through (auto-load), write-through (sync write), write-behind (async write), refresh-ahead (proactive)
- **Eviction**: LRU (recency), LFU (frequency), W-TinyLFU (admission filter + frequency = Caffeine default), ARC (adaptive), TTL/TTI
- **Caffeine**: LoadingCache (sync), AsyncLoadingCache (async), expireAfterWrite vs refreshAfterWrite, Weigher, RemovalListener, Stats
- **Redis**: string/hash/list/set/zset/stream; RDB+AOF persistence; Sentinel (HA) vs Cluster (sharding); Lua atomicity; pipelining
- **Distributed**: centralized vs replicated vs near-cache; consistent hashing minimizes remap on topology change
- **HTTP/CDN**: Cache-Control directives, ETag/If-None-Match → 304, Vary, CDN pull vs push, purge vs versioned URLs
- **Consistency**: double-write problem (4 orderings, only 2 safe); TTL = eventual; CDC for event-driven invalidation; versioned keys for instant invalidation

## Important Invariants
- Invalidate cache AFTER successful DB write (not before) to avoid serving stale data on DB failure
- Cache stampede requires single-flight: `computeIfAbsent` or `LoadingCache` deduplicates concurrent loads
- `refreshAfterWrite` serves stale while refreshing; `expireAfterWrite` blocks on miss — different semantics
- ETag response must always include ETag header; 304 must not include body
- Consistent hashing: only K/N keys remap when adding/removing a node (vs K keys for modular hashing)
- Redis Lua script = atomic (single-threaded event loop); no blocking calls inside Lua

## Common Pitfalls
- Double-write order matters: wrong order causes permanent inconsistency window
- Hot key = single shard saturation; solution: local replica reads or key sharding
- Big key blocks Redis event loop (e.g., HGETALL on 10K-field hash)
- Cache over cache (Caffeine in front of Redis in front of DB without clear roles) adds latency and complexity
- Cache penetration: null results bypass cache; solution: cache null sentinel or Bloom filter
- Cache avalanche: staggered TTL jitter prevents mass simultaneous expiry

## Related Modules
- `spring-frameworks` — Hibernate L1/L2/Query cache (Spring Data JPA context)
- `infrastructure` — Redis operations, monitoring, eviction policy tuning
- `system-design` — consistency models, CDC event streaming, distributed lock patterns
