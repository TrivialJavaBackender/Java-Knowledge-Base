# Алгоритмы консенсуса

Консенсус — несколько узлов договариваются об одном значении при наличии сбоев. Базовая проблема распределённых систем: как сохранить согласованность при разделении или сбое узла.

> **Область:** Raft и Paxos концептуально, ZAB (ZooKeeper), сценарии. Кворум / теория CAP — см. [`distributed_systems.md`](distributed_systems.md). Выборы лидера — см. [LEADER_ELECTION.md](LEADER_ELECTION.md).

---

## Зачем нужен consensus

Сценарии:
1. **Leader election** — кто primary в replica set?
2. **Atomic broadcast** — все узлы должны увидеть одинаковую последовательность сообщений
3. **Distributed lock** — только один владелец lock
4. **Configuration management** — общая «source of truth» (Consul, etcd)
5. **Replicated state machine** — все реплики выполняют одинаковые операции в одинаковом порядке

**Key insight (FLP impossibility, 1985):** в полностью asynchronous системе с возможностью одного сбоя — детерминированный consensus **невозможен**. Все practical алгоритмы делают предположения (partial synchrony, failure detectors).

---

## Raft (Diego Ongaro, John Ousterhout, 2014)

Raft — современный «understandable» consensus, заменивший Paxos в большинстве новых систем (etcd, Consul, CockroachDB, TiKV, RethinkDB, KRaft).

### Roles

- **Leader** — единственный (на term), принимает писательские операции
- **Follower** — пассивно следует за leader (heartbeats)
- **Candidate** — временная роль во время election

### Term

Монотонно растущий счётчик. Каждый term имеет at most one leader. При выборе нового leader — `term++`.

### Leader Election

```
Все follower при старте.
Каждый follower имеет random election timeout (150-300ms).
Если не получил heartbeat от leader → переходит в candidate state.

Candidate:
  1. term++
  2. vote for self
  3. broadcast RequestVote(term, lastLogIndex, lastLogTerm) → followers
  4. follower голосует за candidate если:
       - term >= currentTerm
       - candidate's log не older чем follower's
       - follower ещё не голосовал в этом term
  5. Если получил majority votes → leader
  6. Если timeout → new election
```

**Split vote prevention:** random timeouts → unlikely что два candidate стартуют одновременно. Один выиграет majority.

### Log Replication

```
Client → Leader: COMMAND
Leader → local log: [term, index, command]
Leader → all followers: AppendEntries(term, prevIndex, prevTerm, [entries], leaderCommit)
Follower: проверяет prevIndex/prevTerm consistency, appends, replies
Leader: получил majority confirmations → mark COMMITTED → apply to state machine
Leader → followers (в next AppendEntries или heartbeat): updated leaderCommit
Followers apply committed entries to state machines
```

**Safety property:** committed entries — durable across leader changes (потому что новый leader должен иметь все committed entries в своём log, иначе он не получил бы majority votes).

### Persistence

Перед reply на vote / append, узел **fsync**'ит state:
- `currentTerm`
- `votedFor` (за кого голосовал в этом term)
- `log[]`

→ После crash восстанавливаем последнее persistent состояние.

---

## Paxos (Leslie Lamport, 1989/1998)

Старший брат consensus. «The Part-Time Parliament» paper — печально известна своей нечитаемостью; Lamport переписал в 2001 как «Paxos Made Simple», но всё равно сложно.

### Basic Paxos (single value)

Roles:
- **Proposer** — предлагает значение
- **Acceptor** — голосует за/против
- **Learner** — узнаёт результат

```
Phase 1 (Prepare):
  Proposer → all Acceptors: PREPARE(n)        # n — monotonic proposal number
  Acceptor → Proposer: PROMISE(n, prev_n, prev_value)
                       (если n > any seen; else reject)

Phase 2 (Accept):
  Proposer (если majority promised) → Acceptors: ACCEPT(n, v)
                                                  где v = prev_value with highest prev_n, или новое значение
  Acceptor → Proposer: ACCEPTED(n, v)
                       (если n >= max seen)

Если majority ACCEPTED → consensus reached на v
```

**Сложности:**
- Многоступенчатый
- Liveness problem: два proposer могут постоянно прерывать друг друга (livelock)

### Multi-Paxos

Для replicated state machine (a sequence of values). Оптимизация: один stable proposer (leader) — пропускает Phase 1 пока не сменится leader. На практике сильно похоже на Raft.

**Production users:** Google Spanner (Paxos для replication), Chubby (Google's distributed lock), Cassandra LWT (Lightweight Transactions).

### Paxos vs Raft

| | Paxos | Raft |
|---|---|---|
| Readability | Сложный | Designed for understandability |
| Roles | Proposer/Acceptor/Learner — overlapping | Leader/Follower/Candidate — strict |
| Leader election | Не централизованный (любой Proposer) | Centralized (один leader) |
| Log replication | Не explicit в basic Paxos | Core часть протокола |
| Adoption | Spanner, Cassandra LWT, Chubby | etcd, Consul, CockroachDB, KRaft, RethinkDB |
| Год | 1989/1998 | 2014 |

→ Большинство **новых** систем выбирают Raft. Paxos живёт в Spanner и legacy.

---

## ZAB (ZooKeeper Atomic Broadcast)

Custom consensus в Apache ZooKeeper. Похож на Paxos, но оптимизирован для:
- High throughput total ordering (atomic broadcast)
- Recovery: при leader change узлы должны иметь согласованный «watermark»

Phases: **Discovery → Synchronization → Broadcast**.

**Используется в:** ZooKeeper (внутри), HDFS HA (через ZK), Kafka (до KRaft).

---

## Сценарии

### etcd / Consul — distributed configuration

K8s control plane хранит state в etcd (Raft-based). API server reads/writes через etcd.

```
kube-apiserver → etcd cluster (3-5 nodes, Raft)
                 - quorum для writes (W = majority)
                 - linearizable reads (через leader)
                 - watch для notifications (change feeds)
```

### Kafka KRaft (Kafka 3.3+)

Замена ZooKeeper для metadata. Kafka brokers выбирают controller через Raft (`__cluster_metadata` topic — Raft log).

```
KRaft controllers (3-5 nodes) — Raft consensus
  - leader controller обрабатывает metadata changes
  - replicated metadata log
  - brokers fetch metadata updates from controller
```

### CockroachDB / TiKV — distributed SQL

Каждая **range** (sub-shard) реплицирована через Raft. 1000s of Raft groups в кластере.

```
Range 1: [Replica A, Replica B, Replica C] — Raft group 1
Range 2: [Replica B, Replica C, Replica D] — Raft group 2
...
```

→ Параллельно тысячи Raft instances; каждый transaction touches несколько ranges (2PC across Raft groups).

### Spanner (Google) — global SQL

Multi-Paxos на каждый «directory» (sub-table). Plus **TrueTime** API (synchronised clocks via GPS + atomic clocks) для strong consistency без 2PC waiting.

### MongoDB (4.x+) replica set

Custom protocol, идеи Raft. Primary election, write concerns, read concerns настраиваются.

### Apache Zookeeper — legacy distributed coordination

ZAB протокол. Used by: HBase, Solr, Kafka (до 3.3), Pinot, Druid, Flink — для leader election, configuration, distributed locks.

---

## Протоколы на основе кворума (альтернатива)

В Dynamo-style (Cassandra/DynamoDB) — нет central consensus, используется **quorum** для consistency:

```
N = 3 replicas
W = 2 (write success when 2 confirmed)
R = 2 (read fetches from 2)
R + W > N → strong consistency (последний write точно виден в R replicas)
```

**Trade-off:** quorum проще consensus, но даёт более слабые гарантии:
- Сложно achieve linearizability
- Read repair / anti-entropy для конвергенции

См. [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md) для leaderless replication детали.

---

## Соображения производительности

### Latency

Consensus = `2 RT` для write (или `1 RT` если committed entries known, как в Raft):
```
Leader → followers: AppendEntries (1 RT)
Leader → majority ack: commit decision
Leader → followers: leaderCommit (piggyback на next AppendEntries)
```

→ Cross-region Raft: 80-150 ms per write. **Локальный кластер**: < 5 ms.

### Throughput

Single Raft leader limit: ~ 10K-50K writes/sec (network bound). Для большей throughput:
- **Batch operations** (Raft groups в TiKV пакуют commands)
- **Sharded Raft groups** (CockroachDB / TiKV — 1000s of groups)
- **Pipelining** — отправлять next batch не дожидаясь ack предыдущего

### Quorum sizing

`f` failures tolerated требует `2f+1` nodes (majority):
- 3 nodes: tolerate 1 failure
- 5 nodes: tolerate 2 failures
- 7 nodes: tolerate 3 failures

**Чем больше**: больше fault tolerance, **больше latency** (нужно ждать больше responses), больше cost.

→ Обычно 3-5 nodes — practical sweet spot.

---

## Типичные подводные камни

- **One-node «cluster»** — нет fault tolerance. 3 nodes minimum.
- **Even number nodes** — split votes возможны, нет benefit над odd-2 nodes
- **Co-locating Raft replicas в одной AZ** — AZ outage = data loss. Spread по AZ / regions.
- **Cross-region Raft с высокой latency** — каждый write 150ms. Использовать regional Raft + Paxos/replication для cross-region.
- **Network partitions split-brain** — Raft fencing предотвращает (только majority может commit), но **stale reads** на minority partition возможны без proper read leases.

---

## Источники

**Papers:**
- [Ongaro, Ousterhout (2014) — «In Search of an Understandable Consensus Algorithm (Raft)»](https://raft.github.io/raft.pdf) — оригинал Raft
- [Lamport (2001) — «Paxos Made Simple»](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf)
- [Lamport (1998) — «The Part-Time Parliament» (Paxos оригинал, ACM TOCS)](https://lamport.azurewebsites.net/pubs/lamport-paxos.pdf)
- [Junqueira, Reed (2011) — «Zab: High-performance broadcast for primary-backup systems»](https://marcoserafini.github.io/papers/zab.pdf)
- [Fischer, Lynch, Paterson (1985) — «Impossibility of Distributed Consensus with One Faulty Process» (FLP impossibility)](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf)

**Books / talks:**
- *Designing Data-Intensive Applications* (Kleppmann, 2017) — Ch. 9 «Consistency and Consensus»
- *Database Internals* (Alex Petrov, 2019) — Part II
- [Raft visualization (raft.github.io)](https://raft.github.io/) — интерактивная визуализация
- [Diego Ongaro's PhD thesis (Raft details)](https://web.stanford.edu/~ouster/cgi-bin/papers/OngaroPhD.pdf)

**Implementations:**
- [etcd's Raft library (Go)](https://github.com/etcd-io/raft) — production-grade reference impl
- [HashiCorp Raft (Go)](https://github.com/hashicorp/raft) — Consul, Nomad используют
- [Cassandra LWT (Lightweight Transactions) — Paxos](https://cassandra.apache.org/doc/latest/cassandra/cql/dml.html#lightweight-transactions)
