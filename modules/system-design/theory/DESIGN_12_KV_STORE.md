# Design Problem: Distributed Key-Value Store (Dynamo-style)

Distributed KV store — DynamoDB, Cassandra, Riak. Главные components: consistent hashing, replication, quorum, eventual consistency, anti-entropy.

---

## 1. Requirements

### Functional
- PUT key value
- GET key
- DELETE key
- Range queries? Usually not (NoSQL pure KV).
- TTL?

### Non-functional
- **Scalable** — add nodes, capacity grows
- **Available** — tolerate node failures (AP в CAP)
- **Low latency** — p99 < 10 ms reads
- **Eventually consistent** OK
- **Durable** — survive disk failure, region outage

---

## 2. Estimation

```
1B items, avg 1 KB each = 1 TB
Peak: 100K reads/sec, 10K writes/sec
RF = 3 → 3 TB total replicated storage
~ 10-20 nodes, 200 GB each
```

---

## 3. Architecture

Dynamo-style: **no leader, all nodes peers**.

```
Client (smart client с topology)
  ↓
Coordinator (any node) →
Replicas for key:
  Node A (replica 1)
  Node B (replica 2)
  Node C (replica 3)

Gossip protocol для cluster membership
```

---

## 4. Consistent Hashing

```
Ring of hash values [0, 2^64)
Each node owns multiple **virtual nodes** (vnodes) — 100-200 per physical node

PUT(key, value):
  partition_key = hash(key)
  replicas = next N nodes on ring clockwise from partition_key
  send write to all N replicas
```

См. [`SHARDING.md` (databases)](../../databases/theory/SHARDING.md#consistent-hashing) для детали.

Adding/removing node перемещает только `1/N` ключей.

---

## 5. Replication

**N replicas** per key — adjacent nodes on ring.

```
N = 3 typically
Replicas chosen: next 3 unique physical nodes after partition_key
```

### Sloppy quorum

При недоступности replica — write принимается на «соседнюю» node с hint. Когда replica оживает — handoff (hinted handoff).

```
If primary replica down:
  Coordinator picks next available node
  Tags write with hint: "this should go to original replica X"
  When X recovers: receives all pending hinted writes
```

---

## 6. Quorum read / write (R + W > N)

```
N = 3, W = 2, R = 2 → strong consistency
  PUT waits for 2 of 3 replicas to ack
  GET reads 2 of 3, picks newer (by timestamp)
  Both touch ≥ 1 common replica → read sees latest write

N = 3, W = 1, R = 1 → eventual consistency, low latency, high availability
  Each op talks to single replica
  May read stale data
```

Tunable per operation — applications choose strict (financial) vs lenient (cache-like).

---

## 7. Read repair

Когда GET returns conflicting versions (different replicas had different):

```
GET key →
  replica A: value=X, timestamp=t1
  replica B: value=Y, timestamp=t2 > t1
  replica C: value=X, timestamp=t1

Coordinator returns Y (latest).
**Read repair:** in background, update A and C к Y.
```

Ensures eventual convergence без separate anti-entropy.

---

## 8. Anti-Entropy (Merkle Trees)

Periodic background sync between replicas. Detect divergence efficiently.

См. [`MERKLE_TREE.md`](MERKLE_TREE.md) и [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md#anti-entropy--merkle-trees) для деталей.

```
Each replica builds Merkle tree of its data:
  Compare root hashes between replicas.
  Differ → descend tree, find differing branches.
  Sync only those.
```

Cassandra `nodetool repair` runs this.

---

## 9. Conflict resolution

Concurrent writes → conflicts. Approaches:

### Last-Write-Wins (LWW) — Cassandra default

Timestamp on each write. Latest wins.

- ✓ Simple
- ✗ Clock skew → silent data loss
- ✗ Concurrent updates lose

### Vector Clocks (Riak, original Dynamo)

Каждая версия имеет vector clock. Conflicting versions returned to app — app resolves.

- ✓ No data loss
- ✗ Complex для app
- См. [`distributed_systems.md`](distributed_systems.md#lamport-timestamps--vector-clocks)

### CRDTs

См. [`CRDT.md`](CRDT.md). Math-guaranteed merge. Riak supports CRDT data types.

---

## 10. Gossip Protocol

Cluster membership без central coordinator. См. [`GOSSIP_PROTOCOL.md`](GOSSIP_PROTOCOL.md).

```
Each node periodically (every 1 sec):
  Pick random peer
  Exchange cluster state: who's alive, version of schema, token ownership
  Eventually all nodes converge

Failure detection: phi accrual detector (suspicion accumulates over missed heartbeats)
```

---

## 11. Data Model

### Pure KV

```
PUT key value [TTL]
GET key → value
DELETE key
```

### Wide-Column (Cassandra, HBase)

Allows columns within row, time-series queries:

```
PUT key column1 value1 [TS1]
PUT key column2 value2 [TS2]
GET key column1
GET key columns BETWEEN c1 AND c5
```

Useful when rows have many timestamped values (e.g., user_id → metric_name → time-series).

---

## 12. Storage engine

Many Dynamo-style use **LSM-tree** для write-heavy workload.

См. [`databases/STORAGE_ENGINES.md`](../../databases/theory/STORAGE_ENGINES.md#lsm-tree-storage-engines).

- Memtable + SSTable
- Compaction strategies (LCS, STCS, TWCS)
- Bloom filter per SSTable

---

## 13. Failure modes

| Scenario | Handling |
|----------|----------|
| Node crash | Replicas serve; hinted handoff replays on recovery |
| Network partition | Sloppy quorum continues if R/W achievable; eventual convergence |
| Full data center outage | Replicas in other DC serve (multi-DC replication) |
| Permanent node loss | Stream data к replacement node from other replicas |
| Conflict during partition | CRDT auto-resolve, or app reads multiple versions, picks |

---

## 14. Tunable Consistency

```
Cassandra Consistency Levels:
  ANY: write accepted by any node (or hinted)
  ONE: 1 replica acks
  QUORUM: majority (e.g., 2 of 3)
  ALL: all replicas

Pattern:
  CL_READ + CL_WRITE > RF → strong consistency
  Lower CL → higher availability, lower latency, potentially stale data
```

---

## 15. Multi-DC

Replication к remote DC asynchronously. См. [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md#multi-leader-replication).

```
Local DC: RF=3 strong reads/writes
Remote DC: RF=3, async replicate
Read locality: prefer local replicas
Cross-DC reads (consistency check): when needed
```

---

## 16. Trade-offs

### Strong vs Eventual

- **Strong (R+W>N)** — slower, less available при failures
- **Eventual** — faster, available, may see stale

Per operation choice in Cassandra: «session reads с strong, analytics OK with weak».

### Latency vs durability

- Sync replication to N replicas — slow but durable
- Async — fast но возможна потеря на failover

### Wide-column vs pure KV

- Wide-column adds query expressiveness
- Pure KV simpler, faster

---

## 17. Real-world

- **Amazon DynamoDB** — managed, evolved from original Dynamo paper
- **Apache Cassandra** — open source Dynamo + LSM + wide-column
- **ScyllaDB** — Cassandra-compatible, C++ rewrite, faster
- **Riak** (deprecated) — true Dynamo с CRDT
- **etcd / Consul** — different style (Raft, strong consistency)

---

## Источники

- [DeCandia et al. (2007) — «Dynamo: Amazon's Highly Available Key-value Store»](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — must-read
- *System Design Interview Vol. 1* (Alex Xu) — Ch. 6 «Design a Key-Value Store»
- *Designing Data-Intensive Applications* (Kleppmann) — Ch. 5, 6, 9
- [Cassandra Documentation — Architecture](https://cassandra.apache.org/doc/latest/cassandra/architecture/index.html)
- [Discord — Trillions of Messages with ScyllaDB](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- См. [`databases/`](../../databases/) — Replication, Sharding, Storage Engines
