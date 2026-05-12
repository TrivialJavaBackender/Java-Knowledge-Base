# Spring Data JPA и Hibernate

## Стек технологий: что над чем

Важно понимать слоение, иначе легко перепутать, кто за что отвечает:

```
Spring Data JPA      ← абстракция, убирает бойлерплейт репозиториев (интерфейс → реализация)
     ↓
JPA (Jakarta Persistence API)  ← стандарт/спецификация, определяет аннотации и API
     ↓
Hibernate ORM        ← реализация JPA (самая популярная), генерирует SQL
     ↓
JDBC                 ← низкоуровневый Java API для работы с БД
     ↓
PostgreSQL / MySQL / H2  ← реальная база данных
```

Когда ты пишешь `@Entity`, `@OneToMany`, `@Transactional` — это JPA API. Hibernate реализует их. Spring Data JPA добавляет `JpaRepository` и генерирует реализации. Spring Framework добавляет управление транзакциями через AOP.

---

## JPA Entity и Persistence Context

### Состояния сущности

Одна из ключевых концепций JPA — **состояния объекта** относительно Persistence Context (сессии Hibernate):

```
Transient (new User())
    ↓ em.persist() / repo.save()
Managed (отслеживается, изменения → SQL при flush)
    ↓ транзакция закрылась / em.detach()
Detached (изменения не отслеживаются)
    ↓ em.merge()
Managed (снова под контролем)
    ↓ em.remove() / repo.delete()
Removed (будет удалён при flush)
```

**Managed** состояние — самое важное. Пока объект managed, Hibernate знает о всех изменениях в его полях и автоматически сгенерирует UPDATE при commit (это называется **dirty checking**).

```java
@Transactional
public void updateUserEmail(Long userId, String newEmail) {
    User user = repo.findById(userId).orElseThrow(); // user теперь Managed
    user.setEmail(newEmail); // просто меняем поле...
    // repo.save() НЕ нужен! Hibernate сам увидит изменение и сделает UPDATE
}
// При закрытии транзакции: Hibernate делает flush → генерирует UPDATE users SET email=? WHERE id=?
```

Dirty checking работает путём сравнения текущего состояния с **snapshot** — копией, снятой при загрузке. Перед commit Hibernate сравнивает каждое поле каждого managed-объекта. Это может быть дорого при большом количестве объектов в сессии.

### Пример Entity с объяснением аннотаций

```java
@Entity
@Table(name = "users", indexes = {
    @Index(name = "idx_users_email", columnList = "email"),
    @Index(name = "idx_users_dept", columnList = "department_id")
})
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    // IDENTITY = AUTO_INCREMENT в MySQL, SERIAL в PostgreSQL.
    // SEQUENCE (дефолт в Hibernate 6) — использует отдельную последовательность БД,
    // позволяет batch insert (IDENTITY нет, т.к. ID неизвестен до INSERT).
    private Long id;

    @Column(nullable = false, unique = true, length = 255)
    private String email;

    @Enumerated(EnumType.STRING)
    // STRING хранит "ADMIN", "USER" — читабельно, безопасно при добавлении значений.
    // ORDINAL хранит 0, 1 — хрупко: добавление значения в середину enum ломает данные.
    private Role role;

    @Version
    // Hibernate автоматически добавляет к UPDATE: WHERE version = ?
    // Если другая транзакция уже изменила запись — version отличается → OptimisticLockException
    private Long version;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "department_id")
    // FetchType.LAZY — загружать department только при обращении к полю,
    // не при загрузке User. По умолчанию у @ManyToOne — EAGER, но LAZY лучше.
    private Department department;

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    // mappedBy — указывает, что внешний ключ хранится в Order.user, не здесь.
    // cascade = ALL — все операции (persist, merge, remove) каскадируются на orders.
    // orphanRemoval = true — если Order убрать из коллекции, он удалится из БД.
    private List<Order> orders = new ArrayList<>();
}
```

---

## FetchType: EAGER vs LAZY и когда это важно

**EAGER** — связь загружается всегда вместе с основной сущностью (JOIN в SQL).
**LAZY** — загружается при первом обращении к полю (отдельный SELECT).

Дефолты:
- `@ManyToOne`, `@OneToOne` — EAGER (опасно! часто надо менять на LAZY)
- `@OneToMany`, `@ManyToMany` — LAZY

```java
// EAGER @ManyToOne создаёт скрытые JOIN при каждом запросе
User user = repo.findById(1L).orElseThrow();
// SQL: SELECT u.*, d.* FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.id = 1
// Department загружается всегда, даже если не нужен
```

**LazyInitializationException** — одна из самых частых ошибок в Spring/Hibernate. Возникает когда обращаешься к lazy-полю вне активной сессии (транзакции):

```java
// ❌ Типичная ошибка: сессия закрывается вместе с транзакцией
@Service
public class UserService {
    public User getUser(Long id) {
        return repo.findById(id).orElseThrow(); // транзакция только вокруг этого вызова
    }
}

// В контроллере:
User user = userService.getUser(1L); // транзакция уже закрыта
user.getOrders().size(); // LazyInitializationException! Сессии нет

// ✅ Решение 1: держать всё в транзакции
@Transactional
public UserDto getUserWithOrders(Long id) {
    User user = repo.findById(id).orElseThrow();
    user.getOrders().size(); // OK — в транзакции
    return mapper.toDto(user);
}

// ✅ Решение 2: JOIN FETCH — загрузить связь сразу
@Query("SELECT u FROM User u JOIN FETCH u.orders WHERE u.id = :id")
Optional<User> findByIdWithOrders(@Param("id") Long id);
```

Плохое решение — включить `spring.jpa.open-in-view=true` (по умолчанию включено в Spring Boot). Это держит сессию открытой весь HTTP-запрос, позволяя lazy-загрузку в слое представления. Проблема: скрытые N+1 запросы в шаблонах/сериализации, долгие соединения с БД. Лучше явно контролировать загрузку.

---

## Spring Data JPA Repository

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // Derived queries — Spring генерирует SQL по имени метода
    // findBy... OrderBy... And... Or... Between... GreaterThan... Like... In... True/False...
    List<User> findByDepartmentNameAndActiveTrue(String departmentName);
    Optional<User> findTopByEmailOrderByCreatedAtDesc(String email);
    long countByRole(Role role);
    boolean existsByEmail(String email);

    // @Query — когда derived query становится нечитаемым
    @Query("""
        SELECT u FROM User u
        JOIN FETCH u.department d
        WHERE d.name = :dept AND u.active = true
        ORDER BY u.lastName
        """)
    List<User> findActivesInDepartment(@Param("dept") String department);

    // @Modifying нужен для UPDATE/DELETE запросов
    // Без него Spring выбросит исключение (ожидает SELECT)
    @Modifying
    @Transactional
    @Query("UPDATE User u SET u.active = false WHERE u.lastLogin < :cutoff")
    int deactivateOldUsers(@Param("cutoff") LocalDateTime cutoff);
}
```

**Как Spring Data генерирует реализацию:** при старте Spring создаёт `SimpleJpaRepository` (или `JpaRepositoryFactory`) — реальная реализация интерфейса, делегирующая в `EntityManager`. Derived queries парсятся в JPQL. Это происходит один раз при старте — если имя метода некорректно, приложение не запустится.

### Pageable

```java
// PageRequest — фабричный метод для создания Pageable
Pageable pageable = PageRequest.of(
    0,                              // номер страницы (с нуля)
    20,                             // размер страницы
    Sort.by("lastName").ascending()
        .and(Sort.by("createdAt").descending())
);

Page<User> page = repo.findByActiveTrue(pageable);

// Page содержит:
page.getContent();        // List<User> текущей страницы
page.getTotalElements();  // SELECT COUNT(*) — отдельный запрос!
page.getTotalPages();
page.isFirst();
page.isLast();
page.hasNext();

// Если count не нужен — используй Slice (нет COUNT запроса):
Slice<User> slice = repo.findByActiveTrue(pageable);
slice.hasNext(); // true если есть следующая страница (пробует загрузить size+1)
```

---

## @Transactional — транзакционный менеджмент

### Как работает

`@Transactional` реализован через AOP-прокси. Когда вызывается помеченный метод, `TransactionInterceptor` перехватывает вызов и:
1. Открывает транзакцию (или присоединяется к существующей)
2. Вызывает реальный метод
3. При успехе — commit
4. При `RuntimeException` (или Error) — rollback
5. При `CheckedException` — по умолчанию НЕ откатывает (это можно изменить)

```java
@Service
public class OrderService {

    // По умолчанию: Propagation.REQUIRED, rollbackFor = RuntimeException.class
    @Transactional
    public void placeOrder(Order order) {
        orderRepo.save(order);
        inventoryService.reserve(order); // если бросит RuntimeException → rollback всего
        emailService.sendConfirmation(order); // тоже в рамках транзакции
    }

    // readOnly = true — важная оптимизация:
    // 1. Hibernate отключает dirty checking (не надо сравнивать snapshots)
    // 2. Некоторые БД могут направить запрос на read-replica
    // 3. Flush mode = NEVER (нет автоматического flush)
    @Transactional(readOnly = true)
    public Page<Order> getOrders(Long userId, Pageable pageable) {
        return orderRepo.findByUserId(userId, pageable);
    }

    // Откат на checked исключение (по умолчанию не откатывается):
    @Transactional(rollbackFor = PaymentException.class)
    public void processPayment() throws PaymentException { ... }

    // Не откатывать даже при RuntimeException определённого типа:
    @Transactional(noRollbackFor = InventoryWarningException.class)
    public void createOrder() { ... }
}
```

### Propagation — распространение транзакций

Определяет, что происходит когда транзакционный метод вызывает другой транзакционный метод.

```
Метод A (@Transactional) вызывает метод B (@Transactional)

REQUIRED (дефолт):
  A открыл транзакцию → B присоединяется к ней → один rollback откатит оба

REQUIRES_NEW:
  A открыл транзакцию → B приостанавливает её, открывает свою → B коммитит/откатывает независимо

NESTED:
  A открыл транзакцию → B создаёт savepoint → откат B → только до savepoint, A продолжает

SUPPORTS:
  Если A есть транзакция → B участвует в ней. Если нет → B без транзакции.

MANDATORY:
  B требует активной транзакции. Если вызвать B без транзакции — исключение.

NOT_SUPPORTED:
  B всегда выполняется без транзакции (активная транзакция приостанавливается)

NEVER:
  B бросает исключение если есть активная транзакция
```

**Типичный сценарий REQUIRES_NEW — аудит:**
```java
@Service
public class OrderService {
    private final AuditService auditService;

    @Transactional
    public void placeOrder(Order order) {
        orderRepo.save(order);

        // Аудит должен записаться ДАЖЕ если основная транзакция откатится.
        // REQUIRES_NEW: auditService.log() выполнится в отдельной транзакции,
        // закоммитится независимо.
        auditService.log("ORDER_PLACED", order.getId()); // REQUIRES_NEW внутри

        // если здесь бросит исключение → orderRepo.save откатится,
        // но auditService.log уже закоммичен
        externalPaymentService.charge(order);
    }
}

@Service
public class AuditService {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void log(String action, Long entityId) {
        auditRepo.save(new AuditEntry(action, entityId, Instant.now()));
    }
}
```

### Self-invocation и транзакции

Та же проблема что и с любым AOP: вызов через `this` обходит прокси.

```java
@Service
public class UserService {
    @Transactional
    public void registerUser(User user) {
        userRepo.save(user);
        sendWelcomeEmail(user); // self-invocation! @Transactional игнорируется
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW) // это НЕ сработает при self-invocation
    public void sendWelcomeEmail(User user) {
        // Выполнится в транзакции registerUser, не в новой
        emailLogRepo.save(new EmailLog(user.getEmail()));
    }
}
```

---

## N+1 проблема

Это, пожалуй, самая частая проблема производительности в JPA-приложениях. Если загрузить коллекцию сущностей, и у каждой есть LAZY-связь, то при обращении к этой связи Hibernate делает отдельный SELECT на каждую сущность.

```java
// 1 запрос:   SELECT * FROM users  → 100 пользователей
// 100 запросов: SELECT * FROM departments WHERE id = ? (для каждого user.getDepartment())
// Итого: 101 запрос вместо 1!

List<User> users = repo.findAll();
for (User user : users) {
    System.out.println(user.getDepartment().getName()); // lazy-загрузка для каждого!
}
```

**Решение 1: JOIN FETCH** — лучше всего когда связь одна и нет пагинации:

```java
@Query("SELECT u FROM User u JOIN FETCH u.department")
List<User> findAllWithDepartment();
// SQL: SELECT u.*, d.* FROM users u JOIN departments d ON u.department_id = d.id
// Один запрос — все данные
```

Проблема с JOIN FETCH + `@OneToMany` + Pageable: Hibernate не может сделать LIMIT на уровне SQL когда JOIN умножает строки. Он загружает всё в память, потом делает пагинацию в Java — `HibernateJpaDialect: HHH90003004` предупреждение.

**Решение 2: @EntityGraph** — декларативный JOIN FETCH:

```java
@EntityGraph(attributePaths = {"department", "orders"})
List<User> findByActiveTrue();
// Эквивалентно JOIN FETCH department, orders — один запрос
```

**Решение 3: @BatchSize** — загружает lazy-связи пачками через IN (...):

```java
@Entity
public class User {
    @OneToMany(mappedBy = "user")
    @BatchSize(size = 30) // вместо N запросов по одному → ceil(N/30) запросов
    private List<Order> orders;
}
// При доступе к orders для 100 пользователей: 4 запроса вместо 100
// SELECT * FROM orders WHERE user_id IN (1, 2, 3, ..., 30)
// SELECT * FROM orders WHERE user_id IN (31, 32, ..., 60)
// ...
```

**Решение 4: DTO Projection** — самый эффективный, выбирает только нужные поля:

```java
@Query("""
    SELECT new by.pavel.dto.UserDepartmentDto(u.id, u.email, d.name)
    FROM User u JOIN u.department d
    WHERE u.active = true
    """)
List<UserDepartmentDto> findActiveUserDtos();
// SELECT u.id, u.email, d.name FROM users u JOIN departments d ON ... WHERE u.active = true
// Нет оверхеда entity-маппинга, нет lazy-загрузки, минимум данных
```

---

## Hibernate Caching: три уровня кэша

### L1 Cache (First Level Cache)

Всегда включён, неотключаем. Область действия — одна `Session` (в Spring = одна транзакция, т.к. `@Transactional` открывает Session и закрывает вместе с транзакцией).

L1 — это **identity map**: гарантирует, что внутри одной сессии один и тот же id возвращает один и тот же Java-объект. Это не просто оптимизация — это корректность: два вызова `findById(1)` должны дать тот же объект, иначе изменение одного не отражается в другом.

```java
@Transactional
public void demonstrate() {
    User u1 = repo.findById(1L).orElseThrow(); // SELECT users WHERE id=1
    User u2 = repo.findById(1L).orElseThrow(); // из L1 — SQL НЕ выполняется

    assertSame(u1, u2);    // true — буквально один объект в памяти

    u1.setEmail("new@example.com");
    // u2.getEmail() тоже "new@example.com" — тот же объект!
}
// После закрытия транзакции L1 очищается
```

L1 очищается вручную при необходимости:
```java
entityManager.clear();      // очистить всю сессию (все объекты становятся detached)
entityManager.detach(user); // detach конкретный объект
entityManager.flush();      // синхронизировать с БД (без commit)
```

### L2 Cache (Second Level Cache)

Разделяется между всеми сессиями (транзакциями) одного приложения. Переживает закрытие транзакции. Это реальное кэширование данных между запросами.

Зачем нужен: если одна и та же сущность читается тысячи раз в секунду (справочник валют, категории, настройки) — каждый раз ходить в БД расточительно.

Почему не включён по умолчанию: нужен внешний провайдер (EHCache, Caffeine, Redis), требует правильной настройки стратегии инвалидации, иначе можно получить stale данные. Это решение с трейдоффами, не серебряная пуля.

```properties
spring.jpa.properties.hibernate.cache.use_second_level_cache=true
spring.jpa.properties.hibernate.cache.region.factory_class=org.hibernate.cache.jcache.JCacheRegionFactory
```

```java
@Entity
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
// Без @Cache — Hibernate игнорирует сущность для L2 даже если L2 включён
public class Currency {
    @Id private String code;
    private String name;
    private BigDecimal usdRate;
}
```

**CacheConcurrencyStrategy — выбор в зависимости от частоты записи:**

- `READ_ONLY` — для данных, которые никогда не изменяются после создания (справочники, константы). Самый быстрый — нет overhead на синхронизацию.
- `NONSTRICT_READ_WRITE` — обновляет кэш после commit, но без локировки. Между окончанием транзакции и обновлением кэша возможно краткое окно stale-данных. Для данных, где небольшая задержка актуальности допустима.
- `READ_WRITE` — использует "soft lock": при начале update помечает кэш как locked, другие транзакции получают данные из БД. После commit — обновляет кэш. Консистентно, но медленнее.
- `TRANSACTIONAL` — полная транзакционная гарантия, требует JTA. Используется редко.

```java
// Как Hibernate использует L2:
// При findById():
// 1. Проверить L1 (Session cache) → если есть, вернуть
// 2. Проверить L2 (SessionFactory cache) → если есть, создать managed объект и вернуть
// 3. SQL запрос → результат кладётся в L1 и L2
```

**Инвалидация L2 происходит автоматически** при операциях через EntityManager:
```java
repo.save(currency);    // Hibernate инвалидирует кэш для currency.id
repo.delete(currency);  // то же
repo.saveAll(list);     // инвалидирует все затронутые

// Ручная инвалидация (например, внешнее изменение БД):
Cache cache = entityManagerFactory.getCache();
cache.evict(Currency.class, "USD"); // конкретная запись
cache.evictAll();                   // весь L2
```

**Распределённый L2** — для нескольких инстансов приложения нужна распределённая реализация (Hazelcast, Infinispan, Redis через Hibernate JCache), иначе каждый инстанс имеет свой независимый кэш.

### Query Cache

Кэширует не сами объекты, а **список идентификаторов** результата запроса. Фактические объекты берутся из L2 по этим ID. Поэтому Query Cache без L2 бесполезен — придётся всё равно загружать сущности из БД.

```java
@Query("SELECT c FROM Currency c WHERE c.region = :region")
@QueryHints(@QueryHint(name = "org.hibernate.cacheable", value = "true"))
List<Currency> findByRegion(@Param("region") String region);

// Первый вызов findByRegion("EU"):
// → SQL: SELECT id FROM currency WHERE region='EU' → [1, 2, 5]
// → Ключ в Query Cache: (запрос, параметры) → [1, 2, 5]
// → Для каждого ID: L2 hit или SQL

// Второй вызов findByRegion("EU"):
// → Query Cache hit: [1, 2, 5]
// → Для каждого ID: L2 hit (если включён)
// → Ни одного SQL запроса!
```

**Критическая особенность:** Query Cache инвалидируется при **любом** DML в связанных таблицах, даже если изменённые строки не входят в результат запроса. Если таблица `currency` часто обновляется, Query Cache будет постоянно инвалидироваться и давать минимальный эффект при большом overhead.

| | L1 | L2 | Query Cache |
|---|---|---|---|
| Включён по умолчанию | ✅ всегда | ❌ нужна настройка | ❌ нужна настройка |
| Область | Одна транзакция | Всё приложение | Всё приложение |
| Что хранит | Managed объекты | Состояние сущностей (не объекты JVM) | Список ID результата запроса |
| Инвалидация | При закрытии сессии | При update/delete сущности | При любом DML в таблице |
| Thread-safe | Нет (один поток) | Да (все транзакции) | Да |
| Distributed | Нет | Да (с Hazelcast/Redis) | Да |

---

## Optimistic vs Pessimistic Locking

Проблема: два пользователя одновременно читают данные и оба хотят записать изменения. Чья запись "победит"?

**Optimistic Locking** — оптимистично предполагает, что конфликтов будет мало. Не блокирует БД при чтении. Конфликт обнаруживается при записи.

```java
@Entity
public class Account {
    @Id Long id;
    BigDecimal balance;

    @Version
    Long version; // Hibernate управляет автоматически
}

// Транзакция 1:
Account acc = repo.findById(1L).get(); // version=5, balance=1000
acc.setBalance(acc.getBalance().subtract(new BigDecimal("100")));
repo.save(acc);
// SQL: UPDATE accounts SET balance=900, version=6 WHERE id=1 AND version=5
// Если между чтением и записью кто-то изменил запись → version стал 6 → WHERE version=5 не найдёт строку
// → 0 строк обновлено → Hibernate бросает OptimisticLockException

// Обработка конфликта:
@Retryable(retryFor = OptimisticLockException.class, maxAttempts = 3)
@Transactional
public void transfer(Long accountId, BigDecimal amount) {
    Account acc = repo.findById(accountId).orElseThrow();
    acc.setBalance(acc.getBalance().subtract(amount));
    // если OptimisticLockException → @Retryable повторит метод
}
```

**Pessimistic Locking** — пессимистично ожидает конфликты. Блокирует запись в БД при чтении.

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT a FROM Account a WHERE a.id = :id")
Optional<Account> findByIdForUpdate(@Param("id") Long id);
// SQL: SELECT * FROM accounts WHERE id=? FOR UPDATE
// Другие транзакции будут ждать пока блокировка не снята (commit/rollback)

// Pessimistic WRITE — блокирует от чтения и записи
// Pessimistic READ — блокирует от записи, другие могут читать (SELECT ... FOR SHARE)
```

**Когда что использовать:**
- Optimistic — высокий параллелизм, конфликты редки (большинство случаев). Нет блокировок → нет deadlocks → выше throughput.
- Pessimistic — высокая вероятность конфликта (финансовые операции, очереди задач, инвентарь с ограниченным количеством). Гарантирует консистентность, но снижает параллелизм.

---

## Projections: загружать только нужное

Entity — "тяжёлый" объект: загружает все колонки, держит в persistence context, участвует в dirty checking. Для read-only операций часто эффективнее использовать проекции.

```java
// Interface-based: Spring Data JPA генерирует прокси
public interface UserSummary {
    Long getId();
    String getEmail();
    // Вложенные проекции:
    DepartmentInfo getDepartment();

    interface DepartmentInfo {
        String getName();
    }
}
// SQL: SELECT u.id, u.email, d.name FROM users u JOIN departments d ON ...
// Ни одна колонка лишняя не загружается

List<UserSummary> findByActiveTrue();

// Class-based (DTO) — явно, работает с @Query
public record UserDto(Long id, String email, String departmentName) {}

@Query("SELECT new by.pavel.dto.UserDto(u.id, u.email, d.name) FROM User u JOIN u.department d")
List<UserDto> findUserDtos();
// Быстрее interface-based: нет прокси-объектов, обычные record-инстансы
```

> **Транзакции, ACID, MVCC** — теория уровня БД в [`modules/system-design/theory/database_transactions.md`](../../system-design/theory/database_transactions.md)

---

## Источники

**Спецификации / документация:**
- [Spring Data JPA Reference](https://docs.spring.io/spring-data/jpa/reference/jpa.html) — derived queries, `@Query`, projections, `Specification`.
- [Hibernate ORM 6 User Guide](https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html) — fetching strategies, caching, batching.
- [Jakarta Persistence 3.1 Specification (JPA)](https://jakarta.ee/specifications/persistence/3.1/) — стандарт, реализуемый Hibernate.

**Books:**
- *High-Performance Java Persistence* (Vlad Mihalcea, 2016) — самый практичный справочник по JPA/Hibernate, отдельные главы про N+1, batching, locking, caching.
- *Java Persistence with Spring Data and Hibernate* (Cătălin Tudose, Manning 2023) — современная редакция Mihalcea-style контента под Spring Boot 3.

**Engineering blogs (must-read):**
- [Vlad Mihalcea — «The best way to handle the LazyInitializationException»](https://vladmihalcea.com/the-best-way-to-handle-the-lazyinitializationexception/) и связанные посты по N+1, fetch-стратегиям.
- [Vlad Mihalcea — «The hidden cost of OSIV (open-session-in-view)»](https://vladmihalcea.com/the-open-session-in-view-anti-pattern/) — почему `spring.jpa.open-in-view=false` нужно ставить **сразу** в любом новом проекте: реальные кейсы DB-connection exhaustion на проде описаны там.
- [Thorben Janssen — Hibernate Tips](https://thorben-janssen.com/hibernate-tips/) — короткие задачи-решения по типичным граблям.
- [Vlad Mihalcea — «Hibernate `@BatchSize` vs default_batch_fetch_size»](https://vladmihalcea.com/how-to-batch-insert-and-update-statements-with-hibernate/) — практические замеры.

**Tooling:**
- [Hypersistence Optimizer](https://vladmihalcea.com/hypersistence-optimizer/) — статический анализатор JPA-конфигов на наличие N+1, неправильных Cascade, неправильных коллекций.
- [datasource-proxy](https://github.com/jdbc-observations/datasource-proxy) — runtime-обёртка `DataSource` для логирования и assert'ов количества SQL в тестах.
