# graphql-kotlin — Interview Prep

Площадка для практики GraphQL на стеке Kotlin + Expedia `graphql-kotlin` перед техническими собеседованиями.
Покрывает SDL, резолверы, DataLoader (N+1), Apollo Federation.

> JWT/OAuth2 в контексте защиты GraphQL endpoint’а — в `modules/system-design/theory/identity_providers.md`.
> Spring Security филтр-чейн — в `modules/spring-frameworks/theory/SPRING_SECURITY.md`.
> Здесь — только GraphQL-специфика.

## Структура проекта

```
├── ROADMAP.md                          # 4 модуля с чеклистами и ссылками на теорию
├── PROGRESS.md                         # Трекер прогресса (модули, упражнения, теория)
├── INTERVIEW_QUESTIONS.md              # 15 вопросов с ответами
│
├── theory/                             # Теория по каждому модулю
│   ├── BASICS.md                       # SDL, типы, операции, резолверы, response model
│   ├── GRAPHQL_KOTLIN_SPRING.md        # code-first, Spring Boot, suspend, scalars
│   ├── DATALOADER_NPLUS1.md            # DataLoader идея, KotlinDataLoader, batch limits
│   └── FEDERATION.md                   # Apollo Federation v2, директивы, router
│
└── src/main/kotlin/exercises/
    ├── Ex01  SchemaBasics             — toSchema(...) + SDL print
    ├── Ex02  MutationsSubscriptions   — Mutation + Subscription через Flow
    ├── Ex03  ResolversContext         — per-type резолверы, GraphQLContext
    ├── Ex04  DataLoaderBatching       — фикс N+1, замер callCount
    ├── Ex05  ErrorsScalars            — DateTime scalar, ExceptionHandler
    └── Ex06  FederationSubgraph       — расширение User полем reviews
```

## Темы

| Тема | Ключевые API | Упражнения | Теория |
|------|--------------|-----------|--------|
| Основы | SDL, `Query`/`Mutation`/`Subscription`, fragments, errors model | 01 | [BASICS](theory/BASICS.md) |
| graphql-kotlin Spring | `Query`/`Mutation` маркеры, `@GraphQLDescription`, `GraphQLContext`, custom scalars | 02, 03, 05 | [GRAPHQL_KOTLIN_SPRING](theory/GRAPHQL_KOTLIN_SPRING.md) |
| DataLoader | `KotlinDataLoader`, `dispatch()`, promise cache, `setMaxBatchSize` | 04 | [DATALOADER_NPLUS1](theory/DATALOADER_NPLUS1.md) |
| Federation | `@KeyDirective`, `@ExtendsDirective`, `FederatedTypeResolver`, `_entities` | 06 | [FEDERATION](theory/FEDERATION.md) |

## Как работать

Каждый файл упражнения содержит TODO с описанием задачи. Реализуй, затем запусти:

```bash
# Компиляция
mvn compile

# Запуск конкретного упражнения
mvn exec:java -Dexec.mainClass="exercises.Ex01_SchemaBasicsKt"
```

Команды в CLAUDE.md:
- `"проверь graphql-kotlin Ex01"` — проверка реализации + запуск
- `"следующий"` / `"next"` — следующий незавершённый модуль
- `"квиз"` / `"quiz"` — 5 случайных вопросов из INTERVIEW_QUESTIONS.md
- `"прогресс"` — текущий статус из PROGRESS.md

## Стек

- Kotlin 2.2.21 / JVM 21
- Expedia graphql-kotlin 8.6.0 (`schema-generator`, `spring-server`, `federation`)
- Spring Boot 3.3.5 (WebFlux)
- kotlinx-coroutines 1.10.2 (`-core`, `-reactor`, `-test`)
- Maven 3.9 / JUnit 5

## Источники

- GraphQL spec — <https://spec.graphql.org/>
- graphql-kotlin docs — <https://opensource.expediagroup.com/graphql-kotlin/docs/>
- Apollo Federation — <https://www.apollographql.com/docs/federation/>
- DataLoader pattern — <https://github.com/graphql/dataloader>
- graphql-java — <https://www.graphql-java.com/documentation/>
