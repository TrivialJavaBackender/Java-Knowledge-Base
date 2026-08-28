# Hibernate / JPA — JPA vs Hibernate: спецификация и провайдер

Вводный файл модуля. Здесь разбираемся, чем спецификация JPA (Jakarta Persistence) отличается от провайдера Hibernate ORM, как устроены фабрики и контексты (`EntityManagerFactory`/`SessionFactory`, `EntityManager`/`Session`), как происходит инициализация (bootstrap), что такое dialect и какие бывают режимы DDL-auto.

## 1. Спецификация против реализации

JPA (Jakarta Persistence, до Jakarta EE 9 — Java Persistence API, пакет `javax.persistence`, сейчас `jakarta.persistence`) — это **стандарт**: набор интерфейсов, аннотаций (`@Entity`, `@OneToMany`, `@Id`) и язык запросов JPQL. Сама спецификация не выполняет ни одного SQL-запроса — она лишь описывает контракт.

Hibernate ORM — самая популярная **реализация** (провайдер) этого стандарта. Именно Hibernate генерирует SQL, отслеживает изменения объектов (dirty checking), управляет загрузкой связей и кэшами. Помимо Hibernate, существуют EclipseLink (эталонная реализация) и OpenJPA, но в Java/Kotlin-экосистеме доминирует Hibernate.

| Аспект | JPA (спецификация) | Hibernate (провайдер) |
|---|---|---|
| Что это | Контракт: интерфейсы + аннотации + JPQL | Движок: генерация SQL, кэши, dirty checking |
| Пакет | `jakarta.persistence.*` | `org.hibernate.*` |
| Точка входа | `EntityManagerFactory` → `EntityManager` | `SessionFactory` → `Session` |
| Язык запросов | JPQL, Criteria API | HQL (надмножество JPQL), Criteria, нативный SQL |
| Конфигурация | `persistence.xml` | `hibernate.cfg.xml` / программно / properties |

**Практическое следствие.** Если писать код только против интерфейсов JPA (`EntityManager`, JPQL), приложение теоретически переносимо между провайдерами. На практике переносимость почти всегда теряется: используются специфичные для Hibernate возможности (`@BatchSize`, `@Formula`, `@Filter`, типы соединений), а поведение dialect и DDL-auto отличается между провайдерами. Для senior-интервью важна формулировка: «JPA — это контракт, Hibernate — реализация, которая этот контракт расширяет своими возможностями».

## 2. Фабрики и контексты

JPA-интерфейсы и их «родные» аналоги в Hibernate соотносятся напрямую — более того, в Hibernate `SessionFactory` реализует `EntityManagerFactory`, а `Session` реализует `EntityManager`. Это позволяет при необходимости «спуститься» с уровня JPA на уровень Hibernate через `unwrap`.

| JPA | Hibernate | Назначение |
|---|---|---|
| `EntityManagerFactory` | `SessionFactory` | Тяжёлый, потокобезопасный, один на приложение (на единицу хранения). Создаётся один раз при старте. |
| `EntityManager` | `Session` | Лёгкий, **непотокобезопасный**, короткоживущий (на одну транзакцию/запрос). Хранит контекст хранения (persistence context, кэш первого уровня). |
| `EntityTransaction` | `Transaction` | Управление границами транзакции (вне контейнера). |

```java
// JPA-уровень
EntityManagerFactory emf = Persistence.createEntityManagerFactory("my-unit");
EntityManager em = emf.createEntityManager();

// Спуск на уровень Hibernate, когда нужны его возможности
SessionFactory sf = emf.unwrap(SessionFactory.class);
Session session = em.unwrap(Session.class);
```

**Ключевые инварианты.**
- `EntityManagerFactory`/`SessionFactory` — дорогая в создании, потокобезопасная, **синглтон на единицу хранения**. Создавать её на каждый запрос — грубая ошибка.
- `EntityManager`/`Session` — дешёвая, **не потокобезопасная**, привязана к одному потоку/транзакции. Делить один `EntityManager` между потоками нельзя.

Контекст хранения (persistence context) и состояния сущностей (transient / managed / detached / removed) подробно разбираются в [ENTITY_LIFECYCLE.md](ENTITY_LIFECYCLE.md).

## 3. Единица хранения (persistence unit)

Единица хранения (persistence unit) — это именованная конфигурация: набор управляемых классов, источник данных, провайдер и его свойства. Из неё строится `EntityManagerFactory`. Определяется либо декларативно в `persistence.xml`, либо программно.

### persistence.xml (классический путь Jakarta EE / Java SE)

Файл лежит в `META-INF/persistence.xml`:

```xml
<persistence xmlns="https://jakarta.ee/xml/ns/persistence" version="3.0">
    <persistence-unit name="my-unit" transaction-type="RESOURCE_LOCAL">
        <provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
        <class>com.example.User</class>
        <properties>
            <property name="jakarta.persistence.jdbc.url" value="jdbc:postgresql://localhost/app"/>
            <property name="hibernate.dialect" value="org.hibernate.dialect.PostgreSQLDialect"/>
            <property name="hibernate.hbm2ddl.auto" value="validate"/>
        </properties>
    </persistence-unit>
</persistence>
```

`transaction-type` бывает `RESOURCE_LOCAL` (приложение само управляет транзакциями через `EntityTransaction`) и `JTA` (транзакциями управляет контейнер/менеджер JTA).

### Программная инициализация (Hibernate-нативная)

Без `persistence.xml`, через API начальной загрузки Hibernate:

```java
StandardServiceRegistry registry = new StandardServiceRegistryBuilder()
        .applySetting("hibernate.connection.url", "jdbc:postgresql://localhost/app")
        .applySetting("hibernate.dialect", "org.hibernate.dialect.PostgreSQLDialect")
        .build();

SessionFactory sf = new MetadataSources(registry)
        .addAnnotatedClass(User.class)
        .buildMetadata()
        .buildSessionFactory();
```

### Spring Boot auto-configuration

В Spring Boot ни `persistence.xml`, ни ручная сборка `SessionFactory` обычно не нужны: стартер `spring-boot-starter-data-jpa` через auto-configuration сам создаёт `EntityManagerFactory` (`LocalContainerEntityManagerFactoryBean`), сканирует пакеты на `@Entity`, читает настройки из `application.yml` (`spring.datasource.*`, `spring.jpa.*`) и подключает менеджер транзакций. Управление транзакциями через `@Transactional`, репозитории Spring Data и тонкости интеграции описаны в [SPRING_DATA_JPA.md](../../spring-frameworks/theory/SPRING_DATA_JPA.md) — здесь не дублируем.

## 4. Dialect

Dialect — это Hibernate-абстракция над диалектом SQL конкретной СУБД. Он определяет, как генерировать пагинацию (`LIMIT/OFFSET` против `FETCH FIRST` против `ROWNUM`), какие типы столбцов сопоставлять Java-типам, какие функции и стратегии генерации идентификаторов поддерживаются, как звучит синтаксис блокировок (`FOR UPDATE`).

```properties
hibernate.dialect = org.hibernate.dialect.PostgreSQLDialect
```

Начиная с Hibernate 6, dialect в большинстве случаев **определяется автоматически** по метаданным JDBC-соединения, поэтому явно указывать его обычно не требуется. Версионные диалекты вроде `PostgreSQL10Dialect` объявлены устаревшими — современный `PostgreSQLDialect` сам учитывает версию сервера. Указывать dialect вручную стоит, когда автоопределение недоступно (нет живого соединения на старте) или нужно зафиксировать конкретное поведение.

## 5. DDL-auto (hbm2ddl)

Свойство `hibernate.hbm2ddl.auto` (в Spring Boot — `spring.jpa.hibernate.ddl-auto`) управляет тем, что Hibernate делает со схемой БД при старте, сверяя её с маппингом сущностей.

| Значение | Поведение |
|---|---|
| `none` | Ничего не делает со схемой. |
| `validate` | Проверяет, что схема соответствует сущностям; при расхождении — ошибка на старте. Схему не меняет. |
| `update` | Достраивает недостающие таблицы/столбцы. **Не** удаляет лишнее, **не** меняет типы. |
| `create` | Удаляет схему и создаёт заново при старте. |
| `create-drop` | Как `create`, плюс удаляет схему при остановке. |

**Рекомендации для интервью.** В продакшене используют `none` или `validate`, а саму схему ведут миграциями (Flyway/Liquibase). `update` опасен: он накапливает дрейф схемы, не выполняет деструктивные изменения и легко даёт расхождение между средами. `create`/`create-drop` пригодны только для тестов и быстрых прототипов. Типичный ответ на вопрос «какой ddl-auto в проде» — «`validate` плюс версионируемые миграции, никогда `update`».

## 6. Архитектура слоёв

Сверху вниз — от прикладного кода до базы данных:

```
Прикладной код (@Entity, @Transactional, JPQL)
        │
        ▼
JPA API (jakarta.persistence) — контракт: EntityManager, аннотации, JPQL
        │
        ▼
Hibernate ORM — реализация: генерация SQL, persistence context,
                dirty checking, кэши L1/L2, dialect, lazy loading
        │
        ▼
JDBC (java.sql) — PreparedStatement, ResultSet, пул соединений (HikariCP)
        │
        ▼
СУБД (PostgreSQL / MySQL / Oracle / H2)
```

Каждый слой опирается только на нижележащий. Прикладной код в идеале знает лишь о JPA-контракте; Hibernate транслирует вызовы в JDBC; пул соединений (обычно HikariCP) переиспользует физические соединения с СУБД. Понимание этого слоения помогает локализовать проблему: N+1 и lazy loading — это уровень Hibernate, а долгие запросы и блокировки — уже уровень СУБД.

## 7. Где почитать дальше

- [ENTITY_LIFECYCLE.md](ENTITY_LIFECYCLE.md) — контекст хранения, состояния сущности, dirty checking, flush, каскады.
- [MAPPINGS_ASSOCIATIONS.md](MAPPINGS_ASSOCIATIONS.md) — `@OneToMany`/`@ManyToOne`/`@ManyToMany`, владелец связи, embeddable.
- [IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md) — генерация идентификаторов, стратегии наследования.
- [FETCHING_NPLUS1.md](FETCHING_NPLUS1.md) — lazy/eager, проблема N+1, fetch join, `@EntityGraph`.
- [CACHING.md](CACHING.md) — кэш первого и второго уровня, кэш запросов.
- [TRANSACTIONS_LOCKING.md](TRANSACTIONS_LOCKING.md) — границы транзакций, оптимистичная/пессимистичная блокировка.
- [QUERYING.md](QUERYING.md) — JPQL/HQL, Criteria API, нативный SQL, проекции.
- [PERFORMANCE_PITFALLS.md](PERFORMANCE_PITFALLS.md) — типичные ошибки производительности.

Смежные модули:
- [SPRING_DATA_JPA.md](../../spring-frameworks/theory/SPRING_DATA_JPA.md) — `@Transactional`, репозитории Spring Data, Spring Boot интеграция.
- [DATABASE_TYPES.md](../../databases/theory/DATABASE_TYPES.md) — ORM-паттерны (Identity Map, Unit of Work), каноническая теория проблемы N+1.

## Источники

- Hibernate ORM User Guide — разделы Bootstrap, Schema generation, Dialect.
- Jakarta Persistence Specification 3.x — разделы Persistence Unit, Entity Manager.
- Vlad Mihalcea, «High-Performance Java Persistence» — главы о connection management и архитектуре Hibernate.
