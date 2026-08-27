# Шаблоны микросервисов — указатель

> Этот файл больше не содержит теории. Микросервисная архитектура вынесена в отдельный модуль
> [`microservices`](../../microservices/README.md), где каждый паттерн разобран по механизму, а не
> перечислен: задача → наивное решение и где оно ломается → механизм → правило.
>
> Страница оставлена как навигация: она показывает, где искать тему, которая раньше была здесь.

Остальные темы прежней версии этого файла давно принадлежат другим модулям — они перечислены ниже
вместе с новыми адресами.

## Куда переехали темы

| Тема | Где разобрана теперь |
|---|---|
| Монолит против микросервисов, цена распределённости | [`microservices/WHY_MICROSERVICES.md`](../../microservices/theory/WHY_MICROSERVICES.md) |
| Strangler Fig, извлечение сервиса, границы | [`microservices/DECOMPOSITION.md`](../../microservices/theory/DECOMPOSITION.md) |
| Синхронная связь, таймауты, крайние сроки, пулы соединений | [`microservices/SYNC_COMMUNICATION.md`](../../microservices/theory/SYNC_COMMUNICATION.md) |
| gRPC: контракт в `.proto`, модель ошибок, REST против gRPC | [`microservices/GRPC.md`](../../microservices/theory/GRPC.md) |
| Circuit Breaker, Bulkhead, каскадный отказ | [`microservices/FAILURE_ISOLATION.md`](../../microservices/theory/FAILURE_ISOLATION.md) |
| Асинхронная связь, очередь против журнала | [`microservices/ASYNC_MESSAGING.md`](../../microservices/theory/ASYNC_MESSAGING.md) |
| База на сервис, запрос через границу | [`microservices/DATA_OWNERSHIP.md`](../../microservices/theory/DATA_OWNERSHIP.md) |
| 2PC, Saga, Outbox, распределённые транзакции | [`microservices/DISTRIBUTED_TRANSACTIONS.md`](../../microservices/theory/DISTRIBUTED_TRANSACTIONS.md) |
| CQRS, Event Sourcing, проекции, снапшоты | [`microservices/CQRS_EVENT_SOURCING.md`](../../microservices/theory/CQRS_EVENT_SOURCING.md) |
| Контракты, совместимость, версионирование | [`microservices/CONTRACTS_AND_TESTING.md`](../../microservices/theory/CONTRACTS_AND_TESTING.md) |
| API Gateway, Service Discovery, service mesh | [`microservices/EDGE_AND_MESH.md`](../../microservices/theory/EDGE_AND_MESH.md) |
| Доверие между сервисами: SPIFFE, передача контекста, авторизация | [`microservices/SERVICE_IDENTITY.md`](../../microservices/theory/SERVICE_IDENTITY.md) |
| Распределённый монолит и прочие антипаттерны | [`microservices/ANTIPATTERNS.md`](../../microservices/theory/ANTIPATTERNS.md) |

## Темы, принадлежащие другим модулям

| Тема | Владелец |
|---|---|
| Blue/Green, rolling, canary, A/B — решение о раскатке | [`engineering-process/RELEASE_STRATEGIES.md`](../../engineering-process/theory/RELEASE_STRATEGIES.md) |
| Механика rolling update, probes, откат Deployment | [`infrastructure/KUBERNETES.md`](../../infrastructure/theory/KUBERNETES.md) |
| Шардинг, партиционирование | [`databases/SHARDING.md`](../../databases/theory/SHARDING.md) |
| Репликация, реплики для чтения, CDC | [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md) |
| Кэширование в распределённой системе | [`caching-deep-dive/DISTRIBUTED_CACHING.md`](../../caching-deep-dive/theory/DISTRIBUTED_CACHING.md) |
| Ограничение скорости (алгоритмы, распределённый счётчик) | [`system-design/DESIGN_07_RATE_LIMITER.md`](DESIGN_07_RATE_LIMITER.md) |
| Метрики, логи, трассировки | [`infrastructure/OBSERVABILITY.md`](../../infrastructure/theory/OBSERVABILITY.md) |
| Kafka: топики, партиции, ISR, Schema Registry | [`kafka.md`](kafka.md) |
| Повторы, джиттер, сброс нагрузки, DLQ | [`RELIABILITY_PATTERNS.md`](RELIABILITY_PATTERNS.md) |
| Доменная рамка: Bounded Context, агрегат, интеграция | [`ddd/STRATEGIC_DESIGN.md`](../../ddd/theory/STRATEGIC_DESIGN.md), [`ddd/INTEGRATION_PATTERNS.md`](../../ddd/theory/INTEGRATION_PATTERNS.md) |

## Что осталось за system-design

Модуль `system-design` отвечает на вопрос «спроектируйте систему X за 45 минут»: оценка нагрузки,
выбор хранилища, распределённые примитивы, разбор конкретных задач. Микросервисная механика —
как сервисы разговаривают и как переживают отказ друг друга — принадлежит модулю
[`microservices`](../../microservices/README.md).

Точная карта «концепт → файл-владелец» — [`knowledge/GLOBAL_INDEX.md`](../../../knowledge/GLOBAL_INDEX.md).
