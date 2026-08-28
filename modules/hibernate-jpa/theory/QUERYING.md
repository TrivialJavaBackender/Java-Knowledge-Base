# Hibernate / JPA — Запросы: JPQL, Criteria, native, проекции

JPA предлагает несколько способов выразить запрос: декларативный JPQL/HQL (строки), программный типобезопасный Criteria API и «сырые» native-запросы на SQL диалекта БД. Поверх них — выбор между загрузкой управляемых сущностей и проекциями (DTO, интерфейсы, скаляры). От этого выбора зависят и производительность, и риск N+1, и удобство сопровождения.

Этот файл покрывает уровень JPA/Hibernate. Репозитории Spring Data, derived-методы и `Pageable` — отдельная тема, см. [`spring-frameworks/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md). Индексы и план выполнения для ускорения самих SQL-запросов — [`databases/INDEXES.md`](../../databases/theory/INDEXES.md).

---

## 1. Три способа писать запросы

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

## 2. JPQL и HQL

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

### Привязка коллекций, сущностей, ловушка с NULL

**Коллекция в `IN (:ids)`.** Список значений привязывается одним параметром — Hibernate сам разворачивает его в нужное число плейсхолдеров:

```java
em.createQuery("FROM Order o WHERE o.id IN (:ids)", Order.class)
  .setParameter("ids", List.of(1L, 2L, 3L));   // → ... IN (?, ?, ?)
```

Тонкость: число элементов меняет текст SQL → меняется и кэшируемый план. Чтобы не плодить варианты плана, Hibernate (6+) умеет дополнять `IN`-список до степени двойки (`hibernate.query.in_clause_parameter_padding=true`): списки на 3 и на 4 элемента дают один и тот же SQL `IN (?, ?, ?, ?)`, и план переиспользуется. Очень длинные списки (тысячи ID) лучше заменять на временную таблицу или join — иначе упираемся в лимит плейсхолдеров драйвера.

**Привязка сущности и embeddable.** В параметр можно передать саму сущность — Hibernate подставит её идентификатор:

```java
Customer c = em.find(Customer.class, 42L);
em.createQuery("FROM Order o WHERE o.customer = :c", Order.class)
  .setParameter("c", c);          // сравнение по customer_id
```

Так же привязывается embeddable-значение: оно разворачивается в сравнение по всем своим колонкам.

**Ловушка с `NULL`.** В SQL (и JPQL) `= NULL` всегда даёт `UNKNOWN`, а не `TRUE` — строки молча не находятся. Это особенно коварно при привязке параметра, который может оказаться `null`:

```java
// БАГ: если status == null, условие НИКОГДА не истинно — пустой результат без ошибки
em.createQuery("FROM Order o WHERE o.status = :status")
  .setParameter("status", status);   // status может быть null
```

Для проверки на отсутствие значения нужен `IS NULL` / `IS NOT NULL`, а не сравнение через `=`. Если параметр опционален, условие либо строят динамически (Criteria/Specifications), либо пишут защитно: `(:status IS NULL OR o.status = :status)`.

---

## 3. Массовые операции: UPDATE и DELETE

JPQL умеет не только читать. Массовые (bulk) `UPDATE` и `DELETE` меняют множество строк одним SQL-оператором, без загрузки сущностей в память:

```java
int updated = em.createQuery(
    "UPDATE Order o SET o.status = :newStatus " +
    "WHERE o.status = :oldStatus AND o.createdAt < :cutoff")
    .setParameter("newStatus", OrderStatus.EXPIRED)
    .setParameter("oldStatus", OrderStatus.PENDING)
    .setParameter("cutoff", cutoff)
    .executeUpdate();   // возвращает число затронутых строк
```

```sql
UPDATE orders SET status = ? WHERE status = ? AND created_at < ?
```

Альтернатива — прочитать тысячи `Order`, в цикле менять поле и полагаться на dirty checking — это N отдельных `UPDATE`, снапшоты в persistence context и огромный расход памяти. Массовый `UPDATE` делает то же самое одним оператором на стороне БД.

### Главное: массовые операции обходят persistence context

Массовые `UPDATE`/`DELETE` транслируются напрямую в SQL и **полностью минуют persistence context**. Из этого следует цепочка неочевидных последствий:

- **Не срабатывает dirty checking** — Hibernate не сравнивает снапшоты, он просто шлёт `UPDATE`.
- **Не каскадируются операции** — `CascadeType.REMOVE`, `orphanRemoval`, `@PreUpdate`/`@PreRemove`-колбэки **не вызываются**. Массовый `DELETE` родителя не удалит детей каскадом; об этом должна позаботиться сама БД (`ON DELETE CASCADE`) или отдельный массовый `DELETE`.
- **Игнорируется оптимистичная блокировка** — поле `@Version` **не инкрементируется автоматически** (его нужно поднимать вручную: `SET o.version = o.version + 1`), а условие на версию не проверяется. Параллельные транзакции, держащие управляемые копии, не узнают о конфликте.
- **L1-кэш рассинхронизируется** — уже загруженные в persistence context сущности **не обновляются**. Это и есть рассинхронизация persistence context (persistence context desynchronization): в БД новое значение, в L1 — старое.

### Battle-story: массовый UPDATE и устаревший L1

Джоба «истечения» заказов в одной транзакции делала так:

```java
Order order = em.find(Order.class, id);          // (1) загрузили в L1, status = PENDING

em.createQuery("UPDATE Order o SET o.status = :s WHERE o.id = :id")
  .setParameter("s", OrderStatus.EXPIRED)
  .setParameter("id", id)
  .executeUpdate();                               // (2) в БД status = EXPIRED

if (order.getStatus() == OrderStatus.PENDING) {  // (3) в L1 всё ещё PENDING!
    notifyPending(order);                         // отправили ложное уведомление
}
```

Шаг (2) поменял строку в БД, но управляемый объект `order` из шага (1) остался в persistence context с прежним значением `PENDING`. На шаге (3) Hibernate отдал объект из L1, не сходив в БД, — и ветка отработала по устаревшим данным. Хуже того, если бы дальше в той же транзакции сработал flush dirty checking по этому `order`, он мог бы **затереть** значение `EXPIRED` обратно в `PENDING`.

Лечение — выполнять массовые операции до загрузки сущностей, либо вручную сбросить L1 после них:

```java
em.createQuery("UPDATE Order o SET o.status = :s WHERE o.id = :id")
  .setParameter("s", OrderStatus.EXPIRED).setParameter("id", id)
  .executeUpdate();

em.clear();                       // выкинуть все управляемые сущности из L1
Order fresh = em.find(Order.class, id);   // перечитать из БД, status = EXPIRED
```

Практические правила:

- Выполняй массовые `UPDATE`/`DELETE` **до** загрузки затрагиваемых сущностей в persistence context — тогда устаревать нечему.
- Если сущности уже загружены — вызови `em.clear()` (сбросить весь L1) или `em.refresh(entity)` (перечитать конкретную) после массовой операции.
- Hibernate по умолчанию делает auto-flush ожидающих изменений перед запросом (`flushAutoBeforeQuery`), но это решает только обратную проблему — что твои несброшенные правки видны самому запросу; **рассинхрон L1 после массовой операции это не лечит**.
- Помни про `@Version` и каскады — при массовых операциях их нужно обслуживать вручную.

Подробнее про persistence context, управляемые объекты и L1 — [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md).

---

## 4. Подзапросы и коррелированные подзапросы

JPQL поддерживает подзапросы в `WHERE` и `HAVING` (но, по спецификации JPA, **не** в `SELECT`/`FROM` — это расширение конкретных провайдеров).

```java
// Обычный подзапрос: заказы дороже среднего
em.createQuery(
    "SELECT o FROM Order o " +
    "WHERE o.amount > (SELECT AVG(o2.amount) FROM Order o2)", Order.class);
```

**Коррелированный (correlated) подзапрос** ссылается на строку внешнего запроса — он вычисляется заново для каждой такой строки. Типичные операторы — `EXISTS`, `ALL`, `ANY`/`SOME`:

```java
// EXISTS: клиенты, у которых есть хотя бы один оплаченный заказ
em.createQuery(
    "SELECT c FROM Customer c WHERE EXISTS (" +
    "  SELECT 1 FROM Order o WHERE o.customer = c AND o.status = :paid)", Customer.class)
  .setParameter("paid", OrderStatus.PAID);
```

```sql
SELECT c.* FROM customers c WHERE EXISTS (
  SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = ?)
```

Здесь `o.customer = c` — корреляция: подзапрос привязан к текущему `c` внешнего запроса.

- `EXISTS (...)` / `NOT EXISTS (...)` — есть ли хоть одна строка. Обычно эффективнее `IN`-подзапроса и корректно ведёт себя при `NULL`.
- `> ALL (...)` — больше всех значений подзапроса; `> ANY`/`> SOME (...)` — больше хотя бы одного.

Семантика `NULL` в подзапросах коварна: `x NOT IN (подзапрос, где есть NULL)` даёт пустой результат. Поэтому для отрицания предпочитают `NOT EXISTS`, который от `NULL` не страдает. План выполнения подзапроса стоит проверять через `EXPLAIN` — см. [`databases/INDEXES.md`](../../databases/theory/INDEXES.md).

---

## 5. Функции в JPQL

JPQL определяет набор переносимых встроенных функций; для всего остального есть «escape-люк» в произвольную функцию БД.

**Строковые и общие:** `LENGTH`, `SUBSTRING`, `UPPER`/`LOWER`, `TRIM`, `CONCAT`, `LOCATE`, `COALESCE`, `NULLIF`.
**Арифметические:** `ABS`, `MOD`, `SQRT`, `SIZE` (размер коллекции).
**Условные:** `CASE ... WHEN ... THEN ... ELSE ... END`.
**Агрегатные:** `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` (в паре с `GROUP BY`/`HAVING`).

```java
em.createQuery(
    "SELECT c.name, COALESCE(SUM(o.amount), 0), " +
    "  CASE WHEN COUNT(o) > 10 THEN 'VIP' ELSE 'REGULAR' END " +
    "FROM Customer c LEFT JOIN c.orders o " +
    "GROUP BY c.id, c.name HAVING SUM(o.amount) > :threshold", Object[].class)
  .setParameter("threshold", new BigDecimal("1000"));
```

`COALESCE` возвращает первый не-`NULL` аргумент (выше — превращает `NULL` от `SUM` по пустой группе в `0`). `NULLIF(a, b)` даёт `NULL`, если `a = b`.

### Произвольная функция БД через FUNCTION()

Если нужна функция конкретной СУБД, не входящая в JPQL (например, PostgreSQL `date_trunc`, `similarity`, `jsonb_extract_path_text`), её вызывают через `FUNCTION('имя', аргументы...)`:

```java
em.createQuery(
    "SELECT o FROM Order o " +
    "WHERE FUNCTION('date_trunc', 'month', o.createdAt) = :month", Order.class)
  .setParameter("month", month);
```

```sql
SELECT o.* FROM orders o WHERE date_trunc('month', o.created_at) = ?
```

Это позволяет дотянуться до диалектных функций, не опускаясь до полностью native-запроса. Платой идёт потеря переносимости: `FUNCTION('date_trunc', ...)` привяжет запрос к PostgreSQL. В Hibernate 6 многие диалектные функции к тому же зарегистрированы и доступны по имени напрямую; кастомную функцию можно зарегистрировать через `FunctionContributor`.

---

## 6. Неявные и явные джойны

Навигация по ассоциации возможна двумя способами, и разница между ними — частый источник лишних или неожиданных джойнов.

**Неявный (implicit) джойн** — навигация через точку прямо в `WHERE`/`SELECT`:

```java
em.createQuery("SELECT o FROM Order o WHERE o.customer.name = :name", Order.class);
```

**Явный (explicit) джойн** — отдельное ключевое слово `JOIN` с алиасом:

```java
em.createQuery(
    "SELECT o FROM Order o JOIN o.customer c WHERE c.name = :name", Order.class);
```

### Чем коварен неявный джойн

- **Повторный джойн одной и той же ассоциации.** Если упомянуть `o.customer.name` и `o.customer.email` как два разных пути, некоторые версии Hibernate породят **два** джойна к одной таблице `customers` вместо одного. Явный `JOIN o.customer c` с переиспользованием алиаса `c` гарантирует единственный джойн.

```sql
-- неявный путь, упомянутый дважды → лишний JOIN
SELECT o.* FROM orders o
  JOIN customers c1 ON c1.id = o.customer_id   -- для o.customer.name
  JOIN customers c2 ON c2.id = o.customer_id   -- для o.customer.email
```

- **`INNER` там, где ждали все строки.** Неявный джойн по умолчанию `INNER`: строки, где ассоциация `NULL` (заказ без клиента), **молча выпадают** из результата. Если нужны все заказы независимо от наличия клиента — нужен явный `LEFT JOIN o.customer c`.

### JOIN против LEFT JOIN

- `JOIN` (= `INNER JOIN`) — только строки, у которых есть связанная запись.
- `LEFT JOIN` (= `LEFT OUTER JOIN`) — все строки левой сущности; где связи нет, поля правой будут `NULL`. Нужен для агрегатов «включая тех, у кого ноль связанных» (например, клиенты с нулём заказов в `LEFT JOIN c.orders`).

Важно не путать `JOIN` (нужен для условий/проекций по связанной сущности, **не** загружает её) и `JOIN FETCH` (инициализирует ассоциацию ради борьбы с N+1) — последнее разобрано в [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md).

---

## 7. Полиморфные запросы (кратко)

Запрос по абстрактному суперклассу или интерфейсу сущностей **полиморфен**: он вернёт экземпляры всех мапленных подклассов.

```java
// Payment — абстрактная @Entity; вернёт CardPayment, PaypalPayment, ...
List<Payment> all = em.createQuery("FROM Payment p", Payment.class).getResultList();
```

Чтобы ограничить выборку конкретным подтипом, используют `TYPE()`:

```java
em.createQuery("FROM Payment p WHERE TYPE(p) = CardPayment", Payment.class);
```

То, **во что** превратится такой запрос на уровне SQL, целиком зависит от стратегии наследования: `SINGLE_TABLE` даст один `SELECT` с дискриминатором, `JOINED` — джойны таблиц подклассов, `TABLE_PER_CLASS` — `UNION ALL`. Эти стратегии, их компромиссы и влияние на полиморфные запросы — [`IDENTIFIERS_INHERITANCE.md`](IDENTIFIERS_INHERITANCE.md).

---

## 8. Criteria API

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

## 9. Native-запросы

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

## 10. Проекции против загрузки сущностей

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

## 11. Пагинация

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

## 12. `@NamedQuery` и `@NamedNativeQuery`

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

## 13. Querydsl и jOOQ (кратко)

- **Querydsl** — типобезопасный DSL поверх JPA (генерирует Q-классы, как metamodel): даёт читаемость JPQL и типобезопасность Criteria без многословности последнего. Удобен для динамических запросов; платой идёт дополнительная кодогенерация и сторонняя зависимость.
- **jOOQ** — генерирует Java-модель из схемы БД и строит типобезопасный **SQL** (не JPQL). Это не ORM: работает на уровне SQL/диалекта, даёт полный доступ к фичам СУБД с проверкой типов на компиляции. Хорош там, где нужен контроль над SQL и сложная аналитика, но управление сущностями/persistence context — не его задача.

Оба — альтернатива связке JPQL + Criteria, когда хочется одновременно типобезопасность и читаемость.

---

## 14. Где почитать дальше

- [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md) — `JOIN FETCH`, `@EntityGraph`, проблема N+1 и детали пагинации с fetch коллекции.
- [`JPA_VS_HIBERNATE.md`](JPA_VS_HIBERNATE.md) — что из перечисленного спецификация JPA, а что расширение Hibernate.
- [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md) — persistence context, управляемые vs неуправляемые объекты (почему проекции дешевле).
- [`CACHING.md`](CACHING.md) — query cache и почему native-`UPDATE` не виден L1-кэшу.
- [`PERFORMANCE_PITFALLS.md`](PERFORMANCE_PITFALLS.md) — `StatelessSession`, read-only обход, JDBC батчинг.
- [`spring-frameworks/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md) — репозитории, derived queries, `Pageable`, интерфейсные проекции, Specifications.
- [`databases/INDEXES.md`](../../databases/theory/INDEXES.md) — индексы и `EXPLAIN ANALYZE` для ускорения самих запросов (в т. ч. под keyset-пагинацию).

## Источники

- *Hibernate ORM User Guide* — разделы «Hibernate Query Language», «Criteria», «Native SQL Queries», «Pagination», «Bulk update/delete», «HQL functions».
- Jakarta Persistence Specification — главы «Query Language», «Criteria API», «Named Queries», `@SqlResultSetMapping`.
- Vlad Mihalcea — *High-Performance Java Persistence* (DTO-проекции, `@NamedQuery`, native-запросы) и статьи в блоге про DTO-проекции и keyset-пагинацию.
- Markus Winand — *SQL Performance Explained* и use-the-index-luke.com: keyset (seek) pagination против `OFFSET`.
