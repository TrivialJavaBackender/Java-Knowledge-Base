# graphql-kotlin & Spring Boot

> Expedia Group `graphql-kotlin` — code-first библиотека: схема **выводится из Kotlin-функций и типов** через рефлексию.
> Spring-стартер поднимает endpoint `/graphql` (и subscriptions через WebSocket) на WebFlux.

---

## 1. Schema-first vs Code-first

| | Schema-first | Code-first |
|---|---|---|
| Источник правды | `.graphqls` файл | Kotlin-классы |
| Резолверы | вручную мапятся на поля | сама функция = поле |
| Refactor | переименование = ручная синхронизация SDL | rename safe (компилятор) |
| Документация | в SDL | KDoc + `@GraphQLDescription` |
| Подход в graphql-java | `RuntimeWiring`/typeDefs | (нет нативной поддержки) |
| graphql-kotlin | возможен через `graphql-kotlin-federation` (importing) | **основной режим** |

**graphql-kotlin = code-first.** Схема генерируется при старте через `toSchema(config, queries, mutations, subscriptions)`. SDL можно вывести (`schema.print()`), но он — артефакт, не источник правды.

---

## 2. Маркер-интерфейсы для root operations

Spring-стартер ищет бины, реализующие маркеры:

```kotlin
import com.expediagroup.graphql.server.operations.Query
import com.expediagroup.graphql.server.operations.Mutation
import com.expediagroup.graphql.server.operations.Subscription

@Component
class UserQueries(private val service: UserService) : Query {
    suspend fun user(id: ID): User? = service.findById(id.value.toLong())
    suspend fun users(limit: Int = 10): List<User> = service.list(limit)
}

@Component
class UserMutations(private val service: UserService) : Mutation {
    suspend fun createUser(input: CreateUserInput): User = service.create(input)
}

@Component
class TickerSubscriptions : Subscription {
    fun ticker(symbol: String): Flow<Quote> = flow {
        while (currentCoroutineContext().isActive) {
            emit(fetchQuote(symbol)); delay(1000)
        }
    }
}
```

- Все public-функции класса становятся полями соответствующего root-типа.
- `Query`/`Mutation`/`Subscription` — пустые интерфейсы (просто маркеры для autoconfigure).
- `Subscription`-функции возвращают `Flow<T>` (или `Publisher<T>`).

---

## 3. Маппинг Kotlin → GraphQL

| Kotlin | GraphQL | Заметки |
|---|---|---|
| `Int` | `Int` | 32-bit, как в спецификации |
| `Long` | custom scalar `Long` | в graphql-java по умолчанию extension scalar |
| `Double`/`Float` | `Float` | |
| `String` | `String` | |
| `Boolean` | `Boolean` | |
| `data class User(...)` | `type User { … }` | поля = свойства |
| `class CreateUserInput` (DTO) | `input CreateUserInput { … }` | если используется в аргументах |
| `enum class Role` | `enum Role` | |
| `sealed class` / `interface` | `interface` или `union` | через hooks |
| nullable (`String?`) | `String` (без `!`) | nullable |
| non-null (`String`) | `String!` | |
| `List<T>` | `[T!]!` | если non-null |
| `suspend fun` | обычное поле | graphql-kotlin сам мостит |
| `Flow<T>` | поле в `Subscription` | |

### Аннотации

```kotlin
@GraphQLDescription("Returns currently authenticated user")  // → SDL description
fun me(env: DataFetchingEnvironment): User? { … }

@GraphQLIgnore                       // исключить поле/функцию из схемы
fun internalHelper() = ...

@GraphQLName("UserAccount")          // переименовать тип/поле
data class User(...)

@Deprecated("use email")             // → @deprecated в SDL
val username: String
```

---

## 4. Spring Boot конфигурация

### `application.yml`

```yaml
graphql:
  packages:
    - "by.pavel"                 # где искать типы и резолверы
  endpoint: "graphql"
  graphiql:
    enabled: true                # /graphiql UI в dev
  subscriptions:
    endpoint: "subscriptions"

spring:
  main:
    web-application-type: reactive
```

`graphql.packages` обязателен — иначе schema generator не найдёт типы. Указывают корневой пакет.

### Endpoints

| Путь | Что |
|---|---|
| `POST /graphql` | основной endpoint |
| `GET /graphql` | GET-запросы (для query без переменных) |
| `WS /subscriptions` | WebSocket для subscriptions (`graphql-ws` протокол) |
| `GET /graphiql` | UI (если включен) |
| `GET /sdl` | сгенерированная схема в SDL |

---

## 5. suspend-резолверы и корутины

graphql-kotlin **из коробки** маппит `suspend fun` на асинхронный DataFetcher через `kotlinx-coroutines-reactor`. Возвращаемый `CompletableFuture<T>` интегрирован с graphql-java executor.

Под капотом:
```
suspend fun user(id: ID): User
   │
   ▼ graphql-kotlin DataFetcher
   │
   ▼ GlobalScope.future { user(id) }   // bridge suspend → CompletableFuture
   │
   ▼ graphql-java parallel executor
```

Контекст корутины (`CoroutineContext`) можно расширить через `KotlinDataLoaderRegistryFactory` или кастомный `GraphQLContext` (см. ниже). По умолчанию — `Dispatchers.Default`.

> Внимание: `runBlocking` внутри резолвера — **анти-паттерн**, как и везде в реактивном коде. См. `kotlin-coroutines/theory/DISPATCHERS.md`.

---

## 6. GraphQLContext — request-scoped данные

Контекст — место для `userId`, `requestId`, `JWT-claims`, `dataLoaderRegistry` и т.п. Доступен в любом резолвере через `DataFetchingEnvironment`.

```kotlin
class AuthContextFactory : GraphQLContextFactory<ServerRequest> {
    override suspend fun generateContext(request: ServerRequest): Map<*, Any> {
        val token = request.headers().firstHeader("Authorization") ?: return emptyMap<Any, Any>()
        val user = jwtService.parse(token)
        return mapOf("user" to user, "requestId" to UUID.randomUUID())
    }
}

@Component
class MeResolver : Query {
    fun me(env: DataFetchingEnvironment): User? =
        env.graphQlContext.get<UserPrincipal>("user")?.let(::toUser)
}
```

Регистрация: бин `GraphQLContextFactory` подхватывается автоконфигурацией.

---

## 7. Custom scalars

```kotlin
@GraphQLType(spec = "DateTime")           // alias на стандартный java.time.OffsetDateTime
typealias DateTime = OffsetDateTime

class CustomSchemaGeneratorHooks : FederatedSchemaGeneratorHooks(emptyList()) {
    override fun willGenerateGraphQLType(type: KType): GraphQLType? = when (type.classifier) {
        OffsetDateTime::class -> dateTimeScalar
        UUID::class           -> uuidScalar
        else                  -> super.willGenerateGraphQLType(type)
    }
}

private val dateTimeScalar: GraphQLScalarType = GraphQLScalarType.newScalar()
    .name("DateTime")
    .coercing(object : Coercing<OffsetDateTime, String> {
        override fun serialize(input: Any) = (input as OffsetDateTime).toString()
        override fun parseValue(input: Any) = OffsetDateTime.parse(input as String)
        override fun parseLiteral(input: Any) = OffsetDateTime.parse((input as StringValue).value)
    }).build()
```

Hooks регистрируется как `@Bean` — autoconfigure его подхватит.

---

## 8. Тестирование

```kotlin
@SpringBootTest
@AutoConfigureWebTestClient
class UserGraphQLTest(@Autowired val client: WebTestClient) {
    @Test
    fun `query me returns user`() {
        client.post().uri("/graphql")
            .bodyValue(mapOf("query" to "{ me { id name } }"))
            .exchange()
            .expectBody()
            .jsonPath("$.data.me.name").isEqualTo("Alice")
    }
}
```

Для unit-тестов резолверов — обычный JUnit + mock сервиса; suspend-функции через `runTest` (см. `kotlin-coroutines/theory/TESTING_INTEROP.md`).

---

## 9. Подводные камни

- **`graphql.packages`** не указан → ошибка «No types found». Симптом: схема пустая.
- **Класс не Spring-бин** → не попадёт в схему, даже если реализует `Query`. Нужно `@Component`.
- **Internal-видимость** — graphql-kotlin **по умолчанию пропускает** internal/private. Если поле должно быть в схеме — `public`.
- **Generic с erased типом** в коллекциях — `List<*>` не сгенерится. Нужны конкретные типы.
- **`suspend` в Subscription** — нельзя; должен возвращать `Flow<T>` (или `Publisher`).
- **Reactive vs Servlet** — `graphql-kotlin-spring-server` требует WebFlux. Для классического MVC есть отдельный артефакт `graphql-kotlin-spring-server` (он же), но `web-application-type: reactive` обязателен в большинстве настроек.

---

## 10. Что почитать дальше

- [DATALOADER_NPLUS1.md](DATALOADER_NPLUS1.md) — как победить N+1 в этой связке.
- [FEDERATION.md](FEDERATION.md) — graphql-kotlin-federation для микросервисов.
- Доки: <https://opensource.expediagroup.com/graphql-kotlin/docs/>
- Самплы: <https://github.com/ExpediaGroup/graphql-kotlin/tree/master/examples>
