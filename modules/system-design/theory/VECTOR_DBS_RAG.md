# Vector Databases и RAG

Vector databases — store + search embeddings (high-dimensional vectors representing semantic content). Foundation для RAG (Retrieval-Augmented Generation) систем с LLM. Тема critical для AI-heavy компаний на интервью 2024-2026.

> **Scope**: vector storage, ANN algorithms, RAG architecture. ML serving overall — [`ML_SERVING.md`](ML_SERVING.md). Traditional inverted index — [`INVERTED_INDEX.md`](INVERTED_INDEX.md).

---

## Что такое embeddings

Текст (изображение, audio) → fixed-length vector высокой размерности (768, 1536, ...).

```
"cat" → [0.23, -0.45, 0.81, ...]  (1536 dimensions)
"dog" → [0.21, -0.43, 0.79, ...]  (close to "cat")
"car" → [0.92, 0.13, -0.55, ...]  (far)
```

**Свойство:** semantic similarity → vector distance closer.

`distance(cat, dog) < distance(cat, car)` — embedding model «понимает», что cat и dog ближе по смыслу.

### Embedding models

- **OpenAI** — `text-embedding-3-small` / `-large` (1536 / 3072 dim)
- **Cohere** — `embed-v3` (1024 dim)
- **Sentence-Transformers** (open source) — many variants, 384-768 dim
- **BERT / RoBERTa** — older но still used
- **CLIP** — multimodal (text + image)

Output: каждый text → vector. Same vector dim across all your data.

---

## Vector search problem

«Найди top-K closest vectors к query vector».

```
Naive: distance(query, doc_i) for all i, sort, return top K
Cost: O(N × d), N = total docs (millions), d = dimensions (1536)
→ Slow for large N
```

**Solution:** **Approximate Nearest Neighbor (ANN)** algorithms. Trade slight accuracy for huge speedup (10-1000×).

### Distance metrics

- **Cosine similarity** — angle between vectors, ignores magnitude. Most common для text.
- **Euclidean (L2)** — straight-line distance
- **Dot product** — when magnitudes matter
- **Manhattan (L1)** — taxicab distance

Большинство embedding models trained для cosine similarity.

---

## ANN Algorithms

### HNSW (Hierarchical Navigable Small World)

State-of-art. Multi-layer graph: каждый уровень — sparser subset of points, edges connect nearby. Search descends levels, finds approximate nearest.

```
Top layer:    a few "highway" points
Mid layers:   denser
Bottom layer: all points

Search: start top, navigate towards query, descend, refine
```

- ✓ High recall (95-99%)
- ✓ Fast query (~ 1-10 ms на 1M+ vectors)
- ✗ Memory-intensive (graph stored in RAM)
- ✗ Slow insertions / deletes

**Реализации:** FAISS HNSW, hnswlib, Weaviate, Pinecone, Qdrant.

### IVF (Inverted File Index)

Cluster vectors via k-means → k clusters. At query: find nearest clusters, search only there.

- ✓ Меньше memory
- ✓ Faster build than HNSW
- ✗ Lower recall — query может miss cluster boundary
- ✗ Cluster count tuning

### PQ (Product Quantization)

Compress vectors: split в subvectors, quantize каждый. Approximate distances быстро (lookup table).

- ✓ Очень compact (32× smaller)
- ✓ Fast distance (table lookups)
- ✗ Lower precision

**IVF-PQ** — combine: clustering + compression. Used в FAISS.

### LSH (Locality-Sensitive Hashing)

Hash similar vectors к same bucket. Older approach, replaced by HNSW.

---

## Vector Database vs Library

**Library** (FAISS, Annoy, hnswlib) — embedded, no server. Build index, query in same process. Не handles updates, replication, persistence.

**Database** (Pinecone, Weaviate, Qdrant, Milvus, pgvector):
- Server with HTTP/gRPC API
- Persistence
- Updates / deletes
- Replication, sharding (some)
- Hybrid search (vector + filter)
- Multi-tenancy

### Реализации (2024-2026)

| | Type | Notes |
|---|---|---|
| **Pinecone** | Managed cloud | First mover, simple API, pay-per-query |
| **Weaviate** | Open source + cloud | GraphQL API, hybrid (vector + keyword) |
| **Qdrant** | Open source + cloud | Rust-based, performant |
| **Milvus** | Open source | Largest scale, китайский origin (Zilliz) |
| **pgvector** | PostgreSQL extension | Integration с existing PG, HNSW support |
| **Elasticsearch dense_vector** | Существующий ES | Hybrid search nice |
| **Chroma** | Open source | LLM-focused, embeds documents |
| **Vespa** | Yahoo open source | Multi-modal (vector + text + structured) |
| **FAISS** | Library (Facebook) | Embed, no server |

**pgvector special:** PostgreSQL extension. Если у тебя уже Postgres + < 10M vectors — adds vector search without new infra. HNSW support since pgvector 0.5.

---

## Hybrid Search

Modern need: **vector** + **keyword** + **metadata filter** combined.

Example query: «recent articles about RAG (vector match), in English (filter), from credible sources (filter)»

```
GET /search {
  vector: [0.23, ...] (semantic query),
  query: "retrieval augmented generation",
  filter: { language: "en", source_quality: { gt: 0.7 }, date: { gt: "2024-01-01" } },
  k: 10
}
```

**Реализации:**
- **Weaviate** — first class hybrid
- **Elasticsearch dense_vector + filter**
- **Vespa** — sophisticated multi-modal
- **Pinecone** — metadata filters

---

## RAG (Retrieval-Augmented Generation)

Pattern: LLM ответ дополняется retrieved documents (external knowledge).

```
User: "What is HNSW?"
  ↓
[Embed query] → vector
  ↓
[Vector DB search] → top-K relevant chunks
  ↓
[Build prompt with chunks]
  ↓
[LLM generates answer using chunks as context]
  ↓
Return answer (+ citations to source chunks)
```

### Why RAG?

LLM (GPT-4, Claude) обучены до cutoff date, не знают proprietary data, могут hallucinate. RAG **grounds** ответ в reliable source.

### Architecture

```
1. Ingestion pipeline:
   Documents (PDF, web pages, internal wiki) → 
   chunking (split into 500-1000 token pieces) →
   embeddings (per chunk) →
   vector DB

2. Query pipeline:
   User query → embed → vector search →
   top-K chunks → 
   prompt template: "Answer using these documents: {chunks}\nQuestion: {query}" →
   LLM call →
   parse response, include citations
```

### Chunking strategies

- **Fixed-size** — 500 tokens, простой
- **Sentence-aware** — split on sentences (NLTK, spaCy)
- **Semantic** — chunks based на content similarity (more complex)
- **Hierarchical** — small chunks для precision + parent context

**Trade-off:** small chunks — точнее retrieval, но мало context. Large chunks — больше context, но noise.

**Overlapping chunks** — 20-50% overlap, чтобы не разрывать concepts на boundary.

### Re-ranking

Vector search returns top-K кандидатов (например, 100). Re-ranker (cross-encoder model) re-scores чтобы выбрать top-10.

- **Cohere Rerank API**
- **Custom cross-encoder** (BERT-based)
- **Reciprocal Rank Fusion** — combine multiple search methods

Improves precision значительно (often +20% relevance).

### Hybrid RAG

- **Dense + sparse** — vector + BM25 (keyword) combined
- **Multi-vector per chunk** — multiple representations (Q&A pairs, summaries)
- **Knowledge graph + vector** — entity linking + semantic search
- **Multi-hop retrieval** — iterative search (use first results to refine query)

---

## Production challenges

### Ingestion scale

Re-embedding всех documents при изменении embedding model — expensive.

```
1M documents × 1K tokens × $0.0001 (embedding cost) = $100
1B documents = $100K
```

Strategy: embed только new + changed; periodically full re-embed при major model change.

### Update freshness

User uploads document → expected searchable immediately. Vector DB должен support fast inserts.

### Cost

- **Storage:** 1M vectors × 1536 dim × 4 bytes = 6 GB per copy
- **Query cost:** Pinecone ~ $0.0001 / query (10M queries = $1000)
- **LLM call cost:** GPT-4o-mini ~ $0.00015 / 1K input tokens; RAG prompt 2K input → $0.0003 / query

### Evaluation

«Is my RAG good?» — hard:
- **Recall** — relevant docs retrieved? Need ground truth.
- **Precision** — top results actually relevant?
- **Answer quality** — LLM uses chunks well?
- **Latency, cost** — operational

**Tools:** Ragas, TruLens, custom LLM-as-judge.

### Hallucinations

LLM might still invent facts если chunks don't have answer. Mitigation:
- Strict prompt («only answer using provided chunks»)
- Confidence scoring
- Citation enforcement (each claim must have source)

---

## Latency budget RAG

```
Query embed: 50-100 ms (OpenAI API)
Vector search: 10-50 ms (HNSW)
Re-rank (optional): 100-300 ms
LLM call: 500-3000 ms (depends on model + output length)

Total: 1-3 seconds typical, < 1 sec achievable with smaller LLMs
```

**Streaming response** — start showing generated tokens as LLM produces them, perceived latency much lower.

---

## Use cases

- **Customer support chatbot** — answer from product docs
- **Internal knowledge search** (Glean, Slack AI) — wiki / chat history
- **Legal research** — case law retrieval
- **Code search + generation** (Cursor, GitHub Copilot Chat) — RAG over codebase
- **Medical research** — papers / protocols
- **Education** — tutor with curated content

---

## Антипаттерны

- **Vector DB для structured queries** — `WHERE price < 100` не нужна vector. Use SQL.
- **Embedding всё** — short texts (titles only) — bad embedding quality
- **Without chunking** — large docs, retrieval returns whole doc (too much context)
- **Без metadata filtering** — pure vector search возвращает irrelevant (wrong language, old date)
- **Re-embedding всего при каждом model change** — cost. Plan migrations.
- **Single retrieval** для сложных queries — multi-hop / decomposed retrieval better

---

## Источники

**Papers:**
- [Malkov, Yashunin (2018) — «Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs» (HNSW)](https://arxiv.org/abs/1603.09320)
- [Lewis et al. (2020) — «Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks»](https://arxiv.org/abs/2005.11401) — оригинал RAG
- [Karpukhin et al. (2020) — «Dense Passage Retrieval for Open-Domain Question Answering»](https://arxiv.org/abs/2004.04906)

**Tools / docs:**
- [Pinecone Documentation](https://docs.pinecone.io/)
- [Weaviate Docs](https://weaviate.io/developers/weaviate)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [FAISS Wiki](https://github.com/facebookresearch/faiss/wiki)
- [LangChain Documentation](https://python.langchain.com/) — RAG framework

**Engineering blogs:**
- [Pinecone Learning Center](https://www.pinecone.io/learn/)
- [Anthropic — Building effective agents (2024)](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI Cookbook — Embeddings, RAG examples](https://cookbook.openai.com/)
- [Cohere — Rerank Documentation](https://docs.cohere.com/docs/rerank-overview)

**Books:**
- *Building LLM Applications for Production* (Chip Huyen, in progress) — RAG, vector search
- [Hands-On Generative AI with Transformers and Diffusion Models (2024)](https://www.oreilly.com/) — chapter on RAG
