# Webhooks

Server-to-server async HTTP notifications. «Когда событие X происходит, POST на этот URL». Standard для B2B integration (Stripe, GitHub, Slack, Twilio).

> **Scope**: design webhook **provider** (sender) и **consumer** (receiver). Async event basics — см. [COMMUNICATION_PATTERNS.md](COMMUNICATION_PATTERNS.md).

---

## Anatomy

### As provider (you send)

```
Customer registers webhook URL: https://customer.app/api/webhooks/our-events

Event happens in your system:
  → enqueue webhook delivery job
  → worker:
    POST customer's URL
    body: { event_type, event_id, timestamp, data }
    headers:
      User-Agent: YourApp-Webhook
      X-YourApp-Signature: <HMAC-SHA256>
      X-YourApp-Timestamp: <unix>
      Content-Type: application/json

  Customer's server: respond 2xx
    if 200-299 → success, mark delivered
    if 4xx → permanent failure, alert customer
    if 5xx / timeout → retry with backoff
```

### As consumer (you receive)

```python
@app.post("/webhooks/stripe")
def stripe_webhook(request):
    # 1. Verify signature
    if not verify_signature(request.body, request.headers["Stripe-Signature"]):
        return 401
    
    # 2. Parse and validate
    event = json.loads(request.body)
    
    # 3. Idempotency check (process each event ID once)
    if redis.get(f"processed:{event['id']}"):
        return 200  # already processed, idempotent ack
    
    # 4. Process (preferably enqueue, не process inline)
    process_event_async(event)
    
    # 5. Mark processed
    redis.setex(f"processed:{event['id']}", ttl=7*24*3600, value="1")
    
    return 200
```

---

## Design considerations (as provider)

### Delivery guarantees

**At-least-once** — стандарт. Network может потерять response, мы retry → consumer должен быть idempotent.

**Не делайте exactly-once provider-side** — невозможно без cooperation от consumer (consumer должен dedup).

### Retry policy

Standard pattern: exponential backoff с jitter.

| Retry | Delay (с) | Cumulative |
|-------|----------|-----------|
| 1 | 0 | 0 sec |
| 2 | 60 | 1 min |
| 3 | 300 | 6 min |
| 4 | 1800 | 36 min |
| 5 | 3600 | 1.6 h |
| 6 | 10800 | 4.6 h |
| 7 | 36000 | 14.6 h |
| 8 | 86400 | 1.6 d |
| 9 | 172800 | 3.6 d |

Stripe: 3 days total, ~9 retries.
GitHub: 8 hours total.
Slack: 3 hours.

**Implementation:** message queue с visibility timeout / delayed delivery.

```
SQS:
  send message с DelaySeconds (для backoff)
  
Kafka:
  scheduler topic + consumer schedules next retry by re-publishing
```

### Signing (security)

**HMAC-SHA256** signature header:

```python
# Provider:
secret = customer.webhook_secret  # generated at registration
signature = hmac.new(secret, body, sha256).hexdigest()
request.headers["X-Signature"] = f"sha256={signature}"

# Consumer:
expected = hmac.new(secret, body, sha256).hexdigest()
received = request.headers["X-Signature"].split("=")[1]
if not constant_time_compare(expected, received):
    return 401
```

**Anti-replay:** include timestamp в headers, reject if > 5 min old:

```python
timestamp = int(request.headers["X-Timestamp"])
if abs(time.now() - timestamp) > 300:
    return 401
```

Sign `timestamp + "." + body`, не just body — иначе attacker может resend old signed message.

### Failure handling

- **Track delivery attempts** в DB (event_id, customer_id, attempts, last_response, status)
- **Dashboard** for customers — view delivery status, manually retry
- **Notification** на permanent failure (4xx, или max retries exceeded)
- **Auto-disable** webhook если все attempts fail (configurable)

### Rate limiting

Don't overwhelm slow consumer. Limit deliveries per consumer:
- Max 10 concurrent requests
- Max 100 req/sec
- If consumer slow → queue grows; alert customer

### Test mode

Provide endpoint для customer test webhook integration. Send synthetic event при command.

```
POST /api/webhooks/test
  body: { url: "...", event_type: "test" }
  → your service sends test webhook
```

---

## Design considerations (as consumer)

### Idempotency

**Critical.** Provider retries → expect to receive same event multiple times.

```
Each webhook event has unique ID. Track processed IDs (Redis с TTL = retention period).

If event_id seen → return 200 без re-processing.
```

### Process async

**Don't process inline** in webhook handler. Long processing → provider times out → retries (duplicate work + customer thinks it failed).

```
Pattern:
  POST handler:
    1. Verify signature
    2. Enqueue к internal queue
    3. Return 200 (within 1-2 seconds)
  
  Background worker:
    1. Pull from queue
    2. Actually process (can take seconds-minutes)
    3. Update DB
    4. Send response (if your business needs)
```

### Signature verification before parsing

Verify HMAC **before** trusting body content. Otherwise attacker can send malformed body that crashes parser.

### Response semantics

Most providers:
- **2xx** → success, no retry
- **4xx** → permanent failure, may disable webhook
- **5xx / timeout** → temporary, retry

→ Be careful с `400 Bad Request`: provider может permanently disable webhook (Stripe does after sustained failures). Return 5xx if your service is temporarily down.

### Logging / observability

Log every webhook receipt with event_id, timestamp, processing duration. Crucial for debugging «когда был event N?» (provider claims sent, you say not received).

---

## Patterns

### Webhook + reverse API

Provider exposes `GET /events/since/{cursor}` — fallback polling when webhooks unreliable. Consumer can rebuild state if missed webhooks.

### Webhook fan-out

Customer config: «route this event to URL A, URL B, URL C». Provider sends N parallel webhooks.

### Webhook chain

GitHub action triggers webhook → CI service → another webhook → Slack notification. Composable.

### Webhook + queue + worker

```
Provider → POST your endpoint
  → SQS queue
  → worker pool (separate scaling)
  → process
```

→ Decouples webhook receipt rate от processing rate.

---

## Anti-patterns

### Синхронная тяжёлая обработка

Webhook-handler делает запросы в БД, вызовы внешних API, шлёт email — прямо внутри HTTP-запроса. Timeout → provider ретраит → каскад.

→ **Всегда async после проверки подписи.**

### Доверие источнику без verification

Любой может прислать POST на ваш `/webhooks/stripe` без проверки подписи. Реальный атакующий может подделать события.

### Нет идемпотентности

Обработка дубликата → дублирование побочных эффектов (двойной charge, два email).

### Игнорирование порядка доставки

Webhook'и **не гарантированно** приходят по порядку (сеть, параллельные retry). Не закладывайтесь, что «событие A всегда раньше B». Используйте event timestamps + state machines.

### Захардкоженные URL'ы

URL webhook'ов делать конфигурируемыми (БД / env). Легко ротировать, тестировать, дебажить.

### Нет мониторинга

«Сколько webhook'ов упало сегодня?» — без метрик неясно. Трекать: receipt rate, длительность обработки, failure rate, depth очереди.

---

## Real-world implementations

### Stripe

- Idempotency via event ID
- HMAC SHA256 signature
- Retry 3 days, 9 attempts
- Dashboard для customer debugging
- Webhook events: 100+ types (payment, subscription, refund, dispute)

### GitHub

- HMAC SHA256 (separate secret per repo)
- Retry 8 hours
- Webhook events: push, PR, issue, release, etc.
- Web UI: see recent deliveries with full request/response

### Slack Events API

- Real-time message events
- Auth via request signing
- 3 retry attempts within 3 hours

### Twilio

- SMS / call status changes
- Retry over 24 hours

### Shopify

- 19 retry attempts over 48 hours
- HMAC with shop-specific secret
- Webhooks for orders, customers, inventory

---

## Источники

- [Stripe Webhooks Documentation](https://stripe.com/docs/webhooks) — best practice reference
- [GitHub Webhooks](https://docs.github.com/en/webhooks)
- [Slack Events API](https://api.slack.com/apis/connections/events-api)
- [Standard Webhooks (community spec, 2022)](https://github.com/standard-webhooks/standard-webhooks)
- [Building Webhooks (Brandur Leach, Stripe)](https://brandur.org/event-driven)
- [«Designing reliable Webhook integration» — RisingStack blog](https://blog.risingstack.com/event-driven-architecture-webhooks/)
