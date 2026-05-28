# Оценка ёмкости (прикидочные расчёты)

Способность быстро оценить «сколько» — критичный навык для system design интервью и реальной работы. Цель — приблизительные числа в правильном **порядке величины**, не точные.

> **Область**: методика, типичные расчёты. Конкретные цифры задержек и стоимости — [LATENCY_NUMBERS.md](LATENCY_NUMBERS.md).

---

## Алгоритм оценки

```
1. Определить параметры (DAU, размер сообщения, retention, ...)
2. Декомпозировать в QPS / storage / bandwidth / RAM
3. Применить ratios (read/write ratio, peak/average)
4. Округлить до powers of two
5. Сравнить с capacities (нужно 1 server / 10 / 1000)
```

**Правила:**
- 100K seconds ≈ 1 day (точно: 86,400)
- Year ≈ 30M seconds (точно: 31.5M)
- Используй K/M/B/T notation, не точные числа
- При неопределённости — диапазон («10-100K QPS»)

---

## Шаблон расчётов

### Шаг 1 — Активные пользователи → трафик

```
DAU (Daily Active Users) = 10M
Average requests per DAU per day = 100
→ Total requests/day = 10M × 100 = 1B = 10^9
→ Average QPS = 10^9 / 86400 ≈ 12K QPS

Peak factor (peak / avg) = 2-3× обычно (some apps — 10-100× для flash sales)
→ Peak QPS ≈ 36K QPS
```

### Шаг 2 — Хранилище

```
Average record size = 1 KB
Records per day = 100M (например, посты)
Daily storage = 100M × 1KB = 100 GB / day

Retention = 5 years
Total storage = 100 GB × 365 × 5 = 180 TB
Plus replication factor 3 = 540 TB raw storage
```

### Шаг 3 — Пропускная способность

```
Egress (out from servers) = QPS × response_size
At peak: 36K × 10 KB response = 360 MB/sec = 2.88 Gbps
→ Need 10 Gbps NIC headroom × N servers
```

### Шаг 4 — RAM (для кэша)

```
Hot set = 20% of users active in 1 hour = 2M users
Per-user data cached = 5 KB
→ Cache RAM needed = 2M × 5KB = 10 GB

→ Fits in single Redis node (32 GB instance), but plan for HA → 3 nodes
```

---

## Разобранный пример: лента Twitter

**Параметры:**
- 300M DAU
- В среднем 100 твитов прочитано на пользователя в день
- В среднем 1 твит опубликован на пользователя в день (10% пишут)
- Размер твита = 280 символов + метаданные = ~500 байт
- Хранение: без ограничений (но недавние = горячие)

**Оценка:**

```
READS:
  300M × 100 = 30B reads/day
  Avg QPS = 30B / 86400 ≈ 350K QPS
  Peak QPS (2×) ≈ 700K QPS

WRITES:
  300M × 1 × 10% = 30M writes/day
  Avg QPS = 30M / 86400 ≈ 350 writes/sec
  Peak = 700 writes/sec (much less than reads — read-heavy!)

→ Read/Write ratio ≈ 1000:1

STORAGE:
  Writes × size: 30M × 500B = 15 GB/day
  Yearly: 5.5 TB/year
  10 years: 55 TB raw, 165 TB with RF=3
  → Easily on a few sharded DBs

BANDWIDTH:
  Reads × tweet size: 700K QPS × 500B = 350 MB/s out = 2.8 Gbps
  → Single CDN PoP может справиться, multi-region для latency

KEY DECISIONS:
  Read-heavy → aggressive caching (Redis), fan-out on write для feed
  Celebrity problem: top 1% accounts получают 99% reads → key splitting
```

---

## Разобранный пример: распределённый кэш

**Параметры:**
- 1M элементов в кэше
- Средний размер элемента = 10 KB
- Горячее рабочее множество = 20% (200K элементов)
- Требуемый коэффициент попаданий в кэш = 99%
- Целевая задержка кэша p99 = 1 мс

**Оценка:**

```
RAM for hot set:
  200K × 10KB = 2 GB
  
RAM for full dataset:
  1M × 10KB = 10 GB

→ For 99% hit ratio с LRU, нужно cache ≈ 90-95% dataset
   (working set theorem)
→ Need 9 GB RAM, рекомендация 16 GB instance (headroom + LRU overhead)

QPS:
  Assume 100K QPS read
  → Single Redis node can handle (100K-1M ops/sec)
  → Network: 100K × 10KB = 1 GB/s = 8 Gbps → close to limit
  → Better: Redis Cluster с 3 shards, каждый ~ 30K QPS, 3 Gbps

For HA:
  Each shard primary + 1 replica = 6 nodes
  + Sentinel (3 nodes) for monitoring
```

---

## Разобранный пример: сокращатель URL

**Параметры:**
- 100M URL создаётся в год
- Соотношение чтений/записей 10:1 (100M записей/год → 1B чтений/год)
- Срок хранения = не ограничен

**Оценка:**

```
WRITES:
  100M / year / 31.5M sec = ~3 writes/sec average
  Peak (10×) ≈ 30 writes/sec
  → Trivial QPS

READS:
  1B / year / 31.5M = ~32 reads/sec average
  Peak ≈ 320 reads/sec
  Trivial.

STORAGE:
  Per URL: short_code (8 bytes) + long_url (avg 100 bytes) + metadata (50 bytes) = ~200 bytes
  10 years × 100M URLs = 1B URLs × 200B = 200 GB
  → Single PostgreSQL instance, easily fits

KEY GENERATION:
  62^6 = 56 billion (long enough for 10+ years)
  62^7 = 3.5 trillion (forever)
  → Use base62 encoding of incrementing counter or hash

CACHE:
  Top 20% most popular URLs cached → 200M URLs × 200B = 40 GB cache
  Realistic hot set = top 1% → 2 GB → fits in single Redis node easily
```

**Вывод:** для URL shortener инфраструктура не является узким местом — суть задачи в другом (генерация ID, перенаправления с низкой задержкой, аналитика).

---

## Шпаргалка по степеням двойки

| 2^n | Десятичный | Использование |
|-----|-----------|--------------|
| 2^10 | ~10^3 | K |
| 2^20 | ~10^6 | M |
| 2^30 | ~10^9 | G |
| 2^40 | ~10^12 | T |
| 2^50 | ~10^15 | P |
| 2^60 | ~10^18 | E |

**Совет:** на интервью считай в K/M/G — никогда не пиши длинные числа. `10^9` лучше чем `1,000,000,000`.

---

## Соотношение чтений/записей (по типам систем)

| Система | Чт:Зп |
|---------|--------|
| Twitter timeline | ~ 1000:1 (читают много, постят мало) |
| Reddit | ~ 100:1 |
| Email | ~ 1:1 |
| Система логирования | ~ 1:1000 (пишут много, читают мало) |
| Банковские транзакции | ~ 10:1 |
| Аналитический дашборд | ~ 1:10000 (ingestion >> reads) |

→ Read-heavy → кэширование, реплики для чтения. Write-heavy → шардирование, LSM-хранилища (Cassandra, ScyllaDB).

---

## Пиковые и средние коэффициенты

| Шаблон | Пик/Среднее |
|---------|----------|
| Стабильный B2B-сервис | 1.5-2× |
| Потребительский веб | 2-3× |
| Концентрация по часовому поясу (US/EU) | 3-5× |
| Флеш-распродажа, событие | 10-100× |
| Чёрная пятница, e-commerce | 50-100× |

→ Всегда оценивай **пиковую** нагрузку, не среднюю. Автомасштабирование, планирование ёмкости.

---

## Проверки на здравый смысл

После расчёта проверь себя:

1. **Сравни с реальностью**: 100K QPS — это 100M req/day. Если результат «1B writes/sec» — что-то не так (или ты Netflix).
2. **Проверка пропускной способности**: 10 Gbps NIC = 1.25 GB/s. Если расчёт > 10 Gbps на один экземпляр — нужно горизонтальное распределение.
3. **Рост хранилища**: «1 PB» означает много железа. Подумай, нужны ли все данные горячие, или часть архивная.
4. **CPU bound vs IO bound**: 100K QPS трудно с CPU-heavy operations (шифрование на каждый запрос), легко если просто прокси.

---

## Частые ошибки на собеседовании

- **Считаешь только среднее, не пик** — деплой в прод падает при первой же пиковой нагрузке
- **Игнорируешь коэффициент репликации** — данные × 3 для RF=3
- **Не учитываешь оверхед** (индексы +30-50% от сырых данных в RDBMS, GIN/GiST в 2-5× от B-tree)
- **Запоминаешь стандартные числа без понимания** — на вопрос «почему 10K QPS на PG?» нет ответа
- **Слишком много знаков точности** — `12,847 QPS` не даёт ощущения масштаба, `~13K QPS` лучше
- **Слепо доверяешь cloud autoscaling** — autoscaling не помогает, если один экземпляр не справляется (DB pinned scale)

---

## Источники

- [donnemartin/system-design-primer — Powers of two table](https://github.com/donnemartin/system-design-primer#powers-of-two-table)
- [Alex Xu — System Design Interview Vol. 1, Ch. 2 «Back-of-the-envelope estimation»](https://blog.bytebytego.com/p/system-design-interview-books-volume)
- [Jeff Dean — Numbers Every Programmer Should Know](https://research.google/people/jeff/)
- [Hello Interview — Back of the Envelope Calculations](https://www.hellointerview.com/learn/system-design/in-a-hurry/back-of-the-envelope-calculations)
- *Designing Data-Intensive Applications* (Kleppmann, 2017) — Ch. 1 «Reliable, Scalable, Maintainable»
