# Выборы лидера

Распределённый процесс выбора одного узла как «лидера» для координации (запись в БД, обработка задач, агрегация).

> **Область:** подходы (Bully, на основе Raft, на основе ZK, на основе gossip). Полный консенсус Raft — см. [CONSENSUS.md](CONSENSUS.md).

---

## Зачем лидер

- **Database replication** — primary получает writes, реплики только reads
- **Distributed lock holder** — единственный обработчик ресурса
- **Task coordinator** — scheduler decides what runs where (Kafka group coordinator, K8s controller-manager)
- **Cluster config decisions** — кто авторитет на rebalance, sharding
- **Aggregation point** — global counter, monotonic ID generator

Без лидера — нужен distributed consensus per operation. С лидером — лидер решает, потом реплицирует.

---

## Алгоритм Bully (Garcia-Molina, 1982)

Простейший. Каждый узел имеет статический rank (priority). Высший rank в живых узлах = лидер.

```
Узел замечает: leader не отвечает на ping
→ Бьёт ELECTION сообщение узлам с более высоким rank
→ Если никто не отвечает (все мёртвые/нет высших) → объявляет себя leader
→ Если высший узел отвечает OK → тот будет проводить election сам
```

**Плюсы:** простой, не требует consensus library.
**Минусы:** нестабильность при flapping (узел уходит/приходит → постоянные re-elections), коммуникация O(N²) в worst case.

Используется редко на практике в чистом виде; идея присутствует в простых scripts.

---

## Выборы лидера на основе Raft

Современный стандарт. Каждый кандидат — `candidate state`, ждёт majority votes. Подробнее: [CONSENSUS.md](CONSENSUS.md#leader-election).

**Use cases:** etcd, Consul, CockroachDB, KRaft, TiKV, RethinkDB.

**Компромисс:** требует stable membership (Joint Consensus для config changes), нужен fsync.

---

## Выборы на основе ZooKeeper

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
- **Fairness** — лидер = с наименьшим sequence (first arrived)
- **Liveness** — ephemeral znode пропадает при disconnect → следующий в очереди получает уведомление
- **Уведомление** — watcher на предыдущий znode, не «herd effect» (только следующий узнаёт)

**Use cases:** Kafka до KRaft (consumer group coordinator), HBase RegionServer master, Solr Overseer, легаси HDFS.

---

## Выборы на основе gossip (Cassandra, Riak)

В Dynamo-style — нет одного лидера. Каждый узел — peer. Gossip protocol распространяет cluster state.

Для специфичных задач (per-token range coordinator) — choose by deterministic function (consistent hashing).

→ Не «выборы лидера» в классическом смысле; нет единой точки координации.

---

## Лидер на основе временной аренды (lease)

Лидер берёт **lease** (аренду) на время T. После истечения должен переавторизоваться. Если умер — lease истекает → новый лидер.

```
Leader: каждые T/2 секунд renew lease через consensus
        → если не получил confirm → assume lost leadership

Other nodes: watch lease expiry timestamp
            → если истёк → start election
```

**Преимущества:**
- **Fencing token** — каждый lease имеет epoch/term; устаревший лидер не может commit
- **Bounded staleness** — старый лидер не более T секунд после network partition

**Используют:** Google Chubby (Paxos-based с leases), Spanner (TrueTime + leases для linearizable reads без round trips).

---

## Предотвращение расщепления кластера (split-brain)

**Проблема:** network partition → две части кластера, обе думают что лидер.

### Quorum-based

Выборы требуют **большинства голосов**. При partition только большая сторона может выбрать лидера.

```
5-node cluster, partition 3 vs 2:
  3-side: quorum, can elect → has leader, accepts writes
  2-side: no quorum, cannot elect → stays read-only / refuses writes
```

→ Raft / Paxos уже это делают. **Поэтому нечётное число узлов (3, 5, 7).**

### Fencing token

Каждый новый лидер получает monotonic **token**. Старый лидер (после восстановления из network partition) пытается сделать запись с устаревшим токеном → отказ.

```
Lease N=5, leader L1 expires.
L2 elected, gets epoch=6.
L1 recovers, attempts write with epoch=5.
Storage: latest epoch is 6 → reject L1's write with stale token.
```

См. Kleppmann «How to do distributed locking» — fencing essential для distributed locks.

### STONITH (Shoot The Other Node In The Head)

Hardware fencing: новый лидер физически выключает старого через iLO / IPMI / cloud API.

Используется в high-availability HBase, традиционных Pacemaker clusters.

---

## Распространённые шаблоны

### Multi-Paxos / Raft + multi-region

Не делайте Raft cross-region (задержка × 3-10). Вместо: **regional Raft group** + cross-region async replication (с conflict resolution).

CockroachDB doing this with «replication zones», Spanner with multiple Paxos groups per region.

### One-shot vs continuous

- **One-shot leader** — выбрать раз, держать долго. Раз в день кто-то делает backup.
- **Per-task leader** — выбирается на каждое задание (часто в queue-based systems): кто следующий доступный обработчик.

Continuous Raft подходит для долгоживущего лидера. Per-task — often simpler через distributed lock (через Redis SETNX или etcd lease).

### Distributed locks vs leader election

Похоже, но не одно и то же:
- **Distributed lock** — эксклюзивный доступ к **ресурсу** (file, row, queue). Может быть много locks.
- **Leader election** — эксклюзивная роль в **кластере**. Один лидер.

Тонкость: lock без fencing token = вы можете потерять роль лидера и не знать (см. Kleppmann's critique of Redlock).

---

## Инструменты реализации

| Инструмент | Механизм | Применение |
|------|-----------|-----|
| **etcd** | Raft + leases | K8s, modern services |
| **Consul** | Raft + sessions | Service discovery, locks |
| **ZooKeeper** | ZAB + ephemeral znodes | Kafka legacy, HBase, Solr |
| **Redis SET NX EX** | Single-instance lock | Simple, NOT for HA (см. Redlock critique) |
| **Redlock (multi-Redis)** | Quorum across N Redis | Controversial — Kleppmann критикует |
| **DB row lock + heartbeat** | `SELECT FOR UPDATE` + TTL | Simple для DB-backed apps |

---

## Примеры из продакшена

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

Реализация: каждый кандидат пытается обновить Lease через optimistic concurrency. Если обновление успешно → лидер, продлевает каждые `leaseDuration × 0.7`.

### Elasticsearch — master election

Cluster master (handles cluster state changes). Использует **quorum-based** election (modified from Bully + tiebreaker). До 7.x — Zen Discovery, после 7.x — own modified Raft-like.

### Kafka consumer group coordinator

Каждый topic-partition group имеет coordinator broker (выбран на основе hash(group_id) % N_brokers). Member joins group → coordinator assigns partitions через rebalance protocol.

---

## Подводные камни

- **Не использовать quorum** (Bully на even nodes) — расщепление кластера возможно
- **Слишком короткий lease** — частые re-elections под нагрузкой
- **Слишком длинный lease** — медленное переключение на резерв (failover)
- **No fencing** — устаревший лидер продолжает записи после восстановления
- **GC pause** (JVM) длиннее lease → ложная смена лидера, два «лидера» одновременно
- **Clock skew** — leases assumed synchronized clocks; используй monotonic clocks где можно

---

## Источники

- *Designing Data-Intensive Applications* (Kleppmann, 2017) — Ch. 8.4 «Truth and Lies in Distributed Systems»
- [Kleppmann — «How to do distributed locking»](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) — критика Redlock, fencing tokens
- [etcd — Distributed Reliable Key-Value Store](https://etcd.io/docs/v3.5/)
- [Hashicorp — Consul Sessions](https://developer.hashicorp.com/consul/docs/dynamic-app-config/sessions)
- [Apache ZooKeeper Recipes — Leader Election](https://zookeeper.apache.org/doc/current/recipes.html#sc_leaderElection)
- [Google Chubby paper (Burrows, 2006)](https://research.google/pubs/pub27897/) — origin of lease-based locking pattern
