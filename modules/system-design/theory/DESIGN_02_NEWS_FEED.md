# Design Problem: News Feed (Twitter/Instagram)

User postит → followers видят в timeline. Главная задача — **fan-out**: push to followers (write-heavy) vs pull at read (compute on demand). Celebrity problem.

---

## 1. Requirements

### Functional
- Post tweet (text + optional media)
- Follow / unfollow users
- View home timeline (sorted by time / relevance)
- Like, retweet, reply
- (Optional) Search, hashtags, trending

### Non-functional
- **Read-heavy** (~ 1000:1 R/W for Twitter scale)
- **Low latency feed** — p99 < 500ms
- **Eventual consistency OK** — пост может появиться у followers с задержкой 1-10 sec
- **Scalability** — 300M+ DAU, billions of follows

---

## 2. Estimation

```
300M DAU, average 100 reads + 1 post per user per day (10% are posters)

WRITES (posts):
  300M × 1 × 10% = 30M posts/day = ~ 350 writes/sec avg, ~ 700 peak

READS (timeline):
  300M × 100 = 30B reads/day = ~ 350K reads/sec avg, ~ 700K peak

R/W ratio: 1000:1 — heavily read-skewed

STORAGE:
  Posts: 30M × 500B = 15 GB/day = 5.5 TB/year
  10 years: 55 TB raw, × 3 replication = 165 TB
  
FANOUT cost (если push):
  Average user has ~ 200 followers
  Celebrity: 100M followers
  Total fanout writes per second = 700 × 200 (avg) = 140K writes/sec
  Celebrities: 700 × 100M followers = 70B writes (если все стучатся одновременно — невозможно)
```

---

## 3. API

```http
POST /api/v1/tweets
Body: { text, mediaUrls? }
→ 201 { id, createdAt }

GET /api/v1/users/:id/timeline?cursor=...&limit=50
→ 200 { tweets: [...], nextCursor }

POST /api/v1/users/:id/follow
DELETE /api/v1/users/:id/follow

POST /api/v1/tweets/:id/like
POST /api/v1/tweets/:id/retweet
```

---

## 4. Three approaches к timeline generation

### A. Fan-out on Write (Push)

При posting — записать tweet в timeline кэш **каждого follower**.

```
User posts → 
  insert tweet into posts table →
  for each follower:
    LPUSH timeline:{follower_id} tweet_id
```

- ✓ **Read latency низкая** — timeline уже подготовлен
- ✗ **Write амплификация** — celebrity (100M followers) = 100M cache writes
- ✗ Inactive followers — wasted work
- ✗ New follow requires backfill

### B. Fan-out on Read (Pull)

При reading — fetch tweets от всех followed users в реальном времени.

```
User opens timeline →
  followed = SELECT user_id FROM follows WHERE follower = user
  tweets = SELECT * FROM tweets WHERE user_id IN (followed) ORDER BY time DESC LIMIT 50
```

- ✓ **No write amplification**
- ✗ **Read latency высокая** — много joins, sort
- ✗ Worst case: user follows 10K — query massive

### C. Hybrid (Twitter actual approach)

**Push для normal users, pull для celebrities.**

```
User posts:
  if user.followers > 100K (celebrity):
    don't push — followers will pull
  else:
    push to all followers' timelines

User reads timeline:
  base_timeline = pre-computed (pushed)
  + celebrities_tweets = pull recent from celebrities user follows
  merge sort by time
  return
```

- ✓ Лучшее из обоих
- ✗ Сложность реализации
- Threshold tuning

---

## 5. High-level architecture

```
Client
  ↓
LB → API Service pool
       ↓
  ┌────┴────┬─────────┬───────────┐
  ↓         ↓         ↓           ↓
Post     Timeline    User       Media
Service  Service     Service    Service
  ↓         ↓         ↓           ↓
Post DB  Timeline    User DB    Object Store
(sharded Cache       (sharded   (S3 + CDN)
by user) (Redis)     by id)
  ↓
Kafka (fanout events)
  ↓
Fanout Workers
  ↓
Timeline Cache updates
```

---

## 6. Data model

```sql
-- Tweets (sharded by user_id)
CREATE TABLE tweets (
    id BIGINT PRIMARY KEY,  -- Snowflake ID (sortable by time)
    user_id BIGINT,
    text TEXT,
    media_urls TEXT[],
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_user_time ON tweets(user_id, created_at DESC);

-- Follows (sharded by follower)
CREATE TABLE follows (
    follower_id BIGINT,
    followee_id BIGINT,
    created_at TIMESTAMPTZ,
    PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_followee ON follows(followee_id);  -- для reverse lookup

-- Timeline cache (Redis sorted set per user)
ZADD timeline:{user_id} {timestamp} {tweet_id}
ZADD timeline:{user_id} {timestamp} {tweet_id}
-- Keep last ~ 1000 tweets per user (LRU evict older)
```

---

## 7. Fanout workflow

```
1. User posts tweet → API service writes to Post DB
2. API service publishes event к Kafka topic `tweet-posted`
3. Fanout worker consumes event:
   a. Fetch follower list from Follow DB
   b. If celebrity (>100K) → skip fanout (pull at read time)
   c. Else: for each follower → ZADD timeline:{follower} (tweet_id, timestamp)
4. Followers' timelines updated within 1-10 sec
```

**Worker parallelism:** partition Kafka by user_id → many workers process в parallel.

**Failure handling:**
- DLQ для permanent failures
- Retry с exponential backoff
- Idempotent ZADD (повторное добавление same tweet — no-op)

---

## 8. Read path

```
1. API receives GET /timeline
2. Fetch timeline IDs from Redis: ZREVRANGE timeline:{user_id} 0 49
3. Fetch tweets in parallel: MGET posts:{id1} posts:{id2} ...
   if any miss → fetch from DB, cache
4. If user follows celebrities:
   for each celebrity → fetch recent tweets from celebrity_timeline:{celeb_id}
   merge into base timeline, sort by time
5. Return top 50
```

Latency: 10-50ms typical (всё в кэше).

---

## 9. Celebrity problem (deeper)

«Hot users» (Justin Bieber 100M+ followers).

### Why fanout doesn't work

- 100M cache writes на каждый tweet → 700ms-7 sec
- If celebrity posts 10/day → 1B writes/day per celebrity
- Wasted: most followers inactive

### Strategy

- **Celebrity timeline cache** — separate Redis key `celebrity_timeline:{id}` с recent N tweets
- **On read**: union normal timeline + pull celebrities' recent tweets

### Threshold tuning

«Celebrity» threshold:
- Pure number (>100K) — simple
- Activity-adjusted (followers × activity rate)
- Cost-based: fanout cost vs read cost for this user's network

---

## 10. Storage scaling

### Tweets — sharded by user_id

- ~ 5.5 TB/year → manageable single PG primary, нужно sharding по мере роста
- Twitter использует Manhattan (custom NoSQL) в реальности

### Timeline cache — Redis Cluster

- 300M users × ~ 1000 tweet IDs × ~ 8 bytes = ~ 2 TB working set
- Redis Cluster с 50+ shards
- LRU evict cold users — re-compute on demand (lazy)

### Follows — sharded by follower_id

- Forward query «who I follow» — fast (same shard)
- Reverse «who follows me» — needs `idx_followee` and может быть cross-shard scatter
- For celebrities: pre-compute follower count, store separately

---

## 11. Trade-offs / variations

### Ranking vs chronological

Twitter (старый) — chronological. Twitter (новый), Facebook, Instagram — ranked (ML).

For ranked: timeline becomes scoring problem; pre-compute candidate set, re-rank with ML at read time.

### Edits / deletes

Tombstone tweets, propagate via Kafka events, remove from timeline caches.

### Privacy (private accounts)

При post checking follower has approved follow. Adds latency to fanout.

### Threads / replies

Parent_tweet_id reference. Reading thread: recursive fetch (limit depth).

### Media

Upload to S3 directly via presigned URL. CDN-delivered. Tweet table stores URLs.

---

## 12. Aнти-abuse

- Rate limit per user (300 tweets/day)
- Spam detection (ML on text + behaviour)
- Reported content review queue

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — Ch. 11 «Design a News Feed System»
- [Twitter Engineering — How we built our timeline](https://blog.twitter.com/engineering/en_us/topics/infrastructure)
- [Instagram Engineering — Static Profile Sharding](https://instagram-engineering.com/)
- [Hello Interview — FB News Feed](https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-news-feed)
- *Designing Data-Intensive Applications* (Kleppmann) — Ch. 1 (Twitter timeline example)
