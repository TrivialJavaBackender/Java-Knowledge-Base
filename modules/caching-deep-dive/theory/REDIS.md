# Redis

In-memory key-value store. Используется как distributed cache, primary store для эфемерных данных, message broker (Streams/Pub-Sub), session store, rate-limiter и т.д.

Ключевая особенность: **single-threaded command processing** (для основного потока). Это упрощает модель — нет race condition между командами на сервере, но одна тяжёлая команда блокирует всё.

## Структуры данных

| Тип | Команды | Применение |
|-----|---------|------------|
| **string** | `SET/GET/INCR/APPEND/SETEX` | счётчики, простые KV, JSON в string |
| **hash** | `HSET/HGET/HGETALL/HMGET` | объекты (user → {name, email}); экономит память vs N strings |
| **list** | `LPUSH/RPUSH/LPOP/LRANGE/BLPOP` | очереди, последние N элементов |
| **set** | `SADD/SREM/SMEMBERS/SINTER/SUNION` | теги, уникальные значения, set ops |
| **sorted set (zset)** | `ZADD/ZRANGE/ZRANGEBYSCORE/ZRANK` | leaderboards, time series, priority queues |
| **stream** | `XADD/XREAD/XGROUP CREATE/XREADGROUP` | event log, message broker (Kafka-like) |
| **hyperloglog** | `PFADD/PFCOUNT` | approximate cardinality (12KB на 2^64 элементов, ~0.81% ошибки) |
| **bitmap** | `SETBIT/GETBIT/BITCOUNT` | флаги, presence (active users by day) |
| **geo** | `GEOADD/GEOSEARCH` | геопространственный поиск (поверх zset) |

## Persistence

**RDB (snapshot):**
- `save 60 1000` — раз в 60s, если ≥1000 ключей изменено.
- `bgsave` — fork → ребёнок пишет `.rdb`, родитель продолжает обслуживать.
- Между snapshot'ами — потеря.
- Restart быстр: один файл, бинарный.

**AOF (Append-Only File):**
- Лог write-команд.
- `appendfsync`:
  - `always` — fsync на каждой команде. Durable, медленно (~100x slower writes).
  - `everysec` (default) — fsync раз в секунду. Потеря ≤ 1s при крэше OS.
  - `no` — fsync на усмотрение OS (через ~30s). Быстро, но недурабельно.
- AOF rewrite (`bgrewriteaof`) сжимает лог: вместо 1000 INCR'ов один `SET key 1000`.
- Restart — replay AOF (медленнее RDB).

**Combo (рекомендуемо для durable):** AOF `everysec` + периодический RDB. RDB используется для backup'ов, AOF — для recovery до последней секунды.

**Pure cache:** persistence не нужен — `--save ""` и `--appendonly no`. Restart с пустым кэшем.

## Eviction (`maxmemory-policy`)

| Policy | Поведение |
|--------|-----------|
| `noeviction` (default) | Возвращает ошибку на write при OOM |
| `allkeys-lru` | LRU из всех ключей |
| `allkeys-lfu` | LFU (since 4.0) |
| `allkeys-random` | случайный |
| `volatile-lru` | LRU только из ключей с TTL |
| `volatile-lfu` | LFU только из ключей с TTL |
| `volatile-random` | случайный из ключей с TTL |
| `volatile-ttl` | ключ с ближайшим expiry первый |

Для cache-only — `allkeys-lfu`. Если в Redis смешано (cache + persistent данные с `EXPIRE` только на cache-части) — `volatile-lru`. Алгоритмы — **аппроксимированные** (sample-based), не точный LRU/LFU; настраивается `maxmemory-samples` (default 5).

## Replication

- **Master → replica(s):** async по умолчанию.
- На replica: read-only.
- `WAIT n timeout` — синхронное ожидание подтверждения от n реплик.
- `min-replicas-to-write` — отказ master'а писать, если меньше N реплик online.

## Sentinel

Высокая доступность для **standalone** Redis (не Cluster):
- 3+ Sentinel-узлов мониторят master'а.
- При обнаружении отказа — quorum-based выборы → promote replica.
- Клиент опрашивает Sentinel для актуального master endpoint'а.

Подходит, когда нужен HA без шардинга.

## Cluster

Шардирование + HA:
- **16384 hash slot'ов**, распределённых между master-узлами.
- `slot = CRC16(key) % 16384`.
- Каждый master имеет N replica.
- При запросе в "не свой" slot — `MOVED` (постоянное перенаправление) или `ASK` (временное, во время resharding).
- **Hash tags:** `{user:42}:profile` и `{user:42}:settings` гарантированно лягут в один slot (хешируется только `user:42`) → можно делать multi-key операции и transactions.
- **Multi-key команды** (`MGET`, `MSET`, transactions) **работают только если все ключи в одном slot**.

Resharding — миграция slot'ов между узлами, идёт онлайн (с `MOVED`/`ASK`).

## Pub/Sub

```
PUBLISH channel msg
SUBSCRIBE channel
PSUBSCRIBE pattern.*
```

**Fire-and-forget:** если подписчика нет — сообщение теряется. Для durable — Streams.

В Cluster: pub/sub по умолчанию работает на всех узлах (рассылка через cluster bus). С 7.0 — sharded pub/sub (`SPUBLISH`/`SSUBSCRIBE`) для масштаба.

## Streams (краткий обзор)

`XADD stream * field value` — append.
`XREAD COUNT 100 STREAMS stream $` — tail-read.
`XGROUP CREATE stream grp $` + `XREADGROUP GROUP grp consumer ...` — consumer groups (Kafka-like).

Подробнее про Kafka-аналогии — [`system-design/theory/kafka.md`](../../system-design/theory/kafka.md).

## Транзакции и Lua

**MULTI/EXEC:**
```
MULTI
INCR counter
HSET user:1 name Bob
EXEC
```
Команды копятся в буфер и применяются атомарно. **Без rollback** при ошибке выполнения (только синтаксис проверяется).

**WATCH** — optimistic locking: если ключ изменился между `WATCH` и `EXEC`, транзакция отменяется.

**Lua scripts (`EVAL`/`EVALSHA`):** атомарны (single-threaded → блокируют сервер на время выполнения). Подходят для compare-and-set, rate limiters, idempotent ops. **Не делай длинные циклы в Lua** — заблокируешь весь Redis.

## Pipelining

Клиент шлёт N команд без ожидания ответов, потом читает N ответов. RTT уменьшается с N×RTT до ~1×RTT. Lettuce/Jedis — поддерживают.

Не путать с транзакциями: pipelining не атомарен.

## Lettuce vs Jedis

**Lettuce:** netty-based, async/reactive (CompletableFuture, Reactor). Single connection thread-safe. Default в Spring Boot.

**Jedis:** sync, JedisPool требуется для concurrent. Проще в простых случаях.

В этом модуле используем Lettuce — он async-friendly и стандарт в Spring.

## Подводные камни

1. **`KEYS *` блокирует Redis.** Используй `SCAN`.
2. **Big keys (`HGETALL` на 100MB hash)** — блокируют. Разбивай или используй `HSCAN`.
3. **Hot keys** не лечатся шардированием — только локальный near-cache (см. [DISTRIBUTED_CACHING.md](DISTRIBUTED_CACHING.md)).
4. **TTL и replication:** TTL на replica реализован через **logical time** (master шлёт expire-команды). Не путать с настенным временем.
5. **Кластер не = шардирование данных приложением.** Cluster API для приложения — почти как standalone (с поправкой на `MOVED`).
6. **Transactions без rollback** — Lua часто проще и атомарнее.

## См. также

- Distributed caching патерны → [DISTRIBUTED_CACHING.md](DISTRIBUTED_CACHING.md)
- Консистентность с БД → [CONSISTENCY.md](CONSISTENCY.md)
- Anti-patterns → [ANTI_PATTERNS.md](ANTI_PATTERNS.md)
