# GraphQL — Interview Questions

15 вопросов с развёрнутыми ответами. Источники указаны в blockquote.

---

## 1. Основы GraphQL

### Q1: В чём ключевые отличия GraphQL от REST? Когда GraphQL уместнее?

**A:** GraphQL — это типизированный query-язык с одним endpoint’ом и единой схемой. Клиент сам выбирает поля → нет over-fetching и under-fetching. Версионирование — через эволюцию схемы и `@deprecated`, не через `/v2`. Поддерживает один запрос с произвольной глубиной связей и подписки. REST же опирается на множество URL’ов, фиксированную форму ответа и HTTP-кэш «из коробки».

GraphQL уместен, когда:
- много клиентов с разными нуждами (mobile vs web), каждый берёт нужный набор полей;
- модель домена графовая (User → Posts → Comments → User), и клиент часто хочет всё сразу;
- продукт быстро эволюционирует, и хочется добавлять поля без `/v2`.

REST остаётся проще, когда: ресурсы плоские, нужна агрессивная HTTP-кэширование, нет команды чтобы поддерживать схему/кодген.

> graphql.org/learn, Apollo blog «GraphQL vs REST»

---

### Q2: Расскажи про модель типов GraphQL. Какие категории?

**A:** Шесть категорий:
1. **Scalar** — `Int`, `Float`, `String`, `Boolean`, `ID` плюс custom (`DateTime`, `UUID`).
2. **Object** — `type User { … }`, поля имеют резолверы.
3. **Interface** — общий контракт; объекты-имплементации указывают `implements`.
4. **Union** — «одно из»: `union SearchResult = User | Post`.
5. **Input** — типы для аргументов мутаций; не могут содержать резолверы или ссылки на Object.
6. **Enum** — замкнутый набор значений.

Модификаторы: `!` — non-null, `[T!]!` — non-null список non-null элементов. Корневые типы — `Query`, `Mutation`, `Subscription`.

> spec.graphql.org

---

### Q3: Чем отличаются Query, Mutation и Subscription?

**A:**
- **Query** — чтение, идемпотентно. Поля одного запроса исполнитель **может выполнять параллельно**.
- **Mutation** — запись с побочными эффектами. Поля одного блока выполняются **последовательно** (по спецификации) — иначе порядок мутаций был бы недетерминирован.
- **Subscription** — long-lived поток, обычно поверх WebSocket (`graphql-ws` протокол). На стороне graphql-kotlin реализуется как `Flow<T>`. Канонично — один root-field на одну подписку.

> spec.graphql.org §6.2 (Mutation strict ordering)

---

### Q4: Что такое fragments, aliases, variables?

**A:**
- **Fragment** — переиспользуемый набор полей: `fragment UserCard on User { id name email }`. Помогает не дублировать селекшен-сеты.
- **Alias** — переименование поля в ответе: `me: user(id: "1") { name }`. Нужно когда одно поле запрашивается несколько раз с разными аргументами.
- **Variable** — параметр вне текста запроса: `query GetUser($id: ID!) { user(id: $id) }`, значения `{"id":"42"}` передаются отдельно. Важно для безопасности (переменные не подмешиваются в строку запроса) и кэширования (кэш — по тексту запроса + переменным).

Бонус: **inline fragment** — `... on User { … }` для union/interface, чтобы выбрать поля конкретного варианта.

> spec.graphql.org §2.8–2.10

---

### Q5: Как устроен ответ и обработка ошибок?

**A:** Ответ — JSON c полями `data`, `errors`, `extensions`:

```json
{ "data": { "user": null }, "errors": [{ "message": "...", "path": ["user","posts"], "extensions": {"code":"NOT_FOUND"} }] }
```

Ключевые свойства:
- **Partial response**: ошибки в одном поле не валят весь запрос.
- **Error propagation**: если non-null поле зарезолвилось null или с ошибкой, null «всплывает» к ближайшему nullable родителю; в крайнем случае `data: null`.
- `errors` — массив; у каждой `message`, `path`, опционально `locations` и `extensions` (свободное место для `code`, `requestId`, и т.п.).
- В graphql-kotlin кастомизация — через `DataFetcherExceptionHandler`.

> graphql-java docs «Error Handling»

---

## 2. graphql-kotlin & Spring Boot

### Q6: Чем code-first отличается от schema-first и почему graphql-kotlin — code-first?

**A:**
- **Schema-first**: SDL — источник правды. Резолверы пишутся отдельно и вручную мапятся на поля (как в graphql-java + RuntimeWiring).
- **Code-first**: схема выводится из кода (типы и функции). Преимущество — refactor-safe (компилятор переименует), DRY, ближе к остальному Kotlin-коду. Недостаток — сложнее посмотреть SDL не запуская приложение (хотя `graphql-kotlin` экспортирует через `/sdl`).

graphql-kotlin полностью code-first: ты пишешь `class FooQueries : Query { fun bar(): Int = 42 }`, schema generator через рефлексию строит SDL.

> opensource.expediagroup.com/graphql-kotlin/docs

---

### Q7: Как работает schema generator в graphql-kotlin? Какие подводные камни?

**A:** При старте `toSchema(config, queries, mutations, subscriptions)` (или Spring autoconfigure) проходит по всем `TopLevelObject` через рефлексию: берёт public-функции и свойства, мапит Kotlin-типы на GraphQL-типы (с учётом nullability и generics), регистрирует типы в схеме. Поведение настраивается через `SchemaGeneratorHooks` (custom scalars, фильтры).

Подводные камни:
- `graphql.packages` обязательно указать в `application.yml`, иначе типы не находятся.
- Резолвер должен быть **Spring-бином** (`@Component`) — иначе autoconfigure его не подхватит.
- Internal/private не попадают в схему по умолчанию.
- Generic с erased типом в коллекциях (`List<*>`) не сгенерится.
- Subscription — обязан возвращать `Flow<T>` (или `Publisher<T>`), не `suspend`.

> graphql-kotlin docs «Generator Configuration»

---

### Q8: Как graphql-kotlin поддерживает suspend-резолверы?

**A:** При генерации schema for `suspend fun foo(): Bar` создаётся специальный DataFetcher, который вызывает функцию через корутинный bridge `kotlinx-coroutines-jdk8.future { … }`, возвращающий `CompletableFuture<Bar>`. graphql-java executor умеет ждать CF естественно.

Контекст корутины наследуется от `Dispatchers.Default`; при необходимости можно сделать кастомный `CoroutineContext` через DataLoader registry и `GraphQLContext`. Главное — не вызывать `runBlocking` внутри (заблокирует executor-поток).

> graphql-kotlin docs «Coroutines»

---

### Q9: Что такое GraphQLContext и зачем он?

**A:** `GraphQLContext` — request-scoped мап, доступный в каждом резолвере через `DataFetchingEnvironment.graphQlContext`. Туда кладут: текущего `UserPrincipal`, `requestId`, локаль, `DataLoader`-регистри. Создаётся на каждый запрос через бин `GraphQLContextFactory<ServerRequest>`.

Альтернатива — `localContext` (передаётся от parent резолвера к children). Глобальное состояние (`@Component`) — для request-зависимых данных не подходит, потому что нет thread-locality (резолверы могут гулять по разным потокам в reactor).

> graphql-kotlin docs «GraphQL Context»

---

## 3. DataLoader & N+1

### Q10: Что такое N+1 в GraphQL и почему он практически неизбежен?

**A:** Запрос `{ posts { author { name } } }` получает 100 постов одним SQL и затем для каждого вызывает резолвер `Post.author` отдельно → 100 SQL’ей плюс первый = 101.

В REST такого нет, потому что разработчик заранее решает форму ответа и пишет `JOIN`. В GraphQL клиент сам выбирает поля — сервер не знает заранее, нужен ли `author`. Тривиальная имплементация резолверов (по полю на вызов) даёт N+1 как побочный эффект гибкости.

> Apollo «DataLoader» blog 2017

---

### Q11: Как DataLoader решает N+1? Опиши его жизненный цикл.

**A:** DataLoader — отложенный батч + per-request кэш.
1. Резолвер вызывает `loader.load(key)` — получает `CompletableFuture<V>`, ничего сразу не загружается.
2. Все `load()` одного execution tick’а копятся в очередь.
3. graphql-java вызывает `loader.dispatch()` после того, как все резолверы текущего уровня выдали свои CF.
4. DataLoader дедуплицирует ключи и вызывает `batchLoadFunction(keys: List<K>) -> List<V>`.
5. Полученные значения раздаются обратно в CF в **том же порядке, что ключи**.

Кэш — двухуровневый: promise cache (CF на ключ) и value cache (после resolve). Per-request, чтобы не утекать данные между пользователями. Размер батча ограничен `setMaxBatchSize` (для дружбы с БД).

> github.com/graphql/dataloader, graphql-java «Batching»

---

### Q12: Какие есть подводные камни DataLoader?

**A:**
- **Order matters**: batch function обязана вернуть значения в порядке ключей; если значение отсутствует — `null` на этой позиции.
- **Длина списка должна совпадать** с длиной ключей; иначе DataLoader падает с `BatchLoaderError`.
- **Не работает в Subscription** «из коробки» — там нет request scope в классическом смысле.
- **Глобальный shared cache** легко даёт cross-tenant утечки и stale data; обычно лучше per-request.
- **Mutations**: после изменения данных `loader.clear(id)` — иначе тот же запрос увидит старые данные в последующих полях.
- **Размер батча** без лимита бьёт по `IN (...)`-параметру БД и портит план запроса.

> graphql-kotlin DataLoader docs

---

## 4. Federation

### Q13: Зачем нужна Apollo Federation, и из каких частей она состоит?

**A:** Federation — стандарт композиции нескольких GraphQL-сервисов в один граф. Решает: (1) разделение по командам/доменам, (2) единый endpoint для клиента, (3) типобезопасный кросс-сервис join.

Компоненты:
- **Subgraph** — обычный graphql-сервис плюс federation-директивы (`@key`, `@external`, и т.д.) и обязательные служебные поля `_service { sdl }` и `_entities`.
- **Supergraph** — композит схема, собранная из subgraph-схем (статически через `rover compose` или динамически через managed federation в Apollo Studio).
- **Router/Gateway** — Apollo Router (Rust) или Apollo Gateway (Node), который принимает клиентские запросы, строит query plan и распределяет работу по subgraphs, склеивая результаты через `_entities`.

> apollographql.com/docs/federation

---

### Q14: Что делают директивы `@key` и `@external`?

**A:**
- `@key(fields: "id")` — объявляет, что у типа есть «первичный ключ» по этим полям; через них тип может быть найден в этом subgraph и расширен в других.
- `@external` — помечает поле как «определено в чужом subgraph». Внутри текущего subgraph такое поле не резолвится.

Каноничный паттерн расширения:
```graphql
# users-service: type User @key(fields: "id") { id name email }
# reviews-service:
type User @key(fields: "id") @extends {
  id: ID! @external
  reviews: [Review!]!
}
```

Router при запросе `User.reviews` приходит к reviews-service с `representations: [{__typename: "User", id: "..."}]`, и subgraph должен вернуть `User`-объект (через **entity resolver**), у которого затем будет вызван `reviews()`.

> apollographql.com/docs/federation/entities

---

### Q15: Чем gateway/router отличается от schema stitching и когда federation не нужна?

**A:** **Schema stitching** (legacy) — gateway знает все subgraph-схемы и **вручную** настраивает делегирование/линковку типов. Federation формализует этот процесс через директивы и стандартный протокол `_entities`/`_service`, делает его типобезопасным и пригодным для managed композиции.

**Router (Apollo Router)** — более новый компонент на Rust, заточен под federation v2; **gateway (Apollo Gateway)** — старая Node-реализация. Технически взаимозаменяемы для большинства простых случаев.

Federation **не нужна**, когда:
- < 5 GraphQL-сервисов и одна команда — overhead избыточен;
- сервисы пишут на разных стеках, но домены не пересекаются — лучше отдельные эндпоинты;
- большая часть данных в одной БД — стичь схемы будет искусственно.

Альтернатива в этих случаях — единый graphql-kotlin сервис как **BFF** поверх REST/gRPC бэкендов (см. `../microservices/theory/EDGE_AND_MESH.md`).

> apollographql.com/blog «Federation 2», «Choosing a gateway»
