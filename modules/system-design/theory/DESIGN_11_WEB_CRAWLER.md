# Design Problem: Web Crawler

Periodically download web pages для индексации (search engine), monitoring (price tracking), archival (Wayback Machine). Главные challenges: scale, politeness (don't DDoS sites), dedup, content extraction.

---

## 1. Requirements

### Functional
- Start с seed URLs
- Crawl pages, extract text + outgoing links
- Follow links (BFS / DFS)
- Re-crawl pages periodically (freshness)
- Respect robots.txt
- Store crawled content для downstream processing

### Non-functional
- **Politeness** — не overwhelm target servers (rate limit per domain)
- **Scale** — billions of pages
- **Freshness** — recent pages re-crawled within days
- **Robust** — handle errors, dynamic content, redirects

---

## 2. Estimation

```
Web: ~ 50B unique pages (rough estimate)
Re-crawl: top 1B daily, rest weekly/monthly
  → ~ 10K-100K downloads/sec sustained

Storage per page (HTML + extracted text):
  Avg 100 KB raw, 20 KB extracted text
  10B pages × 100 KB = 1 PB raw + 200 TB extracted

Bandwidth: 10K req/sec × 100 KB = 1 GB/sec ingress
```

---

## 3. Architecture

```
Seed URLs → 
URL Frontier (priority queue per domain)
  ↓
URL Selector (политика, robots.txt) →
DNS Resolver (cached) →
HTTP Fetcher (pool of crawlers, async I/O)
  ↓
Response →
Content Parser (extract text + links)
  ↓
  ├── New URLs → URL Frontier (back to queue)
  ├── Extracted content → Content Store (S3 / HDFS)
  ├── Dedup check → Bloom Filter / Content Hash DB
  └── Metadata DB (PostgreSQL / Cassandra)
       
Downstream:
  - Indexer → Inverted Index (Elasticsearch)
  - Analytics
```

---

## 4. URL Frontier

Priority queue для предстоящих URL.

### Politeness — main constraint

Не более 1-2 connections / requests per domain per second.

```
Frontier:
  Per-domain queue: URLs для example.com all in one sub-queue
  Politeness scheduler: at most N concurrent crawlers per domain
  Across all domains: parallel
```

Implementation:
- Redis sorted set per domain: `domain:example.com` with score=enqueue_time
- N crawler workers, each gets URL from a different domain queue (round-robin)
- Sleep / hold за политики delay (e.g., min 1 sec between same-domain requests)

### Priority

Not all URLs equal:
- Popular sites — high priority (refresh often)
- Discovered new URLs — medium
- Long-tail / low-PR — low

Multi-level priority queue: tiers for priorities. Crawl higher tiers more frequently.

### Dedup queue

URL уже crawled / in queue? Bloom Filter (fast «maybe yes» check) + DB lookup для confirmed.

```python
if not bloom.contains(url):
    bloom.add(url)
    enqueue(url)
elif not db.exists(url):  # bloom false positive check
    bloom.add(url)
    enqueue(url)
# else: skip duplicate
```

---

## 5. DNS Resolver

DNS for each URL adds latency. Cache:

```
DNS cache:
  domain → (ip, ttl)
  Hit: skip DNS query
  Miss: resolve, cache for TTL

Local DNS server (bind, unbound) doing recursion + caching.
```

Without cache: each crawl = DNS query = 10-100 ms overhead.

---

## 6. HTTP Fetcher

Async I/O (Java NIO, Go goroutines, Python asyncio) для massive concurrency на single machine.

```python
# Pseudo-async
async def crawl(url):
    response = await http.get(url, timeout=10, follow_redirects=True)
    if response.status == 200:
        return response.text
    elif response.status in (301, 302):
        new_url = response.headers['Location']
        return await crawl(new_url)
    elif response.status == 429:  # Rate limited
        sleep_and_retry(url)
    elif response.status >= 500:
        retry_with_backoff(url)
    else:
        log_failure(url, response.status)
```

**Connection pool** — reuse TCP/TLS connections.

**Per-host concurrency limit** — max 5 connections / host.

---

## 7. Robots.txt

Каждый сайт может specify crawler rules:

```
example.com/robots.txt:
User-agent: *
Disallow: /admin/
Disallow: /private/
Crawl-delay: 10
```

```python
robots = fetch(f"{domain}/robots.txt")
for url in domain_urls:
    if not robots.allowed(crawler_user_agent, url.path):
        skip(url)
    sleep(robots.crawl_delay or 1)
```

Cache robots.txt per domain (TTL 24 hours).

---

## 8. Content extraction

### Parse HTML

Extract:
- Title, meta tags
- Body text (strip HTML)
- Outgoing links (`<a href>`)
- Canonical URL (`<link rel="canonical">`)

Libraries: BeautifulSoup, jsoup (Java), readability.js.

### Detect language

For multi-lingual indexing — language detect (cld3, langdetect).

### Detect duplicates

Same content на разных URLs:
- Content hash (SHA-256) — exact match
- SimHash / MinHash — near-duplicate detection (small differences)

```
content_hash = SHA256(extracted_text)
if exists в Bloom + DB → mark as duplicate of canonical URL
else → store
```

### Extract structured data

- JSON-LD, microdata, Open Graph
- Product info, prices, reviews (semantic)

---

## 9. Storage

### Raw HTML

S3 / HDFS, partitioned by date/domain.

```
s3://crawler-raw/2024/01/15/example.com/<url-hash>.html.gz
```

Compressed gzip — text compresses 5-10×.

### Extracted text

Smaller, queried more often. Cassandra или Parquet on S3.

### Metadata

PostgreSQL — URL, status, crawl_at, content_hash, refs.

```sql
CREATE TABLE pages (
    url TEXT PRIMARY KEY,
    domain TEXT,
    last_crawled_at TIMESTAMPTZ,
    status INT,
    content_hash CHAR(64),
    raw_storage_path TEXT
);
CREATE INDEX idx_domain ON pages(domain);
CREATE INDEX idx_last_crawled ON pages(last_crawled_at);
```

---

## 10. Re-crawl strategy

URLs re-crawled с разной частотой based on:
- **Update frequency** (news site every hour vs static blog monthly)
- **PageRank / importance** — popular pages more often
- **Last-modified header** — site hint

```
re_crawl_interval = base_interval × importance_factor × update_frequency_factor

Top 1M pages → daily
Next 100M → weekly  
Rest → monthly
```

Scheduling: each crawled page enqueued back с future timestamp.

---

## 11. Distributed crawlers

Single machine — 10K-100K req/sec max (network bound). For 1B+ pages/day → multiple machines.

### Sharding strategy

Partition by **domain hash** — все URLs одного domain crawled by single worker (preserves politeness).

```
crawler_id = hash(domain) % N_crawlers
```

URL Frontier itself distributed — Redis Cluster shards by domain.

### Coordination

- New URLs found by crawler A → publish к queue (Kafka)
- Other crawlers consume their domain partitions

---

## 12. Failure modes

| Scenario | Handling |
|----------|----------|
| Crawler crashes | URLs остались в queue, другой worker picks up |
| Site returns 503 | Backoff, retry later (don't hammer) |
| Infinite loop (calendar spider trap) | Max depth per domain, dup URL detection |
| Bad SSL certs | Skip or accept based on policy |
| Slow site | Timeout (10 sec), retry с backoff |
| Robots.txt unavailable | Default to «allowed everything»? Or «default deny»? (policy decision) |

---

## 13. Anti-patterns / Anti-detection

Some sites block crawlers actively:
- **User-Agent identification** — declare yourself (Googlebot/2.1; etc.)
- **Rate limiting** — respect 429
- **JavaScript rendering** — modern sites SPA, need headless browser (Puppeteer, Playwright)
- **CAPTCHA** — usually skip those pages
- **Honeypot links** — hidden links, follow → marked as bot

---

## 14. Trade-offs

### BFS vs DFS

- **BFS** (default) — explores by distance from seed, balanced
- **DFS** — deep into one branch, можно stuck в large site

Most crawlers BFS-ish (priority queue overrides).

### Politeness vs throughput

Strict politeness (1 req/sec/domain) — many small sites slow, fewer big sites bottleneck.
Aggressive — risk IP bans, harm sites.

Tune per domain based on response times и `Crawl-delay`.

### Real-time vs batch

Search engines: real-time (continuous). 
Archival (Wayback): batch (full crawl periodically).

---

## 15. Real-world

- **Googlebot** — most advanced crawler, billions of pages indexed
- **Bingbot, Yandex, Baidu** — similar
- **Internet Archive (Wayback Machine)** — archival
- **Common Crawl** — open crawl dumps, monthly, free dataset

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — Ch. 9 «Design a Web Crawler»
- [donnemartin/system-design-primer — Web Crawler](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/web_crawler/README.md)
- [Common Crawl Documentation](https://commoncrawl.org/the-data/)
- [Apache Nutch Documentation](https://nutch.apache.org/) — open-source crawler
- [Heritrix (Internet Archive crawler)](https://github.com/internetarchive/heritrix3)
- *Web Crawler/Search Engine* (Bing/Yahoo papers historically)
