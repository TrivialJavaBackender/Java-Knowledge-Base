# Балансировщик нагрузки

Балансировщик нагрузки (LB) — компонент, распределяющий трафик между несколькими бэкендами. Главный вопрос — **на каком уровне** (L4 против L7) и **по какой стратегии**.

---

## L4 против L7

### L4 (Transport Layer)

Работает на уровне TCP/UDP. **Не разбирает полезную нагрузку** — только адреса/порты.

```
Client → LB (читает TCP SYN) → Backend (выбран по IP hash или round-robin)
```

- ✓ **Очень быстро** — никакого парсинга, просто проксирование байтов
- ✓ Поддерживает любые протоколы (gRPC, WebSocket, базы данных)
- ✗ Нет маршрутизации по содержимому (нельзя «/api/* → backend pool 1, /static/* → pool 2»)
- ✗ TCP termination — LB держит TCP с клиентом и отдельный TCP с бэкендом (или passthrough — клиент видит IP бэкенда)

**Реализации:** AWS NLB (Network Load Balancer), HAProxy в TCP mode, Nginx Stream module, Envoy (TCP mode), F5 BIG-IP, LVS.

### L7 (Application Layer)

Работает на уровне HTTP / gRPC / WebSocket. Разбирает заголовки, путь, тело запроса.

```
Client → LB (читает HTTP request) → routes:
  /api/users/* → user-service pool
  /api/orders/* → order-service pool
  /static/* → CDN origin
```

- ✓ Маршрутизация по содержимому (path, headers, cookies, JWT claims)
- ✓ TLS termination — LB разворачивает HTTPS, бэкенд получает HTTP
- ✓ Богатые возможности: rate limit, auth, кэширование, A/B-тестирование, стики-сессии
- ✗ Медленнее (парсинг)
- ✗ Видит **только** HTTP — gRPC требует поддержки HTTP/2

**Реализации:** AWS ALB (Application Load Balancer), Nginx, HAProxy в HTTP mode, Envoy, Traefik, Kong, Istio Gateway.

---

## Алгоритмы балансировки

### Round-Robin (RR)

Последовательно по узлам: 1 → 2 → 3 → 1 → 2 → ...

- ✓ Простой, равномерное распределение в идеале
- ✗ Не учитывает текущую нагрузку бэкендов (медленный бэкенд = медленные запросы)

### Weighted Round-Robin

Бэкенды с разными «весами»: мощный сервер получает 3 запроса на каждый 1 слабого.

```
backend_A weight=3
backend_B weight=1
→ A, A, A, B, A, A, A, B, ...
```

### Least Connections

Запрос идёт в бэкенд с **минимальным** числом активных соединений. Лучше для длительных соединений (WebSocket, чаты).

### Least Time

Бэкенд с минимальным временем ответа (требует health metrics).

### IP Hash

`shard = hash(client_ip) % N_backends` — один клиент всегда попадает на тот же бэкенд. Альтернатива стики-сессии.

- ✓ Простая стики-сессия без cookies
- ✗ NAT-ed клиенты (корпоративные сети) — все за одним IP → один бэкенд перегружен

### Consistent Hashing

То же что [`databases/SHARDING.md`](../../databases/theory/SHARDING.md) consistent hashing — на L4/L7 LB используется для:
- Sticky routing с минимальным remap при изменении пула
- Cache locality (один ключ всегда идёт в один бэкенд — бэкенд кэширует)

### Random

Случайный бэкенд. Удивительно: **на больших пулах показывает себя сравнимо** с round-robin (закон больших чисел), и проще в реализации.

---

## Health-проверки

LB периодически проверяет каждый бэкенд; неработоспособный выводится из ротации.

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
- **HTTP** — `GET /health` — бэкенд реализует эндпоинт (deep vs shallow check)
- **Custom** — gRPC health check protocol, SQL ping

**Liveness vs Readiness** (K8s terminology):
- **Liveness** — «приложение жив?» — если нет, рестартовать pod
- **Readiness** — «готов принимать трафик?» — если нет, исключить из LB pool

**Антипаттерн:** один `/health` эндпоинт для обоих — каскадные перезапуски под нагрузкой.

---

## Стики-сессии (Session Affinity)

Запрос от клиента всегда идёт в **один и тот же** бэкенд. Реализации:

### Cookie-based

LB ставит cookie `LB_SESSION=backend_id`; последующие запросы маршрутизирует туда.

- ✓ Гибко, не зависит от сетевой топологии
- ✗ Браузер должен принимать cookie

### IP-based (Source IP affinity)

Хэш от client IP → бэкенд. Проблема NAT (см. выше).

**Когда нужно:**
- Бэкенд с состоянием (in-memory cache per user, WebSocket session)
- В большинстве случаев — **избегать**, делать бэкенд без состояния

**Компромисс:**
- Sticky = неравномерное распределение, потеря данных при отказе бэкенда
- Без состояния + внешнее хранилище (Redis) — стандартная практика

---

## Терминация TLS

LB разворачивает HTTPS, бэкенд получает нешифрованный HTTP.

```
Client --HTTPS--> LB --HTTP--> Backend
       (TLS handshake)        (внутренняя сеть)
```

- ✓ Бэкенд не тратит CPU на криптографию (важно при высоком QPS)
- ✓ Централизованное управление сертификатами (обновление через Let's Encrypt автоматически)
- ✗ Внутренний трафик не зашифрован (исправимо через mTLS или Service Mesh)
- ✓ LB может читать HTTP-заголовки (L7 routing)

**Альтернатива — TLS Passthrough:** LB не разворачивает, проксирует TLS как L4. Используется когда:
- Бэкенд должен видеть клиентский сертификат (требует mTLS)
- Требования соответствия стандартам требуют сквозного шифрования (PCI-DSS, HIPAA)

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

- ✓ Геораспределённый «один IP» с автоматической маршрутизацией
- ✓ DDoS resilience (трафик размазывается по всем PoP)
- ✗ Не подходит для длительных TCP-соединений (смена BGP-маршрута → сброс соединения)

**Используют:** Cloudflare (1.1.1.1, all their CDN), AWS Global Accelerator, Google Cloud Anycast IP.

---

## L4 против L7 — практический выбор

| Кейс | Выбор |
|------|-------|
| Внутренний трафик между микросервисами | L7 (для маршрутизации), L4 если нужна максимальная скорость |
| Публичный веб-API | L7 ALB / Cloudflare |
| gRPC | L7 с поддержкой HTTP/2 (ALB, Envoy) или L4 для passthrough |
| WebSocket | L7 (длительный upgrade handshake) или L4 passthrough |
| Database proxy (PgBouncer, ProxySQL) | L4 |
| TCP-based protocol (Redis, MQTT) | L4 |
| Терминация TLS + маршрутизация | L7 |
| Pure DDoS protection | L4 (наша задача — быстро проксировать байты) |

---

## Архитектуры из продакшена

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

- **Sticky sessions для всего** — мешает auto-scaling, потеря при переключении на резерв (failover). Выносите состояние в Redis.
- **Single LB instance** — SPOF. Нужно минимум 2 в HA pair (active-passive или active-active).
- **No health checks** — LB шлёт трафик на мёртвый бэкенд, пока не получит таймаут (10+ сек).
- **Deep health check на каждый запрос** — `GET /health` делает SELECT * FROM users → нагрузка на БД.
- **Aggressive timeout** — 1 sec может убить легитимные медленные запросы (загрузка файлов, сложные запросы).
- **TLS termination без internal mTLS** — уровень защищённости зависит от того, насколько «приватна» внутренняя сеть.

---

## Источники

- *High Performance Browser Networking* (Ilya Grigorik) — TCP/TLS overhead, LB considerations.
- [HAProxy Documentation](https://docs.haproxy.org/) — справочник по алгоритмам.
- [Envoy Architecture](https://www.envoyproxy.io/docs/envoy/latest/intro/intro)
- [AWS Elastic Load Balancing Comparison](https://aws.amazon.com/elasticloadbalancing/features/)
- [«The Power of Two Choices in Randomized Load Balancing» (Mitzenmacher, 1996)](https://www.eecs.harvard.edu/~michaelm/postscripts/tpds2001.pdf) — теория «power of two random choices».
- [NGINX Load Balancing Algorithms](https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/)
