# DDoS Protection и WAF

Защита от атак: DDoS (исчерпание ресурсов), application-level (SQLi, XSS, SSRF), credential attacks. Многоуровневая защита — единого средства от всего нет.

> **Scope:** edge-уровень защиты (rate limiting, WAF, DDoS mitigation). Application-level auth (JWT/OAuth) — [`identity_providers.md`](identity_providers.md). Secrets ops — [`infrastructure/SECRETS.md`](../../infrastructure/theory/SECRETS.md). Тестирование безопасности (SAST/DAST/pentest) — [`software-engineering/TESTING.md`](../../software-engineering/theory/TESTING.md).

---

## Виды DDoS

### Volumetric (Layer 3–4)

Заваливают полосу пропускания / сетевыми пакетами.

- **UDP flood** — миллионы UDP-пакетов
- **SYN flood** — half-open TCP-соединения, сервер удерживает состояние
- **DNS amplification** — маленький запрос → огромный ответ (коэффициент 50–200×)
- **NTP amplification** — аналогично
- **Memcached amplification** — открытый memcached дал атаку 1.7 Тбит/с (GitHub, 2018)

**Масштаб:** атаки уровня 1 Тбит/с уже случались (Dyn 2016, GitHub 2018).

**Защита:** absorb на edge (Cloudflare / Akamai / AWS Shield — суммарная capacity сети 100+ Тбит/с).

### Protocol (Layer 4)

Эксплуатируют реализацию протокола:
- **Slowloris** — медленные HTTP-запросы, держат соединения открытыми
- **TCP RST flood**
- **Smurf attack** — ICMP со spoofed source

**Защита:** rate limit per IP, отбрасывание плохих пакетов.

### Application (Layer 7)

Запросы выглядят легитимно, но либо слишком объёмные, либо асимметрично дорогие.

- **HTTP flood** — миллион GET в секунду
- **Cache busting** — разные query string, обход CDN
- **Login brute force** — credential stuffing
- **API enumeration** — обнаружение endpoints

**Сложнее обнаружить:** выглядит как реальный трафик, и даже небольшого объёма достаточно, если каждый запрос дорого обходится backend'у.

**Защита:** rate limit per user / IP, CAPTCHA, behavioral analysis, WAF.

---

## DDoS Mitigation

### Edge absorption (CDN)

Cloudflare / Akamai / AWS Shield распределяют атаку по 200+ PoP. **Anycast** — атакующий трафик уходит на ближайший PoP, не на ваш origin.

- Cloudflare заявляет «unmetered DDoS protection» на всех планах
- AWS Shield Standard — бесплатно для пользователей CloudFront / Route 53
- AWS Shield Advanced (~$3K/мес) — добавляет 24/7 response team и cost protection

### SYN cookies (Layer 4)

Сервер не хранит half-open TCP-соединения. Вместо состояния — cookie в SYN-ACK, валидируется при ACK.

- ✓ Решает проблему исчерпания памяти на SYN flood
- В Linux включается через `net.ipv4.tcp_syncookies = 1`

### Rate limiting на edge

Ограничение по IP / сессии / API key.

```
Cloudflare:
  Rate limiting rules: 100 запросов/мин на IP
  Burst-логика: token bucket

AWS WAF:
  Rate-based rule: 2000 запросов за 5 мин на IP

Application-level (Redis + Lua):
  См. design problem «Rate limiter»
```

### Кэширование

Статика кэшируется на edge — 99% запросов обслуживаются без обращения к origin. Атаки на cacheable endpoints просто absorbing'аются.

### Geofencing

Блок или ограничение трафика из конкретных стран — полезно, если бизнес там не работает.

### Behavioral analysis

ML / эвристики ловят аномалии:
- Резкий рост запросов с одного IP
- Паттерны известных атакующих инструментов
- Подозрительные User-Agent

Продвинутые системы: Cloudflare Bot Management, Akamai Bot Manager.

---

## WAF (Web Application Firewall)

Фильтрует HTTP-запросы по паттернам / правилам. Защита на **Layer 7**.

### OWASP Core Rule Set (CRS)

Дефолтный набор правил для основных WAF: ModSecurity, Cloudflare, AWS WAF.

Защищает от **OWASP Top 10**:
- **SQL Injection** — паттерны `' OR 1=1`, `UNION SELECT`
- **XSS** — `<script>`, `javascript:`, event handlers
- **Path traversal** — `../../../etc/passwd`
- **SSRF** — `localhost`, `169.254.169.254` (cloud metadata endpoint)
- **Command injection** — `; cat /etc/passwd`
- **File upload** — проверка расширений и magic bytes

### Режимы развёртывания WAF

1. **Detection mode** — только логирование нарушений (период обучения)
2. **Blocking mode** — возврат 403 или challenge

**Паттерн:** начать с detection, отстроить правила (false positives), переключить в blocking.

### False positives

Распространённое явление — WAF блокирует легитимный запрос. Примеры:
- Тело статьи содержит `<script>` как пример → блок как XSS
- Поисковый запрос с «UNION» → блок как SQLi
- Пользователь загружает .pdf → блок по правилу для файлов

**Митигации:**
- Кастомные правила под известные паттерны
- Per-endpoint правила (слабее для admin-only endpoints)
- Whitelist для доверенных пользователей / IP

### WAF-продукты

- **ModSecurity** (Apache, Nginx) — open source, OWASP CRS
- **Cloudflare WAF** — managed, интегрирован с DDoS-защитой
- **AWS WAF** — pay-per-rule, AWS-native
- **Imperva, F5 BIG-IP ASM** — enterprise
- **Wallarm, Signal Sciences** — современная API security

---

## Bot Management

Различение человек vs бот.

### Хорошие vs плохие боты

- **Хорошие:** поисковые краулеры (Googlebot, Bingbot), uptime monitoring, RSS-ридеры
- **Плохие:** скрейперы, credential stuffing, кража контента, создание фейковых аккаунтов, сканеры уязвимостей

### Методы детекции

- **User-Agent analysis** — известные «плохие» UA-строки
- **JavaScript challenge** — выдаём JS, который выполняют настоящие браузеры; headless-браузеры спотыкаются
- **CAPTCHA** — Google reCAPTCHA, hCaptcha, Cloudflare Turnstile
- **Device fingerprinting** — Canvas, WebGL, отпечатки шрифтов
- **Behavioral** — движения мыши, паттерны набора, навигационный flow

### Закат CAPTCHA

reCAPTCHA v2 (картинки) → v3 (невидимый скоринг) → сейчас: **пассивные challenges** (Cloudflare Turnstile, Apple App Attest).

Современный подход: тихий risk score, challenge — только для подозрительного трафика.

---

## API security

REST-API сталкиваются с другими векторами, чем браузерные приложения.

### Аутентификация

- API-ключи (в header) — просто, но утекают через репозитории / browser inspector
- OAuth2 access tokens — короткий TTL, refresh rotation
- mTLS — для критичного B2B (банкинг, fintech)
- HMAC signing — request signing в стиле AWS

### Rate limiting per API key

```
Free tier: 100 запросов/мин
Pro tier: 10 000 запросов/мин
Enterprise: без лимита, но с мониторингом
```

Реализация — собственный rate limiter (см. design problem) или managed-сервис (Kong, Tyk, Apigee).

### Schema validation

Отбрасывать malformed-запросы как можно раньше, до бизнес-логики.

- Валидация OpenAPI / JSON Schema на edge
- В gRPC схема встроена (Protobuf)

### Input validation

Никогда не доверять клиентскому вводу:
- Лимиты длины (защита от огромных payload'ов)
- Проверка типов
- Range checks (отрицательные числа там, где не должно быть)
- Whitelist допустимых значений (enums)

### Output encoding

Защита от XSS: escape вывода в зависимости от контекста (HTML, JavaScript, URL).

### CORS

Cross-Origin Resource Sharing — определяет, какие origins могут вызывать API из браузера.

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: Authorization
Access-Control-Allow-Credentials: true
```

**Антипаттерн:** `Access-Control-Allow-Origin: *` вместе с credentials — браузер заблокирует.

### CSRF (Cross-Site Request Forgery)

Браузер отправляет cookies на любой запрос к домену. Страница атакующего делает скрытый запрос к вашему API.

**Защита:**
- **SameSite cookies** (`Lax`, `Strict`) — default в современных браузерах
- **CSRF-токены** — сервер выдаёт на сессию, клиент обязан включить в запрос
- **JWT в заголовке Authorization** — не отправляется автоматически, как cookies, и неуязвим к CSRF

---

## Zero Trust / BeyondCorp

BeyondCorp от Google (2010-е) — отказ от network-perimeter security. Каждый запрос аутентифицируется и авторизуется независимо от сетевого расположения.

### Принципы

- **Никаких trusted networks** — корпоративная сеть ≠ доверенная
- **Device authentication** — managed-устройства (корпоративный ноутбук) аутентифицируются
- **User identity verification** — сильная аутентификация (SSO + MFA)
- **Continuous evaluation** — risk score на каждом запросе, а не только при логине
- **Least privilege** — доступ per-resource, на ограниченное время

### Реализации

- **Google BeyondCorp** (внутренний)
- **Cloudflare Access** (BeyondCorp-as-a-service)
- **Tailscale** (mesh VPN с identity)
- **Zscaler ZTNA**
- **Microsoft Conditional Access**

---

## Реальные инциденты

- **Dyn DDoS (2016)** — Mirai IoT-ботнет, 1.2 Тбит/с. Twitter, Reddit, Netflix лежали.
- **GitHub DDoS (28.02.2018)** — 1.35 Тбит/с, Memcached amplification. Восстановление за 10 мин через Akamai Prolexic.
- **AWS DDoS (02.2020)** — 2.3 Тбит/с. Митигировано AWS Shield.
- **Capital One breach (2019)** — SSRF-атака на неверно сконфигурированный AWS WAF + IAM. 100M+ записей.
- **Equifax (2017)** — уязвимость Apache Struts (CVE-2017-5638). 147M записей.

---

## Антипаттерны

- **Один уровень защиты** — только firewall, или только WAF. Нужен defense in depth: CDN + DDoS + WAF + rate limit + auth + мониторинг.
- **«Security by obscurity»** — секретные URL, кастомные обфусцированные токены. Не работает.
- **WAF без тюнинга** — сразу full block mode → много false positives → жалобы пользователей → WAF отключают.
- **Доверие client-side валидации** — JS проверяет, сервер не проверяет.
- **Долгоживущие API-ключи** — утечка не замечается, эксплуатируется месяцами. Нужна rotation policy.
- **Один ключ на все окружения** — утечка из staging компрометирует prod.

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
