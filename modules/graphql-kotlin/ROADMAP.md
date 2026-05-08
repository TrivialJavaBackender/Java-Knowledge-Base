# graphql-kotlin — Roadmap

Структурированный план повторения GraphQL на стеке Kotlin + Expedia graphql-kotlin.
Теория в `theory/`, упражнения в `src/main/kotlin/exercises/`.

---

## Порядок прохождения

| Приоритет | Модуль | Частота на собесах |
|-----------|--------|--------------------|
| 1 | Модуль 1: Основы GraphQL (SDL, типы, операции) | ★★★★★ |
| 2 | Модуль 3: DataLoader & N+1 | ★★★★★ |
| 3 | Модуль 2: graphql-kotlin & Spring | ★★★★☆ |
| 4 | Модуль 4: Federation | ★★★☆☆ |

---

## Модуль 1: Основы GraphQL

📖 Теория: [theory/BASICS.md](theory/BASICS.md)

- [ ] GraphQL vs REST — где выигрывает, где проигрывает
- [ ] SDL: scalar / object / interface / union / input / enum
- [ ] non-null `!`, списки `[T!]!`, ID-тип, custom scalars
- [ ] Root types: Query / Mutation / Subscription и их семантика
- [ ] Резолверы: тривиальные vs кастомные, parent/args/context/info
- [ ] Fragments, aliases, variables, directives (`@include`/`@skip`/`@deprecated`)
- [ ] Response model: `data`, `errors`, `extensions`, partial response, error propagation
- [ ] Жизненный цикл запроса на сервере (parse → validate → execute)

**Упражнения:**
- [ ] [Ex01: SchemaBasics](src/main/kotlin/exercises/Ex01_SchemaBasics.kt) — генерация схемы и SDL print

---

## Модуль 2: graphql-kotlin & Spring Boot

📖 Теория: [theory/GRAPHQL_KOTLIN_SPRING.md](theory/GRAPHQL_KOTLIN_SPRING.md)

- [ ] Schema-first vs code-first; почему graphql-kotlin = code-first
- [ ] Маркер-интерфейсы `Query`/`Mutation`/`Subscription` и autoconfigure
- [ ] Маппинг Kotlin → SDL (nullability, generics, suspend, Flow)
- [ ] Аннотации `@GraphQLDescription`, `@GraphQLIgnore`, `@GraphQLName`, `@Deprecated`
- [ ] `application.yml`: `graphql.packages`, `graphiql`, `subscriptions`
- [ ] `GraphQLContext` через `GraphQLContextFactory` — request-scoped данные
- [ ] suspend-резолверы и интеграция с reactor
- [ ] Custom scalars через `SchemaGeneratorHooks`

**Упражнения:**
- [ ] [Ex02: MutationsSubscriptions](src/main/kotlin/exercises/Ex02_MutationsSubscriptions.kt) — Mutation + Subscription Flow
- [ ] [Ex03: ResolversContext](src/main/kotlin/exercises/Ex03_ResolversContext.kt) — per-type резолверы + context
- [ ] [Ex05: ErrorsScalars](src/main/kotlin/exercises/Ex05_ErrorsScalars.kt) — DateTime scalar + ExceptionHandler

---

## Модуль 3: DataLoader & N+1

📖 Теория: [theory/DATALOADER_NPLUS1.md](theory/DATALOADER_NPLUS1.md)

- [ ] Откуда берётся N+1 в GraphQL
- [ ] Идея DataLoader: отложенный батч + per-request кэш
- [ ] `KotlinDataLoader<K, V>` API; `dataLoaderName`; регистрация
- [ ] Использование из резолвера: `env.getDataLoader(...).load(key).await()`
- [ ] Promise cache vs value cache; `clear`/`clearAll` для мутаций
- [ ] `setMaxBatchSize` и почему это важно для БД
- [ ] dispatch tick’и — как graphql-java запускает батч между уровнями
- [ ] Анти-паттерны: глобальный loader, runBlocking, использование в Subscription

**Упражнения:**
- [ ] [Ex04: DataLoaderBatching](src/main/kotlin/exercises/Ex04_DataLoaderBatching.kt) — починка N+1, замер callCount

---

## Модуль 4: Federation

📖 Теория: [theory/FEDERATION.md](theory/FEDERATION.md)

- [ ] Зачем federation; subgraph / supergraph / router
- [ ] Federation v1 vs v2 (`@link`, `@shareable`)
- [ ] Директивы: `@key`, `@external`, `@requires`, `@provides`, `@extends`, `@override`, `@inaccessible`
- [ ] `_service { sdl }` и `_entities` под капотом
- [ ] Entity resolver и протокол `representations: [_Any!]!`
- [ ] Composition: rover compose / managed federation / introspect-and-compose
- [ ] graphql-kotlin-federation — что добавляет к ядру
- [ ] Когда federation НЕ нужна (BFF-альтернатива)

**Упражнения:**
- [ ] [Ex06: FederationSubgraph](src/main/kotlin/exercises/Ex06_FederationSubgraph.kt) — расширение `User` полем `reviews`

---

## Файлы теории

| Файл | Модуль |
|------|--------|
| [theory/BASICS.md](theory/BASICS.md) | Модуль 1 |
| [theory/GRAPHQL_KOTLIN_SPRING.md](theory/GRAPHQL_KOTLIN_SPRING.md) | Модуль 2 |
| [theory/DATALOADER_NPLUS1.md](theory/DATALOADER_NPLUS1.md) | Модуль 3 |
| [theory/FEDERATION.md](theory/FEDERATION.md) | Модуль 4 |
