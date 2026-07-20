# ddd — Roadmap

## Порядок прохождения

| Приоритет | Тема | Частота на собесах |
|-----------|------|--------------------|
| 1 | Введение: что такое DDD, стратегия vs тактика, когда применять | ★★★ |
| 2 | Стратегическое проектирование: Bounded Context, единый язык, Context Map | ★★★★★ |
| 3 | Discovery: Event Storming, Domain Storytelling, Example Mapping | ★★★ |
| 4 | Тактические паттерны: VO, Entity, Repository, Factory, сервисы, Specification | ★★★★★ |
| 5 | Дизайн агрегатов: границы инвариантов и транзакций, консистентность | ★★★★★ |
| 6 | Архитектура: Hexagonal / Onion / Clean, Ports & Adapters | ★★★★ |
| 7 | Интеграция контекстов: Domain/Integration Event, Outbox, Saga, CQRS, ES | ★★★★ |
| 8 | Функциональный DDD: illegal states unrepresentable, ADT | ★★★ |
| 9 | Supple Design: intention-revealing interfaces, knowledge crunching | ★★ |
| 10 | Антипаттерны: анемичная модель, God Aggregate, DDD ради DDD | ★★★ |

---

## Модуль 1: Введение

📖 Теория: [theory/INTRO.md](theory/INTRO.md)

- [ ] Что такое DDD и какую проблему решает (сложность предметной области)
- [ ] Стратегический DDD vs тактический DDD
- [ ] Когда DDD оправдан, а когда это over-engineering (CRUD, прототип)
- [ ] Место паттернов на карте: стратегия → тактика → архитектура → интеграция
- [ ] Ключевые книги: Evans (Blue), Vernon (Red/Distilled), Wlaschin, Khononov

---

## Модуль 2: Стратегическое проектирование

📖 Теория: [theory/STRATEGIC_DESIGN.md](theory/STRATEGIC_DESIGN.md)

- [ ] Домен и поддомены: Core / Supporting / Generic
- [ ] Ubiquitous Language (единый язык) — в коде, а не в вики
- [ ] Bounded Context — граница непротиворечивой модели
- [ ] Context Map: 9 отношений (Shared Kernel, Customer–Supplier, Conformist, ACL, OHS, Published Language, Separate Ways, Partnership, Big Ball of Mud)
- [ ] Anticorruption Layer, Open Host Service, Published Language
- [ ] Эвристики поиска границ контекстов

---

## Модуль 3: Discovery — как находят модель

📖 Теория: [theory/EVENT_STORMING.md](theory/EVENT_STORMING.md)

- [ ] Event Storming: Big Picture / Process Level / Design Level
- [ ] Цветовая грамматика (события, команды, агрегаты, политики, read model, внешние системы, hotspots)
- [ ] Pivotal events и нарезка на Bounded Context / swimlanes
- [ ] Domain Storytelling
- [ ] Example Mapping (правила / примеры / вопросы)
- [ ] Bounded Context Canvas

---

## Модуль 4: Тактические паттерны

📖 Теория: [theory/TACTICAL_PATTERNS.md](theory/TACTICAL_PATTERNS.md)

- [ ] Value Object (неизменяемость, равенство по значению, самовалидация)
- [ ] Entity (идентичность, переживающая изменения)
- [ ] Domain Event (свершившийся факт на языке бизнеса)
- [ ] Repository — абстракция коллекции агрегатов (один на агрегат)
- [ ] Factory — инкапсуляция сборки агрегата
- [ ] Domain Service vs Application Service
- [ ] Command — намерение как структура данных
- [ ] Specification — бизнес-правило как объект
- [ ] Policy / Strategy в домене; нарезка модулей по смыслу

---

## Модуль 5: Дизайн агрегатов

📖 Теория: [theory/AGGREGATE_DESIGN.md](theory/AGGREGATE_DESIGN.md)

- [ ] Агрегат = граница инвариантов = граница транзакции
- [ ] Четыре правила Вернона (Effective Aggregate Design)
- [ ] Транзакционная vs итоговая согласованность
- [ ] Правило «одна транзакция — один агрегат»
- [ ] Проектирование по инвариантам, а не по данным
- [ ] Ссылки на другие агрегаты только по ID
- [ ] Проблема set-based validation (уникальность между агрегатами)
- [ ] Размер агрегата и выбор корня; оптимистичная блокировка версией

---

## Модуль 6: Архитектура

📖 Теория: [theory/ARCHITECTURE.md](theory/ARCHITECTURE.md)

- [ ] Инверсия зависимостей: зависимости смотрят внутрь, к домену
- [ ] Hexagonal (Ports & Adapters): driving vs driven адаптеры
- [ ] Onion и Clean Architecture — три названия одной идеи
- [ ] Composition Root, DI (в том числе без фреймворка)
- [ ] Классическая слоёнка vs инвертированная зависимость
- [ ] Граница, защищённая сборкой / ArchUnit
- [ ] DDD и микросервисы: Bounded Context ↔ сервис, database-per-service, модульный монолит

---

## Модуль 7: Интеграция контекстов

📖 Теория: [theory/INTEGRATION_PATTERNS.md](theory/INTEGRATION_PATTERNS.md)

- [ ] Domain Event vs Integration Event и трансляция между ними
- [ ] Итоговая согласованность между контекстами; цена синхронной интеграции
- [ ] Transactional Outbox (проблема двойной записи)
- [ ] Идемпотентный консьюмер (at-least-once)
- [ ] Saga / Process Manager: оркестрация vs хореография, компенсации
- [ ] CQRS: разделение записи и чтения, проекции
- [ ] Event Sourcing: состояние как журнал фактов

---

## Модуль 8: Функциональный DDD

📖 Теория: [theory/FUNCTIONAL_DDD.md](theory/FUNCTIONAL_DDD.md)

- [ ] Make illegal states unrepresentable
- [ ] Алгебраические типы данных: sum (sealed) и product (data class)
- [ ] Функциональное ядро / императивная оболочка (functional core / imperative shell)
- [ ] Неизменяемость домена и обновление копированием
- [ ] Result / Either для доменных ошибок вместо исключений
- [ ] Parse, don't validate; smart constructor

---

## Модуль 9: Supple Design

📖 Теория: [theory/SUPPLE_DESIGN.md](theory/SUPPLE_DESIGN.md)

- [ ] Intention-revealing interfaces
- [ ] Side-effect-free functions и assertions
- [ ] Closure of operations, standalone classes
- [ ] Conceptual contours
- [ ] Knowledge crunching и model exploration whirlpool
- [ ] Refactoring toward deeper insight; breakthrough

---

## Модуль 10: Антипаттерны

📖 Теория: [theory/ANTIPATTERNS.md](theory/ANTIPATTERNS.md)

- [ ] Анемичная модель (враг №1) — и когда она допустима
- [ ] God Aggregate (агрегат-гигант)
- [ ] Обход корня агрегата
- [ ] Repository на таблицу (DAO-мышление)
- [ ] Протекание доменной модели наружу / инфраструктуры внутрь
- [ ] Primitive Obsession; «универсальная» модель на всю компанию
- [ ] Раздутый Shared Kernel; DDD ради DDD
