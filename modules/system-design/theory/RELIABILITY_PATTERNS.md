# Reliability Patterns

Паттерны для устойчивости к failure: retry, backoff, circuit breaker, bulkhead, hedged requests, load shedding, graceful degradation. Каждый — про **управление failure modes**, не предотвращение.

> **Scope**: paterns. Circuit Breaker и Bulkhead — basic в [`microservice_patterns.md`](microservice_patterns.md), здесь — углубление и связанные паттерны. Chaos engineering — [`software-engineering/TESTING.md`](../../software-engineering/theory/TESTING.md).

---

## Retry с exponential backoff + jitter

Базовый паттерн: retry failed request с увеличивающейся задержкой.

```python
def retry_with_backoff(f, max_attempts=5):
    for attempt in range(max_attempts):
        try:
            return f()
        except TransientError:
            if attempt == max_attempts - 1:
                raise
            delay = min(base_delay * (2 ** attempt), max_delay)
            sleep(delay)
```

**Проблема naive backoff:** все клиенты fail одновременно → retry в одно время → retry storm на downstream → повторный outage. В кэш-контексте этот же класс проблем называется **cache stampede** (см. [`caching-deep-dive/ANTI_PATTERNS.md`](../../caching-deep-dive/theory/ANTI_PATTERNS.md)).

### Jitter — must have

Random delay component, чтобы distribute retry timing.

```python
# Full jitter (AWS recommendation)
delay = random.uniform(0, min(cap, base * 2 ** attempt))

# Equal jitter
half = min(cap, base * 2 ** attempt) / 2
delay = half + random.uniform(0, half)

# Decorrelated jitter
delay = random.uniform(base, prev_delay * 3)  # capped
```

**AWS рекомендация (Architecture Blog):** **full jitter** дает best results — равномерное распределение retry, минимум pile-up.

### Когда НЕ retry

- **4xx ошибки** (кроме 408, 429) — клиентская ошибка, retry не поможет
- **Non-idempotent operations** без idempotency key — двойной charge на retry
- **«Достаточно долго» уже** — после ~5 attempts смысл бесплатных retry падает; вернуть error
- **Cascade прevention** — если уже видим много retry → возможно downstream сломан, надо stop

### Retry budget

Чтобы предотвратить retry storm на downstream:

```
Each service has retry budget = 10% of original requests
If retries exceed budget → drop retries, return error immediately
```

→ Linkerd / Envoy implement retry budget natively.

---

## Circuit Breaker (углубление)

Базовое описание — в [`microservice_patterns.md`](microservice_patterns.md#circuit-breaker).

### Состояния

```
CLOSED → OPEN: при >K consecutive failures (или >K% за окно)
OPEN → HALF-OPEN: после cooldown period (e.g., 30 sec)
HALF-OPEN → CLOSED: K successful probe requests
HALF-OPEN → OPEN: any failure during probe
```

### Concurrency-Limited Circuit Breaker (CCB)

Кроме failure count, считает **active concurrent calls**. Если concurrency > limit (downstream slow → many pending requests) → open.

→ Защищает от slow downstream (thread pool exhaustion).

### Adaptive Circuit Breaker

Netflix `concurrency-limits` library — auto-tunes limit based on observed latency (TCP-like AIMD algorithm).

### Implementations

- **Resilience4j** (Java) — modern Hystrix replacement
- **Hystrix** (Netflix, deprecated 2018)
- **Polly** (.NET)
- **Envoy** — built-in circuit breaking (configured per upstream cluster)
- **Istio** — uses Envoy under the hood
- **Linkerd** — built-in

---

## Bulkhead (углубление)

**Идея:** изолировать ресурсы по типу операции, как водонепроницаемые отсеки на корабле. Один отсек заливает → другие безопасны.

### Thread pool isolation

```
Thread pool A (10 threads) — DB queries
Thread pool B (5 threads)  — external API calls
Thread pool C (3 threads)  — image processing

→ Если external API slow (thread pool B exhausted), DB queries (pool A) продолжают работать
```

vs **shared thread pool**: slow external API blocks all threads, DB queries тоже останавливаются.

**Resilience4j Bulkhead:** `SemaphoreBulkhead` (lightweight) или `ThreadPoolBulkhead` (heavy isolation).

### Connection pool isolation

Каждый downstream — свой connection pool. Не один shared pool для DB + external API + cache.

```
HikariCP pool для primary DB: 20 connections
HikariCP pool для replica DB: 50 connections
HTTP client pool для external API: 10 connections
```

### Process isolation

Микросервисы fundamentally — bulkhead на process level. Один service crashes — other isolated.

---

## Hedged Requests (Tail at Scale)

**Проблема:** p99 latency высокая из-за tail (одна медленная replica → весь request slow).

**Идея:** через `t = p95(latency)` после отправки request, послать **дубликат** на другую replica. Берём первый ответ, второй cancel'им.

```
T=0:    send to replica A
T=p95:  if no response from A → send to replica B
T=A_resp or T=B_resp: take first, cancel other
```

**Эффект:** average latency немного возрастает, но **p99 / p999 dramatically reduce** (в 5-10×).

**Стоимость:** ~5% extra requests (только tail dublicate).

**Реализация:** Google Bigtable client, gRPC `hedging_policy`, BigTable, MIT/Cornell research papers.

---

## Load Shedding

**Идея:** когда нагрузка превышает capacity → **намеренно отказывать** части запросов, чтобы остальные обрабатывались нормально.

### Static threshold

```
Если active_requests > 1000 → reject new requests with 503 Service Unavailable
```

- ✓ Simple
- ✗ Threshold надо подобрать; меняется со временем

### Adaptive (Netflix concurrency-limits)

Auto-tunes max_concurrency based on latency:
- Latency growing → reduce limit
- Latency stable → grow limit

→ Better than static; adapts к real capacity.

### Prioritization

Не вся нагрузка одинакова. Reject low-priority first:
- Drop non-critical analytics requests
- Defer scheduled tasks
- Keep paid users serving, drop free
- Keep `/login` working when `/recommendations` drops

### Implementation

- **Envoy** — global rate limit с tagging
- **Application-level** — middleware check on every request
- **kubernetes** — Pod admission webhook + QoS classes

---

## Adaptive Concurrency

Auto-tune number of concurrent requests downstream может handle.

**Netflix concurrency-limits library**: использует **AIMD** (Additive Increase, Multiplicative Decrease, TCP-style):
- Successful response → increase limit by 1
- Latency спike или error → halve the limit

→ Settle на «sweet spot» где downstream удобно работает.

```
limit = 10
Each success: limit += 1   (additive grow)
Each failure: limit /= 2   (multiplicative reduce)
Floor: limit = 1
Ceiling: limit = 1000
```

---

## Graceful Degradation

Когда downstream сломан → не падать целиком, а **work in degraded mode**.

**Примеры:**

### Newsfeed

- Personalized feed недоступен (ML service down) → fallback на popular posts (cached top-100)

### Search

- ML ranking недоступен → simple TF-IDF results
- Faceted filters недоступны → no filter UI, basic search

### E-commerce

- Recommendations API down → show «featured» static
- Reviews service down → hide reviews section
- Inventory live count down → show «in stock» (without exact number)

### Patterns

- **Stale cache** — return last known cached value with «outdated» indicator
- **Default values** — pre-computed fallback (top-10 cached)
- **Feature flag killswitch** — disable feature globally без deploy
- **Read-only mode** — block writes, allow reads (DB primary down, replicas healthy)

---

## Dead Letter Queue (DLQ)

В async (queue-based) системах — что делать с messages, которые consumer не может обработать?

**Без DLQ:** infinite retry → blocks queue, или drop → потеря данных.

**С DLQ:** после N retry → message moves в DLQ для investigation.

```
Producer → Queue → Consumer (retry 5×)
                       ↓ fail
                       DLQ
                       ↓
                   Manual / scheduled batch investigation
```

**Implementations:**
- **AWS SQS** — built-in DLQ (redrive policy after N receives)
- **RabbitMQ** — Dead Letter Exchange
- **Kafka** — manual: write to separate `__failed` topic после retry exhaustion

**Operational pattern:**
1. Monitor DLQ depth (alert if growing)
2. Periodically review messages (often: bug in consumer, schema change)
3. Re-drive after fix (move messages back to main queue)

---

## Idempotency keys

См. [`distributed_systems.md`](distributed_systems.md#idempotency-key) для basic. Здесь — production patterns.

**Client-generated key:** `idempotency_key = UUID().toString()` для каждой операции.

**Server-side dedup:**

```python
def process_payment(idempotency_key, amount, account):
    with redis.lock(f"idempotency:{idempotency_key}", timeout=10):
        cached = redis.get(f"result:{idempotency_key}")
        if cached:
            return cached  # already processed, return cached result
        
        result = actually_charge(amount, account)
        redis.setex(f"result:{idempotency_key}", ttl=24h, value=result)
        return result
```

**TTL для idempotency keys:** обычно 24 hours (балансировать storage cost и retry window).

**Stripe approach:** все mutating endpoints поддерживают `Idempotency-Key` header. Documented best practices.

---

## Retry Storm Prevention (multi-layer)

Cascading retry — самый opasious failure mode. Меры предосторожности:

1. **Jitter** — first line of defence
2. **Retry budget** — limit total retries
3. **Circuit breaker** — stop hitting dead downstream
4. **Adaptive concurrency** — sense capacity, back off
5. **Bulkhead** — failure isolation
6. **Backpressure** — propagate slow / overload upstream

→ Defense in depth: ни одна мера не достаточна, но в combination protects against most failure modes.

---

## SLO-driven design

Reliability — не «100% uptime», а **«acceptable error budget»** (Google SRE).

```
SLO: 99.9% availability (43 min downtime/month allowed)
Error budget: 0.1%
If burn rate > threshold → freeze deployments, focus on reliability
```

**Monitoring:** error budget burn rate alerts (multi-window) — different from threshold alerts.

См. [`infrastructure/OBSERVABILITY.md`](../../infrastructure/theory/OBSERVABILITY.md#sli--slo--sla).

---

## Источники

- [«The Tail at Scale» (Dean, Barroso, 2013, ACM Comm)](https://research.google/pubs/pub40801/) — hedged requests, 1% rule
- [AWS Architecture Blog — Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Netflix concurrency-limits library](https://github.com/Netflix/concurrency-limits) — adaptive concurrency
- *Release It!* (Michael Nygard, 2nd ed., 2018) — оригинал паттернов (CB, Bulkhead, Timeout, Steady State)
- *Site Reliability Engineering* (Beyer et al., Google, 2016) — SLI/SLO, error budgets
- [Stripe — Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency)
- [Cindy Sridharan — Distributed Systems Reliability](https://medium.com/@copyconstruct) — современные посты
- [Resilience4j Documentation](https://resilience4j.readme.io/)
