# Spring Core: DI, IoC и AOP

## Почему появился Spring

В ранние 2000-е написать Enterprise Java-приложение означало писать EJB (Enterprise JavaBeans). EJB требовал тяжёлого контейнера (JBoss, WebSphere), бойлерплейта из десятков XML-файлов, и классы жёстко зависели от EJB-интерфейсов. Тестирование было почти невозможно — нельзя запустить один класс без всего сервера.

Род Джонсон в книге «Expert One-on-One J2EE Design and Development» (2002) показал, что большинство Enterprise-задач можно решить обычными Java-объектами (POJO) плюс умным контейнером. Так появился Spring.

Главная идея: **объект не должен знать, откуда берутся его зависимости**. Он просто объявляет, что ему нужно — контейнер сам создаёт и предоставляет.

---

## IoC (Inversion of Control)

**Инверсия управления** — это принцип, а не технология. Суть: управление жизненным циклом объектов и их связями отдаётся внешней системе (контейнеру).

В обычном коде ты сам решаешь, когда создавать объекты и какие реализации использовать:

```java
// Без IoC: жёсткий контроль в руках разработчика
class OrderService {
    private PaymentService payment = new StripePaymentService(); // жёсткая привязка
    private OrderRepository repo   = new MySQLOrderRepository(); // нельзя заменить без правки кода
}
```

Проблемы очевидны при тестировании: чтобы протестировать `OrderService`, ты неизбежно поднимаешь MySQL. Если хочешь использовать другую платёжную систему — меняешь код `OrderService`.

С IoC контейнер решает, что создавать и что куда передавать. Это Hollywood Principle: "Don't call us, we'll call you" — ты не создаёшь зависимости, контейнер сам их внедряет.

**DI (Dependency Injection)** — конкретный механизм реализации IoC. Зависимости передаются объекту снаружи (через конструктор, setter, или поле).

---

## Три способа внедрения и почему конструктор лучше

```java
// ✅ Constructor Injection — единственный рекомендуемый способ
@Service
public class OrderService {
    private final PaymentService payment;
    private final OrderRepository repo;

    // Spring автоматически вызывает этот конструктор.
    // @Autowired не нужен, если конструктор один.
    public OrderService(PaymentService payment, OrderRepository repo) {
        this.payment = payment;
        this.repo = repo;
    }
}

// ⚠️ Setter Injection — только для опциональных зависимостей
@Service
public class NotificationService {
    private EmailService email;

    @Autowired(required = false) // внедряется если бин существует
    public void setEmailService(EmailService email) {
        this.email = email;
    }
}

// ❌ Field Injection — удобно, но плохо
@Service
public class UserService {
    @Autowired
    private UserRepository repo; // Spring подставляет рефлексией
}
```

**Почему field injection — плохо:**
- Поле не может быть `final` — объект мутабелен, возможен NPE
- Невозможно создать объект без Spring: `new UserService()` — `repo` будет null
- Зависимости скрыты внутри — не видны из API класса
- Нельзя легко протестировать: нужен либо Spring Context, либо Reflection

**Почему constructor injection — хорошо:**
- Поля `final` — объект иммутабелен с момента создания, нет NPE
- Все зависимости явно в сигнатуре конструктора — сразу видно, что нужно классу
- Тест без Spring: `new OrderService(mock(PaymentService.class), mock(OrderRepository.class))`
- Если конструктор принимает 7 параметров — это сигнал о нарушении SRP. Field injection скрывает эту проблему

---

## ApplicationContext — контейнер Spring

`ApplicationContext` — сердце Spring. Он хранит все бины, управляет их жизненным циклом и предоставляет их по запросу.

```java
// Spring Boot создаёт ApplicationContext автоматически при запуске
@SpringBootApplication
public class App {
    public static void main(String[] args) {
        ApplicationContext ctx = SpringApplication.run(App.class, args);
        // Можно получить бин напрямую, но так делают только в тестах или main():
        OrderService service = ctx.getBean(OrderService.class);
    }
}
```

**Типы ApplicationContext:**
- `AnnotationConfigApplicationContext` — для plain Java (без Spring Boot)
- `AnnotationConfigServletWebServerApplicationContext` — для Spring Boot Web
- `AnnotationConfigReactiveWebServerApplicationContext` — для Reactive

### Как Spring находит бины

При старте Spring сканирует classpath (начиная с пакета `@SpringBootApplication`) и регистрирует классы с аннотациями:

```java
@Component    // общий маркер — "я управляюсь Spring"
@Service      // то же самое, семантический alias для сервисного слоя
@Repository   // то же + exception translation (SQLException → DataAccessException)
@Controller   // то же + возможность обрабатывать HTTP
@RestController // @Controller + @ResponseBody (каждый метод возвращает тело, не view)
```

Все четыре (кроме @RestController) — это по сути синонимы `@Component`. Разница только семантическая и в дополнительной обработке (для `@Repository` Spring оборачивает исключения).

```java
// Программная регистрация через @Configuration + @Bean
@Configuration
public class InfrastructureConfig {
    @Bean
    public ObjectMapper objectMapper() {
        // Используется когда нужна нетривиальная инициализация
        // или когда класс из сторонней библиотеки (нельзя добавить @Component)
        return JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .build();
    }
}
```

### Когда несколько реализаций одного интерфейса

Если в контексте несколько бинов одного типа, Spring не знает, какой внедрить — бросит `NoUniqueBeanDefinitionException`. Решение:

```java
interface NotificationService { void send(String message); }

@Service("email")
class EmailNotificationService implements NotificationService { ... }

@Service("sms")
class SmsNotificationService implements NotificationService { ... }

// Вариант 1: @Primary — этот бин выбирается по умолчанию
@Primary
@Service("email")
class EmailNotificationService implements NotificationService { ... }

// Вариант 2: @Qualifier — явно указать имя
@Service
public class ReportService {
    public ReportService(@Qualifier("sms") NotificationService notifier) { ... }
}

// Вариант 3: внедрить все реализации сразу
@Service
public class NotificationDispatcher {
    public NotificationDispatcher(List<NotificationService> allServices) {
        // Spring инжектирует все бины типа NotificationService
    }

    // Или как Map<name, bean>:
    public NotificationDispatcher(Map<String, NotificationService> services) {
        // ключ — имя бина (@Component("email") / метод @Bean)
    }
}
```

---

## Bean Scopes — область жизни бина

Scope определяет, сколько экземпляров бина существует одновременно.

**Singleton** (дефолт) — один экземпляр на весь ApplicationContext. Это не GoF Singleton (private constructor), это управляемый контейнером singleton. Безопасен при многопоточности только если **stateless**: не хранит mutable состояние в полях.

```java
// ✅ Безопасный singleton — нет изменяемого состояния
@Service
public class PriceCalculator {
    // Все зависимости тоже stateless → race condition невозможен
    public BigDecimal calculate(Order order) {
        return order.getQuantity().multiply(order.getUnitPrice());
    }
}

// ❌ Опасный singleton — mutable поле разделяется между потоками
@Service
public class CounterService {
    private int count = 0; // BUG: всё приложение делит этот счётчик!
    public void increment() { count++; } // race condition
}
```

**Prototype** — новый экземпляр при каждом `getBean()` или внедрении. Нужен для stateful объектов.

```java
// Prototype в singleton — ловушка!
@Service // singleton
public class ReportService {
    @Autowired
    private ReportGenerator generator; // внедряется один раз при создании ReportService
    // generator никогда не меняется — смысл prototype теряется!
}

// Правильное решение: ObjectFactory или ApplicationContext.getBean()
@Service
public class ReportService {
    private final ObjectFactory<ReportGenerator> generatorFactory;

    public void generateReport() {
        ReportGenerator generator = generatorFactory.getObject(); // новый каждый раз
        generator.generate();
    }
}
```

**Request / Session / Application** — только в Web-контексте. `Request` живёт один HTTP-запрос, `Session` — одну пользовательскую сессию.

---

## Bean Lifecycle — жизненный цикл бина

Понимание lifecycle важно для инициализации соединений, валидации конфигурации и освобождения ресурсов.

```
1. Instantiate          — Spring вызывает конструктор
2. Populate Properties  — внедряет зависимости (DI)
3. *Aware интерфейсы    — Spring передаёт ссылки на себя (BeanNameAware, ApplicationContextAware)
4. BeanPostProcessor#postProcessBeforeInitialization
5. @PostConstruct       — твой код инициализации
6. InitializingBean#afterPropertiesSet
7. @Bean(initMethod)    — кастомный init-метод
8. BeanPostProcessor#postProcessAfterInitialization  ← здесь создаются AOP-прокси!
9. [Bean готов к использованию]
10. @PreDestroy          — твой код очистки при shutdown
11. DisposableBean#destroy
```

```java
@Component
public class DatabaseConnectionPool {

    private Connection masterConnection;

    // Вызывается после того, как все зависимости уже внедрены.
    // Правильное место для инициализации, требующей зависимостей.
    @PostConstruct
    public void init() {
        masterConnection = createConnection(); // можно использовать @Autowired поля
        log.info("Connection pool initialized");
    }

    // Вызывается при graceful shutdown приложения (SIGTERM).
    // Правильное место для освобождения ресурсов.
    @PreDestroy
    public void cleanup() {
        masterConnection.close();
        log.info("Connection pool closed");
    }
}
```

**BeanPostProcessor** — мощный механизм для модификации всех бинов при создании. Spring сам использует его для создания AOP-прокси (после шага 8), внедрения `@Autowired` и `@Value`.

---

## AOP — Aspect-Oriented Programming

AOP решает проблему cross-cutting concerns: логика, которая нужна во многих местах (логирование, транзакции, безопасность, кэширование), но не относится к бизнес-логике.

Без AOP эта логика размазана по всему коду:
```java
// Без AOP — дублирование везде
public void placeOrder(Order order) {
    log.info("placeOrder called"); // логирование
    checkPermission("ORDER_WRITE"); // безопасность
    Transaction tx = db.beginTransaction(); // транзакция
    try {
        repo.save(order);
        tx.commit();
    } catch (Exception e) {
        tx.rollback();
        throw e;
    }
    log.info("placeOrder done"); // логирование
}
```

С AOP бизнес-метод содержит только бизнес-логику, всё остальное — в аспектах.

### Как работает AOP изнутри: прокси

Spring AOP работает через **прокси-объекты**. Когда ты запрашиваешь бин с `@Transactional` или `@Cacheable`, Spring возвращает не оригинальный объект, а прокси, который обёртывает его.

```
Вызов: orderService.placeOrder(order)

[Вызывающий код]
      ↓
[OrderService Proxy] ← это то, что Spring вернул из контекста
  - начать транзакцию (@Transactional)
  - проверить кэш (@Cacheable)
      ↓
[Реальный OrderService]  ← вызывается внутри прокси
  - repo.save(order)
      ↑
  - commit / rollback
```

**Два вида прокси:**

1. **JDK Proxy** — работает через интерфейс. Если бин реализует интерфейс, Spring создаёт прокси-объект этого интерфейса. Быстро создаётся, требует интерфейса.

2. **CGLIB Proxy** — генерирует подкласс бина байткодом. Используется когда у класса нет интерфейса (или включён `proxyTargetClass=true`). В Spring Boot — используется по умолчанию для всего.

```java
// Проверить, что реально возвращается из контекста:
OrderService service = ctx.getBean(OrderService.class);
System.out.println(service.getClass());
// Вывод: class by.pavel.OrderService$$SpringCGLIB$$0 — это прокси!
```

### Критическая ловушка: self-invocation

Если метод с аспектом вызывается из того же класса (`this.method()`), прокси **обходится**. Вызов идёт напрямую на реальный объект, минуя прокси со всеми его аспектами.

```java
@Service
public class OrderService {

    @Transactional
    public void createOrder(Order order) {
        repo.save(order);
        this.notifyUser(order); // ← ПРОБЛЕМА! Вызов через this, не через прокси
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyUser(Order order) {
        // Эта аннотация ИГНОРИРУЕТСЯ при self-invocation!
        // notifyUser выполнится в контексте транзакции createOrder, не в новой
        notificationRepo.save(new Notification(order));
    }
}
```

**Решения:**
1. Вынести `notifyUser` в отдельный бин — самое чистое
2. `@Lazy` авто-внедрение себя: `@Autowired @Lazy OrderService self;` и вызов `self.notifyUser(...)` — работает, но выглядит странно
3. `AopContext.currentProxy()` — явно получить прокси (нужно включить exposeProxy)

### AOP терминология

```java
@Aspect
@Component
public class PerformanceAspect {

    // Pointcut — выражение, которое описывает ГДЕ применять аспект
    // execution(* by.pavel.service.*.*(..)) = любой метод любого класса в пакете service
    @Pointcut("execution(* by.pavel.service.*.*(..))")
    public void serviceLayer() {}

    // Around Advice — самый мощный: полный контроль до и после вызова
    // Может изменить аргументы, результат, подавить исключение
    @Around("serviceLayer()")
    public Object measure(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            Object result = pjp.proceed(); // вызов реального метода (обязателен!)
            return result;
        } finally {
            log.info("{} took {}ms", pjp.getSignature(), System.currentTimeMillis() - start);
        }
    }

    // Before Advice — выполняется до метода, не может предотвратить вызов
    @Before("serviceLayer()")
    public void logBefore(JoinPoint jp) {
        log.debug("Calling: {}", jp.getSignature());
    }

    // AfterReturning — только если метод вернул результат (без исключения)
    @AfterReturning(pointcut = "serviceLayer()", returning = "result")
    public void logResult(Object result) {
        log.debug("Returned: {}", result);
    }

    // AfterThrowing — только если метод бросил исключение
    @AfterThrowing(pointcut = "serviceLayer()", throwing = "ex")
    public void logException(Exception ex) {
        log.error("Exception in service: {}", ex.getMessage());
    }

    // After (finally) — всегда, и при успехе, и при ошибке
    @After("serviceLayer()")
    public void always(JoinPoint jp) { ... }
}
```

**Встроенные аспекты Spring:**
- `@Transactional` → `TransactionInterceptor`
- `@Cacheable` / `@CacheEvict` → `CacheInterceptor`
- `@Async` → `AsyncExecutionInterceptor`
- `@PreAuthorize` → `MethodSecurityInterceptor`

Все они работают через один и тот же механизм прокси.

---

## GoF паттерны в Spring

### Factory

Spring сам является реализацией паттерна Factory. `ApplicationContext` — фабрика бинов. `BeanFactory` — более низкоуровневый интерфейс (не создаёт бины до первого запроса, в отличие от ApplicationContext).

```java
// FactoryBean — для бинов со сложной инициализацией
// или когда тип создаваемого объекта != тип FactoryBean
@Component
public class DataSourceFactoryBean implements FactoryBean<DataSource> {

    @Override
    public DataSource getObject() {
        // Сложная инициализация: чтение конфига, проверка соединения, пул
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(readFromVault("db/url"));
        config.setPassword(readFromVault("db/password"));
        return new HikariDataSource(config);
    }

    @Override
    public Class<?> getObjectType() { return DataSource.class; }

    @Override
    public boolean isSingleton() { return true; } // создать один раз
}
// В контексте будет бин типа DataSource, а не DataSourceFactoryBean
```

### Proxy и Decorator

Spring различает эти паттерны, хотя оба добавляют поведение вокруг объекта:

- **Proxy** — создаётся Spring автоматически (AOP), клиент не знает о прокси
- **Decorator** — явно определяется разработчиком, добавляет поведение сохраняя интерфейс

```java
// Decorator: кэширующий репозиторий поверх основного
@Primary  // @Primary говорит Spring: внедряй этот бин вместо оригинала
@Component
public class CachingUserRepository implements UserRepository {

    private final UserRepository delegate;
    private final Map<Long, User> cache = new ConcurrentHashMap<>();

    // Spring сам внедрит реальный UserRepository (без @Primary),
    // несмотря на то что CachingUserRepository тоже реализует UserRepository.
    // Это работает потому что @Primary приоритетнее при разрешении зависимостей.
    public CachingUserRepository(@Qualifier("jpaUserRepository") UserRepository delegate) {
        this.delegate = delegate;
    }

    @Override
    public Optional<User> findById(Long id) {
        return Optional.ofNullable(
            cache.computeIfAbsent(id, k -> delegate.findById(k).orElse(null))
        );
    }
}
```

### Template Method

`JdbcTemplate`, `RestTemplate`, `KafkaTemplate` — классическая реализация Template Method. Шаблонный класс скрывает алгоритм (открыть соединение, выполнить запрос, обработать результат, закрыть), оставляя точки расширения (как маппить строки).

```java
// Без JdbcTemplate — каждый раз одно и то же:
Connection conn = dataSource.getConnection();
try {
    PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE active = ?");
    ps.setBoolean(1, true);
    ResultSet rs = ps.executeQuery();
    List<User> users = new ArrayList<>();
    while (rs.next()) {
        users.add(new User(rs.getLong("id"), rs.getString("name")));
    }
    return users;
} catch (SQLException e) {
    throw new RuntimeException(e);
} finally {
    conn.close(); // легко забыть
}

// С JdbcTemplate — только суть:
return jdbcTemplate.query(
    "SELECT * FROM users WHERE active = ?",
    (rs, rowNum) -> new User(rs.getLong("id"), rs.getString("name")), // точка расширения
    true
);
```

### Observer

Spring Events позволяют компонентам общаться без прямой зависимости. Это важно для декаплинга: `OrderService` не должен знать о `NotificationService`.

```java
// Событие — обычный объект (record, class, extends ApplicationEvent)
public record OrderPlacedEvent(Long orderId, String customerEmail) {}

@Service
public class OrderService {
    private final ApplicationEventPublisher publisher;

    @Transactional
    public void placeOrder(Order order) {
        orderRepo.save(order);
        // Публикует событие — синхронно внутри той же транзакции.
        // Слушатели с @EventListener выполнятся тут же.
        // Слушатели с @TransactionalEventListener — только после commit.
        publisher.publishEvent(new OrderPlacedEvent(order.getId(), order.getCustomerEmail()));
    }
}

@Component
public class NotificationHandler {

    // AFTER_COMMIT: выполнится только если транзакция успешно закоммичена.
    // Это важно: нет смысла слать email если заказ не сохранился в БД.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderPlaced(OrderPlacedEvent event) {
        emailService.sendConfirmation(event.customerEmail());
    }

    // @Async + @EventListener = асинхронный обработчик в отдельном потоке
    @Async
    @EventListener
    public void syncToAnalytics(OrderPlacedEvent event) {
        analyticsService.track(event.orderId());
    }
}
```

### Strategy

Spring делает Strategy Pattern естественным: несколько реализаций одного интерфейса, выбор в рантайме.

```java
interface PaymentGateway {
    PaymentResult process(PaymentRequest request);
    String getName();
}

@Component class StripeGateway  implements PaymentGateway { ... }
@Component class PaypalGateway  implements PaymentGateway { ... }
@Component class ApplePayGateway implements PaymentGateway { ... }

@Service
public class PaymentService {
    // Spring автоматически собирает Map: имя бина → бин
    private final Map<String, PaymentGateway> gateways;

    public PaymentResult pay(String method, PaymentRequest request) {
        PaymentGateway gateway = gateways.get(method);
        if (gateway == null) {
            throw new UnsupportedPaymentMethodException(method);
        }
        return gateway.process(request);
    }
}
```

---

## Circular Dependencies — круговые зависимости

Возникают когда A зависит от B, а B зависит от A.

```java
@Service class ServiceA {
    public ServiceA(ServiceB b) { ... }
}
@Service class ServiceB {
    public ServiceB(ServiceA a) { ... }
}
// Результат: BeanCurrentlyInCreationException при старте приложения
// Spring обнаруживает это до рантайма — это хорошо
```

Circular dependency почти всегда — симптом нарушения дизайна. Если A и B зависят друг от друга, скорее всего они делают слишком много, и часть логики надо вынести в C.

**Когда @Lazy помогает:**
```java
@Service class ServiceA {
    // @Lazy: Spring создаёт прокси вместо реального ServiceB при старте.
    // ServiceB создаётся лениво при первом обращении.
    public ServiceA(@Lazy ServiceB b) { ... }
}
```

Это решает техническую проблему, но не архитектурную. Используй только если действительно не можешь рефакторить.

---

## Источники

**Официальная документация:**
- [Spring Framework Reference — Core (IoC, DI, AOP)](https://docs.spring.io/spring-framework/reference/core.html) — каноническое описание `BeanFactory`, `ApplicationContext`, scopes, lifecycle, AOP.
- [Spring Framework — The IoC Container](https://docs.spring.io/spring-framework/reference/core/beans.html)
- [Spring Framework — Aspect Oriented Programming](https://docs.spring.io/spring-framework/reference/core/aop.html)

**Books:**
- *Spring in Action*, 6th ed. (Craig Walls, Manning 2022) — главы 1–4 по DI, Beans, AOP.
- [*Expert One-on-One J2EE Design and Development* (Rod Johnson, Wrox 2002)](https://www.amazon.com/Expert-One---One-Design-Development/dp/0764543857) — оригинал, из которого вырос Spring Framework.
- *Pro Spring 6* (Iuliana Cosmina et al., Apress 2023) — глубокий разбор Bean Lifecycle, BeanPostProcessor.

**Articles / talks:**
- [Martin Fowler — «Inversion of Control Containers and the Dependency Injection pattern» (2004)](https://martinfowler.com/articles/injection.html) — каноническая статья о терминологии IoC vs DI.
- [Phil Webb — «State of Spring Boot» (SpringOne)](https://springone.io/) — ежегодные обновления по эволюции container'а.
- [Baeldung — «Guide to Spring @Autowired» / «Spring Bean Scopes»](https://www.baeldung.com/spring-autowire) — практические примеры с edge-cases.

**Common pitfalls:**
- [«Why field injection is evil» (Olivier Croisier, 2014)](https://blog.marcnuri.com/field-injection-is-not-recommended) — оригинал популярного аргумента против `@Autowired` на полях.
- [«Self-invocation in Spring AOP» (Baeldung)](https://www.baeldung.com/spring-aop-self-invocation) — почему `this.method()` обходит прокси и как это лечить.
