# Design Problem: Distributed Cache (Memcached / Redis Cluster)

Общий cache на N инстансов приложений. Главные challenges: распределение данных (consistent hashing), репликация для HA, инвалидация.

> **Scope:** уровень дизайна. Cache-паттерны, eviction-алгоритмы, Caffeine/Redis в глубину — в [`caching-deep-dive/`](../../../caching-deep-dive/).

---

## 1. Requirements

### Functional
- GET key → value
- PUT key value [TTL]
- DELETE key
- (Опционально) Counters (INCR), структуры (Hash, List, Set, ZSet)

### Non-functional
- **Низкая latency** — p99 < 10 мс
- **Высокий throughput** — 100K–1M ops/sec
- **Масштабируемость** — добавление узлов для capacity
- **High availability** — отказ узла не теряет все данные
- **Eventual consistency допустима** — cache «приближение», источник истины — БД

---

## 2. Estimation

```
1B элементов в cache, в среднем 1 КБ → working set 1 ТБ
Пик 1M ops/sec по кластеру

Один Redis-узел:
  - 100K–1M ops/sec (упирается в сеть > 1 Гбит/с)
  - ~100 ГБ RAM практический предел

→ Нужно 10–20 шардов на 1 ТБ / 1M ops
```

---

## 3. Архитектура

```
Client (smart, знает топологию)
  ↓
  ├── Node 1 (shard 0, primary)
  ├── Node 2 (shard 1, primary)
  ├── Node 3 (shard 2, primary)
  ├── Replica of Node 1 (shard 0, replica)
  ├── Replica of Node 2 (shard 1, replica)
  └── Replica of Node 3 (shard 2, replica)

Reads → primary (или replica для read-scaling)
Writes → primary
Async-репликация primary → replica
```

---

## 4. Распределение — consistent hashing

Сопоставление key → shard через consistent hashing.

Теория — в [`SHARDING.md` (databases)](../../databases/theory/SHARDING.md#consistent-hashing) и [`caching-deep-dive/DISTRIBUTED_CACHING.md`](../../../caching-deep-dive/theory/DISTRIBUTED_CACHING.md).

```python
ring = ConsistentHashRing(virtual_nodes_per_real=200)
ring.add_node("node1")
ring.add_node("node2")
ring.add_node("node3")

shard = ring.get_node(key)  # hash(key) → проходим ring → находим node
```

**При добавлении узла:** перемещается только `1/N` ключей.

**Подход Redis Cluster:** 16384 hash-слотов, статически распределённых по узлам. Move slot → online-миграция ключей.

---

## 5. Client-side vs server-side роутинг

### Client-side (стиль Memcached)

Клиент сам вычисляет shard, подключается напрямую к нужному узлу.

- ✓ Самый быстрый (1 hop)
- ✗ Клиент обязан знать топологию и переживать изменения membership

### Proxy-based (Twemproxy, mcrouter)

Клиент шлёт на proxy, proxy роутит.

- ✓ Простой клиент
- ✗ Дополнительный hop, proxy добавляет latency

### Server-side cluster (Redis Cluster, в стиле mongos)

Любой узел принимает запрос, при необходимости делает редирект («MOVED slot to nodeX»).

- ✓ Клиенту достаточно начального списка узлов
- ✗ Возможен дополнительный hop

---

## 6. Репликация

### Sync vs async

- **Sync** — write завершается после подтверждения replica. Медленнее, нет потери при сбое primary.
- **Async** — write возвращается сразу. Быстрее, могут потеряться последние writes при failover'е.

Cache обычно: **async** (потеря cache переживается, перезаливается из БД).

### Количество replicas

- 1 replica — переживает падение одного узла, без read scaling
- 2+ replicas — read load распределяется, выше отказоустойчивость

Trade-off: storage cost × (N+1).

---

## 7. Обработка сбоев

### Узел упал

- Replica повышается до primary
- Клиент (или кластер) обновляет топологию
- Когда узел возвращается — реплицируется с нового primary

### Целый shard упал

- Все данные shard'а потеряны (cache — ок)
- Либо восстанавливается из снапшота
- Во время recovery: cache miss'ы, всплеск нагрузки на БД

### Сетевой раздел

- Minority-раздел перестаёт принимать writes (защита от split-brain)
- Кластер переконфигурируется после восстановления

---

## 8. Cache invalidation

Теория — в [`caching-deep-dive/CONSISTENCY.md`](../../../caching-deep-dive/theory/CONSISTENCY.md).

### Паттерны

- **TTL-only** — записи автоматически истекают; eventual consistency
- **Write-through invalidation** — приложение пишет в cache + БД атомарно (с определённым порядком: сначала БД, потом cache; либо CAS)
- **CDC-based** — Debezium стримит изменения БД → инвалидирует cache (менее жёсткая связанность)
- **Versioned keys** — добавлять версию к ключу (`user:123:v5`), новые данные → новый ключ, старый протухает

### Что обычно используют

1. Cache-aside (lazy loading): read miss → БД → put в cache
2. TTL для границы свежести
3. Active invalidation только для критичного (изменение цен и т. п.)

---

## 9. Проблема hot key

Один ключ получает непропорциональную нагрузку.

### Митигации

- **Репликация** — реплицировать hot key на несколько / все узлы
- **Splitting ключа** — `user:bieber:tweets:0..9`, рандомизируем на write/read
- **Локальный кэш** — приложения кэшируют hot keys в памяти процесса
- **Tiered caching** — L1 in-process, L2 distributed

Подробнее — в [`caching-deep-dive/ANTI_PATTERNS.md`](../../../caching-deep-dive/theory/ANTI_PATTERNS.md#hot-key).

---

## 10. Persistence (опционально)

Чистый cache — только в RAM. Иногда нужно persistence:

- **Redis RDB** — периодический снапшот
- **Redis AOF** — append-only log
- **Trade-off:** persistence добавляет latency и стоимость. Большинство cache-дизайнов обходятся без него.

См. [`caching-deep-dive/REDIS.md`](../../../caching-deep-dive/theory/REDIS.md).

---

## 11. Eviction-политики

Когда cache переполнен — нужно выбрасывать.

- **LRU** — Least Recently Used. Стандарт, подходит для большинства нагрузок.
- **LFU** — Least Frequently Used. Лучше при стабильном hot-set'е.
- **TTL** — фиксированное время жизни
- **FIFO** — просто, но часто хуже LRU
- **W-TinyLFU** (дефолт Caffeine) — современный лидер по бенчмаркам
- **Allkeys-random** — опция Redis (когда все ключи одинаково важны)

См. [`caching-deep-dive/EVICTION_POLICIES.md`](../../../caching-deep-dive/theory/EVICTION_POLICIES.md).

---

## 12. Мониторинг

Ключевые метрики:
- **Hit ratio** (цель > 90%)
- **Latency** p50/p99
- **Memory usage** на shard
- **Eviction rate** — высокий = cache слишком маленький
- **Hot keys** — периодическое сканирование top-N

Перекос между shard'ами — индикатор плохого распределения ключей.

---

## 13. Trade-offs

### Memcached vs Redis

| | Memcached | Redis |
|---|---|---|
| Типы данных | Только string | String, Hash, List, Set, ZSet, Stream, … |
| Persistence | Нет | RDB / AOF |
| Репликация | Через клиент (3rd party) | Встроенная |
| Cluster | mcrouter / Twemproxy | Redis Cluster |
| Threading | Multi-threaded | Single-threaded на shard |
| Use case | Чистый cache | Cache + data structures + pub/sub + Lua |

Сейчас Redis доминирует. Memcached — у legacy-систем или там, где нужен только чистый cache.

### Centralized vs near-cache

- **Centralized** (этот дизайн) — один cache, все приложения работают с ним
- **Near-cache** (per-app L1 + shared L2) — быстрее локальный lookup, сложнее инвалидация
- **Replicated** — все данные на всех узлах (только небольшие датасеты)

Hazelcast и Apache Ignite поддерживают near-cache.

---

## 14. Антипаттерны

- **Cache как основное хранилище** — без БД под ним потеря cache = потеря данных
- **Огромный single key (big key)** — блокирует event loop; см. `caching-deep-dive/ANTI_PATTERNS.md`
- **Нет TTL на user-generated ключах** — потенциальная утечка памяти
- **Sync-инвалидация на критическом пути** — добавляет latency к writes

---

## Источники

- *System Design Interview Vol. 2* (Alex Xu) — глава про distributed cache
- [Hello Interview — Distributed Cache](https://www.hellointerview.com/learn/system-design/problem-breakdowns/distributed-cache)
- [Redis Cluster Specification](https://redis.io/docs/management/scaling/)
- [Facebook — Scaling Memcache at Facebook](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf) — классический paper
- [Hazelcast Documentation](https://docs.hazelcast.com/)
- [Apache Ignite Documentation](https://ignite.apache.org/docs/latest/)
- Весь модуль [`caching-deep-dive/`](../../../caching-deep-dive/)
