# Design Problem: News Feed (Twitter / Instagram)

Пользователь публикует пост → followers видят его в своём timeline. Главная задача — **fan-out**: push followers'ам (write-heavy) vs pull на чтение (вычисление по запросу). Celebrity problem.

---

## 1. Requirements

### Functional
- Опубликовать tweet (текст + опционально media)
- Follow / unfollow пользователей
- Просмотр home timeline (по времени или по relevance)
- Like, retweet, reply
- (Опционально) Поиск, hashtags, trending

### Non-functional
- **Read-heavy** (~1000:1 R/W в масштабе Twitter)
- **Низкая latency timeline** — p99 < 500 мс
- **Eventual consistency допустима** — пост может появиться у followers с задержкой 1–10 сек
- **Масштабируемость** — 300M+ DAU, миллиарды follow-связей

---

## 2. Estimation

```
300M DAU, в среднем 100 чтений + 1 пост на пользователя в день (постят ~10%)

WRITES (посты):
  300M × 1 × 10% = 30M постов/день = ~350 writes/sec в среднем, пик ~700

READS (timeline):
  300M × 100 = 30B reads/день = ~350K reads/sec в среднем, пик ~700K

R/W ratio: 1000:1 — сильный read-skew

STORAGE:
  Посты: 30M × 500 байт = 15 ГБ/день = 5.5 ТБ/год
  10 лет: 55 ТБ raw, × 3 replication = 165 ТБ

Стоимость fanout (если push):
  В среднем у пользователя ~200 followers
  Celebrity: 100M followers
  Всего fanout writes per sec = 700 × 200 (среднее) = 140K writes/sec
  Celebrities: 700 × 100M followers = 70B writes (если все «выстрелят» одновременно — невозможно)
```

---

## 3. API

```http
POST /api/v1/tweets
Body: { text, mediaUrls? }
→ 201 { id, createdAt }

GET /api/v1/users/:id/timeline?cursor=...&limit=50
→ 200 { tweets: [...], nextCursor }

POST /api/v1/users/:id/follow
DELETE /api/v1/users/:id/follow

POST /api/v1/tweets/:id/like
POST /api/v1/tweets/:id/retweet
```

---

## 4. Три подхода к генерации timeline

### A. Fan-out on Write (Push)

При публикации — пишем tweet в кэш timeline **каждого follower'а**.

```
User posts →
  вставляем tweet в таблицу posts →
  для каждого follower:
    LPUSH timeline:{follower_id} tweet_id
```

- ✓ **Read latency низкая** — timeline уже подготовлен
- ✗ **Усиление writes** — celebrity (100M followers) = 100M cache writes
- ✗ Неактивные followers — холостая работа
- ✗ Новый follow требует backfill

### B. Fan-out on Read (Pull)

На чтение — подтягиваем посты от всех followee'в в реальном времени.

```
User открывает timeline →
  followed = SELECT user_id FROM follows WHERE follower = user
  tweets = SELECT * FROM tweets WHERE user_id IN (followed) ORDER BY time DESC LIMIT 50
```

- ✓ **Нет write-амплификации**
- ✗ **Read latency высокая** — много join'ов и сортировка
- ✗ Worst case: подписан на 10K — запрос огромный

### C. Hybrid (реальный подход Twitter)

**Push для обычных пользователей, pull для celebrities.**

```
User posts:
  if user.followers > 100K (celebrity):
    не пушим — followers сами подтянут
  else:
    push во все timelines followers

User читает timeline:
  base_timeline = заранее подготовлен (через push)
  + celebrities_tweets = pull свежих постов celebrities, на которых подписан пользователь
  merge sort по времени
  return
```

- ✓ Лучшее из двух миров
- ✗ Сложность реализации
- Нужен тюнинг threshold

---

## 5. High-level архитектура

```
Client
  ↓
LB → API Service pool
       ↓
  ┌────┴────┬─────────┬───────────┐
  ↓         ↓         ↓           ↓
Post     Timeline    User       Media
Service  Service     Service    Service
  ↓         ↓         ↓           ↓
Post DB  Timeline    User DB    Object Store
(шард    Cache       (шард      (S3 + CDN)
по user) (Redis)     по id)
  ↓
Kafka (события fanout)
  ↓
Fanout Workers
  ↓
Обновления Timeline Cache
```

---

## 6. Data model

```sql
-- Tweets (шардированы по user_id)
CREATE TABLE tweets (
    id BIGINT PRIMARY KEY,  -- Snowflake ID (сортируем по времени)
    user_id BIGINT,
    text TEXT,
    media_urls TEXT[],
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_user_time ON tweets(user_id, created_at DESC);

-- Follows (шардированы по follower)
CREATE TABLE follows (
    follower_id BIGINT,
    followee_id BIGINT,
    created_at TIMESTAMPTZ,
    PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_followee ON follows(followee_id);  -- для обратного поиска

-- Timeline cache (Redis sorted set на пользователя)
ZADD timeline:{user_id} {timestamp} {tweet_id}
-- Храним последние ~1000 tweets на пользователя (LRU evict старее)
```

---

## 7. Fanout workflow

```
1. User публикует tweet → API-сервис пишет в Post DB
2. API публикует событие в Kafka topic `tweet-posted`
3. Fanout-worker читает событие:
   a. Берёт список followers из Follow DB
   b. Если celebrity (>100K) → fanout пропускаем (будет pull при чтении)
   c. Иначе: на каждого follower → ZADD timeline:{follower} (tweet_id, timestamp)
4. Timelines followers обновляются в течение 1–10 сек
```

**Параллелизм worker'ов:** партиционирование Kafka по user_id → много worker'ов работают параллельно.

**Failure handling:**
- DLQ для постоянных сбоев
- Retry с exponential backoff
- Идемпотентный ZADD (повторное добавление того же tweet — no-op)

---

## 8. Read path

```
1. API получает GET /timeline
2. Берём ID'шки из Redis: ZREVRANGE timeline:{user_id} 0 49
3. Берём tweets параллельно: MGET posts:{id1} posts:{id2} ...
   если miss → достаём из БД, кэшируем
4. Если пользователь подписан на celebrities:
   для каждого celebrity → берём свежие посты из celebrity_timeline:{celeb_id}
   merge в base timeline, сортируем по времени
5. Возвращаем top 50
```

Latency: типично 10–50 мс (всё в кэше).

---

## 9. Celebrity problem (глубже)

«Hot users» (Justin Bieber 100M+ followers).

### Почему fanout не работает

- 100M cache writes на каждый tweet → 700 мс – 7 сек
- Если celebrity постит 10 раз в день → 1B writes/день per celebrity
- Холостая работа: большинство followers неактивны

### Стратегия

- **Celebrity timeline cache** — отдельный Redis-ключ `celebrity_timeline:{id}` с последними N tweets
- **На чтение**: объединение обычного timeline + pull свежих постов celebrities

### Тюнинг threshold

«Celebrity» threshold:
- Просто число (>100K) — самый простой вариант
- С учётом активности (followers × activity rate)
- Cost-based: стоимость fanout vs стоимость pull для конкретной сети пользователя

---

## 10. Storage scaling

### Tweets — шардирование по user_id

- ~5.5 ТБ/год → один PG primary справится, шардирование — по мере роста
- В реальности Twitter использует Manhattan (custom NoSQL)

### Timeline cache — Redis Cluster

- 300M users × ~1000 tweet ID × ~8 байт = ~2 ТБ working set
- Redis Cluster на 50+ shards
- LRU evict «холодных» пользователей — пересчитывать по запросу (lazy)

### Follows — шардирование по follower_id

- Прямой запрос «на кого я подписан» — быстро (тот же shard)
- Обратный «кто подписан на меня» — нужен `idx_followee`, может потребоваться cross-shard scatter
- Для celebrities — храним follower count заранее, отдельно

---

## 11. Trade-offs / варианты

### Ranking vs chronological

Старый Twitter — chronological. Новый Twitter, Facebook, Instagram — ranked (ML).

В ranked-варианте timeline становится задачей scoring'а: заранее готовим candidate set, на чтении делаем re-rank ML-моделью.

### Edits / deletes

Tombstones для tweets, событие через Kafka, удаление из timeline-кэшей.

### Privacy (приватные аккаунты)

При публикации проверяем, что follower подтверждён. Добавляет latency в fanout.

### Threads / replies

Поле `parent_tweet_id`. Чтение треда — рекурсивный fetch с ограничением по глубине.

### Media

Upload в S3 напрямую по presigned URL. Доставка через CDN. В таблице tweets — только URL.

---

## 12. Anti-abuse

- Rate limit per user (300 tweets/день)
- Spam detection (ML по тексту и поведению)
- Очередь reported content для ручного разбора

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 11 «Design a News Feed System»
- [Twitter Engineering — How we built our timeline](https://blog.twitter.com/engineering/en_us/topics/infrastructure)
- [Instagram Engineering — Static Profile Sharding](https://instagram-engineering.com/)
- [Hello Interview — FB News Feed](https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-news-feed)
- *Designing Data-Intensive Applications* (Kleppmann) — глава 1 (пример Twitter timeline)
