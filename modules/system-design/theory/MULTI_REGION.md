# Многорегиональная архитектура

Многорегиональное развёртывание для задержки, доступности и локализации данных. Главный компромисс — **согласованность против задержки** (PACELC: при отсутствии разделения — задержка против согласованности).

> **Область:** топологии (active-active против active-passive), разрешение конфликтов, системы из реальной практики. CRDT — см. [CRDT.md](CRDT.md). Консенсус — [CONSENSUS.md](CONSENSUS.md).

---

## Зачем multi-region

1. **Задержка** — пользователь в Сингапуре получает данные из региона Сингапура (~10 мс) вместо US (~200 мс);
2. **Доступность** — сбой региона (AWS us-east-1 случается 1–2 раза в год) → переключение на резерв в другой регион;
3. **Локализация данных** — GDPR требует, чтобы данные ЕС не покидали ЕС. Российские данные не покидают РФ;
4. **Аварийное восстановление** — стихийное бедствие, уничтожение ЦОДа → данные в другой географии.

---

## Топологии

### Active-Passive (Hot-Cold)

Один регион **primary**, остальные **standby**: получают replicated данные, не serve traffic.

```
US-East (primary) — все writes и reads
  ↓ async replication
EU (passive)      — копия данных, idle servers
APAC (passive)    — копия
```

**Failover:** при failure US-East — promotion EU primary, DNS switch, restart services.

- ✓ Просто: нет conflict resolution
- ✓ Strong consistency (один primary)
- ✓ Wasted capacity (passive-регионы простаивают) — обратная сторона
- ✗ Высокий RTO (восстановление 5–30 минут)
- ✗ Для пользователей EU/APAC latency = cross-region

### Active-Active (Hot-Hot)

**Каждый регион принимает writes и reads.** Replication peer-to-peer.

```
US-East ←→ EU ←→ APAC
   ↕         ↕         ↕
  Users    Users    Users
```

- ✓ Low latency для всех пользователей (local region)
- ✓ No wasted capacity
- ✓ Region outage не критично (другие живут)
- ✗ **Conflict resolution** при concurrent writes одного ключа
- ✗ Eventual consistency между regions (50-200ms typical lag)
- ✗ Сложность в operations

### Hybrid (Active-Passive с edge cache)

Active в одном регионе, **CDN / read replicas** в других для local reads.

```
US-East (writes + reads)
   ↓ async replicate
EU read replica (только reads, локальная latency)
APAC read replica
```

- ✓ Local reads (но cached, eventual)
- ✓ Local latency для read-heavy apps (news, social, content)
- ✗ Writes идут в primary cross-region (medium latency)
- Используется в: Instagram (early days), GitHub (есть read replicas в Asia), CDN-heavy apps

---

## Разрешение конфликтов в Active-Active

Когда два пользователя concurrent редактируют (или загружают) одну entity в разных regions.

### Last-Write-Wins (LWW)

Каждая запись имеет wall-clock timestamp. Winner — newest.

- ✓ Простой
- ✗ Зависит от clock sync (NTP — точность 1-10 ms; clock skew → потеря)
- ✗ Silent data loss

**Используют:** Cassandra (default), Riak, DynamoDB Global Tables.

### Application-Level Conflict Resolution

Conflict возвращается клиенту, application решает (merge, manual review, business rules).

```
User A: добавил «apple» в корзину (region US)
User B (same user, mobile): добавил «banana» (region EU)

Replication detect conflict (same key, parallel writes):
  → store both versions ({apple}, {banana})
  → application reads both → merges → writes back {apple, banana}
```

- ✓ No data loss
- ✗ App complexity для каждого entity type
- Используют: Riak, MV-Register в Cassandra

### CRDT-based

Math-guaranteed merge. См. [CRDT.md](CRDT.md).

### Sticky to source region (Region Affinity)

Пользователь привязан к региону (home region). Writes только туда, replication к остальным async.

```
User A (создан в EU) → all writes go to EU primary, reads from any region
User B (создан в US) → US primary
```

- ✓ No conflicts (single writer per entity)
- ✓ Local reads
- ✗ Cross-region writes для users-not-in-home-region (mobile traveller)
- Используют: Salesforce, custom enterprise apps

### Spanner / TrueTime — globally strong consistency

Google Spanner — uses **TrueTime API** (GPS + atomic clocks) для bounded time uncertainty (`~5 ms`). С этим waiting `commit_timestamp + uncertainty` гарантирует linearizability **without 2PC overhead**.

- ✓ Strong consistency globally
- ✗ Требует hardware (atomic clocks в каждом DC)
- ✗ Cost
- Используют: только Google Spanner; CockroachDB и YugabyteDB imitate без TrueTime (но менее строгий)

---

## Локализация данных (GDPR и др.)

**GDPR Article 44**: персональные данные EU пользователей не могут leave EU без adequate protection.

**Реализация:**

### Geo-sharding по user.region

User имеет `home_region` (set at signup, основано на IP/опции). Все user data — в этом region.

```
User (region=EU):
  user_id=123, email=..., posts=[...]  → stored only in EU region
  
Cross-region query:
  "Show me posts by user 123" → query goes to EU region
```

### Encryption + key residency

Data может быть в multiple regions (latency), но encryption key — только в home region. Без key — data нечитаема.

**AWS KMS multi-region keys** — key replicated, но access controlled by region.

### Replication restrictions

Real-world примеры:
- **AWS Outposts** для on-premise sovereign data
- **AWS GovCloud** — отдельный (US-only) регион
- **Microsoft Sovereign Cloud** (Germany — закрылся, России — closed)

---

## Распределённый SQL (в стиле Spanner)

Современные распределённые SQL DB претендуют на «multi-region active-active с strong consistency»:

### Google Spanner

- TrueTime (atomic clocks)
- Multi-Paxos per data range
- External consistency (linearizable + serializability)
- Globally distributed
- ✗ Только в Google Cloud

### CockroachDB

- Open-source Spanner-like
- Raft per range (не Paxos)
- Hybrid Logical Clocks (HLC) — no atomic clocks
- Multi-region tables: replicate few in 3+ regions, leaseholder rotates по nearest
- Trade-off latency: cross-region write = 2-3 RT (vs Spanner ~1 RT due to TrueTime)

### YugabyteDB

- Похож на CockroachDB
- PostgreSQL wire compatibility (vs Cockroach's PG-compat но subset)
- Может работать как DocumentDB

### When to use

Распределённый SQL — когда:
- Нужна strong consistency multi-region
- Не хочется писать app-level conflict resolution
- ОК с network latency cost на каждый write

Не подходит:
- Read-heavy + eventual consistency OK → используй простой replication + cache
- Low-budget — Spanner / Cockroach expensive
- Существующий MySQL/PG — миграция сложная

---

## RPO / RTO

- **RPO (Recovery Point Objective)** — сколько данных можно потерять (в seconds/minutes)
- **RTO (Recovery Time Objective)** — за сколько восстановиться

| Topology | RPO | RTO |
|----------|-----|-----|
| Active-Passive async | 1-60 sec (replication lag) | 5-30 мин (failover) |
| Active-Passive sync | 0 (no data loss) | 5-30 мин |
| Active-Active | 0 (locally), some lag cross-region | 0 (other regions just work) |
| Spanner-like | 0 | 0 (consensus handles) |

---

## Соображения сети

**Cross-region bandwidth:** не free
- AWS inter-region transfer: $0.02-0.09 / GB
- Replication 1 TB / day = $20-90/day = $7K-30K/year

**Cross-region latency:** physical limit (speed of light + routing)
- Same region (multi-AZ): < 1 ms
- US East ↔ US West: 70 ms
- US ↔ EU: 80-150 ms
- US ↔ APAC: 150-300 ms

**Implication:** sync replication cross-region adds 2× latency per write. Async — eventual but no latency cost.

---

## Шаблоны переключения на резерв (failover)

### Manual failover

DBA (или runbook) initiates failover. Slow (15-60 min) but **less false positive** (no panic auto-switch).

### Automated failover

Health checker (heartbeats, deep probe) → if K consecutive fail → switch.

```
Sentinel/orchestrator:
  Every 5 sec: GET /health all regions
  If primary fails 3× in row → start failover:
    1. Pick best candidate (least lag, healthy)
    2. Promote candidate
    3. Update DNS / service discovery
    4. Wait for old primary to detect (fence with token)
```

**Risk:** flapping leader (network glitch → false failover). Hysteresis (требует N successful checks before considered healthy).

### Geo-DNS routing

DNS routing-policy переключает user requests в healthy region:

```
Route 53 / Cloudflare DNS:
  example.com:
    health check us-east primary
    if healthy → return us-east IP
    else → return eu-west IP
```

Latency: DNS TTL determines failover speed (60s TTL → ~ 1 min for global propagation).

---

## Анти-шаблоны

- **Synchronous replication cross-region** — каждый write 100ms+. Невыносимо для interactive apps.
- **Multi-region writes без conflict resolution** — silent data loss. Always plan.
- **«All in one region — that's good enough»** — пока not down. Test DR drills.
- **Manual failover only** — RTO часами при ночном incident.
- **Cross-region 2PC** — coordinator failures = stuck transactions; не делай без consensus protocol.
- **Active-active без understanding consistency model** — surprise data inconsistency после launch.
- **DNS routing only** — assumes DNS update is fast (NOT — TTL caches, ISP resolvers); use anycast IP backup.

---

## Примеры из продакшена

- **AWS DynamoDB Global Tables** — active-active multi-region, LWW conflict resolution
- **Aurora Global Database** — active-passive с promoted region option; RTO ~ 1 min
- **MongoDB Atlas Global Clusters** — region-affinity sharding
- **CockroachDB Multi-Region** — Raft + locality awareness, можно «pin» rows к региону
- **Cloudflare Workers** — edge compute global; storage Durable Objects pinned to region
- **Discord** — multi-region voice servers, central catalog DB
- **WhatsApp** — single global Erlang cluster (early days), now multi-region

---

## Источники

- *Designing Data-Intensive Applications* (Kleppmann, 2017) — Ch. 9 (Consensus), Ch. 5 (Replication)
- [Spanner paper (Corbett et al., 2012)](https://research.google/pubs/pub39966/) — TrueTime, external consistency
- [CockroachDB Multi-Region Documentation](https://www.cockroachlabs.com/docs/stable/multiregion-overview.html)
- [AWS Well-Architected — Reliability Pillar (Multi-Region)](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html)
- [GDPR Article 44](https://gdpr-info.eu/art-44-gdpr/) — international data transfers
- [Adidas Engineering — Going Active-Active](https://adidas-group.io/blog/) — case studies
- [Discord Engineering — Storage at Discord](https://discord.com/blog/) — Cassandra → ScyllaDB
- [GitHub blog — How we accidentally deleted our largest customers' data (2018)](https://github.blog/2018-10-30-oct21-post-incident-analysis/) — multi-region MySQL split-brain
