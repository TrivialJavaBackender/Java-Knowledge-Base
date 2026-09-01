# Spring Data JPA и Hibernate

## 1. Стек технологий: что над чем

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

## 2. JPA Entity и Persistence Context

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

## 3. FetchType: EAGER vs LAZY и когда это важно

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

## 4. Spring Data JPA Repository

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

## 5. @Transactional — транзакционный менеджмент

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

## 6. N+1 проблема (в Spring Data)

N+1 — самая частая проблема производительности в JPA-приложениях. Полная механика Hibernate (proxy, `JOIN FETCH`, `@EntityGraph`, `@BatchSize`, `@Fetch(SUBSELECT)`, способы обнаружения) разобрана в модуле hibernate-jpa: [`../../hibernate-jpa/theory/FETCHING_NPLUS1.md`](../../hibernate-jpa/theory/FETCHING_NPLUS1.md). Каноническая теория N+1 (почему ORM не решает её автоматически) — в [`../../databases/theory/DATABASE_TYPES.md`](../../databases/theory/DATABASE_TYPES.md).

В контексте именно Spring Data JPA важны два декларативных инструмента прямо на методе репозитория:

```java
// @EntityGraph — декларативный JOIN FETCH на методе репозитория
@EntityGraph(attributePaths = {"department", "orders"})
List<User> findByActiveTrue();

// JOIN FETCH в @Query
@Query("SELECT u FROM User u JOIN FETCH u.department")
List<User> findAllWithDepartment();

// DTO-проекция — выбрать только нужные колонки, без оверхеда сущностей
@Query("SELECT new by.pavel.dto.UserDto(u.id, u.email, d.name) FROM User u JOIN u.department d")
List<UserDto> findUserDtos();
```

> ⚠️ `JOIN FETCH` / `@EntityGraph` коллекции (`@OneToMany`) несовместимы с `Pageable`: Hibernate загружает всё в память и пагинирует в Java (предупреждение `HHH90003004`). Корректный паттерн — два запроса (сначала id с пагинацией, затем fetch) — см. [`../../hibernate-jpa/theory/FETCHING_NPLUS1.md`](../../hibernate-jpa/theory/FETCHING_NPLUS1.md).

---

## 7. Hibernate Caching

Hibernate имеет три уровня кэша — L1 (persistence context, область = сессия/транзакция), L2 (shared, на уровне `SessionFactory`) и Query Cache. Глубокий разбор — уровни кэша, провайдеры (EhCache/Caffeine/Infinispan/Redis), cache concurrency strategies (`READ_ONLY` / `NONSTRICT_READ_WRITE` / `READ_WRITE` / `TRANSACTIONAL`), инвалидация и подводные камни — вынесен в модуль hibernate-jpa: [`../../hibernate-jpa/theory/CACHING.md`](../../hibernate-jpa/theory/CACHING.md).

> ⚠️ Не путать с **Spring Cache abstraction** (`@Cacheable` / `@CacheEvict` + `CacheManager`): это отдельный механизм уровня приложения, который кэширует результаты вызовов методов бинов, а не сущности Hibernate. Spring `@Cacheable` не знает про persistence context и не инвалидируется при изменении сущности через `EntityManager`.

---

## 8. Optimistic vs Pessimistic Locking

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

## 9. Projections: загружать только нужное

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
