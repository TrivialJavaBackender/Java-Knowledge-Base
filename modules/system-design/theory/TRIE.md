# Trie (Prefix Tree)

Tree structure для prefix-based queries. Каждый node — character; path от root до node = string. Ideal для autocomplete, spell check, IP routing.

---

## Структура

```
        (root)
       /  |   \
      a   b    c
     /|   |    |
    p t   a    a
    |  \  |    |
    p   e t    r
    |   |  
    l   r
    |
    e
```

`apple`, `app`, `ate`, `bat`, `car`.

### Node

```python
class TrieNode:
    children: dict  # char → TrieNode
    is_end_of_word: bool
    metadata: any  # frequency, score, etc.
```

### Operations

```python
def insert(word):
    node = root
    for ch in word:
        if ch not in node.children:
            node.children[ch] = TrieNode()
        node = node.children[ch]
    node.is_end_of_word = True

def search(word) → bool:
    node = root
    for ch in word:
        if ch not in node.children:
            return False
        node = node.children[ch]
    return node.is_end_of_word

def starts_with(prefix) → list[str]:
    node = root
    for ch in prefix:
        if ch not in node.children:
            return []
        node = node.children[ch]
    return collect_all_words(node, prefix)
```

### Complexity

- Insert / Search: `O(L)` where L = word length
- Space: `O(N × L × alphabet_size)` worst, much less with compression

---

## Autocomplete с rankings

Real autocomplete (Google, Amazon search box) показывает **top-K most popular** suggestions, не все.

### Подход 1 — top-K per node

Каждый node хранит pre-computed top-K suggestions для своего prefix.

```python
class TrieNode:
    children: dict
    top_k: list[str]  # pre-sorted by frequency, top K
```

При query `"app"`:
- Navigate to node for "app"
- Return `node.top_k` — instant

**Trade-off:**
- ✓ O(L) query time + O(K) result return — very fast
- ✗ Memory: each node stores top-K (можно дёшево если K=10)
- ✗ Update cost: when frequency changes, may need to update top-K в multiple nodes (along path)

### Подход 2 — search-then-rank

Trie returns all suggestions, then external ranker sorts:

```python
suggestions = trie.starts_with("app")  # all
ranked = sort(suggestions, key=frequency_lookup, descending=True)[:10]
```

- ✓ Memory minimal
- ✗ Slow if many suggestions (top of search «r» — миллионы results)

### Подход 3 — combine: per-popular-prefixes

Cache top-K только для popular prefixes (first 2-3 chars). Otherwise — full search.

---

## Compressed Trie (Radix / Patricia)

**Idea:** if a node has only one child — merge them.

```
Standard:           Compressed:
   a                   a
   |                   |
   p                   pp
   |                   ↙ ↘
   p                  le er
  ↙ ↘                (apple)(apper — hypothetical)
 l   ...
 |
 e
```

- ✓ Меньше nodes — меньше memory
- ✓ Faster traversal
- ✗ Insert / delete сложнее (need split/merge)

**Use case:** IP routing tables (Linux kernel uses Patricia trie), URL routing in Web frameworks.

---

## Использования

### Search autocomplete / typeahead

Главное use case. Google search, Amazon, YouTube — все так работают.

### Spell checking

«Find words within edit distance 1 от misspelled». Trie + dynamic programming over Trie.

### IP routing (CIDR longest-prefix match)

Routing table — set of CIDR prefixes (`192.168.0.0/16`, `10.0.0.0/8`, ...). For each packet, find **longest matching prefix**.

Patricia trie по bits.

### Word search / Boggle

Find all words в grid. Trie + DFS.

### URL routing

Web framework matches `/users/:id/posts` → router uses trie (or radix trie) over path segments.

---

## Distributed autocomplete (scale)

Single-node trie:
- Memory: ~ 1 GB для 10M words
- Throughput: ~ 100K queries/sec on single core

**Scale beyond:**

### Shard by prefix

```
Shard 1: prefixes a-d
Shard 2: prefixes e-h
...
```

Router dispatches query к correct shard based on prefix.

### Replicate read-only

Trie immutable (rebuilt daily / hourly). Many read replicas, blue-green deploys.

### Hybrid: in-memory trie + Redis cache

- Hot prefixes cached in app memory
- Cold misses fetch from Redis (where full trie lives)

### Edge / CDN

Search autocomplete suggestions cached at CDN edge (TTL ~1 minute). Stale OK для typeahead.

---

## Альтернативы

### Suffix tree / suffix array

Для substring search (not just prefix). Build cost O(N), search O(M) (M = pattern length).

### DAWG (Directed Acyclic Word Graph)

Minimized trie — merges suffixes too. More compact, but harder to update.

### Inverted index (Lucene / Elasticsearch)

Сложнее, поддерживает full-text search (tokenization, stemming, scoring). Autocomplete как special case (edge-ngram tokenizer).

### Pre-computed Top-K maps

`HashMap<prefix, top_k_list>` для frequently queried prefixes (1-3 chars). Simple, works for high traffic prefixes.

### Bloom filter + DB

Bloom filter «is there any suggestion?» → if yes, lookup в Redis. Saves DB load for misses.

---

## Real-world examples

- **Google Search Autocomplete** — custom trie + ML ranking + personalization
- **Amazon Search** — trie + product category boosting
- **Twitter typeahead** — trie за Elasticsearch
- **LinkedIn typeahead** — Cleo (in-house, open-sourced)
- **Elasticsearch Completion Suggester** — FST-backed (Finite State Transducer — compressed trie variant)

---

## Implementation tips

- **Char vs unicode** — for non-ASCII (Cyrillic, emoji, CJK), Trie node children = `Map<Int, TrieNode>` (Unicode codepoints) или smaller alphabet (Unicode normalization)
- **Case-insensitive** — normalize to lowercase before insert/search
- **Stop words** — exclude «the», «a», «an» if not relevant
- **Stemming** — «running» → «run» before insert (Snowball stemmer)
- **Fuzzy search** — DFS with edit distance budget (slow for large datasets; use BK-tree or LSH instead)

---

## Performance numbers

| Operation | Latency | Memory |
|-----------|---------|--------|
| Insert 1M words | ~ 1 sec | ~ 200 MB |
| Insert 10M words | ~ 15 sec | ~ 2 GB |
| Single search (5 chars) | < 1 µs | — |
| Top-K (K=10) lookup | 1-5 µs | — |
| Throughput | 100K-1M ops/sec single core | — |

→ Single-node Trie handles millions of words easily. Sharding нужен только > 100M unique words.

---

## Источники

- *Introduction to Algorithms* (CLRS) — basic trie chapter
- [Algorithms textbook (Sedgewick, Wayne) — Tries section](https://algs4.cs.princeton.edu/52trie/)
- [LinkedIn Cleo open source typeahead engine](https://github.com/linkedin/cleo)
- [Elasticsearch Completion Suggester](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-suggesters.html#completion-suggester)
- [Lucene FST (Finite State Transducer)](https://lucene.apache.org/core/9_8_0/core/org/apache/lucene/util/fst/package-summary.html)
- [Patricia Trie / Radix Tree (Wikipedia)](https://en.wikipedia.org/wiki/Radix_tree)
- *Algorithms on Strings, Trees, and Sequences* (Dan Gusfield) — academic deep dive
