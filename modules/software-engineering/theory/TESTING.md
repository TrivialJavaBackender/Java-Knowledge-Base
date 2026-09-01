# Testing — JUnit & Mockito

## 1. Пирамида тестирования

```
         /\
        /  \
       / E2E\        ← мало, медленно, дорого
      /------\
     /  Integ \      ← умеренно
    /----------\
   /    Unit    \    ← много, быстро, дёшево
  /______________\
```

**Юнит-тесты** — тестируют одну единицу в изоляции (класс, метод). Моки вместо зависимостей. Быстрые, детерминированные.

**Интеграционные тесты** — тестируют взаимодействие нескольких компонентов (сервис + реальная БД, сервис + Kafka). Медленнее, но ловят ошибки на стыках.

**E2E (End-to-End)** — тестируют всю систему через API. Самые медленные и хрупкие. Минимальное количество.

**Антипаттерн "Ice Cream Cone"** — перевёрнутая пирамида: много E2E, мало unit. Тесты медленные, ненадёжные.

---

## 2. JUnit 5 — основные концепции

### Аннотации жизненного цикла

```java
@BeforeAll   // один раз перед всеми тестами в классе (static)
@BeforeEach  // перед каждым тестом
@AfterEach   // после каждого теста
@AfterAll    // один раз после всех тестов (static)
```

### Основные аннотации

```java
@Test           // тестовый метод
@Disabled       // пропустить тест (с причиной)
@DisplayName("Читаемое имя теста")
@Nested         // вложенный класс для группировки связанных тестов
@Tag("slow")    // метка для фильтрации при запуске

@ParameterizedTest
@ValueSource(ints = {1, 2, 3})
void test(int value) { ... }
```

### Assertions

```java
import static org.junit.jupiter.api.Assertions.*;

assertEquals(expected, actual);
assertNotEquals(unexpected, actual);
assertTrue(condition);
assertFalse(condition);
assertNull(value);
assertNotNull(value);

// Проверка исключения:
assertThrows(IllegalArgumentException.class, () -> service.transfer(-100));

// Несколько проверок — все выполняются, даже если одна упала:
assertAll(
    () -> assertEquals("Alice", user.getName()),
    () -> assertEquals(25, user.getAge())
);

// Сообщение при провале (lambda — не вычисляется если тест прошёл):
assertEquals(expected, actual, () -> "Failed for input: " + input);
```

### Параметризованные тесты

```java
@ParameterizedTest
@CsvSource({
    "1, 2, 3",
    "10, 20, 30"
})
void addTest(int a, int b, int expected) {
    assertEquals(expected, calculator.add(a, b));
}

@ParameterizedTest
@MethodSource("provideReservationCases")
void reservationTest(LocalDate date, TimeSlot slot, boolean expected) { ... }

static Stream<Arguments> provideReservationCases() {
    return Stream.of(
        Arguments.of(LocalDate.now(), new TimeSlot(10, 12), true),
        Arguments.of(LocalDate.now(), new TimeSlot(11, 13), false) // пересечение
    );
}
```

---

## 3. Mockito — основные концепции

### Создание моков

```java
// Через аннотацию (нужен MockitoExtension):
@ExtendWith(MockitoExtension.class)
class ReservationServiceTest {
    @Mock
    ReservationRepository repository;

    @InjectMocks
    ReservationService service; // зависимости инжектятся автоматически
}

// Или явно:
ReservationRepository repository = mock(ReservationRepository.class);
```

### Настройка поведения (Stubbing)

```java
// when().thenReturn() — базовый случай
when(repository.findByDate(date)).thenReturn(List.of(reservation1));

// thenThrow — выбросить исключение
when(repository.save(any())).thenThrow(new RuntimeException("DB error"));

// thenAnswer — сложная логика
when(repository.findById(anyInt())).thenAnswer(invocation -> {
    int id = invocation.getArgument(0);
    return id > 0 ? Optional.of(new Table(id)) : Optional.empty();
});

// doReturn/doThrow — для void-методов и spy:
doNothing().when(repository).delete(any());
doThrow(new RuntimeException()).when(repository).delete(null);
```

### Argument Matchers

```java
any()          // любой объект (не null)
any(Class.class) // объект конкретного типа
anyInt(), anyString(), anyList() // примитивы и коллекции
eq(value)      // точное совпадение (обязателен если другие аргументы — матчеры)
isNull()
isNotNull()
argThat(predicate) // кастомное условие

// Все аргументы должны быть матчерами или значениями:
// НЕЛЬЗЯ: when(repo.find(1, any())) — смешивать нельзя
// НУЖНО:  when(repo.find(eq(1), any()))
```

### Verify — проверка вызовов

```java
verify(repository).save(reservation); // вызван ровно 1 раз с этим аргументом
verify(repository, times(2)).save(any());
verify(repository, never()).delete(any());
verify(repository, atLeast(1)).findByDate(any());
verify(repository, atMost(3)).findByDate(any());

// Проверить, что больше никаких взаимодействий не было:
verifyNoMoreInteractions(repository);

// Порядок вызовов:
InOrder inOrder = inOrder(repository, eventBus);
inOrder.verify(repository).save(reservation);
inOrder.verify(eventBus).publish(any());
```

### Capture — захват аргументов

```java
ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
verify(repository).save(captor.capture());
Reservation saved = captor.getValue();
assertEquals(tableId, saved.getTableId());
```

### Spy — частичный мок

```java
ReservationService spyService = spy(new ReservationService(repository));

// Реальный метод, кроме getDefaultSlot:
doReturn(new TimeSlot(10, 22)).when(spyService).getDefaultSlot();
```

---

## 4. Практические паттерны

### Структура теста — Given/When/Then (AAA)

```java
@Test
void makeReservation_whenTableAvailable_savesReservation() {
    // Given (Arrange)
    LocalDate date = LocalDate.of(2026, 4, 8);
    when(repository.findByDate(date)).thenReturn(Collections.emptyList());

    // When (Act)
    service.makeReservation(date, new TimeSlot(10, 12), tableId, 2);

    // Then (Assert)
    ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
    verify(repository).save(captor.capture());
    assertEquals(tableId, captor.getValue().getTableId());
}
```

### Тестирование исключений

```java
@Test
void transfer_whenInsufficientBalance_throwsException() {
    when(accountRepository.findById(fromId)).thenReturn(Optional.of(new Account(fromId, BigDecimal.ONE)));
    when(accountRepository.findById(toId)).thenReturn(Optional.of(new Account(toId, BigDecimal.ZERO)));

    IllegalStateException ex = assertThrows(
        IllegalStateException.class,
        () -> bankService.transfer(idempotencyKey, fromId, toId, BigDecimal.TEN)
    );
    assertTrue(ex.getMessage().contains("Insufficient balance"));
}
```

### Тестирование конкурентности

```java
@Test
void makeReservation_concurrent_noDoubleBooking() throws InterruptedException {
    int threads = 10;
    CountDownLatch latch = new CountDownLatch(threads);
    AtomicInteger successCount = new AtomicInteger(0);

    ExecutorService executor = Executors.newFixedThreadPool(threads);
    for (int i = 0; i < threads; i++) {
        executor.submit(() -> {
            try {
                service.makeReservation(date, slot, tableId, 2);
                successCount.incrementAndGet();
            } catch (NoAvailableTimeSlotException e) {
                // ожидаемо для конкурирующих
            } finally {
                latch.countDown();
            }
        });
    }

    latch.await(5, TimeUnit.SECONDS);
    assertEquals(1, successCount.get()); // только один успех
}
```

### Интеграционный тест с @SpringBootTest

```java
@SpringBootTest
@Transactional
class ReservationServiceIntegrationTest {

    @Autowired
    ReservationService service;

    @Autowired
    ReservationRepository repository;

    @Test
    void makeReservation_persists() {
        service.makeReservation(date, slot, tableId, 2);
        List<Reservation> found = repository.findByDate(date);
        assertEquals(1, found.size());
    }
    // @Transactional откатит изменения после каждого теста
}
```

---

## 5. Что мокать, а что нет

**Мокать:**
- Внешние зависимости: repository, HTTP-клиенты, email-сервисы
- Медленные операции: БД, файловая система
- Недетерминированные вещи: `Clock`, `Random`, UUID-генераторы

**Не мокать:**
- Value objects и простые классы без side-эффектов
- Сам тестируемый объект (тестируешь мок — не тестируешь ничего)
- БД в интеграционных тестах — используй реальную (H2 / TestContainers)

**TestContainers** — запуск реального PostgreSQL в Docker для интеграционных тестов:
```java
@Container
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

@DynamicPropertySource
static void configure(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", postgres::getJdbcUrl);
}
```

---

## 6. Виды тестирования

### Функциональное тестирование

Проверяет **что** система делает — соответствие функциональным требованиям.

| Уровень | Инструменты | Пример |
|---------|------------|--------|
| Unit | JUnit 5, Mockito | Тест метода `calcDiscount()` |
| Integration | SpringBootTest, TestContainers | Тест `OrderService` с реальной БД |
| API / Contract | REST-Assured, WireMock, Pact | Тест HTTP эндпоинта `/api/orders` |
| E2E | Selenium, Playwright, Cypress | Пользователь оформляет заказ в браузере |

```java
// REST-Assured: функциональный API тест
@Test
void createOrder_returns201() {
    given()
        .contentType(ContentType.JSON)
        .body("""{"item":"book","quantity":1}""")
    .when()
        .post("/api/orders")
    .then()
        .statusCode(201)
        .body("status", equalTo("PENDING"))
        .body("id", notNullValue());
}
```

**Contract Testing (Pact):** проверяет, что consumer и provider согласны с API контрактом. Consumer публикует контракт, Provider его верифицирует. Позволяет тестировать микросервисы независимо.

---

### Нефункциональное тестирование

Проверяет **как** система работает: производительность, безопасность, надёжность.

---

### Нагрузочное тестирование

Проверяет поведение системы под нагрузкой.

**Load Testing** — нормальная и пиковая нагрузка. Проверить: выдержит ли 1000 RPS?

**Stress Testing** — превышение максимальной нагрузки. Найти точку отказа. Как система восстанавливается?

**Soak/Endurance Testing** — длительная нагрузка (часы, дни). Выявляет: утечки памяти, накопление соединений, деградацию производительности.

**Spike Testing** — резкий всплеск нагрузки (x10 за секунды). Как autoscaling реагирует?

**Volume Testing** — поведение с большими объёмами данных (БД с 100M записей).

**Инструменты:**
```
k6          — JavaScript, HTTP load testing, хорош для CI/CD
Gatling     — Scala DSL, подробные HTML-отчёты
JMeter      — GUI, много протоколов, enterprise
Locust      — Python, простой для старта
wrk/ab      — быстрые CLI бенчмарки
```

```javascript
// k6 пример:
import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
    vus: 100,           // виртуальных пользователей
    duration: '30s',
    thresholds: {
        http_req_duration: ['p(95)<200'], // 95% запросов < 200ms
        http_req_failed: ['rate<0.01'],   // < 1% ошибок
    },
};

export default function () {
    const res = http.get('http://localhost:8080/api/orders');
    check(res, { 'status 200': (r) => r.status === 200 });
    sleep(1);
}
```

**Метрики нагрузочного тестирования:**
- **Пропускная способность (RPS/TPS)** — запросов/транзакций в секунду
- **Задержка p50/p95/p99** — медиана и хвосты распределения
- **Доля ошибок** — процент ошибочных ответов
- **Точка насыщения** — нагрузка при которой деградация начинается
- **Утилизация ресурсов** — CPU, memory, connections

---

### Тестирование безопасности / Пентестинг

**SAST (Static Application Security Testing)** — анализ исходного кода без запуска.

```
SonarQube   — code quality + security rules
SpotBugs + FindSecBugs — Java-специфичные уязвимости
OWASP Dependency Check — уязвимые зависимости (CVE база)
Semgrep     — кастомные паттерны поиска уязвимостей
```

**DAST (Dynamic Application Security Testing)** — тестирование работающего приложения.

```
OWASP ZAP   — автоматический сканер, proxy для ручного тестирования
Burp Suite  — профессиональный proxy для пентестинга
Nikto       — сканер веб-серверов
```

**Penetration Testing (Pentest)** — имитация атак реального злоумышленника. Ручное + автоматизированное.

```
Этапы:
1. Reconnaissance   — сбор информации (nmap, whois, DNS)
2. Scanning         — поиск уязвимостей (OpenVAS, Nessus)
3. Exploitation     — эксплуатация (Metasploit, sqlmap, manual)
4. Post-Exploitation — privilege escalation, lateral movement
5. Reporting        — документирование + рекомендации
```

**OWASP Top 10 — что тестировать:**
| # | Уязвимость | Тест |
|---|-----------|------|
| A01 | Broken Access Control | Попытки доступа без авторизации, IDOR |
| A02 | Cryptographic Failures | Проверить HTTPS, слабые алгоритмы |
| A03 | Injection (SQLi, XSS) | Специальные символы во входных данных |
| A04 | Insecure Design | Отсутствие rate limiting, отсутствие CSRF |
| A05 | Security Misconfiguration | Default passwords, открытые порты, debug в prod |
| A07 | Auth Failures | Brute force, слабые пароли, JWT без проверки |
| A09 | Logging & Monitoring Failures | Отсутствие alerting на аномалии |

```java
// Пример security теста (HTTP-уровень):
@Test
void adminEndpoint_withoutAuth_returns401() {
    given().when().get("/api/admin/users").then().statusCode(401);
}

@Test
void adminEndpoint_withUserRole_returns403() {
    given()
        .header("Authorization", "Bearer " + userToken)
    .when()
        .get("/api/admin/users")
    .then()
        .statusCode(403);
}
```

---

### Тестирование надёжности

**Chaos Engineering** — намеренное введение сбоев в production-like окружении для проверки устойчивости.

```
Chaos Monkey (Netflix) — случайно убивает инстансы
Chaos Mesh (K8s)       — network delay, pod failure, CPU stress
Gremlin                — managed chaos platform
Litmus                 — K8s native chaos
```

**Типы сбоев:**
- **Network partition** — сетевое разделение между сервисами
- **Latency injection** — добавление задержки к ответам
- **Pod kill** — убийство K8s pod
- **CPU/Memory pressure** — искусственная нагрузка на ресурсы
- **Disk failure** — недоступность диска

```yaml
# Chaos Mesh: добавить 200ms latency к OrderService
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: order-latency
spec:
  action: delay
  mode: all
  selector:
    labelSelectors:
      app: order-service
  delay:
    latency: "200ms"
    correlation: "25"
    jitter: "50ms"
```

---

### Дымовое тестирование

Минимальный набор тестов после деплоя: "система жива?"

```bash
# Простой smoke test после деплоя:
curl -f http://service/health || exit 1
curl -f http://service/api/products?limit=1 || exit 1
```

Обычно 5-15 минут. Если smoke провалился → откат.

---

### Регрессионное тестирование

Проверяет, что новые изменения не сломали существующую функциональность.

Автоматизированные: unit + integration suite в CI/CD. При каждом PR.

---

### Приёмочное тестирование / UAT

Бизнес верифицирует, что система делает то, что требовалось. Обычно перед production release.

**BDD (Behavior-Driven Development):**
```gherkin
Feature: Place Order
  Scenario: Successful order placement
    Given user has item "book" in cart
    And user has sufficient balance
    When user clicks "Place Order"
    Then order status is "CONFIRMED"
    And balance is reduced by item price
```

Инструменты: Cucumber (Java), Behave (Python), SpecFlow (.NET).

---

### Мутационное тестирование

Вводит намеренные ошибки в код (мутанты), проверяет что тесты их ловят. Мера качества тестов.

```java
// Оригинал:
if (balance >= amount) { ... }

// Мутант (изменение оператора):
if (balance > amount)  { ... }  // мутант выжил → тест не поймал граничный случай
```

Инструменты: **PIT (Pitest)** для Java:
```xml
<plugin>
    <groupId>org.pitest</groupId>
    <artifactId>pitest-maven</artifactId>
    <configuration>
        <mutationThreshold>80</mutationThreshold>
    </configuration>
</plugin>
```

---

## 7. Стратегия тестирования в команде

### Квадранты тестирования (Agile Testing)

```
         Critique Product       Support Team
         ─────────────────────────────────────
Manual   │  Exploratory    │  Usability        │
         │  UAT             │  A/B Testing      │
         ──────────────────────────────────────
Automated│  Performance    │  Unit             │
         │  Security       │  Integration      │
         │                 │  E2E              │
         ─────────────────────────────────────
           Business-Facing   Technology-Facing
```

### CI/CD пайплайн

```
PR →  [Unit tests: 2min]
   →  [Integration tests: 10min]
   →  [Security scan (SAST): 5min]
   →  Deploy to staging
   →  [Smoke tests: 3min]
   →  [Performance tests: 20min] (опционально, ночью)
   →  [E2E tests: 15min]
   →  Deploy to production
   →  [Smoke tests: 3min]
```

### Покрытие тестами

**Покрытие кода** — процент строк/ветвей покрытых тестами. Инструмент: JaCoCo.

```
Типичные цели:
  Unit: 80%+ coverage основной бизнес-логики
  Integration: критичные пути
  E2E: happy path + основные error paths
```

**Важно:** 100% coverage ≠ хорошие тесты. Мутационное тестирование эффективнее.

```java
// JaCoCo в pom.xml:
<plugin>
    <groupId>org.jacoco</groupId>
    <artifactId>jacoco-maven-plugin</artifactId>
    <configuration>
        <rules>
            <rule>
                <limits>
                    <limit>
                        <counter>LINE</counter>
                        <minimum>0.80</minimum>
                    </limit>
                </limits>
            </rule>
        </rules>
    </configuration>
</plugin>
```

---

## Источники

**Официальная документация:**
- [JUnit 5 User Guide](https://junit.org/junit5/docs/current/user-guide/) — assertions, parameterized tests, extensions.
- [Mockito Documentation](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html) — argument matchers, BDD-style, `verify`, `ArgumentCaptor`.
- [Testcontainers Documentation](https://testcontainers.com/) — JUnit 5 integration, modules для Postgres/Kafka/Redis.
- [Pact (Consumer-Driven Contracts) — Pact Foundation](https://docs.pact.io/) — contract testing.
- [k6 Documentation](https://grafana.com/docs/k6/latest/) — load testing, thresholds, executors.

**Книги:**
- *Test Driven Development by Example* (Kent Beck, Addison-Wesley 2002) — оригинал TDD.
- *Growing Object-Oriented Software, Guided by Tests* (Steve Freeman, Nat Pryce, 2009) — мокинг, hexagonal architecture.
- *Effective Software Testing* (Maurício Aniche, Manning 2022) — современный сборник практик.
- *Agile Testing* (Lisa Crispin, Janet Gregory, 2009) — testing quadrants, BDD, exploratory testing.

**Articles / talks:**
- [Martin Fowler — «Test Pyramid»](https://martinfowler.com/bliki/TestPyramid.html) — оригинал концепции от Mike Cohn / Fowler.
- [Martin Fowler — «Mocks Aren't Stubs»](https://martinfowler.com/articles/mocksArentStubs.html) — классификация test doubles.
- [Mike Cohn — «The Forgotten Layer of the Test Automation Pyramid»](https://www.mountaingoatsoftware.com/blog/the-forgotten-layer-of-the-test-automation-pyramid)
- [Google Testing Blog — «Just Say No to More End-to-End Tests»](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)

**Security / Chaos / NFT:**
- [OWASP Top 10 (2021)](https://owasp.org/Top10/) и [OWASP Testing Guide v4](https://owasp.org/www-project-web-security-testing-guide/v42/).
- [Principles of Chaos Engineering](https://principlesofchaos.org/) — Netflix-style chaos engineering manifesto.
- [«Chaos Engineering: System Resiliency in Practice» (Casey Rosenthal, Nora Jones, O'Reilly 2020)](https://www.oreilly.com/library/view/chaos-engineering/9781492043861/).
- [PIT (Pitest) Documentation](https://pitest.org/) — mutation testing для Java.
