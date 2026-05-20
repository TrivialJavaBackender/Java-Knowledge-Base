# Inverted Index

Структура для full-text search. **Inverted** = «term → list of documents containing it», обратно к стандартному «document → list of terms».

Основа всех search engines: Elasticsearch, Solr, Lucene.

---

## Идея

```
Document store:
  doc1: "The quick brown fox jumps"
  doc2: "Quick brown dogs run"
  doc3: "The lazy fox sleeps"

Inverted index:
  brown   → [doc1, doc2]
  fox     → [doc1, doc3]
  quick   → [doc1, doc2]  (case-insensitive after tokenization)
  the     → [doc1, doc3]
  lazy    → [doc3]
  ...
```

**Search "brown fox":** intersect posting lists `[doc1, doc2] ∩ [doc1, doc3] = [doc1]`. **doc1 matches.**

---

## Структуры

### Posting list

Для каждого term — список doc IDs (отсортирован).

```
"brown" → [1, 2, 7, 12, 35, 100, ...]
```

Может содержать дополнительные данные:
- **Term frequency** (TF) — how many times in doc (for ranking)
- **Positions** — где в документе (for phrase queries)
- **Field info** — title / body / tags (for boosting)

### Dictionary (lexicon)

Map от term до posting list location (offset в файле, или pointer).

Implementations:
- **Hash table** — O(1) lookup, no range queries
- **Sorted array / B-tree** — supports prefix scan, range
- **FST (Finite State Transducer)** — Lucene's choice, compact + fast prefix scan

### Storage

```
[Dictionary: terms → postings_offset]
[Postings: [doc1, freq, positions, doc2, freq, positions, ...]]
[Documents: original docs, stored fields]
```

---

## Indexing pipeline

```
Document text →
  1. Tokenization      → break into terms
  2. Normalization     → lowercase, accent strip
  3. Stop words filter → remove "the", "a"
  4. Stemming/Lemma    → "running" → "run"
  5. Synonyms          → "USA" → "USA", "United States"
  6. Index             → add term → doc mapping
```

### Tokenization

- **Whitespace tokenizer** — split by spaces. Simple but fragile («hello,world» → 1 token).
- **Standard tokenizer** — language-aware (Unicode), strips punctuation.
- **Edge n-gram** — `apple` → `a`, `ap`, `app`, `appl`, `apple` (для autocomplete без trie).
- **CJK / Korean** — отдельные tokenizers (Kuromoji, Nori).

### Stemming

«running, runs, ran» → «run». Snowball, Porter stemmer.

- ✓ Better recall (find «runs» when searching «running»)
- ✗ Может дать false positives («fishing» → «fish»)

### Lemmatization

Похоже на stemming, но возвращает actual base word (using dictionary). Точнее, но медленнее.

---

## Query processing

### Boolean query

```
"brown AND fox NOT lazy"
```

- `brown` posting list = [1, 2]
- `fox` posting list = [1, 3]
- Intersection (AND): [1]
- `lazy` = [3]
- Subtract (NOT): [1] - [3] = [1]

→ Result: doc1.

### Phrase query

```
"brown fox"  (exact phrase)
```

Posting lists with **positions**:
- `brown` → [(doc1, pos=3), (doc2, pos=2)]
- `fox` → [(doc1, pos=4), (doc3, pos=3)]

Check: `brown` at pos N + `fox` at pos N+1 в same doc. Match: doc1.

### Wildcard / prefix

```
"brown*"
```

Lexicon scan для all terms starting с «brown»: `brown`, `brownie`, `browns`, ... merge все posting lists.

### Fuzzy

```
"fix~"  (edit distance 1)
```

Find terms within edit distance: `fix`, `fox`, `fit`. Union posting lists.

---

## Relevance Ranking

«Find docs matching» — easy. «Order by relevance» — сложнее. Standard algorithms:

### TF-IDF (Term Frequency – Inverse Document Frequency)

```
TF(t, d) = count(t in d) / total terms in d
IDF(t) = log(N / |{docs containing t}|)
Score(t, d) = TF(t, d) × IDF(t)
```

**Insight:** common terms (high doc frequency) → low IDF → less important. Rare terms → high IDF → boost score.

### BM25 (modern standard)

Refinement of TF-IDF с saturation function (term frequency не растёт linearly) + document length normalization.

```
BM25(t, d) = IDF(t) × [TF(t,d) × (k+1)] / [TF(t,d) + k × (1 - b + b × len(d)/avg_len)]

k ≈ 1.2-2.0 (TF saturation)
b ≈ 0.75 (length normalization)
```

→ **Default in Lucene / Elasticsearch (since 5.0)**.

### Vector search (embedding-based)

Modern alternative: encode docs and queries в **vector space**, use cosine similarity. Semantic match. См. [`modern/VECTOR_DBS_RAG.md`](VECTOR_DBS_RAG.md).

### Custom boosting

```
score = BM25_score(query, doc) × boost_factor

boost factors:
- recency: docs published recently get higher
- popularity: docs with more clicks/likes
- authority: trusted sources
- exact match in title: boost ×3
```

---

## Lucene / Elasticsearch architecture

### Segments

Lucene хранит data в **immutable segments**. New docs → new segment. Periodic merge (similar to LSM compaction).

```
Index:
  segment_1 (immutable, contains docs 1-1000, with inverted index)
  segment_2 (1001-2500)
  segment_3 (2501-3000)

Search query:
  → query all segments concurrently
  → merge results
```

### Refresh interval

New docs not searchable immediately. Default Elasticsearch: refresh every 1 second (creates new segment, opens for search).

→ **Near-real-time search**, не real-time. For critical instant visibility, can `?refresh=true` (cost: more segments).

### Sharding

Index разбит на **N shards** (default 5 in ES). Each shard — independent Lucene index. Search fan-outs к all shards, merges.

```
search "brown fox":
  → coordinator node fan-out to 5 shards
  → each shard searches locally
  → coordinator merges top-K from each
  → returns global top-K
```

### Replication

Каждый shard имеет N replicas (default 1). Read traffic load-balanced. Failover на replica при primary failure.

---

## Use cases

- **Application search** — search box в product app, knowledge base
- **Log search** (Kibana, Loki) — search миллиарды log lines
- **E-commerce search** — Amazon, eBay catalogs
- **News / content** — Twitter, Reddit search
- **Code search** — GitHub, Sourcegraph (special tokenizers для programming languages)

---

## Pitfalls

- **Index size** — inverted index часто 50-200% от raw text. Plan storage.
- **Update cost** — каждый document update создаёт new segment, eventually merged. Heavy update workload → high merge cost.
- **Hot field cardinality** — high-cardinality field как «timestamp» с millions unique values → huge index.
- **Reindex cost** — schema change (новый analyzer, новые fields) → full reindex (часы для большой системы).
- **«Aggregations» (Elasticsearch terms)** на high-cardinality — explode memory.

---

## Alternatives (по use case)

| Use case | Best tool |
|----------|----------|
| General full-text search | Elasticsearch / OpenSearch |
| Lightweight, embedded | Apache Lucene direct |
| PostgreSQL FTS extension | `tsvector` + GIN index (small-medium scale) |
| Code search (specialized) | Zoekt, hound, livegrep |
| Vector / semantic | Pinecone, Weaviate, pgvector, Elasticsearch dense_vector |
| Geo + text | Elasticsearch geo_point + match |
| Log search | Loki, ELK stack |
| Analytics + search | Apache Pinot, Druid |

---

## Real-world examples

- **GitHub** — code search через Elasticsearch (legacy), переходят на Blackbird (custom)
- **Wikipedia** — Elasticsearch (was Lucene)
- **LinkedIn** — Galene (custom search platform на Lucene)
- **Twitter** — Earlybird (custom Lucene-based)
- **Stack Overflow** — Elasticsearch
- **Shopify** — Elasticsearch для storefront search

---

## PostgreSQL FTS (small-medium scale)

```sql
ALTER TABLE articles ADD COLUMN tsv tsvector;
UPDATE articles SET tsv = to_tsvector('english', title || ' ' || body);
CREATE INDEX idx_articles_tsv ON articles USING gin(tsv);

SELECT * FROM articles
WHERE tsv @@ to_tsquery('english', 'brown & fox')
ORDER BY ts_rank(tsv, to_tsquery('english', 'brown & fox')) DESC;
```

Подходит для apps до ~ 1M-10M docs. Beyond — переход на Elasticsearch.

---

## Источники

- [Apache Lucene Documentation](https://lucene.apache.org/) — оригинальная library
- [Elasticsearch: The Definitive Guide](https://www.elastic.co/guide/en/elasticsearch/guide/current/index.html) — старая but excellent
- *Lucene in Action* (Hatcher, Gospodnetic, McCandless, 2nd ed.) — внутренности Lucene
- [Robertson et al. (1994) — BM25 paper](https://www.staff.city.ac.uk/~sb317/papers/foundations_bm25_review.pdf)
- *Information Retrieval: Implementing and Evaluating Search Engines* (Büttcher, Clarke, Cormack)
- [PostgreSQL Full-Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [Apache Lucene FST (Finite State Transducer)](https://blog.mikemccandless.com/2013/06/build-your-own-finite-state-transducer.html)
- [GitHub — Improving GitHub Code Search (Blackbird)](https://github.blog/2023-02-06-the-technology-behind-githubs-new-code-search/)
