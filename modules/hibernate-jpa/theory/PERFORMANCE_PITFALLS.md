# Hibernate / JPA — Производительность и типичные ошибки

Завершающий файл модуля. Он не вводит новых концепций отображения, а собирает воедино
инструменты производительности (JDBC батчинг, `StatelessSession`, read-only-режим) и каталог
типичных ошибок, которые на практике превращают корректный по логике код в источник деградации.
Где тема уже раскрыта в другом файле модуля, здесь даётся ссылка, а не повторное объяснение.

---

## JDBC батчинг

По умолчанию Hibernate отправляет каждый `INSERT`/`UPDATE`/`DELETE` в БД отдельным обращением:
1000 новых сущностей → 1000 сетевых обращений. JDBC-драйвер умеет группировать однотипные
операторы в один пакет (`PreparedStatement.addBatch()` / `executeBatch()`), но Hibernate этим не
пользуется, пока не задан размер пакета.

```properties
hibernate.jdbc.batch_size=50          # включить группировку, пачками по 50
hibernate.order_inserts=true          # сгруппировать INSERT одной таблицы подряд
hibernate.order_updates=true          # то же для UPDATE
hibernate.batch_versioned_data=true   # разрешить batching для @Version-сущностей
```

**Почему нужны `order_inserts` / `order_updates`.** JDBC может склеить в один пакет только
**последовательные** операторы по одной таблице с одинаковой формой SQL. Если action queue идёт
вперемешку (`INSERT order`, `INSERT item`, `INSERT order`, …), каждый переход на другую таблицу
разрывает пакет. `order_inserts=true` сортирует операторы так, чтобы все вставки в одну таблицу
шли подряд — только тогда `batch_size` реально работает.

```java
for (int i = 0; i < orders.size(); i++) {
    em.persist(orders.get(i));
    if (i % 50 == 0) {        // размер пачки = batch_size
        em.flush();           // отправить пакет в БД
        em.clear();           // освободить persistence context — см. ниже
    }
}
```

### Почему `IDENTITY` ломает батчинг

Это ключевой момент, который спрашивают на интервью. `GenerationType.IDENTITY` отдаёт значение
ключа только **после** физического `INSERT`, а Hibernate обязан знать id в момент `persist()`
(id — ключ в Identity Map). Поэтому при `IDENTITY` каждый `INSERT` выполняется немедленно и
поодиночке — батчинг отключается полностью, сколько бы вы ни задали `batch_size`. Механика и
выбор `SEQUENCE` с пулом значений для массовых вставок разобраны в
[`IDENTIFIERS_INHERITANCE.md`](IDENTIFIERS_INHERITANCE.md) (секции «Почему `IDENTITY` ломает JDBC
батчинг» и «Оптимизаторы последовательностей»).

> Battle-story: команда задала `hibernate.jdbc.batch_size=100`, но массовая загрузка осталась
> медленной. Причина — `@GeneratedValue(strategy = IDENTITY)` поверх `SERIAL` в PostgreSQL:
> батчинг молча не применялся. Замена на `SEQUENCE` с `allocationSize=100` дала ожидаемое
> ускорение.

---

## `StatelessSession` для массовых операций

Когда нужно прогнать сотни тысяч строк (миграция, импорт, пересчёт), обычная `Session` мешает:
она копит managed-сущности, держит снапшоты для dirty checking и раздувает память. Решение —
`StatelessSession`: облегчённый API без persistence context.

```java
StatelessSession session = sessionFactory.openStatelessSession();
Transaction tx = session.beginTransaction();
try (var stream = session.createQuery("FROM LegacyRow", LegacyRow.class).getResultStream()) {
    stream.forEach(row -> {
        Target t = convert(row);
        session.insert(t);     // прямой INSERT, без persist/dirty checking
    });
}
tx.commit();
session.close();
```

Чего у `StatelessSession` **нет** (и в этом её смысл):

| Возможность обычной `Session` | В `StatelessSession` |
|---|---|
| Persistence context (L1 / Identity Map) | отсутствует |
| Dirty checking + снапшоты | нет — изменения сохраняются только явным `update()` |
| Каскадирование (`cascade`) | не работает — каждую сущность сохраняем вручную |
| Lazy-ассоциации / proxy | не инициализируются |
| L2-кэш | не читается и не пишется (нужен ручной evict при изменениях) |
| `flush()` / отложенная запись | нет — `insert`/`update`/`delete` исполняются сразу |

То есть `StatelessSession` — это, по сути, тонкая объектная обёртка над JDBC: предсказуемая
память и скорость ценой отказа от удобств ORM. JDBC батчинг с ней совместим (`batch_size`
действует). О том, какие именно удобства вы теряете (состояния, dirty checking, каскад), —
[`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md).

---

## Read-only-запросы

Огромная доля запросов в типичном приложении — чтение для показа. Держать под них полноценный
управляемый граф с dirty checking расточительно: на каждую загруженную сущность Hibernate хранит
снапшот (копию полей) и на flush сравнивает его с текущим состоянием.

Способы убрать этот оверхед:

```java
// 1. Read-only на уровне запроса (Hibernate)
List<Order> orders = session.createQuery("FROM Order", Order.class)
    .setReadOnly(true)        // не создавать снапшот, не отслеживать dirty
    .getResultList();

// 2. Read-only на уровне транзакции (Spring)
@Transactional(readOnly = true)
public List<OrderView> report() { ... }

// 3. DTO-проекция — не грузить сущности вовсе
List<OrderView> views = em.createQuery(
    "SELECT new com.app.OrderView(o.id, o.total) FROM Order o", OrderView.class)
    .getResultList();
```

- **`setReadOnly(true)`** говорит Hibernate не сохранять снапшот для загруженных сущностей: они
  попадают в контекст, но изменения полей **не** будут синхронизированы на flush. Экономит память
  и время flush.
- **`@Transactional(readOnly = true)`** в Spring выставляет `FlushMode.MANUAL` на сессию (flush не
  происходит перед запросами и на коммите) и подсказывает драйверу/пулу, что транзакция только
  читает. Это не «защита от записи на уровне БД», а оптимизация поведения сессии.
- **DTO-проекция** — самый радикальный вариант: managed-сущностей нет вовсе, значит нет ни
  снапшота, ни риска случайного N+1 в слое представления. Детали проекций — в
  [`QUERYING.md`](QUERYING.md), стоимость снапшота — в [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md).

---

## Open Session In View (OSIV) — антипаттерн

OSIV держит persistence context (сессию) открытым на **всю длину HTTP-запроса** — включая фазу
сериализации ответа в контроллере, за пределами транзакционного сервисного слоя. В Spring Boot
он **включён по умолчанию** (`spring.jpa.open-in-view=true`), и приложение при старте даже не
пишет об этом предупреждение, если флаг не выставлен явно.

Зачем это сделано: чтобы lazy-ассоциация, к которой обратились уже в Jackson-сериализаторе или в
шаблоне, не падала с `LazyInitializationException` — сессия ещё открыта, proxy догрузится. Цена
этого «удобства»:

1. **Соединение из пула удерживается дольше нужного.** Сессия привязана к JDBC-соединению, а оно
   живёт до конца запроса — включая медленную сериализацию и отправку ответа клиенту. Под нагрузкой
   пул HikariCP исчерпывается, хотя реальная работа с БД давно закончилась.
2. **Маскирует N+1.** Lazy-ассоциации тихо инициализируются по одной прямо во время сериализации
   JSON: разработчик не видит SQL в сервисном слое и не замечает проблему до прода. Механика N+1 —
   в [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md).
3. **Размывает границы транзакций.** SQL выполняется вне `@Transactional`-метода, в авто-коммит-режиме
   на «доборных» запросах; контроль над тем, что и когда уходит в БД, теряется.

**Правильный путь:** выключить OSIV и грузить нужные ассоциации внутри транзакции через
`JOIN FETCH` / `@EntityGraph`, а наружу отдавать DTO.

```properties
spring.jpa.open-in-view=false
```

Подробный разбор флага со стороны Spring Boot и того, как OSIV взаимодействует со Spring Data
репозиториями, — в [`../../spring-frameworks/theory/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md).

---

## Каталог типичных ловушек

| Ловушка | В чём проблема | Что делать |
|---|---|---|
| `EAGER` по умолчанию у `@ManyToOne`/`@OneToOne` | неотключаемая загрузка, скрытый каскад джойнов, N+1 на HQL | явный `fetch = LAZY` — см. [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md) |
| Огромная `@OneToMany` без пагинации | вся коллекция грузится в память; flush «грязно проверяет» каждый элемент | не маппить безграничные коллекции; читать дочерние запросом со страницей |
| `@Transactional` без `readOnly` на чтении | лишние снапшоты и flush перед запросами | `@Transactional(readOnly = true)` / `setReadOnly` |
| Autoboxing id (`long` vs `Long`) в `getId()`/ключах | NPE на null-id; неверный `equals`, ломающий Identity Map | использовать обёртку `Long`, бизнес-ключ в `equals` |
| `entityManager.flush()` в цикле | пакет дробится, теряется смысл `batch_size`; повторные dirty-проверки | flush один раз на пачку (`i % batch_size`) |
| `merge` в цикле вместо батчинга | каждый `merge` — лишний `SELECT` + поэлементная запись | `persist` новых + JDBC батчинг; `StatelessSession` для массовых операций |
| Забытый `clear()` при батчинге | persistence context растёт без границ → утечка памяти L1 и медленный flush | `flush()` + `clear()` каждые `batch_size` строк |
| Большой контекст в одной транзакции | снапшоты десятков тысяч сущностей раздувают heap | `StatelessSession` или пачки flush/clear — см. [`CACHING.md`](CACHING.md), [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md) |

### `flush()` / `merge` в цикле и забытый `clear()`

Три ошибки в коде массовой обработки почти всегда идут вместе:

```java
// АНТИПАТТЕРН
for (Row r : millionRows) {
    Entity e = em.merge(toEntity(r)); // 1) merge → лишний SELECT на каждую строку
    em.flush();                       // 2) flush в цикле → пакет из одной операции
    // 3) нет clear() → контекст копит миллион managed-сущностей и снапшотов
}
```

Каждая из трёх проблем по отдельности убивает производительность: `merge` добавляет `SELECT`,
`flush` в цикле сводит `batch_size` к единице, а отсутствие `clear()` превращает L1 в утечку
памяти (рост persistence context до `OutOfMemoryError`). Корректный вариант — `persist` для новых
сущностей и flush/clear пачками, как в разделе про батчинг выше. Память L1 и периодический
`clear()` подробнее — в [`CACHING.md`](CACHING.md) и [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md).

---

## Пул соединений — кратко

Под Hibernate всегда стоит пул соединений (в Spring Boot — HikariCP). Главное правило с точки
зрения производительности ORM: **не удерживать соединение дольше работы с БД**. Именно это нарушает
OSIV (см. выше) и долгие транзакции, внутри которых идёт вызов внешнего сервиса или сериализация.
Размер пула не должен быть «побольше на всякий случай»: при превышении числа ядер БД лишние
соединения только усиливают конкуренцию. Детальная теория пулов и сайзинга — вне модуля
hibernate-jpa.

---

## Чеклист производительности

Перед выкатом сервиса на JPA пройтись по списку:

- [ ] `@ManyToOne` / `@OneToOne` помечены `fetch = LAZY` явно.
- [ ] Идентификаторы — `SEQUENCE` с `allocationSize` (не `IDENTITY`), если есть массовые вставки.
- [ ] Заданы `hibernate.jdbc.batch_size`, `order_inserts`, `order_updates` для массовой нагрузки.
- [ ] В циклах массовой обработки есть `flush()` + `clear()` каждые `batch_size` строк.
- [ ] Массовые миграции/импорт идут через `StatelessSession`, а не обычную `Session`.
- [ ] Чтение помечено `@Transactional(readOnly = true)` или `setReadOnly(true)`.
- [ ] Отчёты и списки отдаются DTO-проекцией, а не managed-сущностями.
- [ ] `spring.jpa.open-in-view=false`; нужные ассоциации грузятся `JOIN FETCH`/`@EntityGraph`.
- [ ] Нет безграничных `@OneToMany`, читаемых целиком.
- [ ] N+1 ловится тестом на число SQL (`hibernate.generate_statistics` / datasource-proxy) — см.
      [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md).
- [ ] L2/Query Cache включён только на редко меняющихся таблицах — см. [`CACHING.md`](CACHING.md).

---

## Где почитать дальше

- [`JPA_VS_HIBERNATE.md`](JPA_VS_HIBERNATE.md) — что из обсуждаемого здесь стандартизировано JPA, а
  что — расширения Hibernate (`StatelessSession`, `setReadOnly`).
- [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md) — persistence context, dirty checking, снапшоты,
  стоимость большого контекста и `clear()`.
- [`MAPPINGS_ASSOCIATIONS.md`](MAPPINGS_ASSOCIATIONS.md) — каскадирование (которого нет в
  `StatelessSession`), `equals`/`hashCode`, безграничные коллекции.
- [`IDENTIFIERS_INHERITANCE.md`](IDENTIFIERS_INHERITANCE.md) — почему `IDENTITY` ломает батчинг,
  `SEQUENCE` с пулом значений.
- [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md) — N+1, fetch-стратегии, обнаружение лишних SQL,
  `LazyInitializationException` и почему OSIV его «лечит».
- [`CACHING.md`](CACHING.md) — L1-память при батчинге, L2/Query Cache и когда кэш оправдан.
- [`TRANSACTIONS_LOCKING.md`](TRANSACTIONS_LOCKING.md) — границы транзакций, `readOnly`,
  `@Version` и `batch_versioned_data`.
- [`QUERYING.md`](QUERYING.md) — DTO-проекции, пагинация и её ловушки.
- [`../../spring-frameworks/theory/SPRING_DATA_JPA.md`](../../spring-frameworks/theory/SPRING_DATA_JPA.md)
  — OSIV со стороны Spring Boot, `@Transactional`, Spring Data репозитории.

## Источники

- Vlad Mihalcea — *High-Performance Java Persistence* (главы про JDBC батчинг, `order_inserts`,
  `StatelessSession`, read-only-запросы, OSIV).
- *Hibernate ORM User Guide* — разделы «Batching», «StatelessSession», «Performance», «Bytecode
  Enhancement».
- Vlad Mihalcea — статьи в блоге: «The best way to do batch processing with JPA and Hibernate»,
  «The open-session-in-view anti-pattern», «How to use a read-only transaction».
- Thorben Janssen — «Hibernate Performance Tuning», «5 things you can do to improve the performance
  of your Hibernate application».
