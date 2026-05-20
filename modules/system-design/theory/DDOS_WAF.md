# DDoS Protection и WAF

Защита от атак: DDoS (исчерпание ресурсов), application-level (SQLi, XSS, SSRF), credential attacks. Multi-layered defense — нет single tool для всего.

> **Scope**: edge-уровень защиты (rate limiting, WAF, DDoS mitigation). Application-level auth (JWT/OAuth) — [`identity_providers.md`](identity_providers.md). Secrets ops — [`infrastructure/SECRETS.md`](../../infrastructure/theory/SECRETS.md). Security testing (SAST/DAST/pentest) — [`software-engineering/TESTING.md`](../../software-engineering/theory/TESTING.md).

---

## Виды DDoS

### Volumetric (Layer 3-4)

Заваливают bandwidth / network packets.

- **UDP flood** — миллионы UDP packets
- **SYN flood** — half-open TCP connections, server tracks state
- **DNS amplification** — small request → huge response (amplification ratio 50-200×)
- **NTP amplification** — similar
- **Memcached amplification** — exposed memcached gave 1.7 TB/s attack (GitHub 2018)

**Размер:** 1-Tbps+ attacks случались (2016 Dyn, 2018 GitHub).

**Защита:** absorption at edge (Cloudflare/Akamai/AWS Shield — capacity 100+ Tbps total network).

### Protocol (Layer 4)

Exploit protocol implementation:
- **Slowloris** — slow HTTP requests, keep connections open
- **TCP RST flood**
- **Smurf attack** — ICMP с spoofed source

**Защита:** rate limit per IP, drop bad packets.

### Application (Layer 7)

«Legitimate-looking» requests, но overwhelming volume или asymmetric cost.

- **HTTP flood** — миллион GET / sec
- **Cache busting** — different query strings, bypass CDN
- **Login brute force** — credential stuffing
- **API enumeration** — discover endpoints

**Сложнее обнаружить:** выглядит как real traffic, smaller volume может быть достаточно (если backend slow на каждый request).

**Защита:** rate limit per user/IP, CAPTCHA, behavioral analysis, WAF.

---

## DDoS Mitigation

### Edge absorption (CDN)

Cloudflare / Akamai / AWS Shield — distribute attack по 200+ PoPs. **Anycast** — attack traffic goes to closest PoP, not your origin.

- Cloudflare: claims «unmetered DDoS protection» on all plans
- AWS Shield Standard (free for CloudFront/Route 53 users)
- AWS Shield Advanced ($3K/month) — adds 24/7 response team, cost protection

### SYN cookies (Layer 4)

Server не tracks half-open TCP. Вместо state — cookie в SYN-ACK, validated на ACK.

- ✓ Eliminates SYN flood memory exhaustion
- Available in Linux kernel — `net.ipv4.tcp_syncookies = 1`

### Rate limiting на edge

Limit requests per IP / per session / per API key.

```
Cloudflare:
  Rate limiting rules: 100 req/min per IP
  Burst handling: token bucket

AWS WAF:
  Rate-based rule: 2000 req per 5-min per IP

Application-level (Redis + Lua):
  See "Design rate limiter" design problem
```

### Caching

Static cache на edge — 99% requests handled без touching origin. Attack focused на cacheable endpoints — absorbed.

### Geofencing

Block / rate-limit traffic from specific countries. Useful если business doesn't operate там.

### Behavioral analysis

ML / heuristics detect anomalies:
- Spike in requests from one IP
- Patterns matching known attack tools
- User-Agent unusual

Bot management (Cloudflare Bot Management, Akamai Bot Manager) — sophisticated.

---

## WAF (Web Application Firewall)

Filter HTTP requests based on patterns / rules. **Layer 7** protection.

### OWASP Core Rule Set (CRS)

Default ruleset для major WAF: ModSecurity, Cloudflare, AWS WAF.

Защищает от **OWASP Top 10**:
- **SQL Injection** — patterns как `' OR 1=1`, `UNION SELECT`
- **XSS** — `<script>`, `javascript:`, event handlers
- **Path traversal** — `../../../etc/passwd`
- **SSRF** — `localhost`, `169.254.169.254` (cloud metadata)
- **Command injection** — `; cat /etc/passwd`
- **File upload** — extensions, magic bytes

### WAF deployment modes

1. **Detection mode** — log violations only (training period)
2. **Blocking mode** — return 403 / challenge

**Pattern:** start с detection, tune rules (false positives), switch to blocking.

### False positives

Common — WAF blocks legitimate request. Examples:
- Article body contains `<script>` example → blocked as XSS
- Search query «UNION» → blocked as SQLi
- User uploads .pdf → blocked by file rule

**Mitigation:**
- Custom rules для known patterns
- Per-endpoint rules (relax for admin-only endpoints)
- Whitelist trusted users / IPs

### WAF products

- **ModSecurity** (Apache, Nginx) — open source, OWASP CRS
- **Cloudflare WAF** — managed, integrated с DDoS
- **AWS WAF** — pay-per-rule, AWS-native
- **Imperva, F5 BIG-IP ASM** — enterprise
- **Wallarm, Signal Sciences** — modern API security

---

## Bot Management

Distinguishing humans vs bots.

### Good bots vs bad

- **Good**: search engine crawlers (Googlebot, Bingbot), uptime monitoring, RSS readers
- **Bad**: scrapers, credential stuffing, content theft, fake account creation, vulnerability scanners

### Detection techniques

- **User-Agent analysis** — known bad UA strings
- **JavaScript challenge** — issue JS that real browsers compute, headless browsers struggle
- **CAPTCHA** — Google reCAPTCHA, hCaptcha, Cloudflare Turnstile
- **Device fingerprinting** — Canvas, WebGL, font fingerprints
- **Behavioral** — mouse movements, typing patterns, navigation flow

### CAPTCHA decline

reCAPTCHA v2 (image puzzles) → v3 (invisible scoring) → today: **passive challenges** (Cloudflare Turnstile, Apple App Attest).

Modern approach: silent risk score, only challenge suspicious traffic.

---

## API security

REST APIs face different attack vectors than browser apps.

### Authentication

- API keys (header) — simple, но утечки через repos / browser inspector
- OAuth2 access tokens — short TTL, refresh rotation
- mTLS — для B2B critical (banking, fintech)
- HMAC signing — AWS-style request signing

### Rate limiting per API key

```
Free tier: 100 req/min
Pro tier: 10000 req/min
Enterprise: unmetered with monitoring
```

Implement через [rate-limiter design problem](#) или managed service (Kong, Tyk, Apigee).

### Schema validation

Reject malformed requests early. Прежде чем дойдут до business logic.

- OpenAPI/JSON Schema validation на edge
- gRPC has schema baked in (Protobuf)

### Input validation

Never trust client input:
- Length limits (prevent huge payloads)
- Type validation
- Range checks (negative numbers где shouldn't be)
- Whitelist allowed values (enums)

### Output encoding

XSS prevention: escape output context-appropriately (HTML, JavaScript, URL).

### CORS

Cross-Origin Resource Sharing — controls which origins can call API from browser.

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: Authorization
Access-Control-Allow-Credentials: true
```

**Antipattern:** `Access-Control-Allow-Origin: *` + credentials — disabled by browser.

### CSRF (Cross-Site Request Forgery)

Browser sends cookies на любой request к domain. Attacker page makes hidden request к your API.

**Defense:**
- **SameSite cookies** (`Lax`, `Strict`) — default in modern browsers
- **CSRF tokens** — server generates per-session token, client must include in request
- **JWT в Authorization header** — not auto-sent like cookies, not vulnerable

---

## Zero Trust / BeyondCorp

Google's BeyondCorp (2010s) — отказ от network-perimeter security. Каждый request authenticated + authorized regardless of network location.

### Principles

- **Никаких trusted networks** — corp network ≠ trusted
- **Device authentication** — managed devices (corp laptop) authenticated
- **User identity verification** — strong auth (SSO + MFA)
- **Continuous evaluation** — risk score per request, not just login
- **Least privilege** — access per-resource, time-limited

### Implementations

- **Google BeyondCorp** (internal)
- **Cloudflare Access** (BeyondCorp-as-a-service)
- **Tailscale** (mesh VPN с identity)
- **Zscaler ZTNA**
- **Microsoft Conditional Access**

---

## Real-world incidents

- **Dyn DDoS (2016)** — Mirai IoT botnet, 1.2 Tbps. Twitter, Reddit, Netflix down.
- **GitHub DDoS (2018-02-28)** — 1.35 Tbps Memcached amplification. Recovered in 10 min с Akamai Prolexic absorb.
- **AWS DDoS (2020-02)** — 2.3 Tbps. AWS Shield mitigated.
- **Capital One breach (2019)** — SSRF (Server-Side Request Forgery) attack on misconfigured AWS WAF + IAM. 100M+ records.
- **Equifax (2017)** — Apache Struts vulnerability (CVE-2017-5638). 147M records.

---

## Антипаттерны

- **Single layer defense** — только firewall, или только WAF. Defense in depth: CDN + DDoS + WAF + rate limit + auth + monitoring.
- **«Security by obscurity»** — secret URLs, custom obfuscated tokens. Не работает.
- **WAF без tuning** — full block mode сразу → много false positives → users complain → WAF disabled.
- **Trusting client-side validation** — JS validates, server doesn't.
- **Long-lived API keys** — utечка не обнаружена, эксплуатируется месяцами. Rotation policy.
- **Same key для всех окружений** — staging leak compromises prod.

---

## Источники

- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [Cloudflare Learning — DDoS Attacks](https://www.cloudflare.com/learning/ddos/what-is-a-ddos-attack/)
- [AWS Best Practices for DDoS Resiliency (whitepaper)](https://docs.aws.amazon.com/whitepapers/latest/aws-best-practices-ddos-resiliency/welcome.html)
- [Google BeyondCorp papers](https://research.google/pubs/beyondcorp-a-new-approach-to-enterprise-security/)
- [NIST Zero Trust Architecture (SP 800-207)](https://csrc.nist.gov/publications/detail/sp/800-207/final)
- [GitHub blog — February 28th DDoS Incident Report](https://github.blog/2018-03-01-ddos-incident-report/)
- *Web Application Hacker's Handbook*, 2nd ed. (Stuttard, Pinto, 2011)
- [Cloudflare blog — DDoS attack trends](https://blog.cloudflare.com/category/ddos-reports/)
