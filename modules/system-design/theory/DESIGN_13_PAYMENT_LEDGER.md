# Design Problem: Payment / Ledger System

Финансовые транзакции — двойная запись (double-entry bookkeeping), idempotency, consistency, аудит. PayPal, Stripe, любые fintech.

---

## 1. Requirements

### Functional
- Transfer money between accounts
- Track balances
- Transaction history / audit log
- Reverse / refund transactions
- Multi-currency

### Non-functional
- **Strong consistency** — деньги не дублируются и не теряются
- **Idempotency** — retry safe (двойной charge categorically бан)
- **Audit log** — каждая транзакция traceable
- **Compliance** — regulatory requirements (PCI-DSS, SOX)
- **High availability** — 99.99%+

---

## 2. Estimation

```
10M users, 1M transactions/day
Peak: 1000 TPS (Black Friday: 10× burst)
Storage: 1B transactions × 1 KB = 1 TB (with indexes ~ 5 TB)
```

---

## 3. Double-Entry Bookkeeping

Каждая транзакция = **2 ledger entries** (debit + credit). Balance always = sum of entries.

```
Alice sends $100 to Bob:

ledger_entries:
  txn_id=tx-1, account=Alice, amount=-100, ts=now
  txn_id=tx-1, account=Bob, amount=+100, ts=now

Invariant: SUM(amount) across both entries = 0 (no money created/lost)
```

Balance не stored как denormalized — computed (or materialized).

### Why double-entry

- **Self-correcting** — sum должен быть 0; any imbalance = bug
- **Audit-friendly** — каждая операция has matching entries
- Standard в accounting since 15th century

---

## 4. Data Model

```sql
-- Source of truth — append-only
CREATE TABLE ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    transaction_id UUID,            -- groups debit/credit pair
    account_id BIGINT,
    amount BIGINT,                  -- IN MINOR UNITS (cents); never float!
    currency CHAR(3),
    type ENUM('debit', 'credit'),
    created_at TIMESTAMPTZ DEFAULT now(),
    metadata JSONB                  -- description, reference, etc.
);

CREATE INDEX idx_account_time ON ledger_entries(account_id, created_at DESC);
CREATE INDEX idx_txn_id ON ledger_entries(transaction_id);

-- Materialized balance (для fast reads)
CREATE TABLE account_balances (
    account_id BIGINT PRIMARY KEY,
    balance BIGINT,
    currency CHAR(3),
    updated_at TIMESTAMPTZ,
    version BIGINT                  -- optimistic locking
);

-- Idempotency
CREATE TABLE idempotency_keys (
    key VARCHAR(64) PRIMARY KEY,
    transaction_id UUID,
    response_body JSONB,
    created_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);
```

**Critical:** money в **integers** (cents), не floats. `0.1 + 0.2 != 0.3` в floating point.

---

## 5. Transaction flow

```
POST /api/v1/transfers
Headers: Idempotency-Key: abc-123
Body: { fromAccount, toAccount, amount, currency, description }

Server:
  1. Check Idempotency-Key
     if exists → return cached response (don't process again)

  2. Begin transaction (DB)
     a. Lock both accounts (SELECT FOR UPDATE, or optimistic с version)
     b. Check from.balance >= amount
     c. Insert ledger entries (txn_id=tx_xyz):
        (from, -amount, debit)
        (to, +amount, credit)
     d. Update account_balances (decrement from, increment to)
     e. Persist response в idempotency_keys
     f. Commit

  3. Async events to Kafka:
     transaction_completed → notify both users, update analytics
  
  4. Return 200 { transactionId, status: "completed", balanceAfter }
```

---

## 6. Idempotency

Critical для prevent double charges.

```
Client generates UUID per request, sends as Idempotency-Key

Server:
  if redis.get(key): return cached_result
  
  Otherwise:
    process transaction
    Cache result в Redis (TTL 24h) + DB (permanent)

If client retries same request с same key → returns same result.
```

См. [`distributed_systems.md`](distributed_systems.md#idempotency-key) для базовой теории.

---

## 7. Consistency model

**MUST be strong** для financial state. Не eventual.

Implementation:
- **Single-row transactions** для balance updates (postgreSQL)
- **2PC или Saga** для cross-shard / cross-service
- **Linearizable reads** для critical (current balance show)

NO sloppy quorum. NO async balance updates.

---

## 8. Sharding

При scale — shard by `account_id`.

**Problem:** transfer involves two accounts. Often **different shards**.

Solutions:

### A. Co-locate via hash range

Если accounts связаны (e.g., same user has multiple accounts) — shard by `user_id` rather than `account_id`.

### B. Two-Phase Commit (2PC)

```
Coordinator → Shard A: "prepare to debit Alice $100" 
                       → А locks, says "ready"
Coordinator → Shard B: "prepare to credit Bob $100"
                       → B locks, says "ready"
Coordinator: "commit both"
Both shards commit, release locks.
```

- ✓ Strong consistency
- ✗ Slow (multiple RT), coordinator SPOF, blocking

### C. Saga (event-driven)

См. [`microservice_patterns.md`](microservice_patterns.md#saga-pattern).

```
1. Debit Alice (Shard A): Alice -= 100. Publish event.
2. Credit Bob (Shard B): Bob += 100. Publish event.
3. If step 2 fails: compensating transaction — credit Alice back.
```

- ✓ More available, no distributed locks
- ✗ Eventually consistent for brief window (Alice -100, Bob not yet +100)
- Common in modern fintech

### D. Single-DB writes, sharded reads

If small scale enough (< 10K TPS), keep writes single PostgreSQL primary, scale reads via replicas.

---

## 9. Audit log

Каждая операция immutable, append-only. Never UPDATE/DELETE ledger entries.

```
Even refund: 
  reverse_txn (debit Bob, credit Alice) — separate entries
  Reference original txn в metadata
```

Audit DB обычно read-only after write, может tier к cheaper storage (S3 Parquet) после некоторого времени.

---

## 10. External payment processors

For credit card payments — integrate Stripe / Adyen / Braintree / PayPal.

```
Customer enters card → 
  Client tokenizes via Stripe.js (card data never touches your server — PCI scope)
  Token sent к your server
  Your server: POST к Stripe API с token + amount
  Stripe: charges, returns success / failure
  You: record в your ledger
```

**PCI-DSS:** if you touch raw card numbers, scope balloons (audits, encrypted storage, restrictions). Outsource via tokenization.

---

## 11. Currency

### Multi-currency accounts

```
ledger_entries.currency : USD, EUR, GBP
account_balances: separate balance per (account, currency)
```

### Conversion

При cross-currency transfer:
```
Alice (USD) → Bob (EUR)
$100 USD → debit Alice
×exchange_rate → €92 EUR → credit Bob
Bookkeeping: separate FX adjustment entry для tracking

Exchange rate from FX provider (Forex API), locked at transaction time.
```

Currency conversion can introduce rounding — careful (always round consistently, e.g., always down for fees).

---

## 12. Failure modes

| Scenario | Handling |
|----------|----------|
| Network partition during transfer | 2PC blocks (CP); Saga has compensating; idempotency prevents duplicate retries |
| Server crash after debit, before credit | Saga compensation reverts debit; 2PC waits for coordinator recovery |
| Race: two transfers from same account | Pessimistic lock (SELECT FOR UPDATE) — sequential |
| Stripe declines card | Mark transaction failed, no ledger entries written |
| Double-charged customer | Idempotency-Key catches it (returns cached response) |
| Bug overcredits | Detection: SUM(ledger_entries) ≠ 0; alert, manual investigate |

---

## 13. Reconciliation

Daily / hourly job verifies:
- Sum of ledger entries = 0 (invariant)
- Materialized balance = sum of (account's entries)
- External: balance matches Stripe / bank statement

Alerts on any divergence — investigated immediately.

---

## 14. Trade-offs

### Saga vs 2PC

- Saga для high-throughput, accepts brief inconsistency
- 2PC для strict invariants, accepts lower throughput

Modern fintech prefer Saga + compensating + reconciliation.

### Synchronous vs Async events

- Sync: caller waits для full propagation
- Async: faster API response, eventual side effects (notifications, analytics)

Critical state (balance) must be sync. Side effects (email confirmation) async.

---

## 15. Compliance

- **PCI-DSS** — card data handling
- **SOX** — internal financial controls
- **GDPR / CCPA** — user data privacy
- **KYC / AML** — know-your-customer, anti-money-laundering
- **Tax reporting** — 1099 в US

Each adds requirements (audit logs, encryption, access controls).

---

## Источники

- *Modern Ledger Systems* (Stripe blog series)
- [Stripe — Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency)
- [Stripe — Online Migrations at Scale](https://stripe.com/blog/online-migrations)
- [«Building an in-house payments platform» — Shopify, Square engineering blogs](https://shopify.engineering/)
- *Designing Data-Intensive Applications* (Kleppmann) — Ch. 7 (Transactions), Ch. 11 (Stream Processing for events)
- *Database Design for Mere Mortals* — bookkeeping schema patterns
- [Hello Interview — Payment Systems](https://www.hellointerview.com/learn/system-design)
