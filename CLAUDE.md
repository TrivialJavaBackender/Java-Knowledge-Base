# Interview Prep — Multi-Module

## Структура

Репо содержит три независимых модуля в папке `modules/`:

| Модуль | Путь | Тема |
|--------|------|------|
| `concurrency` | `modules/concurrency/` | Java Concurrency (Kotlin + JUC) |
| `system-design` | `modules/system-design/` | System Design (Java, применение паттернов) |
| `infrastructure` | `modules/infrastructure/` | Docker, K8s, Helm, Observability, Logging, Metrics |
| `spring-frameworks` | `modules/spring-frameworks/` | Spring Core/Boot/MVC/Data/Security/Cloud |
| `kotlin-coroutines` | `modules/kotlin-coroutines/` | Kotlin Coroutines (suspend, Flow, Channel, structured concurrency) |
| `graphql-kotlin` | `modules/graphql-kotlin/` | GraphQL (Expedia graphql-kotlin, DataLoader, Federation) |
| `caching-deep-dive` | `modules/caching-deep-dive/` | Кэширование (CPU→JVM→Caffeine→Redis→CDN) |

## Правило теории — NO OVERLAP

**Каждая тема принадлежит ровно одному модулю:**

| Тема | Модуль |
|------|--------|
| Потоки, synchronized, volatile, JMM, локи, атомики, concurrent collections, executors, synchronizers, virtual threads | `concurrency` |
| Database transactions/indexes, distributed systems, CAP, microservice patterns (Saga, Outbox, Circuit Breaker), testing | `system-design` |
| JWT (структура/JWKS/revocation), OAuth2/OIDC/SAML концепты, IdP (Keycloak), password storage (bcrypt/Argon2) | `system-design` (`identity_providers.md`) |
| Secrets ops: Vault, K8s Secrets, Terraform+секреты, SOPS, mTLS, envelope encryption | `system-design` (`secrets_management.md`) |
| Docker, Kubernetes, Helm, Observability, Logging, Metrics | `infrastructure` |
| Spring Core/DI/IoC, Spring Boot/Starters/Auto-Configuration, Spring MVC/REST, Spring Data JPA/Hibernate (включая все уровни кэша), Spring Security, Spring Cloud | `spring-frameworks` |
| Kotlin coroutines: suspend, корутинные builders (launch/async/withContext/runBlocking), CoroutineScope/Context, Dispatchers, structured concurrency (coroutineScope/supervisorScope), cooperative cancellation, Flow, StateFlow/SharedFlow, Channel, suspend internals (CPS), runTest. **Virtual threads и `StructuredTaskScope` остаются в `concurrency`**. | `kotlin-coroutines` |
| GraphQL: SDL/типы, queries/mutations/subscriptions, резолверы, graphql-kotlin (code-first, Spring Boot интеграция, custom scalars, `GraphQLContext`), DataLoader (N+1, batching/caching), Apollo Federation/subgraphs/`@key`/entity resolvers. **Защита GraphQL endpoint’а (JWT/OAuth2/Spring Security)** остаётся в `system-design` / `spring-frameworks`. | `graphql-kotlin` |
| Кэширование как явление: иерархия кэшей (CPU/page cache/JVM/distributed/CDN), cache patterns (cache-aside, read-through, write-through/back, refresh-ahead), eviction algorithms (LRU/LFU/W-TinyLFU/ARC/2Q), Caffeine, Redis (структуры/persistence/cluster/Lua), distributed caching (centralized/replicated/near-cache, sharding, consistent hashing), HTTP/CDN кэш (Cache-Control, ETag, Vary, purge vs versioned URLs), консистентность (double-write, invalidation, CDC, versioned keys), cache anti-patterns (stampede, penetration, breakdown, avalanche, hot/big keys). **Hibernate L1/L2/Query кэш** остаётся в `spring-frameworks`. | `caching-deep-dive` |

**При добавлении теории** — всегда проверяй, не принадлежит ли тема уже другому модулю.
Если перекрытие есть — теория должна остаться в «исходном» модуле, а в новом — дать ссылку.

## Выбор активного модуля

Пользователь может сказать "переключись на concurrency/system-design/infra" или уточнить команду:
- "проверь concurrency Ex01" — работаем в modules/concurrency/
- "проверь system-design ReservationService" — работаем в modules/system-design/
- "следующий по infra" — модуль infrastructure

Если модуль не указан, читай контекст (о чём идёт речь) или уточни у пользователя.

---

## Команды

### Прогресс
Когда пользователь говорит "прогресс", "статус" или "как дела":
- Прочитай PROGRESS.md активного модуля и покажи статус.
- Если модуль не ясен — покажи статус всех трёх.

### Проверка упражнения

**Для `concurrency` (Ex01–Ex18, Kotlin):**
1. Прочитай `modules/concurrency/src/main/kotlin/exercises/ExXX_Name.kt`
2. Проверь, что TODO заменены на реализацию
3. Скомпилируй: `cd modules/concurrency && mvn compile -q`
4. Запусти: `cd modules/concurrency && mvn exec:java -Dexec.mainClass="exercises.ExXX_NameKt" -q`
5. Проведи детальный code review — race condition, неверные локи, утечки, логика wait/notify
6. Помечай ✅ в `modules/concurrency/PROGRESS.md` только без серьёзных замечаний

**Для `kotlin-coroutines` (Ex01–Ex10, Kotlin):**
1. Прочитай `modules/kotlin-coroutines/src/main/kotlin/exercises/ExXX_Name.kt`
2. Проверь, что TODO заменены на реализацию
3. Скомпилируй: `cd modules/kotlin-coroutines && mvn compile -q`
4. Запусти: `cd modules/kotlin-coroutines && mvn exec:java -Dexec.mainClass="exercises.ExXX_NameKt" -q`
5. Code review: structured concurrency (coroutineScope/supervisorScope), кооперативная отмена, утечки scope, корректность Dispatchers, обработка CancellationException, anti-патерны Flow/Channel
6. Помечай ✅ в `modules/kotlin-coroutines/PROGRESS.md` только без серьёзных замечаний

**Для `caching-deep-dive` (Ex01–Ex10, Kotlin):**
1. Прочитай `modules/caching-deep-dive/src/main/kotlin/exercises/ExXX_Name.kt`
2. Проверь, что TODO заменены на реализацию
3. Скомпилируй: `cd modules/caching-deep-dive && mvn compile -q`
4. Запусти: `cd modules/caching-deep-dive && mvn exec:java -Dexec.mainClass="exercises.ExXX_NameKt" -q`
5. Code review: корректность eviction-логики (LRU/LFU инварианты), потокобезопасность кэша (race на CHM, видимость для волатильных счётчиков), корректность TTL (lazy vs background, jitter), отсутствие cache stampede (single-flight через `computeIfAbsent` или `LoadingCache`), правильный порядок операций при invalidation (DB→invalidate vs invalidate→DB), правильный выбор Caffeine `expireAfterWrite` vs `refreshAfterWrite`, отсутствие memory leaks в in-flight таблицах, корректность ETag/If-None-Match семантики (304 без body, ETag в обоих случаях), равномерность распределения и низкий remap rate в consistent hashing
6. Помечай ✅ в `modules/caching-deep-dive/PROGRESS.md` только без серьёзных замечаний

**Для `graphql-kotlin` (Ex01–Ex06, Kotlin):**
1. Прочитай `modules/graphql-kotlin/src/main/kotlin/exercises/ExXX_Name.kt`
2. Проверь, что TODO заменены на реализацию
3. Скомпилируй: `cd modules/graphql-kotlin && mvn compile -q`
4. Запусти: `cd modules/graphql-kotlin && mvn exec:java -Dexec.mainClass="exercises.ExXX_NameKt" -q`
5. Code review: корректность code-first схемы (nullability, типы), правильность резолверов и suspend-сигнатур, **батчинг через DataLoader без `runBlocking`**, обработка ошибок (partial response, `DataFetcherExceptionHandler`), federation-директивы (`@key`/`@external`), anti-паттерны (utечки контекста, глобальные DataLoader’ы, blocking call’ы в реактивном пайплайне)
6. Помечай ✅ в `modules/graphql-kotlin/PROGRESS.md` только без серьёзных замечаний

**Для `system-design` (Java-классы):**
1. Прочитай нужный класс в `modules/system-design/src/main/java/by/pavel/`
2. Проверь реализацию
3. Скомпилируй и запусти тесты: `cd modules/system-design && mvn test -Dtest=ClassName`
4. Проведи code review: thread safety, locking strategy, корректность
5. Помечай ✅ в `modules/system-design/PROGRESS.md` только без серьёзных замечаний

**Для `infrastructure` (конфиги, YAML, PromQL):**
1. Прочитай файлы упражнения в `modules/infrastructure/exercises/`
2. Проверь корректность конфигурации
3. При необходимости запусти `docker-compose up` для проверки
4. Помечай ✅ в `modules/infrastructure/PROGRESS.md`

**Общие правила review:**
- Найди все race condition, неправильное использование локов, утечки, неверную логику
- Укажи на субоптимальные решения и объясни почему они плохи
- Проверь соответствие условию задачи
- Не пропускай замечания — лучше написать лишнее, чем упустить баг

### Следующий модуль
Когда пользователь говорит "следующий" или "next":
1. Определи активный модуль
2. Найди первый незавершённый модуль в соответствующем PROGRESS.md
3. Прочитай файл теории
4. Покажи краткое содержание и ключевые вопросы
5. Предложи начать с первого невыполненного упражнения

### Квиз
Когда пользователь говорит "квиз" или "quiz":
- Задай 5 случайных вопросов из INTERVIEW_QUESTIONS.md активного модуля
- Жди ответа, оцени

### Добавить/обновить упражнение
- Упражнение должно быть **challenging**, без прямых подсказок в коде
- Никогда не давай подсказки по реализации, если пользователь явно не попросил
- Когда пользователь говорит "начать" — сообщи что файл готов, жди

---

## Сборка

### concurrency (Kotlin)
```bash
cd modules/concurrency
mvn compile
mvn exec:java -Dexec.mainClass="exercises.Ex01_ThreadBasicsKt"
```

### system-design (Java)
```bash
cd modules/system-design
mvn compile
mvn test
mvn test -Dtest=BankServiceTest
```

### infrastructure (Spring Boot)
```bash
cd modules/infrastructure
mvn compile
mvn spring-boot:run
```

### kotlin-coroutines (Kotlin)
```bash
cd modules/kotlin-coroutines
mvn compile
mvn exec:java -Dexec.mainClass="exercises.Ex01_BasicsKt"
```

### graphql-kotlin (Kotlin)
```bash
cd modules/graphql-kotlin
mvn compile
mvn exec:java -Dexec.mainClass="exercises.Ex01_SchemaBasicsKt"
```

### caching-deep-dive (Kotlin)
```bash
cd modules/caching-deep-dive
mvn compile
mvn exec:java -Dexec.mainClass="exercises.Ex01_CacheAsideBasicKt"
```

---

## Структура теории по модулям

### concurrency (`modules/concurrency/theory/`)
- THREADS_BASICS.md — Модуль 1
- LOCKS.md — Модуль 2
- ATOMIC_CAS.md — Модуль 3
- CONCURRENT_COLLECTIONS.md — Модуль 4
- EXECUTORS_FUTURES.md — Модуль 5
- SYNCHRONIZERS.md — Модуль 6
- PROBLEMS.md — Модуль 7
- VIRTUAL_THREADS.md — Модуль 8

### system-design (`modules/system-design/theory/`)
- database_transactions.md
- database_indexes.md
- databases_types.md
- distributed_systems.md
- microservice_patterns.md
- kafka.md
- http_networking.md
- solid_oop.md
- stream_api.md
- identity_providers.md — JWT (структура, JWKS, revocation), OAuth2 (PKCE, Client Credentials, Refresh rotation), OIDC, SAML 2.0, Keycloak (realms, brokering, federation), password storage (bcrypt/Argon2)
- secrets_management.md — envelope encryption, Vault (Seal, auth methods, dynamic secrets), Terraform state, K8s Secrets, SOPS, mTLS
- testing.md

### spring-frameworks (`modules/spring-frameworks/theory/`)
- SPRING_CORE_DI.md — IoC, DI, Bean Scopes, AOP, GoF паттерны
- SPRING_BOOT.md — Starters, Auto-Configuration, Actuator, Profiles
- SPRING_MVC_REST.md — DispatcherServlet, REST, Validation, Filters
- SPRING_DATA_JPA.md — JPA, Hibernate L1/L2/Query кэши, N+1, @Transactional
- SPRING_SECURITY.md — Filter Chain, JWT, Method Security, CSRF
- SPRING_CLOUD.md — Config, Eureka, Gateway, Feign, Circuit Breaker

### infrastructure (`modules/infrastructure/theory/`)
- DOCKER.md, KUBERNETES.md, HELM.md
- OBSERVABILITY.md, LOGGING.md, METRICS.md

### kotlin-coroutines (`modules/kotlin-coroutines/theory/`)
- BASICS.md — suspend, launch/async/runBlocking/withContext, Job
- SCOPE_CONTEXT.md — CoroutineScope, CoroutineContext, наследование
- DISPATCHERS.md — Default/IO/Main/Unconfined, limitedParallelism
- STRUCTURED_CONCURRENCY.md — coroutineScope vs supervisorScope, SupervisorJob
- CANCELLATION_EXCEPTIONS.md — cooperative cancel, NonCancellable, withTimeout, CoroutineExceptionHandler
- FLOW.md — cold streams, операторы, flowOn, retry, backpressure
- FLOW_ADVANCED.md — StateFlow, SharedFlow, shareIn/stateIn, WhileSubscribed
- CHANNELS.md — Channel capacity, produce, select, fan-out/fan-in
- SUSPEND_INTERNALS.md — CPS, state machine, suspendCancellableCoroutine
- TESTING_INTEROP.md — runTest, виртуальное время, CompletableFuture/Rx interop

### graphql-kotlin (`modules/graphql-kotlin/theory/`)
- BASICS.md — GraphQL spec, SDL, типы, queries/mutations/subscriptions, response model
- GRAPHQL_KOTLIN_SPRING.md — Expedia graphql-kotlin (code-first), Spring Boot, suspend-резолверы, GraphQLContext, custom scalars
- DATALOADER_NPLUS1.md — DataLoader idea, KotlinDataLoader, batching/caching, решение N+1
- FEDERATION.md — Apollo Federation v2, subgraphs, `@key`/`@external`/`@requires`, entity resolvers, router

### caching-deep-dive (`modules/caching-deep-dive/theory/`)
- BASICS.md — иерархия кэшей (CPU/page cache/JVM/distributed/CDN), locality, метрики (hit ratio, latency)
- CACHE_PATTERNS.md — cache-aside, read-through, write-through, write-behind, refresh-ahead
- EVICTION_POLICIES.md — LRU, LFU, FIFO, ARC, 2Q, TinyLFU, W-TinyLFU, TTL vs TTI, weight-based
- CAFFEINE.md — API, expireAfter*, refreshAfter*, AsyncLoadingCache, RemovalListener, Stats, Weigher, Spring integration
- REDIS.md — структуры (string/hash/list/set/zset/stream), persistence (RDB/AOF), eviction policies, Sentinel/Cluster, pub/sub, Lua, pipelining
- DISTRIBUTED_CACHING.md — centralized vs replicated vs near-cache, server/client-side sharding, consistent hashing, rendezvous, cross-node invalidation
- CONSISTENCY.md — double-write problem (4 порядка), TTL eventual, event-driven, CDC, versioned keys, stale-while-revalidate, read-after-write
- HTTP_CDN_CACHE.md — Cache-Control directives, ETag/If-None-Match, Last-Modified, Vary, CDN pull/push, purge vs versioned URLs
- ANTI_PATTERNS.md — cache stampede, penetration, breakdown, avalanche, hot/big keys, кэш над кэшом

---

## Формат INTERVIEW_QUESTIONS.md

Web app парсит Q&A из `modules/<slug>/INTERVIEW_QUESTIONS.md`. Поддерживаются три формата (выбирается через `qaFormat` в `web/content.config.ts`):

**`qa-bold`** (concurrency, kotlin-coroutines, graphql-kotlin, system-design, infrastructure):
```markdown
## 1. Название секции          ← или просто "## Название (Q1–Q6)" — номер опционален

### Q1: Текст вопроса?
**A:** Текст ответа. Может быть многострочным.
> JCP §15.3                     ← опциональная ссылка-источник
```

**`q-asterisk`** (spring-frameworks):
```markdown
## Название секции

**Q1. Текст вопроса?**

Ответ-проза, может быть многоабзацный.
```

**`heading-as-q`** (caching-deep-dive):
```markdown
## 1. Текст вопроса?
Ответ — всё что между этим заголовком и следующим `## N.` (или `---`).
```

**Правила:**
- `### Q1`, `### Q2` — номера должны быть уникальны в пределах модуля (это natural key для сохранения Leitner-стейта).
- Не перенумеровывай Q при правках — иначе web сгенерирует новые карточки и потеряет интервалы для старых.
- Источник `> ...` забирается только в `qa-bold`. Один на ответ, последняя строка.

## Формат теории и упражнений

- Theory: `modules/<slug>/theory/<NAME>.md`. Первый `# Заголовок` идёт в title, остальной body — в body.
- Внутри теории можно ссылаться на другие .md или упражнения: `[…](OTHER.md)`, `[…](src/main/kotlin/exercises/Ex01_X.kt)`. Web переписывает их в site-маршруты автоматически.
- Порядок теории на сайте берётся из `ROADMAP.md` модуля по первому упоминанию `theory/<NAME>.md`. Файлы не упомянутые в roadmap идут в конец по алфавиту.
- Exercises: `modules/<slug>/src/main/{kotlin,java}/exercises/Ex<NN>_<Name>.{kt,java}`. Регулярка строгая — отступы от шаблона ломают парсер.

## Web app (`web/`)

Single-user Next.js приложение для прогресс-трекинга, чтения теории и Anki-style повторения карточек. Локально на `localhost:3000`.

```bash
cd web
pnpm dev                                     # запуск
node_modules/.bin/tsx scripts/sync.ts        # пере-импорт после правки modules/
```

**Когда нужно делать sync:**
- После добавления/правки/удаления .md в `modules/<slug>/theory/`.
- После правки `INTERVIEW_QUESTIONS.md` (новые Q → новые карточки автоматически).
- После добавления упражнений `Ex<NN>_*.kt`.
- Idempotent — без изменений делает 0 записей. Прогресс/Leitner сохраняется через стабильные natural keys.

**Авто-карточки:** генерируются 1:1 из Q&A в `INTERVIEW_QUESTIONS.md`. При правке текста Q обновляется фронт/бэк карточки, бокс/streak сохраняются. При удалении Q карточка архивируется (не удаляется).

**Manual-карточки:** создаются через `/flashcards/new`. Не зависят от modules/, редактируются прямо в UI.

---

## Создать новый модуль

Используй команду `/new-module` (slash command).

---

## Семантическая архитектура знаний

### Глобальный индекс
- `knowledge/GLOBAL_INDEX.md` — карта «концепт → канонический файл-владелец»
- Перед добавлением нового концепта — проверить GLOBAL_INDEX.md
- Один концепт → один канонический владелец; остальные модули ссылаются, а не переопределяют
- Обновлять GLOBAL_INDEX.md при добавлении новых концептов в теорию

### Саммари модулей
- Каждый модуль содержит `_SUMMARY.md` в корне — семантическое сжатие для быстрого восстановления контекста
- Читать `_SUMMARY.md` перед загрузкой полных теоретических файлов, когда нужна ориентация
- Размер ≤ 2 КБ; структура: Core Model, Key Concepts, Important Invariants, Common Pitfalls, Related Modules
- Обновлять `_SUMMARY.md` при добавлении или существенном изменении теории в модуле

### Канонические термины
- `knowledge/CANONICAL_TERMS.md` — предпочтительная терминология и запрещённые синонимы
- Использовать каноническую формулировку в теории, упражнениях и вопросах для собеседования
- Не допускать дрейфа терминов (например, «cache thundering herd» → использовать «cache stampede»)

### Правила анти-дупликации
Перед добавлением теории:
1. Проверить `knowledge/GLOBAL_INDEX.md` на наличие канонического владельца
2. Если владелец уже есть → сослаться, не переопределять
3. Если перекрытие с существующей теорией >30% → расширить существующий файл, а не создавать новый
4. Добавить новый концепт в GLOBAL_INDEX.md после создания

### Семантический аудит
При проверке новой теории или упражнений:
- Обнаруживать дублированные концепты → находить канонического владельца в GLOBAL_INDEX.md
- Обнаруживать дрейф терминологии → сверяться с CANONICAL_TERMS.md
- Обнаруживать нарушения владения → проверять таблицу модулей в CLAUDE.md (правило NO OVERLAP)
- Обнаруживать отсутствующие перекрёстные ссылки → предлагать канонические ссылки на другие модули
- Обновлять GLOBAL_INDEX.md и соответствующий `_SUMMARY.md` при изменении теории
