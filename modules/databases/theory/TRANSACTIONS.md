# Database Transactions — PostgreSQL

## 1. ACID

**ACID** — свойства транзакций, гарантирующие надёжность даже при сбоях.

### Atomicity (Атомарность)

Транзакция — неделимая единица. Либо все операции выполняются, либо ни одна.

```sql
BEGIN;
  UPDATE accounts SET balance = balance - 100 WHERE id = 1;
  UPDATE accounts SET balance = balance + 100 WHERE id = 2;
  -- Если здесь упадёт сервер → при рестарте PostgreSQL откатит обе операции
COMMIT;
```

Реализация: WAL (Write-Ahead Log) — перед применением изменений записывается лог. При сбое — replay или rollback по логу.

### Consistency (Согласованность)

Транзакция переводит БД из одного согласованного состояния в другое. Не нарушает constraints.

```sql
-- Constraint: баланс не может быть отрицательным
ALTER TABLE accounts ADD CONSTRAINT balance_positive CHECK (balance >= 0);

BEGIN;
  UPDATE accounts SET balance = balance - 1000 WHERE id = 1; -- баланс 50 → нарушение
  -- ERROR: new row for relation "accounts" violates check constraint "balance_positive"
  -- Транзакция откатывается автоматически
```

Consistency — ответственность совместно БД (constraints) и приложения (бизнес-правила).

### Isolation (Изолированность)

Параллельные транзакции не видят промежуточных результатов друг друга. Уровень изолированности настраивается (см. ниже).

```sql
-- T1 и T2 работают параллельно, T1 не видит незакоммиченные изменения T2
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

### Durability (Живучесть)

После COMMIT данные сохранены даже если система упадёт.

Реализация: WAL сброшен на диск (`fsync`) до подтверждения COMMIT. `synchronous_commit=on` — PostgreSQL ждёт fsync перед ответом клиенту.

```
synchronous_commit=off → повышает производительность, но при сбое возможна потеря последних нескольких транзакций
synchronous_commit=on  → полная гарантия (дефолт)
```

---

## 2. Аномалии

**Dirty Read** — чтение незакоммиченных данных другой транзакции.
```
T1: UPDATE balance = 0 (не закоммичено)
T2: SELECT balance → читает 0  ← грязное чтение
T1: ROLLBACK → T2 работала с данными, которых никогда не было
```

**Non-Repeatable Read** — одна строка читается дважды с разным результатом.
```
T1: SELECT price → 100
T2: UPDATE price = 200; COMMIT
T1: SELECT price → 200  ← другой результат в одной транзакции
```

**Phantom Read** — повторный диапазонный запрос возвращает новые строки.
```
T1: SELECT COUNT(*) WHERE table_id=1 → 3
T2: INSERT (table_id=1); COMMIT
T1: SELECT COUNT(*) WHERE table_id=1 → 4  ← фантомная строка
```

**Lost Update** — две транзакции читают одно значение и обе пишут поверх.
```
T1: SELECT seats → 1
T2: SELECT seats → 1
T1: UPDATE seats = 0; COMMIT
T2: UPDATE seats = 0; COMMIT  ← обе думали, что занимают последнее место
```

**Write Skew** — каждая транзакция корректна по отдельности, но вместе нарушают инвариант.
```
Инвариант: хотя бы один доктор должен быть на дежурстве
T1: SELECT count(on_call) → 2; UPDATE doctor_alice SET on_call=false; COMMIT
T2: SELECT count(on_call) → 2; UPDATE doctor_bob  SET on_call=false; COMMIT
Результат: 0 докторов → инвариант нарушен
```
Write Skew не предотвращается REPEATABLE READ.

---

## 3. Уровни изоляции

| Уровень | Dirty Read | Non-Repeatable Read | Phantom Read | Write Skew |
|---|---|---|---|---|
| READ UNCOMMITTED | нет* | возможен | возможен | возможен |
| READ COMMITTED | нет | возможен | возможен | возможен |
| REPEATABLE READ | нет | нет | нет** | возможен |
| SERIALIZABLE | нет | нет | нет | нет |

\* В PostgreSQL READ UNCOMMITTED ведёт себя как READ COMMITTED — грязных чтений нет никогда.

\*\* PostgreSQL REPEATABLE READ защищает от фантомов за счёт snapshot isolation — строже стандарта SQL.

---

## 4. READ COMMITTED (default)

Каждый SQL-запрос видит снимок на момент **своего** старта, не транзакции.

```sql
BEGIN;
SELECT balance FROM accounts WHERE id=1; -- 1000

-- Другая сессия: UPDATE balance=500; COMMIT

SELECT balance FROM accounts WHERE id=1; -- 500  ← non-repeatable read
COMMIT;
```

**Ловушка — lost update:**
```sql
BEGIN;
SELECT qty FROM stock WHERE id=1; -- qty=1
-- приложение: qty > 0 → разрешаем
UPDATE stock SET qty = qty - 1 WHERE id=1; -- OK
COMMIT;
-- Если два потока одновременно — qty станет -1
```

**Безопасный вариант — атомарный UPDATE:**
```sql
UPDATE stock SET qty = qty - 1
WHERE id = 1 AND qty > 0
RETURNING qty;
-- Если 0 строк → товара нет
```

---

## 5. REPEATABLE READ

Транзакция видит снимок на момент **старта транзакции**. Все запросы видят одинаковую картину.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT balance FROM accounts WHERE id=1; -- 1000, snapshot зафиксирован

-- Другая сессия: UPDATE balance=500; COMMIT

SELECT balance FROM accounts WHERE id=1; -- всё ещё 1000
COMMIT;
```

**Конфликт UPDATE — "first updater wins":**
Если T1 пытается обновить строку, уже обновлённую T2:
```
T2 ещё активна → T1 ждёт
T2 ROLLBACK → T1 продолжает, применяет UPDATE
T2 COMMIT   → T1 получает ERROR: could not serialize access due to concurrent update (40001)
```

**Применение:** финансовые отчёты, аналитика где важна snapshot-консистентность.

---

## 6. SERIALIZABLE (SSI)

PostgreSQL использует **SSI (Serializable Snapshot Isolation)** — не классические 2PL-локи.

Транзакции не блокируют друг друга, но система отслеживает **rw-зависимости**. При обнаружении цикла → одна транзакция откатывается с `ERROR 40001`.

```sql
-- Write Skew устранён:
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT count(*) FROM doctors WHERE on_call = true; -- 2
UPDATE doctors SET on_call = false WHERE name = 'alice';
COMMIT;
-- Если конкурирующая транзакция изменила то, что мы читали → ERROR 40001
```

**SSI vs 2PL:**
- 2PL: блокирует строки, высокий риск дедлоков
- SSI: оптимистичный, не блокирует, но нужен retry

**Цена:** ~10-30% снижение пропускной способности, обязательна retry-логика.

---

## 7. SELECT FOR UPDATE — пессимистичная блокировка

Явная блокировка строк внутри любого уровня изоляции.

```sql
BEGIN;
SELECT * FROM restaurant_tables WHERE id = 1 FOR UPDATE; -- блокируем строку стола
SELECT * FROM reservations WHERE table_id = 1 AND date = '2026-04-05';
INSERT INTO reservations ...;
COMMIT;
```

**Ключевой момент:** блокируется **существующая строка ресурса** (`restaurant_tables`), а не строки резерваций. FOR UPDATE на `reservations` не спасает при первой резервации — строк ещё нет.

```sql
FOR UPDATE          -- эксклюзивная блокировка
FOR SHARE           -- разделяемая, блокирует только UPDATE/DELETE
FOR UPDATE NOWAIT   -- если занято → сразу ERROR
FOR UPDATE SKIP LOCKED -- пропускает занятые строки (паттерн для job queue)
```

**Job queue паттерн:**
```sql
SELECT * FROM tasks WHERE status='pending' FOR UPDATE SKIP LOCKED LIMIT 1;
-- Каждый воркер забирает незанятую задачу без конкуренции
```

---

## 8. EXCLUDE constraint — атомарная проверка пересечений

Для временных диапазонов ни UNIQUE, ни FOR UPDATE не защищают от пересечений. Решение — constraint с range-типами:

```sql
CREATE TABLE reservations (
    id          UUID PRIMARY KEY,
    table_id    INTEGER REFERENCES restaurant_tables(id),
    res_date    DATE NOT NULL,
    time_range  TSRANGE NOT NULL,

    EXCLUDE USING GIST (
        table_id  WITH =,
        res_date  WITH =,
        time_range WITH &&    -- && = оператор пересечения диапазонов
    )
);

INSERT INTO reservations VALUES (gen_random_uuid(), 1, '2026-04-05', '[10:00, 12:00)'); -- OK
INSERT INTO reservations VALUES (gen_random_uuid(), 1, '2026-04-05', '[10:30, 11:30)'); -- ERROR: conflicting key
INSERT INTO reservations VALUES (gen_random_uuid(), 1, '2026-04-05', '[12:00, 13:00)'); -- OK (полуоткрытый интервал)
```

Проверка **атомарна при INSERT** через GiST-индекс — не нужны FOR UPDATE или SERIALIZABLE.

---

## 9. MVCC — Multi-Version Concurrency Control

При каждом UPDATE PostgreSQL **не перезаписывает строку**, а создаёт новую версию — **tuple**.

```
UPDATE accounts SET balance = 500 WHERE id = 1;

До:   [id=1, balance=1000, xmin=100, xmax=0  ]  ← старый tuple
После:[id=1, balance=1000, xmin=100, xmax=200]  ← помечен удалённым транзакцией 200
      [id=1, balance=500,  xmin=200, xmax=0  ]  ← новый tuple
```

- `xmin` — ID транзакции, создавшей tuple
- `xmax` — ID транзакции, "удалившей" tuple

Читающие транзакции **никогда не блокируют** пишущие — каждый читает свою версию.

| Уровень | Какой snapshot |
|---|---|
| READ COMMITTED | Новый snapshot на каждый SQL-запрос |
| REPEATABLE READ | Один snapshot на всю транзакцию |
| SERIALIZABLE | Один snapshot + отслеживание rw-зависимостей |

### VACUUM

Мёртвые кортежи (старые версии) накапливаются — VACUUM их убирает.

| | VACUUM | VACUUM FULL |
|---|---|---|
| Мёртвые кортежи | Помечает свободными | Физически удаляет |
| Место → OS | Нет | Да |
| Блокировка | Нет | ACCESS EXCLUSIVE |
| Когда | Автоматически (autovacuum) | Только при сильном bloat |

**Transaction ID Wraparound:** MVCC хранит `xmin`/`xmax` как 32-bit счётчик (~2 млрд транзакций). При переполнении PostgreSQL переходит в аварийный режим, отклоняя все запросы кроме VACUUM. `autovacuum` решает это через заморозку старых tuple'ов.

---

## 10. Retry-логика в приложении

| Ошибка | SQLSTATE | Когда |
|---|---|---|
| `could not serialize access due to concurrent update` | `40001` | REPEATABLE READ / SERIALIZABLE |
| `could not serialize access due to read/write dependencies` | `40001` | SERIALIZABLE (SSI цикл) |
| `deadlock detected` | `40P01` | Любой уровень |
| `lock timeout` | `55P03` | Истёк `lock_timeout` |

Коды `40001` и `40P01` — транзиентные ошибки, всегда подлежат повторной попытке.

**Spring + @Retryable:**
```java
@Retryable(
    retryFor = {
        CannotSerializeTransactionException.class,  // 40001
        DeadlockLoserDataAccessException.class       // 40P01
    },
    maxAttempts = 3,
    backoff = @Backoff(delay = 100, multiplier = 2, random = true)
)
@Transactional(isolation = Isolation.SERIALIZABLE)
public void makeReservation(...) { ... }
```

**Маппинг Spring → SQLState:**
```
PSQLException(40001) → CannotSerializeTransactionException
PSQLException(40P01) → DeadlockLoserDataAccessException
PSQLException(55P03) → QueryTimeoutException
```

**Jitter** в backoff предотвращает retry storm — все retry не стартуют одновременно:
```java
long backoff = (long) (100 * Math.pow(2, attempt) + Math.random() * 100);
```

---

## 11. Savepoints — вложенные транзакции

PostgreSQL не поддерживает вложенные транзакции в классическом смысле, но поддерживает **savepoints** — точки отката внутри транзакции.

```sql
BEGIN;
  INSERT INTO orders VALUES (1, 'pending');

  SAVEPOINT before_payment;

  INSERT INTO payments VALUES (1, 100);  -- ошибка?

  ROLLBACK TO SAVEPOINT before_payment;  -- откатываемся к точке
  -- orders (1, 'pending') всё ещё существует

  INSERT INTO payments VALUES (1, 100, 'retry'); -- попробуем снова

COMMIT; -- или ROLLBACK для полного отката
```

**Зачем нужно:**
- Partial rollback без отмены всей транзакции
- ORM-фреймворки используют savepoints для `@Transactional(NESTED)` в Spring

**Spring Propagation.NESTED:**
```java
@Transactional(propagation = Propagation.NESTED) // savepoint внутри текущей транзакции
public void innerMethod() { ... }
// Если innerMethod бросает исключение → откат к savepoint, внешняя транзакция продолжается
// В отличие от REQUIRES_NEW: NESTED — в той же транзакции, REQUIRES_NEW — отдельная
```

**Важно:** в PostgreSQL нет синтаксиса `BEGIN TRANSACTION` внутри `BEGIN TRANSACTION`. Любая попытка открыть транзакцию внутри транзакции игнорируется с предупреждением. Только `SAVEPOINT`.

---

## 12. Практическая стратегия для резерваций

| Операция | Уровень | Дополнительно |
|---|---|---|
| `getAvailableTimeSlots` | READ COMMITTED | Только чтение |
| `makeReservation` | READ COMMITTED | EXCLUDE constraint — атомарный INSERT |
| Финансовые операции | REPEATABLE READ | + FOR UPDATE на строке счёта |
| Инварианты между строками | SERIALIZABLE | + retry-логика |

---

## Источники

**Официальная документация:**
- [PostgreSQL 16 — Chapter 13. Concurrency Control](https://www.postgresql.org/docs/16/mvcc.html) — MVCC, уровни изоляции, явные локи, SSI.
- [PostgreSQL — Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html) — таблица аномалий, поведение SSI.
- [PostgreSQL — Routine Vacuuming + Wraparound Failures](https://www.postgresql.org/docs/16/routine-vacuuming.html#VACUUM-FOR-WRAPAROUND)

**Papers / books:**
- [Berenson, Bernstein, Gray et al. (1995) — «A Critique of ANSI SQL Isolation Levels» (SIGMOD '95)](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-95-51.pdf) — каноническое определение всех аномалий, включая phantom и read skew.
- [Adya, Liskov, O'Neil (2000) — «Generalized Isolation Level Definitions» (ICDE)](https://pmg.csail.mit.edu/papers/icde00.pdf) — формальная иерархия аномалий поверх ANSI.
- [Cahill, Röhm, Fekete (2008) — «Serializable Isolation for Snapshot Databases» (SIGMOD '08)](https://people.eecs.berkeley.edu/~kubitron/courses/cs262a-F13/handouts/papers/p729-cahill.pdf) — алгоритм SSI, реализованный в PostgreSQL 9.1+.
- *Designing Data-Intensive Applications* (Martin Kleppmann, O'Reilly 2017) — Ch. 7 (Transactions).
- *Transaction Processing: Concepts and Techniques* (Jim Gray, Andreas Reuter, 1992) — фундаментальная работа по ACID.

**Engineering blogs:**
- [Vlad Mihalcea — «A beginner's guide to ACID and database transactions»](https://vladmihalcea.com/a-beginners-guide-to-acid-and-database-transactions/) и серия по уровням изоляции.
- [Markus Winand — «We need tool support for keyset pagination» (про FOR UPDATE SKIP LOCKED)](https://use-the-index-luke.com/no-offset)
- [Jepsen — PostgreSQL analyses](https://jepsen.io/analyses) — какие именно аномалии PG допускает (или не допускает) на практике.
