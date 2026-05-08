# Progress Tracker — caching-deep-dive

## Статус модулей

| Модуль | Статус | Дата начала | Дата завершения |
|--------|--------|-------------|-----------------|
| 1. BASICS — иерархия кэшей, locality, метрики | ⬜ не начат | — | — |
| 2. CACHE_PATTERNS — cache-aside / read-through / write-through / write-behind / refresh-ahead | ⬜ не начат | — | — |
| 3. EVICTION_POLICIES — LRU, LFU, FIFO, ARC, TinyLFU, W-TinyLFU, TTL/TTI | ⬜ не начат | — | — |
| 4. CAFFEINE — API, expireAfter*, refreshAfter*, AsyncLoadingCache, RemovalListener, Stats, Weigher | ⬜ не начат | — | — |
| 5. REDIS — структуры, persistence, eviction, Sentinel/Cluster, pub/sub, Lua, pipelining | ⬜ не начат | — | — |
| 6. DISTRIBUTED_CACHING — centralized vs replicated vs near-cache, sharding, consistent hashing | ⬜ не начат | — | — |
| 7. CONSISTENCY — invalidation, double-write, TTL eventual, CDC, versioned keys, stale-while-revalidate | ⬜ не начат | — | — |
| 8. HTTP_CDN_CACHE — Cache-Control, ETag, Vary, CDN purge vs versioned URLs | ⬜ не начат | — | — |
| 9. ANTI_PATTERNS — stampede, penetration, breakdown, avalanche, hot/big keys | ⬜ не начат | — | — |

## Упражнения

| # | Тема | Файл | Статус |
|---|------|------|--------|
| 01 | Cache-aside basic | `Ex01_CacheAsideBasic.kt` | ⬜ |
| 02 | LRU from scratch | `Ex02_LruFromScratch.kt` | ⬜ |
| 03 | LFU from scratch | `Ex03_LfuFromScratch.kt` | ⬜ |
| 04 | TTL cache (lazy + background) | `Ex04_TtlCache.kt` | ⬜ |
| 05 | Caffeine LoadingCache + AsyncLoadingCache | `Ex05_CaffeineLoading.kt` | ⬜ |
| 06 | Stampede protection (single-flight) | `Ex06_StampedeProtection.kt` | ⬜ |
| 07 | Write-through vs write-behind | `Ex07_WriteThroughVsBehind.kt` | ⬜ |
| 08 | Two-level cache (L1 Caffeine + L2) | `Ex08_TwoLevelCache.kt` | ⬜ |
| 09 | HTTP ETag / If-None-Match → 304 | `Ex09_HttpEtag.kt` | ⬜ |
| 10 | Consistent hashing for sharding | `Ex10_ConsistentHashing.kt` | ⬜ |

---
Легенда: ⬜ не начато | 🔄 в процессе | ✅ завершено
