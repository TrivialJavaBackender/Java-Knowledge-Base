# Spring Cloud

Spring Cloud — набор библиотек для построения распределённых систем поверх Spring Boot. Решает типичные проблемы микросервисной архитектуры: как сервисы находят друг друга, как управлять конфигурацией централизованно, как защититься от каскадных сбоев.

> **Паттерны микросервисов (Circuit Breaker, Saga, Outbox, API Gateway)** — теория в [`../../microservices/theory/FAILURE_ISOLATION.md`](../../microservices/theory/FAILURE_ISOLATION.md). Здесь — реализация этих паттернов через Spring Cloud.

---

## 1. Основные компоненты

| Компонент | Проблема которую решает |
|-----------|------------------------|
| Spring Cloud Config | Конфигурация разбросана по всем сервисам, нет централизованного управления |
| Spring Cloud Netflix Eureka | Сервисы не знают IP друг друга (они динамически меняются в K8s/EC2) |
| Spring Cloud Gateway | Нужна единая точка входа для всех сервисов |
| Spring Cloud OpenFeign | HTTP-клиент с бойлерплейтом (URL, заголовки, error handling) |
| Resilience4j | Один сервис падает — весь граф запросов зависает |
| Micrometer Tracing | Трудно отследить запрос через цепочку из 5 сервисов |

---

## 2. Spring Cloud Config — централизованная конфигурация

**Проблема:** 20 микросервисов, у каждого своя база данных, свои настройки. При смене пароля к БД — обновлять и перезапускать 20 сервисов. Нет истории изменений конфигурации.

**Решение:** Config Server хранит конфигурацию в Git. Все сервисы получают конфигурацию от него при старте. История изменений — в git log.

```
GitHub/GitLab (конфиги в репозитории)
         ↓
Config Server (Spring Boot приложение)
    ↙         ↘        ↘
order-service  user-service  payment-service
```

### Config Server

```yaml
# Config Server — application.yml
spring:
  cloud:
    config:
      server:
        git:
          uri: https://github.com/my-org/app-configs
          default-label: main
          # Для приватного репо:
          username: ${GITHUB_USERNAME}
          password: ${GITHUB_TOKEN}
          # Поиск файлов в поддиректориях:
          search-paths: "{application}"  # папка по имени сервиса
```

```java
@SpringBootApplication
@EnableConfigServer  // включает Config Server функциональность
public class ConfigServerApp { ... }
```

Config Server предоставляет REST API:
```
GET /{application}/{profile}          → конфигурация для сервиса + профиль
GET /{application}/{profile}/{label}  → + конкретная ветка/тег

# Пример:
GET /order-service/prod   → ищет: order-service-prod.yml, order-service.yml, application-prod.yml
```

### Config Client

```yaml
# application.yml клиента
spring:
  config:
    import: optional:configserver:http://config-server:8888
    # optional: — не падать если Config Server недоступен (fallback на локальный config)
  application:
    name: order-service  # имя, по которому Config Server ищет файл конфигурации
  profiles:
    active: prod
```

### Обновление конфигурации без перезапуска: @RefreshScope

По умолчанию бины создаются при старте с значениями свойств. При изменении конфигурации — надо перезапускать. `@RefreshScope` решает это:

```java
@Service
@RefreshScope  // при /actuator/refresh — бин пересоздаётся с новыми значениями
public class FeatureToggleService {

    @Value("${feature.new-checkout.enabled:false}")
    private boolean newCheckoutEnabled;

    @Value("${payment.timeout-seconds:30}")
    private int paymentTimeoutSeconds;

    public boolean isNewCheckoutEnabled() { return newCheckoutEnabled; }
}
```

```bash
# Обновить конфигурацию одного сервиса:
curl -X POST http://order-service:8080/actuator/refresh
# → Spring перечитывает конфигурацию с Config Server
# → пересоздаёт все @RefreshScope бины
# → returns: ["feature.new-checkout.enabled", "payment.timeout-seconds"]  (что изменилось)
```

**Spring Cloud Bus** — обновление всех инстансов одновременно:
```bash
# При нескольких инстансах order-service:
curl -X POST http://any-instance:8080/actuator/busrefresh
# → Spring Cloud Bus рассылает RefreshRemoteApplicationEvent через Kafka/RabbitMQ
# → все инстансы order-service обновляют конфигурацию
```

---

## 3. Service Discovery — Eureka

**Проблема:** в статичной инфраструктуре IP-адреса сервисов фиксированы — можно захардкодить. В динамической (K8s, ECS, Elastic Beanstalk) сервисы получают новые IP при каждом перезапуске. Как order-service знает, куда обращаться к user-service?

**Решение:** Service Registry — общая БД "кто где живёт". Сервисы регистрируются при старте, heartbeat каждые 30 секунд. Умирающие инстансы автоматически исключаются.

```
Eureka Server (Service Registry)
┌────────────────────────────────────┐
│  order-service → 10.0.0.1:8080     │
│  order-service → 10.0.0.2:8080     │  (2 инстанса)
│  user-service  → 10.0.1.1:8081     │
│  payment-svc   → 10.0.2.1:8082     │
└────────────────────────────────────┘
         ↑ регистрируются       ↓ запрашивают
   order-service          user-service запрашивает
                          "где живёт payment-svc?"
```

```yaml
# Eureka Server — application.yml
eureka:
  client:
    register-with-eureka: false  # сам сервер не регистрируется
    fetch-registry: false

server:
  port: 8761  # стандартный порт Eureka

# Eureka Client — application.yml
eureka:
  client:
    service-url:
      defaultZone: http://eureka:8761/eureka/
  instance:
    prefer-ip-address: true        # регистрировать по IP, не hostname
    lease-renewal-interval-in-seconds: 10   # heartbeat каждые 10с
    lease-expiration-duration-in-seconds: 30 # удалить если нет heartbeat 30с
```

**Client-side load balancing:** Spring Cloud LoadBalancer делает round-robin между инстансами сервиса:

```java
// RestTemplate с балансировкой (устаревший подход):
@Bean
@LoadBalanced  // RestTemplate будет резолвить "user-service" через Eureka
public RestTemplate restTemplate() { return new RestTemplate(); }

// Теперь "user-service" — логическое имя, не DNS:
User user = restTemplate.getForObject("http://user-service/api/users/1", User.class);
// → Spring Cloud LoadBalancer: получает список инстансов из Eureka
// → выбирает 10.0.1.1:8081 (round-robin)
// → выполняет реальный HTTP запрос

// Современный подход — WebClient с @LoadBalanced:
@Bean
@LoadBalanced
public WebClient.Builder webClientBuilder() { return WebClient.builder(); }
```

---

## 4. OpenFeign — декларативный HTTP-клиент

**Проблема:** вызов другого сервиса через RestTemplate/WebClient — бойлерплейт. Надо строить URL, добавлять заголовки, обрабатывать ошибки, десериализовать ответ. Для каждого эндпоинта.

**Решение:** Feign — объявляешь интерфейс (как Spring Data JPA Repository), Feign генерирует реализацию.

```java
@FeignClient(
    name = "user-service",       // имя сервиса в Eureka (или url = "http://...")
    fallback = UserClientFallback.class,  // что делать если сервис недоступен
    configuration = FeignConfig.class    // кастомная конфигурация
)
public interface UserClient {

    @GetMapping("/api/users/{id}")
    UserDto getUser(@PathVariable Long id);

    @PostMapping("/api/users")
    UserDto createUser(@RequestBody CreateUserRequest request);

    @GetMapping("/api/users")
    Page<UserDto> searchUsers(
        @RequestParam String email,
        @RequestParam(defaultValue = "0") int page,
        Pageable pageable  // Feign умеет передавать Pageable как параметры
    );
}

// Fallback — вызывается когда сервис недоступен или Circuit Breaker открыт
@Component
public class UserClientFallback implements UserClient {
    @Override
    public UserDto getUser(Long id) {
        // Возвращаем дефолтный объект, а не бросаем исключение
        return UserDto.unknown(id);
    }

    @Override
    public UserDto createUser(CreateUserRequest request) {
        throw new ServiceUnavailableException("User service is unavailable");
    }
}
```

```yaml
# Таймауты для конкретного Feign клиента:
feign:
  client:
    config:
      user-service:        # имя @FeignClient
        connect-timeout: 1000    # 1 секунда на установку соединения
        read-timeout: 5000       # 5 секунд на ответ
        logger-level: FULL       # NONE, BASIC, HEADERS, FULL (для отладки)
```

```java
// Кастомная конфигурация Feign (перехватчик для добавления заголовков):
public class FeignConfig {
    @Bean
    public RequestInterceptor authInterceptor() {
        return template -> {
            // Передать JWT от входящего запроса в исходящий (propagation)
            String token = SecurityContextHolder.getContext()
                .getAuthentication().getCredentials().toString();
            template.header("Authorization", "Bearer " + token);
        };
    }
}
```

**Почему Feign лучше RestTemplate:**
- Интерфейс читабелен: видно сразу что вызывается и с какими параметрами
- Меньше кода: нет строительства URL, нет `ParameterizedTypeReference`
- Интеграция с Eureka и Circuit Breaker "из коробки"
- Легко мокировать в тестах: мок интерфейса — одна строка

---

## 5. Spring Cloud Gateway — API Gateway

**Проблема:** клиент (frontend, mobile) должен знать адреса всех микросервисов и вызывать каждый напрямую. При изменении адресов — обновлять клиентов. Нет общего места для аутентификации, rate limiting, логирования.

**Решение:** API Gateway — единая точка входа. Маршрутизирует запросы к нужным сервисам, применяет общие политики.

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-service
          uri: lb://order-service    # lb:// = LoadBalancer → резолвит через Eureka
          predicates:
            - Path=/api/orders/**    # запросы /api/orders/** → order-service
          filters:
            - StripPrefix=1          # убрать /api из пути перед проксированием
            # /api/orders/42 → order-service получает /orders/42

        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
            - Method=GET,POST        # только GET и POST
            - Header=X-Client-Version, \d+  # только если заголовок есть
          filters:
            - AddRequestHeader=X-Gateway-Source, api-gateway  # добавить заголовок
            - AddResponseHeader=X-Frame-Options, DENY
            - RequestRateLimiter=redis-rate-limiter  # rate limiting через Redis

        - id: static-content
          uri: https://cdn.myapp.com
          predicates:
            - Path=/static/**
          filters:
            - RewritePath=/static/(?<segment>.*), /${segment}  # regex rewrite

      # Глобальные таймауты:
      httpclient:
        connect-timeout: 1000
        response-timeout: 5s
```

### Кастомные фильтры Gateway

Gateway Filters работают как Servlet Filters, но реактивно (Netty + WebFlux):

```java
@Component
public class AuthenticationGatewayFilter implements GlobalFilter, Ordered {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String authHeader = request.getHeaders().getFirst(HttpHeaders.AUTHORIZATION);

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        String token = authHeader.substring(7);
        return jwtValidator.validate(token)
            .flatMap(claims -> {
                // Добавить userId в заголовок — downstream сервисы получат его без JWT
                ServerHttpRequest mutatedRequest = request.mutate()
                    .header("X-User-Id", claims.getSubject())
                    .header("X-User-Role", claims.get("role", String.class))
                    .build();
                return chain.filter(exchange.mutate().request(mutatedRequest).build());
            })
            .onErrorResume(e -> {
                exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
                return exchange.getResponse().setComplete();
            });
    }

    @Override
    public int getOrder() { return -100; } // выполнить раньше других фильтров
}
```

---

## 6. Circuit Breaker с Resilience4j

**Проблема:** сервис A вызывает сервис B, который тормозит (30 секунд ответа вместо 1). Поток A ждёт. Новые запросы к A тоже ждут. Пул потоков A исчерпан. A начинает тормозить. A вызывает C — C тоже вовлекается. Каскадный сбой.

**Circuit Breaker** прерывает эту цепочку: после N% ошибок перестаёт делать реальные запросы и сразу возвращает fallback.

```
       CLOSED (работает нормально)
      /                     \
     ↑                       ↓  failure rate > threshold
     |                    OPEN (все запросы → fallback)
     |                       ↓  после waitDuration
   success               HALF-OPEN (пробует N запросов)
     ↑                     /   \
     └─────────── success /     \ fail
                               OPEN (снова)
```

```yaml
resilience4j:
  circuitbreaker:
    instances:
      user-service:
        sliding-window-type: COUNT_BASED    # или TIME_BASED (скользящее окно по времени)
        sliding-window-size: 20             # последние 20 вызовов
        failure-rate-threshold: 50          # открыть если 50%+ ошибок
        slow-call-rate-threshold: 50        # медленные вызовы тоже считаются как ошибки
        slow-call-duration-threshold: 2s    # медленный = дольше 2 секунд
        wait-duration-in-open-state: 10s    # OPEN → ждать 10с перед HALF_OPEN
        permitted-number-of-calls-in-half-open-state: 5  # проверить 5 запросов
        minimum-number-of-calls: 10         # минимум вызовов для расчёта %

  retry:
    instances:
      user-service:
        max-attempts: 3                     # попробовать 3 раза
        wait-duration: 500ms               # 500мс между попытками
        exponential-backoff-multiplier: 2   # 500ms, 1s, 2s (экспоненциальный backoff)
        retry-exceptions:
          - java.net.ConnectException
          - feign.RetryableException

  timelimiter:
    instances:
      user-service:
        timeout-duration: 3s               # таймаут запроса
        cancel-running-future: true
```

```java
// Использование через аннотации:
@Service
public class OrderService {
    private final UserClient userClient;

    @CircuitBreaker(name = "user-service", fallbackMethod = "getUserFallback")
    @Retry(name = "user-service")
    @TimeLimiter(name = "user-service")
    public CompletableFuture<UserDto> getUser(Long userId) {
        return CompletableFuture.supplyAsync(() -> userClient.getUser(userId));
    }

    // Fallback — первый параметр должен совпадать с оригинальным методом
    // последний параметр — тип исключения (или Exception для всех)
    public CompletableFuture<UserDto> getUserFallback(Long userId, Exception ex) {
        log.warn("Circuit breaker triggered for user {}: {}", userId, ex.getClass().getSimpleName());
        return CompletableFuture.completedFuture(UserDto.anonymous());
    }
}
```

**Несколько паттернов устойчивости работают вместе:**
```
Запрос к user-service
    ↓
TimeLimiter: если нет ответа за 3с → timeout exception
    ↓
Retry: повторить до 3 раз при transient ошибках
    ↓
CircuitBreaker: если % ошибок растёт → открыть CB → всем сразу возвращать fallback
    ↓
Bulkhead: ограничить количество параллельных запросов к user-service
```

Важен порядок: сначала Bulkhead, потом CircuitBreaker, потом Retry, потом TimeLimiter (Retry не должен повторять попытки после timeout, иначе общее время = timeoutDuration * maxAttempts).

---

## 7. Distributed Tracing

**Проблема:** запрос от пользователя проходит через API Gateway → order-service → user-service → payment-service. Один из шагов медленный. Как найти который?

В логах у каждого сервиса свои записи, нет связи между ними. Tracing решает это: каждый запрос получает уникальный `traceId`, каждый hop в цепочке — свой `spanId`.

> **Полная теория Distributed Tracing** — в [`modules/infrastructure/theory/OBSERVABILITY.md`](../../infrastructure/theory/OBSERVABILITY.md)

```xml
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-otel</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-zipkin</artifactId>
</dependency>
```

```yaml
management:
  tracing:
    sampling:
      probability: 0.1  # семплировать 10% запросов (в prod; для dev — 1.0)
  zipkin:
    tracing:
      endpoint: http://zipkin:9411/api/v2/spans
```

Spring Boot автоматически:
- Добавляет `traceId` и `spanId` в MDC → они появляются в каждой лог-записи
- Propagates trace context через HTTP заголовки: `traceparent: 00-<traceId>-<spanId>-01`
- При использовании Feign — автоматически добавляет заголовки в исходящие запросы

```
API Gateway:  traceId=abc123, spanId=001  → log: "Routing to order-service [traceId=abc123]"
     ↓ HTTP + traceparent header
order-service: traceId=abc123, spanId=002 → log: "Processing order [traceId=abc123]"
     ↓ HTTP + traceparent header
user-service:  traceId=abc123, spanId=003 → log: "Loading user [traceId=abc123]"
```

Все логи с одним `traceId` собираются в Zipkin/Jaeger в единый trace-граф с временными метками. Сразу видно на каком шаге задержка.

---

## 8. Паттерны межсервисного взаимодействия

### Синхронное vs Асинхронное

**Синхронное (Feign/RestTemplate):**
- Caller ждёт ответа — coupling по времени
- Проще отладить (трейс прямой)
- Проблема: один тормозящий сервис блокирует caller

**Асинхронное (Kafka, RabbitMQ):**
- Caller публикует событие и не ждёт
- Нет coupling по времени — сервисы могут быть недоступны временно
- Сложнее отладить (трейс через события)

```java
// Типичный паттерн: синхронно читаем, асинхронно пишем
@Service
public class OrderService {

    // Синхронно: нужен немедленный ответ
    public UserDto getOrderOwner(Long orderId) {
        Order order = orderRepo.findById(orderId).orElseThrow();
        return userClient.getUser(order.getUserId()); // Feign — синхронно
    }

    // Асинхронно: создание заказа запускает цепочку событий
    @Transactional
    public OrderDto createOrder(CreateOrderRequest request) {
        Order order = orderRepo.save(new Order(request));

        // Публикуем событие в Kafka — не ждём ответа
        kafkaTemplate.send("order.created", new OrderCreatedEvent(order.getId()));

        return mapper.toDto(order);
    }
}
```

---

## 9. Конфигурация для production

### Несколько инстансов Eureka (High Availability)

```yaml
# eureka-1:
eureka:
  client:
    service-url:
      defaultZone: http://eureka-2:8761/eureka/,http://eureka-3:8761/eureka/
  instance:
    hostname: eureka-1

# Клиенты указывают все инстансы:
eureka:
  client:
    service-url:
      defaultZone: http://eureka-1:8761/eureka/,http://eureka-2:8761/eureka/
```

### Config Server с Vault для секретов

```yaml
spring:
  cloud:
    config:
      server:
        git:
          uri: https://github.com/my-org/configs  # не-секретная конфигурация
        vault:
          host: vault.internal
          port: 8200
          # Секреты из Vault: database passwords, API keys
```

### Kubernetes как альтернатива Eureka

В K8s Service Discovery встроен (DNS: `user-service.default.svc.cluster.local`). Eureka не нужен. Spring Cloud Kubernetes интегрируется напрямую с K8s API:

```yaml
spring:
  cloud:
    kubernetes:
      discovery:
        enabled: true  # резолвит сервисы через K8s DNS
      config:
        enabled: true  # читает ConfigMap/Secret как application.properties
```

---

## Источники

**Официальная документация:**
- [Spring Cloud Reference (umbrella)](https://docs.spring.io/spring-cloud/docs/current/reference/html/) — каталог проектов: Config, Gateway, OpenFeign, LoadBalancer, Circuit Breaker.
- [Spring Cloud Config](https://docs.spring.io/spring-cloud-config/docs/current/reference/html/) и [Spring Cloud Gateway](https://docs.spring.io/spring-cloud-gateway/reference/index.html).
- [Spring Cloud OpenFeign](https://docs.spring.io/spring-cloud-openfeign/docs/current/reference/html/)
- [Resilience4j Documentation](https://resilience4j.readme.io/) — Circuit Breaker, Retry, Bulkhead, RateLimiter, TimeLimiter.
- [Micrometer Tracing](https://docs.micrometer.io/tracing/reference/index.html) — современная замена Spring Cloud Sleuth.

**Books:**
- *Spring Microservices in Action*, 2nd ed. (John Carnell, Illary Huaylupo, Manning 2021).
- *Spring Microservices with Spring Boot 3 and Spring Cloud*, 3rd ed. (Magnus Larsson, Packt 2023).
- *Microservices Patterns* (Chris Richardson, Manning 2018) — теория, реализуемая через Spring Cloud.

**Battle stories (откуда пришли паттерны):**
- [Netflix Tech Blog — «Introducing Hystrix» (2012)](https://netflixtechblog.com/introducing-hystrix-for-resilience-engineering-13531c1ab362) — origin story Circuit Breaker'а в Netflix-стеке.
- [Netflix — «Hystrix in Maintenance Mode» (2018)](https://github.com/Netflix/Hystrix#hystrix-status) — почему Netflix переключился на adaptive concurrency limits и инструменты типа Resilience4j; для новых проектов — **Resilience4j, не Hystrix**.
- [Eureka постмортемы и AZ failures](https://netflixtechblog.com/eureka-2-0-architecture-overview-deeb02c0b66c) — почему Eureka использует AP-выбор (consistency over availability), и какие нюансы это создаёт.
- [Spring4Shell + Spring Cloud Gateway CVE-2022-22947](https://spring.io/security/cve-2022-22947) — RCE через SpEL в Gateway routing predicates. Mitigation: всегда валидировать пользовательский ввод, использовать read-only endpoints actuator в проде.

**Migration / decisions:**
- [«Why we moved from Hystrix to Resilience4j» (Resilience4j FAQ)](https://resilience4j.readme.io/docs/getting-started)
- [«Spring Cloud Netflix is in Maintenance Mode»](https://spring.io/blog/2018/12/12/spring-cloud-greenwich-rc1-available-now) — Eureka/Hystrix/Ribbon/Zuul → Spring Cloud LoadBalancer + Gateway + Resilience4j.
