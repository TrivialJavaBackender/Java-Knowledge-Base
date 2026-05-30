# Типы баз данных

## Реляционные (RDBMS)

Данные в таблицах, связи через foreign keys, строгая схема, ACID-транзакции.

| СУБД | Особенности |
|------|-------------|
| PostgreSQL | Расширяемый, JSONB, PostGIS, MVCC, открытый |
| MySQL/MariaDB | Простота, широкое распространение, InnoDB |
| Oracle | Enterprise, RAC, PL/SQL |
| SQL Server | Windows-экосистема, хорошая интеграция с .NET |

**PostgreSQL** — объектно-реляционная СУБД: поддерживает наследование таблиц, пользовательские типы, операторы и индексные методы. Тип БД — **ORDBMS (Object-Relational)**.

---

## Нереляционные (NoSQL)

### Key-Value

Простейшая модель: ключ → значение. Максимальная скорость для простых операций.

| СУБД | Особенности |
|------|-------------|
| **Redis** | In-memory, структуры данных, pub/sub, TTL |
| DynamoDB | Managed, бесконечное масштабирование, PAY-per-request |
| Riak | Distributed, AP-система |

**Когда:** сессии, кэш, rate limiting, лидерборды в реальном времени.

### Document

Документы (JSON/BSON) без жёсткой схемы. Документ = самодостаточная единица данных.

| СУБД | Особенности |
|------|-------------|
| **MongoDB** | BSON, гибкая схема, горизонтальное шардирование |
| CouchDB | HTTP API, eventually consistent |
| Firestore | Managed, синхронизация в реальном времени |

**Когда:** CMS, каталоги товаров, пользовательские профили с разной структурой.

### Wide-Column (Column Family)

Строки с произвольным числом колонок, сгруппированных в "families". Хорош для разреженных данных и нагрузки с преобладанием записи.

| СУБД | Особенности |
|------|-------------|
| **Cassandra** | AP, линейное масштабирование, нет joins |
| HBase | На Hadoop, CP |
| ScyllaDB | C++ Cassandra-совместимая, меньшую задержку |

**Когда:** IoT-данные, временные ряды, очень высокая пропускная способность записи.

### Graph

Узлы (vertices) и рёбра (edges) с атрибутами. Эффективны для обходов связей.

| СУБД | Особенности |
|------|-------------|
| **Neo4j** | Cypher query language, ACID |
| Amazon Neptune | Managed, RDF и Property Graph |
| ArangoDB | Multi-model: document + graph |

**Когда:** социальные сети, рекомендательные системы, fraud detection.

### Time-Series

Оптимизированы для данных с временной меткой — компрессия, быстрые range-запросы.

| СУБД | Особенности |
|------|-------------|
| **InfluxDB** | Push-based, Flux query language |
| TimescaleDB | PostgreSQL-расширение, SQL |
| Prometheus | Pull-based, PromQL, retention |

**Когда:** метрики, мониторинг, финансовые тики, IoT-сенсоры.

### Search Engines

Инвертированные индексы для полнотекстового поиска, фасетный поиск, scoring.

| СУБД | Особенности |
|------|-------------|
| **Elasticsearch** | Distributed, REST API, Kibana |
| OpenSearch | Open source форк ES |
| Apache Solr | Старше, Lucene-based |

**Когда:** поиск по сайту, логи (ELK stack), аналитика текста.

---

## OLTP vs OLAP vs HTAP

| | OLTP | OLAP | HTAP |
|---|---|---|---|
| Нагрузка | Много коротких транзакций | Долгие аналитические запросы | Оба |
| Оптимизация | Низкая задержка, высокая пропускная способность | Высокая пропускная способность | — |
| Данные | Строки | Колонки | Смешанно |
| Пример | PostgreSQL, MySQL | ClickHouse, BigQuery, Redshift | TiDB, SingleStore |

---

## Колоночные БД — преимущества

В строковых БД строка хранится физически последовательно. В колоночных — каждая колонка отдельно.

```
Строковая:  [id=1, name="Alice", age=30, salary=100k] [id=2, name="Bob", age=25, salary=80k]
Колоночная: [id: 1,2,3...] [name: Alice,Bob,...] [age: 30,25,...] [salary: 100k,80k,...]
```

**Преимущества для аналитики:**
- `SELECT AVG(salary)` читает только колонку `salary`, остальные пропускает → в 10-100x меньше I/O
- Колонка однородная → лучше сжимается (RLE, dictionary encoding): числа одного диапазона, строки из словаря
- Векторизованное выполнение: CPU обрабатывает батчи значений одного типа, использует SIMD

**Недостатки:**
- INSERT/UPDATE медленнее — нужно обновить каждую колонку отдельно
- Плохо для транзакционной нагрузки (OLTP)

**Примеры:** ClickHouse, Apache Parquet (формат), BigQuery, Redshift, DuckDB.

---

## Redis — структуры данных

| Структура | Команды | Применение |
|-----------|---------|------------|
| **String** | `SET`, `GET`, `INCR`, `EXPIRE` | Кэш, счётчики, rate limiting |
| **Hash** | `HSET`, `HGET`, `HGETALL` | Объекты/профили пользователей |
| **List** | `LPUSH`, `RPUSH`, `LRANGE`, `BLPOP` | Очереди, стеки, recent items |
| **Set** | `SADD`, `SMEMBERS`, `SINTER`, `SUNION` | Уникальные элементы, теги |
| **Sorted Set (ZSet)** | `ZADD`, `ZRANGE`, `ZRANK`, `ZRANGEBYSCORE` | Лидерборды, очереди с приоритетом |
| **Bitmap** | `SETBIT`, `BITCOUNT`, `BITOP` | Флаги активности, DAU tracking |
| **HyperLogLog** | `PFADD`, `PFCOUNT` | Приблизительный count distinct |
| **Stream** | `XADD`, `XREAD`, `XGROUP` | Потоковая передача событий, замена Kafka для простых случаев |

**Практические паттерны:**

```
# Rate limiting — sliding window с Sorted Set
ZADD ratelimit:user:123 <now_ms> <request_id>
ZREMRANGEBYSCORE ratelimit:user:123 0 <now_ms - window_ms>
count = ZCARD ratelimit:user:123
if count > limit: reject

# Session store
SET session:<token> <json_data> EX 3600  -- TTL 1 час

# Distributed lock (простой)
SET lock:resource1 <uuid> NX EX 30  -- NX: только если нет, EX: TTL
# NX гарантирует атомарность set-if-not-exists

# Leaderboard
ZADD leaderboard <score> <user_id>
ZREVRANGE leaderboard 0 9 WITHSCORES  -- топ 10
ZRANK leaderboard <user_id>           -- место пользователя

# Pub/Sub
SUBSCRIBE channel-name
PUBLISH channel-name "message"
```

**Redis vs Memcached:**
- Redis: персистентность (RDB/AOF), структуры данных, Lua скрипты, кластер, pub/sub
- Memcached: только строки, нет персистентности, проще, чуть быстрее для чистого кэша

---

## ORM паттерны доступа к данным

### Active Record

Объект содержит и данные, и логику доступа к БД. Строка таблицы = объект класса.

```java
// Active Record: User.find(), user.save()
User user = User.find(id);
user.setEmail("new@email.com");
user.save(); // SQL внутри объекта
```

**Плюсы:** просто, мало кода. **Минусы:** смешивает бизнес-логику и доступ к данным.
**Пример:** Ruby on Rails ActiveRecord.

### Data Mapper

Объекты домена ничего не знают о БД. Отдельный маппер (repository) отвечает за преобразование.

```java
// Data Mapper: repository отдельно от сущности
User user = userRepository.findById(id);
user.setEmail("new@email.com");
userRepository.save(user); // маппер знает как сохранить User
// User ничего не знает о SQL
```

**Плюсы:** чистая архитектура, Unit of Work, тестируемость. **Минусы:** больше кода.
**Пример:** Hibernate (JPA), Doctrine (PHP).

### Identity Map

Кэш загруженных объектов в рамках одной Unit of Work (сессии). Гарантирует, что каждая строка БД = один объект в памяти.

```
userRepo.findById(1) → SELECT ... → User@0x1a2b, кладёт в map {1 → User@0x1a2b}
userRepo.findById(1) → map hit! → возвращает тот же User@0x1a2b, SQL не идёт
```

**Зачем:** предотвращает дублирование объектов, консистентность графа объектов, экономит запросы.

### Unit of Work

Отслеживает все изменения в объектах за одну "работу" (запрос/транзакция). В конце сбрасывает изменения в БД одним батчем.

```java
// Hibernate Session = Unit of Work + Identity Map
Session session = sessionFactory.openSession();
Transaction tx = session.beginTransaction();

User user = session.get(User.class, 1L); // SELECT, добавляет в Identity Map
user.setEmail("new@email.com");          // отмечает как "dirty"
// никаких SQL!

tx.commit(); // Unit of Work: flush → UPDATE users SET email=? WHERE id=1
session.close();
```

**Как работает в Hibernate:**
1. `get()` → SELECT + в Identity Map
2. Изменение поля → объект помечается dirty (через dirty checking при flush)
3. `flush()` / `commit()` → INSERT/UPDATE/DELETE для всех dirty объектов

**Lazy Loading:** `@OneToMany(fetch=LAZY)` — коллекция не загружается до первого обращения.

### N+1 Query Problem — флагманская боль ORM

Сценарий: загрузить 100 заказов и для каждого получить пользователя.

```java
List<Order> orders = orderRepo.findAll();             // 1 запрос: SELECT * FROM orders
for (Order o : orders) {
    System.out.println(o.getUser().getEmail());      // +N запросов: по одному SELECT * FROM users WHERE id=?
}
// Всего: 1 + 100 = 101 запрос
```

В логе Hibernate (если включён `hibernate.show_sql=true`) видно как 100 раз летит один и тот же `SELECT … FROM users WHERE id = ?`. На production это означает 100 обращений к БД, каждое по 1-5ms — итого сотни миллисекунд задержки на одном эндпоинте.

**Почему ORM не решает это автоматически:** N+1 невидим на уровне domain-модели. Доступ `o.getUser()` — обычный геттер, ORM не знает, нужны ли тебе все пользователи или только один.

**Решения (в порядке предпочтения):**

```java
// 1. JOIN FETCH в JPQL — один SQL с join
@Query("SELECT o FROM Order o JOIN FETCH o.user")
List<Order> findAllWithUser();
// SQL: SELECT o.*, u.* FROM orders o JOIN users u ON o.user_id = u.id

// 2. @EntityGraph — декларативно, переиспользуемо
@EntityGraph(attributePaths = "user")
@Query("SELECT o FROM Order o")
List<Order> findAllWithUser();

// 3. Batch fetching — N+1 → ceil(N/batch_size)+1
@BatchSize(size = 50) @OneToMany ...
// или глобально: hibernate.default_batch_fetch_size=50
// Hibernate соберёт ID и сделает: SELECT … FROM users WHERE id IN (?, ?, …, ?)

// 4. DTO projection — не грузить Entity вообще
@Query("SELECT new com.example.OrderDto(o.id, u.email) FROM Order o JOIN o.user u")
List<OrderDto> findOrderSummaries();
```

**Подвох с `JOIN FETCH` + pagination:** Hibernate не может сделать `LIMIT/OFFSET` после `JOIN FETCH` коллекции и **загрузит всё в память + отрежет в Java** (warning `HHH000104: firstResult/maxResults specified with collection fetch`). Решение — двухзапросный паттерн: сначала ID-список с пагинацией, потом `JOIN FETCH WHERE id IN (...)`.

### LazyInitializationException

Связанная проблема: обращение к LAZY-коллекции **после закрытия** Persistence Context'а бросает `LazyInitializationException`. Это чисто Hibernate-специфичный механизм (proxy, область persistence context, корректные решения и почему Open-Session-In-View — плохой обходной путь) — полный разбор вынесен в модуль hibernate-jpa: [`../../hibernate-jpa/theory/FETCHING_NPLUS1.md`](../../hibernate-jpa/theory/FETCHING_NPLUS1.md).

### Identity Map: видимость concurrent UPDATE

Identity Map гарантирует «один объект на ID в сессии». Но между сессиями — нет: если другая транзакция обновила строку, твоя сессия будет видеть **старое значение** в кэшированном объекте до `entityManager.refresh(obj)` или `clear()`. Это не баг — это snapshot-семантика persistence context'а.

---

## Источники

**Books:**
- *Designing Data-Intensive Applications* (Martin Kleppmann, O'Reilly 2017) — Ch. 2 (Data Models and Query Languages), Ch. 3 (Storage and Retrieval).
- *Patterns of Enterprise Application Architecture* (Martin Fowler, 2002) — оригинальные определения Active Record, Data Mapper, Identity Map, Unit of Work.
- *High-Performance Java Persistence* (Vlad Mihalcea, 2016) — самый практичный справочник по JPA/Hibernate, отдельная глава по N+1.

**Документация:**
- [PostgreSQL Documentation](https://www.postgresql.org/docs/16/index.html)
- [MongoDB — Data Modeling Introduction](https://www.mongodb.com/docs/manual/core/data-modeling-introduction/)
- [Cassandra — Data Modeling](https://cassandra.apache.org/doc/latest/cassandra/developing/data-modeling/intro.html)
- [Redis — Data Types](https://redis.io/docs/latest/develop/data-types/)
- [Hibernate ORM User Guide — Fetching strategies](https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#fetching)

**Engineering posts:**
- [Vlad Mihalcea — «The best way to handle the LazyInitializationException»](https://vladmihalcea.com/the-best-way-to-handle-the-lazyinitializationexception/) — все варианты с компромиссами.
- [Vlad Mihalcea — «How to detect the Hibernate N+1 query problem during testing»](https://vladmihalcea.com/how-to-detect-the-n-plus-one-query-problem-during-testing/) — datasource-proxy для проверок в тестах.
- [Markus Winand — *Use The Index, Luke!* — Pagination chapter](https://use-the-index-luke.com/no-offset) — почему `OFFSET` плох даже без N+1.
- [«MongoDB Schema Design Best Practices»](https://www.mongodb.com/developer/products/mongodb/mongodb-schema-design-best-practices/) — embedding vs referencing.
