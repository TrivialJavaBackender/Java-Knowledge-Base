# Microservices — Interview Prep

Модуль о том, что происходит с системой, когда вызов метода превращается в вызов по сети: где
проводить границу сервиса, как сервисы разговаривают друг с другом, как сохранить согласованность
данных без общей транзакции, что делать с отказом соседа и во что всё это обходится в
эксплуатации.

Модуль отвечает на вопросы, где интервьюер проверяет не знание списка паттернов, а понимание
цены: «зачем вам микросервисы», «как откатите заказ, если платёж прошёл, а склада не хватило»,
«почему двойная запись в базу и в брокер ломается», «где ставить предохранитель и где его ставить
нельзя», «как выкатите несовместимое изменение контракта».

> Терминология зафиксирована в [`knowledge/GLOSSARY.md`](../../knowledge/GLOSSARY.md) и
> [`knowledge/CANONICAL_TERMS.md`](../../knowledge/CANONICAL_TERMS.md). Карта «концепт → файл» —
> [`knowledge/GLOBAL_INDEX.md`](../../knowledge/GLOBAL_INDEX.md).

## Структура проекта

```
├── ROADMAP.md                          # 12 тем в порядке прохождения + чеклисты
├── INTERVIEW_QUESTIONS.md              # вопросы с ответами (формат qa-bold)
├── _SUMMARY.md                         # семантическое сжатие модуля
│
└── theory/
    ├── WHY_MICROSERVICES.md            # что покупаем и чем платим; когда это лишнее
    ├── DECOMPOSITION.md                # где резать; извлечение сервиса из монолита
    ├── SYNC_COMMUNICATION.md           # REST и gRPC, таймауты, крайние сроки, соединения
    ├── FAILURE_ISOLATION.md            # каскад отказов, предохранитель, переборка, деградация
    ├── ASYNC_MESSAGING.md              # события и команды, хореография, идемпотентность
    ├── DATA_OWNERSHIP.md               # база на сервис, запрос через границу, проекции
    ├── DISTRIBUTED_TRANSACTIONS.md     # 2PC, сага, компенсации, Outbox, CDC
    ├── CQRS_EVENT_SOURCING.md          # разделение чтения и записи, журнал событий
    ├── CONTRACTS_AND_TESTING.md        # версионирование контракта, контрактные тесты, окружения
    ├── EDGE_AND_MESH.md                # шлюз, BFF, обнаружение сервисов, service mesh
    ├── SERVICE_IDENTITY.md             # доверие между сервисами, SPIFFE, передача контекста
    └── ANTIPATTERNS.md                 # распределённый монолит, наносервисы, общая база
```

## Темы

| Раздел | Содержание | Теория |
|--------|------------|--------|
| Мотивация | Цена сетевого вызова, закон Конвея, когда хватит модульного монолита | [WHY_MICROSERVICES](theory/WHY_MICROSERVICES.md) |
| Границы | Критерии разреза, размер сервиса, Strangler Fig, перенос данных | [DECOMPOSITION](theory/DECOMPOSITION.md) |
| Синхронная связь | REST против gRPC, бюджет таймаутов, крайний срок, балансировка | [SYNC_COMMUNICATION](theory/SYNC_COMMUNICATION.md) |
| Изоляция отказа | Каскад, предохранитель, переборка, деградация | [FAILURE_ISOLATION](theory/FAILURE_ISOLATION.md) |
| Асинхронная связь | Команда против события, хореография, порядок, идемпотентность | [ASYNC_MESSAGING](theory/ASYNC_MESSAGING.md) |
| Данные | База на сервис, композиция через API, материализованные представления | [DATA_OWNERSHIP](theory/DATA_OWNERSHIP.md) |
| Согласованность | 2PC, сага, компенсации, Outbox, двойная запись | [DISTRIBUTED_TRANSACTIONS](theory/DISTRIBUTED_TRANSACTIONS.md) |
| CQRS и ES | Проекции, задержка чтения, журнал событий, снапшоты | [CQRS_EVENT_SOURCING](theory/CQRS_EVENT_SOURCING.md) |
| Контракты | Совместимость, версионирование, контрактные тесты, окружения | [CONTRACTS_AND_TESTING](theory/CONTRACTS_AND_TESTING.md) |
| Инфраструктурный слой | Шлюз, BFF, обнаружение сервисов, service mesh | [EDGE_AND_MESH](theory/EDGE_AND_MESH.md) |
| Безопасность | Удостоверение рабочей нагрузки, передача пользовательского контекста | [SERVICE_IDENTITY](theory/SERVICE_IDENTITY.md) |
| Антипаттерны | Распределённый монолит, наносервисы, общая база | [ANTIPATTERNS](theory/ANTIPATTERNS.md) |

## Сквозной пример

Вся теория разбирается на одной системе.

> **Оформление заказа в интернет-магазине.** Пять сервисов: `Checkout` принимает запрос,
> `Order` создаёт заказ, `Payment` ходит во внешнего платёжного провайдера, `Inventory`
> резервирует товар на складе, `Notification` шлёт письмо. Нагрузка — 500 запросов в секунду
> на оформление. Внешний платёжный провайдер отвечает за 300 мс по медиане и иногда зависает.
> Резерв склада обязан быть согласован с оплатой: нельзя списать деньги и не отгрузить, нельзя
> отгрузить и не списать.

Из этого одного набора выводятся все решения модуля: почему цепочка из четырёх синхронных
вызовов даёт доступность хуже каждого её звена, откуда берётся сага и что делать с уже
списанными деньгами, почему `Order` не может джойнить таблицу склада, где ставить предохранитель
на вызов провайдера и что именно ломается, когда `Inventory` выкатывает несовместимое изменение
контракта.

## Границы модуля

Модуль отвечает на вопрос **«как устроено взаимодействие сервисов и что за него платят»**.
Смежные темы принадлежат другим модулям и здесь только упоминаются со ссылкой:

- Bounded Context, Context Map, модульный монолит как доменное решение — [ddd/STRATEGIC_DESIGN.md](../ddd/theory/STRATEGIC_DESIGN.md), [ddd/ARCHITECTURE.md](../ddd/theory/ARCHITECTURE.md)
- механика Kafka, Schema Registry, эволюция схемы событий — [system-design/kafka.md](../system-design/theory/kafka.md)
- повторы, джиттер, сброс нагрузки, дублирующие запросы, DLQ — [system-design/RELIABILITY_PATTERNS.md](../system-design/theory/RELIABILITY_PATTERNS.md)
- HTTP/2, QUIC, TLS — [system-design/http_networking.md](../system-design/theory/http_networking.md)
- шардинг, репликация, CDC со стороны базы — [databases/SHARDING.md](../databases/theory/SHARDING.md), [databases/REPLICATION.md](../databases/theory/REPLICATION.md)
- Kubernetes, Ingress, CoreDNS, наблюдаемость и трассировка — [infrastructure/KUBERNETES.md](../infrastructure/theory/KUBERNETES.md), [infrastructure/OBSERVABILITY.md](../infrastructure/theory/OBSERVABILITY.md)
- OAuth2, OIDC, JWT как протоколы; mTLS и секреты — [system-design/identity_providers.md](../system-design/theory/identity_providers.md), [infrastructure/SECRETS.md](../infrastructure/theory/SECRETS.md)
- пирамида тестов, Pact, TestContainers — [software-engineering/TESTING.md](../software-engineering/theory/TESTING.md)
- релизные стратегии, feature flags, expand/contract для схемы БД — [engineering-process/RELEASE_STRATEGIES.md](../engineering-process/theory/RELEASE_STRATEGIES.md)

## Как работать

Это теоретический модуль: сборки и упражнений с кодом нет. Прогресс, чтение теории и повторение
карточек — в web app репозитория.

```
"следующий"   — следующая тема теории по ROADMAP
"квиз"        — 5 случайных вопросов из INTERVIEW_QUESTIONS.md
```

[ANTIPATTERNS](theory/ANTIPATTERNS.md) читается последним: файл опирается на механизмы из
остальных и служит тренажёром — по каждому антипаттерну надо уметь сказать, какой именно механизм
из предыдущих файлов в нём нарушен.

## Источники

- *Building Microservices*, 2-е издание — Sam Newman
- *Monolith to Microservices* — Sam Newman
- *Microservices Patterns* — Chris Richardson
- *Designing Data-Intensive Applications* — Martin Kleppmann
- *Release It!*, 2-е издание — Michael Nygard (каскадные отказы, предохранитель, переборка)
- *Enterprise Integration Patterns* — Gregor Hohpe, Bobby Woolf
- *Team Topologies* — Matthew Skelton, Manuel Pais (закон Конвея, обратный манёвр)
- Спецификации: [gRPC](https://grpc.io/docs/), [Protocol Buffers](https://protobuf.dev/programming-guides/proto3/), [RFC 8693 (Token Exchange)](https://www.rfc-editor.org/rfc/rfc8693), [SPIFFE](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE-ID.md), [Envoy xDS](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol)
