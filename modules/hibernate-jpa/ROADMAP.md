# Hibernate / JPA — Roadmap

Порядок прохождения: **Основы → Жизненный цикл → Маппинг → Продвинутый маппинг → Коллекции →
Идентичность → Идентификаторы/наследование → Составные ключи → Fetch и N+1 → Кэширование →
Транзакции и блокировки → Запросы → Производительность**.

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
transient/managed/detached/removed; dirty checking; flush modes; внутренняя механика flush
(write-behind, action queue, flush ordering, query flush).

- [ ] Четыре состояния сущности и переходы между ними
- [ ] Persistence context как Identity Map + Unit of Work
- [ ] Dirty checking и snapshot-механизм
- [ ] Flush modes и внутренняя механика flush (почему SQL выполняется не там, где ожидаешь)

---

## Модуль 3 — Маппинг и ассоциации

📖 [theory/MAPPINGS_ASSOCIATIONS.md](theory/MAPPINGS_ASSOCIATIONS.md) — `@Entity`/`@Embeddable`;
ассоциации; owning vs inverse side; `mappedBy`; cascade; `orphanRemoval`.

- [ ] `@OneToMany` / `@ManyToOne` / `@ManyToMany` / `@OneToOne`
- [ ] Owning side vs inverse side, роль `mappedBy`
- [ ] Cascade types и `orphanRemoval`

---

## Модуль 4 — Продвинутый маппинг и генерируемые БД значения

📖 [theory/ADVANCED_MAPPINGS.md](theory/ADVANCED_MAPPINGS.md) — `@Column`/`@Table`/`@JoinColumn`
детально; `@Enumerated`/`@Temporal`/`@Lob`/`@Access`; `@Convert`/`@AttributeConverter`;
`@SecondaryTable`; Hibernate `@Formula`/`@Where`/`@Filter`; `@CreationTimestamp`/`@UpdateTimestamp`;
`insertable`/`updatable`.

- [ ] `@Enumerated(ORDINAL)` ловушка vs `STRING`; `@AttributeConverter`
- [ ] `@Formula` / `@Where` / `@Filter` (Hibernate-специфика)
- [ ] Значения, генерируемые БД, и флаги `insertable`/`updatable`

---

## Модуль 5 — Семантика коллекций

📖 [theory/COLLECTIONS.md](theory/COLLECTIONS.md) — bag vs list vs set; `MultipleBagFetchException`;
ordered vs sorted; `PersistentBag`/`Set`/`List`; `@OrderBy` vs `@OrderColumn`; `@ElementCollection`;
extra lazy.

- [ ] bag vs list vs set и чем опасен bag
- [ ] `MultipleBagFetchException` и три решения
- [ ] `@OrderBy` vs `@OrderColumn`, ordered vs sorted

---

## Модуль 6 — Идентичность сущностей и equals/hashCode

📖 [theory/ENTITY_IDENTITY_EQUALS.md](theory/ENTITY_IDENTITY_EQUALS.md) — три вида идентичности;
generated-id problem; proxy-safe `equals`; бизнес-ключ; почему мутабельные поля рвут hash-коллекции;
опасность Lombok `@Data`.

- [ ] Почему `equals` по сгенерированному `id` ломает `HashSet`
- [ ] Proxy-safe `equals` (`instanceof` vs `getClass()`)
- [ ] Бизнес-ключ / назначаемый UUID как правильная основа

---

## Модуль 7 — Идентификаторы и наследование

📖 [theory/IDENTIFIERS_INHERITANCE.md](theory/IDENTIFIERS_INHERITANCE.md) — генерация id
(IDENTITY/SEQUENCE/TABLE/UUID, pooled-lo); `@NaturalId` и natural id cache; inheritance
(SINGLE_TABLE/JOINED/TABLE_PER_CLASS); `@MappedSuperclass`.

- [ ] Стратегии генерации id и их влияние на batching
- [ ] `@NaturalId`, natural id cache, `byNaturalId` lookup
- [ ] Три стратегии наследования и их компромиссы

---

## Модуль 8 — Составные ключи

📖 [theory/COMPOSITE_KEYS.md](theory/COMPOSITE_KEYS.md) — `@EmbeddedId` vs `@IdClass`;
`@MapsId` и derived identifiers; составные FK; equals/hashCode для класса ключа; surrogate vs
natural keys.

- [ ] `@EmbeddedId` vs `@IdClass`, когда что
- [ ] `@MapsId` / shared primary key
- [ ] Почему класс составного ключа обязан переопределять equals/hashCode

---

## Модуль 9 — Fetch-стратегии и N+1

📖 [theory/FETCHING_NPLUS1.md](theory/FETCHING_NPLUS1.md) — LAZY/EAGER; proxy + bytecode
enhancement; `JOIN FETCH`; `@EntityGraph`; `@BatchSize`; subselect; N+1; `LazyInitializationException`.

- [ ] LAZY vs EAGER, как работает proxy
- [ ] `JOIN FETCH`, `@EntityGraph`, `@BatchSize`, `@Fetch(SUBSELECT)`
- [ ] Откуда берётся N+1 и как его обнаружить
- [ ] `LazyInitializationException`: причина и корректные решения

---

## Модуль 10 — Кэширование

📖 [theory/CACHING.md](theory/CACHING.md) — L1 (persistence context); L2 (region factory,
провайдеры); Query cache; concurrency strategies (READ_ONLY/NONSTRICT/READ_WRITE/TRANSACTIONAL);
`@Cache`.

- [ ] L1 cache: область видимости и инвалидация
- [ ] L2 cache: region factory, провайдеры, когда включать
- [ ] Query cache и его подводные камни
- [ ] Cache concurrency strategies и выбор между ними

---

## Модуль 11 — Транзакции и блокировки

📖 [theory/TRANSACTIONS_LOCKING.md](theory/TRANSACTIONS_LOCKING.md) — JPA `EntityTransaction`;
flush на коммите; оптимистичная блокировка `@Version`; пессимистичная `LockModeType`.

- [ ] JPA-модель транзакций vs `@Transactional` Spring
- [ ] Оптимистичная блокировка через `@Version`
- [ ] Пессимистичная блокировка и `LockModeType`
- [ ] Связь с уровнями изоляции БД

---

## Модуль 12 — Запросы

📖 [theory/QUERYING.md](theory/QUERYING.md) — JPQL/HQL; bulk update/delete; подзапросы; функции;
неявные/явные джойны; Criteria API; native queries; DTO-проекции; пагинация; `@NamedQuery`.

- [ ] JPQL/HQL vs native SQL; bulk update/delete и рассинхрон persistence context
- [ ] Подзапросы, коррелированные подзапросы, `FUNCTION()`
- [ ] Criteria API: когда оно оправдано
- [ ] DTO-проекции vs загрузка сущностей; пагинация и её ловушки

---

## Модуль 13 — Производительность и типичные ошибки

📖 [theory/PERFORMANCE_PITFALLS.md](theory/PERFORMANCE_PITFALLS.md) — batching
(`jdbc.batch_size`, order_inserts/updates, flush/clear, batch_versioned_data); `StatelessSession`;
OSIV anti-pattern; read-only запросы; частые ошибки.

- [ ] JDBC batching: настройка, предусловия, контроль памяти (flush/clear)
- [ ] `StatelessSession` для массовых операций
- [ ] Open Session In View: почему это anti-pattern
- [ ] Read-only запросы и оптимизация памяти
