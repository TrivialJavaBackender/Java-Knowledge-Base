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

Возвращает `CompletableFuture<V>`. Промахи не блокируют caller'а. Для Kotlin coroutines удобно интегрировать через `kotlinx-coroutines-jdk8` (`future.await()`):

```kotlin
import kotlinx.coroutines.future.await

suspend fun loadUser(id: String): User = cache.get(id).await()

// Или сразу строить cache из suspend-функции:
val cache: AsyncLoadingCache<String, User> = Caffeine.newBuilder()
    .maximumSize(10_000)
    .buildAsync { id, _ -> coroutineScope.future { userRepoSuspend(id) } }
```

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

### Custom `Expiry` — per-key TTL

Когда TTL зависит от значения (премиум-юзеры — 1 час, обычные — 5 минут; B2B-аккаунты — час, B2C — минута):

```kotlin
val cache: Cache<String, User> = Caffeine.newBuilder()
    .maximumSize(50_000)
    .expireAfter(object : Expiry<String, User> {
        override fun expireAfterCreate(key: String, user: User, currentTime: Long): Long =
            (if (user.isPremium) 1.hours else 5.minutes).inWholeNanoseconds

        override fun expireAfterUpdate(key: String, user: User, currentTime: Long, currentDuration: Long): Long =
            currentDuration   // не сбрасывать TTL на update

        override fun expireAfterRead(key: String, user: User, currentTime: Long, currentDuration: Long): Long =
            currentDuration   // обычный TTL, не TTI
    })
    .build()
```

Custom `Expiry` дороже статического `expireAfterWrite`/`expireAfterAccess` (вызов на каждой операции), но даёт полный контроль. Используй только когда per-key TTL действительно нужен.

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

### Интеграция с Micrometer / Prometheus

Артефакт `io.micrometer:micrometer-core` (есть в Spring Boot Actuator из коробки):

```kotlin
import io.micrometer.core.instrument.binder.cache.CaffeineCacheMetrics

CaffeineCacheMetrics.monitor(meterRegistry, cache, "users")
// → метрики cache.size, cache.gets{result=hit|miss},
//   cache.evictions{cause=...}, cache.load.duration.

// PromQL для алерта на низкий hit-ratio:
//   rate(cache_gets_total{cache="users",result="hit"}[5m]) /
//   rate(cache_gets_total{cache="users"}[5m]) < 0.5
```

См. [Micrometer: CaffeineCacheMetrics](https://docs.micrometer.io/micrometer/reference/reference/cache.html#caffeine).

## Caffeine vs Guava vs ConcurrentHashMap

| Аспект | Caffeine | Guava | CHM |
|--------|----------|-------|-----|
| Eviction | W-TinyLFU | LRU | нет |
| TTL/expiry | да | да | нет |
| Hit-ratio (typical) | +5–25% vs LRU | LRU baseline | n/a |
| Throughput (read) | ~4× vs Guava | baseline | сравнимо с Caffeine на простом get |
| Async API | `AsyncLoadingCache` | нет | n/a |
| Active development | да | заморожен | Java stdlib |
| Зависимость | отдельная JAR | guava (тяжёлая) | JDK |

Бенчмарки автора: [Caffeine wiki — Benchmarks](https://github.com/ben-manes/caffeine/wiki/Benchmarks). Hit-ratio: [Efficiency](https://github.com/ben-manes/caffeine/wiki/Efficiency).

Default — **Caffeine**. Guava Cache до сих пор в проектах (Hadoop, старые Spring), но новый код пишут на Caffeine.

## Caffeine vs Hazelcast / Apache Ignite

| Use case | Выбор |
|----------|-------|
| In-process JVM, без межинстансной шарингу | **Caffeine** |
| Shared между N инстансов, малый dataset (<RAM узла) | Hazelcast / Ignite (replicated) |
| Shared, большой dataset (>RAM узла) | Redis Cluster + Caffeine как L1 (см. [DISTRIBUTED_CACHING.md](DISTRIBUTED_CACHING.md)) |
| Distributed compute (map-reduce, near-cache, partition affinity) | Apache Ignite |
| HA кластер с persistence в-of-the-box | Hazelcast Enterprise / Ignite |

Caffeine ≠ Hazelcast: Caffeine — **локальный** кэш на одну JVM. Когда нужно «один логический кэш на 10 инстансов» — Caffeine не помощник.

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

## Production-grade builder (всё вместе)

Шаблон, который покрывает ~90% сервисов:

```kotlin
val cache: LoadingCache<UserId, User> = Caffeine.newBuilder()
    .maximumSize(50_000)
    .refreshAfterWrite(Duration.ofMinutes(2))      // фоновый refresh для горячих
    .expireAfterWrite(Duration.ofMinutes(10))      // hard expire для холодных
    .recordStats()                                  // hit/miss → Prometheus
    .removalListener<UserId, User> { id, _, cause ->
        log.debug("evicted user {} cause={}", id, cause)
    }
    .executor(Executors.newFixedThreadPool(4))     // refresh идёт сюда (default ForkJoinPool.commonPool)
    .build { id -> userRepo.findById(id) ?: throw NotFoundException("user $id") }

CaffeineCacheMetrics.monitor(meterRegistry, cache, "users")
```

Ключевые опции:
- `executor` — критично, если refresh бьёт по `commonPool` и блокирует ваш `parallelStream`. Свой пул изолирует.
- `refreshAfterWrite < expireAfterWrite` — обязательно. Иначе refresh никогда не успеет триггернуться.
- `removalListener` — async, не нагружает hot path.

## Подводные камни

1. **Без `recordStats()` — не узнаешь hit-ratio.** Включай всегда.
2. **Loader не должен бросать checked-исключения** иначе `LoadingCache` не подойдёт; используй try/catch внутри.
3. **`removalListener` не вызывается при invalidation сразу** — там асинхронный flush. Не полагаться на синхронные сайд-эффекты.
4. **`getIfPresent` не триггерит refresh.** Только `get(key)` (или `get(key, loader)`) активирует refresh-after-write.
5. **`expireAfter` (custom) дороже** — если можно обойтись `expireAfterWrite/Access`, используй их.
6. **Loader, возвращающий `null`** в `LoadingCache` — это **не** «ничего не клади», это исключение. Если нужно «нет такой записи» — используй `Optional<T>` или sentinel value.
7. **Refresh использует `ForkJoinPool.commonPool` по умолчанию.** Под нагрузкой это может конкурировать с parallel-stream/`CompletableFuture` приложения. В проде — `executor(...)` обязателен.

## См. также

- Eviction алгоритм W-TinyLFU → [EVICTION_POLICIES.md](EVICTION_POLICIES.md)
- Two-level near-cache → [DISTRIBUTED_CACHING.md](DISTRIBUTED_CACHING.md), Ex08
- Защита от stampede через `LoadingCache` → [ANTI_PATTERNS.md](ANTI_PATTERNS.md), Ex06

## Источники

**Official docs / wiki:**
- [Caffeine GitHub](https://github.com/ben-manes/caffeine)
- [Caffeine wiki: Population & Refresh](https://github.com/ben-manes/caffeine/wiki/Population)
- [Caffeine wiki: Efficiency](https://github.com/ben-manes/caffeine/wiki/Efficiency) — hit-ratio benchmarks
- [Caffeine wiki: Benchmarks](https://github.com/ben-manes/caffeine/wiki/Benchmarks) — throughput vs Guava/CHM
- [Spring Framework: Cache Abstraction](https://docs.spring.io/spring-framework/reference/integration/cache.html)
- [Micrometer: cache metrics](https://docs.micrometer.io/micrometer/reference/reference/cache.html)

**Talks:**
- Ben Manes, [«Design of a Modern Cache», Strange Loop 2017](https://www.youtube.com/watch?v=Hk0VJFKGmH0) — устройство W-TinyLFU и Caffeine internals.

**Engineering blogs:**
- [The State of Caching in Java 2020 (Ben Manes)](https://highscalability.com/design-of-a-modern-cache/) — обзор Guava → Caffeine.
