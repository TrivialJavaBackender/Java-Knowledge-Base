# Алгоритмы консенсуса

Консенсус — несколько узлов договариваются об одном значении при наличии сбоев. Базовая проблема распределённых систем: как сохранить согласованность при разделении или сбое узла.

> **Область:** Raft и Paxos концептуально, ZAB (ZooKeeper), сценарии. Кворум / теория CAP — см. [`distributed_systems.md`](distributed_systems.md). Выборы лидера — см. [LEADER_ELECTION.md](LEADER_ELECTION.md).

---

## Зачем нужен консенсус

Сценарии:
1. **Leader election** — кто primary в replica set?
2. **Atomic broadcast** — все узлы должны увидеть одинаковую последовательность сообщений
3. **Distributed lock** — только один владелец блокировки
4. **Configuration management** — общая «source of truth» (Consul, etcd)
5. **Replicated state machine** — все реплики выполняют одинаковые операции в одинаковом порядке

**Key insight (FLP impossibility, 1985):** в полностью асинхронной системе с возможностью одного сбоя — детерминированный консенсус **невозможен**. Все практические алгоритмы делают предположения (partial synchrony, failure detectors).

---

## Raft (Diego Ongaro, John Ousterhout, 2014)

Raft — современный консенсус, разработанный для понятности, заменивший Paxos в большинстве новых систем (etcd, Consul, CockroachDB, TiKV, RethinkDB, KRaft).

### Роли

- **Leader** — единственный (на term), принимает писательские операции
- **Follower** — пассивно следует за leader (heartbeats)
- **Candidate** — временная роль во время выборов

### Терм

Монотонно растущий счётчик. Каждый терм имеет не более одного лидера. При выборе нового leader — `term++`.

### Выборы лидера

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

**Предотвращение разделения голосов:** случайные таймауты → маловероятно, что два кандидата стартуют одновременно. Один выиграет большинство.

### Репликация лога

```
Client → Leader: COMMAND
Leader → local log: [term, index, command]
Leader → all followers: AppendEntries(term, prevIndex, prevTerm, [entries], leaderCommit)
Follower: проверяет prevIndex/prevTerm consistency, appends, replies
Leader: получил majority confirmations → mark COMMITTED → apply to state machine
Leader → followers (в next AppendEntries или heartbeat): updated leaderCommit
Followers apply committed entries to state machines
```

**Safety property:** зафиксированные записи сохраняются при смене лидера (потому что новый leader должен иметь все зафиксированные записи в своём log, иначе он не получил бы большинства голосов).

### Постоянное хранение состояния

Перед ответом на vote / append, узел **fsync**'ит state:
- `currentTerm`
- `votedFor` (за кого голосовал в этом term)
- `log[]`

→ После сбоя восстанавливаем последнее сохранённое состояние.

---

## Paxos (Leslie Lamport, 1989/1998)

Старший брат консенсуса. «The Part-Time Parliament» paper — печально известна своей нечитаемостью; Lamport переписал в 2001 как «Paxos Made Simple», но всё равно сложно.

### Basic Paxos (single value)

Роли:
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
- Проблема живучести (liveness): два proposer могут постоянно прерывать друг друга (livelock)

### Multi-Paxos

Для replicated state machine (последовательность значений). Оптимизация: один stable proposer (leader) — пропускает Phase 1 пока не сменится leader. На практике сильно похоже на Raft.

**Используется в продакшене:** Google Spanner (Paxos для репликации), Chubby (распределённая блокировка Google), Cassandra LWT (Lightweight Transactions).

### Paxos vs Raft

| | Paxos | Raft |
|---|---|---|
| Читаемость | Сложный | Разработан для понятности |
| Роли | Proposer/Acceptor/Learner — перекрывающиеся | Leader/Follower/Candidate — строгие |
| Выборы лидера | Не централизованные (любой Proposer) | Централизованные (один leader) |
| Репликация лога | Не явная в basic Paxos | Основная часть протокола |
| Применение | Spanner, Cassandra LWT, Chubby | etcd, Consul, CockroachDB, KRaft, RethinkDB |
| Год | 1989/1998 | 2014 |

→ Большинство **новых** систем выбирают Raft. Paxos живёт в Spanner и legacy.

---

## ZAB (ZooKeeper Atomic Broadcast)

Кастомный консенсус в Apache ZooKeeper. Похож на Paxos, но оптимизирован для:
- Высокой пропускной способности при полном упорядочивании (atomic broadcast)
- Восстановления: при смене лидера узлы должны иметь согласованный «watermark»

Phases: **Discovery → Synchronization → Broadcast**.

**Используется в:** ZooKeeper (внутри), HDFS HA (через ZK), Kafka (до KRaft).

---

## Сценарии

### etcd / Consul — распределённая конфигурация

K8s control plane хранит состояние в etcd (Raft-based). API server читает и пишет через etcd.

```
kube-apiserver → etcd cluster (3-5 nodes, Raft)
                 - quorum для writes (W = majority)
                 - linearizable reads (через leader)
                 - watch для уведомлений (change feeds)
```

### Kafka KRaft (Kafka 3.3+)

Замена ZooKeeper для metadata. Kafka brokers выбирают controller через Raft (`__cluster_metadata` topic — Raft log).

```
KRaft controllers (3-5 nodes) — Raft consensus
  - leader controller обрабатывает metadata changes
  - replicated metadata log
  - brokers fetch metadata updates from controller
```

### CockroachDB / TiKV — распределённый SQL

Каждая **range** (sub-shard) реплицирована через Raft. 1000s of Raft groups в кластере.

```
Range 1: [Replica A, Replica B, Replica C] — Raft group 1
Range 2: [Replica B, Replica C, Replica D] — Raft group 2
...
```

→ Параллельно тысячи Raft instances; каждая транзакция затрагивает несколько ranges (2PC across Raft groups).

### Spanner (Google) — глобальный SQL

Multi-Paxos на каждый «directory» (sub-table). Plus **TrueTime** API (синхронизированные часы через GPS + атомарные часы) для строгой согласованности без ожидания 2PC.

### MongoDB (4.x+) replica set

Кастомный протокол, идеи Raft. Выборы первичного узла, write concerns, read concerns настраиваются.

### Apache Zookeeper — legacy distributed coordination

ZAB протокол. Используется в: HBase, Solr, Kafka (до 3.3), Pinot, Druid, Flink — для выборов лидера, конфигурации, распределённых блокировок.

---

## Протоколы на основе кворума (альтернатива)

В Dynamo-style (Cassandra/DynamoDB) — нет центрального консенсуса, используется **quorum** для согласованности:

```
N = 3 replicas
W = 2 (write success when 2 confirmed)
R = 2 (read fetches from 2)
R + W > N → strong consistency (последний write точно виден в R replicas)
```

**Компромисс:** кворум проще консенсуса, но даёт более слабые гарантии:
- Сложно достичь строгой согласованности (linearizability)
- Read repair / anti-entropy для конвергенции

См. [`databases/REPLICATION.md`](../../databases/theory/REPLICATION.md) для деталей о репликации без выделенного лидера.

---

## Соображения производительности

### Задержка

Консенсус = `2 RT` для write (или `1 RT` если зафиксированные записи уже известны, как в Raft):
```
Leader → followers: AppendEntries (1 RT)
Leader → majority ack: commit decision
Leader → followers: leaderCommit (piggyback на next AppendEntries)
```

→ Cross-region Raft: 80-150 ms per write. **Локальный кластер**: < 5 ms.

### Пропускная способность

Single Raft leader limit: ~ 10K-50K writes/sec (network bound). Для большей пропускной способности:
- **Batch operations** (Raft groups в TiKV пакуют commands)
- **Sharded Raft groups** (CockroachDB / TiKV — 1000s of groups)
- **Pipelining** — отправлять следующий пакет, не дожидаясь подтверждения предыдущего

### Размер кворума

`f` допустимых сбоев требует `2f+1` узлов (большинство):
- 3 узла: выдерживает 1 сбой
- 5 узлов: выдерживает 2 сбоя
- 7 узлов: выдерживает 3 сбоя

**Чем больше**: выше устойчивость к сбоям, **больше задержка** (нужно ждать больше ответов), выше стоимость.

→ Обычно 3–5 узлов — практический оптимум.

---

## Типичные подводные камни

- **One-node «cluster»** — нет устойчивости к сбоям. Минимум 3 узла.
- **Чётное число узлов** — разделение голосов возможно, нет преимущества над нечётным-2 узлами.
- **Co-locating Raft replicas в одной AZ** — сбой AZ = потеря данных. Распределяй по AZ / регионам.
- **Cross-region Raft с высокой задержкой** — каждая запись 150 мс. Использовать regional Raft + Paxos/replication для cross-region.
- **Network partitions split-brain** — Raft fencing предотвращает (только большинство может зафиксировать), но **устаревшие чтения** на меньшинстве партиции возможны без корректных аренд на чтение.

---

## Источники

**Статьи:**
- [Ongaro, Ousterhout (2014) — «In Search of an Understandable Consensus Algorithm (Raft)»](https://raft.github.io/raft.pdf) — оригинал Raft
- [Lamport (2001) — «Paxos Made Simple»](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf)
- [Lamport (1998) — «The Part-Time Parliament» (Paxos оригинал, ACM TOCS)](https://lamport.azurewebsites.net/pubs/lamport-paxos.pdf)
- [Junqueira, Reed (2011) — «Zab: High-performance broadcast for primary-backup systems»](https://marcoserafini.github.io/papers/zab.pdf)
- [Fischer, Lynch, Paterson (1985) — «Impossibility of Distributed Consensus with One Faulty Process» (FLP impossibility)](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf)

**Книги / выступления:**
- *Designing Data-Intensive Applications* (Kleppmann, 2017) — Ch. 9 «Consistency and Consensus»
- *Database Internals* (Alex Petrov, 2019) — Part II
- [Raft visualization (raft.github.io)](https://raft.github.io/) — интерактивная визуализация
- [Diego Ongaro's PhD thesis (Raft details)](https://web.stanford.edu/~ouster/cgi-bin/papers/OngaroPhD.pdf)

**Реализации:**
- [etcd's Raft library (Go)](https://github.com/etcd-io/raft) — production-grade reference impl
- [HashiCorp Raft (Go)](https://github.com/hashicorp/raft) — Consul, Nomad используют
- [Cassandra LWT (Lightweight Transactions) — Paxos](https://cassandra.apache.org/doc/latest/cassandra/cql/dml.html#lightweight-transactions)
