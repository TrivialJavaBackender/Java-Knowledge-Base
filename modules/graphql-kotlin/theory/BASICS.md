# GraphQL — Основы

> Что такое GraphQL, его модель типов, операции, как сервер отвечает на запросы.
> Это **базовый** модуль — без понимания SDL и резолверов остальные модули бессмысленны.

---

## 1. Что такое GraphQL

GraphQL — это **спецификация query-языка** для API и runtime для его выполнения.
Не транспорт (обычно HTTP POST на один endpoint `/graphql`) и не storage. Только: «как клиент описывает, что ему нужно, и как сервер описывает, что умеет отдавать».

Ключевые свойства:
- **Один endpoint**, любая форма запроса. Клиент сам выбирает поля → нет over-fetching/under-fetching.
- **Типизированная схема** — контракт, проверяемый на этапе компиляции/валидации.
- **Интроспекция** — клиент может узнать схему через `__schema`, `__type` (отсюда GraphiQL, кодген).
- **Версионирование через эволюцию схемы**, а не URL `/v2`. Поля помечают `@deprecated(reason: "...")`.

### GraphQL vs REST

| | REST | GraphQL |
|---|---|---|
| Endpoints | много (`/users/1`, `/users/1/posts`) | один (`/graphql`) |
| Форма ответа | фиксирована сервером | определяется клиентом |
| Типизация | OpenAPI как опция | встроена в спецификацию |
| Версионирование | URL / header | эволюция схемы (`@deprecated`) |
| Кэширование | HTTP-кэш «бесплатно» | сложнее (POST, нужен normalized cache на клиенте) |
| Загрузка связанных данных | N запросов или ad-hoc include | один запрос, любая глубина |
| Мутации | методы HTTP (POST/PUT/DELETE) | операция `mutation { … }` |

> REST живёт в `system-design/theory/http_networking.md`. Здесь — только сравнение.

---

## 2. Schema Definition Language (SDL)

Схема — корень всего. Описывается на SDL — языке описания типов:

```graphql
type Query {
  user(id: ID!): User
  users(limit: Int = 10): [User!]!
}

type User {
  id: ID!
  name: String!
  email: String
  posts: [Post!]!
}

type Post {
  id: ID!
  title: String!
  author: User!
}
```

`!` — non-null. `[T!]!` — non-null список non-null элементов.

### Корневые типы (root operations)

- **Query** — чтение, идемпотентно. Клиент может выполнять параллельно.
- **Mutation** — запись, побочные эффекты. Поля одного `mutation`-блока выполняются **последовательно** (спецификация требует это, чтобы было детерминировано).
- **Subscription** — длительный поток обновлений (обычно WebSocket). На стороне graphql-kotlin — `Flow<T>`.

### Категории типов

| Категория | Пример | Когда |
|---|---|---|
| Scalar | `Int`, `Float`, `String`, `Boolean`, `ID`, custom (`DateTime`, `UUID`) | примитивные значения |
| Object | `type User { … }` | граф объектов сервера |
| Interface | `interface Node { id: ID! }` | shared контракт |
| Union | `union SearchResult = User \| Post` | «или одно, или другое» |
| Input | `input CreateUserInput { … }` | аргументы мутаций (нельзя ссылаться на Object) |
| Enum | `enum Role { ADMIN USER }` | замкнутое множество значений |

### Custom scalars

`DateTime`, `UUID`, `BigDecimal`, `Email` — добавляются вручную: тип в SDL + coercion (parseValue/parseLiteral/serialize). В graphql-kotlin это `GraphQLType` или `@GraphQLType` + регистрация hook’а — см. `GRAPHQL_KOTLIN_SPRING.md`.

---

## 3. Резолверы

**Резолвер** — функция, которая для одного поля одного типа возвращает значение.
Сервер исполняет запрос, обходя дерево полей: для каждого поля вызывает резолвер с аргументами `(parent, args, context, info)`.

```
Query { user(id: 1) { name posts { title } } }
   │
   ├─ Query.user(args: {id: 1}) → User { id: 1, name: "..." }   // root resolver
   │     ├─ User.name(parent: User)        → "..."              // тривиальный (= field access)
   │     └─ User.posts(parent: User)       → [Post, Post, ...]  // load
   │           └─ Post.title(parent: Post) → "..."
```

**Тривиальный резолвер** — просто берёт поле из parent (для data class’ов graphql-kotlin генерирует автоматически).
**Кастомный резолвер** — функция, делающая запрос в БД/сервис.

> N+1 проблема рождается именно здесь: `User.posts` вызывается отдельно для каждого `User` в списке. Решение — DataLoader, см. `DATALOADER_NPLUS1.md`.

---

## 4. Запросы клиента

### Query

```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    name
    posts {
      title
    }
  }
}
```

- `$id` — переменная, передаётся отдельно от текста запроса (`{"id": "42"}`).
- Имя `GetUser` опционально (для дев-инструментов и логов).

### Mutation

```graphql
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) { id title }
}
```

### Fragments — переиспользование набора полей

```graphql
fragment UserCard on User { id name email }

query { me { ...UserCard } users { ...UserCard } }
```

### Aliases — два запроса одного поля

```graphql
{
  me: user(id: "1") { name }
  someone: user(id: "2") { name }
}
```

### Directives

Управляют выполнением: `@include(if: $cond)`, `@skip(if: $cond)`, `@deprecated`. Кастомные — на серверной стороне (`@auth`, `@requireScope` и т.п.).

---

## 5. Модель ответа

```json
{
  "data": { "user": { "name": "Alice" } },
  "errors": [ { "message": "...", "path": ["user","posts"], "extensions": { ... } } ],
  "extensions": { ... }
}
```

- `data` — может содержать `null` для конкретного поля, если оно nullable, а резолвер упал.
- `errors` — массив. **Partial response**: одно поле упало, остальные ответили.
- non-null поле, упавшее с ошибкой → ошибка «всплывает» к ближайшему nullable родителю (error propagation).
- `extensions` — место для произвольных метаданных (tracing, deprecations, request id).

---

## 6. Жизненный цикл запроса на сервере

```
HTTP POST /graphql                       (transport)
   │  body: { query, variables, operationName }
   ▼
Parser           — текст → AST документа
   ▼
Validator        — AST против схемы (поля, типы аргументов, фрагменты)
   ▼
Executor         — обход дерева, вызовы резолверов (параллельно для Query)
   │     ├── DataFetcher для каждого поля
   │     └── DataLoader агрегирует одинаковые подзапросы (см. DATALOADER_NPLUS1.md)
   ▼
JSON ответ { data, errors, extensions }
```

В graphql-kotlin под капотом — `graphql-java`. graphql-kotlin — **тонкий слой** над ним, генерирующий схему из Kotlin-функций (code-first, см. `GRAPHQL_KOTLIN_SPRING.md`).

---

## 7. Что почитать дальше

- [GRAPHQL_KOTLIN_SPRING.md](GRAPHQL_KOTLIN_SPRING.md) — как всё это запустить на Kotlin + Spring Boot.
- [DATALOADER_NPLUS1.md](DATALOADER_NPLUS1.md) — как избежать N+1.
- [FEDERATION.md](FEDERATION.md) — несколько GraphQL-сервисов как один граф.
- Спецификация: <https://spec.graphql.org/>
- Apollo learning: <https://www.apollographql.com/tutorials/>
