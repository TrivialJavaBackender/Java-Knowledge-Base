# Design Patterns — Структурные паттерны (Structural)

Структурные паттерны отвечают на вопрос «как собрать классы и объекты в более крупные структуры».
Их общий инструмент — **композиция**: почти каждый держит ссылку на другой объект и делегирует ему
работу, а не наследует её. Отсюда главный принцип GoF, который они иллюстрируют, — «предпочитай
композицию наследованию».

| Паттерн | Одной строкой | Что меняет |
|---------|---------------|------------|
| Adapter (адаптер) | согласует несовместимый интерфейс | **интерфейс** объекта |
| Bridge (мост) | разводит абстракцию и реализацию по двум осям | структуру иерархий |
| Composite (компоновщик) | дерево «часть-целое» с единым интерфейсом | форму данных |
| Decorator (декоратор) | добавляет обязанности динамически | **поведение**, интерфейс тот же |
| Facade (фасад) | простая точка входа в подсистему | видимую сложность |
| Flyweight (приспособленец) | разделяет мелкие объекты ради экономии памяти | число объектов |
| Proxy (заместитель) | контролирует доступ к объекту | доступ, интерфейс тот же |

---

## Adapter (адаптер)

**Назначение.** Преобразовать интерфейс класса в другой, которого ждёт клиент, чтобы иначе
несовместимые классы заработали вместе.

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `Target` | целевой интерфейс, к которому программирует клиент |
| `Adaptee` | существующий класс с «неудобным» интерфейсом, менять нельзя |
| `Adapter` | реализует `Target`, транслируя вызовы в `Adaptee` |
| `Client` | работает только с `Target` |

**Две формы (важно на собеседовании).**

- **Object adapter** — через **композицию**: адаптер держит ссылку на `Adaptee`. Работает с любыми
  подтипами `Adaptee`, гибче, позволяет несколько адаптеров. Предпочтителен.
- **Class adapter** — через **наследование**: адаптер наследует `Adaptee` и реализует `Target`.
  В Java возможен лишь частично (нет множественного наследования классов): наследуем один
  `Adaptee`, реализуем интерфейс `Target`. Может переопределять методы `Adaptee`, но жёстко привязан
  к конкретному классу.

```java
interface PaymentGateway { void pay(long cents); }              // Target
class LegacyBillingApi { void charge(BigDecimal dollars) { } }  // Adaptee (чужой)

// Object adapter — КОМПОЗИЦИЯ (предпочтительно)
class BillingObjectAdapter implements PaymentGateway {
    private final LegacyBillingApi legacy;                       // держим ссылку
    BillingObjectAdapter(LegacyBillingApi legacy) { this.legacy = legacy; }
    public void pay(long cents) { legacy.charge(BigDecimal.valueOf(cents, 2)); }
}
// Class adapter — НАСЛЕДОВАНИЕ
class BillingClassAdapter extends LegacyBillingApi implements PaymentGateway {
    public void pay(long cents) { charge(BigDecimal.valueOf(cents, 2)); }
}
```

**Когда применять.** Нужно вставить существующий (часто сторонний) класс, а его интерфейс не
совпадает с вашим. Adapter изолирует зависимость за вашим интерфейсом — её потом легко заменить.

**Подводные камни.** Адаптер только транслирует; добавляет поведение — это уже Decorator, скрывает
целую подсистему — это уже Facade. Двусторонний адаптер удобен, но усложняет тестирование.

**Реальные примеры.** `java.io.InputStreamReader` адаптирует `InputStream` (байты) к `Reader`
(символы); `java.util.Arrays.asList` — массив к `List`; Spring MVC `HandlerAdapter` приводит разные
типы обработчиков к единому вызову `DispatcherServlet`. Разбор Adapter в контексте SOLID (пример
`Jackson` → интерфейс `Serializer`) принадлежит
[software-engineering/SOLID_OOP.md](../../software-engineering/theory/SOLID_OOP.md) — здесь не дублируется.

---

## Bridge (мост)

**Назначение.** Разделить абстракцию и её реализацию так, чтобы они изменялись **независимо**:
вместо одной комбинаторно растущей иерархии — две отдельные, связанные ссылкой-«мостом».

**Проблема.** Уведомления `{Срочное, Обычное}` × каналы `{Email, SMS, Push}` при наследовании дают
2×3 = 6 классов, и новый канал их удваивает. Bridge разводит две оси и оставляет 2 + 3 класса.

**Участники.** `Abstraction` (хранит ссылку на реализатора), `RefinedAbstraction`,
`Implementor` (реализатор — интерфейс низкоуровневых операций), `ConcreteImplementor`.

```
Abstraction ──(мост, композиция)──► Implementor
     ▲                                    ▲
 RefinedAbstraction              ConcreteImplementorA/B
```

```java
interface MessageSender { void send(String title, String body); }        // Implementor
class EmailSender implements MessageSender { public void send(String t, String b) { } }
class SmsSender   implements MessageSender { public void send(String t, String b) { } }

abstract class Notification {                                             // Abstraction
    protected final MessageSender sender;                                // МОСТ к реализации
    protected Notification(MessageSender sender) { this.sender = sender; }
    abstract void notifyUser(String text);
}
class UrgentNotification extends Notification {
    UrgentNotification(MessageSender s) { super(s); }
    void notifyUser(String text) { sender.send("СРОЧНО", text); }        // оси комбинируются
}
```

**Когда применять.** Две (и более) независимые оси изменчивости; нужно избежать взрывного роста
классов; реализацию хочется подменять в рантайме.

**Подводные камни.** Bridge проектируют **заранее**, зная обе оси; Adapter — постфактум, чтобы
примирить готовые классы. Структурно Bridge похож на Strategy (ссылка на интерфейс), но различие
в намерении: Bridge — про структуру двух иерархий, Strategy — про взаимозаменяемый алгоритм.

**Реальные примеры.** `JDBC`: `java.sql.Driver` — реализатор, код через `DriverManager` работает с
абстракцией, не зная конкретного драйвера; `SLF4J`: API логирования (абстракция) и привязки-биндинги
к `Logback`/`Log4j2` (реализаторы) — классический мост.

---

## Composite (компоновщик)

**Назначение.** Собрать объекты в древовидную структуру «часть-целое» и позволить клиенту
обращаться к отдельному объекту и к группе **единообразно**.

**Участники.** `Component` (общий интерфейс), `Leaf` (лист без детей), `Composite` (узел с детьми,
делегирует операцию им), `Client` (работает через `Component`, не различая лист и узел).

```
        Component
        /        \
     Leaf      Composite ──► children: List<Component>  (рекурсия)
```

```java
interface FileNode { long size(); }                 // Component
class Doc implements FileNode {                      // Leaf
    private final long bytes;
    Doc(long bytes) { this.bytes = bytes; }
    public long size() { return bytes; }
}
class Dir implements FileNode {                      // Composite
    private final List<FileNode> children = new ArrayList<>();
    Dir add(FileNode n) { children.add(n); return this; }
    public long size() { return children.stream().mapToLong(FileNode::size).sum(); }
}
```

**Когда применять.** Естественная иерархия «часть-целое» (файловая система, UI-компоненты, дерево
организации, арифметическое выражение), и клиент не должен писать `if (leaf) … else …`.

**Подводные камни.**

- **Прозрачный vs безопасный вариант.** Объявить `add`/`remove` в `Component` — единообразно, но
  методы «протекают» в `Leaf`, где бросают `UnsupportedOperationException`. Объявить только в
  `Composite` — безопасно, но клиенту нужен `instanceof`. Компромисс выбирают осознанно.
- Циклы в дереве ломают рекурсивный обход; `equals`/`hashCode` на рекурсии дороги.

**Реальные примеры.** `java.awt.Container`/`javax.swing.JComponent` содержат другие `Component`;
`org.w3c.dom.Node` (`DOM`-дерево); в Spring — `CompositeCacheManager` и другие `Composite*`-бины.

---

## Decorator (декоратор)

**Назначение.** Динамически, в рантайме, навешивать на объект новые обязанности, не меняя его класс
и сохраняя тот же интерфейс. Гибкая альтернатива наследованию.

**Участники.** `Component` (интерфейс), `ConcreteComponent` (базовый объект), `Decorator` (реализует
`Component` и держит ссылку на вложенный `Component`), `ConcreteDecorator` (добавляет поведение
до/после делегирования).

```
Component ◄──── Decorator ──(обёртка)──► Component (вложенный)
   ▲                ▲
ConcreteComponent  ConcreteDecoratorA/B   ← слои накладываются
```

Ключевая иллюстрация — пакет `java.io`, целиком построенный на Decorator. Базовые
`FilterInputStream`/`FilterReader` — готовые декораторы, каждая обёртка добавляет один аспект:

```java
InputStream in =
    new GZIPInputStream(                    // + распаковка
        new BufferedInputStream(            // + буферизация
            new FileInputStream("data.gz"))); // ConcreteComponent

class UpperCaseReader extends FilterReader {          // свой декоратор поверх базового JDK
    UpperCaseReader(Reader in) { super(in); }
    public int read() throws IOException {
        int c = super.read();                         // делегируем вложенному
        return c == -1 ? c : Character.toUpperCase(c); // + поведение
    }
}
```

**Связь с OCP.** Decorator — эталон принципа открытости/закрытости (Open/Closed): поведение
расширяется добавлением обёртки, существующие классы не трогаются. Разбор OCP — в
[software-engineering/SOLID_OOP.md](../../software-engineering/theory/SOLID_OOP.md).

**Когда применять.** Обязанности добавляются по одной и в разных сочетаниях; наследование дало бы
комбинаторный взрыв подклассов; аспект надо включать/выключать в рантайме.

**Подводные камни.**

- Много мелких классов и «луковичных» цепочек — тяжело отлаживать стек вызовов.
- **Идентичность теряется:** `decorated == original` ложно, `instanceof ConcreteComponent` и вызовы
  специфичных методов не проходят сквозь обёртку. **Порядок обёрток важен** (шифровать→сжимать ≠
  сжимать→шифровать).
- Decorator и Proxy структурно совпадают; различие в намерении: Decorator **добавляет** поведение,
  Proxy **контролирует доступ**. Детали — в COMPARISONS.md.

**Реальные примеры.** `java.io` (`BufferedInputStream`, `GZIPInputStream`);
`java.util.Collections.unmodifiableList`/`synchronizedList`; `javax.servlet.http.HttpServletRequestWrapper`.

---

## Facade (фасад)

**Назначение.** Дать единый упрощённый интерфейс к набору классов подсистемы, скрыв её устройство и
порядок вызовов. В отличие от Adapter, Facade не подгоняется под чужой интерфейс, а проектирует
**новый удобный**.

**Участники.** `Facade` (простая точка входа) и классы подсистемы, к которым он делегирует.

```java
class OrderFacade {                                  // одна точка входа в подсистему
    private final InventoryService inventory = new InventoryService();
    private final PaymentService   payment   = new PaymentService();
    private final ShippingService  shipping  = new ShippingService();
    String placeOrder(String sku, String card, String addr) {
        if (!inventory.inStock(sku)) throw new IllegalStateException("нет на складе");
        payment.charge(card, 1999);                  // прячем оркестрацию
        return shipping.ship(sku, addr);
    }
}
```

**Когда применять.** Подсистема разрослась, у клиентов много точек связи с её деталями; нужен слой,
разграничивающий подсистемы, и удобная точка входа для типовых сценариев.

**Подводные камни.** Facade не запрещает прямой доступ к подсистеме, а лишь предлагает удобный путь.
«God facade», собравший всю логику, становится антипаттерном (см. ANTIPATTERNS.md); протекающий
фасад, возвращающий внутренние типы подсистемы, теряет смысл изоляции.

**Реальные примеры.** Spring `JdbcTemplate`/`RestTemplate` — фасады над многословными `JDBC` и
`HttpURLConnection`; `SLF4J` `LoggerFactory`.

---

## Flyweight (приспособленец)

**Назначение.** Экономно поддерживать огромное число мелких объектов, разделяя их общую часть.
Ключевое разделение состояния:

- **Внутреннее (intrinsic)** — не зависит от контекста, одинаково у многих объектов, хранится внутри
  разделяемого приспособленца и **обязано быть неизменяемым**.
- **Внешнее (extrinsic)** — зависит от контекста, хранится клиентом и **передаётся снаружи** в методы.

**Участники.** `Flyweight` (интерфейс), `ConcreteFlyweight` (разделяемый, хранит intrinsic),
`FlyweightFactory` (кэширует и переиспользует экземпляры), `Client` (хранит extrinsic).

```java
record Glyph(char symbol, String font) {}            // intrinsic — разделяемое, неизменяемое
class GlyphFactory {
    private final Map<String, Glyph> pool = new HashMap<>();
    Glyph get(char c, String font) {                 // один экземпляр на (c, font)
        return pool.computeIfAbsent(c + "|" + font, k -> new Glyph(c, font));
    }
}
void draw(Glyph g, int x, int y) { }                 // extrinsic (позиция) — снаружи, не хранится
```

**Когда применять.** Объектов действительно очень много (миллионы), они дороги по памяти, и большую
часть их состояния можно вынести наружу как внешнее.

**Подводные камни.** Изменяемое intrinsic-состояние при разделении порождает гонки и «протекание»
изменений между несвязанными клиентами. Фабрика общая — её кэш должен быть потокобезопасным. Паттерн
усложняет код и оправдан только при доказанном давлении на память.

**Реальные примеры в JDK.** String pool (`String.intern()`, литералы разделяются) и кэш
`Integer.valueOf` для −128…127 (а также `Boolean`, `Character` ≤ 127, короткие `Long`). Отсюда
ловушка автоупаковки: `Integer.valueOf(127) == Integer.valueOf(127)` истинно (один разделяемый
объект), а для `128` уже ложно. Механику пула и кэша см. в
[java-core/STRING_INTERNALS.md](../../java-core/theory/STRING_INTERNALS.md).

---

## Proxy (заместитель)

**Назначение.** Подставить вместо реального объекта заместителя с **тем же интерфейсом**, чтобы
контролировать доступ к нему: отложить создание, проверить права, обратиться по сети, добавить
подсчёт ссылок.

**Участники.** `Subject` (общий интерфейс), `RealSubject` (настоящий объект), `Proxy` (держит ссылку
на `RealSubject`, управляет доступом), `Client` (работает через `Subject`, не зная о заместителе).

**Виды Proxy.**

| Вид | Что делает |
|-----|-----------|
| Виртуальный (ленивый) | откладывает дорогое создание/загрузку до первого обращения |
| Защитный (protection) | проверяет права доступа перед вызовом |
| Удалённый (remote) | локальный представитель объекта в другом процессе/на другом узле |
| «Умная» ссылка (smart reference) | добавляет действие при доступе: подсчёт ссылок, блокировку, ленивую загрузку |

```java
interface Image { void render(); }                    // Subject
class RealImage implements Image {                     // RealSubject — дорогой
    RealImage(String path) { loadFromDisk(path); }     // тяжёлая операция в конструкторе
    public void render() { }
    private void loadFromDisk(String p) { }
}
class LazyImage implements Image {                     // Виртуальный Proxy
    private final String path;
    private RealImage real;                             // создаётся при первом render()
    LazyImage(String path) { this.path = path; }
    public void render() {
        if (real == null) real = new RealImage(path);   // ленивая инициализация
        real.render();
    }
}
```

Заместителя можно генерировать в рантайме — `java.lang.reflect.Proxy` создаёт объект под набор
интерфейсов, направляя все вызовы в `InvocationHandler`:

```java
Foo proxy = (Foo) Proxy.newProxyInstance(classLoader, new Class<?>[]{ Foo.class },
    (p, method, args) -> { /* до / после + method.invoke(target, args) */ });
```

**Когда применять.** Дорогое создание объекта, доступ по сети, разграничение прав,
кэширование/логирование вокруг вызовов — всё, что нужно сделать «прозрачно» для клиента.

**Подводные камни.** Как и с Decorator, теряется идентичность: `proxy.getClass() != RealSubject.class`,
ломаются `instanceof` и приведение типов, `equals`/`hashCode` надо продумывать отдельно.
Дополнительный уровень косвенности добавляет задержку и усложняет отладку.

**Реальные проявления (ссылками, без дублирования механики).**

- **Динамический прокси в Spring AOP** — `JDK dynamic proxy` (по интерфейсу) и `CGLIB` (подкласс
  байткодом), плюс ловушка self-invocation: [spring-frameworks/SPRING_CORE_DI.md](../../spring-frameworks/theory/SPRING_CORE_DI.md).
- **Ленивый прокси в Hibernate** — подкласс-заместитель и bytecode enhancement для `LAZY`-ассоциаций,
  а также `LazyInitializationException` при обращении после закрытия сессии:
  [hibernate-jpa/FETCHING_NPLUS1.md](../../hibernate-jpa/theory/FETCHING_NPLUS1.md).
- **Удалённый прокси** — stub/skeleton в `Java RMI`.

Отличие Proxy от Decorator (добавляет поведение) и Adapter (меняет интерфейс) — в COMPARISONS.md.

---

## Краткое сравнение четырёх «обёрток»

Полное сравнение с деревом выбора — в COMPARISONS.md, здесь — ориентир:

| Паттерн | Меняет интерфейс? | Намерение |
|---------|-------------------|-----------|
| Adapter | да | согласовать несовместимый интерфейс с существующим клиентом |
| Bridge | нет | заранее развести абстракцию и реализацию на две независимые оси |
| Decorator | нет (тот же) | добавить обязанность динамически, сохранив интерфейс |
| Proxy | нет (тот же) | контролировать доступ к объекту, не меняя его интерфейс |

Мнемоника: Adapter смотрит **назад** (примиряет готовое), Bridge — **вперёд** (проектирует оси),
Decorator **обогащает** объект, Proxy **охраняет** его.

---

## Где почитать дальше

- [INTRO.md](INTRO.md) — таксономия паттернов, UML-нотация, принципы GoF и GRASP.
- [CREATIONAL.md](CREATIONAL.md) — порождающие паттерны (Factory Method, Builder, Singleton…).
- [BEHAVIORAL_1.md](BEHAVIORAL_1.md) — поведенческие (Strategy, State, Template Method, Chain of Responsibility).
- [COMPARISONS.md](COMPARISONS.md) — глубокое сравнение Adapter vs Bridge vs Proxy vs Decorator и других похожих пар.
- [ANTIPATTERNS.md](ANTIPATTERNS.md) — избыточное усложнение (over-engineering), God Object, «паттерн ради паттерна».
- Adapter в контексте SOLID (`Jackson` → `Serializer`): [software-engineering/SOLID_OOP.md](../../software-engineering/theory/SOLID_OOP.md).
- Proxy в Spring AOP (`JDK dynamic proxy` / `CGLIB`, self-invocation): [spring-frameworks/SPRING_CORE_DI.md](../../spring-frameworks/theory/SPRING_CORE_DI.md).
- Proxy в Hibernate (bytecode enhancement, `LazyInitializationException`): [hibernate-jpa/FETCHING_NPLUS1.md](../../hibernate-jpa/theory/FETCHING_NPLUS1.md).
- Flyweight в JDK (String pool, кэш `Integer`): [java-core/STRING_INTERNALS.md](../../java-core/theory/STRING_INTERNALS.md).

---

## Источники

- *Design Patterns: Elements of Reusable Object-Oriented Software* — Gamma, Helm, Johnson, Vlissides (GoF), 1994 — глава «Structural Patterns».
- *Head First Design Patterns* (2nd ed.) — Freeman & Robson — Decorator на примере `java.io`, Adapter, Facade, Proxy.
- *Effective Java* (3rd ed.) — Joshua Bloch — «предпочитай композицию наследованию» (forwarding/обёртки).
- refactoring.guru — иллюстрированный справочник структурных паттернов.
- Официальная документация: пакет `java.io` (Filter-потоки как Decorator), `java.lang.reflect.Proxy`, Spring Framework Reference (раздел «AOP Proxies»).
