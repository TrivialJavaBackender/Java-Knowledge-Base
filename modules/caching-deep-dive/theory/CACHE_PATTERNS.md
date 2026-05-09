# Cache Patterns

5 канонических паттернов взаимодействия приложения, кэша и БД. Все они описаны в [Microsoft Cloud Design Patterns: Cache-Aside](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside) и [AWS ElastiCache Best Practices](https://docs.aws.amazon.com/AmazonElastiCache/latest/mem-ug/BestPractices.html). На практике 80% продакшена — это cache-aside с TTL+jitter; остальные паттерны появляются под конкретный SLA.

## 1. Cache-aside (lazy loading)

Самый распространённый. Приложение **само** читает/пишет в кэш и БД.

**Read:**
```
1. value = cache.get(key)
2. if value != null: return value      // hit
3. value = db.load(key)                // miss
4. cache.put(key, value, ttl)
5. return value
```

**Write:**
```
1. db.update(key, value)
2. cache.invalidate(key)               // или cache.put(key, value)
```

**Плюсы:** простота; кэш не обязан знать о БД; устойчив к сбоям кэша (на miss упадёт, но логика работает).

**Минусы:** логика дублируется в каждом read-path; на cold start у каждого ключа первый запрос платит full miss penalty; легко словить cache stampede.

**Когда применять:** дефолт. 80% случаев. Используется в Reddit ([r2 stack](https://github.com/reddit-archive/reddit) — Memcached + Postgres), Instagram ([early architecture](https://instagram-engineering.com/storing-hundreds-of-millions-of-simple-key-value-pairs-in-redis-1091ae80f74c)), большинстве Spring Boot микросервисов через `@Cacheable`.

**Production-grade версия с jitter:**
```kotlin
fun get(key: String): User? {
    cache.getIfPresent(key)?.let { return it }                // hit
    val v = db.load(key) ?: return null                       // miss
    val ttl = baseTtl + Random.nextLong(0, baseTtl / 10)      // ±10% jitter — против avalanche
    cache.put(key, v, Duration.ofSeconds(ttl))
    return v
}
```

Jitter — обязателен при **bulk-загрузке** одинаковым TTL (см. [ANTI_PATTERNS.md](ANTI_PATTERNS.md) §4 cache avalanche).

---

## 2. Read-through

Приложение работает только с кэшем. Кэш сам знает, как достать данные через `CacheLoader`.

**Read:**
```
value = cache.get(key)   // если miss — кэш сам зовёт loader, кладёт результат
return value
```

**Плюсы:** логика загрузки централизована; библиотека (Caffeine `LoadingCache`) предоставляет single-flight (запросы по одному ключу схлопываются).

**Минусы:** кэш-библиотека должна это поддерживать; в Redis — нет встроенно (можно эмулировать через `RedisJSON` модули или своим декоратором).

**Когда применять:** если хочется встроенной защиты от stampede — Caffeine.

> Spring `@Cacheable("users")` поверх `CaffeineCacheManager` — это и есть read-through: метод вызывается только на miss, результат пишется в кэш автоматически. Подробнее — [Caffeine `LoadingCache` Javadoc](https://github.com/ben-manes/caffeine/wiki/Population#manual) и [Spring Framework: Cache Abstraction](https://docs.spring.io/spring-framework/reference/integration/cache.html).

---

## 3. Write-through

Запись синхронно идёт **и в кэш, и в БД** перед возвратом.

**Write:**
```
1. cache.put(key, value)
2. db.update(key, value)
3. return  (если хоть один шаг упал — fail/rollback)
```

**Плюсы:** кэш всегда консистентен с БД (для операций, прошедших через кэш).

**Минусы:** латентность записи = max(cache, DB) + сетевые накладные; запись ВСЕГДА оба раза, даже если ключ потом не прочтут (засоряет кэш ненужными данными).

**Когда применять:** редко чисто, обычно как часть write-through cache в БД (некоторые SQL движки поддерживают buffer pool как write-through).

---

## 4. Write-behind (write-back)

Запись идёт в кэш сразу, а в БД — **асинхронно** (отложенно, батчем).

**Write:**
```
1. cache.put(key, value)
2. queue.add(WriteOp(key, value))   // фоновый flusher батчем уносит в DB
3. return  (без ожидания DB)
```

**Плюсы:** очень низкая latency записи; возможность батчинга (одна `INSERT ... VALUES (...), (...), (...)` вместо N).

**Минусы:** при крэше до flush'а данные потеряны (durability страдает); БД может видеть stale; сложная обработка ошибок (что делать, если flush упал — retry, dead-letter, и т.д.).

**Когда применять:** телеметрия, метрики, аналитика, события — где допустима потеря последних N секунд.

**Real-world:** Twitter/X **Manhattan** для высокочастотных counters использует write-back: инкременты копятся в memory, периодически flush'ятся пакетом ([Manhattan: real-time, multi-tenant distributed DB](https://blog.twitter.com/engineering/en_us/a/2014/manhattan-our-real-time-multi-tenant-distributed-database-for-twitter-scale)). LinkedIn **Apache Samza** state stores — `RocksDB` локально + async flush в `Kafka changelog` (та же идея, только log compacted). Linux page cache — это write-back для блочных устройств: каждые ~30s (`vm.dirty_writeback_centisecs`) ядро пишет грязные страницы на диск. Если вытащить шнур — потеряете до 30 секунд.

---

## 5. Refresh-ahead

Проактивно обновлять горячие ключи **до их expiry**, не дожидаясь промаха.

**Концепция:**
- Ключ имеет TTL = T.
- За некоторое время до T (например, 0.7×T) фоновая задача перезагружает значение из БД.
- На промахе клиент никогда не блокируется на rebuild — значение уже свежее.

В Caffeine: `refreshAfterWrite(t)`.
- При `get` после `t` старое значение возвращается мгновенно, рефреш идёт в фоне.
- Если рефреш упал — старое значение остаётся, не выкидывается.

**Плюсы:** убирает latency spike в момент expiry; защищает от cache breakdown на горячих ключах.

**Минусы:** делает лишнюю работу для редко читаемых ключей (если refresh всех — нагрузка на источник). Каффеин делает refresh **только при `get` после порога**, что нивелирует минус.

**Production-grade combo (Caffeine):**
```kotlin
val cache = Caffeine.newBuilder()
    .refreshAfterWrite(Duration.ofMinutes(2))   // фоновый refresh после 2 минут
    .expireAfterWrite(Duration.ofMinutes(10))   // hard expire через 10
    .maximumSize(50_000)
    .recordStats()
    .build<String, User> { id -> userRepo.findById(id) }

// На get(key) после 2 минут возвращается СТАРОЕ значение мгновенно,
// loader запускается в фоне (на executor'е). Если loader бросит — старое значение остаётся.
```

Логика: горячие ключи перезагружаются проактивно (пользователь всегда видит <1мс ответ), холодные — выкидываются по `expireAfterWrite`. Это де-факто стандарт для read-heavy сервисов в Java/Kotlin.

---

## Сравнение

| Паттерн | Read latency | Write latency | Консистентность | Сложность | Real-world example |
|---------|--------------|---------------|-----------------|-----------|--------------------|
| Cache-aside | hit: fast / miss: slow | DB only | eventual | низкая | Reddit, Instagram, 90% Spring `@Cacheable` |
| Read-through | hit: fast / miss: slow | (n/a) | eventual | средняя | Caffeine `LoadingCache`, Hibernate L2 |
| Write-through | fast | DB + cache (sync) | strong | средняя | InnoDB Buffer Pool ↔ disk (внутри MySQL) |
| Write-behind | fast | cache only | eventual + risk потери | высокая | Twitter Manhattan counters, Linux page cache |
| Refresh-ahead | всегда fast | (n/a) | eventual | средняя | Caffeine `refreshAfterWrite` для горячих ключей |

В реальности паттерны комбинируются: read = **cache-aside + refresh-ahead** (Caffeine), write = **D → invalidate C** (тривиальный вариант write-through без записи в кэш).

## Anti-pattern: write только в кэш

Кэш != БД. Без write-through или write-behind в БД при перезагрузке узла данные теряются. Всегда определяй источник истины.

## См. также

- Грабли при инвалидации → [CONSISTENCY.md](CONSISTENCY.md), [ANTI_PATTERNS.md](ANTI_PATTERNS.md)
- Реализация в Caffeine → [CAFFEINE.md](CAFFEINE.md)

## Источники

**Official docs:**
- [Microsoft Cloud Design Patterns: Cache-Aside](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside)
- [AWS ElastiCache Best Practices](https://docs.aws.amazon.com/AmazonElastiCache/latest/mem-ug/BestPractices.html)
- [Spring Framework: Cache Abstraction](https://docs.spring.io/spring-framework/reference/integration/cache.html)
- [Caffeine wiki: Population & Refresh](https://github.com/ben-manes/caffeine/wiki/Population)

**Engineering blogs:**
- [Twitter Manhattan: real-time, multi-tenant distributed DB](https://blog.twitter.com/engineering/en_us/a/2014/manhattan-our-real-time-multi-tenant-distributed-database-for-twitter-scale)
- [Instagram Engineering: storing hundreds of millions of pairs in Redis](https://instagram-engineering.com/storing-hundreds-of-millions-of-simple-key-value-pairs-in-redis-1091ae80f74c)
- [Netflix EVCache: caching for a global Netflix](https://netflixtechblog.com/caching-for-a-global-netflix-7bcc6b9a1db8)

**Books:**
- *Designing Data-Intensive Applications* (Kleppmann) — Ch. 5 (Replication) и Ch. 11 (Stream Processing) частично пересекаются с темами write-through / write-behind / CDC.
