# Canonical Terms

Preferred terminology for this repository. Reuse these terms exactly to ensure consistent retrieval and avoid semantic drift.

## Preferred Terms

- **ARC** — Adaptive Replacement Cache (eviction policy)
- **ABA problem** — ABA problem in CAS-based lock-free algorithms
- **backpressure** — flow control mechanism in reactive/streaming pipelines
- **big key** — oversized Redis key that blocks the event loop
- **cache avalanche** — mass simultaneous expiry causing DB overload
- **cache breakdown** — single hot key expiry causing thundering herd on DB
- **cache hierarchy** — ordered levels: CPU cache → JVM heap → distributed cache → CDN
- **cache penetration** — queries for non-existent keys bypassing cache entirely
- **cache stampede** — concurrent cache miss causing parallel DB reads for same key
- **CAS** — Compare-And-Swap (atomic hardware instruction)
- **CDC** — Change Data Capture
- **consistent hashing** — ring-based key distribution minimizing remap on node changes
- **cooperative cancellation** — coroutine cancellation via isActive/ensureActive checks
- **CPS** — Continuation-Passing Style (coroutine compilation transform)
- **distributed caching** — caching layer shared across multiple service instances
- **double-write problem** — race between cache and DB writes causing inconsistency
- **happens-before** — JMM partial order defining visibility guarantees
- **hit ratio** — fraction of cache lookups served from cache (not DB)
- **hot key** — single cache key receiving disproportionate traffic
- **ISR** — In-Sync Replicas (Kafka replication)
- **JMM** — Java Memory Model
- **near-cache** — local in-process cache in front of a distributed cache
- **N+1 problem** — 1 list query + N item queries due to missing batching
- **read-through** — cache loads missing entries from DB automatically
- **refresh-ahead** — proactive background refresh before TTL expiry
- **rendezvous hashing** — highest-random-weight hashing (alternative to consistent hashing)
- **single-flight** — deduplicate concurrent identical requests (prevents stampede)
- **stale-while-revalidate** — serve stale data while refreshing in background
- **structured concurrency** — parent scope waits for all children; failures propagate
- **supervisorScope** — structured concurrency scope that isolates child failures
- **TTI** — Time-To-Idle (evict after inactivity)
- **TTL** — Time-To-Live (evict after fixed duration)
- **versioned keys** — cache keys with version suffix to enable instant invalidation
- **W-TinyLFU** — Window TinyLFU admission + frequency eviction policy (Caffeine default)
- **write-behind** — async delayed writes to DB after cache update (also: write-back)
- **write-through** — synchronous write to cache and DB together

## Avoid

| Use instead | Do NOT use |
|-------------|------------|
| cache stampede | "thundering herd" (in caching context), "cache miss storm", "dogpile effect" |
| cache breakdown | "hot key expiry problem" |
| distributed caching | "distributed cache system", "distributed cache layer" |
| W-TinyLFU | "Window Tiny LFU", "WindowTinyLFU" |
| consistent hashing | "consistent hash ring" (acceptable in prose, prefer the short form in headings) |
| write-behind | "write-back" (use only as alias, not as primary term) |
| starvation | "thread starvation deadlock" (starvation and deadlock are distinct) |
| thread pool starvation | "thread pool exhaustion" |
| cooperative cancellation | "coroutine cancellation" (too vague) |
| CAS | "compare and swap" (use acronym in headings/indexes) |
| JMM | "Java memory model" (use acronym in headings/indexes) |
| N+1 problem | "N+1 query problem", "N+1 select problem" |
| DataLoader | "data loader", "dataloader" |
| Apollo Federation | "GraphQL federation" (ambiguous) |
