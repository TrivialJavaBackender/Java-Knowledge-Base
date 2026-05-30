# Hibernate / JPA — Жизненный цикл сущности и Persistence Context

## Что такое Persistence Context

Persistence context (контекст персистентности) — это область памяти первого уровня (L1-кэш), которой управляет `EntityManager` (в нативном Hibernate — `Session`). Он хранит все управляемые (managed) сущности в рамках одной единицы работы и обеспечивает их синхронизацию с базой данных.

Persistence context — это конкретная реализация двух классических ORM-паттернов уровня предприятия (Identity Map и Unit of Work). Их концептуальное описание находится в [`databases/DATABASE_TYPES.md`](../../databases/theory/DATABASE_TYPES.md) — здесь оно не дублируется. В двух словах:

- **Identity Map** — гарантия «одна строка таблицы → ровно один объект в пределах контекста». Два вызова `find()` по одному идентификатору вернут один и тот же экземпляр (`==`), без повторного запроса.
- **Unit of Work** — контекст копит изменения сущностей и сбрасывает их в базу одним пакетом во время flush, а не на каждый сеттер.

Из этих двух паттернов вытекает почти всё поведение, описанное ниже: dirty checking, отложенный flush, повторное использование объектов.

---

## Четыре состояния сущности

JPA определяет четыре состояния, в которых может находиться объект-сущность относительно persistence context и базы данных.

| Состояние | Идентификатор | В persistence context | Строка в БД | Отслеживается dirty checking |
|---|---|---|---|---|
| **transient** (новый) | обычно нет | нет | нет | нет |
| **managed** (управляемый) | есть | да | есть или будет на flush | да |
| **detached** (отсоединённый) | есть | нет | есть | нет |
| **removed** (удаляемый) | есть | да (помечен на удаление) | есть до flush | формально да |

- **transient** — обычный объект, созданный через `new`. Hibernate о нём не знает; в базе строки нет.
- **managed** — объект привязан к открытому контексту. Любое изменение его полей будет автоматически сохранено при flush.
- **detached** — объект, который был managed, но контекст закрылся (или его явно выселили через `detach`/`clear`). Идентификатор есть, строка в базе тоже, но изменения больше не отслеживаются.
- **removed** — объект, помеченный на удаление. До flush строка ещё существует, после — будет выполнен `DELETE`.

---

## Диаграмма переходов

```
                       new (конструктор)
                            │
                            ▼
                      ┌───────────┐
                      │ transient │
                      └───────────┘
                            │ persist()
                            ▼
   refresh()  ┌──────────────────────────┐   detach() / clear() / close()
  ┌──────────▶│         managed          │──────────────────┐
  │           └──────────────────────────┘                  │
  │             ▲          │        ▲                        ▼
  │   merge()   │          │ remove()│ merge()        ┌────────────┐
  │ (копирует)  │          ▼        │ (копирует      │  detached  │
  │           ┌──────────────┐      │  состояние)    └────────────┘
  └───────────│   removed    │──────┘                       │
              └──────────────┘                              │
                     │ flush → DELETE              изменения НЕ
                     ▼                              отслеживаются
              строки в БД нет
```

Ключевые переходы:

- `persist(t)` — transient → managed (запланирован `INSERT`).
- `remove(m)` — managed → removed (запланирован `DELETE`).
- `detach(m)` / `clear()` / закрытие контекста — managed → detached.
- `merge(d)` — копирует состояние detached-объекта в managed-экземпляр (возвращает managed-копию).
- `refresh(m)` — перечитывает managed-сущность из базы, затирая несохранённые изменения в памяти.

---

## Операции жизненного цикла

```java
EntityManager em = emf.createEntityManager();
em.getTransaction().begin();

// transient → managed: запланирован INSERT, выполнится на flush
User user = new User("alice@example.com");
em.persist(user);

// managed: find возвращает тот же объект (Identity Map), повторный SELECT не идёт
User same = em.find(User.class, user.getId());
assert same == user;

// dirty checking: сеттер без явного save — изменение будет сброшено на flush
user.setEmail("alice2@example.com");

// managed → removed: запланирован DELETE
User toDelete = em.find(User.class, 42L);
em.remove(toDelete);

em.getTransaction().commit(); // flush + commit
em.close();                   // оставшиеся managed-сущности → detached
```

### persist

Переводит transient-объект в managed и планирует `INSERT`. Возвращаемого значения нет — изменяется состояние переданного экземпляра. Если у объекта уже есть назначенный идентификатор существующей строки, `persist` может бросить исключение. `persist` предназначен именно для **новых** сущностей.

### merge

Принимает detached- (или transient-) объект и **копирует его состояние** в управляемый экземпляр, который и возвращает. Важнейший нюанс: переданный аргумент остаётся detached — managed становится только возвращённое значение.

```java
User detached = /* пришёл из предыдущей транзакции / по сети */;
detached.setEmail("new@example.com");

User managed = em.merge(detached); // managed != detached
managed.setEmail("...");           // отслеживается
detached.setEmail("...");          // игнорируется — объект всё ещё detached
```

Если в контексте уже есть управляемая сущность с тем же идентификатором, `merge` копирует поля в неё. Если нет — Hibernate при необходимости выполняет `SELECT`, чтобы загрузить актуальное состояние, и только потом накладывает изменения.

### remove

Переводит managed-сущность в removed и планирует `DELETE`. Удалять можно только управляемый объект; detached-сущность сначала нужно вернуть в контекст через `merge` или `find`.

### detach

Выселяет конкретную сущность из контекста: она становится detached, dirty checking для неё прекращается, несохранённые изменения теряются (не сбрасываются). `clear()` делает то же самое сразу для всех сущностей контекста.

### refresh

Перечитывает состояние managed-сущности из базы, перезаписывая поля в памяти. Используется, когда нужно увидеть изменения, сделанные другой транзакцией, или сбросить локальные правки. Это штатный способ обойти snapshot-семантику контекста (см. раздел про конкурентные изменения в [`databases/DATABASE_TYPES.md`](../../databases/theory/DATABASE_TYPES.md)).

---

## Dirty checking и механизм снапшота

Hibernate не требует явного вызова `save`/`update` для изменения существующей сущности. Управляемые объекты отслеживаются автоматически — это и есть **dirty checking**.

Механизм основан на **снапшоте (snapshot)**: в момент загрузки сущности (`find`, запрос, `persist`) Hibernate сохраняет копию значений её полей — гидратированное состояние (loaded state). Во время flush для каждой managed-сущности текущее состояние полей сравнивается с этим снапшотом.

```
load → snapshot = {email: "a@x", name: "Alice"}
                  managed-объект: {email: "a@x", name: "Alice"}

setEmail("b@x") → managed-объект: {email: "b@x", name: "Alice"}
                  snapshot НЕ меняется

flush → сравнение snapshot vs current → отличается поле email
      → UPDATE users SET email = ? WHERE id = ?
```

Важные следствия:

- Снапшот стоит памяти: для каждой управляемой сущности хранится копия её полей. Загрузка десятков тысяч сущностей в один контекст раздувает память и замедляет flush (сравнение линейно по числу управляемых объектов). Для read-only выборок используйте DTO-проекции или `read-only`-режим — см. [`PERFORMANCE_PITFALLS.md`](PERFORMANCE_PITFALLS.md).
- По умолчанию обновляются **все** колонки сущности, а не только изменённые. Управляется аннотацией `@DynamicUpdate` (генерирует `UPDATE` только по изменённым полям) — ценой повторной подготовки SQL.
- Изменение поля detached-объекта не отслеживается — снапшота нет, контекст закрыт.

---

## Flush: что это и когда происходит

**Flush** — это синхронизация persistence context с базой: Hibernate выполняет накопленные `INSERT`/`UPDATE`/`DELETE`, переводя состояние в памяти в SQL-операторы. Flush **не** означает коммит транзакции — изменения уходят в базу, но фиксируются только при `commit`.

Порядок операторов при flush определяется самим Hibernate (action queue), а не порядком вызовов: сначала все `INSERT`, затем `UPDATE`, потом удаления коллекций, удаления строк и т. д. Это нужно для соблюдения ограничений целостности.

### Flush modes

Режим задаётся через `em.setFlushMode(...)` или на уровне запроса.

| Режим | Когда происходит автоматический flush |
|---|---|
| **AUTO** (по умолчанию) | Перед `commit` и перед выполнением запроса, который может затронуть несохранённые изменения |
| **COMMIT** | Только перед `commit` транзакции; перед запросами flush не выполняется |
| **MANUAL** (Hibernate-специфичный) | Никогда автоматически — только при явном вызове `flush()` |

В нативном Hibernate `FlushMode` богаче (`ALWAYS`, `AUTO`, `COMMIT`, `MANUAL`); JPA-стандарт определяет лишь `AUTO` и `COMMIT`.

### Когда происходит flush

1. **Перед коммитом транзакции** — всегда (кроме случая, когда уже всё сброшено).
2. **Перед выполнением JPQL/HQL/Criteria-запроса** в режиме `AUTO` — чтобы запрос увидел ещё не сохранённые изменения и вернул согласованный результат. Это частая причина «неожиданного» SQL посреди метода.
3. **При явном вызове** `em.flush()`.

Важно: `find()` по идентификатору flush **не** провоцирует — он сначала проверяет L1-кэш (Identity Map) и обращается к базе только при промахе.

```java
User u = new User("x@y");
em.persist(u);                 // INSERT пока НЕ выполнен

// AUTO: запрос может затронуть users → Hibernate сделает flush (INSERT), потом SELECT
List<User> all = em.createQuery("select u from User u", User.class).getResultList();

// COMMIT: тот же запрос НЕ вызвал бы flush — новый user мог бы не попасть в результат
```

### Опасность ручного управления flush

Режим `COMMIT`/`MANUAL` повышает производительность (меньше лишних flush перед запросами), но требует понимания: запрос может вернуть устаревшие данные, не учитывающие несохранённые изменения текущего контекста. Используйте осознанно.

---

## merge vs persist — когда что

| | `persist` | `merge` |
|---|---|---|
| Назначение | новая (transient) сущность | возврат detached-состояния в контекст |
| Возвращаемое значение | `void` (меняет переданный объект) | новый managed-экземпляр (копия) |
| Переданный аргумент после вызова | становится managed | остаётся прежним (transient/detached) |
| Дополнительный `SELECT` | нет | возможен (загрузка текущего состояния перед слиянием) |
| Идемпотентность повторного вызова | повторный `persist` уже-managed — no-op; на detached бросит исключение | безопасен, можно вызывать многократно |

Типичная ошибка — использовать `merge` для сохранения новой сущности: формально работает, но делает лишний `SELECT` и возвращает другой объект, из-за чего легко продолжить работать с устаревшим detached-экземпляром.

```java
// Антипаттерн: продолжаем менять detached, изменения теряются
User m = em.merge(detachedUser);
detachedUser.setName("...");   // НЕ сохранится — detachedUser всё ещё detached
// Правильно: работаем с возвращённым m
```

---

## Detached-сущности: практика

Detached-объекты возникают за пределами транзакции: их возвращают из сервисного слоя в контроллер, передают по сети (DTO-подобный сценарий), кэшируют между запросами.

Главные подводные камни:

- **Обращение к LAZY-ассоциации detached-объекта** → `LazyInitializationException`. Контекст закрыт, дозагрузить нечего. Каноническое описание проблемы и способы её решения — в [`databases/DATABASE_TYPES.md`](../../databases/theory/DATABASE_TYPES.md); fetch-стратегии — в [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md).
- **Изменения detached-объекта молча теряются**, если не вернуть его в контекст через `merge`.
- **`merge` возвращает новый объект** — нужно использовать именно его, а не исходный.

---

## Где почитать дальше

- [`JPA_VS_HIBERNATE.md`](JPA_VS_HIBERNATE.md) — соотношение спецификации JPA и реализации Hibernate, `EntityManager` vs `Session`.
- [`MAPPINGS_ASSOCIATIONS.md`](MAPPINGS_ASSOCIATIONS.md) — отображение сущностей и ассоциаций, каскадирование операций жизненного цикла.
- [`IDENTIFIERS_INHERITANCE.md`](IDENTIFIERS_INHERITANCE.md) — генерация идентификаторов и её влияние на момент `INSERT` при `persist`.
- [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md) — стратегии загрузки, LAZY/EAGER, борьба с проблемой N+1.
- [`TRANSACTIONS_LOCKING.md`](TRANSACTIONS_LOCKING.md) — границы транзакции, оптимистичные/пессимистичные блокировки, влияние на flush.
- [`QUERYING.md`](QUERYING.md) — JPQL/HQL/Criteria и как авто-flush взаимодействует с запросами.
- [`CACHING.md`](CACHING.md) — L1-кэш (этот контекст), L2-кэш и query cache.
- [`PERFORMANCE_PITFALLS.md`](PERFORMANCE_PITFALLS.md) — стоимость снапшота, раздувание контекста, read-only-оптимизации.
- Концепция Identity Map / Unit of Work — [`databases/DATABASE_TYPES.md`](../../databases/theory/DATABASE_TYPES.md).

## Источники

- [Hibernate ORM User Guide — Persistence Context](https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#pc) — состояния сущности, flush, dirty checking.
- *Java Persistence with Hibernate* (Christian Bauer, Gavin King, Gary Gregory) — главы о жизненном цикле объектов и единице работы.
- *High-Performance Java Persistence* (Vlad Mihalcea, 2016) — глава о persistence context, flush-стратегиях и стоимости dirty checking.
- [Vlad Mihalcea — «A beginner's guide to JPA and Hibernate entity state transitions»](https://vladmihalcea.com/a-beginners-guide-to-jpa-hibernate-entity-state-transitions/) — переходы между состояниями.
- [Vlad Mihalcea — «How does the JPA persist() method work»](https://vladmihalcea.com/jpa-persist-and-merge/) — `persist` vs `merge` в деталях.
