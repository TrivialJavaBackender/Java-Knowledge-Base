# Gossip Protocol

Gossip (или epidemic protocol) — способ распространения информации в кластере через случайный обмен между узлами. Каждый узел периодически выбирает случайных «соседей» и обменивается state.

---

## Идея

Аналог сплетен в толпе: «слух» расходится экспоненциально. Каждый раунд узел знает информацию → следующий раунд знают ещё N (с peers он gossip'нул).

```
Round 0: 1 node knows
Round 1: 2 nodes know (each gossiped to 1 peer)
Round 2: 4
Round 3: 8
...
Round log(N): all N nodes know
```

→ `O(log N)` раундов до полного распространения.

**Свойства:**
- **Decentralized** — нет central coordinator
- **Robust** — потеря отдельных сообщений не критична (избыточные пути)
- **Scalable** — каждый узел общается с константным числом peers, не со всеми
- **Eventually consistent** — все узлы сойдутся к консистентному состоянию

---

## Виды gossip

### Push gossip

Узел шлёт **свою** информацию peer'ам. Peer обновляет свою копию если новее.

```
Node A: «my view: { N1: state_v1, N2: state_v2 }» → send to random peer
Peer B: merge with own view, take newer
```

### Pull gossip

Узел запрашивает у peers их state.

```
Node A: «give me your state» → peer
Peer: «here is my view»
A: merge
```

### Push-Pull (hybrid)

Обмен в обе стороны — A шлёт своё, B шлёт своё, оба merge. Эффективнее (один RT для bilateral update).

---

## SWIM (Scalable Weakly-consistent Infection-style Process Group Membership)

Конкретный gossip-based failure detection protocol (Das et al., 2002). Используется в Hashicorp Memberlist (Serf, Consul).

```
Periodically (каждые ~1 секунду), узел A:
  1. Pick random peer B
  2. Send ping(A, B)
  3. If B responds — alive ✓
  4. If B doesn't respond:
     - Ask K other random peers to ping B (indirect ping)
     - If any of them confirms B alive — false alarm
     - If all fail → mark B as suspect, propagate via gossip
  5. After grace period — confirm B dead, gossip "dead" event
```

**Advantages over heartbeat-everyone:**
- Constant network traffic per node (O(1)), not O(N²)
- Tolerates short network glitches (indirect ping confirmation)
- Spread of failure info — O(log N) rounds

---

## Anti-entropy

Periodic background process: каждый узел синхронизируется с random peer на **bulk state** (не только incremental update). Гарантирует convergence даже при потерянных messages.

```
Every 10 min:
  A picks random peer B
  Both compute Merkle tree of their state
  Compare roots → if differ, descend tree, find divergent ranges, sync
```

См. [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md#anti-entropy--merkle-trees) — anti-entropy в Cassandra, Riak.

---

## Use cases

### Apache Cassandra — cluster state propagation

Каждый Cassandra node gossip каждую секунду с 1-3 peers:
- Heartbeat (alive)
- Cluster membership changes (new nodes, leaving)
- Schema versions
- Token range ownership

→ После несколько секунд **весь кластер знает**, что один узел присоединился. Без central coordinator.

```
[Node A] ←→ [Node B]           ←→ [Node C]
   ↑           ↑                       ↓
[Node D] ←→ [Node E] ←→ [Node F] ←→ [Node G]
              gossip каждую секунду
```

### Hashicorp Consul / Serf

Memberlist (SWIM-based) для service discovery, failure detection. Каждый Consul agent gossip с другими.

### Riak

Gossip для cluster membership, ring state propagation.

### Amazon Dynamo (оригинал)

Gossip для membership и failure detection. Каждый узел знает «о всех» через eventual gossip propagation.

### Akka Cluster

Gossip-based cluster в Akka. Используется в Lagom, Play framework для distributed coordination.

### Apache Storm — Nimbus / Supervisor

Gossip для координации.

---

## Trade-offs

| | Pros | Cons |
|---|---|---|
| **Bandwidth** | Constant per node (~constant epochs × small state) | Не экономно для small clusters (better to broadcast) |
| **Latency** | O(log N) для propagation | Не instant — может быть seconds before all aware |
| **Consistency** | Eventually consistent | Не подходит для linearizable operations |
| **Robustness** | Resilient to single failures | Adversarial environment (Byzantine) → нужны другие подходы |
| **Complexity** | Простой в реализации | Сложный в reasoning о консистентности |

---

## Gossip vs Consensus

| | Gossip | Consensus (Raft/Paxos) |
|---|---|---|
| Consistency | Eventually | Strong (linearizable) |
| Latency | Seconds (rounds) | Milliseconds (single RT) |
| Use case | Cluster state, failure detection, anti-entropy | Critical operations (config change, leader election) |
| Decentralized? | Fully | Leader-based |
| Bandwidth | Low (constant per node) | Higher (broadcast to majority) |

**Pattern:** gossip для **diffuse information** (cluster membership, metrics), consensus для **critical decisions** (who is leader, what is the committed value).

Cassandra пример:
- Gossip: cluster membership, schema versions
- Paxos LWT: linearizable writes для conditional updates (compare-and-set)

---

## Tuning

- **Gossip interval** — обычно 1 сек. Tradeoff: shorter = faster propagation + more bandwidth.
- **Fanout** (peers per round) — 2-3. Higher = faster but more bandwidth.
- **Anti-entropy interval** — 10 мин - часы. Долгий — больше divergence; короткий — больше CPU/IO.

---

## Cтилизованный псевдокод

```python
import random

class GossipNode:
    def __init__(self, id, peers):
        self.id = id
        self.peers = peers  # list of all known peers
        self.state = {}  # local view
    
    def update_local(self, key, value, version):
        self.state[key] = (value, version)
    
    def gossip_round(self):
        # Pick random peer
        peer = random.choice(self.peers)
        # Push our state
        peer.receive(self.state)
        # Pull theirs
        peer_state = peer.send_state()
        self.merge(peer_state)
    
    def merge(self, other):
        for key, (value, ver) in other.items():
            if key not in self.state or self.state[key][1] < ver:
                self.state[key] = (value, ver)
    
    def run(self):
        while True:
            self.gossip_round()
            sleep(1)  # gossip interval
```

---

## Источники

**Papers:**
- [Demers et al. (1987) — «Epidemic Algorithms for Replicated Database Maintenance»](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/epidemic.pdf) — оригинал
- [Das et al. (2002) — «SWIM: Scalable Weakly-consistent Infection-style Process Group Membership Protocol»](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf)
- [van Renesse et al. (2008) — «Efficient Reconciliation and Flow Control for Anti-Entropy Protocols»](https://www.cs.cornell.edu/home/rvr/papers/flowgossip.pdf)

**Implementations / docs:**
- [Hashicorp Memberlist library (Go)](https://github.com/hashicorp/memberlist) — реализация SWIM
- [Cassandra Gossip](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#gossip)
- [Akka Cluster Gossip](https://doc.akka.io/docs/akka/current/typed/cluster.html#gossip)

**Books:**
- *Database Internals* (Petrov, 2019) — gossip, anti-entropy chapter
- *Designing Data-Intensive Applications* (Kleppmann) — gossip-related sections
