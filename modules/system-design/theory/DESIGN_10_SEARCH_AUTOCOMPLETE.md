# Design Problem: Search Autocomplete (Typeahead)

Подсказывать запросы по мере набора. Google search box, поиск товаров на Amazon, упоминания в Twitter. Latency-критично (50–100 мс на keystroke), ранжирование по популярности.

> **Scope:** уровень дизайна. Теория Trie — в [`TRIE.md`](TRIE.md).

---

## 1. Requirements

### Functional
- Подсказывать top-K продолжений запроса для prefix'а
- Обновлять подсказки на каждом keystroke
- Ранжирование по популярности (чаще искали — выше)
- Персонализация (опционально)
- Обновление в реальном времени (новые trending-запросы появляются)

### Non-functional
- **Sub-100 мс ответ** — в идеале < 50 мс
- **Высокий throughput** — каждое нажатие = запрос × миллионы пользователей
- **Масштаб** — миллиарды search-запросов в истории

---

## 2. Estimation

```
500M поисков в день
В среднем 4 keystroke на запрос = 2B autocomplete-запросов в день
  = ~25K QPS в среднем, пик 100K QPS

Уникальных запросов: ~100M (длинный хвост)
Top 1M покрывает ~95% (Zipf-распределение)

Размер Trie:
  100M запросов × в среднем 20 символов × 1 байт = 2 ГБ сырых символов
  С деревом и top-K на каждой ноде: ~20 ГБ
  → Влезет в RAM (одна нода 64 ГБ)
```

---

## 3. API

```http
GET /api/v1/autocomplete?q=brown+f&limit=10
→ 200 [
  { suggestion: "brown fox", count: 12345 },
  { suggestion: "brown furniture", count: 8901 },
  { suggestion: "brown fox jumps over", count: 5432 },
  ...
]
```

---

## 4. Архитектура

```
Пользователь печатает → throttle (debounce 50–100 мс между keystroke)
  ↓
LB → Autocomplete Service (read-replicas)
  ↓
In-memory Trie + кэш top-K
  ↓ (периодический refresh)
Trie Builder (batch-задача)
  ↑
Query Log Aggregator → счётчики per query per day
  ↑
Сырые search-логи (Kafka)
```

---

## 5. Trie с pre-computed top-K

Базовая теория — в [`TRIE.md`](TRIE.md).

Каждая нода Trie хранит **top-K suggestions** для своего prefix'а:

```python
class TrieNode:
    children: dict
    top_k_suggestions: list[(string, score)]  # отсортированы по score
```

Запрос `"app"`:
- Доходим до ноды для "app"
- Возвращаем `node.top_k_suggestions` (мгновенно)

**Trade-off:**
- ✓ Время запроса O(L) + возврат K — очень быстро
- ✗ Память: top-K кэш на ноду
- ✗ Обновление: смена score может требовать обновления в нескольких предках

---

## 6. Пайплайн построения Trie

### Offline (batch)

```
Ежедневный Spark-job:
  Сырые search-логи → агрегация:
    query → count за последние 30 дней
  Строим Trie:
    insert каждый (query, count) → обновляем top-K в предках
  Сериализуем Trie → S3
```

### Online refresh

```
Autocomplete-сервис:
  При старте: скачиваем свежий Trie из S3, загружаем в память
  Периодически: проверяем обновления, перезагружаем (blue/green, чтобы избежать downtime)
```

### Real-time частичные обновления

Для trending'а (например, термов из новостей вроде «Earthquake») чисто offline-подход отстаёт.

```
Свежие запросы (за последний час) → streaming-агрегация (Flink) →
  Обновления в «hot» Trie (отдельный in-memory) →
  При запросе мерджим результаты offline + hot Trie
```

---

## 7. Хранение

### Trie (in-memory)

- Один сериализованный бинарный формат
- На каждом инстансе приложения тот же blob
- ~20 ГБ на 100M запросов → влезает в 64 ГБ инстанс

### Persistence (cold)

- Blob в S3 — перестраивается ежедневно
- Меньшая БД запросов (PostgreSQL / Cassandra) для drill-down аналитики

### Search-логи

- Kafka topic с retention (например, 30 дней)
- Архив в S3 + колоночный формат (Parquet) для аналитики

---

## 8. Distributed serving

### Шардирование по prefix

Если Trie не помещается на одной ноде — шардируем по prefix:

```
Shard 0: prefix a–d
Shard 1: prefix e–h
Shard 2: prefix i–l
...

Router отправляет запрос на нужный shard по первому символу
```

Если suggestion пересекает shards — нужен merge.

### Read-only-реплики

Trie иммутабелен в рамках одного refresh'а. Много read-replica для высокого QPS.

```
N реплик, каждая загружает один и тот же Trie
Round-robin запросов
Refresh: blue/green deploy, новые реплики поднимаются с новым Trie
```

---

## 9. Персонализация

Добавляем user-specific подсказки поверх глобально популярных.

```
На запросе:
  global_suggestions = trie.top_k(prefix, K=15)
  user_history = redis.lrange(f"history:{user_id}", 0, -1)  # недавние поиски
  user_matching = filter(lambda s: s.startswith(prefix), user_history)
  
  merge: предпочитаем user_matching, остаток добиваем из global
```

Либо ML-модель с фичами (локация, время суток, язык, недавняя активность).

---

## 10. Антипаттерны / плохой контент

- Фильтрация явных / вредных запросов
- Блок trademark-злоупотреблений (Coca-Cola не разрешит подсказку «Pepsi»)
- Скрытие запросов с очень низким count (спам / опечатки)

---

## 11. Слой кэширования

Top-prefix'ы («a», «am», «ama», «amaz») получают миллионы QPS.

```
Application-level кэш (Caffeine LRU) на каждом инстансе
TTL: 5 минут (баланс freshness vs hit rate)

Top 1000 prefix'ов покрывают → 90% запросов отдаются из кэша без обхода Trie
```

---

## 12. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| Rebuild Trie упал | Используем вчерашний; алёрт оператору |
| Перегрузка hot-prefix'а | Scale-up реплик; гео-CDN edge-кэширование для read-only |
| Свежий trending-терм отсутствует в Trie | Hot Trie (streaming) его подхватывает; merge результатов |
| Пользователь ввёл emoji / unicode | Нормализуем при ingestion'е и на запросе |

---

## 13. Trade-offs

### Pre-computed top-K vs query-time ranking

- **Pre-computed** — быстро, но устаревает (пересборка раз в день); агрессивно персонализировать сложно
- **Query-time** — медленнее, но real-time + персонализация возможна

Гибрид: pre-computed + поздняя персонализирующая re-rank.

### Trie vs поисковый движок

- **Trie** — идеален для prefix matching, ручное ранжирование
- **Elasticsearch / Solr** — fuzzy matching, edge n-gram tokenizer; готовые фичи из коробки
- **DAWG** (Directed Acyclic Word Graph) — ещё компактнее, но сложно обновлять

Сейчас широко используют Elasticsearch Completion Suggester (на базе FST). Чистый Trie остаётся там, где нужен точный контроль.

---

## 14. Real-world примеры

- **Google search autocomplete** — кастомный Trie + ML + персонализация
- **Amazon search** — Trie по каталогу + boosting по категориям
- **Twitter mentions** — особый случай (user handles)
- **LinkedIn typeahead** — Cleo (выложен в open source)
- **Elasticsearch Completion Suggester** — FST-based, используется многими небольшими сервисами

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 13 «Design a Search Autocomplete System»
- [LinkedIn Cleo open source](https://github.com/linkedin/cleo)
- [Elasticsearch Completion Suggester](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-suggesters.html#completion-suggester)
- [Hello Interview — Twitter typeahead](https://www.hellointerview.com/learn/system-design/problem-breakdowns)
- См. также [`TRIE.md`](TRIE.md), [`INVERTED_INDEX.md`](INVERTED_INDEX.md)
