# Software Engineering — Semantic Summary

## Core Model
Хороший код = **код, который дёшево менять**. SOLID — пять правил, описывающих структуру, минимизирующую стоимость изменений. FP-принципы (purity, immutability, RT) — структура, минимизирующая когнитивную нагрузку и допускающая безопасную параллелизацию. Testing pyramid — балансирует **обратную связь** (fast unit) и **доверие** (slow E2E). Все три области — про управление сложностью.

## Key Concepts
- **SOLID**: SRP (одна причина для изменения), OCP (расширение через новый код, не правку), LSP (subtype не нарушает контракт supertype), ISP (узкие интерфейсы), DIP (зависимость от абстракции, не от конкретики)
- **DIP пример**: `OrderService` зависит от `Serializer` (интерфейс в domain), `JacksonSerializer` (адаптер в infrastructure) реализует. Adapter pattern — обёртка над несовместимым API
- **Stream API**: source → intermediate (lazy: filter/map/flatMap/sorted/distinct/limit/skip) → terminal (collect/reduce/forEach/findFirst). Параллельные стримы — `ForkJoinPool.commonPool()`, не для IO
- **Collectors**: toList/toMap/groupingBy/partitioningBy/joining/teeing. Downstream collectors для вложенной агрегации
- **Optional**: контейнер `Some<T> | None`, **НЕ для полей класса**, **НЕ для параметров метода**, **НЕ в коллекциях** — только как return type method'а
- **FP принципы**: pure function (нет side effects), referential transparency (выражение можно заменить результатом), higher-order function (принимает или возвращает функцию), immutability (records, `List.of`), currying / partial application
- **Default methods (Java 8)**: enable Collection API эволюцию без breaking change. Diamond problem → explicit override
- **JVM не делает TCO** — глубокая хвостовая рекурсия → SOE. Workarounds: цикл, trampoline, Kotlin `tailrec` (compiler converts to while)
- **Testing pyramid**: много unit (быстро, дёшево, изоляция через моки) < integration (с реальной БД через TestContainers) < мало E2E (slow, brittle)
- **Test doubles** (Fowler): Dummy / Stub / Spy / Mock / Fake — разные роли. Mockito реализует все через `mock()` / `spy()`
- **AAA / Given-When-Then** — структура теста. ArgumentCaptor для verify-проверок
- **Non-functional testing**: performance (load / stress / soak / spike / volume) с k6/Gatling/JMeter; security (SAST/DAST/pentest); chaos engineering (Chaos Monkey/Mesh); mutation testing (PIT)
- **Contract testing** (Pact): consumer публикует expectations, provider верифицирует — позволяет тестировать микросервисы independently

## Important Invariants
- **LSP**: precondition не усиливать, postcondition не ослаблять, invariant сохранять. Square IS-NOT Rectangle (нарушает invariant width != height изменения)
- **SRP**: «one reason to change» — оси изменчивости, не строки кода
- **OCP**: добавление feature через новый класс/lambda, существующий код не правится
- **`equals` ↔ `hashCode`**: equal ⇒ equal hash (для HashMap корректности; см. java-core/EQUALS_HASHCODE_COMPARABLE.md)
- **Stream**: pipeline лениво до terminal; intermediate сами не запускают
- **Optional must be terminal**: `Optional<T>` для return; field/parameter — антипаттерн
- **`@Mock` injects nothing**, нужен `@InjectMocks` для автоинжекции или manual constructor call
- **Mutation testing**: 100% line coverage ≠ хорошие тесты; mutation score — реальный показатель strength

## Common Pitfalls
- **God class** = SRP violation; класс с 1000+ строк меняется по нескольким разным причинам
- **`instanceof` ladder** = OCP violation; новый тип → правка ladder; решение — polymorphism или sealed + pattern matching
- **Square extends Rectangle** = классический LSP пример нарушения
- **Fat interface** ≪ ISP — клиенты вынуждены реализовать `eat()` для `Robot`
- **`new MyService()` внутри класса** = DIP violation; нужно constructor inject
- **`Stream.parallel()` для IO** — блокирует ForkJoinPool.commonPool, голодание других задач
- **Optional.get() без isPresent()** = NoSuchElementException; вместо — `orElse`/`orElseGet`/`map`
- **Boxing в Stream**: `.map(Integer::intValue).sum()` boxes; нужно `mapToInt(...).sum()`
- **Side effects в lambda** — не работают в parallel streams (race), часто и в sequential (порядок)
- **Mock сам тестируемого объекта** — тестируешь мок, не код
- **100% code coverage** воспринимается как success — но coverage не равно correctness; mutation testing раскрывает gaps
- **Ice Cream Cone testing** — много E2E, мало unit; тесты медленные и нестабильные
- **`@Transactional` private method** — Spring AOP proxy не перехватывает; нужно public
- **Tests на implementation details** — тесты ломаются на каждом refactor; правильно тестировать behaviour

## Related Modules
- **`java-core`** — Records, Sealed, pattern matching для современного OOP/FP стиля; equals/hashCode contracts; lambda internals (invokedynamic, LambdaMetafactory)
- **`spring-frameworks`** — DI / IoC как реализация DIP, Spring AOP, @Transactional, Spring Test framework
- **`concurrency`** — race-condition тестирование, CountDownLatch в тестах, virtual threads & FP composability
- **`kotlin-coroutines`** — Flow / Channel как FP-подобные абстракции; runTest для async tests
- **`system-design`** — Reliability testing (chaos), contract testing, performance testing на system level
- **`infrastructure`** — security testing (SAST в CI), observability как support testing
