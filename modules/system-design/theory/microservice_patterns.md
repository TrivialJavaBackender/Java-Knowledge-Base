# Microservice Patterns — System Design

## Monolith vs Microservices

| | Monolith | Microservices |
|---|---|---|
| Деплой | Один артефакт | Независимо по сервисам |
| Масштабирование | Всё или ничего | Отдельные сервисы |
| Разработка | Простой старт | Сложнее (сеть, распределённые транзакции) |
| Консистентность | ACID транзакции | Eventual consistency |
| Latency | Вызовы in-process | Network round-trips |
| Отказоустойчивость | Single point of failure | Частичные отказы |

**Когда монолит лучше:** стартап, небольшая команда, неясные границы домена. Microservices — когда команды независимы и разные части нужно масштабировать по-разному.

**Strangler Fig** — постепенная миграция: новый функционал пишется в сервисах, старый монолит заменяется постепенно через gateway/facade.

---

## Deployment Стратегии

### Blue/Green

Две идентичные prod-среды: Blue (текущая) и Green (новая версия).

```
Users → Load Balancer → Blue (v1)   ← весь трафик
                      → Green (v2)  ← пусто

Deploy v2 на Green → проверить → переключить трафик
Users → Load Balancer → Blue (v1)   ← пусто
                      → Green (v2)  ← весь трафик
```

**Плюсы:** мгновенный rollback (переключить обратно), нет downtime.
**Минусы:** вдвое больше инфраструктуры, сложно с DB migrations.

### Rolling (Скользящий)

Постепенная замена инстансов по одному или группами.

```
v1 v1 v1 v1 → v2 v1 v1 v1 → v2 v2 v1 v1 → v2 v2 v2 v2
```

**Плюсы:** меньше ресурсов чем Blue/Green.
**Минусы:** обе версии работают одновременно → API должен быть backward-compatible. Rollback медленнее.

### Canary

Небольшой процент трафика идёт на новую версию, постепенно увеличивается.

```
100% → v1
95%  → v1,  5% → v2  ← мониторинг ошибок
80%  → v1, 20% → v2
0%   → v1, 100% → v2
```

**Плюсы:** тестируешь на реальном трафике с минимальным риском.
**Минусы:** сложнее настроить routing, нужен хороший мониторинг.

### A/B Testing

Похоже на Canary, но цель — сравнение бизнес-метрик, а не стабильности. Одни пользователи видят A, другие B.

---

## Шардинг (Horizontal Partitioning)

Разбиение данных по разным узлам (shards) по значению ключа.

**Shard key выбор:**
- Хорошо: `user_id` — равномерное распределение, запросы одного пользователя → один shard
- Плохо: `country` — hot spot (99% пользователей в одной стране)

**Consistent Hashing** — при добавлении/удалении шарда перераспределяется минимум данных (не всё).

**Проблемы шардинга:**
- Joins между шардами — невозможны или очень дорого
- Транзакции между шардами — distributed transactions
- Resharding — сложная миграция при изменении числа шардов

**Range vs Hash sharding:**
```
Range: user_id 1-1000 → shard1, 1001-2000 → shard2
  + Хорош для range queries
  - Hot spots если ключи неравномерны

Hash: shard = hash(user_id) % N
  + Равномерное распределение
  - Range queries идут на все шарды
```

---

## Репликация

**Master-Replica (Primary-Secondary):**
- Все записи → Primary
- Чтения → Replica (eventual consistency)
- Автоматический failover: Replica становится Primary при падении

**Multi-Master:** записи на любой узел, конфликты разрешаются (last-write-wins, CRDTs). Сложнее, используется в geo-distributed системах.

**Replication lag:** реплика может отставать. При чтении после записи можно попасть на реплику, не видящую свежие данные → **read-your-writes consistency** решается через sticky sessions или чтением с Primary для важных данных.

---

## Distributed Transactions

**Проблема:** атомарность между несколькими сервисами/БД. Классический ACID не работает.

### 2PC (Two-Phase Commit)

```
Coordinator → все участники: "Prepare" (можешь закоммитить?)
Все отвечают: "Ready"
Coordinator → все: "Commit"

Если хоть один "Abort" → Coordinator → "Rollback"
```

**Минусы:** блокирует ресурсы до завершения, coordinator — single point of failure. В микросервисах почти не используется.

### SAGA Pattern

Последовательность локальных транзакций. При сбое — **compensating transactions** (компенсирующие действия).

```
1. Order Service: создать заказ (PENDING)
2. Payment Service: списать деньги
3. Inventory Service: зарезервировать товар
4. Order Service: обновить статус → CONFIRMED

Если шаг 3 упал:
← Inventory: ничего не делать
← Payment: вернуть деньги (compensating tx)
← Order: отменить заказ
```

**Choreography SAGA** — сервисы слушают события и реагируют (decoupled, сложнее дебажить).
**Orchestration SAGA** — центральный оркестратор управляет флоу (проще дебажить, связанность).

---

## API Gateway

Единая точка входа для всех клиентов. Выполняет:
- Routing → нужный сервис
- Auth/AuthZ
- Rate limiting
- SSL termination
- Request aggregation (собрать данные из нескольких сервисов)
- Caching

```
Mobile App → API Gateway → User Service
Web App    →             → Order Service
           →             → Notification Service
```

---

## Service Discovery

Сервисы появляются и исчезают динамически → нельзя hardcode IP.

**Client-side discovery:** клиент запрашивает Service Registry (Consul, Eureka) и сам выбирает инстанс.

**Server-side discovery:** клиент идёт на Load Balancer, тот спрашивает Registry.

---

## Circuit Breaker

Предотвращает каскадные отказы. Три состояния:

```
CLOSED → обычная работа, считает ошибки
  ↓ (много ошибок)
OPEN → все запросы сразу возвращают ошибку (не идут к сервису)
  ↓ (timeout прошёл)
HALF-OPEN → пропускает несколько тестовых запросов
  ↓ (успех)        ↓ (ошибка)
CLOSED             OPEN
```

Библиотеки: Resilience4j, Hystrix (deprecated).

---

## Message Queue / Event Streaming

**Зачем:** decoupling, async processing, буферизация spike трафика.

**Queue (RabbitMQ):** сообщение читает один потребитель. Point-to-point.

**Topic/Stream (Kafka):** сообщение читают все подписанные группы. Pub/Sub. Партиции для параллелизма.

**At-least-once vs Exactly-once:**
- At-least-once: сообщение дойдёт, но может дублироваться → consumer должен быть идемпотентным
- Exactly-once: гарантия, что ровно один раз (дорого, только в пределах Kafka transactional API)

---

## Caching Patterns

**Cache-aside (Lazy loading):**
```
1. Read cache → miss
2. Read DB
3. Write to cache
4. Return
```
Популярно с Redis. Cache inconsistency при обновлении данных.

**Write-through:** запись идёт сначала в cache, потом в DB. Всегда актуальный cache, но latency записи выше.

**Write-behind (Write-back):** запись только в cache, асинхронно сбрасывается в DB. Максимальная скорость записи, риск потери данных.

**Cache eviction:** LRU (Least Recently Used), LFU (Least Frequently Used), TTL.

**Cache stampede (Dog-piling):** при инвалидации популярного ключа сотни запросов идут в БД одновременно. Решение: mutex lock при регенерации, probabilistic early expiration.

---

## Rate Limiting

**Token Bucket:** в бакете N токенов, добавляются по rate/sec. Запрос тратит токен. Позволяет burst.

**Leaky Bucket:** запросы в очередь, обрабатываются с постоянной скоростью. Нет burst.

**Fixed Window:** считаем запросы в фиксированном окне (минута). Проблема: двойной burst на границе окон.

**Sliding Window:** скользящее окно — точнее, но требует хранить timestamp каждого запроса.

Реализация: Redis + Lua скрипт (атомарный счётчик с TTL).

---

## Database Patterns

### Read Replicas

Запись → Primary, чтение → Replica. Масштабирует read-heavy нагрузку.

### CQRS (Command Query Responsibility Segregation)

Отдельные модели для записи и чтения. Write side нормализован (ACID). Read side денормализован (быстрое чтение, eventual consistency).

### Event Sourcing

Хранить не текущее состояние, а историю событий. Состояние восстанавливается replay событий.

```
AccountCreated(id, owner)
MoneyDeposited(id, 100)
MoneyWithdrawn(id, 30)
→ balance = 70
```

**Плюсы:** полный audit log, temporal queries ("что было год назад"), event replay.
**Минусы:** сложность, eventual consistency, snapshots для производительности.

---

## Observability: Metrics, Logs, Traces

**Три столпа наблюдаемости:**

**Metrics** — агрегированные числовые данные: RPS, latency p99, error rate. Prometheus + Grafana.

**Logs** — детальные записи событий. Structured logging (JSON) → ELK/Loki. Уровни: ERROR, WARN, INFO, DEBUG.

**Distributed Tracing** — сквозной trace через несколько сервисов. Каждый запрос получает `trace_id`, каждый span — `span_id`. Jaeger, Zipkin, OpenTelemetry.

**SLI/SLO/SLA:**
- SLI (Service Level Indicator): метрика — 99.5% запросов < 200ms
- SLO (Service Level Objective): цель — 99.9% uptime
- SLA (Service Level Agreement): договор с клиентом с штрафами

---

## Часто упоминаемые паттерны (краткий справочник)

| Паттерн | Суть |
|---|---|
| **Sidecar** | Вспомогательный контейнер рядом с основным (logging, proxy, TLS) |
| **Service Mesh** | Сеть сервисов с взаимной аутентификацией, tracing, circuit breaker (Istio, Linkerd) |
| **Bulkhead** | Изоляция ресурсов (отдельные thread pools для разных операций) — как водонепроницаемые переборки |
| **Retry + Backoff** | Повтор с экспоненциальной задержкой + jitter |
| **Idempotency Key** | Уникальный ключ для безопасного retry |
| **Outbox** | Атомарная публикация событий через отдельную таблицу в БД |
| **Strangler Fig** | Постепенная замена монолита микросервисами |
| **Anti-Corruption Layer** | Адаптер между старой и новой системой для изоляции |
| **Throttling** | Ограничение нагрузки при перегрузке (отклонять лишние запросы) |
| **Health Check** | Эндпоинт `/health` для load balancer и service discovery |

---

## Sync vs Async коммуникация

### Synchronous (REST, gRPC)

```
Service A → HTTP/gRPC → Service B → ответ → Service A
           (ждёт ответа)
```

**REST:**
- Простота (HTTP everywhere), легко дебажить (curl, Postman)
- Stateless, кэшируемый (GET)
- Недостатки: нет schema enforcement, text overhead

**gRPC:**
- Protocol Buffers — строгая схема, компактный бинарный формат
- Streaming: unary, server/client/bidirectional streaming
- Code generation (proto → Java/Go/Python client/server)
- HTTP/2 multiplexing
- Недостатки: сложнее дебажить, нужен proto-файл на оба конца

```protobuf
service OrderService {
    rpc GetOrder (GetOrderRequest) returns (Order);
    rpc StreamOrders (StreamRequest) returns (stream Order); // server streaming
}
```

**Когда sync:**
- Нужен немедленный ответ (запрос-ответ паттерн)
- Пользователь ждёт результата
- Простые CRUD операции
- Внутренние сервис-к-сервис вызовы с жёстким SLA

**Проблемы sync:**
- Temporal coupling — B должен быть доступен пока A делает запрос
- Каскадные отказы — если B падает, A тоже деградирует
- Latency accumulation — цепочка из 5 синхронных вызовов × 50ms = 250ms минимум

### Asynchronous (Kafka, RabbitMQ, SQS)

```
Service A → [Message Broker] → Service B
           (не ждёт ответа)
```

**Паттерны:**

**Fire-and-forget (Events):**
```
OrderService → OrderPlaced event → Kafka topic
                                 → NotificationService (email)
                                 → InventoryService (reserve)
                                 → AnalyticsService (tracking)
```
OrderService не знает о подписчиках. Полный decoupling.

**Request-Reply (псевдо-sync через async):**
```
A → [queue_requests] → B → [queue_replies] → A
  correlationId=abc123  →                  correlationId=abc123
```
A publishes запрос с correlationId, слушает reply-queue, матчит по correlationId.

**Когда async:**
- Fire-and-forget (отправка email, аудит лог)
- Long-running operations (генерация отчётов, конвертация видео)
- Fan-out (одно событие → много потребителей)
- Буферизация при spike нагрузки (Kafka как буфер перед slow consumer)
- Temporal decoupling (B может быть offline)

**Проблемы async:**
- Сложность дебага и трассировки (нужен distributed tracing)
- Eventual consistency — данные обновятся "когда-то"
- Дубликаты сообщений → нужна идемпотентность consumer
- Ordering challenges (если важен порядок → один partition / ключ)

### Сравнение

| | REST | gRPC | Kafka/Async |
|---|---|---|---|
| Coupling | Temporal | Temporal | Decoupled |
| Latency | Низкая | Очень низкая | Выше (async) |
| Throughput | Средний | Высокий | Очень высокий |
| Schema | Нет (OpenAPI опционально) | Строгая (protobuf) | Avro/JSON |
| Reliability | Retry + CB | Retry + CB | At-least/Exactly-once |
| Debugging | Простой | Средний | Сложнее |
| Use case | CRUD, user-facing | Внутренние сервисы, streaming | Events, long tasks, fan-out |

### Outbox Pattern (reliable async)

Проблема: как атомарно сохранить в БД И опубликовать событие в Kafka?

```
Плохо:
  db.save(order);                    // OK
  kafka.publish(OrderCreated event); // Kafka недоступен → событие потеряно
```

**Outbox:**
```sql
-- В одной транзакции:
INSERT INTO orders (id, status) VALUES (1, 'PENDING');
INSERT INTO outbox (event_type, payload, published) VALUES ('OrderCreated', '...', false);
COMMIT;

-- Отдельный процесс (Transactional Outbox Worker / Debezium CDC):
SELECT * FROM outbox WHERE published = false;
kafka.publish(event);
UPDATE outbox SET published = true WHERE id = ?;
```

Или **Debezium (CDC)** — читает WAL PostgreSQL и публикует изменения в Kafka автоматически.

---

## Источники

**Books:**
- *Microservices Patterns* (Chris Richardson, Manning 2018) — каталог паттернов: Saga, CQRS, Event Sourcing, API Gateway, Service Discovery, Circuit Breaker.
- *Building Microservices*, 2nd ed. (Sam Newman, O'Reilly 2021) — миграция с монолита, deployment, ownership boundaries.
- *Release It!*, 2nd ed. (Michael Nygard, Pragmatic 2018) — Circuit Breaker, Bulkhead, Timeouts — оригинал большинства resilience-паттернов.
- *Designing Data-Intensive Applications* (Martin Kleppmann, O'Reilly 2017) — Ch. 9 (Consistency), Ch. 11 (Stream Processing).

**Pattern catalogs:**
- [microservices.io (Chris Richardson)](https://microservices.io/patterns/index.html) — открытый каталог паттернов с диаграммами.
- [Martin Fowler — «Microservices»](https://martinfowler.com/articles/microservices.html) и [«Strangler Fig Application»](https://martinfowler.com/bliki/StranglerFigApplication.html) — оригинальные определения.

**Engineering blogs / case studies:**
- [Stripe Engineering — «Designing Robust and Predictable APIs with Idempotency»](https://stripe.com/blog/idempotency) — как реализована Idempotency Key в продакшене.
- [Netflix Tech Blog — Hystrix circuit breaker, Eureka service discovery](https://netflixtechblog.com/) — origin story паттернов.
- [Resilience4j Documentation](https://resilience4j.readme.io/) — современный преемник Hystrix (Java).
- [Debezium Documentation](https://debezium.io/documentation/) — CDC-реализация Outbox-pattern через Postgres WAL.
- [«Knight Capital — A 45-minute, $440M loss» (postmortem)](https://www.henricodolfing.ch/en/project-failure-case-studies/) — пример того, что бывает при некорректном rolling deployment.
