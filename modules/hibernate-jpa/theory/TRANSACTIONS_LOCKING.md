# Hibernate / JPA — Транзакции и блокировки

Этот файл — про модель транзакций на уровне JPA и про то, как JPA выражает блокировки поверх механизмов базы данных. Каноническая теория транзакций (ACID, уровни изоляции, MVCC, аномалии вроде потерянного обновления и write skew, синтаксис `FOR UPDATE`/`SKIP LOCKED`) живёт в [`databases/TRANSACTIONS.md`](../../databases/theory/TRANSACTIONS.md) — здесь она не дублируется, а используется как фундамент. Управление границами транзакции через Spring (`@Transactional`, распространение, self-invocation) разбирается в [`spring-frameworks/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md). Цель этого файла — JPA-специфика: `EntityTransaction`, связь flush с контекстом хранения (persistence context), `@Version` и `LockModeType`.

## 1. Модель транзакций в JPA

JPA различает два типа управления транзакциями, и это задаётся при создании единицы хранения (persistence unit):

- **Resource-local** — транзакциями управляет само приложение через интерфейс `EntityTransaction`, полученный из `EntityManager`. Транзакция привязана к одному источнику данных (одно соединение, одна база). Это режим standalone-приложений и тестов.
- **JTA (Java Transaction API)** — транзакциями управляет контейнер или менеджер транзакций (например, Narayana в WildFly, либо Spring через `JpaTransactionManager`/`JtaTransactionManager`). JTA нужен, когда транзакция охватывает несколько ресурсов (две базы, база + очередь) и требуется двухфазная фиксация (2PC — см. [`microservices/DISTRIBUTED_TRANSACTIONS.md`](../../microservices/theory/DISTRIBUTED_TRANSACTIONS.md)).

В resource-local-режиме вызов `em.getTransaction()` возвращает `EntityTransaction`; в JTA-режиме этот вызов бросает исключение, потому что границами владеет контейнер.

```java
// Resource-local: приложение само открывает и фиксирует транзакцию
EntityManager em = emf.createEntityManager();
EntityTransaction tx = em.getTransaction();
try {
    tx.begin();
    Account acc = em.find(Account.class, id);
    acc.withdraw(100);          // dirty checking запомнит изменение
    tx.commit();                // здесь произойдёт flush + COMMIT
} catch (RuntimeException e) {
    if (tx.isActive()) tx.rollback();
    throw e;
} finally {
    em.close();
}
```

В реальном бэкенд-коде границы почти всегда декларативны (`@Transactional`), и приложение редко вызывает `EntityTransaction` напрямую. Но понимать, что под капотом `@Transactional` для resource-local оборачивается именно в `begin`/`commit`/`rollback` этого интерфейса, полезно для интервью.

## 2. Flush, commit и контекст хранения

Ключевая особенность JPA: изменения сущностей не отправляются в базу немедленно. Контекст хранения (persistence context, кэш первого уровня) накапливает грязные сущности, и SQL-операторы `INSERT`/`UPDATE`/`DELETE` уходят в базу только при **flush**. Подробно жизненный цикл сущностей описан в [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md).

Flush происходит:

- автоматически перед фиксацией транзакции (`commit`);
- автоматически перед выполнением запроса JPQL/HQL, если он может затронуть незафлашенные изменения (режим `FlushModeType.AUTO`, по умолчанию) — см. [`QUERYING.md`](QUERYING.md);
- явно при вызове `em.flush()`.

Важно различать flush и commit. **Flush** синхронизирует контекст хранения с базой в рамках текущей транзакции — SQL выполнен, но данные ещё не зафиксированы и видны другим транзакциям лишь в зависимости от уровня изоляции. **Commit** делает изменения постоянными (фиксирует транзакцию в базе) и обычно неявно вызывает flush непосредственно перед собой.

Из этого следует практическое: проверки оптимистичной блокировки (`@Version`) выполняются именно во время flush, поэтому `OptimisticLockException` может прилететь не там, где менялась сущность, а на границе транзакции — на коммите.

## 3. Оптимистичная блокировка через `@Version`

Оптимистичная блокировка не держит блокировок в базе. Вместо этого она исходит из предположения, что конфликты редки, и проверяет это предположение в момент записи через **версионную колонку**. Сущность помечается полем `@Version`:

```java
@Entity
class Account {
    @Id Long id;
    long balance;

    @Version
    int version;   // или long, short, Timestamp, Instant
}
```

Механика:

1. При чтении сущности Hibernate запоминает текущее значение версии (например, `version = 7`).
2. При flush сгенерированный `UPDATE` включает версию в `WHERE` и инкрементирует её:
   ```sql
   UPDATE account SET balance = ?, version = 8 WHERE id = ? AND version = 7
   ```
3. Если `UPDATE` затронул **0 строк**, значит версия в базе уже изменена другой транзакцией. Hibernate бросает `OptimisticLockException` (Hibernate-обёртка — `StaleObjectStateException`).

Тип версионной колонки:

- **Числовой (`int`/`long`/`short`)** — предпочтительный. Монотонный инкремент, не зависит от точности часов, надёжен. Рекомендуется почти всегда.
- **Временной (`Timestamp`/`Instant`)** — версия = время последней модификации. Удобно, если эта колонка и так нужна бизнес-логике, но опасно: при низком разрешении системных часов или при возврате времени назад (NTP-коррекция) две записи могут получить одинаковую метку, и конфликт не будет обнаружен.

### Оптимистичная блокировка без версионной колонки

Если в таблице нет (и нельзя добавить) версионную колонку, Hibernate умеет делать оптимистичную блокировку без `@Version`, расширяя `WHERE` другими колонками (специфично для Hibernate, не входит в JPA):

```java
@Entity
@org.hibernate.annotations.OptimisticLocking(type = OptimisticLockType.DIRTY)
class LegacyAccount { ... }
```

- `OptimisticLockType.DIRTY` — в `WHERE` попадают только изменённые в этой транзакции колонки (со старыми значениями). Требует `@DynamicUpdate`.
- `OptimisticLockType.ALL` — в `WHERE` попадают все колонки сущности (со старыми значениями).
- `OptimisticLockType.VERSION` — поведение по умолчанию (нужна `@Version`).
- `OptimisticLockType.NONE` — оптимистичной блокировки нет.

Versionless-подход хрупок: он опирается на то, что старые значения колонок не изменились, и плохо работает с detached-сущностями (старые значения теряются после отсоединения от контекста). Для нового кода используйте `@Version`.

## 4. Пессимистичная блокировка и `LockModeType`

Пессимистичная блокировка исходит из противоположного предположения: конфликты вероятны, поэтому строку надо заблокировать в базе **сразу при чтении**, до изменения. JPA выражает это через `LockModeType`, который транслируется в блокирующие конструкции SQL (на уровне базы это `SELECT ... FOR UPDATE` и подобные — каноника в [`databases/TRANSACTIONS.md`](../../databases/theory/TRANSACTIONS.md)).

Задать режим блокировки можно тремя способами:

```java
// 1. При поиске
Account acc = em.find(Account.class, id, LockModeType.PESSIMISTIC_WRITE);

// 2. На уже загруженной сущности
em.lock(acc, LockModeType.PESSIMISTIC_WRITE);

// 3. В запросе
Account acc = em.createQuery("select a from Account a where a.id = :id", Account.class)
    .setParameter("id", id)
    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
    .getSingleResult();
```

### Таблица: `LockModeType` → SQL

| `LockModeType` | Семантика | Типичный SQL (PostgreSQL) |
|---|---|---|
| `OPTIMISTIC` | Проверить версию на коммите, даже если сущность только читалась (защита от того, что прочитанные данные устареют к концу транзакции) | дополнительный `SELECT version` или проверка версии при flush |
| `OPTIMISTIC_FORCE_INCREMENT` | То же + принудительно инкрементировать версию, хотя сама сущность не менялась | `UPDATE ... SET version = version + 1 WHERE ... AND version = ?` |
| `PESSIMISTIC_READ` | Разделяемая блокировка: другие могут читать, но не писать | `SELECT ... FOR SHARE` |
| `PESSIMISTIC_WRITE` | Эксклюзивная блокировка строки на запись | `SELECT ... FOR UPDATE` |
| `PESSIMISTIC_FORCE_INCREMENT` | Эксклюзивная блокировка + инкремент версии (нужна `@Version`) | `SELECT ... FOR UPDATE`, затем `UPDATE version` |
| `NONE` | Без блокировки (значение по умолчанию) | обычный `SELECT` |

`PESSIMISTIC_READ` и `PESSIMISTIC_WRITE` диалектозависимы: трансляция в SQL зависит от базы (в MySQL `FOR SHARE` исторически был `LOCK IN SHARE MODE`; некоторые базы повышают `PESSIMISTIC_READ` до эксклюзивной блокировки, если разделяемой нет).

### Таймаут блокировки и охват

- **`jakarta.persistence.lock.timeout`** — сколько ждать освобождения блокировки (мс). `0` означает «не ждать» — транслируется в `NOWAIT` (в PostgreSQL `SELECT ... FOR UPDATE NOWAIT`); конкретное значение даёт `SELECT ... FOR UPDATE WAIT n`, если база это поддерживает. Без поддержки подсказка игнорируется и используется уровень изоляции/настройки базы.
- **`jakarta.persistence.lock.scope`** — `NORMAL` (по умолчанию, блокируется сама сущность) или `EXTENDED` (блокируются также связанные через ассоциации строки). `EXTENDED` поддерживается не всеми провайдерами/базами.

```java
Map<String, Object> props = Map.of(
    "jakarta.persistence.lock.timeout", 0  // NOWAIT: сразу упасть, если строка занята
);
Account acc = em.find(Account.class, id, LockModeType.PESSIMISTIC_WRITE, props);
```

## 5. Оптимистичная vs пессимистичная: когда что

| Критерий | Оптимистичная (`@Version`) | Пессимистичная (`PESSIMISTIC_WRITE`) |
|---|---|---|
| Предположение | Конфликты редки | Конфликты часты |
| Блокировки в базе | Нет | Есть (строки заблокированы до конца транзакции) |
| Когда выявляется конфликт | На flush/commit (поздно) | При чтении (рано) |
| Реакция на конфликт | `OptimisticLockException` → повтор всей транзакции | Ожидание/таймаут на блокировке |
| Стоимость | Низкая при малом числе конфликтов | Высокая: удержание блокировок, риск дедлоков, снижение параллелизма |
| Подходит для | Веб-сценарии, длинные «диалоги» с пользователем (думающее время вне транзакции), высокая конкуренция чтений | Короткие критические секции с высокой конкуренцией записей: списание со счёта, выдача номерков из очереди |
| Работает с detached | Да (версия едет с сущностью) | Нет (блокировка живёт только в открытой транзакции) |

Эмпирическое правило: по умолчанию — оптимистичная (`@Version`), она дешевле и масштабируется. Пессимистичную берут точечно, когда повтор транзакции недопустим или слишком дорог, либо когда конкуренция за конкретные строки настолько высока, что оптимистичная превращается в шторм повторов.

## 6. Battle-story: потерянное обновление

Потерянное обновление (lost update) — классическая аномалия: две транзакции читают одно значение, обе считают новое на основе старого, обе записывают — и одно изменение бесследно теряется. Каноническое определение аномалии — в [`databases/TRANSACTIONS.md`](../../databases/theory/TRANSACTIONS.md); здесь — как её ловит JPA.

Сценарий: два менеджера одновременно открыли карточку заказа со скидкой `0`. Первый ставит скидку `10%`, второй — `15%`. Оба загрузили сущность с `version = 3`.

**Без `@Version`** (под READ COMMITTED):

1. T1 читает `discount = 0, version отсутствует`.
2. T2 читает `discount = 0`.
3. T1: `UPDATE order SET discount = 10 WHERE id = 42` — фиксирует.
4. T2: `UPDATE order SET discount = 15 WHERE id = 42` — фиксирует.

Итог: `discount = 15`, обновление T1 потеряно молча. Никто не узнал, что решение первого менеджера затёрто.

**С `@Version`**:

3. T1: `UPDATE order SET discount = 10, version = 4 WHERE id = 42 AND version = 3` → 1 строка, успех.
4. T2: `UPDATE order SET discount = 15, version = 4 WHERE id = 42 AND version = 3` → **0 строк** (в базе уже `version = 4`) → `OptimisticLockException`.

T2 откатывается, приложение перечитывает заказ (теперь `discount = 10, version = 4`) и повторяет операцию на актуальных данных. Потеря исключена.

```kotlin
// Типичный паттерн повтора при оптимистичном конфликте
fun applyDiscountWithRetry(orderId: Long, percent: Int, maxAttempts: Int = 3) {
    repeat(maxAttempts) { attempt ->
        try {
            applyDiscount(orderId, percent)  // @Transactional внутри
            return
        } catch (e: OptimisticLockException) {
            if (attempt == maxAttempts - 1) throw e
            // перечитать и попробовать снова
        }
    }
}
```

Альтернатива для записей с очень высокой конкуренцией — `PESSIMISTIC_WRITE` на чтении: T2 просто подождёт, пока T1 отпустит блокировку, и прочитает уже актуальное значение. Но тогда теряется параллелизм, и появляется риск дедлоков при блокировке нескольких строк в разном порядке.

## 7. Где почитать дальше

- [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md) — состояния сущности, dirty checking и момент flush.
- [`QUERYING.md`](QUERYING.md) — как авто-flush взаимодействует с JPQL/HQL и `setLockMode` в запросах.
- [`PERFORMANCE_PITFALLS.md`](PERFORMANCE_PITFALLS.md) — стоимость снапшота, влияние блокировок на параллелизм, read-only-оптимизации.
- [`JPA_VS_HIBERNATE.md`](JPA_VS_HIBERNATE.md) — соотношение `EntityTransaction`/`Transaction`, `EntityManager`/`Session`.
- [`CACHING.md`](CACHING.md) — L2-кэш и его взаимодействие с версионированием и блокировками.
- ACID, уровни изоляции, MVCC, аномалии (потерянное обновление, write skew), `FOR UPDATE`/`SKIP LOCKED` — [`databases/TRANSACTIONS.md`](../../databases/theory/TRANSACTIONS.md).
- `@Transactional`, распространение транзакций, self-invocation — [`spring-frameworks/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md).
- Распределённые транзакции и 2PC — [`microservices/DISTRIBUTED_TRANSACTIONS.md`](../../microservices/theory/DISTRIBUTED_TRANSACTIONS.md).

## Источники

- [Jakarta Persistence Specification — Locking and Concurrency](https://jakarta.ee/specifications/persistence/) — `LockModeType`, `EntityTransaction`, семантика `@Version`.
- [Hibernate ORM User Guide — Locking](https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#locking) — оптимистичная/пессимистичная блокировка, `OptimisticLockType`, versionless locking.
- [Hibernate ORM User Guide — Flushing](https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#flushing) — режимы flush и связь с транзакцией.
- *High-Performance Java Persistence* (Vlad Mihalcea, 2016) — главы об оптимистичной и пессимистичной блокировке, повторных попытках.
- [Vlad Mihalcea — «The downside of version-less optimistic locking»](https://vladmihalcea.com/the-downside-of-version-less-optimistic-locking/) — почему versionless-подход хрупок.
- [Vlad Mihalcea — «How does LockModeType work in JPA and Hibernate»](https://vladmihalcea.com/optimistic-vs-pessimistic-locking/) — трансляция `LockModeType` в SQL.
