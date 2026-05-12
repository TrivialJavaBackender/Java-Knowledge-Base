# Distributed Systems

## Distributed Lock (Redis / Redisson)

In-memory `synchronized` не работает при нескольких инстансах. Нужен распределённый lock.

```java
RLock lock = redisson.getLock("reservation:table:" + tableId + ":date:" + date);
try {
    if (lock.tryLock(3, 5, TimeUnit.SECONDS)) { // ждём 3с, держим 5с
        // check + save
    } else {
        throw new NoAvailableTimeSlotException("System busy, retry");
    }
} finally {
    lock.unlock();
}
```

Гранулярность ключа `table:{id}:date:{date}` — разные столы не блокируют друг друга.

**Проблема Redlock:** при network partition два процесса могут одновременно считать себя владельцами лока. Для большинства задач допустимо при наличии database constraint как страховки.

---

## Idempotency Key

Клиент генерирует уникальный ключ (UUID) и передаёт с каждым запросом. Сервер хранит `(key → result)` в Redis с TTL.

```
Client → POST /reservations {idempotencyKey: "uuid-123", ...}
Server: ключ есть в Redis? → вернуть сохранённый результат
Server: ключа нет? → создать резервацию, сохранить результат в Redis с TTL
```

Защищает от дублей при retry после network timeout — клиент не знает, дошёл ли запрос.

---

## Outbox Pattern

**Проблема:** INSERT в БД и публикация события в Kafka — две операции. Сбой между ними = потеря события или дубль.

```
Без outbox:
INSERT reservation; -- успех
publish to Kafka;   -- сбой → событие потеряно

С outbox:
BEGIN;
INSERT INTO reservations ...;
INSERT INTO outbox_events (type='RESERVATION_CREATED', payload=...); -- в одной транзакции
COMMIT; -- атомарно

-- Отдельный процесс читает outbox и публикует в Kafka (at-least-once)
```

Outbox + идемпотентный consumer = exactly-once семантика.

---

## CQRS (Command Query Responsibility Segregation)

Разделение на write-side (команды) и read-side (запросы).

```
Write side: POST /reservations → PostgreSQL (строгая консистентность, блокировки)
Read side:  GET /availability  → Redis cache (денормализованный, быстро, eventual consistency)
```

Запись инвалидирует или обновляет кэш. Чтение никогда не идёт в основную БД.

---

## Clock Skew

`LocalDate.now()` на разных инстансах может вернуть разное значение из-за рассинхронизации часов или разных таймзон.

**Решение:** дата всегда приходит от клиента, сервер её не генерирует. Или централизованное время через NTP + monotonic clock.

---

## CAP Theorem

> «In a distributed data store you can only have 2 out of 3 of: Consistency, Availability, Partition Tolerance» — Eric Brewer, PODC 2000 keynote.

Распределённая система может гарантировать только 2 из 3:
- **C**onsistency — все узлы видят одинаковые данные (точнее: linearizability)
- **A**vailability — каждый запрос получает ответ
- **P**artition Tolerance — система работает при сетевом разрыве

При network partition нужно выбирать между CP (жертвуем доступностью) и AP (жертвуем консистентностью). P отказаться нельзя — сеть всегда может упасть.

**Практика:** большинство NoSQL баз — AP (eventual consistency). PostgreSQL в кластере — CP.

**Уточнение от самого Brewer (2012):** «CAP — это упрощение. На практике partitions редки, и важнее как система ведёт себя в **отсутствие partition'ов** — потому что 99.99% времени всё работает. CAP не отвечает на этот вопрос.»

---

## PACELC — расширение CAP

Daniel Abadi (2010) дополнил CAP: при отсутствии partition (`Else`) система всё равно делает trade-off между **L**atency и **C**onsistency.

```
IF partition (P) THEN     A or C ?       // CAP-выбор
ELSE                      L or C ?       // PACELC-выбор
```

| Система | При partition | Иначе |
|---------|---------------|-------|
| PostgreSQL (single primary) | **PC** (refuse writes) | **EC** (consistency, sync replication) |
| Cassandra (default) | **PA** | **EL** (быстрее, eventual) |
| DynamoDB | **PA** | **EL** (или EC при strongly consistent reads, дороже) |
| Spanner | **PC** | **EC** (TrueTime даёт consistency почти без latency-цены) |
| MongoDB (default) | **PA** (после Raft в 4.x — PC) | **EC** для primary reads |

PACELC объясняет, почему «AP-системы» не теряют consistency только при partition — они платят eventual consistency **постоянно**, ради низкой latency.

---

## Quorum: R + W > N

Классический trade-off в Dynamo-style системах (Cassandra, Riak): из `N` реплик читай с `R`, пиши на `W`. Если `R + W > N` — read и write пересекаются хотя бы в одной реплике, значит чтение увидит последнюю запись.

```
N=3, W=2, R=2 → R+W=4 > 3 → strong consistency, выдержит падение 1 узла
N=3, W=1, R=1 → R+W=2 ≤ 3 → eventual, максимальный throughput
N=3, W=3, R=1 → write-all/read-one — медленные записи, быстрые чтения
N=3, W=1, R=3 → быстрые записи, медленные чтения (анти-pattern для write-heavy)
```

**Sloppy quorum + hinted handoff** (Dynamo): если W узлов недоступны, запись идёт на «соседей» с пометкой передать настоящему владельцу позже. Жертвует строгим quorum'ом ради availability.

---

## Lamport Timestamps & Vector Clocks

Без глобальных часов как сравнить порядок событий на разных узлах? Lamport (1978) предложил логические часы:

**Lamport timestamp** — счётчик `L` на каждом узле:
- Локальное событие: `L = L + 1`
- Отправка сообщения: добавить `L` к сообщению
- Получение сообщения с `L_msg`: `L = max(L, L_msg) + 1`

Гарантирует: если `A → B` (causally), то `L(A) < L(B)`. Но обратное **не верно** — два события с разными timestamp'ами могут быть concurrent.

**Vector clocks** решают: каждый узел держит вектор `[L_node1, L_node2, ...]`. Сравнение векторов даёт точный partial order: A → B, B → A, или concurrent.

**Где это в проде:**
- Cassandra использует **last-write-wins** на основе wall-clock timestamp'ов (упрощение, может терять конкурентные записи).
- Riak / Voldemort — vector clocks, конфликты разрешает приложение.
- Postgres logical replication — LSN (log sequence number), вариант Lamport-clock'а.

---

## Eventual Consistency vs Strong Consistency

**Strong consistency** (linearizable: PostgreSQL, ZooKeeper, Spanner): после записи все читают актуальные данные. Цена — latency и availability.

**Eventual consistency** (Cassandra, DynamoDB, Redis cache): данные рано или поздно синхронизируются. Читающий может увидеть старое значение. Цена — сложность обработки конфликтов.

**Между ними — целый спектр** (Adya, 2000):
- **Read-your-writes** — пользователь видит свои собственные обновления (sticky session или чтение с primary).
- **Monotonic reads** — нельзя «откатиться назад» во времени (читать всегда с одной реплики или с timestamp'ом-границей).
- **Causal consistency** — если A → B, то все видят их в этом порядке (vector clocks).
- **Bounded staleness** — отставание не больше X секунд / N версий (Cosmos DB).

**Где допустима eventual consistency:** availability-виджет, лента новостей, счётчики просмотров.

**Где нужна strong consistency:** баланс счёта, инвентарь, резервации.

---

## Real-world failures — чему учиться

- **GitHub MySQL split-brain (2018-10-21)** — сетевой обрыв 43 секунды между East/West coast привёл к тому, что оба primary приняли записи. Восстановление заняло 24 часа, ~4% данных за окно требовали ручного reconciliation. Постмортем: важность Orchestrator/RAFT-based failover, отказ от auto-failover при cross-region partition.  
  → [GitHub blog — «October 21 post-incident analysis»](https://github.blog/2018-10-30-oct21-post-incident-analysis/)
- **AWS DynamoDB outage (2015-09-20)** — metadata-сервис не справился с volume запросов после восстановления, всё us-east-1 деградировало на 5 часов. Урок: graceful degradation вместо hard failure.  
  → [AWS Service Health Dashboard postmortem](https://aws.amazon.com/message/5467D2/)
- **Cloudflare Quicksilver (2020-07-17)** — bad config push размножился по всему миру за секунды (нет staged rollout) → 27-минутный глобальный outage.  
  → [Cloudflare blog — «July 17, 2020 — Cloudflare outage»](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/)
- **Knight Capital (2012)** — rolling deployment на 8 серверов, на одном остался старый dead-code flag → $440M потери за 45 минут. Не distributed-incident в строгом смысле, но классика как НЕ катить.  
  → [«A 45-minute, $440M loss» (postmortem reconstruction)](https://www.henricodolfing.ch/en/project-failure-case-studies/)

---

## SAGA — coordinated transactions across services

Подробнее в [`microservice_patterns.md`](microservice_patterns.md). Ключевая идея: вместо 2PC (блокирующего) — последовательность локальных транзакций с компенсирующими действиями. Choreography (события) vs Orchestration (центральный координатор).

---

## Источники

**Books:**
- *Designing Data-Intensive Applications* (Martin Kleppmann, O'Reilly 2017) — Ch. 5 (Replication), Ch. 8 (The Trouble with Distributed Systems), Ch. 9 (Consistency and Consensus). **Главный источник для всех тем выше.**
- *Distributed Systems*, 3rd ed. (Maarten van Steen, Andrew Tanenbaum, 2017, [бесплатный PDF](https://www.distributed-systems.net/index.php/books/ds3/)) — академический фундамент.
- *Database Internals* (Alex Petrov, O'Reilly 2019) — Part II про consensus и replication.

**Papers:**
- [Lamport (1978) — «Time, Clocks, and the Ordering of Events in a Distributed System» (CACM)](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
- [Brewer (2012) — «CAP Twelve Years Later: How the Rules Have Changed» (Computer)](https://sites.cs.ucsb.edu/~rich/class/cs293-cloud/papers/Brewer_podc_keynote_2000.pdf)
- [Abadi (2012) — «Consistency Tradeoffs in Modern Distributed Database System Design» (Computer)](http://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf) — оригинал PACELC.
- [Adya (1999) — «Weak Consistency: A Generalized Theory and Optimistic Implementations for Distributed Transactions» (PhD thesis, MIT)](https://pmg.csail.mit.edu/papers/adya-phd.pdf) — классификация всех уровней consistency.
- [DeCandia et al. (2007) — «Dynamo: Amazon's Highly Available Key-value Store» (SOSP)](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) — quorum, vector clocks, hinted handoff.
- [Corbett et al. (2012) — «Spanner: Google's Globally-Distributed Database» (OSDI)](https://research.google/pubs/pub39966/) — TrueTime API.

**Engineering / talks:**
- [Jepsen — analyses of distributed databases](https://jepsen.io/analyses) — реальные тесты consistency-гарантий (Postgres, Cassandra, MongoDB, etcd, …).
- [Kyle Kingsbury (Aphyr) — «Strong Consistency models»](https://aphyr.com/posts/313-strong-consistency-models) — наглядная классификация.
- [Martin Kleppmann — «A Critique of the CAP Theorem» (talk + paper)](https://arxiv.org/pdf/1509.05393)
- [«Notes on Distributed Systems for Young Bloods» (Jeff Hodges)](https://www.somethingsimilar.com/2013/01/14/notes-on-distributed-systems-for-young-bloods/) — короткие практические уроки.
