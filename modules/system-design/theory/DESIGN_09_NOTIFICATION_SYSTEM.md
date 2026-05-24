# Design Problem: Notification System

Отправка уведомлений по нескольким каналам (email, SMS, push, in-app) миллионам пользователей. Fan-out, дедупликация, retry, пользовательские preferences.

---

## 1. Requirements

### Functional
- Отправка уведомлений по каналам: email, SMS, mobile push (APNs / FCM), in-app, web push
- Пользовательские preferences (opt-out per channel)
- Шаблоны (i18n, персонализация)
- Запланированные уведомления (отправить завтра в 8:00)
- Batch / bulk send (кампании)
- Delivery receipts (sent / opened / clicked)

### Non-functional
- **Надёжность** — at-least-once delivery
- **Throughput** — миллионы уведомлений в час для marketing-кампаний
- **Latency** — transactional (password reset) < 5 сек
- **Экономия** — SMS дорогие (центы за штуку), использовать аккуратно

---

## 2. Estimation

```
100M MAU, в среднем 30 уведомлений на пользователя в день
  → 3B уведомлений/день = 35K/сек в среднем
  → Пик ×10 = 350K/сек (marketing-всплеск, breaking news)

Типичное распределение по каналам:
  Push: 60%
  Email: 30%
  In-app: 8%
  SMS: 2% (дорогой)
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

## 4. Архитектура

```
Сервисы-клиенты (Order, Auth, Marketing) → эмитят события
  ↓
Notification Service (API)
  ↓ (enqueue)
Kafka topic: notifications
  ↓ (consumer)
Channel Workers (по одному типу на канал)
  ├── Push Worker → APNs / FCM
  ├── Email Worker → SES / SendGrid / Mailgun
  ├── SMS Worker → Twilio
  └── In-App Worker → пишем в БД, push через WebSocket, если пользователь online

Сбоку:
  - User Service (preferences, контакты, device-токены)
  - Template Service (рендеринг шаблонов)
  - Delivery DB (audit log)
```

---

## 5. Workflow

```
1. Order service: «order shipped, notify user»
2. → POST /api/v1/notifications
3. Notification Service:
   a. Валидирует запрос
   b. Берёт preferences пользователя (кэшированные): «push enabled, email enabled»
   c. Берёт шаблон (кэш) и рендерит c data
   d. Применяет rate limit per user (максимум 10 уведомлений/час ради UX)
   e. Публикует событие в Kafka topic per channel
4. Channel-workers читают:
   a. Push Worker:
      - Достаёт device-токены из User Service
      - Шлёт в APNs / FCM
      - Логирует попытку
      - Помечает delivered (или retry при сбое)
```

---

## 6. Channel-специфика

### Email (SES / SendGrid)

- Обработка bounce'ов (hard / soft) → помечаем email невалидным
- Spam-жалобы → opt-out пользователя
- Шаблоны: MJML или Handlebars
- Inline-отслеживание (open pixel, click-redirect)

### SMS (Twilio)

- Дорого (в 10 раз дороже email)
- Используем аккуратно (security codes, срочное)
- Гео-ограничения
- Глобальный rate-limit (на уровне аккаунта Twilio)

### Push (APNs / FCM)

- APNs (iOS) — HTTP/2 API Apple
- FCM (Android + Web) — Google
- Управление device-токенами — токены протухают, нужна ротация
- Silent push — без UI-уведомления, только обновление данных

### In-app

- Хранятся в БД (таблица `notifications`)
- Пушим через WebSocket, если пользователь online
- Помечаются прочитанными, когда пользователь открыл

---

## 7. Пользовательские preferences

```sql
CREATE TABLE user_preferences (
    user_id BIGINT,
    channel ENUM('push', 'email', 'sms', 'in_app'),
    category ENUM('marketing', 'transactional', 'system'),
    opted_in BOOLEAN,
    PRIMARY KEY (user_id, channel, category)
);
```

Правила:
- Transactional (password reset) — обычно нельзя opt-out
- Marketing — должна быть возможность opt-out (GDPR, CAN-SPAM Act)

---

## 8. Шаблоны

Многоязычные, с персонализацией:

```handlebars
Subject: Your order {{orderId}} has shipped!

Hi {{firstName}},

Your order is on its way. Track it here: {{trackingUrl}}

Estimated delivery: {{estimatedDate}}

Thanks,
The Team
```

i18n: отдельный шаблон на язык, fallback на английский.

---

## 9. Reliability

### At-least-once delivery

Гарантии Kafka + retry'и worker'ов. Возможны дубликаты → consumer должен дедуплицировать (idempotency key per notification).

### Retry policy

```
Channel Worker:
  attempt = 1
  send notification
  если упало:
    transient (5xx, сеть): retry с exponential backoff
    permanent (невалидный device token): помечаем устройство, не retry
    исчерпан лимит попыток: DLQ
```

Стандартный backoff (экспоненциальный рост): 1 мин, 5 мин, 30 мин, 2 ч, 12 ч.

### DLQ (Dead Letter Queue)

Окончательно упавшие уведомления → DLQ topic. Ручной разбор / поддержка.

---

## 10. Rate limiting

### На пользователя

Чтобы не спамить уведомлениями.
```
максимум 10 уведомлений / час / пользователь (по умолчанию; для системных можно повышать)
```

Bucket: отслеживаем число уведомлений per user per window. Превысили — новые пропускаем.

### На канал (глобально)

- SMS — rate-limit на уровне аккаунта Twilio
- APNs — push rate-limit per-device
- Email — репутация отправляющего домена (новые домены — медленный ramp-up)

---

## 11. Запланированные уведомления

```
notification со scheduledAt = будущий timestamp
  → кладём в delayed-очередь (SQS DelaySeconds, Redis sorted set со score=timestamp)
  → в назначенное время переносим в основную очередь

Варианты реализации:
  - Cron-job каждую минуту: сканируем upcoming → публикуем
  - Redis ZSET с ZPOPMIN по score <= now
  - Отдельный scheduler-сервис (Quartz, Temporal)
```

---

## 12. Кампании (bulk send)

Marketing-кампания: «Отправить всем 10M пользователей».

```
Campaign Service:
  - Валидирует конфиг
  - Материализует список получателей (запрос к сегментам)
  - Режет список на батчи (по 10K)
  - Публикует batch-job'ы в Kafka
  - Worker'ы обрабатывают батчи и публикуют отдельные уведомления
```

Throttling: рассылка идёт постепенно (например, 1M в час), чтобы избегать spam-жалоб и всплесков нагрузки.

---

## 13. Delivery receipts

По каждому уведомлению трекаем:
- `sent_at` — сервер совершил попытку отправки
- `delivered_at` — канал подтвердил доставку (событие email-сервиса, push receipt)
- `opened_at` — пользователь открыл (open-pixel в письме, push открыт в приложении)
- `clicked_at` — клик по ссылке

События пишутся в Kafka → агрегируются в analytics DB.

---

## 14. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| Email-сервис down (SendGrid) | Retry, затем fallback на backup-провайдера (SES) |
| Device token невалиден | Помечаем, перестаём слать до обновления |
| Пользователь opt-out'нулся | Проверяем preferences до отправки, тихо пропускаем |
| Notification storm (баг шлёт ×1000) | Per-user rate-limit срезает, алёрт оператору |
| Worker упал | Offset в Kafka остался, его подхватит другой worker |

---

## 15. Trade-offs

### Sync vs async API

- **Sync** — caller ждёт подтверждения доставки. Медленно (mailbox-провайдер может секунды ждать).
- **Async (этот дизайн)** — caller сразу получает ответ, статус трекается отдельно

По умолчанию async; sync — редко, для высокоприоритетного (auth-код).

### Отдельный worker на канал vs универсальный

- Отдельные worker'ы на канал — специализированы, масштабируются независимо
- Универсальный worker — проще, но один сбойный канал блокирует остальные

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 10 «Design a Notification System»
- [Twilio Documentation — SMS best practices](https://www.twilio.com/docs)
- [SendGrid — Email Deliverability](https://sendgrid.com/blog/category/best-practices/)
- [APNs Documentation](https://developer.apple.com/documentation/usernotifications/)
- [FCM Documentation](https://firebase.google.com/docs/cloud-messaging)
- [Slack Engineering — Notification Service](https://slack.engineering/)
