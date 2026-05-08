# Apollo Federation & schema stitching

> Как из нескольких GraphQL-сервисов собрать **один** граф.
> Federation — стандарт от Apollo, текущая мажорная — Federation v2 (директивы `@link`).

---

## 1. Зачем нужна federation

Микросервисы → много GraphQL-сервисов. Клиент не должен знать про их количество — он хочет один endpoint и единую схему.

Варианты эволюции:
1. **Один монолитный GraphQL** — простой, но в большом домене теряет скорость и владение командами.
2. **Schema stitching** (legacy) — gateway сшивает SDL разных сервисов «руками» (link-types, делегирование).
3. **Apollo Federation** (актуально) — у каждого сервиса (subgraph) есть мета-директивы, gateway/router композирует один supergraph.

| Подход | Композиция | Гибкость | Состояние |
|---|---|---|---|
| Stitching | gateway знает all schemas | вручную мапить типы | legacy |
| Federation v1 | через `@key`/`@external` | стандартизовано | поддерживается |
| Federation v2 | `@link`, `@shareable`, value types | shared types, лучше композит | **актуально** |

---

## 2. Архитектура Federation

```
              client
                │
                ▼
        ┌──────────────┐
        │   Router /   │      (Apollo Router — Rust, или GraphQL Gateway — Node)
        │   Gateway    │      хранит supergraph SDL
        └──────┬───────┘
               │  query plan: «эти поля → users-service, эти → orders-service»
               │
   ┌───────────┼───────────────┐
   ▼           ▼               ▼
┌───────┐  ┌────────┐    ┌──────────┐
│ users │  │ orders │    │ products │   ← subgraphs (graphql-kotlin-federation)
└───────┘  └────────┘    └──────────┘
```

- **Subgraph** — обычный GraphQL-сервис плюс federation-директивы.
- **Supergraph** — композит схема. Собирается утилитой `rover supergraph compose` (CLI) или динамически из `_service { sdl }` (managed federation в Apollo Studio).
- **Router** — компонент, принимающий клиентские запросы и распределяющий их по subgraphs (и склеивающий результаты, в т.ч. через `_entities`).

---

## 3. Ключевые директивы

### `@key(fields: "id")` — primary identifier

Определяет «ключ» по которому тип может быть найден в этом subgraph. Если `User` определён в `users-service` с `@key(fields: "id")`, любой другой subgraph может **расширить** этот тип.

```graphql
# users-service
type User @key(fields: "id") {
  id: ID!
  name: String!
  email: String
}
```

### Расширение типа в другом subgraph

```graphql
# reviews-service
type User @key(fields: "id") @extends {
  id: ID! @external
  reviews: [Review!]!
}

type Review @key(fields: "id") {
  id: ID!
  text: String!
  author: User!
}
```

- `@extends` — «этот тип определён в другом subgraph».
- `@external` — «поле я не резолвлю, оно от owning subgraph».
- При запросе `User.reviews`, router пойдёт в `reviews-service` с representation `{ id: ... }` — там нужно реализовать **entity resolver**.

### `@requires(fields: "...")`

«Чтобы зарезолвить это поле, мне нужны указанные поля владельца типа». Router сначала их подтянет.

```graphql
type User @key(fields: "id") @extends {
  id: ID! @external
  email: String! @external
  emailDomain: String! @requires(fields: "email")
}
```

### `@provides(fields: "...")`

«Я уже отдаю эти поля встройкой» — оптимизация, чтобы router не бегал в owner-subgraph за ними дополнительно.

### `@shareable` (Federation v2)

Поле, которое могут резолвить **несколько subgraphs одинаково**. Без неё дубликат поля = ошибка композиции.

### `@inaccessible`, `@override`, `@tag`

- `@inaccessible` — поле скрыто от supergraph (доступно только внутри subgraph).
- `@override(from: "users-service")` — переезд поля из другого subgraph (миграция).
- `@tag(name: "...")` — метаданные для контрактов.

---

## 4. Entity resolver — `_entities`

Router передаёт subgraph’у запрос вида:
```graphql
query($repr: [_Any!]!) {
  _entities(representations: $repr) {
    ... on User { id reviews { text } }
  }
}
```

`representations` — это массив `{__typename, key fields}`. Subgraph должен по ним вернуть полноценные entity-объекты.

В graphql-kotlin-federation:
```kotlin
@KeyDirective(fields = FieldSet("id"))
@ExtendsDirective
data class User(@ExternalDirective val id: ID) {
    suspend fun reviews(): List<Review> = reviewRepo.findByUserId(id.value.toLong())
}

class FederatedUserResolver : FederatedTypeResolver<User> {
    override val typeName: String = "User"
    override suspend fun resolve(env: DataFetchingEnvironment, repr: List<Map<String, Any>>): List<User?> =
        repr.map { User(ID(it["id"] as String)) }
}
```

Бин `FederatedTypeResolver<User>` подхватывается автоконфигурацией `graphql-kotlin-federation`.

---

## 5. graphql-kotlin-federation — что меняет

```xml
<dependency>
    <groupId>com.expediagroup</groupId>
    <artifactId>graphql-kotlin-federation</artifactId>
</dependency>
```

- Добавляет federation-директивы в SDL (`@key`, `@external`, и т.д.).
- Регистрирует поле `_service { sdl }` (по нему router забирает SDL subgraph’а).
- Регистрирует поле `_entities` — точку входа entity resolver’ов.
- Hooks-класс `FederatedSchemaGeneratorHooks` нужно собрать вручную и положить в Spring-контекст:

```kotlin
@Bean
fun hooks(resolvers: List<FederatedTypeResolver<*>>): SchemaGeneratorHooks =
    FederatedSchemaGeneratorHooks(resolvers)
```

---

## 6. Композиция (compose-time vs runtime)

| Способ | Как |
|---|---|
| **Static (rover CLI)** | `rover supergraph compose --config supergraph.yaml > supergraph.graphql`, кладётся в router |
| **Managed (Apollo Studio)** | subgraphs регистрируют схемы → studio композит → router тянет |
| **IntrospectAndCompose** (legacy gateway) | router при старте обходит `_service { sdl }` всех |

Composition валидирует: один и тот же тип должен быть совместим во всех subgraphs (та же сигнатура полей, корректные `@key`, и т.д.).

---

## 7. Подводные камни

- **Циклы между subgraphs** — допустимы, но усложняют query plan. Старайся, чтобы один тип «жил» в одном subgraph.
- **Без `@key` на entity** → расширения не работают. SDL композируется, но `_entities` падает.
- **Изменение `@key`-полей** — breaking change. Нужна координация.
- **Пагинация и cursor’ы** — через subgraphs работают плохо, если cursor встроен в один subgraph; обычно cursor нормализуют (Relay-style).
- **DataLoader на router** — нет; DataLoader работает в каждом subgraph. Между subgraph’ами router сам батчит entity-запросы (по `__typename` + ключи).
- **Auth** — обычно gateway/router пропускает `Authorization` header вниз. Подходы — см. `system-design/theory/auth_security.md`.

---

## 8. Когда federation **не нужна**

- < 5 GraphQL-сервисов и одна команда — overkill.
- Сервисы пишут на разных стеках, но домены не пересекаются — лучше отдельные эндпоинты.
- Большая часть данных в одной БД — стичь схемы будет искусственно.

Альтернатива — один graphql-kotlin сервис как «BFF» поверх REST/gRPC бэкендов. См. контекст микросервисов в `system-design/theory/microservice_patterns.md`.

---

## 9. Что почитать

- Apollo Federation spec: <https://www.apollographql.com/docs/federation/>
- graphql-kotlin federation: <https://opensource.expediagroup.com/graphql-kotlin/docs/server/federation/federated-schemas>
- Apollo Router: <https://www.apollographql.com/docs/router/>
- Rover CLI: <https://www.apollographql.com/docs/rover/>
