# Cache Anti-patterns

Проблемы, на которые попадают практически все, кто впервые работает с production кэшем.

> Многие из этих проблем впервые формально описаны в [«Scaling Memcached at Facebook»](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf) (NSDI '13): stampede, lease-based mitigation, regional pools. Если хотите глубже — это лучшая отправная точка после данного списка.

## 1. Cache Stampede / Thundering Herd

**Симптом:** в момент expiry горячего ключа сотни/тысячи параллельных запросов одновременно идут в БД → пик нагрузки, БД может упасть.

**Сценарий:**
```
T0:    1000 RPS читают user:42 из кэша (hit)
T+10s: TTL expire
T+10s+1ms: 1000 параллельных промахов → 1000 параллельных SELECT'ов в БД
```

**Famous incident:** Facebook outage 23.09.2010 — массовая cache invalidation запустила петлю «промах → запрос в БД → kewriter cache → invalidation → промах» с экспоненциальным усилением, положив сайт на 2.5 часа. Постмортем: [More details on today's outage (FB engineering, 2010)](https://engineering.fb.com/2010/09/23/uncategorized/more-details-on-today-s-outage/). Урок: кэш и БД образуют контур обратной связи; thundering herd может убить даже мега-инфру.

**Защиты:**

### A. Single-flight (request coalescing)

Только один поток грузит ключ; остальные ждут результат.

В Caffeine `LoadingCache` встроено: `cache.get(key)` для одного ключа в один момент вызовет loader **один раз**.

Без Caffeine — можно эмулировать через `ConcurrentHashMap.computeIfAbsent` + `CompletableFuture` (см. Ex06).

### B. Distributed mutex (Redis SETNX)

Для распределённого случая:
```
SET lock:user:42 <random> NX EX 5     // взять mutex на 5s
if ok: load + put + DEL lock
else:  спать 100ms, повторить read
```

Подводные камни:
- Mutex может протухнуть, если loader работает дольше 5s.
- Redlock у Antirez и критика Кляйнмана — не использовать redlock для критичных вещей; для cache stampede достаточно single-node SETNX.

### C. Refresh-ahead

Обновлять ключ **до** истечения TTL (Caffeine `refreshAfterWrite`). Stampede физически не наступает, потому что значение всегда свежее.

### D. Probabilistic early expiration (XFetch)

Каждый запрос с вероятностью `e^((now-expiry)/duration × β)` решает refresh-нуть ключ заранее. Чем ближе TTL, тем выше вероятность. Распределяет нагрузку гладко.

Оригинальная статья: Vattani, Chierichetti, Lowenstein, [«Optimal Probabilistic Cache Stampede Prevention»](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf), VLDB '15.

### E. Stale-while-revalidate

См. [HTTP_CDN_CACHE.md](HTTP_CDN_CACHE.md) — отдавать stale + async refresh.

---

## 2. Cache Penetration

**Симптом:** запросы постоянно идут на **несуществующие** ключи (например, атакующий перебирает рандомные user_id) → каждый раз miss → удар по БД.

**Защиты:**

### A. Negative caching

Класть в кэш marker для null'а с коротким TTL:
```kotlin
val v = cache.get(key) ?: run {
    val fromDb = db.load(key)
    cache.put(key, fromDb ?: NULL_MARKER, if (fromDb == null) shortTtl else longTtl)
    fromDb
}
```

**Грабли:** TTL для null нужен короткий (минуты), иначе при создании сущности она "не существует" в кэше.

### B. Bloom filter перед кэшем

Bloom filter содержит все существующие ключи. Если bloom говорит "точно нет" → 404 без захода в кэш/БД. False-positive (несколько процентов) проходит дальше — обычная схема.

```
∃ key in bloom?
  no  → 404
  yes → cache → DB
```

Bloom строится при старте/периодически из БД. Для миллионов ключей — несколько MB.

**Размер vs ошибка** (точные числа из стандартной формулы Bloom):

| Элементов | False positive 1% | False positive 0.1% |
|-----------|-------------------|---------------------|
| 1M | 1.2 МБ, 7 hash | 1.8 МБ, 10 hash |
| 10M | 12 МБ, 7 hash | 18 МБ, 10 hash |
| 100M | 120 МБ, 7 hash | 180 МБ, 10 hash |

Готовая реализация на JVM — `com.google.common.hash.BloomFilter`:
```kotlin
val bloom = BloomFilter.create(Funnels.stringFunnel(StandardCharsets.UTF_8),
                               1_000_000, 0.01)
existingIds.forEach { bloom.put(it) }
// later
if (!bloom.mightContain(id)) return null   // точно нет
```
Документация: [Guava: BloomFilter](https://github.com/google/guava/wiki/HashingExplained#bloomfilter). В Redis есть встроенные [`BF.ADD`/`BF.EXISTS`](https://redis.io/commands/bf.add/) (модуль RedisBloom) для распределённого варианта.

### C. Rate limiting

API gateway лимитирует requests/s по IP/токену. Не специфично для cache, но снижает урон от любого abuse.

---

## 3. Cache Breakdown (hot key TTL expiry)

**Симптом:** один **очень популярный** ключ истекает → миллионы запросов одновременно идут в БД.

Это частный случай stampede на одном ключе.

**Защиты:**
- Single-flight (см. выше).
- **Не делай TTL на hot keys** или делай очень большой + явная инвалидация.
- Refresh-ahead.

---

## 4. Cache Avalanche

**Симптом:** **массовый одновременный expiry** → пик миссов → БД перегружена.

Сценарий:
```
06:00: warmup сценарий загрузил 100k ключей с TTL=1h
07:00: ВСЕ 100k expires в одну секунду → 100k промахов
```

**Защиты:**

### A. TTL jitter

```kotlin
import java.time.Duration
import java.util.concurrent.ThreadLocalRandom

fun ttlWithJitter(base: Duration, spreadPercent: Int = 10): Duration {
    val baseMs = base.toMillis()
    val jitterMs = ThreadLocalRandom.current().nextLong(-baseMs * spreadPercent / 100,
                                                          baseMs * spreadPercent / 100 + 1)
    return Duration.ofMillis(baseMs + jitterMs)
}

cache.put(key, value, ttlWithJitter(Duration.ofMinutes(10)))
// → реальный TTL = 9–11 минут случайно
```

Equispaced expiry → expiry распределён равномерно по времени. Никогда не задавай **одинаковый** TTL для bulk-операций.

### B. Stable warmup

При cold start не загружать всё сразу одинаковым TTL — растягивать загрузку.

### C. Failover на источник

При недоступности кэша — circuit breaker на БД (limit concurrent queries) + serve stale из локального fallback.

---

## 5. Hot Keys

**Симптом:** один ключ получает 90% трафика. Шард с этим ключом перегружен; sharding не помогает.

**Защиты:**

### A. Local near-cache (L1)

Каждый инстанс кэширует hot key локально (Caffeine, TTL=секунды). 90% трафика обслуживается локально, в Redis идёт только 10%.

### B. Локальная репликация ключа

Ключ дублируется в N копий с разными суффиксами (`counter:1` … `counter:N`), которые лежат на разных шардах. Чтение — выбор случайной копии. Запись — во все. Подходит для read-heavy счётчиков.

### C. Detect & alert

Метрики per-key (Redis 6.2+ `MEMORY USAGE`, мониторинг `MONITOR` сэмплированно). На алерт — запустить план A/B.

**Real-world hot-key:** Twitter celebrity tweet (Lady Gaga, Elon Musk) — fan-out по списку followers'ов взрывает write-нагрузку. Manhattan специально шардит «горячие» аккаунты иначе и материализует их timeline-fragments отдельно ([Manhattan blog](https://blog.twitter.com/engineering/en_us/a/2014/manhattan-our-real-time-multi-tenant-distributed-database-for-twitter-scale)). Discord — горячий канал с миллионом онлайнов: presence-state шардят по region, fan-out агрегируют в gateway-сервисах ([Discord engineering](https://discord.com/blog/category/engineering)).

---

## 6. Big Keys

**Симптом:** одиночный ключ занимает мегабайты. `HGETALL` блокирует Redis на секунды (single-threaded!), миграция при resharding — медленная, eviction уносит большой кусок данных за раз.

**Защиты:**
- Разбить ключ: `user:42:profile`, `user:42:settings`, `user:42:activity`.
- Использовать `HSCAN`/`SSCAN` для итерации (cursor-based, не блокирует).
- Ограничения по размеру на уровне приложения.

---

## 7. Кэш над кэшом

**Симптом:** чтобы "ускорить" уже кэшированный сервис, добавляют ещё один кэш сверху. Каждый уровень — свой TTL → стейл накапливается.

**Анти-пример:**
```
client → CDN(60s) → app(60s, Caffeine) → Redis(60s) → DB
```
Stale в худшем случае: 60+60+60 = 3 минуты. Каждый уровень нужно осознавать.

**Решение:** иерархия с **уменьшающимся** TTL: CDN 5min, app 30s, DB-cache off. Источник истины владеет инвалидацией.

---

## 8. Кэширование изменчивых данных

**Симптом:** кэшируются данные, которые меняются на каждом запросе (real-time биржевые котировки, балансы счетов). Hit-ratio < 5% → кэш бесполезен и вреден (overhead + stale).

**Решение:** определи частоту чтения и частоту изменения. Если они близки — **не кэшируй**.

---

## 9. Кэширование результатов с join'ами

**Симптом:** кэшируется итог запроса с 5 join'ами. При изменении любой из таблиц — нужно инвалидировать → или это не делается, или инвалидируются все ключи (выходит, кэш по факту пустой).

**Решение:** кэшируй атомарные сущности, собирай на app-уровне. DataLoader из GraphQL — пример (батчинг + кэш на уровне entity).

---

## 10. Кэширование с куками без `Vary`

**Симптом:** ответ с `Set-Cookie: session=abc` уехал в CDN; следующий пользователь получает чужую сессию.

**Решение:** для аутентифицированных ответов — `Cache-Control: private` или `no-store`. Никогда не кэшируй ответы с `Set-Cookie` в shared cache.

---

## 11. Игнор статистики

**Симптом:** добавили кэш и не смотрят hit-ratio. Через полгода обнаружено: hit-ratio 5%, кэш только тормозит (overhead + промахи).

**Решение:** включай `recordStats()` (Caffeine), `INFO stats` (Redis), экспортируй в Prometheus. Алерт при hit-ratio < 50%.

**Минимальный Prometheus alert (Caffeine + Micrometer):**
```yaml
groups:
  - name: cache-health
    rules:
      - alert: CaffeineLowHitRatio
        expr: |
          (
            sum(rate(cache_gets_total{cache="users",result="hit"}[5m])) by (cache)
            /
            sum(rate(cache_gets_total{cache="users"}[5m])) by (cache)
          ) < 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Cache {{ $labels.cache }} hit-ratio < 50% за 10 мин"
          runbook: "Проверь TTL, размер кэша, паттерн запросов"

      - alert: CaffeineHighEvictionRate
        expr: rate(cache_evictions_total{cache="users"}[5m]) > 100
        for: 10m
```
Best practices от Prometheus: [Prometheus alerting](https://prometheus.io/docs/practices/alerting/).

---

## 12. TTL = "до конца дня" / "до полночи"

**Симптом:** в 23:59:59 истекают тысячи ключей одновременно (cache avalanche).

**Решение:** TTL — **относительный** (`max-age`), не абсолютный. С jitter'ом.

---

## 13. Чеклист перед добавлением кэша

1. **Какова частота чтения?** Если < 10 RPS на ключ — не кэшируй (overhead больше выгоды).
2. **Какова частота изменения?** Если ≈ частоте чтения — не кэшируй.
3. **Допустимый stale?** Если 0 — не кэшируй (или write-through + строгая инвалидация).
4. **Cardinality ключей?** Если миллиарды — кэш быстро вытесняется → бесполезен.
5. **Что делаем при unavailable cache?** Должен быть fallback на источник.
6. **Метрики hit-ratio есть?** Если нет — добавить до запуска.
7. **TTL с jitter?** Всегда, для bulk-данных.
8. **Защита от stampede?** `LoadingCache` или single-flight на уровне приложения.

## 14. См. также

- Patterns → [CACHE_PATTERNS.md](CACHE_PATTERNS.md)
- Eviction → [EVICTION_POLICIES.md](EVICTION_POLICIES.md)
- Consistency → [CONSISTENCY.md](CONSISTENCY.md)
- HTTP/CDN → [HTTP_CDN_CACHE.md](HTTP_CDN_CACHE.md)

## Источники

**Papers:**
- Nishtala et al., [«Scaling Memcached at Facebook»](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf), NSDI '13 — стандарт описания stampede / lease / regional pools.
- Vattani et al., [«Optimal Probabilistic Cache Stampede Prevention»](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf), VLDB '15 — XFetch.

**Engineering posts:**
- [Facebook 2010 outage postmortem](https://engineering.fb.com/2010/09/23/uncategorized/more-details-on-today-s-outage/) — каноничный пример cache-induced outage.
- [Antirez (Redis): Cache Stampede Prevention](https://redis.antirez.com/fundamental/cache-stampede-prevention.html) — probabilistic early expiration vs mutex locking, со сравнением сложности и нагрузки на БД.
- [GitHub: Asynchronous deletion of large keys (`UNLINK`)](https://github.blog/engineering/) — про big keys в production.
- [Cloudflare: Introducing CDN-Cache-Control](https://blog.cloudflare.com/cdn-cache-control/) — origin/CDN-уровень `Cache-Control`, разделение private/edge кэша.

**Docs:**
- [Guava: BloomFilter](https://github.com/google/guava/wiki/HashingExplained#bloomfilter)
- [RedisBloom module](https://redis.io/docs/data-types/probabilistic/bloom-filter/)
- [Prometheus alerting best practices](https://prometheus.io/docs/practices/alerting/)
