# CRDTs (Conflict-free Replicated Data Types)

CRDT — структуры данных с математической гарантией: **merge всегда конвергирует** к одинаковому состоянию, независимо от порядка применения операций и сетевой топологии. Решают проблему multi-leader replication без central coordinator.

> **Scope**: типы CRDT, use cases. Multi-region replication overall — см. [MULTI_REGION.md](MULTI_REGION.md). Anti-entropy / vector clocks — [GOSSIP_PROTOCOL.md](GOSSIP_PROTOCOL.md), [distributed_systems.md](distributed_systems.md).

---

## Зачем нужны CRDTs

Сценарий: пользователь редактирует Google Doc одновременно с друзьями. Каждый клиент видит свою «оптимистичную» версию, изменения распространяются через сеть. Что происходит при race:

- User A: добавил «hello» в позицию 5
- User B: одновременно добавил «world» в позицию 5

Без CRDT: «winner takes all» (LWW) → теряем данные. С CRDT: оба add'а сохраняются, merge даёт `helloworld` (или naturally ordered).

**CRDT свойства (мат.):**
- **Commutative** — порядок операций не важен (`a + b = b + a`)
- **Associative** — группировка не важна (`(a + b) + c = a + (b + c)`)
- **Idempotent** — повтор операции не меняет результат

→ Любая сходящаяся (convergent) реплика приведёт к одинаковому состоянию после получения всех updates, в любом порядке.

---

## Два типа CRDT

### Op-based (Operation-based, CmRDT)

Узел шлёт **операции** другим: `add(5)`, `remove("X")`. Они должны:
- Доставляться надёжно (no loss)
- Доставляться **в causal order** (если A → B, то B применяется после A)

Дальше — все узлы применяют операции, merge тривиальный.

**Реализация:** reliable causal broadcast (vector clocks). Сложнее в transport, но **меньше bandwidth** (только операции, не state).

### State-based (CvRDT)

Узел шлёт **весь state** другим. Receiver merge'ит с локальным через идемпотентный, коммутативный, ассоциативный `merge`.

**Реализация:** просто periodic gossip + merge function. Больше bandwidth (full state), но fault-tolerant (lost messages не критичны, gossip eventually догонит).

---

## Базовые CRDT

### G-Counter (Grow-only Counter)

Counter, можно только incrementировать.

```
State: vector { node1: 5, node2: 3, node3: 2 }
Value: sum = 10

Merge: для каждого node — max(local, remote)
       { node1: max(5,4), node2: max(3,7), node3: max(2,2) } = { node1: 5, node2: 7, node3: 2 } = 14
```

**Use cases:** number of views, likes, monotonic metric.

### PN-Counter (Positive-Negative Counter)

Сумма двух G-Counter: incrementers и decrementers.

```
State: P = G-Counter (increments), N = G-Counter (decrements)
Value: sum(P) - sum(N)
```

**Use cases:** balance in a bank account (увеличение/уменьшение), inventory count.

### G-Set (Grow-only Set)

Множество, можно только добавлять.

```
State: set of elements
Merge: union of two sets
```

**Use cases:** observed events, unique visitor set (но размер растёт без bound).

### 2P-Set (Two-Phase Set)

G-Set + tombstone set. Элемент можно удалить **раз** (после удаления уже не вернуть).

```
State: { A: {x, y, z}, R: {y} }     # added, removed
Value: A - R = {x, z}

Merge: A1 ∪ A2, R1 ∪ R2
```

**Limitation:** Можно удалить только то, что добавлено. После удаления — не вернуть.

### OR-Set (Observed-Remove Set)

Каждое добавление имеет уникальный tag (`element + unique_id`). Удаляются только те tags, что наблюдались.

```
add("apple") → ("apple", uuid-1)
add("apple") (другой узел) → ("apple", uuid-2)
remove("apple") (видит только uuid-1) → tombstone uuid-1

Result: apple still present (uuid-2 не удалён)
```

→ **«Add wins» semantics:** add параллельный с remove побеждает.

**Use cases:** shopping cart items (если двое одновременно добавили — оба в корзине).

### LWW-Element-Set

Каждый элемент имеет timestamp. На merge — выбираем по latest timestamp.

```
add("X", t=10), remove("X", t=20) → X removed
add("X", t=10), remove("X", t=5)  → X present
```

**Use cases:** key-value stores где timestamp известен (Riak, Cassandra с LWW timestamp).

**Caveat:** требует синхронизированные часы → potential loss при clock skew.

### LWW-Register

Single value, replaced by latest write по timestamp.

```
write("hello", t=10) → "hello"
write("world", t=15) → "world"
write("X", t=5) → "world" (старее — игнорируется)
```

**Use cases:** profile fields (name, avatar), single-value config.

### MV-Register (Multi-Value Register)

Когда два concurrent write (на разных репликах) — хранит **обе** версии. Application resolution.

```
A: write("X")
B: write("Y") (concurrent)

read → {"X", "Y"} — пользователь выбирает
```

**Use cases:** Riak — конфликтующие версии возвращаются клиенту.

---

## Сложные CRDT

### RGA / Treedoc / WOOT — collaborative text editing

Сложные ordered sequence CRDT для редактирования text concurrent.

- **RGA** (Replicated Growable Array)
- **Treedoc** — древовидная индексация
- **WOOT** (Without Operational Transformation)
- **YATA** / **Y.js** — самая популярная современная реализация

**Use cases:** Google Docs (использует OT — Operational Transformation, alternative), Figma, Notion (CRDT-based), Linear, Trello (для частей).

**Сложности:**
- Position identifiers могут стать большими (между двумя точками — нужна позиция «между»)
- Tombstones для удалённых символов — растут без bound (нужна garbage collection)

### CRDT JSON / OR-Map

Map с CRDT-семантикой: keys могут быть added/removed (как OR-Set), values — сами CRDT.

**Use cases:** Automerge (генеральный JSON CRDT), используется в Local-first apps.

### CRDT Counter с bound

PN-Counter unbounded. Если нужен `counter <= 100` (например, ticket sales), нужны протоколы reservation:

- **Bounded counter** через escrow (каждая реплика «арендует» право увеличить на N)
- Pattern Atlassian / Salesforce CRDT works

---

## Use cases

### Real-time collaboration

- **Figma** — own CRDT for vector graphics
- **Notion / Linear / Trello** — CRDT для document state
- **Automerge / Yjs** — open source CRDT libraries (Yjs самая популярная)
- **Google Docs** — OT (Operational Transformation), не CRDT, но решает ту же проблему

### Distributed databases

- **Riak** — CRDT data types (counter, set, map, register)
- **Redis CRDT** (Enterprise) — sets, counters
- **Cassandra LWT** — не CRDT, но conditional updates
- **Antidote DB** — research DB, full CRDT

### Multi-region eventual consistency

- **Multi-master MySQL/PostgreSQL** с CRDT app-level
- **Cassandra** counter — на CRDT (PN-Counter под капотом)
- **Yandex Metrica / Google Analytics** — counters с eventual aggregation

### Offline-first apps

- **Mobile apps offline-mode** — CRDT для local edits → merge при reconnect
- **IPFS, OrbitDB** — peer-to-peer data sync
- **CouchDB / PouchDB** — replication conflicts → CRDT-like resolution

---

## Когда CRDT не подходят

CRDT — **eventual consistency**. Не подходят для:

- **Strong consistency** (financial transactions, inventory с hard limit) — нужен consensus
- **Sequential workflows** (state machines с конкретными переходами) — CRDT не enforce'ит логику
- **Атомарные multi-key operations** (transactions across keys) — CRDT обычно per-key
- **Когда conflict resolution имеет business логику** (manual review winner) — application-level merge удобнее

**Counter-example:** «У нас 100 билетов на концерт». PN-Counter с CRDT мог бы продать 110 (concurrent writes на разных нодах). Нужен escrow / consensus / sharded reservation.

---

## Trade-offs

| | CRDT | Operational Transformation (OT) | Strong Consensus (Raft/Paxos) |
|---|---|---|---|
| Convergence | Mathematically guaranteed | Algorithmic transform | Atomic |
| Network | Eventually consistent | Often central server | Round trips for commit |
| Offline | ✓ Yes | Limited | ✗ No |
| Complexity (data side) | Higher (need CRDT-aware) | Operations transform | Standard types |
| Complexity (algo side) | Moderate (per-type) | High (transform functions) | Moderate |
| Server required | No (P2P possible) | Often yes | Yes |

---

## Best practices

- **Используй existing libs** — Yjs, Automerge для общих cases. Не пиши свой OR-Set с нуля.
- **GC tombstones** — без cleanup state растёт навсегда. Trade-off: convergence guarantee vs storage.
- **Vector clocks для causality** — vital для op-based CRDT; учитывай space cost.
- **Profile real workload** — CRDT cost scales с amount of edits и tombstones.
- **Hybrid**: используй CRDT для merge logic + strong consensus для critical decisions (auth, billing).

---

## Источники

**Papers:**
- [Shapiro, Preguiça, Baquero, Zawirski (2011) — «Conflict-free Replicated Data Types» (Tech Report)](https://hal.inria.fr/inria-00555588/document) — фундаментальное определение
- [Shapiro et al. (2011) — «A comprehensive study of Convergent and Commutative Replicated Data Types»](https://hal.inria.fr/inria-00555588/)
- [Roh et al. (2011) — «Replicated Abstract Data Types: Building Blocks for Collaborative Applications»](https://www.cs.unc.edu/~prashant/CRDT-talk.pdf)

**Implementations / docs:**
- [Yjs — shared editing CRDT library](https://github.com/yjs/yjs) — JavaScript, used by Notion, Linear
- [Automerge](https://automerge.org/) — JSON-like CRDT for local-first apps
- [Riak Data Types Documentation](https://docs.riak.com/riak/kv/2.2.3/developing/data-types/) — production CRDTs
- [Redis CRDT (Enterprise)](https://redis.io/docs/latest/operate/rs/databases/active-active/)

**Engineering:**
- [Martin Kleppmann — CRDTs and the Quest for Distributed Consistency (talk)](https://www.youtube.com/watch?v=B5NULPSiOGw)
- [Local-First Software (Ink & Switch, 2019)](https://www.inkandswitch.com/local-first/) — манифест P2P + CRDT
- [Figma — How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- *Designing Data-Intensive Applications* (Kleppmann) — Ch. 5 (CRDTs briefly), Ch. 9

**Books:**
- *Distributed Systems* (van Steen, Tanenbaum, 3rd ed.) — replication models
