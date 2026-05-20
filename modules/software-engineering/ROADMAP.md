# software-engineering — Roadmap

## Порядок прохождения

| Приоритет | Тема | Частота на собесах |
|-----------|------|--------------------|
| 1 | SOLID & OOP design principles | ★★★★★ |
| 2 | Testing pyramid + JUnit/Mockito | ★★★★★ |
| 3 | Stream API + functional principles | ★★★★ |
| 4 | TestContainers / integration testing | ★★★★ |
| 5 | Non-functional testing (perf / security / chaos) | ★★★ |
| 6 | Mutation testing + coverage strategy | ★★ |

---

## Модуль 1: SOLID & OOP

📖 Теория: [theory/SOLID_OOP.md](theory/SOLID_OOP.md)

- [ ] SRP — «one reason to change»; распознать god class
- [ ] OCP — расширение через новый код, не правку; Strategy pattern
- [ ] LSP — контракт супертипа сохраняется; Rectangle/Square classical violation
- [ ] ISP — узкие интерфейсы; Workable + Eatable вместо Worker
- [ ] DIP — зависеть от абстракции, не от конкретики
- [ ] Adapter pattern — Jackson через Serializer interface
- [ ] Composition over inheritance (Bloch Item 18)
- [ ] Антипаттерны: god class, instanceof ladder, fat interface, `new` внутри сервиса

---

## Модуль 2: Stream API & Functional Principles

📖 Теория: [theory/STREAM_API_FP.md](theory/STREAM_API_FP.md)

- [ ] Functional interfaces: Predicate / Function / Consumer / Supplier / UnaryOperator
- [ ] Method references — 4 вида (static / bound instance / unbound instance / constructor)
- [ ] Stream pipeline: source → intermediate (lazy) → terminal (eager)
- [ ] Intermediate operations: filter/map/flatMap/sorted/distinct/limit/skip/peek
- [ ] Terminal: collect/reduce/findFirst/forEach/count/min/max/anyMatch/allMatch
- [ ] Collectors: toList / toMap (с merge function) / groupingBy + downstream / partitioningBy / joining / teeing
- [ ] Optional: правильное использование (return only), `orElse` vs `orElseGet`, `map` vs `flatMap`, `ifPresent`
- [ ] Parallel streams — когда имеет смысл, когда вредит (IO в commonPool — голодание)
- [ ] Higher-order functions, first-class functions
- [ ] Pure functions, referential transparency, immutability
- [ ] Currying & partial application
- [ ] Tail recursion — JVM не оптимизирует; trampoline pattern; Kotlin `tailrec`
- [ ] Default methods (JEP 126) — зачем появились, diamond problem

---

## Модуль 3: Testing — JUnit & Mockito Basics

📖 Теория: [theory/TESTING.md](theory/TESTING.md)

- [ ] Pyramid: unit > integration > E2E (антипаттерн Ice Cream Cone)
- [ ] JUnit 5: @Test / @BeforeEach / @AfterEach / @BeforeAll / @AfterAll / @Nested / @Tag
- [ ] Assertions: assertEquals, assertThrows, assertAll (multiple in one)
- [ ] Parameterized tests: @ParameterizedTest + @ValueSource / @CsvSource / @MethodSource
- [ ] Mockito: @Mock + @InjectMocks + @ExtendWith(MockitoExtension)
- [ ] Stubbing: when/thenReturn, thenThrow, thenAnswer, doNothing/doThrow
- [ ] Argument matchers: any() / eq() / argThat() — правило «все или ни одного matcher»
- [ ] Verify: times / never / atLeast / inOrder
- [ ] ArgumentCaptor для проверки переданных значений
- [ ] Spy — частичный мок
- [ ] AAA / Given-When-Then структура

---

## Модуль 4: Integration & Contract Testing

📖 Теория: [theory/TESTING.md](theory/TESTING.md)

- [ ] @SpringBootTest + @Transactional (rollback per test)
- [ ] TestContainers: PostgreSQLContainer, KafkaContainer, RedisContainer
- [ ] @DynamicPropertySource для подключения к контейнеру
- [ ] REST-Assured — функциональный API тест
- [ ] Contract testing (Pact) — consumer-driven contracts для микросервисов
- [ ] WireMock — стабы HTTP downstream'ов

---

## Модуль 5: Non-Functional Testing

📖 Теория: [theory/TESTING.md](theory/TESTING.md)

- [ ] Performance: Load / Stress / Soak / Spike / Volume — разные цели
- [ ] k6 — JS DSL, threshold-based pass/fail, CI/CD friendly
- [ ] Gatling / JMeter / Locust / wrk — альтернативы
- [ ] Метрики: throughput (RPS), latency p50/p95/p99, error rate, saturation point
- [ ] Security: SAST (SonarQube, SpotBugs, Semgrep) vs DAST (ZAP, Burp)
- [ ] OWASP Top 10 — что тестировать: BrokenAccess / Crypto / Injection / Auth / Logging
- [ ] Chaos engineering: Chaos Monkey / Chaos Mesh / Litmus / Gremlin
- [ ] Типы сбоев: network partition, latency injection, pod kill, CPU/memory pressure

---

## Модуль 6: Coverage & Mutation

📖 Теория: [theory/TESTING.md](theory/TESTING.md)

- [ ] JaCoCo — line / branch coverage, цели (~80%)
- [ ] Mutation testing — PIT (Pitest)
- [ ] Mutation score vs coverage — почему 100% coverage может быть плохими тестами
- [ ] Smoke / Regression / Acceptance / BDD (Gherkin / Cucumber)
- [ ] CI/CD pipeline: PR → unit (2min) → integration (10min) → SAST → smoke
- [ ] Testing quadrants (Agile Testing)
