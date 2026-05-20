# software-engineering

Подготовка к интервью по теме **practices and design principles** — SOLID, OOP, функциональное программирование, testing. Не язык-специфика (для JVM internals — см. `java-core`), а универсальные практики написания и сопровождения кода. Java/Kotlin примеры — потому что они служат типичным backend-стеком.

## Структура

```
modules/software-engineering/
├── theory/
│   ├── SOLID_OOP.md       # SRP/OCP/LSP/ISP/DIP + Adapter (Jackson example)
│   ├── STREAM_API_FP.md   # Stream API + functional principles (HOF, RT, immutability, currying, TCO)
│   └── TESTING.md         # Pyramid, JUnit/Mockito, TestContainers, perf (k6/Gatling),
│                          # security (SAST/DAST), chaos, mutation, contract testing
├── README.md
├── ROADMAP.md
├── PROGRESS.md
├── _SUMMARY.md
└── INTERVIEW_QUESTIONS.md
```

> **Чисто теоретический модуль.** Нет `pom.xml`, нет упражнений — материал изучается через теорию + interview-questions + flashcards. Практика по SOLID — в Spring-приложениях (`spring-frameworks`), практика по Stream/FP — в любом Java-коде, практика тестирования — повсеместно.

## Темы (NO OVERLAP)

В этом модуле — **практики и принципы**, применимые поверх любого языка / фреймворка.

Уже покрыто в других модулях (ссылаемся, не дублируем):

- **JVM internals (GC, JIT, classloaders, JPMS, bytecode, FFM)** → [`modules/java-core/`](../java-core/)
- **Spring DI / IoC / AOP** (реализация SOLID в Spring) → [`modules/spring-frameworks/`](../spring-frameworks/)
- **Concurrency-specific testing (race conditions, CountDownLatch)** → [`modules/concurrency/`](../concurrency/)
- **System design testing (chaos eng, contract testing)** — частично здесь, частично в [`infrastructure`](../infrastructure/)

## Прогресс

См. [PROGRESS.md](PROGRESS.md) и [ROADMAP.md](ROADMAP.md).

## Интервью-вопросы

См. [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md) — формат `qa-bold`.

## Semantic Summary

См. [_SUMMARY.md](_SUMMARY.md) — semantic compression.
