# Design Problem: URL Shortener (TinyURL/bit.ly)

Сервис принимает long URL → возвращает short URL (`bit.ly/abc123`). Click на short → redirect на long. Классическая «easy» SD-задача — focus на ID generation, redirect latency, аналитике.

---

## 1. Requirements

### Functional
- POST long URL → short URL (`bit.ly/<6-char-code>`)
- GET short URL → 301/302 redirect к long URL
- (Optional) Custom alias (`bit.ly/my-link`)
- (Optional) Expiration (TTL)
- (Optional) Click analytics

### Non-functional
- **Read-heavy** (10:1 read/write typical)
- **Low latency redirect** — p99 < 100ms
- **High availability** — 99.99% (redirect critical, broken URL ≠ retried)
- **Не предсказуемый код** — нельзя угадать `abc124` зная `abc123` (можно — random or hash, не sequential)
- **Уникальность** — каждый long URL → один short (или allow duplicates, обсудить)

---

## 2. Estimation

```
100M URLs created/year, 10:1 R/W

Writes:  100M / year / 31.5M sec = ~3 writes/sec average
         Peak: 30 writes/sec
Reads:   1B reads/year / 31.5M = ~30 reads/sec average
         Peak: 300 reads/sec
→ Trivial QPS, single server можно

Storage: per URL ~ 500 bytes (long_url + short_code + metadata)
         10 years × 100M × 500B = 500 GB → single PostgreSQL OK
         
Cache: hot 20% URLs × 500B = 10 GB working set → fits Redis node

ID space: base62 (a-zA-Z0-9) 6 chars = 62^6 = 56B URLs (enough for years)
          7 chars = 3.5T (forever)
```

---

## 3. API

```http
POST /api/v1/shorten
Body: { url: "https://example.com/very/long/path", expiresIn?: 86400 }
→ 201 { shortCode: "abc123", shortUrl: "https://bit.ly/abc123" }

GET /:shortCode
→ 301 Location: <long_url>
   (or 302 if analytics tracking — 301 cached by browser, GET wouldn't reach server)

GET /api/v1/links/:shortCode/stats
→ { clicks: 12345, byCountry: {...}, byHour: {...} }
```

---

## 4. High-level architecture

```
Client → CDN (cache for hot redirects?) →
       → LB → API Server pool →
                ├ Cache (Redis) — code → long_url
                ├ ID generator service
                └ DB (PostgreSQL, sharded by short_code) — durable store
       
       → Analytics: async (Kafka → batch processor)
```

---

## 5. ID generation — главный design decision

### Option A: Sequential ID + base62

DB autoincrement → integer → base62 encode.

```
id=1 → "1"
id=62 → "10"
id=1000000 → "4c92"
```

- ✓ Простой, monotonic
- ✗ **Sequential predictable** — анализатор может scrape `abc1, abc2, ...`
- ✗ Single point (DB autoincrement) — bottleneck at scale

### Option B: Random 6 chars

```python
import secrets
shortCode = secrets.token_urlsafe(4)[:6]  # base64 → 6 chars
```

- ✓ Unpredictable
- ✗ **Collisions** — birthday paradox: 62^6 = 56B; при 10M existing URLs ~ 1 in 5.6M shortened → collision occasionally → retry
- Mitigation: insert with `ON CONFLICT DO NOTHING`, retry on conflict

### Option C: Hash long URL

`shortCode = base62(MD5(long_url))[:6]`

- ✓ Deduplication free (same URL → same short)
- ✗ Collisions still possible; need handling
- ✗ User cannot have multiple shorts for same long URL (often desired для analytics)

### Option D: Key Generation Service (KGS)

Pre-generate batch of unique codes, store в DB. App grabs from pool.

```
KGS pool: 1M pre-generated unused codes
App: GET /kgs/next-code → "abc123" (marked used)
```

- ✓ No collisions при runtime
- ✓ No predictability
- ✓ Scales: multiple KGS instances, each owns range
- ✗ Extra service to operate

### Option E: Snowflake-style ID

64-bit ID = `timestamp (41 bits) | machine_id (10 bits) | sequence (12 bits)`. Encode base62.

- ✓ Distributed, no central coordinator
- ✓ Sortable by time
- ✗ Predictable (timestamp embedded)

**Recommendation:** KGS for production; random 6-7 chars with retry for simpler scale.

---

## 6. Data model

```sql
CREATE TABLE urls (
    short_code   VARCHAR(8) PRIMARY KEY,
    long_url     TEXT NOT NULL,
    user_id      BIGINT,
    created_at   TIMESTAMPTZ DEFAULT now(),
    expires_at   TIMESTAMPTZ,
    click_count  BIGINT DEFAULT 0  -- denormalized; or separate analytics table
);

CREATE INDEX idx_expires ON urls(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_user ON urls(user_id);
```

**Sharding:** by `short_code` hash. Since reads/writes are key-based (short_code), trivial to shard.

---

## 7. Redirect path — critical

Hot path: `GET /:shortCode → redirect`. Latency budget < 100 ms.

```
1. App receives request
2. Check Redis cache (1 ms): if hit → 301
3. If miss → query DB (1-5 ms): cache result, → 301
4. Async: write analytics event to Kafka
5. Return 301 with `Location` header
```

**Caching strategy:**
- LRU cache, TTL = 1 hour (or longer для immutable short codes)
- Hot set (20%) → 95%+ hit ratio
- Cache stampede protection: single-flight on cache miss

**CDN consideration:** возможно cache `301` responses at edge для viral links. Trade-off: stale links if updated/deleted; usually OK since short codes immutable.

---

## 8. Analytics

```
On click: emit event to Kafka topic
  { shortCode, timestamp, ip, userAgent, referer, country }

Async consumer:
  Batch process every 1 min → aggregate counts per (shortCode, hour, country)
  Store в analytics DB (ClickHouse, BigQuery) — columnar для aggregations
```

Counter denormalized в `urls.click_count` — eventually consistent (updated every N seconds).

---

## 9. Scale considerations

### 10× scale (1B URLs, 10K read QPS)

- More cache nodes (Redis Cluster)
- DB sharding по short_code
- Multiple analytics consumers

### 100× scale (100B URLs)

- Geo-replicated DB (multi-region)
- Edge cache for viral links (CDN)

### Hot link / celebrity content

«bit.ly/xyz» виралится → 1M req/sec на one shortCode.

- CDN absorbs most
- Cache replication (hot keys на multiple nodes)
- Rate limit per-user (но redirect должен работать для всех — only limit creation/abuse)

---

## 10. Trade-offs

### 301 vs 302

- **301 Permanent Redirect** — browser cached, fewer hits on our server, **no analytics на repeat visits**
- **302 Temporary Redirect** — каждый visit hits us, **full analytics**

Choose 302 if analytics matter (default bit.ly), 301 if pure redirect-as-service.

### Custom alias

```
POST /api/v1/shorten
Body: { url: "...", alias: "my-link" }
→ "bit.ly/my-link"

If alias exists → 409 Conflict
```

DB constraint: alias is UNIQUE. Pre-check or rely on insert error.

### Expiration / soft delete

`expires_at` column; cleanup batch job. Or `is_active` flag (rare to truly delete).

---

## 11. Anti-abuse

- **Rate limit creation** — 100 URLs / hour per IP
- **URL validation** — reject malformed, internal IPs (SSRF), known bad domains (phishing list)
- **Spam links** — periodic re-check destinations, block redirect if URL becomes malicious

---

## Источники / references

- *System Design Interview Vol. 1* (Alex Xu) — Ch. 8 «Design a URL Shortener»
- [Hello Interview — URL Shortener](https://www.hellointerview.com/learn/system-design/problem-breakdowns/url-shortener)
- [bit.ly Architecture Blog (legacy)](https://word.bitly.com/post/8662250532/dablooms-an-open-source-scalable-counting-bloom-filter) — discusses scaling decisions
