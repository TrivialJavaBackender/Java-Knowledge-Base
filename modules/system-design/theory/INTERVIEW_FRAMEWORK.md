# System Design Interview — Framework

Структурированный подход к SD-интервью. Время — обычно 45-60 минут. Цель — продемонстрировать systematic thinking, не «правильный ответ» (его не существует).

---

## Алгоритм (45-минутный таймсчёт)

```
0-5 мин:    Clarify requirements (functional + non-functional)
5-10 мин:   Back-of-envelope estimation
10-15 мин:  API design (REST/gRPC endpoints)
15-25 мин:  High-level architecture (boxes + arrows)
25-40 мин:  Deep dive (2-3 интересных компонента, по запросу интервьюера)
40-45 мин:  Bottlenecks + scaling + trade-offs обсуждение
```

**Главные правила:**
1. **Думай вслух** — собеседующий оценивает мышление, не молчание
2. **Спрашивай прежде чем строить** — design зависит от requirements
3. **Trade-off, не «правильное решение»** — обосновывай выбор
4. **Простое сначала** — не лезь в multi-region если single region хватает

---

## Phase 1 — Clarify Requirements

**Цель:** ограничить scope, разобраться, что строим.

### Functional requirements

Что система **делает**? Какие endpoint'ы / use cases?

Примеры вопросов:
- «Дизайним Twitter — пользователь постит tweet и читает feed?»
- «Нужны DM (личные сообщения)?»
- «Поиск по tweets?»
- «Edit / delete tweet?»
- «Media (фото/видео) или только текст?»

**Сократить scope** — выбрать 3-5 core features, остальное explicitly out of scope. Интервьюер часто хочет, чтобы ты focused, не всё сразу.

### Non-functional requirements

Как система должна работать?

- **Scale** — DAU, total users, размер dataset
- **Latency** — какие p99 endpoint expectations? (10ms / 100ms / 1s — разные архитектуры)
- **Availability** — 99.9% (8h downtime / year) vs 99.99% (52 min) vs 99.999% (5 min)
- **Consistency** — strong vs eventual? Где какая допустима?
- **Durability** — потеря данных допустима? (logs vs financial transactions)
- **Read/Write ratio** — read-heavy vs write-heavy?
- **Read patterns** — random access? Range queries? Aggregations?
- **Geography** — single region? Global? Data residency требования?
- **Cost** — есть бюджетные ограничения? (обычно не критично на интервью)

### Out of scope (явно сказать)

«Я не буду fokus'ить на: detailed UI, payment processing details, ML recommendations, full security audit» — освобождает время на architectural concerns.

---

## Phase 2 — Back-of-Envelope Estimation

5 минут. Применяй [CAPACITY_ESTIMATION.md](CAPACITY_ESTIMATION.md) шаблон.

```
DAU × actions/day = total daily ops
QPS = total / 86400, peak = 2-3×
Storage = records × size × retention × replication
Bandwidth = QPS × payload size
RAM (cache) = hot_set × per_record_size
```

**Зачем нужно:** результат estimation определяет архитектуру.
- 100 QPS → single server вполне.
- 10K QPS → multi-instance, LB.
- 1M QPS → sharding, distributed cache.
- 100M QPS → multi-region, edge compute.

Конкретные числа — это **ваш input** в design. Не пропускайте.

---

## Phase 3 — API Design

Определи 5-10 ключевых endpoint'ов:

```
POST /api/v1/tweets
  body: { text, media_url?, reply_to?, quote_of? }
  → 201 Created { tweet_id, created_at }

GET /api/v1/tweets/:id
  → 200 { id, text, author, created_at, like_count, ... }

GET /api/v1/users/:id/feed
  query: { cursor?, limit? = 50 }
  → 200 { tweets: [...], next_cursor }

POST /api/v1/tweets/:id/like
  → 204 No Content

DELETE /api/v1/tweets/:id
  → 204 No Content
```

**Sub-decisions:**
- **REST vs gRPC vs GraphQL** — public API → REST (cacheable, simple); internal microservice → gRPC; client-driven → GraphQL
- **Pagination** — cursor-based (lexicographic) для streams; offset-based — антипаттерн при scale (slow OFFSET в БД)
- **Authentication** — JWT (Bearer token), API key для server-to-server
- **Versioning** — `/v1/` в path, или Accept header

---

## Phase 4 — High-Level Architecture

15-25 мин. Рисуй boxes + arrows. Стандартные компоненты:

```
[Mobile/Web] → [CDN (static)]
            → [DNS]
            → [Load Balancer (L7)]
              ↓
            [API Gateway / Edge service]
              ↓ ↓ ↓
            [Service A] [Service B] [Service C]
              ↓             ↓             ↓
            [Cache (Redis)]
              ↓             ↓             ↓
            [DB (sharded)] [DB] [Message Queue (Kafka)]
                                  ↓
                                [Worker pool] → [Email/Push]
```

**Что обсудить:**
1. **Statelessness** — сервисы stateless, state в БД/Redis
2. **Data model** — какие таблицы, какие индексы, sharding strategy
3. **Caching strategy** — что кэшируем, на каком уровне, TTL
4. **Async vs Sync** — что в response cycle, что в очередь
5. **Failure modes** — что если DB down? Cache down? LB down?

---

## Phase 5 — Deep Dive

Интервьюер выберет 2-3 темы для углубления. Готов к любой:

### Data model deep dive

- Конкретные таблицы / schemas
- Primary / secondary indexes
- Sharding key — обоснование
- Consistency requirements

### Cache deep dive

- Cache pattern (cache-aside / read-through)
- Eviction (LRU / LFU / W-TinyLFU)
- TTL strategy, refresh-ahead
- Stampede prevention (single-flight)
- Hot key problem

### Fan-out (newsfeed, notification)

- Fan-out on write vs read
- Celebrity problem
- Push vs pull
- Materialized timeline

### Storage deep dive

- LSM vs B-tree выбор
- Replication factor, consistency level
- Backup / recovery strategy

### Search / indexing

- Inverted index
- Trie для autocomplete
- Search engine (Elasticsearch) sync через CDC

### Rate limiting

- Token bucket / leaky bucket / sliding window
- Distributed (Redis + Lua)
- Per-user / per-API-key / global

### Failure handling

- Circuit breaker semantics
- Retry с jitter
- Dead letter queue
- Graceful degradation

---

## Phase 6 — Bottlenecks & Scaling

«Если завтра 10× users — что сломается?»

Проанализируй каждый компонент:

| Компонент | Bottleneck | Mitigation |
|-----------|-----------|------------|
| LB | NIC bandwidth | Anycast IP, multi-LB |
| App servers | CPU | Auto-scaling, more replicas |
| DB primary writes | IOPS | Sharding |
| DB reads | Connection pool | Read replicas, caching |
| Cache | RAM, hot key | Cluster, replication for hot |
| Message broker | Partitions | Repartition, more brokers |
| External API | Their rate limit | Caching, batching |
| Network egress | Bandwidth cost | CDN |

Обсуди monitoring:
- **Golden signals**: latency, traffic, errors, saturation (RED + S)
- **SLO**: 99.9% availability, p99 < 500ms
- **Alerting**: burn rate alerts, anomaly detection
- **Tracing**: distributed traces для debugging

---

## Trade-off framework

Каждое решение — trade-off. Обсуди:

- **Consistency vs Availability** (CAP)
- **Consistency vs Latency** (PACELC — EC vs EL)
- **Read latency vs Write latency** (denormalization, materialized views)
- **Storage cost vs Compute cost** (caching trade)
- **Operational simplicity vs Optimal performance** (monolith vs microservices)
- **Developer velocity vs Reliability** (move fast vs strict review)

---

## Антипаттерны на интервью

### Jumping to implementation

«Используем Cassandra, потому что NoSQL» — без обсуждения requirements. Сначала **зачем**, потом **что**.

### Ignoring scale

Рисуешь single DB вне зависимости от estimation. Если 1M QPS — single DB не справится.

### Over-engineering

Дизайн URL shortener на 10 микросервисов с Kafka и Spark. Простой — лучше. Простой + готовый scale up — отлично.

### Single-region thinking

Не учитываешь geo distribution для global service.

### Avoiding trade-offs

«Решение Х — лучшее». Покажи **почему**: сравни с альтернативой, объясни trade-off.

### Buzzword soup

«Будем использовать Kubernetes, Istio, Kafka, Spark, Flink, Cassandra, Redis» — без понимания, зачем каждое.

### Silent thinking

Молчание 5 минут — собеседующий не знает, что ты думаешь. Думай вслух.

---

## Готовый шаблон ответа

Сохрани в голове как ментальный chunk:

```markdown
1. Understanding the problem (functional + non-functional requirements)
2. Estimating the scale (DAU, QPS, storage, bandwidth, RAM)
3. Defining the API
4. High-level design (rough architecture diagram)
5. Detailed design (data model, deep dives на запрос)
6. Identifying and resolving bottlenecks
7. Discussing trade-offs and alternatives
```

---

## Готовность к деталям (что часто спрашивают)

Помимо самой архитектуры — будь готов к **глубоким** вопросам:

- **БД**: какой index? как пагинация? Sharding key выбран как?
- **Кэш**: cache patterns, eviction, TTL, stampede, hot key
- **Очереди**: at-least vs exactly-once, идемпотентность consumer, DLQ
- **Auth**: JWT lifecycle, refresh rotation, revocation
- **Failure**: что если DB down? Cache lost?
- **Monitoring**: SLI/SLO, golden signals
- **Cost**: где деньги тратятся, как сократить (CDN cuts egress)

---

## Источники

- *System Design Interview Vol. 1, 2* (Alex Xu, ByteByteGo) — каноничный template + 30+ design problems
- [Hello Interview — Delivery (Interview Frame)](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery)
- [donnemartin/system-design-primer — How to approach](https://github.com/donnemartin/system-design-primer#how-to-approach-a-system-design-interview-question)
- *Cracking the System Design Interview* (Hewlin) — старая, но фундаменты те же
- [Reddit r/systemsdesign](https://www.reddit.com/r/systemsdesign/) — discussions реальных интервью
- [Pramp / Exponent / interviewing.io](https://interviewing.io/) — мок-интервью для практики
