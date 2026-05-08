# caching-deep-dive

Подготовка к интервью по теме **Full Cache Stack** — от CPU L1/L2/L3 → page cache → JVM heap → application cache → distributed cache → CDN/edge.

## Структура

```
modules/caching-deep-dive/
├── theory/                    # 9 файлов теории
│   ├── BASICS.md
│   ├── CACHE_PATTERNS.md
│   ├── EVICTION_POLICIES.md
│   ├── CAFFEINE.md
│   ├── REDIS.md
│   ├── DISTRIBUTED_CACHING.md
│   ├── CONSISTENCY.md
│   ├── HTTP_CDN_CACHE.md
│   └── ANTI_PATTERNS.md
├── src/main/kotlin/exercises/ # Ex01..Ex10
├── PROGRESS.md
├── ROADMAP.md
├── INTERVIEW_QUESTIONS.md
└── pom.xml
```

## Темы (NO OVERLAP)

В этом модуле — кэширование как явление: уровни, паттерны, реализации (Caffeine, Redis), консистентность, HTTP/CDN, anti-patterns.

Уже покрыто в других модулях (ссылаемся, не дублируем):
- **Hibernate L1/L2/Query кэш** → [`spring-frameworks/theory/SPRING_DATA_JPA.md`](../spring-frameworks/theory/SPRING_DATA_JPA.md)
- **HTTP-методы / семантика** → [`system-design/theory/http_networking.md`](../system-design/theory/http_networking.md)
- **`ConcurrentHashMap`, atomics** → [`concurrency/theory/CONCURRENT_COLLECTIONS.md`](../concurrency/theory/CONCURRENT_COLLECTIONS.md)
- **CAP / distributed systems** → [`system-design/theory/distributed_systems.md`](../system-design/theory/distributed_systems.md)

## Сборка и запуск

```bash
cd modules/caching-deep-dive
mvn compile
mvn exec:java -Dexec.mainClass="exercises.Ex01_CacheAsideBasicKt"
```

Запуск конкретного упражнения:
```bash
mvn exec:java -Dexec.mainClass="exercises.Ex05_CaffeineLoadingKt"
```

## Зависимости

- **Caffeine** 3.x — для упражнений с production-grade JVM кэшем
- **Lettuce** 6.x — Redis-клиент (используется в нескольких упражнениях для иллюстрации, реальный Redis запускать не обязательно)
- **kotlinx-coroutines-core** — async loading в Caffeine, write-behind
- **JUnit 5** + **kotlin-test** — для тестов

## Прогресс

См. [PROGRESS.md](PROGRESS.md) и [ROADMAP.md](ROADMAP.md).

## Интервью-вопросы

См. [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md) — 15+ вопросов с ответами.
