# Progress Tracker — System Design

## Статус модулей

| Модуль | Статус | Дата начала | Дата завершения |
|--------|--------|-------------|-----------------|
| 1. Pessimistic Locking in Practice | ⬜ не начат | — | — |
| 2. Optimistic Locking in Practice  | ⬜ не начат | — | — |
| 3. Lock-Free Data Structures       | ⬜ не начат | — | — |
| 4. Rate Limiting & Scheduling      | ⬜ не начат | — | — |
| 5. Database Theory                 | ⬜ не начат | — | — |
| 6. Distributed Systems & Microservices | ⬜ не начат | — | — |
| 7. Testing                         | ⬜ не начат | — | — |

## Упражнения (Java)

| Пакет | Класс | Тема | Статус |
|-------|-------|------|--------|
| reservations | ReservationService | Pessimistic locking, TOCTOU | ⬜ |
| bank | BankServiceImpl | Optimistic locking, deadlock prevention | ⬜ |
| cache | LRUCache | Thread-safe cache, ReadWriteLock | ⬜ |
| orderbook | OrderBookService | Concurrent order book, atomic snapshot | ⬜ |
| scheduler | SimpleTaskScheduler | Scheduled executor, concurrent task queue | ⬜ |
| ratelimiter | TokenBucketRateLimiter | Token bucket, atomic operations | ⬜ |

## Теория

| Файл | Тема | Изучено |
|------|------|---------|
| [theory/database_transactions.md](theory/database_transactions.md) | ACID, транзакции, изоляция, аномалии, savepoints, MVCC | ⬜ |
| [theory/database_indexes.md](theory/database_indexes.md) | Индексы, pg_trgm, EXPLAIN ANALYZE | ⬜ |
| [theory/databases_types.md](theory/databases_types.md) | Типы БД, OLAP, Redis, ORM паттерны | ⬜ |
| [theory/distributed_systems.md](theory/distributed_systems.md) | CAP, консистентность, репликация | ⬜ |
| [theory/microservice_patterns.md](theory/microservice_patterns.md) | Saga, Outbox, Circuit Breaker, sync vs async | ⬜ |
| [theory/kafka.md](theory/kafka.md) | Kafka: гарантии доставки, порядок, exactly-once, HA | ⬜ |
| [theory/solid_oop.md](theory/solid_oop.md) | SOLID, DIP + Jackson, Event Sourcing schema evolution | ⬜ |
| [theory/http_networking.md](theory/http_networking.md) | HTTP 1.1 vs 2.0, кэш, REST vs WS, шифрование, IPv4/IPv6 | ⬜ |
| [theory/stream_api.md](theory/stream_api.md) | Stream API, functional interfaces, Optional, parallel streams | ⬜ |
| [theory/identity_providers.md](theory/identity_providers.md) | JWT (структура/JWKS/revocation), OAuth2 (PKCE, Client Credentials), OIDC, SAML 2.0, Keycloak, IdP federation, password storage (bcrypt/Argon2), архитектурные схемы | ⬜ |
| [theory/secrets_management.md](theory/secrets_management.md) | Envelope encryption, bootstrap problem, Vault (Seal, auth methods, dynamic secrets), Terraform+state, K8s Secrets, SOPS, mTLS | ⬜ |
| [theory/testing.md](theory/testing.md) | Пирамида тестов, JUnit, Mockito, performance, security testing | ⬜ |
| [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md) | Вопросы по system design | ⬜ |

---
Легенда: ⬜ не начато | 🔄 в процессе | ✅ завершено

> **Важно:** Теория по concurrency (локи, атомики, executor и т.д.) находится в модуле `modules/concurrency/`.
