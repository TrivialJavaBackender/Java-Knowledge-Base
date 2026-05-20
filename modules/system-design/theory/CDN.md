# CDN (Content Delivery Network)

CDN — географически распределённая сеть кэш-серверов (PoP — Point of Presence), приближающая контент к пользователю. Snowflake-style: один origin → 200+ edge locations → конечный пользователь.

> **Scope**: модели работы CDN, push vs pull, signed URLs, providers. HTTP-уровень кэширования (Cache-Control, ETag, Vary) — см. [`caching-deep-dive/HTTP_CDN_CACHE.md`](../../caching-deep-dive/theory/HTTP_CDN_CACHE.md).

---

## Зачем CDN

Три причины:

1. **Latency** — пользователь в Сингапуре получает контент с PoP в Сингапуре (~10 ms RTT), не из US-East (~200 ms RTT)
2. **Bandwidth offload** — origin (твой backend) не отдаёт каждый GET; >90% запросов отвечает CDN edge
3. **DDoS mitigation** — атака распределяется по 200 PoP'ам, нагрузка на origin минимальна

Типичная экономия: 80-95% requests handled at edge → cost reduction × 5-10 на egress + меньше application servers.

---

## Push vs Pull

### Pull CDN (lazy, по требованию)

```
User → CDN edge: GET /image.png
CDN edge: cache miss → fetch from origin
        ← image.png
CDN: cache it (по Cache-Control max-age)
CDN ← User: image.png

Следующий пользователь в той же регионе:
User → CDN edge: GET /image.png
CDN: cache hit → серверим из кэша (без origin)
```

- ✓ Просто: origin не делает ничего особенного, любой ассет на любом URL автоматически кэшируется
- ✓ Подходит для динамичных каталогов
- ✗ Первый запрос на каждом PoP — cold miss (тормозит для глобального запуска)

**Используют:** Cloudflare, AWS CloudFront, Fastly, Akamai — практически все современные CDN по умолчанию pull-based.

### Push CDN (proactive)

Контент **загружается** на CDN заранее (API/upload), origin не имеет копии (или копия только для backup).

- ✓ Контроль над тем, что закэшировано
- ✓ Нет cold miss
- ✗ Нужно явно публиковать каждый ассет
- Используется для: big video files (CDN — основное хранилище), low-traffic huge assets

**Используют:** legacy CDN (KeyCDN, Bunny CDN push tier), некоторые object storage с CDN привязкой.

---

## Cache hierarchy внутри CDN

Современные CDN имеют **несколько уровней**:

```
User → Edge PoP (closest) → Regional shield/parent → Origin shield → Origin
       (200+ locations)    (~10 regions)            (1 per provider)
```

- **Edge PoP** — closest to user, обычно tiny cache (~50 GB SSD per node)
- **Regional shield** — больше, агрегирует запросы от edge: меньше bandwidth к origin
- **Origin shield** — single chokepoint к origin, дополнительно агрегирует

Cloudflare: edge + Tiered Cache. AWS CloudFront: edge + regional edge cache. Akamai: edge + parent.

**Benefit:** если 50 edge PoP'ов имели cache miss одновременно — все идут к regional shield, который имеет одну копию; к origin доходит один запрос.

---

## Cache key и Vary

Что определяет «уникальный ресурс» в CDN?

```
Default cache key: scheme + host + path + query string
  https://example.com/img.png?v=1   != https://example.com/img.png?v=2
```

**Vary header** говорит «ответ зависит от этих request headers»:

```
Vary: Accept-Encoding    → разные cache entries для gzip / br / identity
Vary: Accept-Language    → разные для en / ru / ...
Vary: Cookie             → ⚠ часто disable CDN caching (т.к. cookie уникальна)
```

**Best practice:** для CDN кешируемых ресурсов **не использовать cookie/Auth headers** в качестве варианта; для personalised content — не кэшировать на CDN.

---

## Cache invalidation

Когда контент изменился — нужно убрать старую версию из CDN. Два подхода:

### Purge (instant invalidation)

API-запрос к CDN: «выкини `/img.png` из кэша». Идёт ко всем PoP'ам.

- ✓ Мгновенный (~30 секунд на global propagation)
- ✗ Платный у multidata-providers (Cloudflare unlimited, AWS — за money)
- Поддерживают: purge by URL, by tag (если поставили `Cache-Tag` header), purge all

### Versioned URLs (recommended)

Используй версионированный URL — новая версия = новый URL.

```
old: <script src="/app.js">
new: <script src="/app.v2.js"> или /app.js?v=2 или /app.abc123.js (content hash)
```

- ✓ Не нужен purge — старая версия живёт в CDN до TTL, новая идёт через свежий URL
- ✓ Cache forever (`Cache-Control: immutable, max-age=31536000`)
- ✓ Atomicity — атомарный rollback (просто переключить ссылки)

**Pattern:** static assets — hashed filenames через webpack/vite + immutable cache. HTML — короткий TTL (`Cache-Control: no-cache` или max-age=60).

---

## Signed URLs / Tokens

Для приватного контента (платные видео, user uploads) — CDN не должен отдавать каждому. **Signed URL** — URL с временной подписью.

```
Origin генерирует:
  /video/123?expires=1234567890&signature=HMAC(secret, "/video/123?expires=...")

CDN при запросе:
  1. Проверить expires > now
  2. Проверить signature == HMAC(secret, ...)
  → если ОК — серверить (cache hit/miss), иначе 403
```

Реализации: AWS CloudFront Signed URLs / Signed Cookies, Cloudflare Signed Exchanges, Fastly token authentication.

---

## Push patterns: image / video optimization

Современные CDN умеют **трансформировать** контент на лету:

### Image optimization

```
GET /image.png?w=300&format=webp&quality=80
```

CDN на лету: resize, convert (PNG → WebP/AVIF), lossy quality, blur, watermark. Кэшируется по полному URL.

**Providers:** Cloudflare Image Resizing/Polish, AWS CloudFront + Lambda@Edge, imgix, Cloudinary.

### Video streaming

CDN отдаёт **HLS** (HTTP Live Streaming) или **MPEG-DASH** — видео разбивается на 2-10 секундные chunks разного качества.

```
manifest.m3u8 (плейлист)
  → 1080p/segment_001.ts ... segment_N.ts
  → 720p/segment_001.ts ...
  → 480p/segment_001.ts ...
```

Player выбирает качество по доступному bandwidth. CDN cache отдаёт chunks. Аналогично — Netflix, YouTube, Twitch.

---

## Multi-CDN

**Сценарий:** один CDN может упасть (Dyn 2016, Fastly 2021 — пол-интернета лежало). Решение — multi-CDN: 2+ провайдера, маршрутизация через DNS или smart resolver.

```
DNS Geo-routing:
  US → CloudFront (primary), Fastly (fallback)
  EU → Cloudflare (primary), CloudFront (fallback)

Or smart load balancer (NS1, Cedexis):
  выбирает CDN по real-time RUM data (real user monitoring)
```

Trade-off: 2× cost, сложнее purge invalidation (нужно вызывать API у каждого), но zero downtime при падении одного CDN.

---

## Real-world incidents

- **Fastly outage (2021-06-08)** — config bug в Fastly → 1 час недоступны Amazon, Reddit, Twitch, NYTimes, gov.uk. Урок: даже tier-1 CDN падают.
- **AWS CloudFront (2021-12-15)** — частичный outage, latency spike. Urging multi-CDN strategy для critical services.
- **Cloudflare Quicksilver (2020-07-17)** — config push без staged rollout → 27 мин global outage.

---

## CDN providers — short comparison

| Provider | Сильные стороны | Слабые места |
|----------|----------------|---------------|
| **Cloudflare** | Free tier, large PoP network, edge compute (Workers), DDoS, R2 storage | Сложный pricing для enterprise |
| **AWS CloudFront** | AWS integration, Lambda@Edge, signed URLs out of box | Меньше PoPs чем Cloudflare, дороже |
| **Fastly** | VCL для гибкой логики на edge, instant purge, фокус на news/media | Меньше PoPs, дороже на старте |
| **Akamai** | Enterprise-grade, самая большая сеть, корпоративные фичи | Дорого, complex setup |
| **Bunny CDN** | Самый дешёвый, хороший perf | Меньше features |

---

## CDN в SD-интервью

- «Как ускорить статические assets?» — CDN с long TTL + versioned URLs
- «Как защититься от DDoS?» — CDN + WAF (Cloudflare, AWS Shield)
- «Как стримить видео при scale?» — HLS/DASH chunks через CDN
- «Как сделать global low-latency для API?» — edge compute (Workers, Lambda@Edge) — но не подходит для stateful (БД остаётся в одном регионе)
- «Multi-CDN strategy?» — DNS geo-routing с health checks, RUM-based switching

---

## Источники

- [HTTP caching — Cache-Control, ETag, Vary — see caching-deep-dive/HTTP_CDN_CACHE.md](../../caching-deep-dive/theory/HTTP_CDN_CACHE.md)
- [Cloudflare Learning Center — What is a CDN?](https://www.cloudflare.com/learning/cdn/what-is-a-cdn/)
- [AWS CloudFront Documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html)
- [Fastly: How CDNs Work](https://www.fastly.com/learning/what-is-a-cdn)
- [RFC 8216 — HTTP Live Streaming (HLS)](https://datatracker.ietf.org/doc/html/rfc8216)
- [Fastly outage postmortem (2021-06-08)](https://www.fastly.com/blog/summary-of-june-8-outage)
