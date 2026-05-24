# Design Problem: Payment / Ledger System

Финансовые транзакции — double-entry bookkeeping, идемпотентность, consistency, аудит. PayPal, Stripe, любые fintech.

---

## 1. Requirements

### Functional
- Переводы денег между счетами
- Учёт балансов
- История транзакций / audit log
- Откаты / возвраты
- Multi-currency

### Non-functional
- **Strong consistency** — деньги не дублируются и не теряются
- **Idempotency** — retry-safe (двойной charge категорически недопустим)
- **Audit log** — каждая транзакция traceable
- **Compliance** — регуляторные требования (PCI-DSS, SOX)
- **High availability** — 99.99%+

---

## 2. Estimation

```
10M пользователей, 1M транзакций/день
Пик: 1000 TPS (Black Friday: ×10 burst)
Storage: 1B транзакций × 1 КБ = 1 ТБ (с индексами ~5 ТБ)
```

---

## 3. Double-Entry Bookkeeping

Каждая транзакция = **2 ledger entries** (debit + credit). Баланс всегда = сумма entries.

```
Alice отправляет Bob $100:

ledger_entries:
  txn_id=tx-1, account=Alice, amount=-100, ts=now
  txn_id=tx-1, account=Bob, amount=+100, ts=now

Инвариант: SUM(amount) по обеим записям = 0 (деньги не создаются и не теряются)
```

Balance не хранится денормализованно — вычисляется (или материализуется).

### Зачем double-entry

- **Self-correcting** — сумма должна быть 0; любой дисбаланс = баг
- **Audit-friendly** — у каждой операции есть пара записей
- Стандарт в бухгалтерии с XV века

---

## 4. Data Model

```sql
-- Источник истины — append-only
CREATE TABLE ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    transaction_id UUID,            -- группирует пару debit/credit
    account_id BIGINT,
    amount BIGINT,                  -- В МАЛЫХ ЕДИНИЦАХ (центы); никогда не float!
    currency CHAR(3),
    type ENUM('debit', 'credit'),
    created_at TIMESTAMPTZ DEFAULT now(),
    metadata JSONB                  -- описание, reference и т. п.
);

CREATE INDEX idx_account_time ON ledger_entries(account_id, created_at DESC);
CREATE INDEX idx_txn_id ON ledger_entries(transaction_id);

-- Материализованный баланс (для быстрых чтений)
CREATE TABLE account_balances (
    account_id BIGINT PRIMARY KEY,
    balance BIGINT,
    currency CHAR(3),
    updated_at TIMESTAMPTZ,
    version BIGINT                  -- optimistic locking
);

-- Идемпотентность
CREATE TABLE idempotency_keys (
    key VARCHAR(64) PRIMARY KEY,
    transaction_id UUID,
    response_body JSONB,
    created_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);
```

**Критично:** деньги — **целые числа** (центы), не float. `0.1 + 0.2 != 0.3` в floating point.

---

## 5. Transaction flow

```
POST /api/v1/transfers
Headers: Idempotency-Key: abc-123
Body: { fromAccount, toAccount, amount, currency, description }

Сервер:
  1. Проверить Idempotency-Key
     если есть → вернуть закэшированный ответ (не обрабатываем повторно)

  2. Begin transaction (БД)
     a. Заблокировать оба счёта (SELECT FOR UPDATE, либо optimistic с version)
     b. Проверить from.balance >= amount
     c. Вставить ledger entries (txn_id=tx_xyz):
        (from, -amount, debit)
        (to, +amount, credit)
     d. Обновить account_balances (decrement from, increment to)
     e. Persist ответ в idempotency_keys
     f. Commit

  3. Async-события в Kafka:
     transaction_completed → notify обоим пользователям, аналитика

  4. Return 200 { transactionId, status: "completed", balanceAfter }
```

---

## 6. Идемпотентность

Критично для предотвращения двойных списаний.

```
Клиент генерирует UUID per запрос, шлёт как Idempotency-Key

Сервер:
  если redis.get(key): возвращаем кэш
  
  Иначе:
    обрабатываем транзакцию
    Кэшируем результат в Redis (TTL 24 ч) + БД (постоянно)

Если клиент повторил тот же запрос с тем же ключом → тот же результат.
```

См. базу — в [`distributed_systems.md`](distributed_systems.md#idempotency-key).

---

## 7. Модель консистентности

**ОБЯЗАТЕЛЬНО strong** для финансового состояния. Не eventual.

Реализация:
- **Single-row транзакции** для обновления баланса (PostgreSQL)
- **2PC или Saga** для cross-shard / cross-service
- **Linearizable reads** для критичного (показ текущего баланса)

Никакого sloppy quorum. Никаких async-обновлений баланса.

---

## 8. Шардирование

На масштабе — шардируем по `account_id`.

**Проблема:** перевод задействует два счёта. Часто **разные шарды**.

Решения:

### A. Co-locate через hash range

Если счета связаны (например, у одного пользователя несколько счетов) — шардируем по `user_id`, а не по `account_id`.

### B. Two-Phase Commit (2PC)

```
Coordinator → Shard A: "prepare to debit Alice $100"
                       → A блокирует, отвечает "ready"
Coordinator → Shard B: "prepare to credit Bob $100"
                       → B блокирует, отвечает "ready"
Coordinator: "commit both"
Оба shard'а коммитят, отпускают блокировки.
```

- ✓ Strong consistency
- ✗ Медленно (несколько round-trip), coordinator SPOF, блокирующее поведение

### C. Saga (event-driven)

См. [`microservice_patterns.md`](microservice_patterns.md#saga-pattern).

```
1. Debit Alice (Shard A): Alice -= 100. Публикация события.
2. Credit Bob (Shard B): Bob += 100. Публикация события.
3. Если шаг 2 упал: компенсирующая транзакция — credit Alice обратно.
```

- ✓ Выше availability, нет distributed locks
- ✗ Eventually consistent в короткое окно (Alice -100, Bob ещё не +100)
- Распространено в современных fintech

### D. Single-DB writes, sharded reads

Если масштаб небольшой (< 10K TPS), оставляем writes в одном PostgreSQL primary, scale reads через replicas.

---

## 9. Audit log

Каждая операция immutable, append-only. Никогда не делать UPDATE/DELETE ledger entries.

```
Даже возврат:
  reverse_txn (debit Bob, credit Alice) — отдельные entries
  Ссылка на оригинальную транзакцию в metadata
```

Audit DB обычно read-only после записи, через какое-то время может уезжать на более дешёвое хранилище (S3 Parquet).

---

## 10. Внешние платёжные процессоры

Для платежей по картам — интеграция со Stripe / Adyen / Braintree / PayPal.

```
Клиент вводит карту →
  Клиент токенизирует через Stripe.js (данные карты никогда не попадают к вам — PCI scope)
  Токен идёт на ваш сервер
  Ваш сервер: POST в API Stripe с токеном + суммой
  Stripe: списывает, возвращает успех / ошибку
  Вы: пишете в ваш ledger
```

**PCI-DSS:** если вы прикасаетесь к сырым номерам карт, scope взрывается (аудиты, шифрование, ограничения). Outsource через токенизацию.

---

## 11. Валюты

### Multi-currency счета

```
ledger_entries.currency : USD, EUR, GBP
account_balances: отдельный баланс на (account, currency)
```

### Конвертация

При cross-currency-переводе:
```
Alice (USD) → Bob (EUR)
$100 USD → debit Alice
×exchange_rate → €92 EUR → credit Bob
Bookkeeping: отдельная FX-запись для tracking

Курс — у FX-провайдера (Forex API), фиксируется на момент транзакции.
```

Конвертация валют может приводить к округлению — внимательно (округлять единообразно, например всегда вниз для fee).

---

## 12. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| Сетевой раздел во время перевода | 2PC блокируется (CP); Saga компенсирует; idempotency предотвращает дубликаты на retry |
| Сервер упал после debit, до credit | Saga-компенсация откатывает debit; 2PC ждёт recovery координатора |
| Гонка: два перевода с одного счёта | Pessimistic lock (SELECT FOR UPDATE) — последовательно |
| Stripe отклонил карту | Помечаем транзакцию failed, ledger-записи не пишем |
| Двойное списание | Idempotency-Key ловит (возвращает кэш) |
| Баг переплачивает | Детектится: SUM(ledger_entries) ≠ 0; алёрт, ручной разбор |

---

## 13. Reconciliation

Ежедневный / ежечасный job проверяет:
- Сумма ledger entries = 0 (инвариант)
- Материализованный баланс = сумме entries счёта
- Внешне: баланс совпадает с Stripe / банковской выпиской

Алёрты на любое расхождение — расследование сразу.

---

## 14. Trade-offs

### Saga vs 2PC

- Saga — для высокого throughput, допускает короткую неконсистентность
- 2PC — для строгих инвариантов, в ущерб throughput

Современные fintech предпочитают Saga + компенсации + reconciliation.

### Sync vs async события

- Sync: caller ждёт полного распространения
- Async: быстрый ответ API, побочные эффекты с задержкой (notifications, аналитика)

Критическое состояние (баланс) — синхронно. Побочное (email-подтверждение) — async.

---

## 15. Compliance

- **PCI-DSS** — обработка данных карт
- **SOX** — внутренние финансовые контроли
- **GDPR / CCPA** — приватность пользовательских данных
- **KYC / AML** — know-your-customer, anti-money-laundering
- **Налоговая отчётность** — 1099 в США

Каждый стандарт добавляет требований (audit log, шифрование, контроль доступа).

---

## Источники

- *Modern Ledger Systems* (серия постов Stripe)
- [Stripe — Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency)
- [Stripe — Online Migrations at Scale](https://stripe.com/blog/online-migrations)
- [«Building an in-house payments platform» — Shopify, Square engineering blogs](https://shopify.engineering/)
- *Designing Data-Intensive Applications* (Kleppmann) — главы 7 (Transactions), 11 (Stream Processing for events)
- *Database Design for Mere Mortals* — паттерны bookkeeping-схем
- [Hello Interview — Payment Systems](https://www.hellointerview.com/learn/system-design)
