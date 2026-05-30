# Hibernate / JPA — Fetch-стратегии и проблема N+1

Концептуальная теория проблемы N+1 (что это, почему ORM не решает её автоматически, общий каталог решений) принадлежит [`databases/DATABASE_TYPES.md`](../../databases/theory/DATABASE_TYPES.md) — секции «N+1 Query Problem» и «LazyInitializationException». Здесь раскрывается **механика Hibernate**: как устроены proxy и инициализация lazy-ассоциаций, во что реально превращаются `JOIN FETCH` / `@EntityGraph` / `@BatchSize` на уровне SQL, как обнаруживать N+1 и почему `LazyInitializationException` возникает именно так, как возникает.

---

## FetchType: LAZY vs EAGER

JPA задаёт два режима загрузки ассоциаций. По умолчанию:

| Ассоциация | FetchType по умолчанию |
|---|---|
| `@ManyToOne` | `EAGER` |
| `@OneToOne` | `EAGER` |
| `@OneToMany` | `LAZY` |
| `@ManyToMany` | `LAZY` |

**Правило senior-практики:** всегда явно ставить `fetch = LAZY` на `@ManyToOne` и `@OneToOne`. Дефолтный `EAGER` для `*ToOne` — историческая ошибка спецификации.

### Почему EAGER опасен

1. **Невыключаемость.** `EAGER` нельзя «отключить» на уровне конкретного запроса. Если ассоциация помечена `EAGER`, она будет загружаться **всегда** — даже когда конкретному запросу пользователь не нужен. `LAZY` же можно при необходимости догрузить через `JOIN FETCH`. То есть `LAZY` — это «по умолчанию ничего лишнего, догружаем точечно», а `EAGER` — «всегда тянем, отказаться нельзя».

2. **Скрытый каскад джойнов.** Сущность с тремя `EAGER`-ассоциациями, каждая из которых тоже что-то тянет, порождает дерево джойнов, которое разработчик не писал и не видит.

3. **EAGER + HQL/JPQL = N+1.** Тонкий момент: когда вы выполняете `entityManager.createQuery("FROM Order")`, Hibernate **не** добавляет джойны для `EAGER`-ассоциаций в ваш HQL автоматически. Он выполнит ваш запрос, а затем для каждой `EAGER`-ассоциации каждой строки выпустит отдельный SELECT. Результат — классический N+1, спровоцированный именно `EAGER`. `find()` (по первичному ключу) джойны добавляет, а вот произвольный HQL — нет.

```java
// Order.user помечен EAGER
List<Order> orders = em.createQuery("FROM Order", Order.class).getResultList();
// SQL: SELECT * FROM orders                              (1 запрос)
//      SELECT * FROM users WHERE id = ?  -- для каждого заказа   (N запросов)
```

---

## Устройство proxy и инициализация lazy-ассоциаций

Чтобы `LAZY` работал, Hibernate должен подсунуть на место незагруженной ассоциации объект-заместитель (proxy), который при первом обращении сходит в БД. Есть два механизма.

### 1. Proxy через подкласс (классический Hibernate proxy)

Для `@ManyToOne` / `@OneToOne` Hibernate во время выполнения генерирует **подкласс** сущности (исторически — через CGLIB/Javassist, сейчас — ByteBuddy). Каждый метод подкласса перехвачен: первое обращение к любому свойству (кроме `getId()`) триггерит SELECT и инициализирует proxy.

```java
Order order = em.find(Order.class, 1L);   // user ещё не загружен
User u = order.getUser();                  // вернётся Proxy (подкласс User$HibernateProxy)
u.getId();                                 // НЕ триггерит SELECT — id уже известен из FK
u.getEmail();                              // триггерит SELECT * FROM users WHERE id = ?
```

Последствия этого механизма, которые спрашивают на интервью:
- **Сущность не может быть `final`** — иначе её нельзя унаследовать proxy.
- **`getId()` proxy не инициализирует** — id берётся из внешнего ключа без обращения к БД.
- **`instanceof` и сравнение классов ломаются:** `proxy.getClass() != User.class`. Поэтому `equals`/`hashCode` сущностей пишут на бизнес-ключе, а внутри `equals` используют `Hibernate.getClass(obj)` вместо `obj.getClass()`.
- **`ClassCastException` при наследовании:** proxy `Payment` нельзя привести к `CreditCardPayment`, даже если в БД лежит именно она. Лечится `Hibernate.unproxy()`.

### 2. Bytecode enhancement

Альтернатива — модификация байткода самой сущности на этапе сборки (плагин `hibernate-enhance-maven-plugin` / Gradle). Тогда proxy-подкласс не нужен: поля сущности перехватываются интерцепторами прямо в исходном классе. Это даёт:
- **Lazy на уровне отдельных полей** (`@Basic(fetch = LAZY)`) — например, не грузить тяжёлый `@Lob`, пока к нему не обратились. Без enhancement атрибут-level lazy не работает.
- **Lazy для `*ToOne` без proxy** — корректный `instanceof`, нет проблемы с `final`-подклассом.
- Цена — усложнение сборки и менее предсказуемое поведение при отладке.

### Проверка и форсированная инициализация

```java
Hibernate.isInitialized(order.getUser());   // false, пока не тронули
Hibernate.initialize(order.getItems());     // принудительно инициализировать
User real = (User) Hibernate.unproxy(order.getUser());  // развернуть proxy
```

---

## Решения N+1 в Hibernate

Ниже — то, во что эти приёмы превращаются на уровне SQL, и их ловушки.

| Приём | Запросов вместо N+1 | Когда применять | Главная ловушка |
|---|---|---|---|
| `JOIN FETCH` | 1 | точечно, под конкретный запрос | дубли строк; пагинация в памяти при загрузке коллекции |
| `@EntityGraph` | 1 | декларативно, переиспользуемо на Spring Data | то же, что у `JOIN FETCH` (это тот же join под капотом) |
| `@BatchSize` / `default_batch_fetch_size` | ⌈N / size⌉ + 1 | когда коллекций/ассоциаций много и заранее неизвестно, нужны ли | не убирает все запросы, только укрупняет |
| `@Fetch(SUBSELECT)` | 2 | загрузка коллекций для всего исходного результата | повторно выполняет исходный запрос как подзапрос |
| DTO-проекция | 1 | read-only сценарии, когда сущность не нужна | теряете managed-сущность и dirty checking |

### JOIN FETCH

```java
List<Order> orders = em.createQuery(
    "SELECT o FROM Order o JOIN FETCH o.user", Order.class).getResultList();
// SQL: SELECT o.*, u.* FROM orders o JOIN users u ON o.user_id = u.id   (1 запрос)
```

**Ловушка 1 — дубли строк при загрузке коллекции.** `JOIN FETCH` коллекции (`*ToMany`) разворачивает декартово произведение: заказ с 3 позициями вернётся 3 раза. В результате `List<Order>` будет содержать дубли одного и того же управляемого объекта.

```java
// SELECT o.*, i.* FROM orders o JOIN items i ON i.order_id = o.id
// 10 заказов × в среднем 4 позиции → 40 строк → 40 раз один и тот же Order в List
```

Лечение: `SELECT DISTINCT o FROM Order o JOIN FETCH o.items` (в Hibernate 6 `DISTINCT` для сущностей дедуплицирует в памяти, не добавляя `DISTINCT` в SQL; в Hibernate 5 нужна была подсказка `hibernate.query.passDistinctThrough=false`), либо `Set` вместо `List`.

**Ловушка 2 — пагинация в памяти.** Нельзя одновременно делать `JOIN FETCH` коллекции и `setMaxResults()/setFirstResult()`. На уровне SQL `LIMIT` отрезал бы строки декартова произведения, а не сущности. Hibernate это «спасает» тем, что **загружает весь результат в память и режет в Java**, выдавая предупреждение:

```
HHH000104: firstResult/maxResults specified with collection fetch; applying in memory
```

На большой таблице это означает выгрузку всех строк в heap — потенциальный `OutOfMemoryError`. Корректное решение — **двухзапросный паттерн**: сначала тянем страницу идентификаторов (без загрузки коллекции), затем `JOIN FETCH WHERE id IN (:ids)`.

```java
List<Long> ids = em.createQuery("SELECT o.id FROM Order o ORDER BY o.createdAt", Long.class)
    .setFirstResult(0).setMaxResults(20).getResultList();          // пагинация по PK
List<Order> page = em.createQuery(
    "SELECT DISTINCT o FROM Order o JOIN FETCH o.items WHERE o.id IN :ids", Order.class)
    .setParameter("ids", ids).getResultList();                      // fetch без LIMIT
```

> Загрузка **двух** независимых коллекций одним `JOIN FETCH` (`MultipleBagFetchException` / декартово произведение коллекций) — отдельный антипаттерн: количество строк перемножается. Грузите коллекции разными запросами или через `@BatchSize`.

### @EntityGraph: fetch graph vs load graph

`@EntityGraph` — декларативный способ сказать «к этому запросу догрузи такие-то ассоциации». Существует два семантических режима, задаваемых свойством `jakarta.persistence.fetchgraph` или `jakarta.persistence.loadgraph`:

- **Fetch graph** (`fetchgraph`): атрибуты, **перечисленные** в графе, грузятся `EAGER`; **всё остальное** трактуется как `LAZY`, даже если в маппинге стоит `EAGER`. То есть граф — исчерпывающее описание того, что грузить.
- **Load graph** (`loadgraph`): перечисленные атрибуты грузятся `EAGER`; остальные — **по их маппингу** (`EAGER` остаётся `EAGER`).

Spring Data `@EntityGraph(attributePaths = ...)` по умолчанию использует тип `FETCH` (можно переключить через `type = EntityGraph.EntityGraphType.LOAD`). Под капотом это тот же left join, что и `JOIN FETCH`, поэтому **все ловушки `JOIN FETCH` (дубли, пагинация коллекций) действуют и здесь.**

```java
@EntityGraph(attributePaths = {"user", "items"})
@Query("SELECT o FROM Order o")
List<Order> findAllWithUserAndItems();
```

### @BatchSize и hibernate.default_batch_fetch_size

Вместо N отдельных SELECT Hibernate собирает идентификаторы непроинициализированных proxy в «пачки» и грузит их одним `IN`-запросом. N+1 превращается в ⌈N / size⌉ + 1.

```java
@OneToMany(fetch = LAZY)
@BatchSize(size = 25)
private List<Item> items;
// При обходе 100 заказов:
// SELECT * FROM items WHERE order_id IN (?,?,...,?)   -- по 25 id, итого 4 запроса + 1 исходный
```

Глобально — без аннотаций на каждой ассоциации:

```properties
hibernate.default_batch_fetch_size=25
```

Hibernate 6 по умолчанию использует `IN`-предикат с паддингом размера пачки до степеней (2, 4, 8, 16, …) — чтобы переиспользовать план запроса в кэше БД и не плодить уникальные prepared statements под каждый размер `IN`-списка. Это лучший «фоновый» дефолт: он не убирает N+1 полностью, но превращает катастрофу (101 запрос) в приемлемые 5.

### @Fetch(FetchMode.SUBSELECT)

Коллекции для **всего** исходного результата грузятся одним запросом, где условие — подзапрос, повторяющий исходный SELECT (без загрузки ассоциаций).

```java
@OneToMany
@Fetch(FetchMode.SUBSELECT)
private List<Item> items;
// SELECT * FROM orders WHERE ...                                 -- исходный (1)
// SELECT * FROM items WHERE order_id IN (
//     SELECT id FROM orders WHERE ...)                            -- подзапрос (2)
```

Итого ровно 2 запроса независимо от N. Минус: исходный запрос выполняется повторно как подзапрос; на тяжёлых фильтрах это дублирование стоит дорого. `SUBSELECT` хорош, когда исходная выборка дешёвая, а коллекций много.

---

## Обнаружение N+1

N+1 не виден в коде — `order.getUser()` это обычный геттер. Поэтому его ловят инструментами.

- **`hibernate.generate_statistics=true`** — Hibernate ведёт `SessionFactory.getStatistics()`: число выполненных запросов, prepared statements, загруженных сущностей. Резкий рост `getQueryExecutionCount()` на одном эндпоинте — сигнал N+1.
- **datasource-proxy** — обёртка над `DataSource`, логирующая каждый реальный SQL с таймингами; в отличие от `hibernate.show_sql` (пишет в stdout без батч-агрегации) умеет считать и группировать запросы. В тестах удобно ставить ассерт «не более K запросов».
- **Hypersistence Utils / `AssertSqlCount`** — в интеграционных тестах фиксировать ожидаемое число SQL: тест падает, если кто-то случайно вернул `EAGER` или добавил обращение к lazy в цикле.
- Никогда не полагайтесь только на `hibernate.show_sql=true` в проде — он не агрегирует и не считает, N+1 в потоке логов легко не заметить.

```java
Statistics stats = sessionFactory.getStatistics();
// до эндпоинта
long before = stats.getPrepareStatementCount();
// ... выполнить сценарий ...
assertThat(stats.getPrepareStatementCount() - before).isLessThanOrEqualTo(2);
```

---

## LazyInitializationException

Это **обратная сторона** lazy-загрузки: попытка инициализировать proxy/коллекцию **после закрытия** persistence context (сессии). Hibernate proxy умеет догрузить данные только пока сессия открыта; после закрытия идти в БД не через что.

```java
@Transactional
public Order load(Long id) {
    return repo.findById(id).orElseThrow();   // транзакция/сессия закроется на выходе из метода
}

// Контроллер — вне транзакции:
Order o = service.load(1L);
o.getItems().size();   // LazyInitializationException: could not initialize proxy — no Session
```

### Корректные решения

1. **Инициализировать нужные ассоциации внутри транзакции** — через `JOIN FETCH` или `@EntityGraph`. Загружаем ровно то, что понадобится потребителю.
2. **Возвращать DTO, а не сущность.** За пределы транзакционного слоя отдаём данные, а не управляемые объекты. Это и устраняет `LazyInitializationException`, и убирает риск случайного N+1 в слое представления.
3. **`Hibernate.initialize(...)`** для точечной инициализации внутри сервиса, когда `JOIN FETCH` неудобен.

### Чего делать НЕ нужно

- **Open Session In View (OSIV)** — держать persistence context открытым на всю длину HTTP-запроса (в Spring Boot включён по умолчанию: `spring.jpa.open-in-view=true`). Это «лечит» симптом `LazyInitializationException`, но переносит выполнение SQL в слой сериализации ответа, маскирует N+1, удерживает соединение из пула дольше нужного и ломает границы транзакций. Это обходной путь, а не решение — подробный разбор в [`PERFORMANCE_PITFALLS.md`](PERFORMANCE_PITFALLS.md).
- **Глобальный `EAGER`** «чтобы не падало» — лечит исключение ценой постоянной перегрузки и нового N+1 (см. выше).

---

## Где почитать дальше

- [`databases/DATABASE_TYPES.md`](../../databases/theory/DATABASE_TYPES.md) — каноническая теория N+1 и `LazyInitializationException` (что это и почему ORM не решает автоматически).
- [`graphql-kotlin/DATALOADER_NPLUS1.md`](../../graphql-kotlin/theory/DATALOADER_NPLUS1.md) — N+1 в GraphQL и его решение через DataLoader (batching + deduplication).
- [`MAPPINGS_ASSOCIATIONS.md`](MAPPINGS_ASSOCIATIONS.md) — owning vs inverse side, `equals`/`hashCode` для сущностей с proxy.
- [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md) — persistence context, состояния сущности, когда сессия закрывается.
- [`CACHING.md`](CACHING.md) — L1/L2-кэш и его взаимодействие с batch fetching.
- [`QUERYING.md`](QUERYING.md) — JPQL/HQL, DTO-проекции, пагинация и её ловушки.
- [`TRANSACTIONS_LOCKING.md`](TRANSACTIONS_LOCKING.md) — границы транзакций, внутри которых живут lazy-ассоциации.
- [`PERFORMANCE_PITFALLS.md`](PERFORMANCE_PITFALLS.md) — OSIV-антипаттерн, JDBC-батчинг, `StatelessSession`.

## Источники

- Vlad Mihalcea — *High-Performance Java Persistence* (главы про fetching, N+1, batching, `@BatchSize`, `JOIN FETCH` и пагинацию).
- Vlad Mihalcea — статьи в блоге: «The best way to fix the Hibernate MultipleBagFetchException», «How to paginate with JOIN FETCH», «N+1 query problem».
- *Hibernate ORM User Guide* — разделы «Fetching», «Bytecode Enhancement», «Batch fetching», «Proxies».
- Jakarta Persistence Specification — `FetchType`, `EntityGraph` (`fetchgraph` / `loadgraph`).
