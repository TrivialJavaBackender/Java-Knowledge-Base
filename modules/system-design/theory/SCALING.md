# Scaling Fundamentals

Эволюция архитектуры под рост пользователей. Задача типа «scale from 1 user to 100 million» — классический SD-вопрос, проверяющий понимание узких мест.

> **Scope**: vertical vs horizontal scaling, паттерны масштабирования, stateless vs stateful. DNS/CDN/LB как компоненты — см. соответствующие файлы. Capacity estimation — см. [CAPACITY_ESTIMATION.md](CAPACITY_ESTIMATION.md).

---

## Vertical vs Horizontal Scaling

**Vertical (scale up)** — увеличить мощность одного узла: больше CPU/RAM/SSD. Дёшево до определённого предела (AWS x1e.32xlarge — 128 vCPU, 3.9 TB RAM), просто (нет кода менять), но имеет хард-лимит + dolce factor (одна нода = один SPOF).

**Horizontal (scale out)** — добавлять узлы. Нет верхнего предела, но требует:
- Stateless services (или externalised state)
- Load balancer впереди
- Распределённая координация (cache, session store, БД)
- Сложнее операционно

**Правило:** scale up сначала (проще, дешевле), scale out когда упёрлись. Большинство приложений умещается в один большой узел или маленький fleet.

---

## Шаги масштабирования

### Этап 1 — Single Server (1–1K пользователей)

```
[Client] → [App + DB + Cache на одной машине]
```

Всё на одном сервере. Достаточно для MVP и небольших стартапов. Latency — минимальная (всё in-process), но SPOF.

### Этап 2 — Separate DB tier (1K–10K)

```
[Client] → [App server] → [DB server]
                       → [Cache server (Redis)]
```

DB отделяется от приложения. Можно скейлить app horizontally независимо от DB.

### Этап 3 — Multiple app servers + LB (10K–100K)

```
[Client] → [DNS]
        → [Load Balancer] → [App 1]
                          → [App 2] → [DB]
                          → [App 3] → [Redis]
                          → [App N]
```

Несколько app серверов за load balancer. Sessions переезжают в Redis (stateless app servers). Auto-scaling group.

### Этап 4 — Read Replicas (100K–1M)

```
                    [Load Balancer]
                          ↓
                    [App pool]
                    ↓        ↓
              [Primary DB] [Read Replicas × N]
                          ↑    ↑
              writes      reads
```

Чтения масштабируются через replica. Eventual consistency для read-side. Writes остаются на primary. Read-your-writes через sticky session или чтение с leader для критичного.

### Этап 5 — Caching (любой этап)

```
[App] → [Redis Cluster] → [DB]
        cache-aside / read-through
```

Реальная latency win: hit ratio 95% → 95% запросов не доходят до БД. Подробнее: [`caching-deep-dive/`](../../caching-deep-dive/theory/CACHE_PATTERNS.md).

### Этап 6 — Sharding (1M–10M)

```
[Router/Vitess] → [Shard 1 (Primary + Replicas)]
                → [Shard 2 (Primary + Replicas)]
                → [Shard N]
```

Когда single primary не справляется с write throughput или дата не помещается. См. [`databases/SHARDING.md`](../../databases/theory/SHARDING.md).

### Этап 7 — Microservices (опционально)

```
[Gateway] → [Auth Service]
         → [User Service] → [User DB]
         → [Order Service] → [Order DB]
         → [Notification Service] → [Kafka]
```

Когда команды независимы и разные части нужно масштабировать по-разному. Не от размера юзербазы, а от размера команды и доменной сложности.

### Этап 8 — Multi-region (10M+, global)

```
[Geo-DNS] → US-region: [LB → app → DB-primary]
         → EU-region: [LB → app → DB-replica or active]
         → APAC-region: [LB → app → DB-replica]
```

Геораспределение для latency и data residency. Сложности: cross-region replication, conflict resolution (CRDT), eventual consistency.

### Этап 9 — Edge / CDN-heavy (любая шкала)

Static assets на CDN, API через PoP'ы (Cloudflare Workers, Lambda@Edge). Latency измеряется в км от пользователя.

---

## Stateless vs Stateful

**Stateless service** — каждый запрос независим, состояние externalised (в Redis / БД / S3). Любой инстанс может обработать любой запрос. Тривиальный horizontal scaling.

**Stateful service** — хранит состояние локально (in-memory cache, WebSocket connections, локальные файлы). Sticky sessions или dedicated routing. Сложнее scaling.

**Делайте сервисы stateless по умолчанию.** Stateful — только когда явно нужно (in-memory cache для latency, stateful streaming процессоры). Externalise:
- Session → Redis
- User uploads → S3
- Logs → centralized (Loki / ELK)
- Metrics → Prometheus

---

## Узкие места по этапам

| Этап | Bottleneck | Решение |
|------|-----------|---------|
| Single server | CPU / RAM | Vertical scaling, profiling |
| Separate DB | DB connection pool | HikariCP tuning, more replicas |
| App pool | LB throughput | More LB nodes, anycast |
| Read replicas | Write throughput | Sharding, NoSQL для специфичных workload |
| Sharding | Cross-shard transactions | Saga, domain-aligned shard key |
| Microservices | Network latency, debugging | Service mesh, distributed tracing |
| Multi-region | Consistency, conflict resolution | CRDT, Spanner-like, eventual semantics |

---

## Capacity progression rules of thumb

- **1 server** ~ 1K concurrent users (web app), 10K RPS на простой endpoint
- **1 PostgreSQL primary** ~ 10K writes/sec, 50K reads/sec (без replica)
- **Redis** ~ 100K ops/sec per node, GB-scale dataset
- **Kafka broker** ~ 100K-1M msg/sec, sustained
- **Single AZ failure** = ~100 minutes per year (99.98% SLA)
- **Cross-region replication lag** ~ 50-200ms (sync), 1-10s (async)

Это **порядки величин**, не точные числа — всегда проверять на реальных нагрузках.

---

## Антипаттерны масштабирования

- **Преждевременная микросервисация** — стартап делит на 10 микросервисов до того, как есть пользователи. Боль операций без выгоды от автономии.
- **Sticky sessions** на app серверах — мешают auto-scaling, потеря сессии при failover. Externalise в Redis.
- **Sync replication ко всем нодам** — каждый write идёт со скоростью самой медленной replica. Quorum / async где можно.
- **Один большой shared cache** для всех сервисов — `noisy neighbour` проблемы. Лучше cache per service domain.
- **Cross-region sync transactions** — latency × 2-10×. Применять только если действительно нужно (финансы); иначе eventual consistency.
- **«Database is slow → add cache»** без понимания, **почему** slow. Может быть не helps (write-heavy), может ухудшить (consistency проблемы).
- **Resharding без plan** — попытка online resharding without dual-write / CDC → outage. Сначала проектировать sharding с запасом.

---

## Real-world inflection points

- **Twitter** ~ 2008: monolith Ruby on Rails → Java/Scala микросервисы (fail whale era). Точка перехода — 100M tweets/day.
- **Instagram** ~ 2012: pure Postgres + memcached до 30M users (купили Facebook). Демонстрация «можно далеко зайти на простом стеке».
- **WhatsApp** ~ 2014: 450M users на ~50 engineers, Erlang BEAM. Stateful чат-серверы scale через protocol design.
- **Discord** ~ 2017–2023: MongoDB (early) → Cassandra (billions messages) → ScyllaDB (trillions). Sharding и storage engine эволюция.
- **Shopify** ~ Black Friday: автомасштабирование pods, planning capacity заранее (powers of two в TPS estimate).

---

## Источники

- *Designing Data-Intensive Applications* (Kleppmann, 2017) — Ch. 1 (Reliable, Scalable, Maintainable).
- *The Art of Scalability* (Abbott, Fisher, 2015) — AKF scale cube.
- *Building Microservices* (Sam Newman, 2nd ed.) — когда переходить, когда нет.
- [Scaling Mercurial at Facebook (2014)](https://engineering.fb.com/2014/01/07/core-infra/scaling-mercurial-at-facebook/) — пример vertical & horizontal на одной системе.
- [Discord — How Discord Stores Trillions of Messages (2023)](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- [How WhatsApp grew to nearly 500 million users — Erlang Factory talk](https://www.youtube.com/watch?v=c12cYAUTXXs)
- [donnemartin/system-design-primer — Step 4: Design system to scale](https://github.com/donnemartin/system-design-primer#step-4-scale-the-design)
- [AWS Architecture Center — Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
