# DNS

DNS (Domain Name System) — распределённая иерархическая система имён, превращающая `example.com` в IP. Часто упоминается на интервью как первый этап потока запросов (`browser → DNS → LB → app`).

---

## Иерархия

```
Root (.) → TLD (.com) → Authoritative (example.com) → Records (www.example.com)
```

- **Root servers** — 13 logical (anycast many physical) служат корневой зоной
- **TLD servers** — `.com`, `.org`, `.io`, country codes (`.us`, `.ru`)
- **Authoritative** — управляются владельцем домена (через DNS provider — Route 53, Cloudflare DNS)
- **Recursive resolver** — DNS клиент (через ISP, или 8.8.8.8 Google, 1.1.1.1 Cloudflare): идёт по иерархии, кэширует ответы

---

## Типы записей

| Тип | Назначение | Пример |
|-----|-----------|--------|
| **A** | IPv4 address | `example.com → 93.184.216.34` |
| **AAAA** | IPv6 address | `example.com → 2606:2800:220:1::1` |
| **CNAME** | Alias на другой домен | `www → example.com` |
| **MX** | Mail server | `example.com → mail.example.com (priority 10)` |
| **TXT** | Произвольный текст (SPF, DKIM, domain verification) | `v=spf1 include:_spf.google.com ~all` |
| **NS** | Authoritative name server | `example.com → ns1.example.com` |
| **SOA** | Start of Authority — primary NS + serial + refresh | (один на zone) |
| **PTR** | Reverse: IP → name | `34.216.184.93.in-addr.arpa → example.com` |
| **SRV** | Service location (port + host) | `_sip._tcp.example.com → 5060 sip.example.com` |
| **CAA** | Certificate Authority Authorization | `0 issue "letsencrypt.org"` |

---

## TTL и кэширование

Каждая запись имеет **TTL** (time-to-live в секундах). Recursive resolver кэширует ответ на TTL секунд → дальнейшие запросы не идут в authoritative.

```
Authoritative: A example.com → 1.2.3.4 TTL=300
Resolver кэширует на 5 минут → клиенты, делающие разрешение имени в это окно, получают 1.2.3.4 без сетевого запроса
```

**Компромисс:**
- **Высокий TTL** (часы-дни): меньше DNS-трафика, быстрее разрешение имён, но **медленные изменения** (если меняешь IP, старые клиенты будут стучаться к старому ещё часы)
- **Низкий TTL** (60s): мгновенное переключение на резерв (failover), но больше DNS-запросов

Production tip: для важных конечных точек держать TTL=60 (быстрое переключение на резерв), для стабильных статичных источников — TTL=3600+.

**Negative caching:** NXDOMAIN тоже кэшируется (SOA-specified, обычно 5 мин) — поэтому опечатка домена несколько минут «не существует» даже после исправления.

---

## Методы DNS-маршрутизации (на уровне authoritative)

Современные DNS providers поддерживают «умные» политики: ответ зависит от запрашивающего.

### Маршрутизация по задержке (Latency-based routing)

Возвращает конечную точку с наименьшей RTT для резолвера клиента. Route 53 имеет глобальную карту задержек.

```
US client → example.com → us-east-1 LB
EU client → example.com → eu-west-1 LB
```

### Маршрутизация по геолокации (Geo-DNS / GeoLocation routing)

Маршрутизация по стране/континенту. Хорошо для data residency (GDPR — EU пользователи → EU конечная точка).

### Взвешенная маршрутизация (Weighted routing)

Распределяет трафик по весам (для canary / A/B testing на уровне DNS).

```
70% → new.app.example.com (v2)
30% → old.app.example.com (v1)
```

### Маршрутизация с переключением на резерв (Failover routing)

Основная конечная точка + резервная; резервная активируется при сбое проверки работоспособности основной.

### Мультизначная маршрутизация (Multi-value routing)

До 8 работоспособных записей возвращаются — клиент сам выбирает (round-robin). Простой L4 LB через DNS.

---

## DNS Anycast

Один IP-адрес объявлен из нескольких локаций через BGP. Маршрутизация пакета идёт в ближайший (по BGP) PoP.

Использование:
- Root DNS servers (13 IP, тысячи физических серверов)
- 8.8.8.8, 1.1.1.1 (Google, Cloudflare resolver)
- CDN POP

См. [LOAD_BALANCER.md](LOAD_BALANCER.md) для общего обзора Anycast.

---

## DNSSEC

DNS-ответы можно подделать (DNS cache poisoning, MITM). **DNSSEC** — подпись зоны цифровой подписью, валидация от root до record через цепочку доверия.

- ✓ Гарантирует подлинность и целостность данных
- ✗ Не обеспечивает конфиденциальность (DNS-запросы передаются открытым текстом)
- ✗ Сложная операционно (key rollover)
- Покрытие: ~30% доменов

**DoH** (DNS over HTTPS, RFC 8484) и **DoT** (DNS over TLS) — шифрование DNS-трафика для обеспечения конфиденциальности (Cloudflare 1.1.1.1, Google 8.8.8.8, Quad9 поддерживают).

---

## Инциденты DNS из реальной практики

- **Dyn DDoS (2016-10-21)** — Mirai botnet атаковал Dyn (DNS provider). Twitter, Netflix, Reddit недоступны 5+ часов. Урок: DNS — критическая зависимость, не SPOF.
  → [Wikipedia — 2016 Dyn cyberattack](https://en.wikipedia.org/wiki/2016_Dyn_cyberattack)
- **Cloudflare 1.1.1.1 BGP leak (2022-06-21)** — region down 90 мин из-за BGP misconfiguration. DNS resolver был частично недоступен.
- **Facebook outage (2021-10-04)** — внутренний BGP misconfig сделал DNS недоступным; даже инженеры не могли войти в офис (badge readers зависели от DNS).
  → [Cloudflare blog — Facebook DNS-via-BGP outage](https://blog.cloudflare.com/october-2021-facebook-outage/)

**Урок:** имейте альтернативный DNS provider (multi-CDN setup или secondary DNS), не полагайтесь на единственный.

---

## DNS в SD-интервью — типичные вопросы

- «Что происходит, когда я набираю `example.com` в браузере?» — начни с DNS (recursive resolver → root → TLD → authoritative)
- «Как сделать failover между двумя DC?» — DNS failover routing + health checks
- «Как направить EU пользователей в EU?» — Geo-DNS
- «Что если DNS-провайдер недоступен?» — multi-provider DNS, переключение на резервный

---

## Источники

- [RFC 1034 / 1035 — Domain Names — Concepts / Implementation (1987)](https://datatracker.ietf.org/doc/html/rfc1034)
- [RFC 8484 — DNS over HTTPS (DoH)](https://datatracker.ietf.org/doc/html/rfc8484)
- [AWS Route 53 — Routing Policies](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html)
- [Cloudflare Learning — What is DNS?](https://www.cloudflare.com/learning/dns/what-is-dns/)
- [PowerDNS Engineering Blog](https://blog.powerdns.com/) — глубокие посты про DNSSEC, DDoS.
