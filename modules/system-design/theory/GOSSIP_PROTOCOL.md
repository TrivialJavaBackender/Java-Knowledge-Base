# Gossip-протокол

Gossip (или эпидемический протокол) — способ распространения информации в кластере через случайный обмен между узлами. Каждый узел периодически выбирает случайных «соседей» и обменивается состоянием.

---

## Идея

Аналог сплетен в толпе: «слух» расходится экспоненциально. Каждый раунд узел знает информацию → следующий раунд знают ещё N (с соседями он обменялся).

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
- **Децентрализованный** — нет центрального координатора
- **Устойчивый** — потеря отдельных сообщений не критична (избыточные пути)
- **Масштабируемый** — каждый узел общается с константным числом соседей, не со всеми
- **Eventually consistent** — все узлы сойдутся к консистентному состоянию

---

## Виды gossip

### Push gossip

Узел шлёт **свою** информацию соседям. Сосед обновляет свою копию, если она старее.

```
Node A: «my view: { N1: state_v1, N2: state_v2 }» → send to random peer
Peer B: merge with own view, take newer
```

### Pull gossip

Узел запрашивает у соседей их состояние.

```
Node A: «give me your state» → peer
Peer: «here is my view»
A: merge
```

### Push-Pull (hybrid)

Обмен в обе стороны — A шлёт своё, B шлёт своё, оба объединяют состояние. Эффективнее (один RT для двустороннего обновления).

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

**Преимущества перед heartbeat-everyone:**
- Постоянный сетевой трафик на узел (O(1)), а не O(N²)
- Переносит кратковременные сетевые сбои (подтверждение через косвенный ping)
- Распространение информации об отказе — O(log N) раундов

---

## Anti-entropy

Периодический фоновый процесс: каждый узел синхронизируется со случайным соседом по **полному состоянию** (не только по инкрементальным обновлениям). Гарантирует сходимость даже при потерянных сообщениях.

```
Every 10 min:
  A picks random peer B
  Both compute Merkle tree of their state
  Compare roots → if differ, descend tree, find divergent ranges, sync
```

См. [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md#anti-entropy--merkle-trees) — anti-entropy в Cassandra, Riak.

---

## Сценарии

### Apache Cassandra — распространение состояния кластера

Каждый узел Cassandra обменивается gossip-сообщениями каждую секунду с 1–3 соседями:
- Heartbeat (alive)
- Изменения состава кластера (новые узлы, уход)
- Версии схемы
- Принадлежность диапазонов токенов

→ Через несколько секунд **весь кластер знает**, что один узел присоединился. Без центрального координатора.

```
[Node A] ←→ [Node B]           ←→ [Node C]
   ↑           ↑                       ↓
[Node D] ←→ [Node E] ←→ [Node F] ←→ [Node G]
              gossip каждую секунду
```

### Hashicorp Consul / Serf

Memberlist (SWIM-based) для service discovery, обнаружения сбоев. Каждый агент Consul обменивается gossip-сообщениями с остальными.

### Riak

Gossip для управления составом кластера и распространения состояния кольца.

### Amazon Dynamo (оригинал)

Gossip для управления составом и обнаружения сбоев. Каждый узел знает «обо всех» через постепенное распространение gossip-сообщений.

### Akka Cluster

Gossip-based кластер в Akka. Используется в Lagom, Play framework для распределённой координации.

### Apache Storm — Nimbus / Supervisor

Gossip для координации.

---

## Компромиссы

| | Преимущества | Недостатки |
|---|---|---|
| **Пропускная способность** | Константна на узел (~постоянное число эпох × небольшое состояние) | Неэкономично для малых кластеров (лучше broadcast) |
| **Задержка** | O(log N) для распространения | Не мгновенно — могут пройти секунды до осведомлённости всех узлов |
| **Согласованность** | Eventually consistent | Не подходит для строго согласованных операций (linearizable) |
| **Устойчивость** | Выдерживает единичные сбои | Враждебная среда (Byzantine) → нужны другие подходы |
| **Сложность** | Простой в реализации | Сложно рассуждать о согласованности |

---

## Gossip против консенсуса

| | Gossip | Консенсус (Raft/Paxos) |
|---|---|---|
| Согласованность | Eventually | Строгая (linearizable) |
| Задержка | Секунды (раунды) | Миллисекунды (один RT) |
| Применение | Состояние кластера, обнаружение сбоев, anti-entropy | Критические операции (смена конфигурации, выборы лидера) |
| Децентрализованный? | Полностью | На основе лидера |
| Пропускная способность | Низкая (константа на узел) | Выше (broadcast до большинства) |

**Паттерн:** gossip — для **распространения информации** (состав кластера, метрики), консенсус — для **критических решений** (кто лидер, какое значение зафиксировано).

Cassandra пример:
- Gossip: состав кластера, версии схемы
- Paxos LWT: строго согласованные записи для условных обновлений (compare-and-set)

---

## Настройка

- **Gossip interval** — обычно 1 сек. Компромисс: короче = быстрее распространение + больше трафик.
- **Fanout** (соседей за раунд) — 2–3. Больше = быстрее, но больше трафик.
- **Anti-entropy interval** — 10 мин – часы. Долгий — больше расхождений; короткий — больше CPU/IO.

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

**Реализации / документация:**
- [Hashicorp Memberlist library (Go)](https://github.com/hashicorp/memberlist) — реализация SWIM
- [Cassandra Gossip](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html#gossip)
- [Akka Cluster Gossip](https://doc.akka.io/docs/akka/current/typed/cluster.html#gossip)

**Books:**
- *Database Internals* (Petrov, 2019) — gossip, anti-entropy chapter
- *Designing Data-Intensive Applications* (Kleppmann) — gossip-related sections
