# DataLoader & N+1

> Главная производственная проблема GraphQL и её каноническое решение.
> N+1 рождается из природы graphql-резолверов: каждое поле — отдельный вызов.

---

## 1. Откуда берётся N+1

Запрос:

```graphql
{ posts { title author { name } } }
```

Наивная реализация:
```kotlin
class PostQueries : Query {
    fun posts(): List<Post> = postRepo.findAll()        // 1 запрос
}
class PostResolvers {
    fun author(post: Post): User = userRepo.findById(post.authorId)  // N запросов
}
```

При 100 постах → **101 запрос в БД**. Это и есть «N+1».

В REST такого не бывает: ты сам решаешь, как загрузить и какие join’ы сделать. В GraphQL клиент сам решает — `author` может быть запрошен или нет, и ты не знаешь заранее. Решение — батчинг **по запросу к серверу** (per-request).

---

## 2. Идея DataLoader

DataLoader = **отложенный батч** + кэш.

```
        ┌────────────┐
post 1  │   .load()  │──► «жду authorId=10»  ┐
post 2  │   .load()  │──► «жду authorId=20»  │  все запросы
post 3  │   .load()  │──► «жду authorId=10»  │  собираются в очередь
…       │            │                       │
post N  │   .load()  │──► «жду authorId=99»  ┘
        └────────────┘
                                    ▼
                       dispatch() в конце execution-tick’а
                                    ▼
                  batchLoadFunction(setOf(10, 20, …, 99))
                                    ▼
                    SQL: WHERE id IN (10,20,…,99)   ← 1 запрос
                                    ▼
                  Map<id, User> → разлайвается обратно
```

Ключевые свойства:
- **Per-request scope** — у каждого GraphQL-запроса свой DataLoader, кэш не утекает между пользователями.
- **Дедупликация** — одинаковые `id` собираются один раз (тот же `authorId=10` от двух постов).
- **Сохраняет порядок** — `loadAll(keys)` возвращает значения в том же порядке, что ключи.
- **Цепочки** — `load()` может стартовать другие `load()` (например, author → company); диспетчер делает несколько раундов.

---

## 3. graphql-kotlin: KotlinDataLoader

```kotlin
class UserDataLoader(private val userRepo: UserRepository) :
    KotlinDataLoader<Long, User?> {

    override val dataLoaderName: String = "UserDataLoader"

    override fun getDataLoader(graphQLContext: GraphQLContext): DataLoader<Long, User?> =
        DataLoaderFactory.newDataLoader { keys: List<Long> ->
            CompletableFuture.supplyAsync {
                val byId = userRepo.findAllById(keys).associateBy { it.id }
                keys.map { byId[it] }                       // важен порядок!
            }
        }
}
```

Регистрация — Spring-бин или явный `KotlinDataLoaderRegistryFactory`:
```kotlin
@Bean
fun dataLoaderRegistry(loaders: List<KotlinDataLoader<*, *>>) =
    KotlinDataLoaderRegistryFactory(loaders)
```

Использование в резолвере:
```kotlin
fun author(post: Post, env: DataFetchingEnvironment): CompletableFuture<User?> =
    env.getDataLoader<Long, User?>("UserDataLoader").load(post.authorId)
```

С suspend-резолвером:
```kotlin
suspend fun author(post: Post, env: DataFetchingEnvironment): User? =
    env.getDataLoader<Long, User?>("UserDataLoader").load(post.authorId).await()
```

`await()` из `kotlinx-coroutines-jdk8` мостит CF→suspend.

---

## 4. Почему именно «отложенный»

graphql-java executor выполняет поля одного уровня **параллельно** (для Query). Между уровнями есть `dispatch tick`: после того как все резолверы текущего уровня вернули `CompletableFuture`, диспетчер вызывает `dataLoader.dispatch()` — и тогда батч уходит.

```
level 1: Query.posts()          ─┐
                                 │  ждём CF
level 2: Post.author() x 100    ─┤  (100 load() в очереди)
                                 │
                  dispatch()  ◄──┘
                                 │
                  batchLoad(unique ids)  ── 1 SQL
                                 │
                  CF complete
                                 ▼
level 3: User.name() x 100      … тривиальный, без БД
```

---

## 5. Caching nuances

DataLoader держит **two-tier cache**:
1. **Promise cache** — мап `key → CompletableFuture`. `load(10)` дважды → один CF.
2. **Value cache** — после resolve хранит уже значение.

Лимиты:
- Кэш **per-request** — пересоздаётся для каждого GraphQL-запроса.
- Можно отключить (`DataLoaderOptions.newOptions().setCachingEnabled(false)`).
- Можно подменить на shared cache (`Caffeine`) — но это уже не «классический» DataLoader, и обычно плохая идея (cross-tenant, stale data).
- `clear(key)` / `clearAll()` — для мутаций, чтобы не закэшировать устаревшее в том же запросе.

---

## 6. Batch limits

```kotlin
DataLoaderOptions.newOptions()
    .setMaxBatchSize(100)               // делит на чанки
    .setBatchingEnabled(true)
    .setStatisticsCollector { Statistics() }
```

Зачем `maxBatchSize`:
- БД не любит `IN (10000 ids)` — план теряется, parameter limit превышается.
- 100–500 — здравый дефолт, под нагрузку настраивается.

---

## 7. Альтернативы и анти-паттерны

| Подход | Когда | Плюсы | Минусы |
|---|---|---|---|
| DataLoader | связи (author, company, tags) | стандарт, чисто | каждое поле — свой loader |
| Eager join в root резолвере | `posts(includeAuthor: Boolean)` | один SQL | разрушает гибкость GraphQL |
| `@BatchMapping` (Spring GraphQL) | Spring native, не graphql-kotlin | автомагия | не работает в graphql-kotlin |
| Кэш в сервисе | стабильные справочники | быстро | проблемы инвалидации |
| Кэш на уровне БД (Hibernate L2) | те же справочники | работает по всему стеку | см. `spring-frameworks/theory/SPRING_DATA_JPA.md` |

**Анти-паттерны:**
- **Кэш на app-level Map без TTL** — мемлики и stale data.
- **Один глобальный DataLoader без request scope** — утечка данных между пользователями.
- **`runBlocking` или `Thread.sleep` в batch function** — блокирует execution thread, ломает параллелизм.
- **Запуск `load()` из `Subscription`** — DataLoader заточен под request-response. Подписки требуют другого подхода.

---

## 8. Метрики и наблюдаемость

DataLoader даёт `Statistics`: `batchInvokeCount`, `batchLoadCount`, `cacheHitCount`. Их полезно слать в Micrometer/Prometheus. Связь с метриками — см. `infrastructure/theory/METRICS.md`.

---

## 9. Что почитать

- DataLoader спецификация: <https://github.com/graphql/dataloader> (JS, но идеи те же).
- graphql-java DataLoader: <https://www.graphql-java.com/documentation/batching/>.
- graphql-kotlin DataLoader: <https://opensource.expediagroup.com/graphql-kotlin/docs/server/data-loader>.
- Контекст про индексы и батч-запросы → `system-design/theory/database_indexes.md`.
