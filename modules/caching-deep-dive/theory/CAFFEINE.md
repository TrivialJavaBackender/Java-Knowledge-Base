# Caffeine — production JVM cache

[Caffeine](https://github.com/ben-manes/caffeine) — наследник Guava Cache от того же автора (Ben Manes), переписанный на современную JVM. **Default выбор** для in-process кэша на Java/Kotlin.

## Зачем Caffeine, а не `ConcurrentHashMap`

`ConcurrentHashMap` — отличная concurrent map, но **не cache**:
- нет лимита размера → утечка памяти;
- нет TTL/expiry;
- нет статистики hit/miss;
- нет eviction policy.

Caffeine добавляет всё это поверх внутренней concurrent hash table, оптимизированной под чтение. См. [`concurrency/theory/CONCURRENT_COLLECTIONS.md`](../../concurrency/theory/CONCURRENT_COLLECTIONS.md) про базовый CHM.

## Базовый API

```kotlin
val cache: Cache<String, User> = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .recordStats()
    .build()

cache.put("u:42", user)
val u = cache.getIfPresent("u:42")    // null если miss
val u2 = cache.get("u:42") { id -> loadFromDb(id) }   // single-flight loader
```

## LoadingCache

Если loader для ключа всегда один — задать в build:

```kotlin
val cache: LoadingCache<String, User> = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .build { id -> loadFromDb(id) }     // CacheLoader<K, V>

val u = cache.get("u:42")  // miss → loader → put → return
```

Caffeine гарантирует, что loader для одного ключа вызовется **в один момент времени один раз** (single-flight) — встроенная защита от cache stampede.

## AsyncLoadingCache

```kotlin
val cache: AsyncLoadingCache<String, User> = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .buildAsync { id, executor -> CompletableFuture.supplyAsync({ loadFromDb(id) }, executor) }

val future: CompletableFuture<User> = cache.get("u:42")
```

Возвращает `CompletableFuture<V>`. Промахи не блокируют caller'а. Для Kotlin coroutines удобно интегрировать через `kotlinx-coroutines-jdk8` (`future.await()`).

## Expiry

| Метод | Семантика |
|-------|-----------|
| `expireAfterWrite(d)` | TTL от момента `put` |
| `expireAfterAccess(d)` | TTI от последнего `get`/`put` |
| `expireAfter(Expiry)` | Custom, зависит от ключа/значения |
| `refreshAfterWrite(d)` | После d следующий `get` возвращает старое и **асинхронно** триггерит loader. Не expires! |

Combo `refreshAfterWrite + expireAfterWrite` — идеал для горячих ключей:
```kotlin
.refreshAfterWrite(Duration.ofMinutes(1))
.expireAfterWrite(Duration.ofMinutes(10))
.build { id -> loadFromDb(id) }
```
- Холодные ключи живут 10 минут, потом удаляются.
- Горячие ключи каждую минуту обновляются в фоне → пользователь получает <1мс ответ всегда.

## Eviction policy

Default — **W-TinyLFU**. Не настраивается на другую (это намеренно). Если нужен LRU/LFU — стройте сами (или возьмите Guava Cache, у которой LRU).

## Listeners

```kotlin
.removalListener { key, value, cause ->
    log.info("Removed $key (cause=$cause)")
}
.evictionListener { key, value, cause -> ... }   // только eviction (size, expire)
```

`RemovalCause`: `EXPLICIT`, `REPLACED`, `COLLECTED` (GC), `EXPIRED`, `SIZE`.

`removalListener` — async (через executor), `evictionListener` — sync (внутри critical section, не блокировать!).

## Weigher

```kotlin
.maximumWeight(100_000_000)   // 100MB
.weigher { _: String, value: ByteArray -> value.size }
```

Когда значения сильно различаются по размеру.

## Statistics

```kotlin
.recordStats()  // включает счётчики
...
val stats = cache.stats()
println(stats.hitRate())          // 0.92
println(stats.evictionCount())
println(stats.averageLoadPenalty())  // ns на miss
```

Счётчики — atomic, overhead минимален. Включать в production обязательно (метрики в Prometheus/Micrometer).

## Caffeine vs Guava Cache

| Аспект | Caffeine | Guava |
|--------|----------|-------|
| Eviction | W-TinyLFU | LRU |
| Performance | до 4x на чтение, 2x на запись | baseline |
| Async API | `AsyncLoadingCache` | нет |
| Active development | Да | Заморожен |
| Зависимость | отдельная JAR | guava (тяжёлая) |

Default — **Caffeine**. Guava Cache до сих пор в проектах, но новый код пишут на Caffeine.

## Caffeine + Spring Cache Abstraction

```kotlin
@Configuration
@EnableCaching
class CacheConfig {
    @Bean
    fun cacheManager(): CacheManager = CaffeineCacheManager().apply {
        setCaffeine(Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(10))
            .maximumSize(10_000))
    }
}

@Service
class UserService(...) {
    @Cacheable("users")
    fun byId(id: String): User = repo.findById(id)
}
```

Аннотации Spring (`@Cacheable`, `@CacheEvict`, `@CachePut`) → Caffeine как backend. См. [`spring-frameworks/theory/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md).

## Подводные камни

1. **Без `recordStats()` — не узнаешь hit-ratio.** Включай всегда.
2. **Loader не должен бросать checked-исключения** иначе `LoadingCache` не подойдёт; используй try/catch внутри.
3. **`removalListener` не вызывается при invalidation сразу** — там асинхронный flush. Не полагаться на синхронные сайд-эффекты.
4. **`getIfPresent` не триггерит refresh.** Только `get(key)` (или `get(key, loader)`) активирует refresh-after-write.
5. **`expireAfter` (custom) дороже** — если можно обойтись `expireAfterWrite/Access`, используй их.

## См. также

- Eviction алгоритм W-TinyLFU → [EVICTION_POLICIES.md](EVICTION_POLICIES.md)
- Two-level near-cache → [DISTRIBUTED_CACHING.md](DISTRIBUTED_CACHING.md), Ex08
- Защита от stampede через `LoadingCache` → [ANTI_PATTERNS.md](ANTI_PATTERNS.md), Ex06
