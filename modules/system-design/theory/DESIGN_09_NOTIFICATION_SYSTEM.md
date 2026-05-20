# Design Problem: Notification System

Send notifications через multiple channels (email, SMS, push, in-app) к миллионам пользователей. Fan-out, deduplication, retry, user preferences.

---

## 1. Requirements

### Functional
- Send notification via channels: email, SMS, mobile push (APNs/FCM), in-app, web push
- User preferences (opt-out per channel)
- Templates (i18n, personalization)
- Scheduled notifications (send tomorrow 8am)
- Batch / bulk send (campaigns)
- Deliver receipts (sent / opened / clicked)

### Non-functional
- **Reliability** — at-least-once delivery
- **Throughput** — millions of notifications / hour for marketing
- **Latency** — transactional (password reset) < 5 sec
- **Cost-efficient** — SMS expensive (cents each), use sparingly

---

## 2. Estimation

```
100M MAU, 30 notifications/user/day avg
  → 3B notifications/day = 35K/sec average
  → Peak 10× = 350K/sec (marketing burst, breaking news)

Channels distribution typical:
  Push: 60%
  Email: 30%
  In-app: 8%
  SMS: 2% (expensive)
```

---

## 3. API

```http
POST /api/v1/notifications
Body: {
  templateId: "order_shipped",
  recipientUserId: 123,
  channels: ["push", "email"],
  data: { orderId: "...", trackingUrl: "..." },
  scheduledAt?: "2024-12-25T08:00:00Z"
}
→ 202 Accepted { notificationId }

GET /api/v1/notifications/:id
→ { status, deliveryAttempts, ... }
```

---

## 4. Architecture

```
Client services (Order, Auth, Marketing) → emit events
  ↓
Notification Service (API)
  ↓ (enqueue)
Kafka topic: notifications
  ↓ (consumer)
Notification Workers (one per channel type)
  ├── Push Worker → APNs / FCM
  ├── Email Worker → SES / SendGrid / Mailgun
  ├── SMS Worker → Twilio
  └── In-App Worker → store in DB, push via WebSocket if user online
       
Side-data:
  - User Service (preferences, contacts, device tokens)
  - Template Service (rendered templates)
  - Delivery DB (audit log)
```

---

## 5. Workflow

```
1. Order service: «order shipped, notify user»
2. → POST /api/v1/notifications
3. Notification Service:
   a. Validate request
   b. Fetch user preferences (cached): «push enabled, email enabled»
   c. Fetch template (cached): рендерить с data
   d. Apply rate limiting per user (max 10 notifs/hour для UX)
   e. Publish event к Kafka topic per channel
4. Channel Workers consume:
   a. Push Worker:
      - Fetch device tokens from User Service
      - Call APNs / FCM
      - Log delivery attempt
      - Mark delivered (or retry on failure)
```

---

## 6. Channel-specific concerns

### Email (SES / SendGrid)

- Bounce handling (hard / soft) → mark email invalid
- Spam complaints → opt-out user
- Templates: MJML or Handlebars
- Inline tracking (open pixel, click redirect)

### SMS (Twilio)

- Expensive (10× more than email)
- Use sparingly (security codes, urgent only)
- Geographic restrictions
- Rate limit globally (Twilio account-level)

### Push (APNs / FCM)

- APNs (iOS) — Apple's HTTP/2 API
- FCM (Android + Web) — Google's
- Device token management — tokens expire, rotate
- Silent push — no UI alert, just data update

### In-app

- Stored в DB (notifications table)
- Pushed via WebSocket if user online
- Mark as read when user views

---

## 7. User preferences

```sql
CREATE TABLE user_preferences (
    user_id BIGINT,
    channel ENUM('push', 'email', 'sms', 'in_app'),
    category ENUM('marketing', 'transactional', 'system'),
    opted_in BOOLEAN,
    PRIMARY KEY (user_id, channel, category)
);
```

Rules:
- Transactional (password reset) — usually cannot opt-out
- Marketing — must opt-out option (GDPR, CAN-SPAM Act)

---

## 8. Templates

Multi-language, personalization:

```handlebars
Subject: Your order {{orderId}} has shipped!

Hi {{firstName}},

Your order is on its way. Track it here: {{trackingUrl}}

Estimated delivery: {{estimatedDate}}

Thanks,
The Team
```

i18n: separate template per language. Fallback к English.

---

## 9. Reliability

### At-least-once delivery

Kafka guarantees + retry workers. Possible duplicates → consumer must dedup на receiver side (idempotency key per notification).

### Retry policy

```
Channel Worker:
  attempt = 1
  send notification
  if fail:
    if transient (5xx, network): retry с exponential backoff
    if permanent (invalid device token): mark device invalid, don't retry
    if max attempts exceeded: DLQ
```

Standard backoff (exponentially growing): 1m, 5m, 30m, 2h, 12h.

### DLQ (Dead Letter Queue)

Permanently failed notifications → DLQ topic. Manual investigation / customer support.

---

## 10. Rate limiting

### Per user

Avoid notification spam.
```
max 10 notifications / hour / user (defaults; overridable for system messages)
```

Use bucket: track notifications sent per user per window. Skip new if exceeded.

### Per channel (global)

- SMS — Twilio account-level rate limit
- APNs — per-device push rate limit
- Email — sending domain reputation (ramp up gradually for new domains)

---

## 11. Scheduled notifications

```
notification with scheduledAt = future timestamp
  → enqueue в delayed queue (SQS DelaySeconds, Redis sorted set with score=timestamp)
  → at time, move к main queue

Implementation options:
  - Cron job: every minute, scan upcoming → publish
  - Redis ZSET с ZPOPMIN looking at <= now
  - Dedicated scheduler service (e.g., Quartz, Temporal)
```

---

## 12. Campaigns (bulk send)

Marketing campaign: «Send to all 10M users».

```
Campaign Service:
  - Validate campaign config
  - Materialize recipient list (segment DB query)
  - Chunk список into batches (10K each)
  - Publish batch jobs к Kafka
  - Workers process batches, publish individual notifications
```

Throttling: campaign sends gradually (e.g., 1M / hour) to avoid spam complaints + infrastructure burst.

---

## 13. Delivery receipts

Track per notification:
- sent_at — server attempted send
- delivered_at — channel confirmed delivery (email service event, push receipt)
- opened_at — user opened (email pixel, push opened in-app)
- clicked_at — link clicked

Store events в Kafka → aggregate в analytics DB.

---

## 14. Failure modes

| Scenario | Handling |
|----------|----------|
| Email service down (SendGrid) | Retry, then fallback к backup provider (SES) |
| User device token invalid | Mark invalid, stop sending until refresh |
| User opt-outed | Check preference before send, skip silently |
| Notification storm (e.g., bug emitting 1000x) | Per-user rate limit catches, alerts ops |
| Worker crashes | Kafka offset stays, another worker picks up |

---

## 15. Trade-offs

### Sync vs async API

- **Sync** — caller waits для delivery confirmation. Slow (mailbox provider может wait seconds).
- **Async (this design)** — caller returns immediately, status tracked separately

Default async; rare sync for high-priority (auth code).

### Single channel worker vs unified

- Per-channel workers — specialized, scale independently
- Unified worker — simpler, но один failing channel blocks others

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — Ch. 10 «Design a Notification System»
- [Twilio Documentation — SMS best practices](https://www.twilio.com/docs)
- [SendGrid — Email Deliverability](https://sendgrid.com/blog/category/best-practices/)
- [APNs Documentation](https://developer.apple.com/documentation/usernotifications/)
- [FCM Documentation](https://firebase.google.com/docs/cloud-messaging)
- [Slack Engineering — Notification Service](https://slack.engineering/)
