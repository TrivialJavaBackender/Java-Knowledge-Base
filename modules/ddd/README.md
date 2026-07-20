# Domain-Driven Design — Interview Prep

Модуль для подготовки к собеседованиям по Domain-Driven Design: стратегическое
проектирование (границы контекстов, единый язык, карта контекстов), тактические
паттерны (Value Object, Entity, агрегат, доменные события, репозиторий, фабрика,
сервисы, спецификация), архитектура вокруг домена (Hexagonal / Onion / Clean),
интеграция автономных контекстов (Outbox, Saga, CQRS, Event Sourcing) и
антипаттерны — на уровне backend-разработчика.

Теоретической основой служит проект **DDD-DEMO** (`/Users/pavelsaroka/IdeaProjects/DDD-DEMO`) —
четыре Bounded Context интернет-магазина на чистом Kotlin с ~40 тестами. Модуль
дополняет его тем, чего в демо нет: discovery-воркшопы (Event Storming), глубокий
дизайн агрегатов, функциональный DDD и supple design Эванса.

## Структура проекта

```
├── ROADMAP.md                 # порядок прохождения теории + чеклисты
├── INTERVIEW_QUESTIONS.md     # вопросы с ответами (формат qa-bold)
├── _SUMMARY.md                # семантическое сжатие модуля
│
└── theory/
    ├── INTRO.md               # что такое DDD, стратегия vs тактика, когда применять
    ├── STRATEGIC_DESIGN.md    # поддомены, единый язык, Bounded Context, Context Map
    ├── EVENT_STORMING.md      # discovery: Event Storming, Domain Storytelling, Example Mapping
    ├── TACTICAL_PATTERNS.md   # VO, Entity, Domain Event, Repository, Factory, сервисы, Specification
    ├── AGGREGATE_DESIGN.md    # агрегат как граница инвариантов и транзакции, правила Вернона
    ├── ARCHITECTURE.md        # Hexagonal / Onion / Clean, Ports & Adapters, Composition Root
    ├── INTEGRATION_PATTERNS.md# Domain vs Integration Event, Outbox, Saga, CQRS, Event Sourcing
    ├── FUNCTIONAL_DDD.md       # illegal states unrepresentable, ADT, functional core/imperative shell
    ├── SUPPLE_DESIGN.md        # Эванс: intention-revealing interfaces, knowledge crunching
    └── ANTIPATTERNS.md         # анемичная модель, God Aggregate, обход корня, DDD ради DDD
```

## Темы

| Раздел | Содержание | Теория |
|--------|------------|--------|
| Введение | Что такое DDD, стратегия vs тактика, когда оправдан | [INTRO](theory/INTRO.md) |
| Стратегия | Поддомены, единый язык, Bounded Context, Context Map | [STRATEGIC_DESIGN](theory/STRATEGIC_DESIGN.md) |
| Discovery | Event Storming, Domain Storytelling, Example Mapping | [EVENT_STORMING](theory/EVENT_STORMING.md) |
| Тактика | VO, Entity, Domain Event, Repository, Factory, сервисы, Specification | [TACTICAL_PATTERNS](theory/TACTICAL_PATTERNS.md) |
| Агрегаты | Границы инвариантов и транзакций, правила Вернона, консистентность | [AGGREGATE_DESIGN](theory/AGGREGATE_DESIGN.md) |
| Архитектура | Hexagonal / Onion / Clean, Ports & Adapters, Composition Root | [ARCHITECTURE](theory/ARCHITECTURE.md) |
| Интеграция | Domain vs Integration Event, Outbox, Saga, CQRS, Event Sourcing | [INTEGRATION_PATTERNS](theory/INTEGRATION_PATTERNS.md) |
| Функциональный DDD | Illegal states unrepresentable, ADT, functional core/imperative shell | [FUNCTIONAL_DDD](theory/FUNCTIONAL_DDD.md) |
| Supple Design | Intention-revealing interfaces, closure of operations, knowledge crunching | [SUPPLE_DESIGN](theory/SUPPLE_DESIGN.md) |
| Антипаттерны | Анемичная модель, God Aggregate, обход корня, DDD ради DDD | [ANTIPATTERNS](theory/ANTIPATTERNS.md) |

## Запускаемый референс — DDD-DEMO

Вся теория ссылается на живой код проекта DDD-DEMO, но изложена самодостаточно
(с инлайн-сниппетами на Kotlin) — читать модуль можно, не открывая демо. Чтобы
увидеть паттерны в работе целиком:

```bash
cd /Users/pavelsaroka/IdeaProjects/DDD-DEMO
./gradlew build       # собрать всё и прогнать ~40 тестов
./gradlew :app:run    # консольная «экскурсия»: 5 сценариев саги исполнения заказа
```

## Как работать

Это теоретический модуль (без сборки и упражнений). Прогресс, чтение теории и
повторение карточек — в web app репозитория.

```
"следующий"   — следующая тема теории по ROADMAP
"квиз"        — 5 случайных вопросов из INTERVIEW_QUESTIONS.md
```

## Источники

- *Domain-Driven Design: Tackling Complexity in the Heart of Software* — Eric Evans («Синяя книга»)
- *Implementing Domain-Driven Design* — Vaughn Vernon («Красная книга»)
- *Domain-Driven Design Distilled* — Vaughn Vernon
- *Learning Domain-Driven Design* — Vlad Khononov
- *Domain Modeling Made Functional* — Scott Wlaschin
- *Introducing EventStorming* — Alberto Brandolini
- *Patterns of Enterprise Application Architecture* — Martin Fowler (Repository, Data Mapper, anemic model)
