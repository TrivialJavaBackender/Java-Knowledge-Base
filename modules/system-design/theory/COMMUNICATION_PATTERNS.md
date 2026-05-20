# Communication Patterns

Когда сервер должен отправить данные клиенту: push (notification), long polling, SSE, WebSocket, gRPC streaming. Trade-offs latency, complexity, infrastructure cost.

---

## Сравнительная таблица

| Pattern | Direction | Persistent connection | Latency | Best for |
|---------|-----------|----------------------|---------|----------|
| **Short polling** | Client→Server (req/resp) | No | Polling interval | Simple, batch updates |
| **Long polling** | Server→Client (held resp) | Yes (during wait) | Near-real-time | Bridge to real-time без infra change |
| **SSE** | Server→Client (one-way) | Yes (HTTP) | Real-time | Notifications, logs, news feeds |
| **WebSocket** | Bidirectional | Yes | Real-time | Chat, games, collaborative |
| **gRPC streaming** | Bidirectional (HTTP/2) | Yes | Real-time | Internal services, typed contracts |
| **Webhooks** | Server→External Server | No (one-shot HTTP) | Async | B2B integration, async events |

---

## Short Polling

Клиент периодически делает GET; сервер возвращает данные если есть.

```
Client: GET /messages?since=12345     → 200 [] (nothing new)
        wait 5 sec
Client: GET /messages?since=12345     → 200 [{...}] (new!)
```

- ✓ Simple, любой HTTP сервер работает
- ✓ Stateless on server side
- ✗ **Latency** = polling interval (5-30 sec typical)
- ✗ **Wasted requests** when no new data
- ✗ Server load even when nothing happens

**When OK:** updates infrequent, slight delay acceptable (RSS, dashboard refresh).

---

## Long Polling

Клиент делает GET; сервер **держит connection open** пока есть новые данные (или timeout).

```
Client: GET /messages?since=12345
Server: (waits... checking for new messages every 100 ms or via internal event)
Server: (new message arrives) → 200 [{msg}]

Client immediately reconnects:
Client: GET /messages?since=12346     → (waits)
```

- ✓ **Near-real-time** delivery (~ ms latency после event)
- ✓ Standard HTTP — works through proxies, firewalls
- ✓ No special infrastructure
- ✗ Server holds one connection per client (resource cost)
- ✗ Reconnect overhead каждые N seconds (server-side timeout)
- ✗ Тяжелее scaling — server должен поддерживать many concurrent connections

**When OK:** real-time-ish app, не готов вкладываться в WebSocket infrastructure.

Used by: Facebook Messenger (раньше), gmail.

---

## Server-Sent Events (SSE)

Server keeps **single long-lived HTTP connection**, шлёт data в text/event-stream format. **One-way** (server → client only).

```
Client: GET /events
        Accept: text/event-stream
Server: HTTP/1.1 200 OK
        Content-Type: text/event-stream
        Cache-Control: no-cache
        Connection: keep-alive

        data: {"type": "message", "text": "Hello"}\n\n
        data: {"type": "message", "text": "World"}\n\n
        ...
```

JS API:
```javascript
const events = new EventSource('/events');
events.onmessage = (e) => console.log(e.data);
events.addEventListener('typing', (e) => ...);
```

- ✓ **Standard HTTP** — works through CDN, proxies, firewalls
- ✓ Auto-reconnect built into browser
- ✓ Simple text protocol
- ✗ **One-way** — client → server via separate POST/etc.
- ✗ Browser limit: 6 connections per origin per browser
- ✗ Doesn't support binary natively (text-based)

**When use:** server → client notifications (real-time logs, stock prices, notifications). Modern alternative к long polling — strictly better for unidirectional push.

---

## WebSocket

**Bidirectional**, persistent TCP connection через HTTP Upgrade. Binary or text frames.

```
Client: GET /chat HTTP/1.1
        Upgrade: websocket
        Connection: Upgrade
        Sec-WebSocket-Key: ...

Server: HTTP/1.1 101 Switching Protocols
        Upgrade: websocket
        Sec-WebSocket-Accept: ...

(теперь обычный bidirectional TCP communication)
Client → Server: msg1
Server → Client: msg2 (anytime)
Client → Server: msg3
```

- ✓ **True bidirectional** real-time
- ✓ Low overhead (нет HTTP headers на каждое сообщение)
- ✓ Binary support
- ✗ Не cacheable (плохо подходит для CDN)
- ✗ Stateful (sticky session required, или external state)
- ✗ Firewall / proxy issues — некоторые corporate proxies блокируют
- ✗ Scaling tricky — need to maintain millions of concurrent connections

**Use cases:** chat (WhatsApp, Slack, Discord), real-time games, collaborative editing (Figma, Google Docs), live dashboards (trading), IoT.

**Infrastructure:**
- WebSocket-capable LB (AWS ALB, HAProxy, Envoy все support)
- Connection state management (e.g., Redis pub/sub for cross-server messaging)
- Sticky sessions OR pub/sub backbone

---

## gRPC streaming

HTTP/2-based RPC. Поддерживает 4 patterns:
- **Unary** — request/response (как REST)
- **Server streaming** — single request, server streams multiple responses
- **Client streaming** — client streams multiple requests, single response
- **Bidirectional streaming** — both stream concurrently

```protobuf
service Notifications {
  rpc Subscribe(SubscribeRequest) returns (stream NotificationEvent);  // server stream
  rpc Chat(stream ChatMessage) returns (stream ChatMessage);            // bidi
}
```

- ✓ Strongly typed contracts (Protobuf)
- ✓ HTTP/2 multiplexing (one connection, many streams)
- ✓ Binary efficient
- ✓ Code generation для multiple languages
- ✗ Не browser-native (нужен gRPC-Web proxy)
- ✗ Сложнее дебажить чем JSON HTTP
- ✗ Не cacheable как REST

**Use cases:** Internal microservices (especially Java/Go/Rust ecosystems), iOS/Android mobile (gRPC native), high-perf APIs.

**Real-world:** Google internal (origin of gRPC), Netflix (internal), Lyft, Square.

---

## Сравнение по scenarios

### Real-time chat

WebSocket (bidirectional). Discord, Slack, WhatsApp.

### Live news feed / dashboard

SSE (one-way push enough). Twitter timeline, stock prices, log streams.

### Mobile push notifications

**APNs / FCM** — не WebSocket. Native push delivery system (Apple / Google maintain). Server отправляет push via APNs/FCM API; OS delivers даже если app не запущено.

### Order matching / trading

gRPC bidirectional (Lyft, Robinhood) — typed, low latency, internal.

### Multiplayer game

WebSocket для tick-based, UDP для low-latency action (WebRTC data channels).

### Webhook (B2B integration)

External server → your server HTTP POST. Async, retry on failure.

---

## Backpressure

В streaming protocols — producer faster than consumer. Без backpressure → memory blowup.

### Reactive Streams spec

Standardized в Java (Flow.Subscriber) / RxJava / Reactor / Akka. Consumer signals «request N more items» — producer не шлёт пока запрошено.

```java
Subscription.request(n)  // I can handle n more
Producer: emits up to n items, then waits for next request
```

### Kafka consumer

Pull-based — consumer запрашивает poll(). Если slow — Kafka просто хранит messages until consumer catches up (retention period limit).

### gRPC streaming flow control

HTTP/2 has flow control (window size). gRPC inherits — consumer не overwhelm'ится.

### WebSocket

No built-in flow control. **Application must implement** — explicit ACKs, throttling, or client-side back-pressure signal.

---

## Webhooks

Server-to-server async notifications. «When event X happens, POST to this URL».

### Pattern

```
Stripe → POST https://yourapp.com/webhooks/stripe
  body: { event: "payment_succeeded", data: {...} }
  headers: { Stripe-Signature: ... }

Your app:
  - verify signature (HMAC)
  - process idempotently
  - respond 200 (or 5xx triggers retry)
```

### Delivery semantics

- **At-least-once delivery** — sender retries on 5xx / timeout
- **Идемпотентность receiver** — обязательна (one event ID → process once)
- **Retry policy** — exponential backoff (Stripe: 3 days, ~9 retries; Slack: 3 hours)
- **DLQ on receiver side** — failed processing → store for manual review

### Security

- **HMAC signature** — sender signs body with shared secret, receiver verifies → prevents spoofing
- **Replay attack prevention** — include timestamp, reject if old
- **Allowlist sender IPs** — extra defense
- **mTLS** — for B2B critical (banking, healthcare)

### Examples

- Stripe webhooks (payment events)
- GitHub webhooks (push, PR, issue events)
- Slack Event API (messages, mentions)
- Twilio (SMS delivery status)
- Shopify (order, customer events)

---

## Scaling considerations

### WebSocket millions of concurrent connections

- **L4 LB (NLB)** — pass through, doesn't terminate. Backend implements WS.
- **Sticky session** — same user → same backend (или **stateless через Redis pub/sub**)
- **Connection limit per backend** — tune (Linux: 1M+ FDs / process possible с tuning)
- **Memory per connection** — minimize (avoid heavy state per session)
- **Heartbeat / ping** — detect dead connections (every 30s), remove

**Real numbers:**
- WhatsApp Erlang: 2M concurrent connections / server (2012)
- Discord Elixir: ~ 1.2M concurrent / server (similar)
- Custom C++ servers: 5M+

### SSE scaling

- **CDN doesn't help** (long-lived connection, не cached)
- Similar к WebSocket — connection-per-user infrastructure
- Slightly easier (just HTTP, no upgrade dance)

### Hybrid

Many systems: SSE / WebSocket для active users + push notification (APNs/FCM) для inactive (app closed). Better battery life on mobile.

---

## Источники

- [RFC 6455 — The WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
- [W3C Server-Sent Events](https://www.w3.org/TR/eventsource/)
- [HTML5 EventSource MDN](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [gRPC Documentation](https://grpc.io/docs/)
- [Reactive Streams Specification](https://www.reactive-streams.org/)
- [Discord Engineering — Scaling to 11M+ concurrent users](https://discord.com/blog/) — Elixir/Erlang WS infrastructure
- [WhatsApp — Erlang scalability](https://www.erlang-solutions.com/blog/the-genius-of-the-erlang-scheduler-and-the-tracing-tools-of-the-erlang-vm/) — WS-like patterns
- [Stripe — Designing webhooks (events.stripe.com)](https://stripe.com/docs/webhooks)
- [Discord — Voice servers WebRTC](https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc)
