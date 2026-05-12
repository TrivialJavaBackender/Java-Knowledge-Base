# Spring Boot: Auto-Configuration и Starters

## Зачем Spring Boot

До Spring Boot (до 2014 года) настройка Spring-приложения требовала:
- Десятки XML-файлов или Java-конфигов
- Ручное добавление совместимых версий библиотек (Jackson + Spring + Hibernate — все должны быть совместимы)
- Деплой WAR-файла в отдельный Tomcat/JBoss
- Ручная настройка DataSource, EntityManagerFactory, TransactionManager...

Spring Boot решает это тремя вещами:
1. **Starters** — управление совместимыми зависимостями
2. **Auto-Configuration** — умная конфигурация "из коробки"
3. **Embedded Server** — Tomcat встроен в JAR, не нужен внешний контейнер

Ключевая философия: **convention over configuration**. Spring Boot принимает разумные дефолтные решения, которые ты можешь переопределить. Не нужно конфигурировать то, что стандартно.

---

## Starters: управление зависимостями

Starter — это Maven/Gradle артефакт, который **не содержит кода** — только `pom.xml` с зависимостями. Он транзитивно подтягивает всё нужное для функции с проверенными совместимыми версиями.

```xml
<!-- Один starter вместо ~10 зависимостей -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Что Spring Boot автоматически подтягивает через `starter-web`:
- `spring-webmvc` — Spring MVC фреймворк
- `spring-core`, `spring-context`, `spring-beans` — ядро Spring
- `tomcat-embed-core` — встроенный Tomcat
- `jackson-databind` — JSON сериализация
- `hibernate-validator` — Bean Validation
- `spring-boot-starter` — базовый starter (logback, spring-boot)

**Важно:** версии всех этих зависимостей управляются через `spring-boot-starter-parent` (или BOM). Ты не указываешь версию Jackson или Hibernate — Spring Boot гарантирует совместимость. Это устраняет "dependency hell".

### Как starters отделены от конфигурации

Starters и auto-configuration — разные артефакты. Starter подтягивает classpath, auto-configuration реагирует на classpath:

```
spring-boot-starter-data-jpa
    ├── (зависимость) hibernate-core         ← classpath
    ├── (зависимость) spring-data-jpa        ← classpath
    └── (транзитивно) HikariCP               ← classpath

spring-boot-autoconfigure (отдельный jar)
    └── JpaRepositoriesAutoConfiguration    ← активируется ПОТОМУ ЧТО hibernate в classpath
        └── DataSourceAutoConfiguration     ← активируется ПОТОМУ ЧТО DataSource в classpath
```

### Основные стартеры

| Starter | Что делает |
|---------|-----------|
| `spring-boot-starter` | Ядро: logback, spring-core, spring-boot |
| `spring-boot-starter-web` | REST API: MVC, embedded Tomcat, Jackson |
| `spring-boot-starter-webflux` | Реактивный Web: Spring WebFlux, Netty |
| `spring-boot-starter-data-jpa` | JPA: Hibernate, Spring Data JPA, HikariCP |
| `spring-boot-starter-security` | Spring Security |
| `spring-boot-starter-oauth2-resource-server` | JWT валидация, OAuth2 |
| `spring-boot-starter-data-redis` | Spring Data Redis, Lettuce client |
| `spring-boot-starter-kafka` | Spring Kafka |
| `spring-boot-starter-actuator` | /actuator/health, metrics, env |
| `spring-boot-starter-validation` | @Valid, @NotBlank, Hibernate Validator |
| `spring-boot-starter-test` | JUnit 5, Mockito, AssertJ, MockMvc |
| `spring-boot-starter-aop` | AspectJ для кастомных аспектов |

---

## Auto-Configuration: как это работает

### @SpringBootApplication

```java
@SpringBootApplication
public class App {
    public static void main(String[] args) {
        SpringApplication.run(App.class, args);
    }
}
```

`@SpringBootApplication` — это мета-аннотация, равная трём:

```java
@SpringBootConfiguration   // = @Configuration — это Java-конфигурация Spring
@EnableAutoConfiguration   // включает механизм авто-конфигурации
@ComponentScan             // сканирует пакет этого класса и вложенные
```

### Механизм загрузки авто-конфигурации

`@EnableAutoConfiguration` заставляет Spring Boot при старте:
1. Найти все jar в classpath
2. В каждом проверить наличие `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`
3. Загрузить все классы из этого файла как потенциальные конфигурации
4. Применить только те, условия которых выполнены

```
# Файл в spring-boot-autoconfigure.jar:
# META-INF/spring/.../AutoConfiguration.imports
org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration
org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration
org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration
...  # 130+ конфигураций
```

Все 130+ конфигураций загружаются как кандидаты, но большинство отключается через `@Conditional`.

### @Conditional — условная конфигурация

Это ключевой механизм. Каждая авто-конфигурация применяется только если выполнены условия:

```java
@AutoConfiguration
@ConditionalOnClass(DataSource.class)          // DataSource есть в classpath (есть HikariCP/...)
@ConditionalOnMissingBean(DataSource.class)    // пользователь НЕ определил свой DataSource бин
@ConditionalOnProperty("spring.datasource.url") // свойство задано
public class DataSourceAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public DataSource dataSource(DataSourceProperties props) {
        return props.initializeDataSourceBuilder().build();
    }
}
```

**`@ConditionalOnMissingBean` — ключевой паттерн расширяемости.** Авто-конфигурация создаёт бин **только если ты не создал свой**. Это позволяет легко переопределить любое дефолтное поведение:

```java
// Своя настройка Jackson — авто-конфигурация увидит твой ObjectMapper
// и не создаст свой (ConditionalOnMissingBean выдаст false)
@Bean
public ObjectMapper objectMapper() {
    return JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .serializationInclusion(JsonInclude.Include.NON_NULL)
        .build();
}
```

| Аннотация | Смысл |
|-----------|-------|
| `@ConditionalOnClass(Foo.class)` | Класс `Foo` есть в classpath |
| `@ConditionalOnMissingClass("com.Foo")` | Класса нет в classpath |
| `@ConditionalOnBean(Foo.class)` | Бин типа `Foo` уже зарегистрирован |
| `@ConditionalOnMissingBean(Foo.class)` | Бин типа `Foo` ещё не зарегистрирован |
| `@ConditionalOnProperty("my.feature.enabled")` | Свойство задано (или равно matchIfMissing) |
| `@ConditionalOnWebApplication(type=SERVLET)` | Это Servlet Web (не Reactive) приложение |
| `@ConditionalOnExpression("${feature.flag:false}")` | SpEL выражение истинно |
| `@ConditionalOnResource("classpath:my-config.xml")` | Файл существует в classpath |

### Отладка: CONDITIONS EVALUATION REPORT

Когда что-то не работает как ожидается, включи:

```properties
debug=true
# или: java -jar app.jar --debug
```

Spring Boot выведет подробный отчёт:
```
============================
CONDITIONS EVALUATION REPORT
============================

Positive matches (авто-конфигурации, которые применились):
-----------------
   DataSourceAutoConfiguration matched:
      - @ConditionalOnClass found required class 'javax.sql.DataSource' (OnClassCondition)
      - @ConditionalOnMissingBean (types: javax.sql.DataSource) did not find any beans (OnBeanCondition)

Negative matches (не применились и почему):
-----------------
   MongoAutoConfiguration:
      Did not match:
         - @ConditionalOnClass did not find required class 'com.mongodb.MongoClient' (OnClassCondition)

   CassandraAutoConfiguration:
      Did not match:
         - @ConditionalOnClass did not find required class 'com.datastax.driver.core.Cluster'
```

Это первое место куда смотреть, если Spring не создал ожидаемый бин.

### Порядок авто-конфигураций

Некоторые конфигурации зависят от других (EntityManager зависит от DataSource):

```java
@AutoConfiguration(after = DataSourceAutoConfiguration.class)
// Гарантирует что DataSource создан раньше чем мы пытаемся создать EntityManager
public class HibernateJpaAutoConfiguration { ... }

@AutoConfiguration(before = SecurityAutoConfiguration.class)
public class MyCustomSecurityConfig { ... }
```

---

## Конфигурация приложения

### Источники конфигурации и их приоритет

Spring Boot поддерживает множество источников конфигурации. Приоритет от высшего к низшему:

```
1. Аргументы командной строки:    java -jar app.jar --server.port=9090
2. Системные переменные окружения: SERVER_PORT=9090 (с relaxed binding)
3. @TestPropertySource (только в тестах)
4. application-{profile}.properties (специфичные для профиля)
5. application.properties / application.yml (основной файл)
6. @PropertySource (явное указание файла)
7. Значения по умолчанию (@Value("${prop:defaultValue}"))
```

Высший приоритет всегда у ENV и args — это важно для контейнеров (Docker/K8s), где конфигурация передаётся через переменные окружения.

**Relaxed binding:** Spring Boot преобразует имена свойств автоматически. `spring.datasource.url`, `SPRING_DATASOURCE_URL`, `spring.datasource-url`, `spring.datasource_url` — всё одно и то же. Это критично для K8s, где ENV переменные в UPPER_CASE.

### Профили

Профиль — именованный набор конфигурации, активируемый при определённых условиях.

```
src/main/resources/
├── application.properties      # базовая конфигурация (всегда)
├── application-dev.properties  # дополняет/переопределяет для профиля dev
├── application-prod.properties # для prod
└── application-test.properties # для тестов
```

```properties
# application.properties
spring.application.name=order-service
server.port=8080
logging.level.root=INFO

# application-dev.properties
spring.datasource.url=jdbc:h2:mem:testdb
spring.h2.console.enabled=true
logging.level.by.pavel=DEBUG

# application-prod.properties
spring.datasource.url=jdbc:postgresql://${DB_HOST}:5432/orders
spring.jpa.show-sql=false
logging.level.by.pavel=WARN
```

```bash
# Активация профиля
java -jar app.jar --spring.profiles.active=prod
SPRING_PROFILES_ACTIVE=prod java -jar app.jar

# Несколько профилей (prod + EU локализация):
--spring.profiles.active=prod,eu
```

```java
// @Profile — бин создаётся только при активном профиле
@Configuration
@Profile("prod")
public class ProdSecurityConfig {
    @Bean
    public DataSource secureDataSource() { ... }
}

// В тестах:
@SpringBootTest
@ActiveProfiles("test")
class OrderServiceTest { ... }
```

### @ConfigurationProperties vs @Value

`@Value` — для одного свойства. Простой случай.

`@ConfigurationProperties` — для группы связанных свойств. Типобезопасно, поддерживает nested objects, Lists, Maps, валидацию.

```java
// Типобезопасная конфигурация с валидацией
@ConfigurationProperties(prefix = "app.payment")
@Validated // включает Bean Validation
public class PaymentProperties {

    @NotBlank
    private String apiKey;

    @Min(1)
    @Max(30)
    private int timeoutSeconds = 10; // значение по умолчанию

    private RetryConfig retry = new RetryConfig();

    @Data
    public static class RetryConfig {
        private int maxAttempts = 3;
        private long delayMs = 500;
    }
}
```

```yaml
# application.yml
app:
  payment:
    api-key: ${PAYMENT_API_KEY}  # из ENV
    timeout-seconds: 15
    retry:
      max-attempts: 5
      delay-ms: 1000
```

```java
// Регистрация (с Spring Boot 2.2+):
@SpringBootApplication
@ConfigurationPropertiesScan // автосканирование всех @ConfigurationProperties
public class App { ... }

// Использование:
@Service
public class PaymentService {
    private final PaymentProperties props;

    public void pay(Order order) {
        client.setTimeout(props.getTimeoutSeconds());
        // ...
    }
}
```

---

## Actuator — production-ready мониторинг

Actuator — встроенный набор HTTP-эндпоинтов для мониторинга и управления приложением в production.

```properties
# По умолчанию открыты только /health и /info
management.endpoints.web.exposure.include=health,info,metrics,beans,env,loggers,mappings
management.endpoint.health.show-details=always  # показывать детали (DB, disk, redis)

# Отдельный порт для actuator (безопаснее — не открывать наружу)
management.server.port=8081
```

### /actuator/health

Health indicators — проверка зависимостей:

```
GET /actuator/health

{
  "status": "UP",
  "components": {
    "db": { "status": "UP", "details": { "database": "PostgreSQL", "validationQuery": "isValid()" } },
    "redis": { "status": "UP", "details": { "version": "7.0.0" } },
    "diskSpace": { "status": "UP", "details": { "total": 500GB, "free": 100GB } }
  }
}
```

Spring Boot автоматически добавляет health indicators для DataSource, Redis, Kafka, RabbitMQ. Можно добавить свой:

```java
@Component
public class ExternalApiHealthIndicator implements HealthIndicator {
    @Override
    public Health health() {
        try {
            externalApi.ping();
            return Health.up().withDetail("api", "reachable").build();
        } catch (Exception e) {
            return Health.down().withDetail("error", e.getMessage()).build();
        }
    }
}
```

### /actuator/loggers — динамическое изменение уровня логирования

```bash
# Посмотреть текущий уровень:
GET /actuator/loggers/by.pavel.service

# Изменить без перезапуска:
curl -X POST http://localhost:8080/actuator/loggers/by.pavel.service \
  -H "Content-Type: application/json" \
  -d '{"configuredLevel": "DEBUG"}'

# Сбросить к дефолту:
curl -X POST ... -d '{"configuredLevel": null}'
```

Это критично в production: можно включить DEBUG для конкретного пакета на 5 минут для диагностики, потом выключить — без перезапуска сервиса.

### /actuator/metrics

Micrometer — абстракция над метриками (Prometheus, Datadog, CloudWatch и др.):

```properties
management.metrics.export.prometheus.enabled=true
# Доступно на /actuator/prometheus
```

```java
// Добавить кастомную метрику:
@Service
public class OrderService {
    private final Counter ordersCounter;
    private final Timer orderProcessingTimer;

    public OrderService(MeterRegistry registry) {
        ordersCounter = Counter.builder("orders.created")
            .tag("region", "EU")
            .description("Total orders created")
            .register(registry);

        orderProcessingTimer = Timer.builder("orders.processing.time")
            .register(registry);
    }

    public void placeOrder(Order order) {
        orderProcessingTimer.record(() -> {
            processOrder(order);
            ordersCounter.increment();
        });
    }
}
```

---

## Жизненный цикл SpringApplication

```java
// Детальная кастомизация запуска:
SpringApplication app = new SpringApplication(App.class);
app.setBannerMode(Mode.OFF);                              // отключить баннер
app.setDefaultProperties(Map.of("server.port", "8080")); // дефолтные свойства
app.addListeners(new ApplicationPidFileWriter());         // писать PID в файл
ConfigurableApplicationContext ctx = app.run(args);
```

### Порядок событий при старте

```
ApplicationStartingEvent         ← самое начало, до всего
ApplicationEnvironmentPreparedEvent ← Environment создан (свойства загружены)
ApplicationContextInitializedEvent  ← ApplicationContext создан, но не заполнен
ApplicationPreparedEvent           ← бины загружены, но context не обновлён
ContextRefreshedEvent              ← все бины созданы и проинициализированы
ApplicationStartedEvent            ← context запущен, runner'ы ещё не выполнены
ApplicationReadyEvent           ← ← приложение готово принимать запросы
```

```java
// Код после полного старта — два способа:

// 1. ApplicationRunner (получает обработанные аргументы)
@Component
public class DataInitializer implements ApplicationRunner {
    @Override
    public void run(ApplicationArguments args) {
        boolean verbose = args.containsOption("verbose");
        loadInitialData();
    }
}

// 2. CommandLineRunner (получает сырые строки args)
@Component
@Order(1) // порядок если несколько runner'ов
public class CacheWarmer implements CommandLineRunner {
    @Override
    public void run(String... args) {
        warmUpCache(); // прогрев кэша перед первым запросом
    }
}
```

### Graceful Shutdown

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

При `SIGTERM` Spring Boot:
1. Перестаёт принимать новые запросы
2. Ждёт завершения текущих (до `timeout-per-shutdown-phase`)
3. Вызывает `@PreDestroy` на всех бинах
4. Закрывает ApplicationContext

---

## Создание собственного Starter

Нужно когда у тебя есть библиотека, которую используют несколько Spring Boot приложений, и ты хочешь настраивать её "из коробки".

```
my-feature-spring-boot-starter/        ← только pom.xml с зависимостями
my-feature-spring-boot-autoconfigure/  ← конфигурация и Properties
```

```java
// 1. Properties — типобезопасная конфигурация
@ConfigurationProperties(prefix = "my.feature")
public class MyFeatureProperties {
    private boolean enabled = true;
    private String apiUrl;
    private Duration timeout = Duration.ofSeconds(5);
}

// 2. Auto-configuration
@AutoConfiguration
@EnableConfigurationProperties(MyFeatureProperties.class)
@ConditionalOnClass(MyFeatureClient.class)   // наш класс есть в classpath
@ConditionalOnProperty(
    prefix = "my.feature",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = true  // по умолчанию enabled=true
)
public class MyFeatureAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean  // пользователь может переопределить
    public MyFeatureClient myFeatureClient(MyFeatureProperties props) {
        return MyFeatureClient.builder()
            .url(props.getApiUrl())
            .timeout(props.getTimeout())
            .build();
    }
}
```

```
# 3. Зарегистрировать в:
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
com.example.myfeature.MyFeatureAutoConfiguration
```

Теперь любое Spring Boot приложение, добавившее твой starter в зависимости, автоматически получает сконфигурированный `MyFeatureClient`. Настройка через `application.properties`:
```properties
my.feature.api-url=https://api.example.com
my.feature.timeout=10s
```

---

## Источники

**Официальная документация:**
- [Spring Boot Reference Documentation](https://docs.spring.io/spring-boot/docs/current/reference/html/) — каноническая документация, особенно разделы Auto-configuration, Externalized Configuration, Actuator.
- [Spring Boot 3.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide) — переход с 2.x: Jakarta EE 9 namespace (`javax.*` → `jakarta.*`), Java 17 baseline, Native Image.
- [Spring Boot — Creating Your Own Auto-configuration](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.developing-auto-configuration) — как написать свой starter правильно.
- [Spring Boot Actuator Reference](https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html)

**Книги:**
- *Spring Boot Up & Running* (Mark Heckler, O'Reilly 2021) — современный туториал от Spring developer advocate.
- *Spring in Action*, 6th ed. (Craig Walls, Manning 2022) — главы по Boot, MVC, Reactive.
- *Learning Spring Boot 3.0*, 3rd ed. (Greg Turnquist, Packt 2022) — focus на Spring Boot 3.

**Talks / blogs:**
- [Phil Webb (Spring Boot tech lead) — SpringOne talks](https://springone.io/) — ежегодные апдейты по архитектуре auto-configuration.
- [Brian Clozel — «What's new in Spring Boot 3.x»](https://spring.io/blog/) — официальный блог Spring с release notes.
- [«Reading and writing data using your auto-configured Spring Boot app»](https://spring.io/guides/) — 30+ официальных guides от team.

**Security / postmortems:**
- [CVE-2022-22965 «Spring4Shell»](https://nvd.nist.gov/vuln/detail/CVE-2022-22965) — RCE через DataBinder в Spring Framework (затрагивает Spring Boot apps на Tomcat/JSP). Иллюстрация почему `disallowedFields` важен и почему запускать ничего «как root» в контейнере нельзя.
- [Spring Boot Security Releases page](https://spring.io/security/) — все CVE с патчами.
