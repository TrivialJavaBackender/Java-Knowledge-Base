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

Один регион **primary**, остальные **standby**: получают реплицированные данные, не обслуживают трафик.

```
US-East (primary) — все writes и reads
  ↓ async replication
EU (passive)      — копия данных, idle servers
APAC (passive)    — копия
```

**Переключение на резерв:** при сбое US-East — продвижение EU в primary, переключение DNS, перезапуск сервисов.

- ✓ Просто: нет разрешения конфликтов
- ✓ Строгая согласованность (один primary)
- ✓ Неиспользуемая мощность (passive-регионы простаивают) — обратная сторона
- ✗ Высокий RTO (восстановление 5–30 минут)
- ✗ Для пользователей EU/APAC задержка = межрегиональная

### Active-Active (Hot-Hot)

**Каждый регион принимает записи и чтения.** Репликация peer-to-peer.

```
US-East ←→ EU ←→ APAC
   ↕         ↕         ↕
  Users    Users    Users
```

- ✓ Низкая задержка для всех пользователей (локальный регион)
- ✓ Нет неиспользуемой мощности
- ✓ Отказ региона не критичен (другие живут)
- ✗ **Разрешение конфликтов** при параллельных записях одного ключа
- ✗ Eventual consistency между регионами (типичная задержка 50–200 мс)
- ✗ Сложность в эксплуатации

### Hybrid (Active-Passive с edge cache)

Активен один регион, **CDN / read replicas** в других для локальных чтений.

```
US-East (writes + reads)
   ↓ async replicate
EU read replica (только reads, локальная latency)
APAC read replica
```

- ✓ Локальные чтения (но закэшированные, eventual)
- ✓ Низкая задержка для read-heavy приложений (новости, соцсети, контент)
- ✗ Записи идут в primary через другой регион (средняя задержка)
- Используется в: Instagram (early days), GitHub (есть read replicas в Asia), CDN-heavy apps

---

## Разрешение конфликтов в Active-Active

Когда два пользователя параллельно редактируют (или загружают) одну сущность в разных регионах.

### Last-Write-Wins (LWW)

Каждая запись имеет wall-clock timestamp. Победитель — наиболее свежая.

- ✓ Простой
- ✗ Зависит от clock sync (NTP — точность 1-10 ms; clock skew → потеря)
- ✗ Silent data loss

**Используют:** Cassandra (default), Riak, DynamoDB Global Tables.

### Application-Level Conflict Resolution

Конфликт возвращается клиенту, приложение решает (слияние, ручная проверка, бизнес-правила).

```
User A: добавил «apple» в корзину (region US)
User B (same user, mobile): добавил «banana» (region EU)

Replication detect conflict (same key, parallel writes):
  → store both versions ({apple}, {banana})
  → application reads both → merges → writes back {apple, banana}
```

- ✓ Потери данных нет
- ✗ Сложность приложения для каждого типа сущностей
- Используют: Riak, MV-Register в Cassandra

### CRDT-based

Math-guaranteed merge. См. [CRDT.md](CRDT.md).

### Sticky to source region (Region Affinity)

Пользователь привязан к региону (home region). Записи только туда, репликация к остальным — асинхронная.

```
User A (создан в EU) → all writes go to EU primary, reads from any region
User B (создан в US) → US primary
```

- ✓ Конфликтов нет (единственный писатель на сущность)
- ✓ Локальные чтения
- ✗ Межрегиональные записи для пользователей не в домашнем регионе (путешественники)
- Используют: Salesforce, custom enterprise apps

### Spanner / TrueTime — globally strong consistency

Google Spanner использует **TrueTime API** (GPS + атомарные часы) для ограниченной неопределённости времени (`~5 ms`). Ожидание `commit_timestamp + uncertainty` гарантирует строгую согласованность (linearizable) **без накладных расходов 2PC**.

- ✓ Глобальная строгая согласованность
- ✗ Требует специального железа (атомарные часы в каждом ЦОДе)
- ✗ Высокая стоимость
- Используют: только Google Spanner; CockroachDB и YugabyteDB имитируют без TrueTime (но менее строго)

---

## Локализация данных (GDPR и др.)

**GDPR Article 44**: персональные данные пользователей ЕС не могут покидать ЕС без надлежащей защиты.

**Реализация:**

### Geo-sharding по user.region

Пользователь имеет `home_region` (устанавливается при регистрации, на основе IP/настройки). Все данные пользователя — в этом регионе.

```
User (region=EU):
  user_id=123, email=..., posts=[...]  → stored only in EU region
  
Cross-region query:
  "Show me posts by user 123" → query goes to EU region
```

### Encryption + key residency

Данные могут быть в нескольких регионах (ради задержки), но ключ шифрования — только в домашнем регионе. Без ключа данные нечитаемы.

**AWS KMS multi-region keys** — ключ реплицируется, но доступ управляется по региону.

### Replication restrictions

Примеры из реальной практики:
- **AWS Outposts** для on-premise sovereign data
- **AWS GovCloud** — отдельный (US-only) регион
- **Microsoft Sovereign Cloud** (Germany — закрылся, России — closed)

---

## Распределённый SQL (в стиле Spanner)

Современные распределённые SQL СУБД претендуют на «multi-region active-active со строгой согласованностью»:

### Google Spanner

- TrueTime (атомарные часы)
- Multi-Paxos per data range
- Внешняя согласованность (строгая согласованность + сериализуемость)
- Глобально распределённая
- ✗ Только в Google Cloud

### CockroachDB

- Open-source Spanner-like
- Raft per range (не Paxos)
- Hybrid Logical Clocks (HLC) — без атомарных часов
- Multi-region tables: реплицируются в 3+ регионах, leaseholder ротируется к ближайшему
- Компромисс по задержке: межрегиональная запись = 2–3 RT (против ~1 RT у Spanner благодаря TrueTime)

### YugabyteDB

- Похож на CockroachDB
- Совместимость с PostgreSQL wire protocol (против Cockroach PG-compat, но неполный subset)
- Может работать как DocumentDB

### Когда использовать

Распределённый SQL — когда:
- Нужна строгая согласованность в multi-region
- Не хочется писать разрешение конфликтов на уровне приложения
- Допустимы затраты на сетевую задержку при каждой записи

Не подходит:
- Read-heavy + eventual consistency OK → используй простую репликацию + кэш
- Ограниченный бюджет — Spanner / Cockroach дорогие
- Существующий MySQL/PG — миграция сложная

---

## RPO / RTO

- **RPO (Recovery Point Objective)** — сколько данных можно потерять (в секундах/минутах)
- **RTO (Recovery Time Objective)** — за сколько восстановиться

| Топология | RPO | RTO |
|----------|-----|-----|
| Active-Passive async | 1–60 сек (задержка репликации) | 5–30 мин (переключение на резерв) |
| Active-Passive sync | 0 (без потерь данных) | 5–30 мин |
| Active-Active | 0 (локально), небольшая задержка между регионами | 0 (другие регионы продолжают работу) |
| Spanner-like | 0 | 0 (консенсус обеспечивает) |

---

## Соображения сети

**Межрегиональная пропускная способность канала:** не бесплатна
- AWS inter-region transfer: $0.02–0.09 / ГБ
- Репликация 1 ТБ / день = $20–90/день = $7K–30K/год

**Межрегиональная задержка:** физический предел (скорость света + маршрутизация)
- Тот же регион (multi-AZ): < 1 мс
- US East ↔ US West: 70 мс
- US ↔ EU: 80–150 мс
- US ↔ APAC: 150–300 мс

**Следствие:** синхронная репликация между регионами добавляет 2× задержку на каждую запись. Асинхронная — eventual, но без потерь в задержке.

---

## Шаблоны переключения на резерв (failover)

### Ручное переключение на резерв

DBA (или runbook) инициирует переключение на резерв. Медленно (15–60 мин), но **меньше ложных срабатываний** (без паники от авто-переключения).

### Автоматическое переключение на резерв

Health checker (heartbeats, deep probe) → при K подряд неудачах → переключение.

```
Sentinel/orchestrator:
  Every 5 sec: GET /health all regions
  If primary fails 3× in row → start failover:
    1. Pick best candidate (least lag, healthy)
    2. Promote candidate
    3. Update DNS / service discovery
    4. Wait for old primary to detect (fence with token)
```

**Риск:** нестабильный лидер (сетевой сбой → ложное переключение). Гистерезис (требует N успешных проверок перед признанием узла здоровым).

### Geo-DNS routing

DNS routing-policy переключает запросы пользователей в работоспособный регион:

```
Route 53 / Cloudflare DNS:
  example.com:
    health check us-east primary
    if healthy → return us-east IP
    else → return eu-west IP
```

Задержка: DNS TTL определяет скорость переключения на резерв (TTL 60 сек → ~1 мин на глобальное распространение).

---

## Анти-шаблоны

- **Синхронная репликация между регионами** — каждая запись 100+ мс. Невыносимо для интерактивных приложений.
- **Multi-region записи без разрешения конфликтов** — незаметная потеря данных. Всегда планируй заранее.
- **«Один регион — и достаточно»** — до тех пор, пока не упал. Регулярно тренируй аварийное восстановление.
- **Только ручное переключение на резерв** — RTO часами при ночном инциденте.
- **Межрегиональный 2PC** — сбой координатора = зависшие транзакции; не делай без протокола консенсуса.
- **Active-active без понимания модели согласованности** — неожиданная рассогласованность данных после запуска.
- **Только DNS-маршрутизация** — предполагает быстрое обновление DNS (НЕТ — TTL кэши, резолверы ISP); используй anycast IP как резерв.

---

## Примеры из продакшена

- **AWS DynamoDB Global Tables** — active-active multi-region, LWW conflict resolution
- **Aurora Global Database** — active-passive с promoted region option; RTO ~ 1 min
- **MongoDB Atlas Global Clusters** — region-affinity sharding
- **CockroachDB Multi-Region** — Raft + locality awareness, можно «pin» rows к региону
- **Cloudflare Workers** — глобальные вычисления на пограничных узлах; хранилище Durable Objects привязано к региону
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
