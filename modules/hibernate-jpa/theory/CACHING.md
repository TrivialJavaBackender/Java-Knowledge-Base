# Hibernate / JPA — Кэширование: L1, L2 и Query Cache

Hibernate предлагает три независимых уровня кэширования. Их важно не путать: они различаются областью действия, тем, что именно хранят, и правилами инвалидации. На собеседовании частая ошибка кандидата — смешивать кэш Hibernate со Spring Cache (`@Cacheable`), это совершенно разные механизмы (разбор ниже).

| Уровень | Область | Что хранит | Включён по умолчанию |
|---|---|---|---|
| **L1** (persistence context) | Одна `Session` / транзакция | Managed-объекты (ссылки в памяти) | Да, отключить нельзя |
| **L2** (shared cache) | `SessionFactory` (всё приложение) | Состояние сущностей (dehydrated state), не объекты JVM | Нет, нужен провайдер |
| **Query Cache** | `SessionFactory` | Список идентификаторов результата запроса | Нет, требует L2 |

---

## L1 — кэш первого уровня (persistence context)

L1 встроен в каждую `Session` (`EntityManager`) и **неотключаем**. Его область действия — одна сессия; в Spring это обычно граница одной транзакции, потому что `@Transactional` открывает `Session` в начале и закрывает в конце.

L1 — это **identity map**: внутри одной сессии один и тот же идентификатор всегда возвращает один и тот же Java-объект. Это не просто оптимизация, а вопрос корректности — два вызова `find(User.class, 1L)` обязаны вернуть тот же экземпляр, иначе изменение через одну ссылку не будет видно через другую.

```java
@Transactional
public void demonstrate(EntityManager em) {
    User u1 = em.find(User.class, 1L); // SELECT ... WHERE id = 1
    User u2 = em.find(User.class, 1L); // из L1 — SQL НЕ выполняется

    assert u1 == u2;                   // буквально один объект в памяти

    u1.setEmail("new@example.com");
    // u2.getEmail() тоже вернёт "new@example.com" — это тот же объект
}
```

L1 наполняется автоматически при любой загрузке сущности (`find`, навигация по ассоциации, результат запроса) и при `persist`. Очистка:

```java
em.detach(user); // убрать конкретную сущность из контекста (станет detached)
em.clear();      // очистить весь контекст — все managed-объекты становятся detached
em.close();      // закрытие сессии полностью уничтожает L1
em.flush();      // НЕ очищает L1; лишь синхронизирует изменения с БД (без commit)
```

Подводный камень L1 — рост памяти при пакетной обработке. Если в одной транзакции загрузить и изменить сотни тысяч сущностей, persistence context разрастётся, а `flush` будет «грязно проверять» (dirty checking) каждый объект. Лечится периодическим `flush()` + `clear()` пачками.

L1 живёт в одном потоке и не разделяется между сессиями — поэтому вопрос потокобезопасности к нему не применим.

---

## L2 — кэш второго уровня (shared cache)

L2 разделяется между всеми сессиями одного `SessionFactory` и переживает закрытие транзакции. Это и есть «настоящее» кэширование данных между запросами: если справочник (валюты, категории, настройки) читается тысячи раз в секунду, ходить за ним в БД каждый раз расточительно.

L2 хранит **не объекты JVM, а dehydrated state** — состояние сущности в виде набора скалярных значений и идентификаторов ассоциаций (по сути `Object[]`). При попадании в кэш Hibernate из этого состояния «регидрирует» новый managed-объект в текущей сессии. Поэтому L2 потокобезопасен: он не отдаёт общие изменяемые объекты.

### Что кэшируется, а что нет

L2 кэширует:
- сущности по идентификатору (entity by id);
- коллекции-ассоциации (отдельным флагом `@Cache` на поле коллекции);
- результаты запросов — **только** через отдельный Query Cache (см. ниже).

L2 **не** кэширует результаты произвольных запросов сам по себе. Вызов `em.find(User.class, 1L)` использует L2, а `SELECT u FROM User u WHERE u.active = true` — нет, пока не включён Query Cache.

### Включение и провайдеры

```properties
# Включить L2
hibernate.cache.use_second_level_cache=true
# Region factory — мост к конкретному провайдеру (через JSR-107 / JCache)
hibernate.cache.region.factory_class=org.hibernate.cache.jcache.JCacheRegionFactory
```

**Region factory** — точка подключения провайдера. Hibernate не реализует хранилище сам, а делегирует его SPI-реализации:

| Провайдер | Тип | Когда |
|---|---|---|
| **EhCache** (через JCache) | Локальный, on-heap/off-heap | Один инстанс или редкие записи |
| **Caffeine** (через JCache) | Локальный, on-heap | Один инстанс, нужен W-TinyLFU |
| **Infinispan** | Распределённый | Несколько инстансов, инвалидация по кластеру |
| **Redis** (через Redisson `RedissonRegionFactory`) | Распределённый, вынесенный | Несколько инстансов, общий вынесенный кэш |

Для нескольких инстансов приложения локальный провайдер опасен: у каждого инстанса свой L2, и при изменении на одном узле остальные продолжат отдавать устаревший кэш. Нужен распределённый провайдер (Infinispan/Redis) или режим инвалидации, рассылающий команду вытеснения по кластеру.

### `@Cache` и режим shared-cache

Даже при включённом L2 Hibernate кэширует сущность только если она помечена. По умолчанию действует `shared-cache-mode=ENABLE_SELECTIVE`: кэшируются лишь сущности с `@Cacheable` (JPA) или `@Cache` (Hibernate).

```java
import jakarta.persistence.Cacheable;
import org.hibernate.annotations.Cache;
import org.hibernate.annotations.CacheConcurrencyStrategy;

@Entity
@Cacheable                                              // JPA: участвует в L2
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)     // Hibernate: + стратегия
public class Currency {
    @Id private String code;
    private String name;
    private BigDecimal usdRate;

    @OneToMany(mappedBy = "currency")
    @Cache(usage = CacheConcurrencyStrategy.READ_ONLY)  // коллекцию кэшируем отдельно
    private List<Country> countries;
}
```

`@Cacheable` (JPA) — переключатель «участвует/не участвует». `@Cache` (Hibernate) — задаёт **стратегию параллельного доступа** и опциональный регион. На практике для управления стратегией используют `@Cache`.

Значения `jakarta.persistence.sharedCache.mode`:

| Режим | Что кэшируется |
|---|---|
| `ENABLE_SELECTIVE` (по умолчанию) | Только помеченные `@Cacheable` |
| `DISABLE_SELECTIVE` | Все, кроме помеченных `@Cacheable(false)` |
| `ALL` | Все сущности |
| `NONE` | Ничего (L2 фактически выключен) |

### Как L2 встраивается в чтение

```text
em.find(User.class, 1L):
  1. Проверить L1 (текущая сессия)        → есть? вернуть тот же объект
  2. Проверить L2 (SessionFactory)         → есть? регидрировать managed-объект, вернуть
  3. SQL SELECT                            → положить состояние в L2, объект в L1, вернуть
```

Инвалидация L2 происходит **автоматически** при изменениях через Hibernate:

```java
repo.save(currency);   // после commit Hibernate обновит/инвалидирует запись по id
repo.delete(currency); // удалит запись из L2

// Ручная инвалидация (например, внешнее изменение БД в обход Hibernate):
Cache cache = entityManagerFactory.getCache();
cache.evict(Currency.class, "USD"); // конкретная сущность
cache.evict(Currency.class);        // весь регион сущности
cache.evictAll();                   // весь L2
```

Ключевой риск: изменения в обход Hibernate (нативный SQL `UPDATE`, миграция, другой сервис, пишущий в ту же БД) L2 **не** инвалидируют — кэш молча устаревает. Здесь либо ручное вытеснение, либо инвалидация через CDC, либо отказ от L2 для таких таблиц.

---

## Стратегии параллельного доступа к кэшу (Cache Concurrency Strategies)

Стратегия параллельного доступа определяет, как L2 ведёт себя при конкурентных чтениях и записях. Выбор зависит от частоты изменений сущности.

| Стратегия | Запись | Гарантия | Когда применять |
|---|---|---|---|
| `READ_ONLY` | Запрещена (попытка → исключение) | Максимальная: данные неизменны | Справочники, константы, история — то, что не меняется после вставки |
| `NONSTRICT_READ_WRITE` | Запись в кэш не делается; запись инвалидирует запись (evict) после commit, без блокировки | Слабая: краткое окно устаревших данных между commit и evict | Редко меняющиеся данные, где допустима небольшая задержка актуальности |
| `READ_WRITE` | Soft lock + обновление после commit | Read-committed: конкуренты не видят промежуточное состояние | Данные, которые меняются и требуют согласованности без JTA |
| `TRANSACTIONAL` | Под управлением JTA-транзакции вместе с БД | Полная транзакционная (XA) | Только при JTA и провайдере с поддержкой (Infinispan); используется редко |

**`READ_WRITE` и soft lock.** При начале обновления Hibernate помечает запись в L2 «мягким локом»: пока транзакция не зафиксирована, другие транзакции не доверяют кэшированному значению по этому ключу и идут в БД. После commit запись в кэше обновляется. Так достигается read-committed без потери производительности на чтениях. Замечание: soft lock — оптимистичный механизм с версионированием меток времени, он не блокирует читателей физически, а заставляет их обойти кэш.

**`NONSTRICT_READ_WRITE` vs `READ_WRITE`.** Первый дешевле, но между фиксацией транзакции и инвалидацией записи существует окно, в котором конкурент может прочитать устаревшее значение. Если это недопустимо — `READ_WRITE`.

Несовпадение стратегии и нагрузки — типичная ошибка: пометить часто обновляемую сущность `READ_ONLY` нельзя (будет исключение при записи), а `READ_WRITE` на сущности, которая никогда не меняется, добавляет лишний оверхед — здесь оптимален `READ_ONLY`.

---

## Query Cache

Query Cache кэширует не сами объекты, а **список идентификаторов** результата запроса. Сами сущности достаются по этим id из L2. Поэтому **Query Cache бесполезен без L2**: id есть, а тела сущностей всё равно придётся грузить из БД.

```properties
hibernate.cache.use_query_cache=true
```

```java
@Query("SELECT c FROM Currency c WHERE c.region = :region")
@QueryHints(@QueryHint(name = "org.hibernate.cacheable", value = "true"))
List<Currency> findByRegion(@Param("region") String region);
```

```text
Первый вызов findByRegion("EU"):
  → SQL: SELECT id FROM currency WHERE region = 'EU' → [1, 2, 5]
  → Ключ Query Cache: (текст запроса + параметры) → [1, 2, 5]
  → для каждого id: L2 hit или SQL

Второй вызов findByRegion("EU"):
  → Query Cache hit: [1, 2, 5]
  → для каждого id: L2 hit
  → ни одного SQL-запроса
```

### Battle-story: устаревший Query Cache при частых записях

Query Cache инвалидируется через служебный регион `UpdateTimestampsCache`: для каждой таблицы хранится метка времени последнего изменения. Любой DML по таблице (`INSERT`/`UPDATE`/`DELETE`) обновляет метку, и **все** закэшированные запросы, затрагивающие эту таблицу, считаются устаревшими — даже если изменённая строка не входила в их результат.

Команда включила Query Cache на таблице `orders`, которая принимает сотни записей в секунду. Эффект: каждая новая запись двигала метку времени, и при следующем чтении любой закэшированный запрос по `orders` инвалидировался. Доля попаданий упала почти до нуля, а оверхед на ведение Query Cache и регистрацию меток остался. Итог хуже, чем без кэша вообще.

**Правило:** Query Cache оправдан только для запросов по редко меняющимся таблицам (справочники), где соотношение чтений к записям очень высокое. На горячих на запись таблицах его не включают.

Дополнительный риск рассинхрона: если Query Cache отдал id `[1, 2, 5]`, а соответствующая сущность была вытеснена из L2 или изменена в обход Hibernate, можно получить лишний поход в БД или несогласованную картину. Согласованность Query Cache не выше согласованности L2, на который он опирается.

---

## Чем кэш Hibernate отличается от Spring `@Cacheable`

Это разные механизмы на разных уровнях — их легко спутать на собеседовании.

| | L2 Hibernate | Spring Cache (`@Cacheable`) |
|---|---|---|
| Уровень | Слой доступа к данным (ORM) | Слой приложения (AOP вокруг метода) |
| Что кэширует | Состояние сущностей по id | Возвращаемое значение метода (любой объект/DTO) |
| Инвалидация | Автоматически при изменениях через Hibernate | Ручная (`@CacheEvict`/`@CachePut`) — Spring не знает про ваши данные |
| Где живёт | Внутри `SessionFactory` | Любой `CacheManager` (Caffeine, Redis, ...) |
| Знает про id-граф | Да (регидрация managed-сущностей) | Нет (хранит сериализованный результат как есть) |

Spring `@Cacheable` кэширует **результат вызова метода** целиком, не понимая семантики сущностей. Если закэшировать `@Cacheable` метод, возвращающий managed-сущность, можно получить detached-объект и проблемы с lazy-инициализацией. Подробнее о Spring Cache abstraction — в [spring-frameworks/SPRING_DATA_JPA.md](../../spring-frameworks/theory/SPRING_DATA_JPA.md) (это отдельный механизм, не L2).

Redis в роли провайдера встречается в обоих случаях, но по-разному: для L2 — через `RedissonRegionFactory`, для Spring Cache — через `RedisCacheManager`. О самом Redis (структуры данных, персистентность, кластер) — в [caching-deep-dive/REDIS.md](../../caching-deep-dive/theory/REDIS.md).

---

## Где почитать дальше

- [JPA_VS_HIBERNATE.md](JPA_VS_HIBERNATE.md) — спецификация JPA против провайдера; что из кэширования стандартизировано (`@Cacheable`, `Cache.evict`), а что — расширения Hibernate (`@Cache`, стратегии).
- [ENTITY_LIFECYCLE.md](ENTITY_LIFECYCLE.md) — persistence context, managed/detached; основа понимания L1.
- [FETCHING_NPLUS1.md](FETCHING_NPLUS1.md) — N+1, lazy-загрузка; кэш коллекций и взаимодействие с L2.
- [TRANSACTIONS_LOCKING.md](TRANSACTIONS_LOCKING.md) — границы транзакции (= область L1), оптимистичные блокировки и версионирование.
- [QUERYING.md](QUERYING.md) — JPQL/HQL, query hints; где задаётся `org.hibernate.cacheable`.
- [PERFORMANCE_PITFALLS.md](PERFORMANCE_PITFALLS.md) — пакетная обработка, рост persistence context, when-to-cache.
- [MAPPINGS_ASSOCIATIONS.md](MAPPINGS_ASSOCIATIONS.md) и [IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md) — маппинги и идентификаторы, по которым работает L2.
- Общая теория кэширования (cache-aside, write-through, refresh-ahead) — [caching-deep-dive/CACHE_PATTERNS.md](../../caching-deep-dive/theory/CACHE_PATTERNS.md); политики вытеснения (LRU/LFU/W-TinyLFU) — [caching-deep-dive/EVICTION_POLICIES.md](../../caching-deep-dive/theory/EVICTION_POLICIES.md).

## Источники

- Hibernate ORM User Guide — раздел «Caching» (Second-level cache, query cache, concurrency strategies).
- Vlad Mihalcea — «High-Performance Java Persistence»; статьи о `READ_WRITE` soft lock и `UpdateTimestampsCache`.
- JPA-спецификация (Jakarta Persistence) — `@Cacheable`, `SharedCacheMode`, `Cache` API.
