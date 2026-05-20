# Load Balancer

Load balancer (LB) — компонент, распределяющий трафик между несколькими бэкендами. Главный вопрос — **на каком уровне** (L4 vs L7) и **по какой стратегии**.

---

## L4 vs L7

### L4 (Transport Layer)

Работает на уровне TCP/UDP. **Не разбирает payload** — только адреса/порты.

```
Client → LB (читает TCP SYN) → Backend (выбран по IP hash или round-robin)
```

- ✓ **Очень быстро** — никакого парсинга, просто proxy bytes
- ✓ Поддерживает любые протоколы (gRPC, WebSocket, базы данных)
- ✗ Нет content-based routing (нельзя «/api/* → backend pool 1, /static/* → pool 2»)
- ✗ TCP termination — LB держит TCP с клиентом и отдельный TCP с backend (или passthrough — клиент видит backend IP)

**Реализации:** AWS NLB (Network Load Balancer), HAProxy в TCP mode, Nginx Stream module, Envoy (TCP mode), F5 BIG-IP, LVS.

### L7 (Application Layer)

Работает на уровне HTTP / gRPC / WebSocket. Разбирает headers, path, body.

```
Client → LB (читает HTTP request) → routes:
  /api/users/* → user-service pool
  /api/orders/* → order-service pool
  /static/* → CDN origin
```

- ✓ Content-based routing (path, headers, cookies, JWT claims)
- ✓ TLS termination — LB разворачивает HTTPS, backend получает HTTP
- ✓ Rich features: rate limit, auth, caching, A/B testing, sticky sessions
- ✗ Медленнее (парсинг)
- ✗ Видит **только** HTTP — gRPC требует HTTP/2 support

**Реализации:** AWS ALB (Application Load Balancer), Nginx, HAProxy в HTTP mode, Envoy, Traefik, Kong, Istio Gateway.

---

## Алгоритмы балансировки

### Round-Robin (RR)

Последовательно по узлам: 1 → 2 → 3 → 1 → 2 → ...

- ✓ Простой, equal distribution в идеале
- ✗ Не учитывает текущую нагрузку backend'ов (slow backend = slow requests)

### Weighted Round-Robin

Backend'ы с разными «весами»: мощный сервер получает 3 запроса на каждый 1 слабого.

```
backend_A weight=3
backend_B weight=1
→ A, A, A, B, A, A, A, B, ...
```

### Least Connections

Запрос идёт в backend с **минимальным** числом активных соединений. Лучше для long-lived connections (WebSocket, чаты).

### Least Time

Backend с минимальным response time (требует health metrics).

### IP Hash

`shard = hash(client_ip) % N_backends` — один клиент всегда попадает на тот же backend. Альтернатива sticky session.

- ✓ Простая sticky session без cookies
- ✗ NAT-ed клиенты (corporate networks) — все за одним IP → один backend перегружен

### Consistent Hashing

То же что [`databases/SHARDING.md`](../../databases/theory/SHARDING.md) consistent hashing — на L4/L7 LB используется для:
- Sticky routing с минимальным remap при изменении pool
- Cache locality (один key всегда идёт в один backend — backend кэширует)

### Random

Случайный backend. Удивительно: **на больших pools показывает себя сравнимо** с round-robin (закон больших чисел), и проще в реализации.

---

## Health Checks

LB периодически проверяет каждый backend; unhealthy выводится из ротации.

```yaml
health_check:
  path: /health
  interval: 5s
  timeout: 2s
  unhealthy_threshold: 3   # 3 fail подряд → mark unhealthy
  healthy_threshold: 2     # 2 success подряд → mark healthy
```

**Виды:**
- **TCP** — просто `connect()` — самый дешёвый, не ловит «зависший процесс»
- **HTTP** — `GET /health` — backend implements endpoint (deep vs shallow check)
- **Custom** — gRPC health check protocol, SQL ping

**Liveness vs Readiness** (K8s terminology):
- **Liveness** — «приложение жив?» — если нет, рестартовать pod
- **Readiness** — «готов принимать трафик?» — если нет, исключить из LB pool

**Антипаттерн:** одна `/health` endpoint для обоих — каскадные restarts под load.

---

## Sticky Sessions (Session Affinity)

Запрос от клиента всегда идёт в **один и тот же** backend. Реализации:

### Cookie-based

LB ставит cookie `LB_SESSION=backend_id`; на следующих запросах роутит туда.

- ✓ Гибко, не зависит от network topology
- ✗ Браузер должен принимать cookie

### IP-based (Source IP affinity)

Hash от client IP → backend. NAT issue (см. выше).

**Когда нужно:**
- Stateful backend (in-memory cache per user, WebSocket session)
- В большинстве cases — **избегать**, делать backend stateless

**Trade-off:**
- Sticky = неравномерное распределение, потеря данных при failure backend'а
- Stateless + external state (Redis) — стандартная практика

---

## TLS Termination

LB разворачивает HTTPS, backend получает plain HTTP.

```
Client --HTTPS--> LB --HTTP--> Backend
       (TLS handshake)        (внутренняя сеть)
```

- ✓ Backend не тратит CPU на crypto (важно при высоком QPS)
- ✓ Централизованное управление сертификатами (renewal через Let's Encrypt автоматически)
- ✗ Внутренний трафик не зашифрован (исправимо через mTLS или Service Mesh)
- ✓ LB может смотреть HTTP headers (L7 routing)

**Альтернатива — TLS Passthrough:** LB не разворачивает, проксирует TLS как L4. Используется когда:
- Backend должен видеть client certificate (mTLS требует)
- Compliance требует end-to-end encryption (PCI-DSS, HIPAA)

---

## Anycast

Один IP объявлен из нескольких локаций через BGP. Маршрутизация — в ближайший по BGP.

```
LB IP 1.2.3.4 объявлен из:
  US-East PoP
  US-West PoP
  EU PoP
  APAC PoP

User в Лондоне → BGP shortest path → EU PoP
User в Сан-Франциско → US-West PoP
```

- ✓ Geo-distributed «один IP» с автоматическим routing
- ✓ DDoS resilience (трафик размазывается по всем PoP)
- ✗ Не подходит для long-lived TCP (BGP route change → connection reset)

**Используют:** Cloudflare (1.1.1.1, all their CDN), AWS Global Accelerator, Google Cloud Anycast IP.

---

## L4 vs L7 — practical choice

| Кейс | Выбор |
|------|-------|
| Internal microservice traffic | L7 (для routing), L4 если нужна максимальная скорость |
| Public web API | L7 ALB / Cloudflare |
| gRPC | L7 с HTTP/2 support (ALB, Envoy) или L4 для passthrough |
| WebSocket | L7 (длительный upgrade handshake) или L4 passthrough |
| Database proxy (PgBouncer, ProxySQL) | L4 |
| TCP-based protocol (Redis, MQTT) | L4 |
| TLS termination + routing | L7 |
| Pure DDoS protection | L4 (наша задача — proxy bytes быстро) |

---

## Real-world architectures

### AWS

```
Internet → CloudFront (CDN, DDoS) → ALB (L7) → Target Group (EC2/ECS)
                                  → NLB (L4)  → backend (database, NLB-only services)
```

### K8s

```
Internet → Cloud LB → Ingress Controller (Nginx/Traefik/Istio = L7) → Service (cluster IP)
                                                                    → kube-proxy (L4 iptables/IPVS) → Pod
```

### Service mesh (Istio/Linkerd)

```
Service A → Envoy sidecar → mTLS → Envoy sidecar → Service B
            (L7 routing,           (выставляет identity)
             retries, CB)
```

---

## Антипаттерны

- **Sticky sessions для всего** — мешает auto-scaling, потеря при failover. Externalise state в Redis.
- **Single LB instance** — SPOF. Нужно минимум 2 в HA pair (active-passive или active-active).
- **No health checks** — LB шлёт трафик на мёртвый backend пока не получит timeout (10+ сек).
- **Deep health check на каждый запрос** — `GET /health` делает SELECT * FROM users → load на DB.
- **Aggressive timeout** — 1 sec может убить legitimate slow requests (file uploads, complex queries).
- **TLS termination без internal mTLS** — security posture зависит от того, насколько «приватна» внутренняя сеть.

---

## Источники

- *High Performance Browser Networking* (Ilya Grigorik) — TCP/TLS overhead, LB considerations.
- [HAProxy Documentation](https://docs.haproxy.org/) — справочник по алгоритмам.
- [Envoy Architecture](https://www.envoyproxy.io/docs/envoy/latest/intro/intro)
- [AWS Elastic Load Balancing Comparison](https://aws.amazon.com/elasticloadbalancing/features/)
- [«The Power of Two Choices in Randomized Load Balancing» (Mitzenmacher, 1996)](https://www.eecs.harvard.edu/~michaelm/postscripts/tpds2001.pdf) — теория «power of two random choices».
- [NGINX Load Balancing Algorithms](https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/)
