# Domain-Driven Design — Semantic Summary

## Core Model
DDD борется с **сущностной** сложностью домена через модель и единый язык (Ubiquitous Language). Две половины: **стратегия** (нарезка на Bounded Context и связи между ними) и **тактика** (код внутри контекста). Стратегия важнее — неверные границы тактика не спасёт. Тяжесть моделирования пропорциональна ценности поддомена (Core/Supporting/Generic).

## Key Concepts
- **Стратегия**: поддомены, Bounded Context, Context Map (Shared Kernel, OHS, Published Language, ACL, Partnership, Customer–Supplier, Conformist, Separate Ways, Big Ball of Mud).
- **Discovery**: Event Storming (Big Picture/Process/Design), Domain Storytelling, Example Mapping.
- **Тактика**: Value Object, Entity, Aggregate+Root, Domain Event, Repository, Factory, Domain/Application Service, Command, Specification, Policy.
- **Архитектура**: Hexagonal/Onion/Clean — одна идея (зависимости внутрь); порты/адаптеры, Composition Root.
- **Интеграция**: Domain vs Integration Event + транслятор; Outbox/Saga/CQRS/Event Sourcing (механика — в system-design).
- **Функциональный DDD**: illegal states unrepresentable, ADT, decide/evolve, parse-don't-validate.
- **Supple Design**: intention-revealing interfaces, closure of operations, knowledge crunching.

## Important Invariants
- Агрегат = граница инвариантов = транзакции = блокировки; одна транзакция — один агрегат; между агрегатами — итоговая согласованность через события/сагу.
- Ссылки на другие агрегаты — по ID; наружу — только доменные события; репозиторий — на агрегат, не на таблицу.
- Домен не зависит от инфраструктуры (граница держится сборкой/ArchUnit). В Event Sourcing: команда проверяет инвариант, `apply`/`evolve` — нет.

## Common Pitfalls
Анемичная модель (враг №1 в ядре; допустима в CRUD), God Aggregate, обход корня, Repository-на-таблицу, Primitive Obsession, протекание модели/инфраструктуры, раздутый Shared Kernel, DDD ради DDD.

## Related Modules
- **system-design** — механика Outbox/Saga/CQRS/Event Sourcing/Circuit Breaker.
- **design-patterns** — GoF Factory/Strategy, общий God Object / anemic / Primitive Obsession.
- **software-engineering** — FP-основы для функционального DDD.
- **hibernate-jpa** — реализация репозитория, оптимистичная блокировка `@Version`.
- **databases** — ORM-паттерны (Data Mapper, Identity Map, Unit of Work).
