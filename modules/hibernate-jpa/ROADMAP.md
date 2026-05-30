# Hibernate / JPA — Roadmap

Порядок прохождения: **Основы → Жизненный цикл → Маппинг → Идентификаторы/наследование →
Fetch и N+1 → Кэширование → Транзакции и блокировки → Запросы → Производительность**.

Web-sync берёт порядок теории на сайте из первого упоминания `theory/<NAME>.md` в этом файле.

---

## Модуль 1 — Основы

📖 [theory/JPA_VS_HIBERNATE.md](theory/JPA_VS_HIBERNATE.md) — спецификация JPA vs провайдер
Hibernate; `EntityManagerFactory` / `SessionFactory`; bootstrap; dialect; DDL-auto;
архитектура слоёв.

- [ ] Чем JPA отличается от Hibernate (спецификация vs реализация)
- [ ] `EntityManagerFactory` vs `SessionFactory`, `EntityManager` vs `Session`
- [ ] Bootstrap: `persistence.xml` vs программная конфигурация
- [ ] Зачем нужен dialect; режимы DDL-auto

---

## Модуль 2 — Жизненный цикл сущности

📖 [theory/ENTITY_LIFECYCLE.md](theory/ENTITY_LIFECYCLE.md) — persistence context; состояния
transient/managed/detached/removed; dirty checking; flush modes; API `EntityManager`/`Session`.

- [ ] Четыре состояния сущности и переходы между ними
- [ ] Persistence context как Identity Map + Unit of Work
- [ ] Dirty checking и snapshot-механизм
- [ ] Flush modes (AUTO/COMMIT/MANUAL), когда происходит flush

---

## Модуль 3 — Маппинг и ассоциации

📖 [theory/MAPPINGS_ASSOCIATIONS.md](theory/MAPPINGS_ASSOCIATIONS.md) — `@Entity`/`@Embeddable`;
ассоциации; owning vs inverse side; `mappedBy`; cascade; `orphanRemoval`; equals/hashCode.

- [ ] `@OneToMany` / `@ManyToOne` / `@ManyToMany` / `@OneToOne`
- [ ] Owning side vs inverse side, роль `mappedBy`
- [ ] Cascade types и `orphanRemoval`
- [ ] equals/hashCode для сущностей (бизнес-ключ vs id)

---

## Модуль 4 — Идентификаторы и наследование

📖 [theory/IDENTIFIERS_INHERITANCE.md](theory/IDENTIFIERS_INHERITANCE.md) — генерация id
(IDENTITY/SEQUENCE/TABLE/UUID, pooled-lo); inheritance (SINGLE_TABLE/JOINED/TABLE_PER_CLASS);
`@MappedSuperclass`.

- [ ] Стратегии генерации id и их влияние на batching
- [ ] Три стратегии наследования и их компромиссы
- [ ] `@MappedSuperclass` vs `@Embeddable` vs наследование сущностей

---

## Модуль 5 — Fetch-стратегии и N+1

📖 [theory/FETCHING_NPLUS1.md](theory/FETCHING_NPLUS1.md) — LAZY/EAGER; proxy + bytecode
enhancement; `JOIN FETCH`; `@EntityGraph`; `@BatchSize`; subselect; N+1; `LazyInitializationException`.

- [ ] LAZY vs EAGER, как работает proxy
- [ ] `JOIN FETCH`, `@EntityGraph`, `@BatchSize`, `@Fetch(SUBSELECT)`
- [ ] Откуда берётся N+1 и как его обнаружить
- [ ] `LazyInitializationException`: причина и корректные решения

---

## Модуль 6 — Кэширование

📖 [theory/CACHING.md](theory/CACHING.md) — L1 (persistence context); L2 (region factory,
провайдеры); Query cache; concurrency strategies (READ_ONLY/NONSTRICT/READ_WRITE/TRANSACTIONAL);
`@Cache`.

- [ ] L1 cache: область видимости и инвалидация
- [ ] L2 cache: region factory, провайдеры, когда включать
- [ ] Query cache и его подводные камни
- [ ] Cache concurrency strategies и выбор между ними

---

## Модуль 7 — Транзакции и блокировки

📖 [theory/TRANSACTIONS_LOCKING.md](theory/TRANSACTIONS_LOCKING.md) — JPA `EntityTransaction`;
flush на коммите; оптимистичная блокировка `@Version`; пессимистичная `LockModeType`.

- [ ] JPA-модель транзакций vs `@Transactional` Spring
- [ ] Оптимистичная блокировка через `@Version`
- [ ] Пессимистичная блокировка и `LockModeType`
- [ ] Связь с уровнями изоляции БД

---

## Модуль 8 — Запросы

📖 [theory/QUERYING.md](theory/QUERYING.md) — JPQL/HQL; Criteria API; native queries;
DTO-проекции; пагинация; `@NamedQuery`.

- [ ] JPQL/HQL vs native SQL
- [ ] Criteria API: когда оно оправдано
- [ ] DTO-проекции vs загрузка сущностей
- [ ] Пагинация и её ловушки

---

## Модуль 9 — Производительность и типичные ошибки

📖 [theory/PERFORMANCE_PITFALLS.md](theory/PERFORMANCE_PITFALLS.md) — batching
(`jdbc.batch_size`); `StatelessSession`; OSIV anti-pattern; read-only запросы; частые ошибки.

- [ ] JDBC batching: настройка и предусловия
- [ ] `StatelessSession` для массовых операций
- [ ] Open Session In View: почему это anti-pattern
- [ ] Read-only запросы и оптимизация памяти
