# Hibernate / JPA — Запросы: JPQL, Criteria, native, проекции

JPA предлагает несколько способов выразить запрос: декларативный JPQL/HQL (строки), программный типобезопасный Criteria API и «сырые» native-запросы на SQL диалекта БД. Поверх них — выбор между загрузкой управляемых сущностей и проекциями (DTO, интерфейсы, скаляры). От этого выбора зависят и производительность, и риск N+1, и удобство сопровождения.

Этот файл покрывает уровень JPA/Hibernate. Репозитории Spring Data, derived-методы и `Pageable` — отдельная тема, см. [`spring-frameworks/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md). Индексы и план выполнения для ускорения самих SQL-запросов — [`databases/INDEXES.md`](../../databases/theory/INDEXES.md).

---

## Три способа писать запросы

| Критерий | JPQL/HQL | Criteria API | Native SQL |
|---|---|---|---|
| Что это | строковый язык запросов над сущностями | программная сборка дерева запроса | строка SQL диалекта БД |
| Привязка к схеме | к модели сущностей (имена полей) | к модели сущностей + metamodel | к таблицам/колонкам БД |
| Типобезопасность | нет (ошибка в рантайме) | да (через `JPAMetamodel`) | нет |
| Переносимость между СУБД | высокая | высокая | низкая |
| Читаемость статичного запроса | высокая | низкая (многословно) | высокая |
| Динамические запросы (фильтры) | склейка строк — хрупко | сильная сторона | склейка строк — хрупко |
| Доступ к фичам конкретной СУБД | ограничен | ограничен | полный (CTE, window functions, `JSONB`) |

Практическое правило: статичные запросы — JPQL/HQL; запросы с переменным набором условий — Criteria; то, что JPQL не умеет (специфика диалекта, рекурсивные CTE, оконные функции) — native.

---

## JPQL и HQL

JPQL (Jakarta Persistence Query Language) — подмножество, описанное спецификацией. HQL (Hibernate Query Language) — надмножество JPQL, реализованное в Hibernate: всё валидное JPQL — валидный HQL, но HQL добавляет расширения.

```java
List<Order> orders = em.createQuery(
    "SELECT o FROM Order o WHERE o.status = :status ORDER BY o.createdAt DESC",
    Order.class
).setParameter("status", OrderStatus.PAID).getResultList();
```

Запрос пишется в терминах **сущностей и их полей**, а не таблиц и колонок. `FROM Order o` — это сущность `Order`, а не таблица `orders`. Навигация по ассоциациям — через точку: `o.customer.name`.

### Отличия HQL от JPQL

HQL добавляет, в частности:

- оконные функции и расширенный набор SQL-функций;
- `INSERT ... SELECT`, более гибкие массовые операции;
- неявные джойны по ассоциациям, нестандартные `LIMIT/OFFSET`-конструкции;
- работу с map-ключами, индексами списков (`INDEX()`, `KEY()`, `VALUE()`).

Если важна переносимость на другой провайдер JPA — держитесь подмножества JPQL. Для проекта, жёстко сидящего на Hibernate, расширения HQL допустимы.

### Параметры: named vs positional

```java
// Named (предпочтительно) — читаемо, не зависит от порядка
em.createQuery("FROM User u WHERE u.email = :email AND u.active = :active")
  .setParameter("email", email)
  .setParameter("active", true);

// Positional — по индексу ?1, ?2
em.createQuery("FROM User u WHERE u.email = ?1 AND u.active = ?2")
  .setParameter(1, email)
  .setParameter(2, true);
```

Named-параметры предпочтительны: код читается лучше, порядок задания не важен, один параметр можно переиспользовать в нескольких местах запроса.

### Защита от SQL-инъекций

Параметры (`:name` / `?1`) — это **bind-переменные**: значение уходит в БД отдельно от текста запроса и никогда не интерпретируется как SQL. Это и есть штатная защита от инъекций.

```java
// ОПАСНО: конкатенация пользовательского ввода в текст запроса
em.createQuery("FROM User u WHERE u.email = '" + email + "'"); // SQLi

// БЕЗОПАСНО: bind-параметр
em.createQuery("FROM User u WHERE u.email = :email").setParameter("email", email);
```

Дополнительный бонус bind-параметров — переиспользование плана выполнения и кэша Hibernate: текст запроса стабилен, меняются только значения.

---

## Criteria API

Criteria — программная сборка запроса из объектов. Главная ценность — **типобезопасность** и удобство для **динамических запросов**, где набор условий определяется в рантайме.

```java
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery<Order> cq = cb.createQuery(Order.class);
Root<Order> root = cq.from(Order.class);

List<Predicate> predicates = new ArrayList<>();
if (status != null) {
    predicates.add(cb.equal(root.get(Order_.status), status)); // metamodel Order_
}
if (minAmount != null) {
    predicates.add(cb.ge(root.get(Order_.amount), minAmount));
}
cq.where(predicates.toArray(new Predicate[0]))
  .orderBy(cb.desc(root.get(Order_.createdAt)));

List<Order> result = em.createQuery(cq).getResultList();
```

### JPA metamodel

`Order_.status`, `Order_.amount` — это сгенерированный статический metamodel-класс (`<Entity>_`), который порождает annotation processor (`hibernate-jpamodelgen`) на этапе компиляции. Благодаря ему ссылки на поля проверяются компилятором: переименовали поле — код перестанет компилироваться, а не упадёт в рантайме. Без metamodel можно писать строками (`root.get("status")`), но тогда теряется главное преимущество.

### Когда оправдан и его минусы

Оправдан, когда **набор условий и сортировок собирается динамически** — фильтры в поисковой форме, спецификации. Тогда строковая склейка JPQL превращается в хрупкий конкатенатор, а Criteria собирает дерево предикатов чисто.

Минус — **многословность**. Простой статичный запрос на JPQL в одну строку на Criteria раздувается в десяток. Для статики JPQL читается несравнимо лучше. Поэтому Criteria — инструмент именно динамики, а не замена JPQL «по умолчанию». В Spring-проектах динамику часто закрывают Specifications (надстройка над Criteria) — см. [`spring-frameworks/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md).

---

## Native-запросы

Когда JPQL/Criteria не хватает (специфические для СУБД конструкции — рекурсивные CTE, оконные функции, `JSONB`-операторы PostgreSQL, хинты оптимизатора), пишут native SQL.

```java
List<Order> orders = em.createNativeQuery(
    "SELECT * FROM orders WHERE status = :status", Order.class
).setParameter("status", "PAID").getResultList();
```

Если результат маппится на сущность, Hibernate возвращает управляемые объекты. Для сложного результата (несколько сущностей или сущность + скаляры) применяют `@SqlResultSetMapping`:

```java
@SqlResultSetMapping(
    name = "OrderWithTotal",
    entities = @EntityResult(entityClass = Order.class),
    columns = @ColumnResult(name = "line_total", type = BigDecimal.class)
)
@NamedNativeQuery(
    name = "Order.withTotal",
    query = "SELECT o.*, SUM(i.price) AS line_total FROM orders o " +
            "JOIN order_items i ON i.order_id = o.id GROUP BY o.id",
    resultSetMapping = "OrderWithTotal"
)
```

Минусы native-запросов: привязка к диалекту (теряется переносимость), нет проверки имён колонок, и — важный момент — изменения, сделанные native-`UPDATE`/`DELETE` в обход persistence context, **не видны L1-кэшу** и могут оставить в нём устаревшие сущности. Bind-параметры в native-запросах так же обязательны для защиты от инъекций.

---

## Проекции против загрузки сущностей

Загрузка управляемой сущности тянет все её базовые поля, регистрирует объект в persistence context, включает dirty checking и поддержку lazy-ассоциаций. Для **чтения** (read-only) это лишняя работа. Проекция возвращает ровно нужные поля, минуя накладные расходы persistence context.

### DTO через constructor expression

```java
List<OrderSummary> summaries = em.createQuery(
    "SELECT new com.app.dto.OrderSummary(o.id, o.amount, o.customer.name) " +
    "FROM Order o WHERE o.status = :status", OrderSummary.class
).setParameter("status", OrderStatus.PAID).getResultList();
```

`SELECT new <FQN>(...)` вызывает конструктор DTO с указанными аргументами. Класс DTO должен иметь точно подходящий конструктор; имя класса — полностью квалифицированное. Результат — обычные неуправляемые объекты, без dirty checking.

### Интерфейсные проекции

В Spring Data можно объявить интерфейс с геттерами — провайдер сам отдаст прокси, читающий только нужные колонки (closed projection). Принадлежит [`spring-frameworks/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md).

### Tuple и скаляры

```java
// Tuple — доступ к колонкам по алиасу, без отдельного DTO
List<Tuple> rows = em.createQuery(
    "SELECT o.id AS id, o.amount AS amount FROM Order o", Tuple.class
).getResultList();
BigDecimal amount = rows.get(0).get("amount", BigDecimal.class);

// Скаляры — Object[] на строку (наименее типобезопасно)
List<Object[]> raw = em.createQuery(
    "SELECT o.id, o.amount FROM Order o", Object[].class
).getResultList();
```

### Выигрыш read-only проекций

- Меньше данных по сети — выбираются только нужные колонки.
- Нет регистрации в persistence context → нет dirty checking и снапшот-копий → меньше памяти и CPU.
- Нет риска случайно дёрнуть lazy-ассоциацию и схлопотать N+1.

Правило: **читаешь для отображения — бери DTO-проекцию; собираешься менять — грузи сущность.** Альтернатива для read-only обхода больших объёмов — `StatelessSession`, см. [`PERFORMANCE_PITFALLS.md`](PERFORMANCE_PITFALLS.md).

---

## Пагинация

```java
List<Order> page = em.createQuery("FROM Order o ORDER BY o.createdAt DESC", Order.class)
    .setFirstResult(40)   // OFFSET
    .setMaxResults(20)    // LIMIT
    .getResultList();
```

`setFirstResult`/`setMaxResults` транслируются в `OFFSET`/`LIMIT` (или диалектный эквивалент). Это OFFSET-пагинация — простая, но с двумя проблемами на больших данных.

### Battle-story: OFFSET-пагинация на «бесконечной ленте»

Лента событий, сортировка по `created_at DESC`, страницы по 20 через `OFFSET`. На первых страницах всё летает. К странице 5000 (`OFFSET 100000`) запрос начинает занимать сотни миллисекунд. Причина: чтобы отдать строки 100000–100020, БД **должна прочитать и отбросить первые 100000 строк** — `OFFSET` не «прыгает», он линейно проматывает. Стоимость страницы растёт линейно с её номером.

Вторая, более коварная беда — **дрейф окна**. Пока пользователь листает, в начало ленты падают новые события. `OFFSET` отсчитывается от текущего состояния таблицы, поэтому при переходе со страницы N на N+1 граница сдвигается: одни записи показываются дважды, другие пропадают. Для бесконечной прокрутки это видимый баг.

### Keyset / seek pagination

Решение — пагинация по «курсору»: вместо «пропусти 100000» сказать «дай то, что **после** вот этого значения». Курсор — последнее значение колонки сортировки (плюс tie-breaker для уникальности).

```java
// Первая страница
List<Order> first = em.createQuery(
    "FROM Order o ORDER BY o.createdAt DESC, o.id DESC", Order.class
).setMaxResults(20).getResultList();

// Следующая: курсор — (createdAt, id) последней записи предыдущей страницы
List<Order> next = em.createQuery(
    "FROM Order o WHERE (o.createdAt, o.id) < (:ts, :id) " +
    "ORDER BY o.createdAt DESC, o.id DESC", Order.class
).setParameter("ts", lastTs).setParameter("id", lastId)
 .setMaxResults(20).getResultList();
```

Преимущества keyset:

- **Постоянная стоимость страницы.** При индексе по `(created_at, id)` БД делает range scan от курсора — без проматывания пропущенных строк. Страница 5000 стоит столько же, сколько первая.
- **Нет дрейфа окна.** Курсор привязан к данным, а не к смещению, поэтому вставки в начало ленты не сдвигают границу.

Цена: нельзя «прыгнуть на страницу 4217» (только «вперёд/назад»), а tie-breaker и индекс под сортировку обязательны. Подробнее про индекс под keyset — [`databases/INDEXES.md`](../../databases/theory/INDEXES.md).

### Ловушка: пагинация при `JOIN FETCH` коллекции

Нельзя одновременно делать `JOIN FETCH` коллекции (`*ToMany`) и `setMaxResults`/`setFirstResult`. `LIMIT` отрезал бы строки декартова произведения, а не сущности, поэтому Hibernate загружает **весь** результат в память и режет в Java (`HHH000104: applying in memory`) — прямой путь к `OutOfMemoryError`. Корректное решение — двухзапросный паттерн (страница ID → `JOIN FETCH WHERE id IN`). Детали — [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md).

---

## `@NamedQuery` и `@NamedNativeQuery`

Именованные запросы объявляются на сущности и парсятся/валидируются один раз при старте приложения (а не при каждом вызове):

```java
@NamedQuery(
    name = "Order.findByStatus",
    query = "SELECT o FROM Order o WHERE o.status = :status"
)
@Entity
public class Order { /* ... */ }

// Использование
em.createNamedQuery("Order.findByStatus", Order.class)
  .setParameter("status", OrderStatus.PAID).getResultList();
```

`@NamedNativeQuery` — то же для native SQL (часто в паре с `@SqlResultSetMapping`). Плюс именованных запросов: синтаксис JPQL проверяется на старте — опечатка падает сразу, а не в рантайме под нагрузкой. Минус: запрос статичен, для динамики не годится.

---

## Querydsl и jOOQ (кратко)

- **Querydsl** — типобезопасный DSL поверх JPA (генерирует Q-классы, как metamodel): даёт читаемость JPQL и типобезопасность Criteria без многословности последнего. Удобен для динамических запросов; платой идёт дополнительная кодогенерация и сторонняя зависимость.
- **jOOQ** — генерирует Java-модель из схемы БД и строит типобезопасный **SQL** (не JPQL). Это не ORM: работает на уровне SQL/диалекта, даёт полный доступ к фичам СУБД с проверкой типов на компиляции. Хорош там, где нужен контроль над SQL и сложная аналитика, но управление сущностями/persistence context — не его задача.

Оба — альтернатива связке JPQL + Criteria, когда хочется одновременно типобезопасность и читаемость.

---

## Где почитать дальше

- [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md) — `JOIN FETCH`, `@EntityGraph`, проблема N+1 и детали пагинации с fetch коллекции.
- [`JPA_VS_HIBERNATE.md`](JPA_VS_HIBERNATE.md) — что из перечисленного спецификация JPA, а что расширение Hibernate.
- [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md) — persistence context, управляемые vs неуправляемые объекты (почему проекции дешевле).
- [`CACHING.md`](CACHING.md) — query cache и почему native-`UPDATE` не виден L1-кэшу.
- [`PERFORMANCE_PITFALLS.md`](PERFORMANCE_PITFALLS.md) — `StatelessSession`, read-only обход, JDBC батчинг.
- [`spring-frameworks/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md) — репозитории, derived queries, `Pageable`, интерфейсные проекции, Specifications.
- [`databases/INDEXES.md`](../../databases/theory/INDEXES.md) — индексы и `EXPLAIN ANALYZE` для ускорения самих запросов (в т. ч. под keyset-пагинацию).

## Источники

- *Hibernate ORM User Guide* — разделы «Hibernate Query Language», «Criteria», «Native SQL Queries», «Pagination».
- Jakarta Persistence Specification — главы «Query Language», «Criteria API», «Named Queries», `@SqlResultSetMapping`.
- Vlad Mihalcea — *High-Performance Java Persistence* (DTO-проекции, `@NamedQuery`, native-запросы) и статьи в блоге про DTO-проекции и keyset-пагинацию.
- Markus Winand — *SQL Performance Explained* и use-the-index-luke.com: keyset (seek) pagination против `OFFSET`.
