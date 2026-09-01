# Interview Questions — Software Engineering

Вопросы по SOLID, OOP, функциональному программированию (Stream API + FP-принципы), и тестированию.

> **Историческая справка:** Q1–Q4 ранее жили в `system-design/INTERVIEW_QUESTIONS.md` как Q29–Q32 (Functional Programming). Q5+ — новые.

---

## Функциональное программирование (Q1–Q4)

### Q1: Что такое Higher-Order Function?
**A:** Функция, которая принимает функцию как аргумент или возвращает функцию. Следствие first-class functions (функции — значения первого класса). В Java: `Stream.map(Function)`, `Function.andThen(Function)`, `Comparator.comparing(KeyExtractor)`, любая фабрика лямбд. Польза: композиция и абстракция над поведением без наследования — вместо template method в иерархии классов передаём стратегию как функцию.
> theory/STREAM_API_FP.md §7

### Q2: Зачем в Java 8 появились default методы?
**A:** Чтобы эволюционировать `Collection` API без нарушения обратной совместимости. Добавить `Collection.stream()` как abstract сломало бы все классы, реализующие `Collection` напрямую (включая чужой код в библиотеках). Default метод даёт реализацию прямо в интерфейсе, наследуется автоматически. Эта же фича включила functional-style утилиты: `Predicate.and/or`, `Function.compose/andThen`, `Comparator.thenComparing`. Diamond problem (два интерфейса с одинаковой сигнатурой default) — ошибка компиляции, нужно явно override и можно делегировать через `InterfaceA.super.method()`. Java допустила множественное наследование поведения, но не состояния.
> theory/STREAM_API_FP.md §7

### Q3: Что такое Referential Transparency и зачем она нужна?
**A:** Выражение ссылочно-прозрачно (referentially transparent), если его можно заменить результатом без изменения поведения программы. Эквивалентно: pure function + immutable inputs. Польза: компилятор/runtime могут мемоизировать, переупорядочивать, выполнять параллельно без гонок данных; код проще рассуждать о нём (equational reasoning — подставлять равные на равные). Нарушают RT: `Random`, `System.currentTimeMillis`, любой IO, обращение к мутабельному разделяемому состоянию.
> theory/STREAM_API_FP.md §7

### Q4: Поддерживает ли JVM Tail Call Optimization?
**A:** Нет. Глубокая хвостовая рекурсия → `StackOverflowError`. Причины: верификатор байткода рассчитывает на честный стек, `SecurityManager` должен видеть полный stack trace, бинарная совместимость. Workarounds: переписать в цикл, trampoline pattern (вернуть `Thunk`, разворачивать в `while`), Kotlin `tailrec` (компилятор Kotlin сам превращает в цикл на уровне байткода — JVM ничего не знает). JEP 416 предлагал TCO — не принят.
> theory/STREAM_API_FP.md §7

---

## SOLID (Q5–Q9)

### Q5: Что такое Single Responsibility Principle и как его понять правильно?
**A:** «Класс должен иметь одну причину для изменения», а не «класс должен делать одну вещь». Причина = ось изменчивости, конкретный стейкхолдер/use case. Пример: `Report` класс с методами `calculate()` и `print()` нарушает SRP, потому что меняется и при изменении формулы (расчёты), и при изменении формата вывода (UI) — это разные стейкхолдеры. Разделить на `ReportCalculator` (логика расчётов) и `ReportPrinter` (UI). SRP анализируется через вопрос «кто будет требовать изменения?».
> theory/SOLID_OOP.md §1

### Q6: Расскажите про LSP — приведите классический контрпример.
**A:** Liskov Substitution: подтип заменяется супертипом без нарушения корректности. Контракты: precondition не усиливать, postcondition не ослаблять, invariants сохранять, не бросать новые исключения. Классический контрпример — `Square extends Rectangle`: `Rectangle.setWidth(5)` оставляет height нетронутым, `Square.setWidth(5)` меняет и height (иначе нарушит инвариант width == height). Код, который полагается на Rectangle-поведение (`assert r.area() == width * height` после `setWidth/setHeight`), ломается при подстановке Square. Решение: общий интерфейс `Shape` без операций, которые не работают для всех subtype.
> theory/SOLID_OOP.md §3

### Q7: Что такое Open/Closed Principle? Приведите пример рефакторинга от if-else к OCP.
**A:** Открыт для расширения (нового кода), закрыт для модификации (правки существующего). Пример: метод `calcDiscount(Order)` с `if order.type == STUDENT / VIP / ...` — каждый новый тип скидки = правка метода (нарушение OCP). Рефакторинг к Strategy:
```java
interface DiscountStrategy { double apply(Order order); }
class StudentDiscount implements DiscountStrategy { ... }
class VipDiscount implements DiscountStrategy { ... }
// Регистрация: Map<OrderType, DiscountStrategy>
```
Новый тип = новый класс, метод не трогаем. Компромисс: добавляет оверхед абстракции, оправдан когда есть >3 типов или ожидается расширение.
> theory/SOLID_OOP.md §2

### Q8: DIP — это про DI (Dependency Injection)?
**A:** Не совсем. DI — это **техника** (внедрение зависимости в конструктор / setter / interface). DIP — это **принцип**: высокоуровневые модули зависят от абстракций (интерфейсов), а не от конкретных деталей. DI — один из способов **реализовать** DIP. Можно использовать DI без DIP (внедрять конкретный класс — нарушает DIP). Можно следовать DIP без DI (factory pattern, service locator — но это хуже DI). В Spring `@Autowired` обычно использует и DIP (на интерфейс), и DI (через конструктор).
> theory/SOLID_OOP.md §5

### Q9: ISP — приведите пример узких vs толстых интерфейсов.
**A:** Толстый: `interface Worker { void work(); void eat(); void sleep(); }`. Класс `Robot` реализует `Worker` — вынужден реализовать `eat()` через `throw UnsupportedOperationException()` (LSP violation, ISP пинает Robot к Worker). Решение — узкие интерфейсы: `Workable`, `Eatable`, `Sleepable`. `Robot implements Workable`, `Human implements Workable, Eatable, Sleepable`. ISP реализуется на этапе моделирования API — лучше начать с минимума и добавлять, чем удалять методы из публичного интерфейса.
> theory/SOLID_OOP.md §4

### Q23: Всегда ли третьесторонняя библиотека (Jackson, JDBC-драйвер) должна быть спрятана за собственным интерфейсом ради DIP?
**A:** Нет, это компромисс, а не догма. Абстракция (`Serializer` над `ObjectMapper`) оправдана, когда: реально ожидается замена реализации, нужен unit-тест сервиса без реального Jackson, или библиотека — деталь инфраструктуры, а не часть публичного контракта домена. Не оправдана, когда библиотека и есть предметная область API (например, `java.util.List` никто не прячет за интерфейсом), проект маленький и замена нереалистична, а цена абстракции (лишний слой, лишний mock в каждом тесте) больше выгоды. Правило: DIP защищает от **изменчивости**, а не от любой конкретики — если конкретный класс не является осью изменения (см. SRP — «кто потребует изменения?»), заворачивать его в интерфейс — это gold-plating, а не архитектура.
> theory/SOLID_OOP.md §6

---

## Stream API & Optional (Q10–Q14, Q24–Q26)

### Q10: В чём разница `map` и `flatMap` в Stream?
**A:** `map(Function<T, R>)` — каждый элемент → один элемент типа R. `flatMap(Function<T, Stream<R>>)` — каждый элемент → stream из 0+ элементов R, все объединяются в один поток. Пример: `List<List<String>>` → `flatMap(List::stream)` → `Stream<String>`. Сценарии применения flatMap: «развернуть» вложенную структуру, опциональный результат через Optional.stream() (Java 9+), парсинг где из одного входа получается несколько выходов.
> theory/STREAM_API_FP.md §3

### Q11: Когда стоит использовать parallel streams, а когда нет?
**A:** **Стоит**: CPU-intensive операции на больших коллекциях (>10k элементов), операции без состояния/ассоциативные операции, нет разделяемого состояния. Например: численные расчёты, агрегация больших массивов. **НЕ стоит**: IO operations (блокируют `ForkJoinPool.commonPool`, голодание других задач), маленькие коллекции (оверхед на разбиение > выигрыш), при наличии разделяемого мутабельного состояния (race), LinkedList и другие плохо-разбиваемые структуры. Парадокс — `Stream.parallel()` в production коде чаще вредит, чем помогает, потому что разработчики недооценивают оверхед на разбиение.
> theory/STREAM_API_FP.md §6

### Q12: Когда не нужно использовать Optional?
**A:** Антипаттерны: **поля класса** (увеличивает сложность сериализации, избыточно — null уже нулл), **параметры метода** (используй перегрузку или nullable parameter), **в коллекциях** (`List<Optional<T>>` — уродливо), `Optional.get()` без `isPresent` (NoSuchElementException). Правильно: только как **return type** метода, чтобы явно сказать «может не быть значения». Также — операции на Optional через `map`/`flatMap`/`filter`/`orElseGet` вместо if-else.
> theory/STREAM_API_FP.md §5

### Q13: `orElse` vs `orElseGet` — что выбрать?
**A:** `orElse(value)` — value **всегда вычисляется**, даже если Optional не пустой. `orElseGet(Supplier)` — supplier вызывается **только если** Optional пустой (lazy). Разница критична, когда default — дорогая операция: `optional.orElse(loadDefaultFromDb())` всегда лезет в БД, даже когда Optional имеет значение. Для константных значений — без разницы. Правило: для нетривиального default используйте `orElseGet(() -> ...)`.
> theory/STREAM_API_FP.md §5

### Q14: Что такое Collectors.teeing и когда он нужен?
**A:** Java 12+. `teeing(c1, c2, merger)` применяет два коллектора параллельно, потом мержит результаты. Полезно когда нужны min И max за один проход, или sum И count для среднего, без двух раздельных стримов. Альтернатива — `Collectors.summarizingDouble/Int/Long` для статистики.
> theory/STREAM_API_FP.md §4

### Q24: Почему в `((Function<String,String>) String::trim).andThen(String::toUpperCase)` нужен явный cast, а в `list.sort((a, b) -> a.compareTo(b))` — нет?
**A:** Лямбда и method reference — «poly expressions»: у них нет собственного типа, тип им назначает **target-typing** по контексту использования. В `list.sort(...)` контекст один — параметр `Comparator`, компилятор выводит тип однозначно. А `.andThen(...)` — это метод самого функционального интерфейса (`Function`), а не какой-то встроенный метод лямбды; чтобы вызвать метод, компилятору сначала нужно знать, к какому именно интерфейсу принадлежит `String::trim` (`Function`? `UnaryOperator`?), а вызов метода сам по себе не даёт контекста для target-typing, в отличие от передачи аргументом. Поэтому без явного приведения `String::trim.andThen(...)` вообще не компилируется — выражение без назначенного типа не может иметь методов.
> theory/STREAM_API_FP.md §1

### Q25: Почему `list.size() != new HashSet<>(list).size()` — правильный способ проверить дубликаты, а мутация `Set` внутри стрим-операции — антипаттерн, даже если код «работает»?
**A:** Мутация внешнего изменяемого состояния (`Set::add`) внутри лямбды, переданной в стрим-операцию, нарушает контракт Stream API: behavioral parameters должны быть stateless и non-interfering (JavaDoc `Stream`). Пока стрим последовательный, побочный эффект может «случайно» дать верный результат, но это ломается сразу: `parallel()` — несколько потоков одновременно вызывают `add()` на одном `HashSet`, гонка данных; short-circuit операции (`anyMatch`) не обязаны обходить элементы по порядку и ровно по одному разу согласно спецификации, поэтому результат стейтфул-лямбды не детерминирован, даже если сегодняшняя реализация JDK ведёт себя предсказуемо. `list.size() != new HashSet<>(list).size()` этой проблемы не имеет — это чистое сравнение результатов двух независимых вычислений, без побочных эффектов внутри стрима.
> theory/STREAM_API_FP.md §8

### Q26: Чем `findById(id).or(() -> findByEmail(email))` лучше, чем `findById(id).isPresent() ? findById(id) : findByEmail(email)` для fallback между источниками данных?
**A:** `Optional.or(Supplier<? extends Optional<T>>)` (Java 9+) вызывает `findByEmail` только если первый `Optional` пуст — по духу как `orElseGet`, но результат остаётся внутри `Optional`-цепочки, а не разворачивается раньше времени. Тернарник вызывает `findById(id)` **дважды** (два похода в БД вместо одного) и разворачивает `Optional` до применения дальнейших операций (`.filter(User::isActive)` в цепочке), что требует промежуточной переменной и ломает fluent-стиль. `or()` даёт один вызов на каждый источник, ленивость второго источника и композицию с `map`/`filter` без выхода из `Optional`.
> theory/STREAM_API_FP.md §8

---

## Testing (Q15–Q22, Q27–Q32)

### Q15: Что такое testing pyramid и почему «ice cream cone» — антипаттерн?
**A:** Pyramid (Cohn): много **юнит**-тестов (быстрые, изолированные, моки), умеренно **интеграционных** (с реальными зависимостями: БД, Kafka через TestContainers), мало **E2E** (через UI / API). Ice cream cone — перевёрнутая: много E2E, мало юнит. Проблема ICC: тесты медленные (минуты), хрупкие (любое UI-изменение ломает), сложно дебажить (режим сбоя неясен), стоят дорого в поддержке. Pyramid даёт быструю обратную связь (юнит за секунды) + доверие (E2E проверяет важные сценарии целиком).
> theory/TESTING.md §1

### Q16: В чём разница Mock, Stub и Spy?
**A:** Терминология Fowler/Meszaros: **Stub** — provides canned answers (`when(x).thenReturn(y)` без verify); **Mock** — настроен с **expectations** + verify (`verify(mock).method()`); **Spy** — real object с возможностью override отдельных методов (`spy(realObj)`, `doReturn(...).when(spy).method()`). Mockito API: `mock()` — для stub/mock роли (можно `verify` или не делать), `spy()` — для partial mocking. Антипаттерн: spy реального объекта для проверки внутренней логики — это смешивает unit-testing с implementation details.
> theory/TESTING.md §3

### Q17: Зачем нужен ArgumentCaptor и как его правильно применять?
**A:** Когда метод вызывается с **сложным** аргументом (DTO, Entity), и хочется проверить **его внутренние поля**. Без Captor — нужен `eq(complexObject)` или `argThat(predicate)` (хуже читается). С Captor: `ArgumentCaptor.forClass(Order.class)` → `verify(repo).save(captor.capture())` → `captor.getValue()` — теперь это обычный объект, на котором делаем `assertEquals`. Бонус — `captor.getAllValues()` для нескольких вызовов.
> theory/TESTING.md §3

### Q18: Что такое TestContainers и в чём преимущество над in-memory БД (H2)?
**A:** TestContainers запускает реальные Docker-контейнеры (PostgreSQL, Kafka, Redis, MongoDB и сотни других) в тестах. Преимущества над H2: 1) **реальная БД**, поведение совпадает с prod (диалект SQL, фичи: jsonb, partial index, EXCLUDE constraint, MVCC); 2) ловит prod-specific баги (например, `LIMIT 1 FOR UPDATE SKIP LOCKED` не поддерживается H2); 3) тестирует миграции на реальном движке. Цена: тесты медленнее (3-5 сек startup на контейнер vs мс H2). Решение: общий контейнер на класс/suite, `@Testcontainers(disabledWithoutDocker = true)`.
> theory/TESTING.md §5

### Q19: Что такое contract testing и зачем оно нужно для микросервисов?
**A:** Consumer-driven contracts (Pact). **Consumer** определяет, что он ожидает от **provider** (HTTP request → expected response). Contract публикуется в Pact Broker. Provider при build/CI верифицирует, что его API соответствует контракту. Зачем: тестирует **интеграцию микросервисов без E2E-окружения**. Каждый сервис тестируется независимо, но коллективно гарантируется совместимость. Альтернатива — schema-first (OpenAPI / Protobuf) с проверкой на CI.
> theory/TESTING.md §6

### Q20: В чём разница SAST, DAST и pentest?
**A:** **SAST** (Static Application Security Testing) — анализ исходного кода **без запуска**: SonarQube, SpotBugs+FindSecBugs, Semgrep, OWASP Dependency Check (CVE в зависимостях). Ловит: SQLi, XSS, hardcoded secrets, vulnerable deps. Дёшево, в CI. **DAST** (Dynamic) — тестирует **работающее приложение** через HTTP: OWASP ZAP, Burp Suite. Ловит: auth bypass, misconfig, runtime injection. Медленно, on staging. **Pentest** — ручное+автомат, имитация реальной атаки экспертом. Дорого, периодически (annual). Все три complement, не replace.
> theory/TESTING.md §6

### Q21: Что такое mutation testing и зачем оно если есть покрытие кода?
**A:** Mutation testing вводит **намеренные ошибки** (мутации) в код: меняет `>=` на `>`, `+` на `-`, удаляет вызов метода. Запускает тесты — если тесты **не падают** (мутант «выжил»), тесты не покрывают этот случай. Mutation score (% killed mutants) — реальный показатель качества тестов. Покрытие кода показывает, что строки исполнены, но **не** что результат проверен (можно вызвать метод без assert и покрытие будет 100%). Mutation testing раскрывает пробелы. Tool: PIT (Pitest). Цена: медленнее тестов (запускают весь набор × количество мутаций).
> theory/TESTING.md §6

### Q22: Что такое chaos engineering? Какие виды сбоев инжектируют?
**A:** Намеренное введение сбоев в production-like окружении для проверки устойчивости. Принцип Netflix: «It is much better to fail in front of an audience than to fail in production». Виды: **network partition** (Chaos Mesh, tc), **внедрение задержки** (delay + jitter), **pod kill** (Chaos Monkey), **CPU/memory pressure** (stress-ng), **disk failure**. Цель — найти скрытые зависимости, слабые настройки retry/timeout, отсутствующие запасные варианты **до того как** инцидент в prod. Инструменты: Chaos Monkey (классика Netflix), Chaos Mesh (K8s native), Litmus, Gremlin (managed). Начинают на staging, в зрелых командах — game days в production.
> theory/TESTING.md §6

### Q27: Почему `@BeforeAll`/`@AfterAll` в JUnit 5 обязаны быть static-методами без дополнительных настроек?
**A:** По умолчанию JUnit 5 использует lifecycle `PER_METHOD` — для **каждого** тестового метода создаётся новый экземпляр тестового класса, чтобы изолировать состояние между тестами. `@BeforeAll`/`@AfterAll` должны выполниться один раз для всего класса — до того, как экземпляры вообще начнут создаваться, и после того, как последний из них уничтожен. Если бы это были instance-методы, JUnit пришлось бы создать экземпляр заранее ради одного вызова `@BeforeAll`, что противоречит идее «новый экземпляр на тест». `static` решает проблему: метод не привязан к конкретному инстансу. Обойти это можно через `@TestInstance(Lifecycle.PER_CLASS)` — тогда один экземпляр класса переживает все тесты, `@BeforeAll`/`@AfterAll` могут быть instance-методами, но тогда нужно вручную следить за состоянием полей между тестами: оно больше не сбрасывается автоматически.
> theory/TESTING.md §2

### Q28: Чем `assertAll(...)` отличается от нескольких последовательных вызовов `assertEquals` в одном тесте?
**A:** Обычный `assertEquals`, если проверка не прошла, немедленно бросает `AssertionError` — выполнение теста останавливается, все проверки после упавшей не выполняются и не попадают в отчёт (чинишь и перезапускаешь по одной). `assertAll` выполняет **все** переданные лямбды-проверки независимо от результата предыдущих, собирает все ошибки и в конце бросает одну `MultipleFailuresError` со списком всех несовпадений сразу. Это экономит цикл «запустил → упало → исправил → запустил снова» — особенно когда тест проверяет несколько полей одного объекта, которые логически относятся к одной инвариантности.
> theory/TESTING.md §2

### Q29: Когда для `@ParameterizedTest` использовать `@CsvSource`, а когда `@MethodSource`?
**A:** `@ValueSource` — только один примитивный/строковый параметр. `@CsvSource` — несколько параметров, но только примитивы/строки литералами прямо в аннотации (`"1, 2, 3"`) — удобно для простых числовых таблиц, но аннотации в Java принимают только константы времени компиляции, поэтому произвольный объект туда не положить. `@MethodSource` вызывает статический метод, возвращающий `Stream<Arguments>`, и годится, когда аргументы — сложные объекты (`LocalDate`, кастомные DTO), тестовые данные вычисляются программно, или их слишком много для читаемого литерала. Правило: начинать с `@CsvSource` для простых случаев, переходить на `@MethodSource`, как только параметр — не примитив.
> theory/TESTING.md §2

### Q30: Что не так с тестом на конкурентность, где N задач просто отправляются в `ExecutorService` через `submit()` в цикле — почему он может пропустить реальный race condition?
**A:** `executor.submit()` в цикле не гарантирует, что все потоки стартуют **одновременно** — пока цикл дошёл до отправки последней задачи, первые уже могут успеть выполниться и завершиться, особенно если операция быстрая. Тест вырождается в псевдо-последовательный: гонки, проявляющиеся только при истинно одновременном доступе к общему состоянию, могут ни разу не воспроизвестись, и тест останется зелёным даже при живом баге в коде. `CountDownLatch`, которым дожидаются завершения всех задач, здесь не помогает — он синхронизирует **финиш**, а не старт. Чтобы гарантировать одновременный старт, нужен отдельный «стартовый барьер»: второй `CountDownLatch`/`CyclicBarrier`, который каждая задача ждёт перед началом работы, а тест открывает только после того, как все потоки созданы и готовы.
> theory/TESTING.md §4

### Q31: `@Transactional` в интеграционном тесте автоматически откатывает изменения после теста — от чего это НЕ защищает?
**A:** Rollback откатывает только то, что произошло в той же транзакции/соединении, которую держит тестовый метод. Если тестируемый код внутри вызывает метод с `@Transactional(propagation = REQUIRES_NEW)`, вложенная транзакция коммитится независимо и переживёт откат внешней — данные останутся в БД после теста. То же с любым side effect вне транзакционной семантики: запись в другую БД, отправка сообщения в очередь, вызов внешнего HTTP API, запись в файл — ничего из этого JPA/Spring не откатывает. `@Transactional`-тест хорош для проверки «правильно ли сохранились/выбрались JPA-сущности», но не заменяет explicit cleanup для тестов, где код трогает внешние ресурсы.
> theory/TESTING.md §4

### Q32: Почему в CI/CD пайплайне unit-тесты запускают на каждый PR первыми, а тяжёлые performance-тесты — опционально и ночью, а не сразу после unit?
**A:** Это принцип fail fast: чем раньше и дешевле обнаружена проблема, тем меньше стоит исправление и тем быстрее обратная связь разработчику. Unit-тесты (секунды/минуты, без внешних зависимостей) почти бесплатно ловят большую часть регрессий — незачем тратить 20 минут на performance-тесты, если сломан базовый юнит-тест и PR всё равно не пройдёт review. Порядок пайплайна выстроен по возрастанию стоимости и времени: unit → integration → security scan → deploy staging → smoke → (опционально ночью) performance → E2E. Каждая следующая стадия запускается только если предыдущая, более дешёвая, прошла — это экономит CI-минуты и держит цикл «commit → фидбек» коротким.
> theory/TESTING.md §7

---

## Источники

**SOLID / OOP:**
- *Clean Architecture* (Robert C. Martin, 2017)
- *Effective Java* (Joshua Bloch, 3rd ed., 2018) — Items 18, 64, 42-48
- *Refactoring* (Martin Fowler, 2nd ed., 2018)
- [Liskov, Wing (1994) — «A Behavioral Notion of Subtyping»](https://www.cs.cmu.edu/~wing/publications/LiskovWing94.pdf)

**Stream API / FP:**
- *Modern Java in Action* (Urma, Fusco, Mycroft, 2018)
- [`java.util.stream` JDK 21 Docs](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/package-summary.html)
- [Stuart Marks — «Diving into the Optional class»](https://stuartmarks.wordpress.com/2016/09/27/vjug24-session-on-optional/)

**Testing:**
- *Effective Software Testing* (Maurício Aniche, Manning 2022)
- *Growing Object-Oriented Software, Guided by Tests* (Freeman, Pryce, 2009)
- [Martin Fowler — «Test Pyramid»](https://martinfowler.com/bliki/TestPyramid.html), [«Mocks Aren't Stubs»](https://martinfowler.com/articles/mocksArentStubs.html)
- [JUnit 5 User Guide](https://junit.org/junit5/docs/current/user-guide/), [Mockito Docs](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html)
- [TestContainers Docs](https://testcontainers.com/), [Pact Docs](https://docs.pact.io/)
- [PIT Mutation Testing](https://pitest.org/)
- [Principles of Chaos Engineering](https://principlesofchaos.org/)
- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
