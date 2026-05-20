# Design Problem: Chat Messenger (WhatsApp/Slack)

Real-time messaging с миллиардом пользователей. Group chats, presence, push notifications, потенциально E2E encryption.

---

## 1. Requirements

### Functional
- 1:1 chats, group chats
- Send / receive messages (text, media)
- Online presence (last seen)
- Message delivery status (sent, delivered, read)
- Push notifications когда offline
- Message history (search)

### Non-functional
- **Real-time** — p99 message delivery < 500ms
- **High availability** — 99.99%
- **Scalable** — 2B users (WhatsApp scale)
- **Connection persistence** — millions of concurrent WS connections
- **Message ordering per chat**

---

## 2. Estimation

```
2B total users, 500M DAU
Each sends ~ 50 messages / day → 25B messages/day = ~ 300K msg/sec avg, ~ 1M peak

Concurrent connections: 100M+ (active users)

Storage:
  Per message ~ 100 bytes (without media)
  25B × 100B = 2.5 TB/day = 1 PB/year (compressed)
  Media: separate (S3)
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
  → server pushes new messages, presence updates
```

---

## 4. High-level architecture

```
Client (WS) ↔ LB (L4 passthrough or L7 with sticky) → Connection Service (stateful)
                                                          ↑↓
                                                  Pub/Sub layer (Redis / Kafka)
                                                          ↑↓
                            Message Service ←→ Message DB (Cassandra, sharded by conversationId)
                                                          ↓
                                                  Push Notification Service (APNs/FCM)
                                                  for offline users
```

---

## 5. Connection Service

**Главный challenge:** millions of concurrent persistent connections.

### Implementation

- **WebSocket** (или MQTT для mobile с лучшим power)
- **Stateful** — каждый user attached к conn service node
- **Connection registry** — `user_id → conn_service_node_id` (Redis hash)

```
User login:
  WS handshake к LB → routed к Connection Service node X
  Conn Service: registry[user_id] = nodeX
  Maintain heartbeat

User logout / disconnect:
  registry[user_id] = null
  Or just timeout heartbeat
```

### Scaling

- Each node handles 1M+ concurrent connections (Erlang/Elixir, Go, Rust)
- Add nodes horizontally
- Use **L4 LB** (NLB) или **anycast** для distribution
- Sticky session not needed if registry external

---

## 6. Message delivery

```
Alice → POST message {conversationId: chat:bob, text: "hi"}
  ↓
Message Service:
  1. Persist в DB (Cassandra) — keyed by conversationId
  2. Lookup recipients (Bob)
  3. Look up Bob's connection node in Redis: nodeY
  4. Send к nodeY via internal pub/sub (Redis pub/sub or Kafka)
  5. nodeY pushes message через Bob's WebSocket
  6. If Bob offline → push notification (APNs/FCM)
  7. Acknowledge to Alice "delivered"
```

### Pub/Sub layer

When you have 1000 conn nodes, message от Alice к Bob — какой node?

Option 1: **Direct routing** — lookup Bob's node, send TCP к нему. Точечно.

Option 2: **Pub/sub broadcast** — publish message с user_id к pub/sub. Каждый node subscribes к user_ids that connected к нему.

WhatsApp uses approach 1 (precise routing).

---

## 7. Group chat (1000+ members)

Direct fanout 1000× становится expensive.

### Strategy

**Server-side fanout per group:**
```
Alice sends to group:xyz →
  Message Service:
    Persist 1 message в DB (conversationId = group:xyz)
    Fetch group members (cached)
    For each member's online node → send via pub/sub
    Offline members → push notification
```

**Scalability:** members list cached, message persisted once, fanout in parallel.

### Very large groups (100K+ members)

Like Slack channels, Discord servers — different pattern: **pull on read**, not push.

```
Members subscribe к group channel (Redis pub/sub by channel ID)
Conn service forwards messages to their subscribers
```

Discord uses Erlang/Elixir с per-channel processes (millions concurrent).

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

Read: «recent 50 messages в chat X» → single partition query, very fast.

### Conversations / Members

```
TABLE conversations (id, type, created_at, last_message_at, ...)
TABLE conversation_members (conversation_id, user_id, joined_at, role)
```

Stored в PostgreSQL (relational, smaller scale).

### Indexes

- For user X to see their chat list — index `(user_id) → conversation_ids` (либо cached в Redis)

---

## 9. Message delivery status

```
sent      → server received, persisted
delivered → recipient device received (WS push or fetched)
read      → recipient marked as read
```

Track via separate event stream или metadata column on message.

For E2E privacy concerns: «read» status может быть opt-out.

---

## 10. Presence (online status)

```
On connect: HSET presence user:123 online "true" lastSeen now()
On disconnect: HSET presence user:123 online "false"
Periodic heartbeat resets TTL

Friends can query: HGETALL friend:user_id presence
```

Scalability concern: «last seen» updates каждый раз user opens app → high write rate. Throttle к ~ 1 update per minute.

Privacy: hide last seen / online status optional.

---

## 11. Offline / push notifications

When recipient offline (no active WS connection):
- Send push via APNs (iOS), FCM (Android)
- Store message в DB
- On reconnect: fetch missed messages

Push payload should be tiny: «You have a new message from Alice» — без content (for privacy).

---

## 12. End-to-End encryption (E2E)

WhatsApp pattern (Signal Protocol):
- Each device generates key pair
- Public key uploaded к server
- Sender encrypts message с recipient's public key
- Server stores **encrypted blob** — cannot read content
- Recipient decrypts с private key

**Implications for design:**
- Server cannot search messages content
- Group key management complex (rekeying when members change)
- Backup сложен (encrypted backup needs separate key)
- Cannot offer search across history (если только client-side index)

---

## 13. Sync across devices

User has phone + laptop + tablet. Message sent on phone → seen on laptop within seconds.

```
Each user has multiple connections (one per device)
Messages stored centrally
On connect: device fetches missed messages from server
Sync state: track which device received which message
```

---

## 14. Failure modes

| Scenario | Handling |
|----------|----------|
| Connection node crashes | Clients reconnect (LB re-routes), state in DB |
| DB write fails | Retry, return error to sender; potential dup if retry hits both |
| Pub/sub partition | Some messages don't reach offline-marked users; sender shows «sent» but recipient won't receive until reconnect |
| Push notification fails | Retry via push service; in-app pull on next open |
| Recipient deleted account | Sender sees «delivered», message stored but un-readable |

---

## 15. Trade-offs

### Pull vs Push

- **WS push (this design)** — real-time, but stateful, expensive infrastructure
- **Long polling fallback** — fall back for browsers behind firewalls
- **Pure pull (polling)** — bad latency, used historically (early Skype)

### Centralized vs P2P

- Centralized — server middleware
- P2P (WebRTC) — direct device-to-device, server only для signalling

WhatsApp / Signal — centralized (E2E encrypted). Skype originally P2P, switched to centralized.

### Storage forever vs ephemeral

WhatsApp historically: messages held until delivered, then deleted from server. Modern: keep forever in DB.

Snapchat / Telegram Secret Chats — ephemeral, deleted после read.

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — Ch. 12 «Design a Chat System»
- [WhatsApp Engineering — Scaling to 2M concurrent (Erlang)](https://www.erlang-solutions.com/blog/the-genius-of-the-erlang-scheduler-and-the-tracing-tools-of-the-erlang-vm/)
- [Discord Engineering — Voice and Chat infrastructure](https://discord.com/blog/)
- [Slack Engineering — Real-time messaging at scale](https://slack.engineering/real-time-messaging/)
- [Signal Protocol whitepaper](https://signal.org/docs/)
- [Hello Interview — Chat System](https://www.hellointerview.com/learn/system-design/problem-breakdowns/whatsapp)
