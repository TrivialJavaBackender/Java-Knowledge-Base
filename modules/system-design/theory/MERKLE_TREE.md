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

`Root` зависит от **всех** значений листьев. Изменение любого `a/b/c/d` → меняется его hash → меняется hash родительского → ... → меняется root.

**Свойство:** сравнение двух Merkle trees:
- Одинаковый корень → датасеты идентичны
- Разные корни → есть различия. Спускаемся по дереву, находя расходящуюся ветвь.

→ **O(log N)** сравнений вместо O(N) для полного diff.

---

## Anti-entropy (фоновая синхронизация)

Распределённые системы периодически синхронизируют реплики. Наивный подход: отправить все данные → дорого. С Merkle tree:

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

Итого байт ≈ пропорционально **количеству различий**, а не общему размеру датасета.

### Пример: Cassandra

`nodetool repair` строит Merkle trees на партиции, синхронизируется с репликами. Cassandra использует 32-bit hash range = 2^32 = 4 B possible values; tree depth ~ 15 (configurable).

### Riak

Активная anti-entropy через Merkle trees. Непрерывная фоновая синхронизация.

### DynamoDB / Amazon Dynamo

Оригинальная статья упоминает Merkle trees для синхронизации реплик.

---

## Сценарии

### Распределённые системы

- **Cassandra repair** — anti-entropy
- **DynamoDB** — синхронизация реплик
- **Riak** — активная anti-entropy

### Blockchain

- **Bitcoin / Ethereum** — заголовок блока содержит Merkle root всех транзакций в блоке. SPV-клиенты верифицируют «транзакция X в блоке Y» через Merkle proof (`O(log N)` размер доказательства).

### Git

- **Git** хранит деревья (директории) с хэшами файлов. Коммит = корневой хэш. Diff при pull/push вычисляется на дереве хэшей.

### IPFS

- **Content-addressable storage** — хэш файла = его адрес. Директория с хэшами дочерних элементов = Merkle tree.

### Certificate Transparency

- **Google CT logs** хранят сертификаты в Merkle tree. Возможен аудит — «сертификат X был включён в лог?»

---

## Доказательство Merkle (Merkle proof)

«Доказать, что элемент X — часть датасета с известным корнем», не отправляя весь датасет.

```
Доказать X (= 'c'):
- Send: data='c', hash H4, hash H12
- Verifier computes:
  H3' = hash('c')
  H34' = hash(H3' + H4)
  Root' = hash(H12 + H34')
- Compare Root' к known Root: match → proof valid
```

Размер доказательства: `O(log N)` — высота дерева.

### Сценарии применения

- **Light clients (SPV)** в Bitcoin — верификация транзакций без загрузки всей цепи
- **Audit logs** — доказательство существования конкретной записи
- **State proofs** — Ethereum light clients верифицируют состояние без полной синхронизации

---

## Стоимость построения

Построение Merkle tree:
- Хэшируем все N листьев: O(N)
- Хэшируем внутренние узлы: O(N/2 + N/4 + ... + 1) = O(N)
- Итого: **O(N)** для построения, **O(log N)** для запроса/доказательства

Хранение: 2N − 1 узлов (полное бинарное дерево), но для доказательства нужна только **логарифмическая** часть.

---

## Стоимость обновления

Вставка / обновление одного листа:
- Пересчёт хэшей по пути к корню: **O(log N)**

Обновления дёшевы, поэтому Merkle tree подходит для динамических датасетов.

---

## Варианты

### Sparse Merkle Tree

Дерево большого фиксированного размера (например, 2^256 листьев). Большинство листьев пустые (`hash("")`). Используется в Ethereum 2.0 для состояния аккаунтов.

### Patricia Merkle Trie

Сочетает Patricia trie (radix tree) с Merkle hashing. Ethereum использует для деревьев состояния, транзакций и квитанций.

### Verkle Tree

Замена Merkle Patricia trie в будущих версиях Ethereum. Векторные обязательства → значительно меньший размер доказательств.

---

## Подводные камни

- **Pre-image attack** — если хэш-функция сломана (MD5, SHA-1), целостность дерева нарушена. Используйте SHA-256 или более стойкий алгоритм.
- **Глубина дерева** — слишком глубокое → медленные обновления. Широкие деревья (больше дочерних узлов) уменьшают глубину, но увеличивают стоимость обновления.
- **Параллельные обновления** — наивное Merkle tree не поддерживает параллельное обновление (изменения корня сериализуются). Riak и Cassandra реализуют lock-free варианты.

---

## Числа из продакшена

- **Cassandra:** Merkle trees на каждую партицию в ходе repair, глубина 15
- **Git:** SHA-1 (legacy) → переходит на SHA-256
- **Bitcoin:** SHA-256 hashes, глубина ~ 20–30 в типичном блоке
- **Ethereum state trie:** keccak-256, Patricia Merkle Trie, глубина может достигать 64+

---

## Источники

- [Merkle (1979) — «A Certified Digital Signature»](https://www.merkle.com/papers/Certified1979.pdf) — оригинал
- [Bitcoin whitepaper (Nakamoto, 2008)](https://bitcoin.org/bitcoin.pdf) — Merkle root в block header
- [Ethereum Yellow Paper](https://ethereum.github.io/yellowpaper/paper.pdf) — Patricia Merkle Trie
- [Cassandra — Anti-entropy repair](https://cassandra.apache.org/doc/latest/cassandra/operating/repair.html)
- [Riak — Active Anti-Entropy](https://docs.riak.com/riak/kv/latest/learn/concepts/active-anti-entropy/)
- [Google Certificate Transparency](https://certificate.transparency.dev/)
- [Verkle Tree — Vitalik's blog](https://vitalik.ca/general/2021/06/18/verkle.html)
