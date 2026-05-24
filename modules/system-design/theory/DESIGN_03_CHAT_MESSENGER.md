# Design Problem: Chat Messenger (WhatsApp / Slack)

Real-time messaging для миллиардов пользователей. Групповые чаты, presence, push notifications, потенциально E2E encryption.

---

## 1. Requirements

### Functional
- 1:1 и групповые чаты
- Отправка и получение сообщений (текст, media)
- Online presence (last seen)
- Статусы доставки (sent, delivered, read)
- Push notifications, когда пользователь offline
- История сообщений (поиск)

### Non-functional
- **Real-time** — p99 доставки < 500 мс
- **High availability** — 99.99%
- **Масштаб** — 2B пользователей (масштаб WhatsApp)
- **Persistent connections** — миллионы одновременных WebSocket-соединений
- **Сохранение порядка сообщений в рамках чата**

---

## 2. Estimation

```
2B зарегистрированных, 500M DAU
Каждый шлёт ~50 сообщений / день → 25B сообщений/день = ~300K msg/sec в среднем, пик ~1M

Одновременных соединений: 100M+ (активные пользователи)

Storage:
  На сообщение ~100 байт (без media)
  25B × 100 байт = 2.5 ТБ/день = 1 ПБ/год (со сжатием)
  Media — отдельно (S3)
```

---

## 3. API

```http
POST /api/v1/messages
Body: { conversationId, text, mediaUrl? }
→ 201 { messageId, sentAt }

GET /api/v1/conversations/:id/messages?cursor=...&limit=50
→ 200 { messages: [...], nextCursor }

WebSocket /ws
  → сервер шлёт новые сообщения и presence-обновления
```

---

## 4. High-level архитектура

```
Client (WS) ↔ LB (L4 passthrough или L7 со sticky) → Connection Service (stateful)
                                                          ↑↓
                                                  Pub/Sub-слой (Redis / Kafka)
                                                          ↑↓
                            Message Service ←→ Message DB (Cassandra, шард по conversationId)
                                                          ↓
                                                  Push Notification Service (APNs/FCM)
                                                  для offline-пользователей
```

---

## 5. Connection Service

**Главный challenge:** миллионы одновременных persistent connections.

### Реализация

- **WebSocket** (или MQTT для мобильных — экономнее по батарее)
- **Stateful** — каждый пользователь привязан к ноде Connection Service
- **Connection registry** — `user_id → conn_service_node_id` (Redis hash)

```
Login пользователя:
  WS handshake к LB → попадает на ноду Connection Service X
  Conn Service: registry[user_id] = nodeX
  Поддерживается heartbeat

Logout / disconnect:
  registry[user_id] = null
  Либо просто протухает heartbeat
```

### Масштабирование

- Каждая нода держит 1M+ одновременных соединений (Erlang/Elixir, Go, Rust)
- Горизонтальное добавление нод
- **L4 LB** (NLB) либо **anycast** для распределения
- Sticky session не нужны, если registry внешний

---

## 6. Доставка сообщений

```
Alice → POST сообщение {conversationId: chat:bob, text: "hi"}
  ↓
Message Service:
  1. Persist в БД (Cassandra) — по ключу conversationId
  2. Найти получателей (Bob)
  3. Поднять connection node Bob в Redis: nodeY
  4. Отправить на nodeY через internal pub/sub (Redis pub/sub или Kafka)
  5. nodeY пушит сообщение в WebSocket Bob'а
  6. Если Bob offline → push notification (APNs/FCM)
  7. Acknowledge Alice'у «delivered»
```

### Pub/Sub-слой

Когда у нас 1000 conn-нод, сообщение от Alice к Bob — на какую ноду слать?

Вариант 1: **прямая маршрутизация** — смотрим ноду Bob'а, шлём TCP-сообщение туда. Точечно.

Вариант 2: **pub/sub broadcast** — публикуем сообщение по user_id в pub/sub. Каждая нода подписана на тех user_id, что к ней подключены.

WhatsApp использует подход 1 (точная маршрутизация).

---

## 7. Group chat (1000+ участников)

Прямой fanout ×1000 становится дорогим.

### Стратегия

**Server-side fanout на группу:**
```
Alice шлёт в group:xyz →
  Message Service:
    Persist одно сообщение в БД (conversationId = group:xyz)
    Берём список участников (кэшированный)
    Для каждой online-ноды участника → шлём через pub/sub
    Offline участники → push notification
```

**Scalability:** список участников кэширован, сообщение сохраняется один раз, fanout идёт параллельно.

### Очень большие группы (100K+ участников)

Slack-каналы, Discord-серверы — другой паттерн: **pull на чтение**, не push.

```
Участники подписываются на group-channel (Redis pub/sub по channel ID)
Conn service пересылает сообщения подписчикам
```

Discord использует Erlang/Elixir с процессами per-channel (миллионы concurrent).

---

## 8. Data model

### Messages (Cassandra)

```
TABLE messages (
    conversation_id TEXT,
    sent_at TIMEUUID,
    sender_id BIGINT,
    text TEXT,
    media_url TEXT,
    PRIMARY KEY (conversation_id, sent_at)
) WITH CLUSTERING ORDER BY (sent_at DESC);
```

Sharding key = `conversation_id` → все сообщения чата на одной partition.

Чтение: «последние 50 сообщений в чате X» → single-partition запрос, очень быстро.

### Conversations / Members

```
TABLE conversations (id, type, created_at, last_message_at, ...)
TABLE conversation_members (conversation_id, user_id, joined_at, role)
```

Хранится в PostgreSQL (relational, меньший масштаб).

### Indexes

- Чтобы пользователь X видел список своих чатов — индекс `(user_id) → conversation_ids` (либо кэш в Redis)

---

## 9. Статусы доставки

```
sent      → сервер получил, persisted
delivered → устройство получателя получило (WS push или fetch)
read      → получатель пометил прочитанным
```

Отслеживается через отдельный поток событий или metadata-колонку в сообщении.

С учётом приватности: «read»-статус может быть отключаемым.

---

## 10. Presence (статус online)

```
На connect: HSET presence user:123 online "true" lastSeen now()
На disconnect: HSET presence user:123 online "false"
Периодический heartbeat обновляет TTL

Друзья могут читать: HGETALL friend:user_id presence
```

Scaling-нюанс: «last seen» обновляется при каждом открытии приложения → высокая частота записей. Throttle до ~1 обновления в минуту.

Privacy: возможность скрыть last seen / online status.

---

## 11. Offline и push notifications

Если получатель offline (нет активной WS-сессии):
- Шлём push через APNs (iOS), FCM (Android)
- Сохраняем сообщение в БД
- На reconnect — клиент дотягивает пропущенные сообщения

Payload push'а должен быть маленьким: «У вас новое сообщение от Alice» — без содержимого (для приватности).

---

## 12. End-to-End encryption (E2E)

Паттерн WhatsApp (Signal Protocol):
- Каждое устройство генерирует ключевую пару
- Публичный ключ загружается на сервер
- Отправитель шифрует сообщение публичным ключом получателя
- Сервер хранит **зашифрованный blob** и не может прочитать содержимое
- Получатель расшифровывает приватным ключом

**Следствия для архитектуры:**
- Сервер не может искать по содержимому
- Управление ключами в группах сложно (rekey при изменении состава)
- Backup непрост (зашифрованный backup требует отдельного ключа)
- Поиск по истории нельзя предложить из коробки (только client-side индекс)

---

## 13. Sync между устройствами

У пользователя phone + laptop + tablet. Сообщение, отправленное с телефона, должно появиться на ноутбуке за секунды.

```
У каждого пользователя несколько соединений (одно на устройство)
Сообщения хранятся централизованно
На connect устройство подтягивает пропущенные сообщения с сервера
Sync-состояние: отслеживаем, какое устройство получило какое сообщение
```

---

## 14. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| Падает connection-нода | Клиенты переподключаются (LB перенаправит), состояние в БД |
| Запись в БД упала | Retry, ошибка отправителю; возможен дубль, если retry дойдёт обоими путями |
| Раздел в pub/sub | Часть сообщений не доходит до offline-помеченных пользователей; отправитель видит «sent», получатель догонит на reconnect |
| Push notification упал | Retry через push-сервис; in-app pull при следующем открытии |
| Получатель удалил аккаунт | Отправитель видит «delivered», сообщение хранится, но прочитать некому |

---

## 15. Trade-offs

### Pull vs Push

- **WebSocket push (текущий дизайн)** — real-time, но stateful, дорогая инфраструктура
- **Long polling fallback** — для клиентов за firewall'ом
- **Чистый polling** — плохая latency, использовалось исторически (ранний Skype)

### Centralized vs P2P

- Centralized — сервер посередине
- P2P (WebRTC) — напрямую между устройствами, сервер только для signalling

WhatsApp и Signal — централизованные (с E2E encryption). Skype изначально был P2P, перешёл на централизованный.

### Хранить вечно vs ephemeral

WhatsApp исторически: сообщения хранятся до доставки и удаляются с сервера. Сейчас многие хранят бессрочно в БД.

Snapchat / Telegram Secret Chats — ephemeral, удаляются после прочтения.

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 12 «Design a Chat System»
- [WhatsApp Engineering — Scaling to 2M concurrent (Erlang)](https://www.erlang-solutions.com/blog/the-genius-of-the-erlang-scheduler-and-the-tracing-tools-of-the-erlang-vm/)
- [Discord Engineering — Voice and Chat infrastructure](https://discord.com/blog/)
- [Slack Engineering — Real-time messaging at scale](https://slack.engineering/real-time-messaging/)
- [Signal Protocol whitepaper](https://signal.org/docs/)
- [Hello Interview — Chat System](https://www.hellointerview.com/learn/system-design/problem-breakdowns/whatsapp)
