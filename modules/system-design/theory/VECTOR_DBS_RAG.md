# Векторные БД и RAG

Векторные БД — хранилище и поиск эмбеддингов (высокоразмерных векторов, описывающих семантику контента). Основа RAG-систем (Retrieval-Augmented Generation) с LLM. Критическая тема для AI-ориентированных компаний на собеседованиях 2024–2026.

> **Область:** хранилище векторов, ANN-алгоритмы, архитектура RAG. Общий ML serving — [`ML_SERVING.md`](ML_SERVING.md). Классический инвертированный индекс — [`INVERTED_INDEX.md`](INVERTED_INDEX.md).

---

## Что такое embeddings

Текст (изображение, аудио) → вектор фиксированной длины и высокой размерности (768, 1536, …).

```
"cat" → [0.23, -0.45, 0.81, ...]  (1536 dimensions)
"dog" → [0.21, -0.43, 0.79, ...]  (близко к "cat")
"car" → [0.92, 0.13, -0.55, ...]  (далеко)
```

**Свойство:** семантическая близость → расстояние между векторами меньше.

`distance(cat, dog) < distance(cat, car)` — embedding-модель «понимает», что cat и dog ближе по смыслу.

### Embedding-модели

- **OpenAI** — `text-embedding-3-small` / `-large` (1536 / 3072 dim)
- **Cohere** — `embed-v3` (1024 dim)
- **Sentence-Transformers** (open source) — много вариантов, 384–768 dim
- **BERT / RoBERTa** — старее, но всё ещё используются
- **CLIP** — мультимодальный (text + image)

Каждый текст → вектор. Размерность одна и та же для всех данных в индексе.

---

## Задача vector search

«Найти top-K ближайших векторов к запросу».

```
Naive: distance(query, doc_i) для всех i, отсортировать, вернуть top K
Cost: O(N × d), N = всего документов (миллионы), d = размерность (1536)
→ Медленно для больших N
```

**Решение:** алгоритмы **Approximate Nearest Neighbor (ANN)**. Жертвуем небольшой точностью ради ускорения в 10–1000 раз.

### Метрики расстояния

- **Cosine similarity** — угол между векторами, не зависит от длины. Самый частый для текста.
- **Euclidean (L2)** — прямолинейное расстояние
- **Dot product** — когда длина имеет значение
- **Manhattan (L1)** — taxicab distance

Большинство embedding-моделей обучаются под cosine similarity.

---

## ANN-алгоритмы

### HNSW (Hierarchical Navigable Small World)

State-of-the-art. Многослойный граф: каждый уровень — более разреженное подмножество точек, рёбра соединяют близких соседей. Поиск спускается по уровням и находит приближённого ближайшего.

```
Верхний слой:   несколько «магистральных» точек
Средние слои:   плотнее
Нижний слой:    все точки

Поиск: стартуем сверху, движемся к query, спускаемся вниз, уточняем
```

- ✓ Высокий recall (95–99%)
- ✓ Быстрый запрос (~1–10 мс на 1M+ векторов)
- ✗ Память — граф целиком в RAM
- ✗ Медленные insertions и deletes

**Реализации:** FAISS HNSW, hnswlib, Weaviate, Pinecone, Qdrant.

### IVF (Inverted File Index)

Кластеризация векторов через k-means → k кластеров. На запросе: находим ближайшие кластеры и ищем только в них.

- ✓ Меньше памяти
- ✓ Быстрее построение, чем HNSW
- ✗ Ниже recall — запрос на границе кластера может уйти не туда
- ✗ Нужно подбирать число кластеров

### PQ (Product Quantization)

Сжимаем векторы: разбиваем на подвекторы и квантуем каждый. Приближённые расстояния считаются быстро через lookup table.

- ✓ Очень компактно (в 32 раза меньше)
- ✓ Быстро (table lookup)
- ✗ Ниже точность

**IVF-PQ** — комбинация: кластеризация + сжатие. Используется в FAISS.

### LSH (Locality-Sensitive Hashing)

Хэшируем похожие векторы в один bucket. Более старый подход, вытеснен HNSW.

---

## Векторная БД против библиотеки

**Library** (FAISS, Annoy, hnswlib) — встроенный индекс, без сервера. Построение и запрос в одном процессе. Не управляет updates, репликацией, persistence.

**Database** (Pinecone, Weaviate, Qdrant, Milvus, pgvector):
- Сервер с HTTP/gRPC API
- Persistence
- Updates / deletes
- Репликация и шардирование (у части)
- Hybrid search (vector + filter)
- Multi-tenancy

### Реализации (2024–2026)

| | Тип | Заметки |
|---|---|---|
| **Pinecone** | Managed cloud | Первопроходец, простой API, pay-per-query |
| **Weaviate** | Open source + cloud | GraphQL API, hybrid (vector + keyword) |
| **Qdrant** | Open source + cloud | На Rust, производительный |
| **Milvus** | Open source | Максимальный масштаб, родом из Китая (Zilliz) |
| **pgvector** | Расширение PostgreSQL | Интеграция с уже существующим PG, поддержка HNSW |
| **Elasticsearch dense_vector** | Существующий ES | Удобный hybrid search |
| **Chroma** | Open source | Заточен под LLM, удобно embedd'ить документы |
| **Vespa** | Open source от Yahoo | Multi-modal (vector + text + structured) |
| **FAISS** | Library (Facebook) | Только embedding, без сервера |

**Особенность pgvector:** расширение PostgreSQL. Если у вас уже Postgres и < 10M векторов — даёт vector search без новой инфраструктуры. HNSW поддерживается с pgvector 0.5.

---

## Гибридный поиск

Современный запрос — это **vector** + **keyword** + **metadata filter** одновременно.

Пример: «свежие статьи про RAG (vector match), на английском (filter), из качественных источников (filter)».

```
GET /search {
  vector: [0.23, ...] (семантический запрос),
  query: "retrieval augmented generation",
  filter: { language: "en", source_quality: { gt: 0.7 }, date: { gt: "2024-01-01" } },
  k: 10
}
```

**Реализации:**
- **Weaviate** — hybrid first-class
- **Elasticsearch dense_vector + filter**
- **Vespa** — продвинутая мультимодальность
- **Pinecone** — фильтрация по metadata

---

## RAG (Retrieval-Augmented Generation)

Паттерн: ответ LLM дополняется найденными документами (внешнее знание).

```
User: "What is HNSW?"
  ↓
[Embed query] → vector
  ↓
[Vector DB search] → top-K релевантных chunks
  ↓
[Собираем prompt с chunks]
  ↓
[LLM генерирует ответ, используя chunks как контекст]
  ↓
Возвращаем ответ (+ ссылки на источники)
```

### Зачем RAG

LLM (GPT-4, Claude) обучены до cutoff date, не знают вашу proprietary-информацию и могут галлюцинировать. RAG **grounds** ответ в надёжных источниках.

### Архитектура

```
1. Ingestion pipeline:
   Documents (PDF, web, internal wiki) →
   chunking (куски по 500–1000 токенов) →
   embeddings (на каждый chunk) →
   vector DB

2. Query pipeline:
   User query → embed → vector search →
   top-K chunks →
   prompt-шаблон: "Answer using these documents: {chunks}\nQuestion: {query}" →
   LLM call →
   parse response, добавить citations
```

### Стратегии chunking

- **Fixed-size** — 500 токенов, просто
- **Sentence-aware** — split по предложениям (NLTK, spaCy)
- **Semantic** — chunks по семантической близости (сложнее)
- **Hierarchical** — мелкие chunks для precision + parent-context

**Trade-off:** мелкие chunks дают точнее retrieval, но мало контекста. Крупные chunks — больше контекста, но больше шума.

**Overlapping chunks** — 20–50% перекрытие, чтобы не рвать концепты на границе.

### Re-ranking

Vector search возвращает top-K кандидатов (например, 100). Re-ranker (cross-encoder model) пересчитывает score, чтобы выбрать top-10.

- **Cohere Rerank API**
- **Кастомный cross-encoder** (на базе BERT)
- **Reciprocal Rank Fusion** — комбинация нескольких методов поиска

Сильно повышает precision (часто +20% к relevance).

### Hybrid RAG

- **Dense + sparse** — vector + BM25 (keyword) вместе
- **Multi-vector per chunk** — несколько представлений (Q&A пары, summary)
- **Knowledge graph + vector** — entity linking + semantic search
- **Multi-hop retrieval** — итеративный поиск (первые результаты уточняют следующий запрос)

---

## Сложности в продакшене

### Масштаб ingestion

Повторный embedding всех документов при смене embedding-модели — дорого.

```
1M документов × 1K токенов × $0.0001 (стоимость embedding) = $100
1B документов = $100K
```

Стратегия: embed только новые + изменённые; полный re-embed — периодически при major model change.

### Свежесть обновлений

Пользователь загружает документ → ожидает, что он мгновенно искать. Vector DB должна поддерживать быстрые inserts.

### Стоимость

- **Storage:** 1M векторов × 1536 dim × 4 байта = 6 ГБ на копию
- **Query cost:** Pinecone ~$0.0001 / запрос (10M запросов = $1000)
- **LLM call cost:** GPT-4o-mini ~$0.00015 / 1K input tokens; RAG-prompt 2K input → $0.0003 / запрос

### Evaluation

«Хорош ли мой RAG?» — сложно:
- **Recall** — нашлись ли релевантные документы? Нужна ground truth.
- **Precision** — топ результатов действительно релевантен?
- **Качество ответа** — LLM хорошо использует chunks?
- **Latency, стоимость** — операционные метрики

**Инструменты:** Ragas, TruLens, кастомный LLM-as-judge.

### Hallucinations

LLM может всё равно выдумать факт, если в chunks нет ответа. Митигации:
- Жёсткий prompt («отвечать только на основе предоставленных chunks»)
- Confidence scoring
- Принуждение цитировать (каждое утверждение → источник)

---

## Бюджет задержки для RAG

```
Embedding запроса:  50–100 мс (OpenAI API)
Vector search:      10–50 мс (HNSW)
Re-rank (опционально): 100–300 мс
LLM call:           500–3000 мс (зависит от модели и длины ответа)

Итого: типично 1–3 секунды, < 1 секунды достижимо с малыми LLM
```

**Streaming response** — показывать токены по мере генерации; воспринимаемая latency значительно ниже.

---

## Сценарии

- **Customer support chatbot** — ответ из продуктовой документации
- **Internal knowledge search** (Glean, Slack AI) — wiki / история чатов
- **Legal research** — поиск прецедентов
- **Code search + generation** (Cursor, GitHub Copilot Chat) — RAG по кодовой базе
- **Medical research** — статьи / протоколы
- **Education** — tutor на curated content

---

## Антипаттерны

- **Vector DB для structured-запросов** — `WHERE price < 100` не требует vector, нужен SQL.
- **Embed всего подряд** — короткие тексты (только заголовки) дают плохое качество embedding'а.
- **Без chunking** — крупные документы целиком в retrieval (слишком много контекста для LLM).
- **Без metadata-фильтрации** — чисто vector search возвращает не то (неверный язык, устаревшая дата).
- **Re-embedding всего при каждой смене модели** — дорого. Планировать миграции.
- **Один retrieval** на сложные запросы — multi-hop / decomposed retrieval работают лучше.

---

## Источники

**Papers:**
- [Malkov, Yashunin (2018) — «Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs» (HNSW)](https://arxiv.org/abs/1603.09320)
- [Lewis et al. (2020) — «Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks»](https://arxiv.org/abs/2005.11401) — оригинал RAG
- [Karpukhin et al. (2020) — «Dense Passage Retrieval for Open-Domain Question Answering»](https://arxiv.org/abs/2004.04906)

**Инструменты и документация:**
- [Pinecone Documentation](https://docs.pinecone.io/)
- [Weaviate Docs](https://weaviate.io/developers/weaviate)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [FAISS Wiki](https://github.com/facebookresearch/faiss/wiki)
- [LangChain Documentation](https://python.langchain.com/) — RAG-фреймворк

**Инженерные блоги:**
- [Pinecone Learning Center](https://www.pinecone.io/learn/)
- [Anthropic — Building effective agents (2024)](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI Cookbook — Embeddings, RAG examples](https://cookbook.openai.com/)
- [Cohere — Rerank Documentation](https://docs.cohere.com/docs/rerank-overview)

**Книги:**
- *Building LLM Applications for Production* (Chip Huyen, in progress) — RAG, vector search
- [Hands-On Generative AI with Transformers and Diffusion Models (2024)](https://www.oreilly.com/) — глава про RAG
