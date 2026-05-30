# Spring Frameworks — Interview Prep Module

Модуль для подготовки к интервью по Spring Framework, Spring Boot, Spring Data JPA, Spring Security и Spring Cloud.

## Структура

```
modules/spring-frameworks/
├── theory/
│   ├── SPRING_CORE_DI.md       — IoC, DI, Bean Scopes, AOP, GoF паттерны
│   ├── SPRING_BOOT.md          — Starters, Auto-Configuration, Actuator
│   ├── SPRING_MVC_REST.md      — DispatcherServlet, REST, Validation, Filters
│   ├── SPRING_DATA_JPA.md      — JPA, Hibernate кэши L1/L2/Query, N+1, @Transactional
│   ├── SPRING_SECURITY.md      — Filter Chain, JWT, Method Security
│   └── SPRING_CLOUD.md         — Config, Eureka, Gateway, Feign, Circuit Breaker
├── src/
│   ├── main/
│   │   ├── java/by/pavel/      — Java exercises
│   │   └── resources/
│   │       └── application.properties
│   └── test/
│       └── java/by/pavel/
├── pom.xml
├── Dockerfile
├── ROADMAP.md
└── INTERVIEW_QUESTIONS.md
```

## Смежные темы в других модулях

| Тема | Модуль |
|------|--------|
| JWT структура, OAuth2 потоки, OIDC, SAML, IdP | [system-design/theory/identity_providers.md](../system-design/theory/identity_providers.md) |
| Circuit Breaker паттерн, Saga, Outbox | [system-design/theory/microservice_patterns.md](../system-design/theory/microservice_patterns.md) |
| Database transactions, ACID, MVCC | [system-design/theory/database_transactions.md](../system-design/theory/database_transactions.md) |
| Distributed Tracing, Observability | [infrastructure/theory/OBSERVABILITY.md](../infrastructure/theory/OBSERVABILITY.md) |

## Команды запуска

```bash
cd modules/spring-frameworks

# Сборка
mvn compile

# Тесты
mvn test
mvn test -Dtest=ClassName

# Запуск приложения
mvn spring-boot:run

# Сборка Docker образа
mvn package -DskipTests
docker build -t spring-frameworks-learn .
docker run -p 8080:8080 spring-frameworks-learn
```

## Быстрый старт

1. Изучи теорию в порядке из [ROADMAP.md](ROADMAP.md)
2. Ответь на вопросы из [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md)
