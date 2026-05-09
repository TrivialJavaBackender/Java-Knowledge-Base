# Caching — Basics

> *"There are only two hard things in Computer Science: cache invalidation and naming things."* — Phil Karlton

## Что такое кэш

Кэш — промежуточное хранилище **горячих** данных в более быстром (и обычно меньшем по объёму) слое, ближе к точке потребления. Цель: уменьшить latency и нагрузку на медленный/дорогой источник.

В реальности почти каждая «ускорение» в стэке — это где-то спрятанный кэш: ваш CPU кэширует RAM, ОС кэширует диск, JVM кэширует объекты, БД кэширует страницы (`shared_buffers` в Postgres, `InnoDB Buffer Pool` в MySQL), CDN кэширует HTTP-ответы. Понимание физики этих слоёв = понимание production performance.

Ключевая предпосылка — **локальность ссылок (locality of reference)**:
- **Temporal locality:** недавно использованное скоро понадобится снова.
- **Spatial locality:** соседние с использованным данные тоже скоро понадобятся (отсюда — cache lines).

> Локальность — это эмпирический факт о реальных программах, а не закон природы. Случайный доступ к терабайтному датасету полностью убивает все слои кэша. Поэтому первое правило перформанса — **расположить данные так, чтобы доступ был локальным**.

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

> Цифры — порядковая оценка для современных x86-серверов. Для интуиции хорошо иметь под рукой [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832) (Jonas Bonér, по мотивам Питера Норвига) и [Computers are fast](https://computers-are-fast.github.io/). Любая цифра «слишком быстрая» (например, «БД отвечает за 100 нс») — повод проверить себя.

**Эмпирическое правило архитектора:** если можно сделать так, чтобы 99% запросов решались на уровне выше, общая latency определяется этим уровнем, а нижний слой нужен только для «холодных» 1%. Это и есть смысл существования кэш-иерархии.

## CPU caches и cache lines (мини-обзор)

- Cache line = 64 байта (типично).
- Запрос к одному байту тащит всю линию.
- **False sharing:** два потока пишут в разные переменные, но они в одной линии → координация между ядрами через MESI-протокол → потеря производительности.

Классический пример false sharing — два счётчика рядом в памяти:

```kotlin
// Оба int'а лягут в одну cache line → потоки будут "драться" за линию.
class BadCounters {
    @Volatile var a: Long = 0   // поток A инкрементирует
    @Volatile var b: Long = 0   // поток B инкрементирует
}

// JDK 8+: @Contended раздвигает поля по разным линиям через padding.
// Включается JVM-флагом -XX:-RestrictContended.
class GoodCounters {
    @jdk.internal.vm.annotation.Contended @Volatile var a: Long = 0
    @jdk.internal.vm.annotation.Contended @Volatile var b: Long = 0
}
```

В JDK на этой проблеме построены `LongAdder`/`Striped64`: счётчик размазан по N ячеек, каждая выровнена на 128 байт. На 8-ядерной машине разница с `AtomicLong` под нагрузкой — **на порядок** в throughput.

Подробнее про MESI, `@Contended`, padding-приёмы — в [`concurrency/theory/ATOMIC_CAS.md`](../../concurrency/theory/ATOMIC_CAS.md). Для глубокого погружения — блог [Mechanical Sympathy](https://mechanical-sympathy.blogspot.com/) (Martin Thompson) и доклад «[CPU Caches and Why You Care](https://www.youtube.com/watch?v=WDIkqP4JbkE)» (Scott Meyers).

## OS Page cache

ОС держит недавно прочитанные блоки файлов в RAM. `read()` сначала проверяет page cache → потом диск. Управляется ядром, не приложением. Особенность: **при `O_DIRECT` или `mmap`** взаимодействие меняется.

Для БД (Postgres, Redis с RDB) page cache — невидимый, но критический слой: реальная latency I/O сильно зависит от того, сколько RAM свободно под page cache.

**Battle-story №1 — PostgreSQL `shared_buffers` vs page cache.** Postgres хранит страницы дважды: в своём `shared_buffers` (типично 25% RAM) и в page cache OS. Параметр `effective_cache_size` — **не буфер**, а *подсказка* планировщику запросов «сколько RAM реально доступно под кэш всех процессов». Занижен → планировщик пессимистичен и лезет в seq scan вместо index scan. Неправильно настроенный `effective_cache_size` — стандартный кейс «база на проде в 10× медленнее, чем должна быть». См. [PostgreSQL: Resource Consumption](https://www.postgresql.org/docs/current/runtime-config-resource.html).

**Battle-story №2 — `kafka` и page cache.** Kafka не имеет своего кэша вообще — она делегирует кэширование чтения и буферизацию записи ядру через page cache + zero-copy `sendfile()`. Поэтому консумеру, читающему недавние сообщения, диск **никогда не нужен** — данные всё ещё в RAM ядра. Это объясняет, почему Kafka масштабируется на сотни МБ/с с обычного HDD, и почему free RAM на брокере критичен. Подробнее — [Kafka design: Persistence](https://kafka.apache.org/documentation/#design_filesystem) и [LWN: page cache, the affair](https://lwn.net/Articles/712467/).

**Полезные команды:**
- `vmstat 1` — колонка `cache` (KB в page cache).
- `free -h` — `buff/cache` суммарно.
- `echo 3 > /proc/sys/vm/drop_caches` — сбросить page cache (только для бенчмарков, **не** в проде).
- `pcstat /path/to/file` — % страниц файла в кэше (внешняя утилита от Cloudflare).

## Метрики кэша

- **Hit ratio = hits / (hits + misses)** — основная метрика. Cache с hit ratio < 50% обычно вреден (overhead больше выгоды).
- **Miss ratio = 1 − hit ratio**.
- **Latency** — p50/p95/p99 hit и miss отдельно (miss всегда дороже).
- **Throughput** — ops/sec.
- **Eviction rate** — сколько ключей вытесняется в секунду (высокий → cache too small).
- **Load penalty** — стоимость промаха (latency источника).
- **Stale rate** — доля ответов из кэша, которые уже устарели (если измеримо).

### Когда добавлять кэш — формула амортизации

```
average_latency = hit_ratio × cache_latency + (1 − hit_ratio) × (cache_latency + source_latency)
                = cache_latency + (1 − hit_ratio) × source_latency
```

Пример: Postgres-запрос — 5 мс, Caffeine hit — 100 нс ≈ 0. При `hit_ratio = 0.95` средняя latency = 0.25 мс (20×). При `hit_ratio = 0.50` = 2.5 мс (всего 2× — а с учётом overhead на сериализацию и обслуживание кэша часто ноль). Поэтому **target ≥ 0.9** для бизнес-кэшей; иначе кэш может оказаться чистым техдолгом.

> Аналогичная формула — у Hennessy & Patterson, *Computer Architecture: A Quantitative Approach* (Appendix B, «memory hierarchy performance»). Эта же идея — основа главы 1 *Designing Data-Intensive Applications* (Kleppmann): «делайте medians-numbers, потом p99, потом продумывайте load».

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

## Источники

**Official docs:**
- [PostgreSQL: Resource Consumption (`shared_buffers`, `effective_cache_size`)](https://www.postgresql.org/docs/current/runtime-config-resource.html)
- [Kafka design: filesystem & page cache](https://kafka.apache.org/documentation/#design_filesystem)

**Engineering blogs / posts:**
- [Latency Numbers Every Programmer Should Know (Jonas Bonér)](https://gist.github.com/jboner/2841832)
- [Computers Are Fast — interactive numbers](https://computers-are-fast.github.io/)
- [Mechanical Sympathy (Martin Thompson)](https://mechanical-sympathy.blogspot.com/) — серия про CPU caches и low-latency JVM
- [LWN: page cache, the affair](https://lwn.net/Articles/712467/)
- [Cloudflare: Going to production with `pcstat`](https://github.com/tobert/pcstat)

**Books / talks:**
- *Designing Data-Intensive Applications* (Martin Kleppmann), Ch. 1 «Reliable, Scalable, Maintainable» — про latency, throughput, percentiles.
- *Computer Architecture: A Quantitative Approach* (Hennessy & Patterson), Appendix B — formal model of memory hierarchy.
- Scott Meyers, [«CPU Caches and Why You Care»](https://www.youtube.com/watch?v=WDIkqP4JbkE) — 75-минутный обзор для прикладного программиста.
