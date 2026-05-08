# Eviction Policies

Когда кэш достигает лимита (по числу записей или по weight), нужно выбрать жертву. Алгоритм выбора = eviction policy.

## Базовые алгоритмы

### LRU (Least Recently Used)
Выбрасывает запись с самым старым **последним обращением**.

**Реализация O(1):** двусвязный список + HashMap. На `get`/`put` — переместить в head. Жертва — tail.

**Плюсы:** прост, хорош для temporal locality.

**Минусы:**
- **Scan-resistance отсутствует:** один большой обход редко-используемых ключей выбьет все горячие.
- На concurrent доступе нужны локи (CAS на двусвязном списке нетривиален).

### LFU (Least Frequently Used)
Выбрасывает запись с **наименьшей частотой** обращений.

**Реализация:** счётчик на ключ + sorted-by-frequency структура. O(1) реализация — частотные buckets (см. Ex03).

**Плюсы:** scan-resistance (один проход не накопит частоту).

**Минусы:**
- **Старение:** ключ-ветеран с frequency=10000 будет жить вечно, даже если перестал быть актуальным. Нужен decay/aging.
- Дороже LRU по памяти (счётчик на каждый ключ).

### FIFO
Выбрасывает первое вставленное. Простейшая очередь.

**Плюсы:** просто.
**Минусы:** игнорирует частоту обращений → плохой hit ratio.

### Random
Выбрасывает случайный ключ.

**Плюсы:** O(1), thread-friendly (нет общей структуры порядка).
**Минусы:** worst-case на любых паттернах. Иногда используется в Memcached/Redis (`allkeys-random`) когда есть ресурсы и не хочется мудрить.

---

## Продвинутые алгоритмы

### ARC (Adaptive Replacement Cache)
Запатентован IBM (срок истёк). Поддерживает **2 LRU списка**: T1 (recently used once) и T2 (recently used multiple times) + ghost lists B1/B2 (вытесненные). Адаптивно балансирует размер T1 vs T2 в зависимости от паттерна.

Используется в ZFS, PostgreSQL (вариация — clock-sweep с 2-bit usage counter).

### 2Q
Похож на ARC: A1 (FIFO для новичков) + Am (LRU для прижившихся). На повторное обращение запись переезжает из A1 в Am. Защищает от scan'ов.

### TinyLFU
Eviction строится на **admission filter**: новый ключ примет, только если его сэмплированная частота больше, чем у потенциальной жертвы. Частота хранится в **count-min sketch** (вероятностная структура, O(1) с фиксированной ошибкой).

Aging: периодический halving счётчиков → решает проблему "ветеранов" в LFU.

### W-TinyLFU (Caffeine)
**TinyLFU + window LRU:**
- Window (1% размера) — LRU для свежих записей.
- Main (99%) — SLRU (Segmented LRU) с TinyLFU admission.
- Из window вытесняемая запись пытается попасть в main; admission filter решает, заслуживает ли она.

Результат: **scan-resistance** + **frequency bias** + **aging** + **O(1) операции**. На реальных нагрузках hit-ratio выше LRU на 10–25%.

Это default в Caffeine. Подробнее → [CAFFEINE.md](CAFFEINE.md).

---

## TTL vs TTI

- **TTL (time to live) / expireAfterWrite:** запись expires через t после ПЕРВОЙ записи.
- **TTI (time to idle) / expireAfterAccess:** запись expires через t после ПОСЛЕДНЕГО обращения (read или write).

```
expireAfterWrite(10m):   put(t=0) ... read(t=9m) ... read(t=11m) → MISS (expired при t=10m)
expireAfterAccess(10m):  put(t=0) ... read(t=9m) ... read(t=18m) → HIT  (read обновил access)
                                                       read(t=29m) → HIT
                                                                     ...
                                                                     (живёт пока его трогают)
```

TTL проще для ограничения stale (хочу свежесть не старше N). TTI — для классического "evict idle".

Можно комбинировать: `expireAfterWrite=1h && expireAfterAccess=10m` — "максимум 1 час, но если 10 минут не трогают — выкидываем раньше".

## Custom expire

Caffeine `expireAfter(Expiry<K, V>)` — TTL зависит от ключа/значения (например, премиум-юзеры дольше живут в кэше).

## Size-based vs weight-based

- **`maximumSize(N)`:** ограничение по числу записей. Подходит, когда записи примерно равны.
- **`maximumWeight(W) + weigher((k, v) -> v.size)`:** ограничение по сумме весов. Нужно, если значения сильно разные (HTML-страницы 1KB и 1MB в одном кэше).

## Manual invalidation

Кроме автоматического eviction, любой кэш поддерживает явную инвалидацию:
- `cache.invalidate(key)` — удалить один.
- `cache.invalidateAll(keys)` / `invalidateAll()` — pre-bulk.

Часто триггерится после `db.update()` (см. [CACHE_PATTERNS.md](CACHE_PATTERNS.md)).

## Reference: Redis maxmemory-policy

Redis отдельно — у него свои названия:
- `noeviction` — fail на write при OOM.
- `allkeys-lru` / `allkeys-lfu` / `allkeys-random` — evict из всех ключей.
- `volatile-lru` / `volatile-lfu` / `volatile-random` / `volatile-ttl` — evict только из ключей с TTL.

Для cache-only Redis: `allkeys-lfu`. Подробнее → [REDIS.md](REDIS.md).
