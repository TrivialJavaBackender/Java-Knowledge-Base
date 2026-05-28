# Инвертированный индекс

Структура для полнотекстового поиска. **Инвертированный** = «термин → список документов, его содержащих», обратно к стандартному «документ → список терминов».

Основа всех поисковых движков: Elasticsearch, Solr, Lucene.

---

## Идея

```
Документы:
  doc1: "The quick brown fox jumps"
  doc2: "Quick brown dogs run"
  doc3: "The lazy fox sleeps"

Inverted index:
  brown   → [doc1, doc2]
  fox     → [doc1, doc3]
  quick   → [doc1, doc2]  (после нормализации регистра при tokenization)
  the     → [doc1, doc3]
  lazy    → [doc3]
  ...
```

**Поиск "brown fox":** пересечение списков публикаций `[doc1, doc2] ∩ [doc1, doc3] = [doc1]`. **doc1 — match.**

---

## Структуры

### Список публикаций (posting list)

Для каждого термина — отсортированный список doc ID.

```
"brown" → [1, 2, 7, 12, 35, 100, ...]
```

Может содержать дополнительные данные:
- **Term frequency** (TF) — сколько раз встречается в документе (для ranking)
- **Positions** — где в документе (для phrase queries)
- **Field info** — title / body / tags (для повышения релевантности / boosting)

### Словарь (dictionary / lexicon)

Отображение термина → расположение списка публикаций (offset в файле или указатель).

Реализации:
- **Hash table** — lookup O(1), но без range-запросов
- **Sorted array / B-tree** — поддерживает prefix scan и range
- **FST (Finite State Transducer)** — выбор Lucene, компактен и быстр на prefix scan

### Хранение

```
[Dictionary: terms → postings_offset]
[Postings: [doc1, freq, positions, doc2, freq, positions, ...]]
[Documents: исходные тексты, stored fields]
```

---

## Конвейер индексации

```
Текст документа →
  1. Tokenization          → разбить на термы
  2. Нормализация          → lowercase, удаление диакритики
  3. Stop words filter     → удалить «the», «a»
  4. Stemming/Lemmatization → «running» → «run»
  5. Synonyms              → «USA» ↔ «United States»
  6. Index                 → добавить term → doc-сопоставление
```

### Токенизация (tokenization)

- **Whitespace tokenizer** — разбивает по пробелам. Просто, но хрупко («hello,world» → 1 токен).
- **Standard tokenizer** — language-aware (Unicode), снимает пунктуацию.
- **Edge n-gram** — `apple` → `a`, `ap`, `app`, `appl`, `apple` (для автодополнения без trie).
- **CJK / Korean** — отдельные токенизаторы (Kuromoji, Nori).

### Стемминг (stemming)

«running, runs, ran» → «run». Snowball, Porter stemmer.

- ✓ Лучше полнота (найдёт «runs» при запросе «running»)
- ✗ Может давать ложные срабатывания («fishing» → «fish»)

### Лемматизация (lemmatization)

Похоже на стемминг, но возвращает реальную базовую форму слова (через словарь). Точнее, но медленнее.

---

## Обработка запроса

### Булев запрос (boolean query)

```
"brown AND fox NOT lazy"
```

- `brown` список публикаций = [1, 2]
- `fox` список публикаций = [1, 3]
- Пересечение (AND): [1]
- `lazy` = [3]
- Вычитание (NOT): [1] − [3] = [1]

→ Результат: doc1.

### Фразовый запрос (phrase query)

```
"brown fox"  (точная фраза)
```

Списки публикаций с **позициями**:
- `brown` → [(doc1, pos=3), (doc2, pos=2)]
- `fox` → [(doc1, pos=4), (doc3, pos=3)]

Проверка: `brown` на pos N + `fox` на pos N+1 в одном документе. Match: doc1.

### Запрос с подстановкой (wildcard / prefix)

```
"brown*"
```

Скан словаря по всем терминам, начинающимся с «brown»: `brown`, `brownie`, `browns`, … объединение всех списков публикаций.

### Нечёткий запрос (fuzzy)

```
"fix~"  (edit distance 1)
```

Поиск всех терминов в пределах edit distance: `fix`, `fox`, `fit`. Объединение списков публикаций.

---

## Ранжирование по релевантности

«Найти подходящие документы» — просто. «Отсортировать по релевантности» — сложнее. Стандартные алгоритмы:

### TF-IDF (Term Frequency – Inverse Document Frequency)

```
TF(t, d) = count(t в d) / общее число термов в d
IDF(t) = log(N / |{документы, содержащие t}|)
Score(t, d) = TF(t, d) × IDF(t)
```

**Суть:** частые термы (высокая document frequency) → низкий IDF → менее значимы. Редкие термы → высокий IDF → повышают релевантность.

### BM25 (современный стандарт)

Развитие TF-IDF с saturation-функцией (term frequency растёт не линейно) и нормализацией по длине документа.

```
BM25(t, d) = IDF(t) × [TF(t,d) × (k+1)] / [TF(t,d) + k × (1 - b + b × len(d)/avg_len)]

k ≈ 1.2–2.0 (TF saturation)
b ≈ 0.75 (length normalization)
```

→ **Дефолт в Lucene / Elasticsearch с версии 5.0.**

### Векторный поиск (на основе эмбеддингов)

Современная альтернатива: документы и запросы кодируются в **векторное пространство**, cosine similarity. Семантическая близость. См. [`VECTOR_DBS_RAG.md`](VECTOR_DBS_RAG.md).

### Кастомное повышение релевантности (custom boosting)

```
score = BM25_score(query, doc) × boost_factor

Boost-факторы:
- recency: свежие документы выше
- popularity: больше кликов / лайков
- authority: доверенные источники
- exact match в title: boost ×3
```

---

## Lucene / Elasticsearch — архитектура

### Сегменты (segments)

Lucene хранит данные в **иммутабельных сегментах** (segments). Новые документы → новый сегмент. Периодический merge (похоже на compaction в LSM).

```
Index:
  segment_1 (immutable, документы 1–1000, со своим inverted index)
  segment_2 (1001–2500)
  segment_3 (2501–3000)

Поиск:
  → запрос параллельно ко всем segments
  → merge результатов
```

### Интервал обновления (refresh interval)

Свежие документы не доступны для поиска мгновенно. Дефолт Elasticsearch: refresh раз в секунду (создаёт новый сегмент и открывает его для поиска).

→ **Поиск почти в реальном времени (near-real-time search)**, не строго мгновенный. Для критичной мгновенной видимости — `?refresh=true` (ценой большего числа сегментов).

### Шардирование (sharding)

Индекс разбивается на **N шардов** (дефолт 5 в ES). Каждый шард — независимый Lucene-index. Поиск веерно распределяется (fan-out) по всем шардам и объединяет результаты.

```
поиск "brown fox":
  → координирующий узел fan-out по 5 шардам
  → каждый шард ищет локально
  → координатор делает merge top-K
  → возвращает глобальный top-K
```

### Репликация (replication)

У каждого шарда — N реплик (дефолт 1). Трафик чтения балансируется по нагрузке. Переключение на резерв (failover) на реплику при сбое primary.

---

## Сценарии

- **Application search** — поисковая строка в продуктах, база знаний
- **Log search** (Kibana, Loki) — поиск по миллиардам строк логов
- **E-commerce search** — каталоги Amazon, eBay
- **News / content** — поиск в Twitter, Reddit
- **Code search** — GitHub, Sourcegraph (специальные tokenizers под языки программирования)

---

## Подводные камни

- **Размер индекса** — инвертированный индекс часто 50–200% от исходного текста. Закладывайте хранилище.
- **Стоимость обновления** — каждое обновление документа создаёт новый сегмент, который затем сливается (merge). Тяжёлая нагрузка на обновление → дорогие слияния.
- **Высокая кардинальность поля** — поле «timestamp» с миллионами уникальных значений → раздутый индекс.
- **Переиндексация (reindex)** — смена схемы (новый analyzer, новые поля) → полная переиндексация (часы для большой системы).
- **Aggregations (термин Elasticsearch)** на полях с высокой кардинальностью → взрыв памяти.

---

## Альтернативы по сценарию использования

| Сценарий | Инструмент |
|---|---|
| Общий full-text search | Elasticsearch / OpenSearch |
| Lightweight, embedded | Apache Lucene напрямую |
| FTS в PostgreSQL | `tsvector` + GIN-индекс (для small–medium scale) |
| Code search (специализированный) | Zoekt, hound, livegrep |
| Vector / семантика | Pinecone, Weaviate, pgvector, Elasticsearch dense_vector |
| Geo + текст | Elasticsearch `geo_point` + match |
| Log search | Loki, ELK |
| Аналитика + поиск | Apache Pinot, Druid |

---

## Примеры из продакшена

- **GitHub** — code search на Elasticsearch (исторически), переходят на Blackbird (custom)
- **Wikipedia** — Elasticsearch (раньше — чистый Lucene)
- **LinkedIn** — Galene (кастомная search-платформа поверх Lucene)
- **Twitter** — Earlybird (кастомный движок на базе Lucene)
- **Stack Overflow** — Elasticsearch
- **Shopify** — Elasticsearch для storefront search

---

## PostgreSQL FTS (малый и средний масштаб)

```sql
ALTER TABLE articles ADD COLUMN tsv tsvector;
UPDATE articles SET tsv = to_tsvector('english', title || ' ' || body);
CREATE INDEX idx_articles_tsv ON articles USING gin(tsv);

SELECT * FROM articles
WHERE tsv @@ to_tsquery('english', 'brown & fox')
ORDER BY ts_rank(tsv, to_tsquery('english', 'brown & fox')) DESC;
```

Подходит для приложений с 1M–10M документов. Дальше — Elasticsearch.

---

## Источники

- [Apache Lucene Documentation](https://lucene.apache.org/) — оригинальная библиотека
- [Elasticsearch: The Definitive Guide](https://www.elastic.co/guide/en/elasticsearch/guide/current/index.html) — старо, но отлично
- *Lucene in Action* (Hatcher, Gospodnetic, McCandless, 2nd ed.) — внутренности Lucene
- [Robertson et al. (1994) — BM25 paper](https://www.staff.city.ac.uk/~sb317/papers/foundations_bm25_review.pdf)
- *Information Retrieval: Implementing and Evaluating Search Engines* (Büttcher, Clarke, Cormack)
- [PostgreSQL Full-Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [Apache Lucene FST (Finite State Transducer)](https://blog.mikemccandless.com/2013/06/build-your-own-finite-state-transducer.html)
- [GitHub — Improving GitHub Code Search (Blackbird)](https://github.blog/2023-02-06-the-technology-behind-githubs-new-code-search/)
