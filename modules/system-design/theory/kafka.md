# Apache Kafka

## Ключевые концепции

```
Producer → [Topic: orders] → Consumer Group
               │
          ┌────┴────┐
     Partition 0  Partition 1  Partition 2
     [msg1]       [msg2]       [msg3]
     [msg4]       [msg5]
     [msg6]
```

**Topic** — логический канал сообщений. Разбит на **partitions**.  
**Partition** — упорядоченный, иммутабельный лог. Каждое сообщение получает монотонно растущий **offset**.  
**Consumer Group** — группа потребителей, каждую партицию читает ровно один consumer группы.  
**Broker** — сервер Kafka. Обычно кластер из 3+ брокеров.  
**Replication Factor** — сколько копий каждой партиции хранится. RF=3 → выдержит падение 2 брокеров.

---

## Гарантия порядка сообщений

**Порядок гарантирован внутри одной партиции.** Между партициями — нет.

```
Producer отправляет: order:A → partition 0
Producer отправляет: order:B → partition 0
Consumer читает partition 0: order:A, затем order:B ✓

Producer отправляет: order:A → partition 0
Producer отправляет: order:B → partition 1
Порядок между A и B НЕ гарантирован ✗
```

**Как обеспечить порядок для связанных сообщений:**
```java
// Указать ключ — все сообщения с одним ключом → одна и та же партиция
producer.send(new ProducerRecord<>("orders", userId, orderEvent));
// partition = hash(key) % numPartitions
```

Все события одного пользователя (один `userId`) → всегда одна партиция → гарантированный порядок.

**Проблема:** если партиций больше, чем активных пользователей → некоторые партиции пустые.  
**Проблема:** при добавлении партиций перераспределение ключей → один пользователь может попасть в другую партицию.

---

## Гарантии доставки

### At Most Once (максимум один раз)

Сообщение может потеряться, но никогда не дублируется.

```
Producer: send → Broker
Consumer: commit offset СРАЗУ, потом обрабатывает
→ Если упал после commit, до обработки → сообщение потеряно
```

**Настройка producer:** `acks=0` (не ждёт подтверждения от брокера).  
**Когда:** метрики, non-critical логи, где потеря допустима.

### At Least Once (минимум один раз) — дефолт

Сообщение доставлено минимум один раз. Дублирование возможно.

```
Producer: send → Broker подтвердил (acks=1 или all)
Consumer: обработать → commit offset
→ Если упал после обработки, до commit → при рестарте читает снова → дубль
```

**Настройка producer:** `acks=1` или `acks=all`, `retries > 0`.  
**Требование:** consumer должен быть **идемпотентным** (обработка одного сообщения дважды = тот же результат).  
**Идемпотентность:** хранить обработанные ID и игнорировать дубли, или операция от природы идемпотентна (INSERT ON CONFLICT DO NOTHING, SET value = X).

### Exactly Once (ровно один раз)

Сложнее всего — ни потерь, ни дублей.

**Idempotent Producer** (гарантия от producer-side дублей):
```java
props.put("enable.idempotence", true);
// Каждый producer получает PID, каждое сообщение — sequence number
// Broker дедуплицирует: если seq_num уже видел → игнорирует
```
Защищает от дублей из-за retry producer'а, но не защищает от дублей на стороне consumer.

**Transactional Producer + Consumer** (end-to-end exactly once):
```java
// Producer
props.put("transactional.id", "my-transactional-producer");
producer.initTransactions();
producer.beginTransaction();
producer.send(record1);
producer.send(record2);
producer.commitTransaction(); // атомарно
// или producer.abortTransaction();
```

```java
// Consumer: читать только закоммиченные сообщения
props.put("isolation.level", "read_committed");
```

**Kafka Streams exactly-once:** consume + transform + produce атомарно. Настраивается через `processing.guarantee=exactly_once_v2`.

**Ограничения exactly-once:**
- Только внутри Kafka (producer → broker → consumer → producer другого топика)
- При записи в внешние системы (БД, API) — нужна идемпотентность на стороне этих систем

---

## Consumer Group — балансировка

```
Topic: 3 partitions, Consumer Group: 3 consumers
C1 → P0
C2 → P1
C3 → P2   ← идеально, 1:1

Consumer Group: 2 consumers
C1 → P0, P1   ← C1 читает две партиции
C2 → P2

Consumer Group: 4 consumers
C1 → P0
C2 → P1
C3 → P2
C4 → (idle)   ← лишний consumer ничего не читает
```

**Rebalance** — при добавлении/удалении consumer перераспределяются партиции. Во время rebalance потребление останавливается. Решение: Cooperative Sticky Assignor (минимально перемещает партиции).

---

## Retention и Log Compaction

**Retention by time:** `retention.ms=604800000` (7 дней — дефолт). Старые сообщения удаляются.

**Retention by size:** `retention.bytes` — удалять если размер партиции превышает лимит.

**Log Compaction** — для топиков типа "last value per key". Kafka хранит только последнее сообщение с каждым ключом.

```
До compaction:  [key=A,v=1] [key=B,v=1] [key=A,v=2] [key=B,v=2] [key=A,v=3]
После:          [key=B,v=2] [key=A,v=3]
```

**Применение:** снимки состояния (changelog topics в Kafka Streams), таблицы Reference Data.  
Tombstone: сообщение с `null`-значением удаляет ключ после compaction.

---

## Schema Evolution и Schema Registry

### Проблема

Producer и Consumer релизятся независимо. Схема сообщения (event'а) меняется со временем — добавляются поля, переименовываются, разбиваются. В логе одновременно живут события **разных версий**, а consumer'ы тоже могут быть разных версий.

```java
// Версия 1
record OrderCreated(UUID orderId, String item, int quantity) {}

// Версия 2: добавили price
record OrderCreated(UUID orderId, String item, int quantity, BigDecimal price) {}
```

Старые события в логе не имеют `price` — как читать их новым кодом? Старый consumer падает на новых событиях с `price`?

### Backward Compatibility (обратная совместимость)

**Новый код читает старые данные.**

Правила:
- Добавлять поля с дефолтным значением — OK
- Удалять обязательные поля — нарушение
- Переименовывать поля — нарушение
- Менять тип поля — нарушение

```java
// Backward compatible: новое поле опционально
record OrderCreated(UUID orderId, String item, int quantity,
                    @Nullable BigDecimal price) {}  // null для старых событий
```

### Forward Compatibility (прямая совместимость)

**Старый код читает новые данные.**

Правила:
- Старый код должен игнорировать неизвестные поля
- Jackson по умолчанию **не** игнорирует — бросает `UnrecognizedPropertyException`
- Решение: `@JsonIgnoreProperties(ignoreUnknown = true)` на всех event-классах

```java
@JsonIgnoreProperties(ignoreUnknown = true)
record OrderCreated(UUID orderId, String item, int quantity) {}
// Новое поле price в JSON → игнорируется старым кодом ✓
```

### Full / Transitive

- **Full** = backward + forward одновременно (новый ↔ старый в обе стороны).
- **Transitive** — совместимость между N версиями, а не только между соседними (v1 ↔ v5, не только v4 ↔ v5).

### Стратегии версионирования

**1. Upcasting** — трансформация raw event до десериализации:
```java
// EventStore читает raw bytes, применяет upcaster, потом десериализует
class OrderCreatedUpcaster {
    Map<String, Object> upcast(Map<String, Object> event, int fromVersion) {
        if (fromVersion == 1) {
            event.put("price", BigDecimal.ZERO); // дефолт для старых событий
        }
        return event;
    }
}
```
Применяется когда weak-schema (Avro/Protobuf) не используется или нужна сложная миграция (разбить старое поле на два, переименовать).

**2. Weak schema (Avro, Protobuf)** — схема задаёт правила эволюции:

- **Protobuf**: поля идентифицируются числами (field numbers), а не именами. Можно добавлять новые поля, нельзя менять номер существующего, нельзя переиспользовать удалённый номер. Имя поля менять можно (на wire только номер).
- **Avro**: writer schema (использовалась при записи) + reader schema (ожидает читатель) → автоматическое преобразование через Schema Resolution. Поля без default → required, иначе → optional.

**3. Параллельные поля** — старое и новое поле одновременно, постепенная миграция:
```java
record OrderCreated(UUID orderId, String item, int quantity,
                    String currency,           // новое
                    BigDecimal price,          // новое
                    @Deprecated String amount) // старое, удалить в следующем релизе
```

**4. Версионирование типа события** — разные классы для разных версий:
```java
class OrderCreatedV1 { ... }
class OrderCreatedV2 { ... }
// EventStore хранит type = "OrderCreated", version = 2
```
Подход уживается с upcasting (V1 апкастится в V2 при чтении).

### Confluent Schema Registry

Централизованное хранение Avro / Protobuf / JSON Schema. При публикации в Kafka:
1. Producer регистрирует схему в Registry → получает `schema-id`
2. В payload отправляется `[schema-id (4 bytes)] + [serialized bytes]`
3. Consumer читает schema-id → подтягивает writer schema → применяет resolution к своей reader schema

Режимы совместимости (настраиваются на subject = topic-name):
- `BACKWARD` — новая схема может читать данные, записанные старой (default)
- `FORWARD` — старая схема может читать данные новой
- `FULL` — оба направления
- `NONE` — без проверок
- Любой из них с суффиксом `_TRANSITIVE` — проверка против **всех** прошлых версий, не только последней

**Контекст использования** — schema evolution особенно критична в Event Sourcing, где события в логе живут годами. См. [microservice_patterns.md → Event Sourcing](microservice_patterns.md#event-sourcing).

---

## Producer настройки

```java
// Надёжность
props.put("acks", "all");          // ждать подтверждения от всех ISR (in-sync replicas)
props.put("retries", 3);
props.put("retry.backoff.ms", 100);

// Батчинг (throughput vs latency)
props.put("batch.size", 16384);    // размер батча (16KB)
props.put("linger.ms", 5);         // ждать 5ms для накопления батча

// Идемпотентность
props.put("enable.idempotence", true); // автоматически ставит acks=all, retries=Integer.MAX
```

**acks=0:** fire-and-forget, максимальный throughput, возможна потеря.  
**acks=1:** лидер записал, реплики могут не успеть (при падении лидера — потеря).  
**acks=all (или -1):** все ISR записали → максимальная надёжность, выше latency.

---

## Kafka vs другие очереди

| | Kafka | RabbitMQ | Amazon SQS |
|---|---|---|---|
| Модель | Pull (consumer тянет) | Push (брокер толкает) | Pull |
| Retention | Дни/недели, replay | Удаляет после ACK | До 14 дней |
| Порядок | Внутри партиции | Очередь FIFO (1 consumer) | Без гарантий |
| Пропускная способность | Очень высокий | Средний | Высокий (managed) |
| Replay | Да (перемотать offset) | Нет | Нет |
| Паттерн | Event streaming, log | Task queue, routing | Decoupling сервисов |

---

## High Availability

### Репликация партиций

Каждая партиция имеет **leader** (один) и **followers** (реплики). Записи идут только на leader, followers синхронизируются.

```
Topic: orders, 3 partitions, replication factor = 3

Partition 0:  Leader → Broker 1,  Follower → Broker 2, Broker 3
Partition 1:  Leader → Broker 2,  Follower → Broker 1, Broker 3
Partition 2:  Leader → Broker 3,  Follower → Broker 1, Broker 2
```

**ISR (In-Sync Replicas)** — набор реплик, которые достаточно синхронизированы с лидером.

```java
// Реплика попадает в ISR если отстаёт не более чем на:
replica.lag.time.max.ms=30000  // 30 секунд (дефолт)
```

Реплика, которая не успевает → выпадает из ISR. Когда догоняет → возвращается.

### acks + ISR = гарантии надёжности

```java
// acks=all: лидер ждёт подтверждения от всех ISR перед ответом producer'у
props.put("acks", "all");

// min.insync.replicas: минимальное число реплик в ISR для приёма записи
// Устанавливается на уровне топика или брокера:
min.insync.replicas=2

// При RF=3, min.insync.replicas=2:
// → выдержит падение 1 брокера (2 из 3 в ISR)
// → если в ISR меньше 2 реплик → producer получает NotEnoughReplicasException
```

**Рекомендуемая конфигурация для надёжности:**
- `replication.factor=3`
- `min.insync.replicas=2`
- `acks=all` (или `-1`)
- `enable.idempotence=true`

### Leader Election

При падении брокера-лидера Kafka автоматически выбирает нового лидера из ISR.

```
Broker 1 (leader P0) падает
→ Kafka Controller выбирает нового лидера из ISR(P0) — например, Broker 2
→ Producer/Consumer переключаются на Broker 2
→ Время failover: секунды (зависит от zookeeper.session.timeout.ms)
```

**Unclean leader election** (`unclean.leader.election.enable=false` — дефолт и рекомендация):
- `false` — только ISR-реплика может стать лидером (нет потери данных, но возможен downtime если ISR пустой)
- `true` — любая реплика может стать лидером (нет downtime, но возможна потеря данных)

### KRaft (Kafka без ZooKeeper)

До Kafka 3.3: метаданные хранились в **ZooKeeper** — отдельный distributed coordination сервис.

**Проблемы ZooKeeper:**
- Дополнительная инфраструктура для эксплуатации
- Ограничение: ~200K партиций на кластер
- Медленная регистрация партиций

**KRaft (Kafka 3.3+, production-ready):** метаданные хранятся во внутреннем Raft-лог топике `__cluster_metadata`. Controller nodes выбирают лидера через Raft consensus.

```
ZooKeeper mode: Kafka Brokers + ZooKeeper ensemble (3-5 узлов)
KRaft mode:     Kafka Brokers (часть из них — Controllers, остальные — Brokers)
```

**Преимущества KRaft:** проще операционно, поддерживает миллионы партиций, быстрее failover.

### Consumer Group Failover

```
Consumer C1 падает → Group Coordinator обнаруживает через heartbeat timeout
→ Rebalance: партиции C1 переназначаются C2 и C3
→ C2, C3 начинают читать с последнего committed offset C1
→ Возможны дубли (between last commit and C1 crash) → нужна идемпотентность
```

**Настройки:**
```java
session.timeout.ms=45000         // таймаут heartbeat (считается мёртвым)
heartbeat.interval.ms=3000       // как часто слать heartbeat
max.poll.interval.ms=300000      // макс время между poll() (долгая обработка → rebalance)
```

---

## Источники

**Официальная документация / KIPs:**
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/) — protocol, configuration reference, design.
- [KIP-98: Exactly Once Delivery and Transactional Messaging](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging) — как именно работает idempotent + transactional producer.
- [KIP-500: Replace ZooKeeper with a Self-Managed Metadata Quorum (KRaft)](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500%3A+Replace+ZooKeeper+with+a+Self-Managed+Metadata+Quorum)
- [KIP-429: Cooperative Sticky Assignor](https://cwiki.apache.org/confluence/display/KAFKA/KIP-429%3A+Kafka+Consumer+Incremental+Rebalance+Protocol) — почему rebalance стал быстрее.

**Книги / talks:**
- *Kafka: The Definitive Guide*, 2nd ed. (Gwen Shapira, Todd Palino, Rajini Sivaram, Krit Petty, O'Reilly 2021).
- *Designing Event-Driven Systems* (Ben Stopford, Confluent / O'Reilly, бесплатно) — паттерны Outbox, CDC, event-driven architecture.
- [Jay Kreps — «The Log: What every software engineer should know about real-time data's unifying abstraction»](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying) — концептуальная статья от соавтора Kafka.

**Engineering blogs:**
- [Confluent Engineering Blog](https://www.confluent.io/blog/) — глубокие посты про exactly-once, KRaft, tiered storage.
- [Jepsen — Kafka analyses](https://jepsen.io/analyses) — какие именно гарантии Kafka реально даёт под partitioning.
- [Apache Kafka Improvement Proposals (KIPs)](https://cwiki.apache.org/confluence/display/KAFKA/Kafka+Improvement+Proposals) — все будущие изменения протокола.

**Schema evolution:**
- [Confluent — Schema Compatibility Types](https://docs.confluent.io/platform/current/schema-registry/avro.html#schema-evolution-and-compatibility) — `BACKWARD`, `FORWARD`, `FULL`, `TRANSITIVE`.
- [Apache Avro — Schema Resolution](https://avro.apache.org/docs/1.11.1/specification/#schema-resolution)
- [Protocol Buffers — Updating A Message Type](https://protobuf.dev/programming-guides/proto3/#updating)
