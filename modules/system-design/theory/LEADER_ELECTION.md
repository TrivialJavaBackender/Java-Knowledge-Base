# Leader Election

Распределённый процесс выбора одного узла как «лидера» для координации (запись в БД, обработка задач, агрегация).

> **Scope**: подходы (Bully, Raft-based, ZK-based, gossip-based). Полный Raft consensus — см. [CONSENSUS.md](CONSENSUS.md).

---

## Зачем leader

- **Database replication** — primary получает writes, реплики только reads
- **Distributed lock holder** — единственный обработчик resource
- **Task coordinator** — scheduler decides what runs where (Kafka group coordinator, K8s controller-manager)
- **Cluster config decisions** — кто авторитет на rebalance, sharding
- **Aggregation point** — global counter, monotonic ID generator

Без leader — нужен distributed consensus per operation. С leader — leader решает, потом replicates.

---

## Bully Algorithm (Garcia-Molina, 1982)

Простейший. Каждый узел имеет статический rank (priority). Высший rank в живых узлах = leader.

```
Узел замечает: leader не отвечает на ping
→ Бьёт ELECTION сообщение узлам с более высоким rank
→ Если никто не отвечает (все мёртвые/нет высших) → объявляет себя leader
→ Если высший узел отвечает OK → тот будет проводить election сам
```

**Плюсы:** простой, не требует consensus library.
**Минусы:** unstable при flapping (узел уходит/приходит → постоянные re-elections), коммуникация O(N²) в worst case.

Используется редко на практике в чистом виде; идея присутствует в простых scripts.

---

## Raft-based leader election

Современный standard. Каждый кандидат — `candidate state`, ждёт majority votes. Подробнее: [CONSENSUS.md](CONSENSUS.md#leader-election).

**Use cases:** etcd, Consul, CockroachDB, KRaft, TiKV, RethinkDB.

**Trade-off:** требует stable membership (Joint Consensus для config changes), нужен fsync.

---

## ZooKeeper-based election

ZooKeeper предоставляет **ephemeral sequential znodes** — идеальный primitive.

```python
# Каждый кандидат:
my_znode = zk.create("/election/candidate-", ephemeral=True, sequential=True)
# Получает имя типа /election/candidate-0000000005

children = zk.get_children("/election")
sorted_children = sorted(children)  # по sequence number

if my_znode == sorted_children[0]:
    # I am leader
else:
    # Watch предыдущего по порядку
    watch_index = sorted_children.index(my_znode) - 1
    zk.watch(f"/election/{sorted_children[watch_index]}", on_event=re_check)
```

**Свойства:**
- **Fairness** — leader = с наименьшим sequence (first arrived)
- **Liveness** — ephemeral znode пропадает при disconnect → next в queue получает notification
- **Уведомление** — watcher на предыдущий znode, не «herd effect» (только следующий узнаёт)

**Use cases:** Kafka до KRaft (consumer group coordinator), HBase RegionServer master, Solr Overseer, легаси HDFS.

---

## Gossip-based election (Cassandra, Riak)

В Dynamo-style — нет одного leader. Каждый узел — peer. Gossip protocol распространяет cluster state.

Для специфичных задач (per-token range coordinator) — choose by deterministic function (consistent hashing).

→ Не «leader election» в классическом смысле; нет single point координации.

---

## Lease-based leader

Лидер берёт **lease** (аренду) на время T. После expiry должен переавтор izировать. Если умер — lease истекает → новый лидер.

```
Leader: каждые T/2 секунд renew lease через consensus
        → если не получил confirm → assume lost leadership

Other nodes: watch lease expiry timestamp
            → если истёк → start election
```

**Преимущества:**
- **Fencing token** — каждый lease имеет epoch/term; stale leader не может commit
- **Bounded staleness** — старый leader не более T секунд после network partition

**Используют:** Google Chubby (Paxos-based с leases), Spanner (TrueTime + leases для linearizable reads без round trips).

---

## Split-brain prevention

**Проблема:** network partition → две части кластера, обе думают что leader.

### Quorum-based

Election requires **majority votes**. При partition только большая сторона может выбрать leader.

```
5-node cluster, partition 3 vs 2:
  3-side: quorum, can elect → has leader, accepts writes
  2-side: no quorum, cannot elect → stays read-only / refuses writes
```

→ Raft / Paxos уже это делают. **Поэтому odd number nodes (3, 5, 7).**

### Fencing token

Каждый new leader получает monotonic **token**. Старый leader (network partition recovery) пытается write с stale token → reject.

```
Lease N=5, leader L1 expires.
L2 elected, gets epoch=6.
L1 recovers, attempts write with epoch=5.
Storage: latest epoch is 6 → reject L1's write with stale token.
```

См. Kleppmann «How to do distributed locking» — fencing essential для distributed locks.

### STONITH (Shoot The Other Node In The Head)

Hardware fencing: новый leader physically выключает старого через iLO / IPMI / cloud API.

Используется в high-availability HBase, традиционных Pacemaker clusters.

---

## Common patterns

### Multi-Paxos / Raft + multi-region

Не делайте Raft cross-region (latency × 3-10). Вместо: **regional Raft group** + cross-region async replication (с conflict resolution).

CockroachDB doing this with «replication zones», Spanner with multiple Paxos groups per region.

### One-shot vs continuous

- **One-shot leader** — выбрать раз, держать долго. Раз в день кто-то делает backup.
- **Per-task leader** — выбирается на каждое задание (часто в queue-based systems): кто next available worker.

Continuous Raft подходит для long-running leader. Per-task — often simpler через distributed lock (через Redis SETNX или etcd lease).

### Distributed locks vs leader election

Похоже, но не одно и то же:
- **Distributed lock** — exclusive access to a **resource** (file, row, queue). Может быть много locks.
- **Leader election** — exclusive role в **cluster**. Один leader.

Тонкость: lock без fencing token = вы можете потерять leadership и не знать (см. Kleppmann's critique of Redlock).

---

## Implementation tools

| Tool | Mechanism | Use |
|------|-----------|-----|
| **etcd** | Raft + leases | K8s, modern services |
| **Consul** | Raft + sessions | Service discovery, locks |
| **ZooKeeper** | ZAB + ephemeral znodes | Kafka legacy, HBase, Solr |
| **Redis SET NX EX** | Single-instance lock | Simple, NOT for HA (см. Redlock critique) |
| **Redlock (multi-Redis)** | Quorum across N Redis | Controversial — Kleppmann критикует |
| **DB row lock + heartbeat** | `SELECT FOR UPDATE` + TTL | Simple для DB-backed apps |

---

## Real-world examples

### K8s — controller manager leader election

```yaml
# K8s controllers (kube-controller-manager, kube-scheduler) use leader election via Lease object:
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: kube-scheduler
  namespace: kube-system
spec:
  holderIdentity: "kube-scheduler-1"
  leaseDurationSeconds: 15
  renewTime: "2024-01-01T12:00:00Z"
```

Реализация: каждый кандидат пытается update Lease через optimistic concurrency. Если update success → leader, renew каждые `leaseDuration × 0.7`.

### Elasticsearch — master election

Cluster master (handles cluster state changes). Использует **quorum-based** election (modified from Bully + tiebreaker). До 7.x — Zen Discovery, после 7.x — own modified Raft-like.

### Kafka consumer group coordinator

Каждый topic-partition group имеет coordinator broker (выбран на основе hash(group_id) % N_brokers). Member joins group → coordinator assigns partitions через rebalance protocol.

---

## Pitfalls

- **Не использовать quorum** (Bully на even nodes) — split-brain possible
- **Слишком short lease** — частые re-elections под нагрузкой
- **Слишком long lease** — медленный failover
- **No fencing** — stale leader продолжает writes после recovery
- **GC pause** (JVM) длиннее lease → false leader change, два «leader» одновременно
- **Clock skew** — leases assumed synchronized clocks; используй monotonic clocks где можно

---

## Источники

- *Designing Data-Intensive Applications* (Kleppmann, 2017) — Ch. 8.4 «Truth and Lies in Distributed Systems»
- [Kleppmann — «How to do distributed locking»](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) — критика Redlock, fencing tokens
- [etcd — Distributed Reliable Key-Value Store](https://etcd.io/docs/v3.5/)
- [Hashicorp — Consul Sessions](https://developer.hashicorp.com/consul/docs/dynamic-app-config/sessions)
- [Apache ZooKeeper Recipes — Leader Election](https://zookeeper.apache.org/doc/current/recipes.html#sc_leaderElection)
- [Google Chubby paper (Burrows, 2006)](https://research.google/pubs/pub27897/) — origin of lease-based locking pattern
