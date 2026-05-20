# Reverse Proxy

Reverse proxy — сервер, принимающий запросы клиентов и пересылающий их к backend, возвращая ответ клиенту. С точки зрения клиента видится как «приложение».

> **Scope**: разница с forward proxy и LB, сравнение Nginx/Envoy/HAProxy. Алгоритмы балансировки — см. [LOAD_BALANCER.md](LOAD_BALANCER.md).

---

## Forward vs Reverse Proxy

**Forward proxy** — на стороне **клиента**, скрывает identity клиента от сервера. Корпоративный internet gateway, censorship circumvention, ISP cache (1990s).

```
Client → Forward Proxy → Internet → Server
         (вышел из корпоративной сети)
```

**Reverse proxy** — на стороне **сервера**, скрывает топологию backend от клиента. Все современные web-сервисы.

```
Client → Reverse Proxy → Backend Pool
         (видится как app)
```

---

## Что делает reverse proxy (типичные функции)

1. **Load balancing** — распределение по backend (см. [LOAD_BALANCER.md](LOAD_BALANCER.md))
2. **TLS termination** — разворачивает HTTPS на edge
3. **Request routing** — `/api/* → service-a`, `/static/* → CDN/S3`
4. **Caching** — простой Cache-Control + объекты в local disk/RAM
5. **Compression** — gzip/brotli responses
6. **Rate limiting** — per-IP, per-key
7. **Auth** — JWT validation, OAuth2, mTLS
8. **WAF** — OWASP rules (Web Application Firewall)
9. **Header manipulation** — add `X-Forwarded-For`, strip internal headers
10. **Connection pooling** — keep-alive с backend, multiplexing HTTP/2

---

## Nginx vs HAProxy vs Envoy

Три главных open-source reverse proxy.

### Nginx (originally 2004, by Igor Sysoev)

**Сильные стороны:**
- Battle-tested, повсеместен (60%+ websites)
- Простой config syntax
- Отличный static file serving
- gzip / FastCGI / PHP-FPM integration

**Слабые места:**
- Конфигурация per-virtualhost статична (reload требует SIGHUP / `nginx -s reload`)
- Worker-based architecture (не event loop как Envoy)
- Ограниченное в HTTP/3, gRPC (есть, но не первый класс)

**Когда выбирать:** classic web (static + dynamic backend), низкая динамика конфигурации.

### HAProxy (1999-2002, by Willy Tarreau)

**Сильные стороны:**
- Самый быстрый L4/L7 (С + custom event loop)
- Excellent observability (stats page, health states)
- TCP mode (database proxy, любые TCP-based)
- Stick tables (sessions, rate limit) с в memory

**Слабые места:**
- Менее распространён чем Nginx
- Простой config, но не template-friendly (нужен Confd/Consul-template)

**Когда выбирать:** высокий QPS, TCP load balancing, нужна точная observability.

### Envoy (2016, by Lyft)

**Сильные стороны:**
- **xDS API** — динамическая конфигурация без reload (получает config from control plane)
- HTTP/2 + gRPC native
- Hot reload, blue/green LDS config swap
- Filter chain (extensible — WASM filters)
- Используется в Istio, Linkerd 2 (Linkerd2-proxy), AWS App Mesh

**Слабые места:**
- Сложнее в настройке (control plane нужен — Istio Pilot, custom)
- Resource-heavier (Go control plane + C++ data plane)

**Когда выбирать:** service mesh, K8s, gRPC-heavy, динамические backend (auto-scaling).

### Traefik (2015, Containous)

**Сильные стороны:**
- **Auto-discovery** — Docker / K8s / Consul labels, и сразу маршрут готов
- Let's Encrypt автоматически
- Dashboard

**Слабые места:**
- Меньше features чем Envoy
- Performance ниже Nginx/HAProxy

**Когда выбирать:** small-to-medium K8s, простой ingress без service mesh.

---

## Reverse proxy vs API Gateway vs Service Mesh

Часто путают. Это разные уровни абстракции:

| | Reverse Proxy | API Gateway | Service Mesh |
|---|---|---|---|
| Где живёт | Edge (single instance/HA pair) | Edge (per app) | Per-pod sidecar |
| Routing | Path/host-based | Path + API contract (OpenAPI/GraphQL) | Service-to-service |
| Auth | Basic JWT | OAuth2/OIDC full flow | mTLS identity |
| Rate limit | IP-based | Per-API key / tier | Per-service |
| Observability | Logs | + API analytics | + Distributed tracing, per-call |
| Examples | Nginx, HAProxy | Kong, Apigee, Tyk, AWS API Gateway | Istio, Linkerd, Consul Connect |

**Service Mesh** добавляет infrastructure для inter-service communication (mTLS, retries, circuit breaker) **без изменения кода**. Цена — N×2 sidecars (envoy + app в каждом pod), сложность операционная.

---

## Common configurations

### Path-based routing

```nginx
location /api/v1/users {
    proxy_pass http://user-service;
}
location /api/v1/orders {
    proxy_pass http://order-service;
}
location /static/ {
    alias /var/www/static/;
}
```

### TLS termination + redirect HTTP → HTTPS

```nginx
server {
    listen 80;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    location / { proxy_pass http://backend; }
}
```

### Rate limiting (Nginx)

```nginx
limit_req_zone $binary_remote_addr zone=mylimit:10m rate=10r/s;
server {
    location /api/ {
        limit_req zone=mylimit burst=20 nodelay;
        proxy_pass http://backend;
    }
}
```

### Caching at proxy

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=my_cache:10m max_size=10g;
location / {
    proxy_cache my_cache;
    proxy_cache_valid 200 1h;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    proxy_pass http://backend;
}
```

---

## X-Forwarded-* headers

Когда есть chain `Client → CDN → LB → App`, app видит CDN/LB IP вместо клиента. Headers решают:

```
X-Forwarded-For: <client_ip>, <proxy1_ip>, <proxy2_ip>
X-Forwarded-Proto: https            (был ли HTTPS у client)
X-Forwarded-Host: example.com       (оригинальный Host)
X-Real-IP: <client_ip>              (Nginx-specific, single client IP)
```

**Security pitfall:** клиент может **подделать** `X-Forwarded-For` если LB / proxy его не перезаписывает. Trust только если LB enforce'ит (CloudFront, ALB перезаписывают).

**Modern alternative:** `Forwarded` header (RFC 7239), стандартизированный формат, но менее распространён.

---

## Connection pooling

Proxy держит **keep-alive connections** к backend, переиспользует для разных клиентов. Без pooling: каждый клиент = новый TCP+TLS handshake (~ 50ms на TLS). С pooling: переиспользование = 0ms overhead.

```nginx
upstream backend {
    server backend1:8080;
    server backend2:8080;
    keepalive 32;  # 32 idle connections per worker
}
```

---

## HA reverse proxy

Reverse proxy сам не должен быть SPOF.

### Active-Passive с VRRP / keepalived

Два проксей-узла, один активный, второй ждёт. VIP (virtual IP) failover при падении active. RTO ~ 1-3 секунды.

### Active-Active за L4 LB / Anycast

Два-N узлов, все принимают трафик через DNS / Anycast IP. Cloud-native: AWS ALB сам HA внутри, NLB на multi-AZ.

### Kubernetes Ingress

Ingress controller (Nginx/Traefik) в Deployment, обычно 2+ replicas, exposed через Service type=LoadBalancer (cloud LB) или NodePort + external LB.

---

## Real-world considerations

- **Buffer size tuning:** Nginx `proxy_buffers` для slow clients (нужно много буфера) vs быстрых (мало). По умолчанию ~4 KB × 8 — обычно мало для крупных responses.
- **Timeouts:** `proxy_read_timeout` (60s default) — может убить долгие SSE / WebSocket. Поднять до 3600s для streaming.
- **HTTP/2 to backend:** Nginx supports HTTP/2 client-facing, **но не backend-facing** до 1.25+. Envoy / HAProxy 2+ — оба направления.
- **Logging cost:** access log на каждый request — IO-heavy. Buffer + async + sampling в hot path.

---

## Источники

- [Nginx Documentation](http://nginx.org/en/docs/) + [DigitalOcean Tutorials](https://www.digitalocean.com/community/tutorials)
- [HAProxy Configuration Manual](https://docs.haproxy.org/2.8/configuration.html)
- [Envoy Architecture Overview](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
- [RFC 7239 — Forwarded HTTP Extension](https://datatracker.ietf.org/doc/html/rfc7239)
- *NGINX Cookbook* (Derek DeJonghe, O'Reilly 2020) — production patterns.
- [Cloudflare — Reverse Proxy vs Forward Proxy](https://www.cloudflare.com/learning/cdn/glossary/reverse-proxy/)
