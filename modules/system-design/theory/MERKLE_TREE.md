# Merkle tree

Дерево хэшей: каждый внутренний узел — хэш детей. Корневой хэш = компактный отпечаток всего датасета. Используется для эффективного **сравнения** двух датасетов.

---

## Структура

```
                Root: hash(H12 + H34)
               /                       \
          H12: hash(H1 + H2)         H34: hash(H3 + H4)
         /          \                 /          \
    H1: hash(a)   H2: hash(b)   H3: hash(c)   H4: hash(d)
       |            |              |              |
      Data: a       Data: b       Data: c       Data: d
```

`Root` зависит от **всех** leaf values. Изменение любого `a/b/c/d` → меняется его hash → меняется hash родительского → ... → меняется root.

**Свойство:** comparison двух Merkle trees:
- Same root → datasets identical
- Different root → есть differences. Descend tree, finding which branch differs.

→ **O(log N)** comparisons вместо O(N) для full diff.

---

## Anti-entropy (фоновая синхронизация)

Distributed system periodically synchronize replicas. Naive: send all data → expensive. С Merkle tree:

```
Node A and Node B want to sync:

1. Both compute Merkle tree of their state
2. A → B: «Here is my root hash»
3. B compares к своему root:
   if same → done, identical
   if differ → 
     B → A: «Send me your children hashes»
     A → B: H12, H34
     B compares to its H12, H34
     For mismatching branch — descend recursively
4. Найти конкретные differing leaves → exchange those data items
```

Total bytes sent ≈ proportional к **number of differences**, not total dataset size.

### Cassandra example

`nodetool repair` строит Merkle trees на партиции, sync с replicas. Cassandra использует 32-bit hash range = 2^32 = 4 B possible values; tree depth ~ 15 (configurable).

### Riak

Active anti-entropy через Merkle trees. Continuous background sync.

### DynamoDB / Amazon Dynamo

Original paper упоминает Merkle trees для replica synchronization.

---

## Сценарии

### Distributed Systems

- **Cassandra repair** — anti-entropy
- **DynamoDB** — replica sync
- **Riak** — active anti-entropy

### Blockchain

- **Bitcoin / Ethereum** — block header содержит Merkle root всех transactions в блоке. SPV clients verify «transaction X in block Y» через Merkle proof (`O(log N)` proof size).

### Git

- **Git** хранит trees (directories) с hashes файлов. Commit = root hash. Pull/push diff делается на дереве хэшей.

### IPFS

- **Content-addressable storage** — hash файла = его address. Directory с hashes children = Merkle tree.

### Certificate Transparency

- **Google CT logs** хранят certificates в Merkle tree. Audit possible — «сертификат X был logged?»

---

## Доказательство Merkle (Merkle proof)

«Доказать, что элемент X — часть dataset с известным root», не отправляя весь dataset.

```
Доказать X (= 'c'):
- Send: data='c', hash H4, hash H12
- Verifier computes:
  H3' = hash('c')
  H34' = hash(H3' + H4)
  Root' = hash(H12 + H34')
- Compare Root' к known Root: match → proof valid
```

Size of proof: `O(log N)` — height of tree.

### Use case

- **Light clients (SPV)** in Bitcoin — verify transactions without downloading whole chain
- **Audit logs** — prove specific record exists
- **State proofs** — Ethereum light clients verify state без full sync

---

## Стоимость построения

Building Merkle tree:
- Hash all N leaves: O(N)
- Hash internal nodes: O(N/2 + N/4 + ... + 1) = O(N)
- Total: **O(N)** for build, **O(log N)** for query/proof

Storage: 2N − 1 nodes (full binary tree), but only **logarithmic** part needed for proof.

---

## Стоимость обновления

Insert / update one leaf:
- Recompute hashes along path к root: **O(log N)**

Updates are cheap, hence Merkle tree works for dynamic datasets.

---

## Варианты

### Sparse Merkle Tree

Tree большого fixed size (e.g., 2^256 leaves). Большинство leaves empty (`hash("")`). Used in Ethereum 2.0 for account state.

### Patricia Merkle Trie

Combines Patricia trie (radix tree) с Merkle hashing. Ethereum uses for state, transaction, receipt tries.

### Verkle Tree

Replacement for Merkle Patricia trie in Ethereum future. Vector commitments → much smaller proofs.

---

## Подводные камни

- **Pre-image attack** — if hash function broken (MD5, SHA-1), tree integrity compromised. Use SHA-256 or stronger.
- **Tree depth** — too deep → slow updates. Wide trees (more children per node) reduce depth but increase update cost.
- **Concurrent updates** — naive Merkle tree can't be concurrently updated (root changes serialize). Riak, Cassandra implement lock-free variants.

---

## Числа из продакшена

- **Cassandra:** Merkle trees per partition during repair, depth 15
- **Git:** SHA-1 (legacy) → moving to SHA-256
- **Bitcoin:** SHA-256 hashes, depth ~ 20-30 в a typical block
- **Ethereum state trie:** keccak-256, Patricia Merkle Trie, can reach depth 64+

---

## Источники

- [Merkle (1979) — «A Certified Digital Signature»](https://www.merkle.com/papers/Certified1979.pdf) — оригинал
- [Bitcoin whitepaper (Nakamoto, 2008)](https://bitcoin.org/bitcoin.pdf) — Merkle root в block header
- [Ethereum Yellow Paper](https://ethereum.github.io/yellowpaper/paper.pdf) — Patricia Merkle Trie
- [Cassandra — Anti-entropy repair](https://cassandra.apache.org/doc/latest/cassandra/operating/repair.html)
- [Riak — Active Anti-Entropy](https://docs.riak.com/riak/kv/latest/learn/concepts/active-anti-entropy/)
- [Google Certificate Transparency](https://certificate.transparency.dev/)
- [Verkle Tree — Vitalik's blog](https://vitalik.ca/general/2021/06/18/verkle.html)
