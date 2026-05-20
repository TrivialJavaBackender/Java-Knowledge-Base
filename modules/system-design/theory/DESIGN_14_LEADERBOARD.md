# Design Problem: Leaderboard

Real-time scoring и ranking — gaming (top players по score), fitness apps, e-commerce («top sellers»). Главные challenges: high write throughput, tie-breaking, percentile queries, scaling.

---

## 1. Requirements

### Functional
- Update player's score (на каждое action / event)
- Top-K leaderboard (top 100 globally, friends only, per-region)
- Player's rank: «You're #1234 of 10M players»
- Score history (graph над time)

### Non-functional
- **Low latency reads** — top-K < 100 ms
- **Real-time updates** — score change reflected within seconds
- **High write throughput** — millions of score updates per minute
- **Consistency** — eventual OK для display; exact rank когда queried

---

## 2. Estimation

```
10M monthly active players, 1M concurrent during peak
Score updates: 10 events / player / hour = ~ 30K updates/sec average, 100K peak

Reads: 100M leaderboard fetches/day = ~ 1500 reads/sec
Player rank lookups: same scale

Storage:
  10M players × 100 bytes (id, score, metadata) = 1 GB
  Compact enough for in-memory
```

---

## 3. API

```http
POST /api/v1/scores
Body: { playerId, scoreDelta, gameMode? }
→ 204

GET /api/v1/leaderboard/global?limit=100
→ [{ playerId, score, rank }, ...]

GET /api/v1/leaderboard/me
→ { playerId, score, rank: 1234, percentile: 99.9 }

GET /api/v1/leaderboard/friends?userId=X
→ ranked list of user's friends
```

---

## 4. Architecture — Redis Sorted Set (ZSET)

Redis ZSET идеален: ordered set с score per member.

```redis
# Update player's score
ZADD leaderboard 9500 player:123
# (если increment, не replace: ZINCRBY leaderboard +50 player:123)

# Top 100
ZREVRANGE leaderboard 0 99 WITHSCORES

# Player's rank (0-indexed)
ZREVRANK leaderboard player:123

# Players with score in range
ZRANGEBYSCORE leaderboard 1000 2000
```

**Performance:**
- Insert / update / delete: O(log N)
- Range queries: O(log N + M) where M = items returned
- Rank lookup: O(log N)

Single Redis node handles 100K-1M ops/sec.

---

## 5. Scaling beyond single node

Single ZSET capped by memory (10s of GB) и Redis single-threaded.

### Sharded leaderboard

Multiple Redis nodes, each holds subset. Top-K — query all, merge.

```
Shard by player_id hash → which Redis instance has player's score
Each instance has partial leaderboard

For top-K global:
  Query top-K from each shard concurrently
  Merge: collect top-K from each (M shards × K items), sort, return top K
```

Cost: top-K = M × K elements to gather + sort = O(M × K log(MK)).

For K=100, M=10 shards: 1000 items to merge. Trivial.

### Approximate top-K с percentiles

For very large N, exact rank costly. Use approximate:

```
Maintain count-min sketch / quantile data structures
Top-K from approximate scores
Show «approximate rank» (e.g., «top 1%»)
```

Less accurate but constant memory.

---

## 6. Tie-breaking

Players с identical score — how to order?

```
Scores tied:
  - Alice: 9500
  - Bob: 9500
  - Carol: 9500
```

Options:
- **Lexicographic name** — sort by player ID / username (deterministic but arbitrary)
- **Earliest reach** — who got 9500 first (chronological)
- **Composite score** — score × 1B + (max_timestamp - their_timestamp) → secondary sort

Redis ZSET: members с same score sorted lexicographically by default. Customize via composite score encoding.

---

## 7. Time-windowed leaderboards

«Top players this week / today / month»

### Naive: keep all leaderboards separate

```
leaderboard:all-time → ZADD ...
leaderboard:weekly:2024-W42 → ZADD ...
leaderboard:daily:2024-10-15 → ZADD ...
```

Storage: ×N timeframes.

### Smart: per-event tracking + filtering

Score events stored с timestamp. Aggregate on-read для timeframe.

```
events: (player, points, timestamp)
Daily leaderboard: SUM(points) WHERE date = today, GROUP BY player, ORDER BY sum DESC
```

Cassandra / ClickHouse — efficient для aggregation queries.

### Hybrid

Pre-aggregate periodically (every minute) для recent windows; cold ranges queried on-demand.

---

## 8. Friends leaderboard

Show только among player's friends.

```
For user X:
  fetch friends list (User Service): friends = [Y, Z, W]
  for each friend → get score from leaderboard
  sort, return
```

Friends usually small set (< 1000), trivial.

For large friend lists (Facebook gaming) — pre-compute friend leaderboards.

---

## 9. Multi-region

```
Global leaderboard: cross-region, eventually consistent
Per-region leaderboard: low-latency local

Implementation:
  Local Redis per region
  Async replication к global Redis
  «Global rank» queries hit global; «my region rank» — local
```

---

## 10. Anti-cheating

For competitive games — prevent score injection.

- **Score updates only by server-authoritative game state** — client can suggest, server validates
- **Anomaly detection** — score spike, impossible rates
- **Replay verification** — for top scores, request video / replay
- **Anti-cheat services** (Easy Anti-Cheat, BattlEye)

---

## 11. Hot key problem

«Top 10» — every reader fetches the same data. Hot path.

Mitigations:
- **CDN edge cache** — top-K cached с TTL 30 sec (мало stale OK)
- **Application-level cache** (Caffeine LRU) — each app instance caches top-K
- **Replica reads** — multiple Redis replicas, round-robin
- **Pre-computed views** — top-K materialized, updated periodically

---

## 12. Failure modes

| Scenario | Handling |
|----------|----------|
| Redis crash | Replica promoted; recent updates from last 1 sec may be lost (RDB snapshot interval) |
| Score update fails | Retry с idempotency; if persistent → DLQ |
| Bug causes score inflation | Detection: anomaly alerts; rollback last N hours of events |
| Concurrent ZINCRBY race | Redis single-threaded — naturally atomic |

---

## 13. Trade-offs

### Real-time vs batch

- **Real-time** (ZSET on each event) — immediate update, expensive at scale
- **Batch** (aggregate every minute) — cheaper, slight lag

Most games: real-time, leveraging Redis efficiency.

### Exact vs approximate ranks

For N=10M, exact rank requires full scan from top. Approximate (percentile) acceptable.

- Show «#1234» if N < 10K
- Show «Top 5%» если N > 1M

### Persistence

Redis ZSET ephemeral (RAM). On crash, recent updates lost.
- AOF (every-second) — ~1s data loss
- RDB (periodic snapshot) — more loss
- Source of truth in events DB (Kafka log replay if Redis dies)

---

## 14. Data lifecycle

Old scores eventually less interesting. Archive / compress.

```
Daily leaderboards: keep 30 days, archive to S3
Weekly: keep 1 year
Monthly: keep forever
All-time: never archive (it's a single ZSET, small)
```

---

## 15. Real-world examples

- **Discord** — Server boost leaderboards, message counts
- **Strava** — segment leaderboards (timing)
- **Twitch** — top streamers, viewer counts
- **PUBG / Fortnite** — competitive rankings, ELO-based
- **Reddit** — hot posts (similar, time-decayed score)

---

## 16. Variant: ELO-based ranking

Не raw score, а **relative strength** между players.

```
Player A (ELO 1500) vs Player B (ELO 1400):
  A is expected to win 64%.
  If A wins → A gains few points (expected); B loses few.
  If B wins (upset) → B gains many; A loses many.
```

Used: chess, online competitive games, dating apps.

Implementation:
- Same leaderboard structure (ZSET с ELO score)
- Score updates via ELO formula on each match result

---

## Источники

- *System Design Interview Vol. 2* (Alex Xu) — Ch. on Top-K / Leaderboard
- [Redis ZSET Documentation](https://redis.io/commands/?group=sorted-set)
- [Hello Interview — Leaderboard / Top-K](https://www.hellointerview.com/learn/system-design)
- [Discord — Server boost leaderboard](https://discord.com/blog/)
- [Reddit — Hot posts ranking algorithm](https://www.reddit.com/r/programming/comments/h6m2t/reddits_hot_algorithm_explained/)
- ELO rating system — [Wikipedia: Elo rating system](https://en.wikipedia.org/wiki/Elo_rating_system)
