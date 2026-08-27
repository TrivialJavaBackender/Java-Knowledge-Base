# Spring Frameworks — Roadmap

## Порядок прохождения

| Приоритет | Модуль | Частота на собесах |
|-----------|--------|--------------------|
| 1 | Spring Core / DI / IoC | ★★★★★ |
| 2 | Spring Data JPA & Hibernate | ★★★★★ |
| 3 | Spring Boot & Auto-Configuration | ★★★★☆ |
| 4 | Spring Security | ★★★★☆ |
| 5 | Spring MVC & REST | ★★★☆☆ |
| 6 | Spring Cloud | ★★★☆☆ |

---

## Модуль 1: Spring Core / DI / IoC

📖 Теория: [theory/SPRING_CORE_DI.md](theory/SPRING_CORE_DI.md)

- [ ] IoC и Hollywood Principle
- [ ] Constructor vs Setter vs Field injection
- [ ] Bean Scopes (singleton, prototype, request, session)
- [ ] Bean Lifecycle (@PostConstruct, @PreDestroy)
- [ ] AOP: Proxy, @Transactional, @Cacheable, self-invocation проблема
- [ ] GoF паттерны: Factory, Singleton, Proxy, Template, Observer, Strategy, Decorator
- [ ] Circular Dependencies и способы решения

---

## Модуль 2: Spring Data JPA & Hibernate

📖 Теория: [theory/SPRING_DATA_JPA.md](theory/SPRING_DATA_JPA.md)

- [ ] JpaRepository: методы, производные запросы, @Query
- [ ] FetchType EAGER vs LAZY, LazyInitializationException
- [ ] N+1 проблема и решения (JOIN FETCH, @EntityGraph, @BatchSize, DTO projection)
- [ ] @Transactional: Propagation, rollback, self-invocation
- [ ] **Hibernate L1 Cache** (Session scope, всегда включён)
- [ ] **Hibernate L2 Cache** (SessionFactory scope, EHCache/Caffeine, CacheConcurrencyStrategy)
- [ ] **Query Cache** (кэш результатов запросов)
- [ ] Optimistic vs Pessimistic Locking (@Version, @Lock)

---

## Модуль 3: Spring Boot & Auto-Configuration

📖 Теория: [theory/SPRING_BOOT.md](theory/SPRING_BOOT.md)

- [ ] Что делают Starters изнутри
- [ ] Механизм Auto-Configuration (META-INF, @Conditional*)
- [ ] @ConditionalOnClass, @ConditionalOnMissingBean, @ConditionalOnProperty
- [ ] Как отладить авто-конфигурацию (--debug, CONDITIONS EVALUATION REPORT)
- [ ] application.properties: профили, приоритет источников
- [ ] @ConfigurationProperties vs @Value
- [ ] Actuator: endpoints, динамическое изменение loggers
- [ ] ApplicationRunner, события жизненного цикла

---

## Модуль 4: Spring Security

📖 Теория: [theory/SPRING_SECURITY.md](theory/SPRING_SECURITY.md)

> JWT/OAuth2/OIDC — см. [system-design/theory/identity_providers.md](../system-design/theory/identity_providers.md)

- [ ] Filter Chain архитектура
- [ ] SecurityContext и ThreadLocal
- [ ] SecurityFilterChain конфигурация (Spring Security 6+)
- [ ] JWT decoder: symmetric vs asymmetric key, JWKS
- [ ] Method Security: @PreAuthorize, @PostFilter, SpEL
- [ ] UserDetailsService и кастомная загрузка пользователя
- [ ] BCrypt и защита от timing attack
- [ ] CSRF: когда нужен, когда нет

---

## Модуль 5: Spring MVC & REST

📖 Теория: [theory/SPRING_MVC_REST.md](theory/SPRING_MVC_REST.md)

- [ ] DispatcherServlet: роль, жизненный цикл запроса
- [ ] @RestController, @RequestMapping, @PathVariable, @RequestParam
- [ ] @ControllerAdvice / @RestControllerAdvice для обработки ошибок
- [ ] Bean Validation: @Valid, @NotBlank, @Size, кастомные валидаторы
- [ ] Фильтры vs Interceptors: разница, порядок выполнения
- [ ] HttpMessageConverter и настройка Jackson

---

## Модуль 6: Spring Cloud

📖 Теория: [theory/SPRING_CLOUD.md](theory/SPRING_CLOUD.md)

> Circuit Breaker паттерн — см. [../microservices/theory/FAILURE_ISOLATION.md](../microservices/theory/FAILURE_ISOLATION.md)

- [ ] Spring Cloud Config: централизованная конфигурация, @RefreshScope
- [ ] Service Discovery: Eureka, @LoadBalanced RestTemplate
- [ ] OpenFeign: декларативный клиент, fallback
- [ ] Spring Cloud Gateway: роутинг, фильтры, rate limiting
- [ ] Circuit Breaker с Resilience4j: состояния CB, настройка
- [ ] Distributed Tracing: traceId/spanId, Zipkin интеграция
