# hibernate-jpa — Summary

## Core Model
JPA — спецификация (Jakarta Persistence), Hibernate — провайдер-реализация с расширениями.
Центр всего — **persistence context** (`EntityManager`/`Session`): identity map + unit of work
+ L1-кэш. Сущности проходят жизненный цикл transient → managed → detached/removed; изменения
managed-сущностей попадают в БД через dirty checking на flush.

## Key Concepts
- **Lifecycle:** persist/merge/remove/detach/refresh; dirty checking через snapshot; flush modes
  (AUTO/COMMIT/MANUAL); flush на коммите и перед JPQL.
- **Маппинг:** owning vs inverse side (`mappedBy` владеет FK), cascade, `orphanRemoval`;
  equals/hashCode по бизнес-ключу, не по id.
- **Идентификаторы:** IDENTITY ломает batching, SEQUENCE (pooled/pooled-lo) — нет; наследование
  SINGLE_TABLE/JOINED/TABLE_PER_CLASS.
- **Fetch и N+1:** всё LAZY, грузить явно `JOIN FETCH`/`@EntityGraph`/`@BatchSize`/SUBSELECT;
  `LazyInitializationException` вне контекста.
- **Кэш:** L1 (неотключаем), L2 (shared, провайдеры, concurrency strategies), Query Cache.
- **Транзакции:** `@Version` (оптимистичная), `LockModeType` (пессимистичная, FOR UPDATE).
- **Запросы:** JPQL/HQL, Criteria + metamodel, native, DTO-проекции, keyset-пагинация.

## Important Invariants
- L1 гарантирует один объект на id в сессии — это корректность, не оптимизация.
- FK пишется только по owning side ассоциации.
- `@ManyToOne`/`@OneToOne` по умолчанию EAGER — главный источник N+1.
- Query Cache требует L2 и инвалидируется при любом DML по таблице.
- `OptimisticLockException` возникает на flush/коммите (0 обновлённых строк), не при изменении.

## Common Pitfalls
EAGER по умолчанию; `JOIN FETCH` коллекции + `Pageable` (пагинация в памяти); `merge` новой
сущности; забытый `clear()` при batch (рост L1); OFFSET-пагинация; Open-Session-In-View
(включён в Spring Boot — выключать); `@Transactional` на чтении без `readOnly`.

## Related Modules
- [databases](../databases/) — ACID, изоляция, MVCC, каноническая N+1, ORM-паттерны.
- [spring-frameworks](../spring-frameworks/) — `@Transactional`, Spring Data, Spring Cache.
- [caching-deep-dive](../caching-deep-dive/) — паттерны и eviction-политики кэша.
