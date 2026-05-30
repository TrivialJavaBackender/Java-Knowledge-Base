# hibernate-jpa — Summary

## Core Model
JPA — спецификация (Jakarta Persistence), Hibernate — провайдер-реализация с расширениями.
Центр всего — **persistence context** (`EntityManager`/`Session`): identity map + unit of work
+ L1-кэш. Сущности проходят жизненный цикл transient → managed → detached/removed; изменения
managed-сущностей попадают в БД через dirty checking на flush.

## Key Concepts
- **Lifecycle:** persist/merge/remove/detach/refresh; dirty checking через snapshot; flush modes
  (AUTO/COMMIT/MANUAL); flush internals (write-behind, action queue, фиксированный порядок flush,
  auto-flush перед JPQL).
- **Маппинг:** owning vs inverse side (`mappedBy` владеет FK), cascade, `orphanRemoval`.
- **Продвинутый маппинг:** `@Enumerated(STRING)` vs ORDINAL, `@Convert`/`@AttributeConverter`,
  `@Formula`/`@Where`/`@Filter`, `@SecondaryTable`, `@CreationTimestamp`/`insertable`/`updatable`.
- **Коллекции:** bag vs list vs set; `MultipleBagFetchException`; `@OrderBy` vs `@OrderColumn`;
  `@ElementCollection`; extra lazy; `PersistentBag`/`Set`/`List`.
- **Идентичность:** equals/hashCode по бизнес-ключу; proxy-safe (`instanceof`, не `getClass()`);
  generated-id ломает `HashSet`; Lombok `@Data` опасен.
- **Идентификаторы:** IDENTITY ломает batching, SEQUENCE (pooled/pooled-lo) — нет; `@NaturalId` +
  natural id cache; наследование SINGLE_TABLE/JOINED/TABLE_PER_CLASS.
- **Составные ключи:** `@EmbeddedId` vs `@IdClass`; `@MapsId`/derived id/shared PK; equals/hashCode
  класса ключа обязательны.
- **Fetch и N+1:** всё LAZY, грузить явно `JOIN FETCH`/`@EntityGraph`/`@BatchSize`/SUBSELECT;
  `LazyInitializationException` вне контекста.
- **Кэш:** L1 (неотключаем), L2 (shared, провайдеры, concurrency strategies), Query Cache.
- **Транзакции:** `@Version` (оптимистичная), `LockModeType` (пессимистичная, FOR UPDATE).
- **Запросы:** JPQL/HQL, bulk update/delete (обходит persistence context), подзапросы/функции,
  неявные vs явные джойны, Criteria + metamodel, native, DTO-проекции, keyset-пагинация.

## Important Invariants
- L1 гарантирует один объект на id в сессии — это корректность, не оптимизация.
- FK пишется только по owning side ассоциации.
- `@ManyToOne`/`@OneToOne` по умолчанию EAGER — главный источник N+1.
- Query Cache требует L2 и инвалидируется при любом DML по таблице.
- `OptimisticLockException` возникает на flush/коммите (0 обновлённых строк), не при изменении.

## Common Pitfalls
EAGER по умолчанию; `JOIN FETCH` коллекции + `Pageable` (пагинация в памяти); `merge` новой
сущности; забытый `clear()` при batch (рост L1); OFFSET-пагинация; Open-Session-In-View
(включён в Spring Boot — выключать); `@Transactional` на чтении без `readOnly`;
`@Enumerated(ORDINAL)` + вставка константы в середину enum; `equals` по `getClass()` ломается на
прокси; bulk update оставляет L1 устаревшим; `List`-bag → delete-all-and-reinsert;
`IDENTITY` отключает JDBC batching.

## Related Modules
- [databases](../databases/) — ACID, изоляция, MVCC, каноническая N+1, ORM-паттерны.
- [spring-frameworks](../spring-frameworks/) — `@Transactional`, Spring Data, Spring Cache.
- [caching-deep-dive](../caching-deep-dive/) — паттерны и eviction-политики кэша.
