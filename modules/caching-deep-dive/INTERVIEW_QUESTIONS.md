# Interview Questions — caching-deep-dive

## 1. В чём разница между cache-aside и read-through?

**Cache-aside (lazy loading):** приложение само управляет кэшем. На чтении: сначала смотрит в кэш; если miss — читает из БД, кладёт в кэш, отдаёт клиенту. Кэш не знает о БД.

**Read-through:** приложение работает только с кэшем. Кэш сам подгружает данные из БД через зарегистрированный `CacheLoader`. Источник скрыт за кэшем.

Cache-aside проще и универсальнее, но логика загрузки дублируется в каждом месте. Read-through централизует логику, но требует поддержки в библиотеке (Caffeine `LoadingCache`, Redis модулей нет — нужно писать самому).

---

## 2. Чем write-through отличается от write-behind, и какие у каждого риски?

**Write-through:** запись синхронно идёт и в кэш, и в БД, прежде чем вернуть ответ. Консистентность сильная, но латентность записи = max(cache, DB).

**Write-behind (write-back):** запись идёт в кэш сразу, а в БД асинхронно (батчем/очередью). Латентность записи минимальна, но при крэше до flush'а данные теряются. Также возможна несогласованность при чтении из реплик БД.

Write-behind хорош для высокого write throughput с допуском к eventual durability (логирование, метрики). Write-through — для финансовых данных и т.п.

---

## 3. LRU vs LFU vs W-TinyLFU — когда что выбирать?

- **LRU (Least Recently Used):** выбрасывает то, что давно не запрашивали. Прост, но плохо переживает scan-резистентность (один большой обход выбивает горячие данные).
- **LFU (Least Frequently Used):** считает частоту, выбрасывает наименее частое. Чувствителен к старению (frequency у древнего ключа остаётся высокой).
- **W-TinyLFU (Caffeine):** комбинация admission filter (TinyLFU sketch с count-min) + main LRU. Решает оба недостатка: scan-resistance + затухание частот через aging. На реальных нагрузках hit-ratio выше, чем у чистого LRU.

В 90% случаев в JVM — Caffeine (W-TinyLFU). В Redis — `allkeys-lru` или `allkeys-lfu` в зависимости от паттерна.

---

## 4. Что такое cache stampede и как его предотвратить?

**Cache stampede / thundering herd:** в момент expiry горячего ключа сотни клиентов одновременно проваливаются в БД и одновременно её перегружают.

Защиты:
1. **Single-flight / request coalescing:** только один поток запускает rebuild, остальные ждут результат (например, `ConcurrentHashMap.computeIfAbsent` с `CompletableFuture`).
2. **Mutex/lock per key:** аналогично, но через распределённый lock в Redis (SETNX + TTL).
3. **Early refresh / refresh-ahead:** обновлять до expiry в фоне (Caffeine `refreshAfterWrite`).
4. **Stale-while-revalidate:** возвращать stale-значение пока идёт rebuild.
5. **TTL jitter:** делать TTL = base ± random, чтобы expiry не происходил одновременно у тысяч ключей (защита от cache avalanche).

---

## 5. Cache penetration vs breakdown vs avalanche?

- **Penetration:** запросы идут на несуществующие ключи → каждый раз miss → нагрузка на БД. Решение: negative caching (TTL=минуты для null-результата) или bloom filter перед кэшем.
- **Breakdown:** один очень горячий ключ истекает, и тысячи клиентов одновременно идут в БД за ним. Решение: mutex/single-flight (см. п.4) + refresh-ahead.
- **Avalanche:** массовый одновременный expiry (например, все TTL = 60s, заданные при старте) → пик промахов. Решение: jitter TTL.

---

## 6. Double-write problem: какие 4 порядка операций возможны и какие проблемы у каждого?

Записать в БД и в кэш можно в 4 порядка (D=DB, C=cache):

1. **D → C:** если C падает — стейл в кэше (и долго). На concurrent update'е другой поток может записать старое C поверх нового.
2. **C → D:** если D падает — кэш ушёл вперёд БД (lost update в реплике, неправильная инвалидация при rollback).
3. **D → invalidate C:** проще всего; миссы в кэш дают свежее значение из БД. Но между шагами читатель может закэшировать стейл.
4. **invalidate C → D:** на чтении между шагами читатель прогрузит из БД старое значение и закэширует его → стейл застревает в кэше.

Безопасный путь: **write-through или D → invalidate C + защита от race** (например, через CDC, версии, или delayed double-delete).

---

## 7. Redis: RDB vs AOF — что выбрать?

- **RDB:** бинарный snapshot всей БД (по расписанию или вручную). Компактен, быстро восстанавливается, но между snapshot'ами потеря данных.
- **AOF (Append-Only File):** лог всех write-команд. `appendfsync everysec` (default) — потеря не более 1с. `always` — durable, но медленно. `no` — на усмотрение OS.

Для durable workload — AOF с `everysec`. Для cache-only (где БД источник истины) — RDB или вообще без persistence. Часто используют оба (AOF для durability + RDB для быстрого restart).

---

## 8. Что делает `refreshAfterWrite` в Caffeine и чем он отличается от `expireAfterWrite`?

- **`expireAfterWrite(t)`:** через `t` после записи ключ помечается expired; следующий `get` блокируется до загрузки нового значения (или возвращает старое и асинхронно перезагружает в `AsyncLoadingCache`).
- **`refreshAfterWrite(t)`:** через `t` следующий `get` возвращает **старое** значение, но триггерит асинхронный refresh. Ключ не expires — просто обновляется в фоне.

Combo: `refreshAfterWrite=1m` + `expireAfterWrite=5m` → горячие ключи всегда свежие (refresh каждую минуту), холодные удаляются через 5m.

---

## 9. Что такое near-cache и зачем он нужен?

**Near-cache:** локальный JVM-кэш (L1) поверх удалённого распределённого кэша (L2 = Redis/Hazelcast). Чтение: L1 → L2 → DB. Запись: invalidate L1 + write L2.

Зачем: latency удалённого кэша (~1ms) всё равно дорогая в hot-path; локальный hit ~nanoseconds.

Цена: каждый узел может иметь свою копию → нужна кросс-нодовая инвалидация (pub/sub в Redis, gossip в Hazelcast). Иначе двое читают разное.

---

## 10. Consistent hashing — зачем и как работает?

**Проблема:** при шардинге `hash(key) % N` добавление/удаление узла переместит почти все ключи (N+1 узлов → 100% reshuffle).

**Consistent hashing:** ключи и узлы мапятся на круг хешей \[0, 2^32). Ключ принадлежит первому узлу по часовой стрелке. Добавление узла перемещает только ключи в его сегменте (1/N).

**Virtual nodes:** каждый физический узел представлен M точками на круге → лучшая балансировка и плавная миграция.

Используется в: Cassandra, DynamoDB partitioning, Memcached client-side sharding, CDN edge selection. Redis Cluster использует фиксированные **16384 slots** — родственная, но другая идея.

---

## 11. ETag vs Last-Modified — что использовать?

- **`Last-Modified`:** дата последнего изменения. Гранулярность — 1 секунда. Проблема: при clock skew или быстрых обновлениях недостаточно.
- **`ETag`:** произвольный токен (хеш контента, версия в БД). Сильный (`"abc"`) — точное совпадение байт; слабый (`W/"abc"`) — семантическое совпадение.

Сервер генерит ETag → клиент шлёт `If-None-Match: "abc"`. Если совпало — `304 Not Modified` без body.

ETag предпочтительнее: точнее, нет clock issues, можно использовать как версию для optimistic locking (`If-Match` на PUT).

---

## 12. Stale-while-revalidate — что это и зачем?

`Cache-Control: max-age=60, stale-while-revalidate=300`.

**Семантика:** до 60s — отдаём из кэша как fresh. От 60s до 360s — отдаём stale **сразу** + асинхронно перевалидируем. После 360s — обязательная синхронная revalidation.

Польза: устраняет latency spike в момент expiry (нет блокировки на rebuild), пользователь всегда получает быстрый ответ. Аналог refresh-ahead на уровне HTTP.

---

## 13. CDN purge vs versioned URLs — какой подход лучше?

- **Purge:** API/dashboard CDN'а удаляет ресурс с edge'ей. Минусы: задержка распространения (минуты), стоит денег за вызовы, иногда не работает на всех PoP сразу.
- **Versioned URLs (`/static/app.abc123.js`):** новая версия = новый URL. Cache-Control: `max-age=31536000, immutable`. Старые версии живут в кэше до eviction; новые — мгновенно доступны всем без покурга.

Versioned URLs — golden standard для статики (build-time hash). Purge — для контента, который **должен** исчезнуть (legal removal, breaking bug в API response).

---

## 14. Какие данные **нельзя** кэшировать?

- **Часто меняющиеся:** real-time котировки, счётчики (если важна точность).
- **Персонализированные:** одна страница для каждого user_id → cardinality взрывается.
- **Большие/редкие:** один запрос в час, 100MB ответ — занимает место без выгоды.
- **Чувствительные:** PII, токены, пароли — даже хешированные.
- **Транзакционные:** баланс счёта в момент переводов.

Перед добавлением кэша спросить: **какова частота чтения, частота изменения, и допустимый stale**? Если частота изменения ≈ частоте чтения или допустимый stale = 0 — кэш не нужен.

---

## 15. Hibernate L1/L2 кэш — где почитать в этом репо?

В этом модуле теория Hibernate **не дублируется**. См. [`spring-frameworks/theory/SPRING_DATA_JPA.md`](../spring-frameworks/theory/SPRING_DATA_JPA.md) — раздел про L1 (PersistenceContext, scope = transaction), L2 (SessionFactory-wide, регионы, providers Ehcache/Caffeine), Query cache (зависит от L2 + table modification timestamps), и почему L2 часто **выключают** в высоконагруженных системах (контеншн на регионе, инвалидация при write-heavy).

---

## 16. Как защитить кэш от penetration на несуществующих ключах?

Сценарий: атакующий шлёт запросы по случайным id (`user/9999999`). Каждый — miss → удар по БД.

Решения:
1. **Negative caching:** при miss класть в кэш `NULL_MARKER` с коротким TTL (минуты) → следующие запросы попадают в кэш.
2. **Bloom filter:** перед кэшем держать bloom со всеми существующими id. False-negative невозможен → если bloom говорит "нет", сразу 404 без запроса в кэш/БД. False-positive (несколько процентов) проходит дальше — ничего страшного.
3. **Rate limiting:** на уровне API gateway по IP/токену.

Bloom filter лучше при больших корпусах ключей (миллионы) и низкой частоте новых ключей (можно перестраивать раз в час).

---

## 17. Big keys и hot keys в Redis — почему это проблема?

**Big key:** одиночный ключ занимает мегабайты (огромный hash, list на миллион элементов). Проблемы: команды по нему блокируют single-threaded Redis (`HGETALL` на 100MB hash — секунды), миграция при resharding медленная, eviction уносит большой кусок данных за раз.

**Hot key:** один ключ получает 90% трафика (счётчик популярного товара). Шард с этим ключом перегружен, остальные простаивают. Sharding не помогает.

Решения для big keys: разбить (`user:42:profile`, `user:42:settings`, ...), использовать `HSCAN`/`SSCAN` для итерации. Для hot keys: in-memory near-cache (L1) с коротким TTL, локальная репликация ключа на несколько шардов с суффиксом (`counter:1`, `counter:2`, ...) и aggregation на чтении.

---

## 18. `maxmemory-policy` в Redis — что выбрать?

При достижении `maxmemory` Redis выбирает, что выкинуть:
- **`noeviction`** (default): возвращает ошибку на write. Подходит для durable storage, не для cache.
- **`allkeys-lru` / `allkeys-lfu`:** evict из всех ключей по LRU/LFU. Для cache-only.
- **`volatile-lru` / `volatile-lfu`:** evict только из ключей с TTL. Подходит, если в Redis смешаны cache + persistent данные (но это запах).
- **`allkeys-random` / `volatile-random`:** случайный выбор. Используется редко.
- **`volatile-ttl`:** evict ключ с ближайшим expiry первым.

Default рекомендация для pure cache: **`allkeys-lfu`** (исследования показывают чуть лучше hit-ratio, чем LRU на типичных нагрузках).
