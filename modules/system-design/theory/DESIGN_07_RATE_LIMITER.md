# Design Problem: Distributed Rate Limiter

Контролировать количество запросов per user / API key. Используется в API Gateway, защита от abuse / DDoS, billing tier enforcement.

> **Scope**: design-уровень. Concurrent implementation в коде (Token Bucket в Java) — см. [`concurrency/applied/ratelimiter`](../../../concurrency/src/main/java/applied/ratelimiter).

---

## 1. Requirements

### Functional
- Limit requests per user / IP / API key / endpoint
- Limit на разных windows (per second / minute / hour / day)
- Configurable per tier (free / pro / enterprise)
- Return 429 Too Many Requests + Retry-After header

### Non-functional
- **Low latency** — < 1 ms decision (every request passes through)
- **Highly available** — failure не блокирует legitimate traffic
- **Accurate** — близко к configured limit, но not overly strict
- **Distributed** — works across N instances

---

## 2. Estimation

```
API service: 100K RPS peak across cluster
N application instances: 50

Per-instance rate limiter must:
  - Decide allow/deny < 1 ms
  - Coordinate state across instances
  - Survive Redis temporary outage
```

---

## 3. Алгоритмы

### Token Bucket

Buсket size = burst. Refill rate = sustainable rate.

```
bucket.tokens = capacity
on request:
  refill: tokens = min(capacity, tokens + (now - last_refill) × rate)
  if tokens >= 1: tokens--, allow
  else: deny
```

- ✓ Allows bursts up to capacity
- ✓ Smooth average rate
- Used by: AWS API Gateway, Stripe API

### Leaky Bucket

Requests enter a queue, processed at fixed rate. Overflow → drop.

- ✓ Smooth output rate
- ✗ Adds latency (queueing)
- Used: traffic shaping in network gear

### Fixed Window Counter

```
key = (user_id, window_start)
counter = INCR key
if counter > limit: deny
EXPIRE key (window_size)
```

- ✓ Simple, O(1) memory per key
- ✗ **Edge boundary problem**: 2× burst at window boundaries (e.g., 100 reqs at 11:59:59 + 100 at 12:00:01)

### Sliding Window Log

Store timestamps of all recent requests.

```
ZADD requests:user_123 (timestamp) (request_id)
ZREMRANGEBYSCORE requests:user_123 0 (now - window_size)
count = ZCARD requests:user_123
if count > limit: deny
```

- ✓ Accurate, no boundary problem
- ✗ Memory О(N) per user — scaling concern

### Sliding Window Counter (рекомендация)

Combine fixed window + previous window weighted.

```
current_count = count_current_window + (count_previous_window × overlap_ratio)
overlap_ratio = (window_size - time_in_current_window) / window_size

If current_count > limit: deny
```

- ✓ Approximate sliding window, O(2) entries per key
- ✓ No boundary problem
- ✓ Memory efficient

---

## 4. Distributed implementation (Redis + Lua)

Atomic check-and-update via Lua script — eliminates race between INCR and EXPIRE.

```lua
-- Sliding window log
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count < limit then
    redis.call('ZADD', key, now, now)  -- score and member both = now
    redis.call('EXPIRE', key, window)
    return 1  -- allowed
else
    return 0  -- denied
end
```

Application:
```python
allowed = redis.eval(script, keys=[f"rl:{user_id}"], args=[60, 100, time.time()])
if not allowed:
    return 429
```

---

## 5. Architecture

```
Client → API Gateway → Application instances
                        ↓
                   Redis Cluster (rate limit state)

OR (modern):
                   Envoy / Istio sidecar
                        ↓ (out-of-band)
                   Ratelimit Service (gRPC)
                        ↓
                   Redis
```

---

## 6. Multiple limit tiers

User has multiple limits simultaneously:
- 100/sec
- 5000/min
- 100000/hour
- 1M/day

Check ALL limits — deny if any exceeded. Multiple keys (e.g., `rl:second:user123`, `rl:minute:user123`).

---

## 7. Tier-based limits

Different users have different limits based на subscription:

```yaml
free:
  per_sec: 10
  per_day: 1000
pro:
  per_sec: 100
  per_day: 100000
enterprise:
  per_sec: 1000
  per_day: unlimited
```

Fetch tier from user DB / cache, apply appropriate limit.

---

## 8. Multi-region

Each region has own Redis cluster. State per region не replicated (would add latency + complexity).

```
US user в US region → US Redis
EU user в EU region → EU Redis
Each region enforces its own limits
```

Issue: user-aware regions могут not know global usage. Acceptable trade-off for low latency.

For global limits (rare): central Redis cluster or aggregator service (additional latency cost).

---

## 9. Graceful degradation

**Redis down** → rate limiter cannot decide. Options:
1. **Fail open** (allow all) — better UX, but vulnerable к burst attacks
2. **Fail closed** (deny all) — safe but breaks legitimate users
3. **Local cache fallback** — each instance has approximate local counter

**Best practice:** Fail open для public API (better UX), fail closed для internal sensitive endpoints (e.g., login).

---

## 10. Response headers

Best practice: tell client about limit and remaining budget.

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 73
X-RateLimit-Reset: 1700000000   # Unix timestamp when budget resets

OR (when denied):
HTTP/1.1 429 Too Many Requests
Retry-After: 17                  # seconds
```

Stripe и many modern APIs follow this.

---

## 11. Trade-offs

### Accuracy vs cost

- Sliding window log — accurate, O(N) memory
- Sliding window counter — approximate, O(2)
- Fixed window — fastest, edge problem

Choose based on tolerance for inaccuracy и memory.

### Per-instance vs distributed

- **Per-instance** — fast (in-memory), но each instance enforces independently → effective limit = N × instance_limit
- **Distributed (Redis)** — accurate global limit, but every request += 1 Redis call

Hybrid: in-memory token bucket synced with Redis periodically.

### Client-side caching

For known limits, client can self-regulate. But cannot trust untrusted clients — server must enforce.

---

## 12. Anti-abuse

- IP-based limiting + user-based — IP может shared (corporate NAT)
- Adaptive limits — detect anomaly, tighten
- Geographic limits — block / throttle by country
- WAF integration — Cloudflare / AWS WAF rate limit rules

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — Ch. 4 «Design a Rate Limiter»
- [Stripe — Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters)
- [Cloudflare — How to build a rate limiter](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)
- [Hello Interview — Distributed Rate Limiter](https://www.hellointerview.com/learn/system-design/problem-breakdowns/rate-limiter)
- [Envoy Rate Limit Service](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/rate_limit_filter)
- [GitHub — RateLimitJ implementation patterns](https://github.com/mokies/ratelimitj)
