# Caching — Basics

## Что такое кэш

Кэш — промежуточное хранилище **горячих** данных в более быстром (и обычно меньшем по объёму) слое, ближе к точке потребления. Цель: уменьшить latency и нагрузку на медленный/дорогой источник.

Ключевая предпосылка — **локальность ссылок (locality of reference)**:
- **Temporal locality:** недавно использованное скоро понадобится снова.
- **Spatial locality:** соседние с использованным данные тоже скоро понадобятся (отсюда — cache lines).

## Иерархия кэшей

| Уровень | Latency | Размер | Управление |
|---------|---------|--------|------------|
| CPU register | ~0.3ns | ~KB | компилятор |
| L1 cache | ~1ns | ~32 KB / core | hardware |
| L2 cache | ~3ns | ~256 KB / core | hardware |
| L3 cache | ~12ns | ~8–32 MB shared | hardware |
| Main memory (DRAM) | ~100ns | ~GB | OS |
| OS page cache | ~100ns + hit | shared with RAM | kernel (LRU-like) |
| JVM heap cache (Caffeine, ConcurrentHashMap) | ~10–100ns | сотни MB | приложение |
| Distributed cache (Redis, Memcached) | ~0.5–2ms (LAN) | GB–TB | приложение / сервис |
| CDN edge cache | ~10–50ms (геобл.) | TB | провайдер CDN |
| Origin (DB / object storage) | ~10–500ms | бесконечно | приложение |

Каждый следующий уровень — на 1–3 порядка дороже по latency и часто на порядок больше по объёму.

## CPU caches и cache lines (мини-обзор)

- Cache line = 64 байта (типично).
- Запрос к одному байту тащит всю линию.
- **False sharing:** два потока пишут в разные переменные, но они в одной линии → координация между ядрами через MESI-протокол → потеря производительности.

Глубже про false sharing и `@Contended` — в [`concurrency/theory/ATOMIC_CAS.md`](../../concurrency/theory/ATOMIC_CAS.md).

## OS Page cache

ОС держит недавно прочитанные блоки файлов в RAM. `read()` сначала проверяет page cache → потом диск. Управляется ядром, не приложением. Особенность: **при `O_DIRECT` или `mmap`** взаимодействие меняется.

Для БД (Postgres, Redis с RDB) page cache — невидимый, но критический слой: реальная latency I/O сильно зависит от того, сколько RAM свободно под page cache.

## Метрики кэша

- **Hit ratio = hits / (hits + misses)** — основная метрика. Cache с hit ratio < 50% обычно вреден (overhead больше выгоды).
- **Miss ratio = 1 − hit ratio**.
- **Latency** — p50/p95/p99 hit и miss отдельно (miss всегда дороже).
- **Throughput** — ops/sec.
- **Eviction rate** — сколько ключей вытесняется в секунду (высокий → cache too small).
- **Load penalty** — стоимость промаха (latency источника).
- **Stale rate** — доля ответов из кэша, которые уже устарели (если измеримо).

## Когда кэш полезен

Идеальный кандидат:
- **read-heavy** (read/write >> 1)
- **дорогое чтение** из источника (БД с join'ами, внешний API)
- **допустим небольшой stale** (миллисекунды–минуты)
- **ограниченная cardinality** ключей (10K–10M, но не миллиарды)

Антикандидат:
- write-heavy с строгой консистентностью
- запросы уникальны (cardinality ≈ запросам)
- источник уже быстр (in-memory KV)
- допустимый stale = 0 (deal-breaker для balance, security tokens)

## Где почитать дальше

- Паттерны → [CACHE_PATTERNS.md](CACHE_PATTERNS.md)
- Eviction → [EVICTION_POLICIES.md](EVICTION_POLICIES.md)
- Production JVM cache → [CAFFEINE.md](CAFFEINE.md)
- Distributed → [REDIS.md](REDIS.md), [DISTRIBUTED_CACHING.md](DISTRIBUTED_CACHING.md)
- HTTP/CDN → [HTTP_CDN_CACHE.md](HTTP_CDN_CACHE.md)
- Грабли → [ANTI_PATTERNS.md](ANTI_PATTERNS.md)
