# Вероятностные структуры данных

Структуры с приближёнными ответами в обмен на меньшие память и нагрузку на CPU. Используются на масштабе, где точные алгоритмы не помещаются в RAM.

---

## Bloom Filter

**Цель:** проверить «может ли элемент быть в множестве?» с низким расходом памяти. **Ложноотрицательных нет** (если говорит «нет» — точно нет), **ложноположительные возможны** (если говорит «да» — может быть нет).

### Структура

- Bit array размером `m`
- `k` hash functions
- Размер `m` определяется по `n` (expected items) и `p` (acceptable false positive rate)

```
m = -n * ln(p) / (ln(2))^2
k = (m/n) * ln(2)

Для n=1M, p=1% → m=9.6M bits (1.2 MB), k=7 hash functions
```

### Операции

```
add(x):
  for h_i in hash_functions:
    bits[h_i(x) % m] = 1

contains(x) → bool:
  for h_i in hash_functions:
    if bits[h_i(x) % m] == 0:
      return False  # 100% guaranteed not present
  return True  # possibly present (could be false positive)
```

### Применение

- **Защита от проникновения в кэш** — перед запросом к DB проверить Bloom: «есть такой userId?» Если Bloom говорит «нет» → 100% не в DB, пропустить запрос
- **Дедупликация** — URL-краулер: «видели этот URL?»
- **CDN** — есть ли этот URL в origin (негативный кэш)
- **LSM-tree** — оптимизация точечного поиска (Cassandra, RocksDB)
- **Bitcoin SPV** клиенты — фильтрация релевантных транзакций

### Ограничения

- ✗ **Нельзя удалять** элементы из стандартного Bloom (обнуление битов ломает другие элементы)
- ✗ Доля ложноположительных растёт со временем, если добавили больше, чем планировали
- ✗ Нельзя итерироваться по элементам

### Counting Bloom Filter

Вместо битов — счётчики. `add` увеличивает, `remove` уменьшает. Можно удалять, но требует в 4–8× больше памяти.

### Cuckoo Filter (альтернатива)

- ✓ Поддерживает удаление
- ✓ Меньше памяти, чем Counting Bloom, при одинаковом уровне ложноположительных
- ✗ Вставка может упасть при высоком коэффициенте заполнения
- Используется в современных системах как замена Counting Bloom

---

## Count-Min Sketch (CMS)

**Цель:** оценить **частоту** элемента в потоке. Приближённый подсчёт в константной памяти.

### Структура

Матрица счётчиков `d × w`. `d` хеш-функций, каждая отображает в один из `w` столбцов.

```
        col 0  col 1  col 2  ...  col w-1
row 0   [count][count][count] ... [count]
row 1   [count][count][count] ... [count]
...
row d-1 [count][count][count] ... [count]
```

### Операции

```
add(x):
  for i in 0..d:
    matrix[i][hash_i(x) % w] += 1

count(x) → estimate:
  return min(matrix[i][hash_i(x) % w] for i in 0..d)
       # min — лучшая оценка (минимум collisions)
```

### Свойства

- **Завышает** (никогда не занижает)
- Ошибка ограничена: `ε ≈ 2/w`, вероятность превышения границы: `δ ≈ 1/e^d`

### Применение

- **Heavy hitters** — top-K запросов в потоке
- **Анализ сетевого трафика** — какие IP отправляют больше всего
- **Оптимизация запросов БД** — частота для избирательности индексов
- **Рекомендательные системы** — счётчики совместных вхождений

### Top-K

CMS + heap = `top_K`:
- CMS отслеживает частоты
- Min-heap размером K хранит текущий top K
- Для каждого элемента: оцениваем частоту, если > min(heap) → обновляем heap

---

## HyperLogLog (HLL)

**Цель:** приближённый подсчёт уникальных элементов. Точный `count_distinct` требует O(n) памяти (HashSet); HLL — O(log log n).

### Идея

- Хешируем каждый элемент → равномерно случайные биты
- Отслеживаем **максимум ведущих нулей** в хешах — соответствует приближённому log2(число уникальных)
- Несколько хеш-функций / разделов → усреднение для точности

### Размер

**~12 КБ при ошибке 2%, более 1 млрд уникальных элементов**. Для сравнения, HashSet: 1 млрд элементов × 8 байт = 8 ГБ.

### Операции

```
add(x):
  h = hash(x)
  partition = h % m       # m = 16384 для standard
  rest = h / m
  leading_zeros = count_leading_zeros(rest)
  registers[partition] = max(registers[partition], leading_zeros)

count_distinct() → estimate:
  harmonic_mean(registers) * m * α  # bias correction
```

### Применение

- **Подсчёт уникальных посетителей** (Redis `PFCOUNT`)
- **Кардинальность в аналитике** (Druid, BigQuery — встроенный `APPROX_COUNT_DISTINCT`)
- **Обнаружение DDoS** — уникальные IP-адреса источников
- **Приватность** — Apple использует варианты HLL для дифференциальной приватности

### Redis HyperLogLog

```redis
PFADD visitors 'user:123'
PFADD visitors 'user:456'
PFCOUNT visitors          → ~ 2

PFMERGE result visitors_day1 visitors_day2  # union без duplicate
PFCOUNT result            → union cardinality
```

---

## Другие приближённые структуры

### Top-K (Misra-Gries / Space-Saving)

Top-K в потоке с ограниченной памятью. Пространство `O(K)`, подходит когда K невелик (top 100, 1000).

### MinHash

Приближённое сходство Жаккара (сходство множеств). Два множества — выборка отпечатков — сравниваем число совпадений.

**Применение:** обнаружение плагиата, поиск почти дублирующихся документов.

### Quotient Filter

Современная альтернатива Bloom — лучшая локальность кэша, поддерживает удаление.

---

## Сравнительная таблица

| Структура | Применение | Память | Ошибка | Примечания |
|-----------|----------|--------|------------|-------|
| **Bloom Filter** | Проверка принадлежности | ~1.2 МБ / 1M @ 1% | Ложноположительные | Нет удаления (стандартный) |
| **Counting Bloom** | Принадлежность с удалением | 4–8× Bloom | Аналогично | Поддерживает удаление |
| **Cuckoo Filter** | Улучшенный Bloom | Меньше Counting Bloom | Аналогично | Поддерживает удаление, современный |
| **Count-Min Sketch** | Частота | КБ–МБ | Завышает | Приближённые частоты |
| **HyperLogLog** | Подсчёт уникальных | ~12 КБ / млрд | ±2% | Только кардинальность |
| **Top-K (Misra-Gries)** | Top-K элементы | O(K) | Приближённая | Когда K невелик |
| **MinHash** | Сходство множеств | O(k) на множество | Приближённая | Оценка Жаккара |

---

## Когда НЕ использовать

Приближённое ≠ точное. Не используй, если:

- **Нужна строгая корректность** — финансовые транзакции (никаких ложноположительных или ложноотрицательных)
- **Маленький датасет** — оверхед не оправдан (используй HashSet, HashMap)
- **Нужны точные счётчики** для биллинга — HyperLogLog даёт приближение; нужны точные счётчики

**Паттерн:** приближённые структуры на горячем пути (кэш, дедупликация, аналитика в реальном времени), точные — в batch (ночные агрегаты, финансовое закрытие).

---

## Системы в продакшене

- **Redis** — Bloom Filter (RedisBloom module), HyperLogLog (`PFADD`/`PFCOUNT`)
- **Cassandra** — Bloom Filter per SSTable для read optimization
- **PostgreSQL** — Bloom filter index extension (`bloom` extension)
- **BigQuery** — `APPROX_COUNT_DISTINCT` (HLL)
- **Apache Druid** — HLL для COUNT DISTINCT в запросах
- **Snowflake** — встроенные приближённые функции
- **Facebook** — Apache Pinot for approximate top-K в feeds
- **Akamai / Cloudflare** — CMS для анализа трафика в реальном времени

---

## Источники

**Статьи:**
- [Bloom (1970) — «Space/Time Trade-offs in Hash Coding with Allowable Errors»](https://web.archive.org/web/20120307010822/http://www.cs.upc.edu/~diaz/p422-bloom.pdf) — оригинал
- [Cormode, Muthukrishnan (2005) — «An Improved Data Stream Summary: The Count-Min Sketch»](http://dimacs.rutgers.edu/~graham/pubs/papers/cmsoft.pdf)
- [Flajolet et al. (2007) — «HyperLogLog: the analysis of a near-optimal cardinality estimation algorithm»](http://algo.inria.fr/flajolet/Publications/FlFuGaMe07.pdf)
- [Fan et al. (2014) — «Cuckoo Filter: Practically Better Than Bloom»](https://www.cs.cmu.edu/~dga/papers/cuckoo-conext2014.pdf)

**Инженерные ресурсы:**
- [Cloudflare — Probabilistic algorithms in DDoS protection](https://blog.cloudflare.com/when-bloom-filters-dont-bloom/)
- [Discord — Why Discord is switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust) — Bloom filter performance critical path
- [Redis Bloom Filter documentation](https://redis.io/docs/data-types/probabilistic/bloom-filter/)
- [PostgreSQL bloom extension](https://www.postgresql.org/docs/current/bloom.html)

**Книги:**
- *Data Streaming Algorithms* (S. Muthukrishnan, 2005) — academic textbook
- *Database Internals* (Petrov, 2019) — Bloom в LSM context
