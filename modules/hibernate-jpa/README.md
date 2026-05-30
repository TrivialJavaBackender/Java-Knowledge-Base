# hibernate-jpa

Deep-dive модуль по **Hibernate / JPA** для подготовки к собеседованиям на senior backend
(Java/Kotlin). Покрывает спецификацию JPA и провайдер Hibernate: жизненный цикл сущностей и
persistence context, маппинг ассоциаций, стратегии идентификаторов и наследования,
fetch-стратегии и N+1, три уровня кэша, транзакции и блокировки, JPQL/HQL/Criteria,
производительность и типичные ошибки.

Это **теоретический модуль** (`no-build`): без `pom.xml`, без упражнений. Прогресс
прохождения и Anki-карточки трекаются в web app (`web/`), а не в репозитории.

## Структура

```
modules/hibernate-jpa/
├── theory/                       # теория
│   ├── JPA_VS_HIBERNATE.md       # спецификация JPA vs провайдер, bootstrap, dialect
│   ├── ENTITY_LIFECYCLE.md       # persistence context, состояния, dirty checking, flush
│   ├── MAPPINGS_ASSOCIATIONS.md  # ассоциации, owning/inverse, cascade, orphanRemoval
│   ├── IDENTIFIERS_INHERITANCE.md# генерация id, стратегии наследования
│   ├── FETCHING_NPLUS1.md        # LAZY/EAGER, proxy, EntityGraph, N+1, LazyInit
│   ├── CACHING.md                # L1/L2/Query cache, concurrency strategies
│   ├── TRANSACTIONS_LOCKING.md   # EntityTransaction, @Version, LockModeType
│   ├── QUERYING.md               # JPQL/HQL, Criteria, native, проекции
│   └── PERFORMANCE_PITFALLS.md   # batching, StatelessSession, OSIV, частые ошибки
├── ROADMAP.md                    # порядок прохождения
├── _SUMMARY.md                   # семантическое сжатие модуля
└── INTERVIEW_QUESTIONS.md        # Q&A для собеседований (формат qa-bold)
```

## Как работать

1. Иди по порядку из [ROADMAP.md](ROADMAP.md) — от основ JPA к производительности.
2. Перед загрузкой полной теории читай [_SUMMARY.md](_SUMMARY.md) для ориентации.
3. Проверяй себя по [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md).

Сборки нет — это чистая теория. Для прогресс-трекинга и повторения карточек запусти web app
(`cd web && pnpm dev`).

## Связанные модули

- [databases](../databases/) — ACID, уровни изоляции, MVCC, каноническая теория N+1,
  ORM-паттерны (Identity Map / Unit of Work).
- [spring-frameworks](../spring-frameworks/) — `@Transactional` (Spring AOP), Spring Data
  репозитории, интеграция Hibernate со Spring.
- [caching-deep-dive](../caching-deep-dive/) — общая теория кэширования (паттерны, eviction).
