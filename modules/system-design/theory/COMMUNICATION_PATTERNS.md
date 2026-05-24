# Communication Patterns

Способы доставки данных от сервера клиенту: push (notification), long polling, SSE, WebSocket, gRPC streaming. Trade-off между latency, сложностью и стоимостью инфраструктуры.

---

## Сравнительная таблица

| Pattern | Направление | Persistent connection | Latency | Подходит для |
|---------|-------------|----------------------|---------|--------------|
| **Short polling** | Client → Server (req/resp) | Нет | Интервал опроса | Простые обновления, batch-сценарии |
| **Long polling** | Client ↔ Server (held resp) | На время ожидания | Близко к real-time | Переход к real-time без отдельной инфраструктуры |
| **SSE** | Server → Client (one-way) | Да (HTTP) | Real-time | Notifications, логи, news feed |
| **WebSocket** | Bidirectional | Да | Real-time | Chat, игры, collaborative editing |
| **gRPC streaming** | Bidirectional (HTTP/2) | Да | Real-time | Internal-сервисы, типизированные контракты |
| **Webhooks** | Server → внешний Server | Нет (одноразовый HTTP) | Async | B2B-интеграция, асинхронные события |

---

## Short Polling

Клиент периодически делает GET; сервер возвращает данные, если они есть.

```
Client: GET /messages?since=12345     → 200 [] (нет нового)
        wait 5 sec
Client: GET /messages?since=12345     → 200 [{...}] (есть!)
```

- ✓ Простая модель, работает на любом HTTP-сервере
- ✓ Stateless на стороне сервера
- ✗ **Latency** = интервал опроса (типично 5–30 сек)
- ✗ Пустые запросы, когда данных нет
- ✗ Нагрузка на сервер даже при отсутствии событий

**Когда уместно:** обновления редкие, небольшая задержка приемлема (RSS, обновление дашборда).

---

## Long Polling

Клиент делает GET; сервер **держит соединение открытым** пока не появится новое сообщение (или не сработает timeout).

```
Client: GET /messages?since=12345
Server: (ожидает... проверяет очередь каждые 100 мс или по внутреннему событию)
Server: (приходит сообщение) → 200 [{msg}]

Клиент сразу переоткрывает запрос:
Client: GET /messages?since=12346     → (ожидает)
```

- ✓ Доставка близко к real-time (миллисекунды после события)
- ✓ Стандартный HTTP — проходит через proxy и firewall
- ✓ Не требует специальной инфраструктуры
- ✗ Сервер держит одно соединение на клиента (расход ресурсов)
- ✗ Overhead на переоткрытие каждые N секунд (server-side timeout)
- ✗ Тяжелее масштабировать — сервер должен поддерживать много одновременных соединений

**Когда уместно:** приложение почти real-time, но WebSocket-инфраструктуру разворачивать не хочется.

Исторически использовали: Facebook Messenger, Gmail.

---

## Server-Sent Events (SSE)

Сервер держит **одно длинное HTTP-соединение** и шлёт данные в формате `text/event-stream`. **One-way** (server → client).

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

- ✓ **Стандартный HTTP** — проходит через CDN, proxy, firewall
- ✓ Auto-reconnect встроен в браузер
- ✓ Простой текстовый протокол
- ✗ **One-way** — обратный канал нужно делать отдельно (например, через POST)
- ✗ Лимит браузера — 6 соединений на origin
- ✗ Бинарные данные нативно не поддерживаются (текст-based протокол)

**Когда использовать:** server → client notifications (real-time логи, котировки, события). Современная альтернатива long polling — строго лучше для one-way push.

---

## WebSocket

**Bidirectional**, persistent TCP-соединение через HTTP Upgrade. Бинарные или текстовые фреймы.

```
Client: GET /chat HTTP/1.1
        Upgrade: websocket
        Connection: Upgrade
        Sec-WebSocket-Key: ...

Server: HTTP/1.1 101 Switching Protocols
        Upgrade: websocket
        Sec-WebSocket-Accept: ...

(дальше — обычный bidirectional TCP-канал)
Client → Server: msg1
Server → Client: msg2 (в любой момент)
Client → Server: msg3
```

- ✓ Настоящий bidirectional real-time
- ✓ Низкий overhead — HTTP-заголовков на каждое сообщение нет
- ✓ Поддержка бинарных данных
- ✗ Не кэшируется, плохо подходит для CDN
- ✗ Stateful — нужны sticky session или внешнее хранение состояния
- ✗ Проблемы с firewall и proxy — некоторые corporate proxy блокируют upgrade
- ✗ Масштабирование непростое — миллионы одновременных соединений

**Use cases:** chat (WhatsApp, Slack, Discord), real-time-игры, collaborative editing (Figma, Google Docs), live-дашборды (trading), IoT.

**Инфраструктура:**
- Load balancer с поддержкой WebSocket (AWS ALB, HAProxy, Envoy)
- Управление состоянием соединений (например, Redis pub/sub для cross-server messaging)
- Sticky session либо pub/sub-«хребет» между серверами

---

## gRPC streaming

HTTP/2-based RPC. Поддерживает 4 паттерна:
- **Unary** — request/response (как REST)
- **Server streaming** — один request, сервер стримит много response'ов
- **Client streaming** — клиент стримит много request'ов, один response
- **Bidirectional streaming** — обе стороны стримят одновременно

```protobuf
service Notifications {
  rpc Subscribe(SubscribeRequest) returns (stream NotificationEvent);  // server stream
  rpc Chat(stream ChatMessage) returns (stream ChatMessage);            // bidi
}
```

- ✓ Строго типизированные контракты (Protobuf)
- ✓ HTTP/2 multiplexing — одно соединение, много streams
- ✓ Эффективный бинарный формат
- ✓ Code generation для большинства языков
- ✗ Не нативен для браузера (нужен gRPC-Web прокси)
- ✗ Сложнее дебажить, чем JSON over HTTP
- ✗ Не кэшируется так, как REST

**Use cases:** internal микросервисы (особенно Java / Go / Rust), мобильные клиенты iOS/Android (gRPC native), высокопроизводительные API.

**Real-world:** Google internal (родина gRPC), Netflix (internal), Lyft, Square.

---

## Сравнение по сценариям

### Real-time chat

WebSocket (bidirectional). Discord, Slack, WhatsApp.

### Live news feed / dashboard

SSE (one-way push достаточно). Twitter timeline, котировки, лог-стримы.

### Mobile push notifications

**APNs / FCM** — не WebSocket. Native push delivery от Apple / Google. Сервер шлёт push через API APNs/FCM; ОС доставляет, даже если приложение не запущено.

### Order matching / trading

gRPC bidirectional (Lyft, Robinhood) — типизированные сообщения, низкая latency, internal-only.

### Multiplayer game

WebSocket для tick-based-логики, UDP (WebRTC data channels) для low-latency action.

### Webhook (B2B integration)

External server → ваш сервер через HTTP POST. Async, retry on failure.

---

## Backpressure

В streaming-протоколах producer может быть быстрее consumer'а. Без backpressure → переполнение памяти.

### Reactive Streams spec

Стандартизированный API в Java (`Flow.Subscriber`), RxJava, Reactor, Akka. Consumer сигнализирует «request N more items» — producer не шлёт больше, чем запрошено.

```java
Subscription.request(n)  // могу обработать ещё n
Producer: эмитит до n элементов, дальше ждёт следующий request
```

### Kafka consumer

Pull-based: consumer сам вызывает `poll()`. Если он медленный — Kafka хранит сообщения до тех пор, пока consumer не догонит (в пределах retention).

### gRPC streaming flow control

В HTTP/2 встроен flow control (window size). gRPC наследует его — consumer не будет завален.

### WebSocket

Встроенного flow control нет. **Приложение реализует само** — явные ACK, throttling, либо client-side backpressure-сигнал.

---

## Webhooks

Server-to-server асинхронные уведомления. «Когда происходит событие X — отправь POST на этот URL».

### Pattern

```
Stripe → POST https://yourapp.com/webhooks/stripe
  body: { event: "payment_succeeded", data: {...} }
  headers: { Stripe-Signature: ... }

Ваше приложение:
  - проверить подпись (HMAC)
  - обработать идемпотентно
  - вернуть 200 (5xx → retry от отправителя)
```

### Семантика доставки

- **At-least-once delivery** — отправитель повторяет при 5xx или timeout
- **Идемпотентность receiver** — обязательна (один event ID → одна обработка)
- **Retry policy** — exponential backoff (Stripe: 3 дня, ~9 попыток; Slack: 3 часа)
- **DLQ на стороне receiver** — неудачные обработки складываются для разбора вручную

### Безопасность

- **HMAC signature** — отправитель подписывает тело общим секретом, receiver проверяет → защита от подделки
- **Защита от replay attack** — включить timestamp в payload, отвергать устаревшие запросы
- **Allowlist по IP отправителя** — дополнительная мера
- **mTLS** — для критичного B2B (банкинг, healthcare)

### Примеры

- Stripe webhooks (события платежей)
- GitHub webhooks (push, PR, issue events)
- Slack Event API (сообщения, упоминания)
- Twilio (статусы доставки SMS)
- Shopify (события заказов и клиентов)

---

## Scaling considerations

### Миллионы одновременных WebSocket-соединений

- **L4 LB (NLB)** — pass-through, не терминирует. WebSocket обрабатывается на backend.
- **Sticky session** — один и тот же пользователь приходит на тот же backend (либо stateless через Redis pub/sub)
- **Лимит соединений на backend** — настраивается (на Linux достижимо 1M+ файловых дескрипторов на процесс)
- **Память на соединение** — минимизировать (не хранить тяжёлое состояние per session)
- **Heartbeat / ping** — каждые ~30 сек, удалять мёртвые соединения

**Цифры из практики:**
- WhatsApp на Erlang: 2M одновременных соединений на сервер (2012)
- Discord на Elixir: ~1.2M на сервер
- Кастомные C++ серверы: 5M+

### SSE scaling

- **CDN не помогает** (long-lived соединение, не кэшируется)
- Похоже на WebSocket — инфраструктура «соединение на пользователя»
- Чуть проще — это просто долгий HTTP, без upgrade handshake

### Гибрид

Многие системы: SSE / WebSocket для активных пользователей + push notifications (APNs/FCM) для неактивных (приложение закрыто). Лучше для батареи на мобильных.

---

## Источники

- [RFC 6455 — The WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
- [W3C Server-Sent Events](https://www.w3.org/TR/eventsource/)
- [HTML5 EventSource MDN](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [gRPC Documentation](https://grpc.io/docs/)
- [Reactive Streams Specification](https://www.reactive-streams.org/)
- [Discord Engineering — Scaling to 11M+ concurrent users](https://discord.com/blog/) — WebSocket-инфраструктура на Elixir/Erlang
- [WhatsApp — Erlang scalability](https://www.erlang-solutions.com/blog/the-genius-of-the-erlang-scheduler-and-the-tracing-tools-of-the-erlang-vm/)
- [Stripe — Designing webhooks](https://stripe.com/docs/webhooks)
- [Discord — Voice servers WebRTC](https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc)
