# Design Patterns — Поведенческие паттерны I: Strategy, State, Template Method, Chain of Responsibility

Поведенческие паттерны отвечают на вопрос «как распределить обязанности между объектами и
организовать их взаимодействие». Их сквозная идея — заменить ветвление (`if`/`switch`) по типу
или состоянию **полиморфизмом**: вариативное поведение выносится в отдельные объекты или подклассы.
Часть паттернов работает на уровне классов через наследование на этапе компиляции (Template Method),
часть — на уровне объектов через композицию во время выполнения (Strategy, State, Chain of
Responsibility).

| Паттерн | Одной строкой | Что варьирует |
|---------|---------------|---------------|
| Strategy (стратегия) | взаимозаменяемый алгоритм за общим интерфейсом | какой алгоритм выполнить |
| State (состояние) | поведение меняется вместе со сменой внутреннего состояния | поведение по состоянию |
| Template Method (шаблонный метод) | скелет алгоритма фиксирован, шаги переопределяемы | отдельные шаги алгоритма |
| Chain of Responsibility (цепочка обязанностей) | запрос идёт по цепочке обработчиков | кто обработает запрос |

---

## Strategy (стратегия)

**Назначение.** Определить семейство взаимозаменяемых алгоритмов, инкапсулировать каждый в
отдельный класс и сделать их подставляемыми. Клиент выбирает алгоритм, а `Context` использует его
через общий интерфейс, не зная конкретной реализации.

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `Strategy` | общий интерфейс всех алгоритмов |
| `ConcreteStrategy` | конкретная реализация алгоритма |
| `Context` | хранит ссылку на `Strategy` и делегирует ей работу |

```
Client ──► Context ──(композиция)──► Strategy
                                        ▲
                          ConcreteStrategyA / B / C
```

```java
interface DiscountStrategy { long apply(long cents); }             // Strategy

class NoDiscount implements DiscountStrategy {                      // ConcreteStrategy
    public long apply(long c) { return c; }
}
class PercentOff implements DiscountStrategy {
    private final int percent;
    PercentOff(int percent) { this.percent = percent; }
    public long apply(long c) { return c - c * percent / 100; }
}

class Cart {                                                        // Context
    private DiscountStrategy discount = new NoDiscount();           // ссылка на алгоритм
    void setDiscount(DiscountStrategy d) { this.discount = d; }     // подмена во время выполнения
    long checkout(long subtotalCents) { return discount.apply(subtotalCents); }
}
```

В Java 8+ функциональную стратегию удобно передавать лямбдой — отдельный класс не нужен:

```java
Cart cart = new Cart();
cart.setDiscount(c -> c - 500);          // стратегия как лямбда: интерфейс функциональный
```

**Связь с OCP (объектная замена `switch`/`if`).** Разрастающийся `switch` по «типу скидки» —
классический запах: каждый новый вариант правит один и тот же метод. Strategy заменяет ветку `switch`
на полиморфный вызов: новый алгоритм — это новый класс, а не редактирование существующего кода. Это
прямая иллюстрация принципа открытости/закрытости (Open/Closed). Разбор OCP —
[software-engineering/SOLID_OOP.md](../../software-engineering/theory/SOLID_OOP.md).

**Когда применять.** Есть несколько вариантов одного действия (расчёт цены, сжатие, маршрут,
сортировка), и их нужно выбирать или менять во время выполнения; хочется убрать ветвление по типу
поведения; алгоритмы нужно тестировать изолированно.

**Подводные камни.**

- Клиент **обязан знать** доступные стратегии, чтобы выбрать нужную, — паттерн не прячет сам выбор.
- Много мелких классов ради одного метода; если вариантов два и они не меняются, `switch` проще.
- Передача контекста в стратегию: если алгоритму нужны данные `Context`, их либо передают
  параметрами, либо стратегия получает ссылку на `Context` — растёт связанность.

**Реальные примеры.** `Comparator`, переданный в `Collections.sort` / `Arrays.sort` / `Stream.sorted`,
— это стратегия сравнения; `RejectedExecutionHandler` в `ThreadPoolExecutor` — стратегия обработки
переполнения; интерфейсы `java.util.function` (`Function`, `Predicate`) — стратегии в виде лямбд. В
Spring — стратегии `PasswordEncoder`, `HandlerMapping`. Глубокое сравнение State vs Strategy
(одинаковая структура, разное намерение) — в COMPARISONS.md.

---

## State (состояние)

**Назначение.** Позволить объекту менять поведение при изменении его внутреннего состояния так,
будто меняется его класс. Каждое состояние — отдельный объект; `Context` делегирует ему вызовы и
переключает текущее состояние.

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `State` | интерфейс поведения, зависящего от состояния |
| `ConcreteState` | поведение для конкретного состояния + правила перехода |
| `Context` | хранит ссылку на текущий `State`, делегирует ему, допускает смену состояния |

```
Context ──(текущее состояние)──► State
                                    ▲
                    Draft / Moderation / Published   (переходы между собой)
```

```java
interface DocState { void publish(Document doc); }                 // State

class Draft implements DocState {                                  // ConcreteState
    public void publish(Document doc) { doc.setState(new Moderation()); }  // переход
}
class Moderation implements DocState {
    public void publish(Document doc) { doc.setState(new Published()); }
}
class Published implements DocState {
    public void publish(Document doc) { /* уже опубликован — переход не нужен */ }
}

class Document {                                                    // Context
    private DocState state = new Draft();                           // текущее состояние
    void setState(DocState s) { this.state = s; }                   // смена состояния
    void publish() { state.publish(this); }                        // делегируем текущему состоянию
}
```

Один и тот же вызов `document.publish()` ведёт себя по-разному в зависимости от состояния — без
единого `switch (status)`, разбросанного по каждому методу `Document`.

**Кто владеет переходами.** Два варианта: переходы задаёт сам `ConcreteState` (как выше — состояние
знает своих преемников) либо `Context` (централизованная таблица переходов). Первый гибче, но
связывает состояния между собой; второй проще проследить, но `Context` разрастается.

**Когда применять.** Поведение объекта существенно зависит от состояния, состояний много, и в каждом
методе появляется одинаковый `switch`/`if` по полю-статусу; нужен явный конечный автомат
(state machine) с чёткими переходами (заказ, соединение, документ, проигрыватель).

**Подводные камни.**

- **Взрыв числа классов** и связанность: состояния ссылаются друг на друга при переходах.
- Если состояния не хранят собственных изменяемых данных, их делают **разделяемыми** (singleton /
  Flyweight), иначе на каждый переход создаётся лишний объект.
- Легко перепутать с Strategy: структура идентична, но намерение разное — State про смену поведения
  во времени и переходы, Strategy про выбор алгоритма клиентом. Детальное сравнение — в COMPARISONS.md.

**Реальные примеры.** В стандартной библиотеке чистого State мало (это доменный паттерн); близки по
духу жизненный цикл `Thread` (состояния `NEW/RUNNABLE/…`) и `Connection`. Явные реализации —
Spring StateMachine, движки бизнес-процессов, конечные автоматы протоколов (`TCP`-состояния).

---

## Template Method (шаблонный метод)

**Назначение.** Задать скелет алгоритма в методе базового класса, отложив отдельные шаги на
подклассы. Подклассы переопределяют шаги, не меняя структуру и порядок алгоритма.

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `AbstractClass` | шаблонный метод (скелет) + абстрактные примитивные шаги + hook-методы |
| `ConcreteClass` | переопределяет примитивные шаги и при необходимости hook-методы |

```
AbstractClass
  generate()  ← шаблонный метод (final): вызывает шаги в фиксированном порядке
  ├─ fetchData()   abstract   ← примитивная операция (обязательна)
  ├─ format()      abstract
  └─ header()/footer()  hook  ← необязательный, есть дефолт
        ▲
   ConcreteClass  (переопределяет шаги)
```

```java
abstract class ReportGenerator {                                   // AbstractClass
    public final String generate() {                               // шаблонный метод — СКЕЛЕТ, final
        String data = fetchData();                                 // шаг обязателен
        String body = format(data);                                // шаг обязателен
        return header() + body + footer();                         // hook-методы с дефолтом
    }
    protected abstract String fetchData();
    protected abstract String format(String data);
    protected String header() { return ""; }                       // hook: по умолчанию пусто
    protected String footer() { return ""; }                       // hook: переопределять не обязательно
}

class CsvReport extends ReportGenerator {                          // ConcreteClass
    protected String fetchData() { return "a,b,c"; }
    protected String format(String d) { return d.replace(',', '\t'); }
    protected String header() { return "=== CSV ===\n"; }          // переопределили hook
}
```

**Принцип Голливуда.** «Не звоните нам — мы позвоним вам» (Hollywood principle): не подкласс вызывает
базовый класс, а базовый класс из шаблонного метода вызывает переопределённые подклассом шаги. Это
инверсия управления — каркас держит поток исполнения, а расширения встраиваются в предусмотренные
точки. **hook-метод** — необязательная точка расширения с пустой или стандартной реализацией: подкласс
может её переопределить, но не обязан.

**Когда применять.** Несколько вариантов алгоритма отличаются лишь отдельными шагами при общей
неизменной структуре; нужно убрать дублирование, вынеся общий каркас в базовый класс и оставив
подклассам только различающиеся шаги.

**Подводные камни.**

- Паттерн строится на **наследовании** — связывание на этапе компиляции, только один суперкласс
  (в Java нет множественного наследования классов), меньше гибкости, чем у композиции.
- **Хрупкий базовый класс** и LSP: подкласс обязан соблюдать контракт шагов, иначе шаблонный метод
  сломается. Шаблонный метод делают `final`, чтобы подкласс не переопределил сам скелет; примитивные
  шаги — `protected`, а не `public`.
- Слишком много абстрактных шагов усложняет наследника — держите их число минимальным.
- Глубокое сравнение Strategy vs Template Method (композиция против наследования) — в COMPARISONS.md.

**Реальные примеры (JDK/Spring).** `java.util.AbstractList`: подкласс реализует `get(int)` и `size()`,
а `iterator()`, `indexOf`, `contains` уже собраны в базовом классе поверх этих примитивов.
`HttpServlet.service()` — шаблонный метод: разбирает HTTP-метод и вызывает hook-методы `doGet`/`doPost`/
`doPut`, которые переопределяет сервлет. Также `AbstractMap`, `InputStream.read(byte[])` поверх
`read()`; в Spring — `AbstractApplicationContext.refresh()` (жёсткая последовательность фаз старта
контейнера) и `JdbcTemplate` (шаблонный метод плюс Strategy-колбэки).

---

## Chain of Responsibility (цепочка обязанностей)

**Назначение.** Передавать запрос по цепочке обработчиков: каждое звено решает, обработать запрос
и/или передать его дальше. Отправитель не знает, кто именно обработает запрос, — он отправляет его в
голову цепочки. Это развязывает отправителя и получателя.

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `Handler` | интерфейс обработчика + ссылка на следующее звено |
| `ConcreteHandler` | обрабатывает запрос либо передаёт его дальше по цепочке |
| `Client` | собирает цепочку и отправляет запрос её первому звену |

```
Client ──► Handler ──► Handler ──► Handler ──► (конец: null)
             │           │           │
        обработать   обработать   обработать
        или дальше   или дальше   или дальше
```

```java
abstract class Handler {                                           // Handler (звено)
    private Handler next;                                          // ссылка на следующее звено
    Handler linkTo(Handler next) { this.next = next; return next; } // сборка цепочки
    protected boolean passToNext(Request req) {                    // передать дальше
        return next == null || next.handle(req);                  // конец цепочки → пропускаем
    }
    abstract boolean handle(Request req);
}

class AuthHandler extends Handler {                                // ConcreteHandler
    boolean handle(Request req) {
        if (!req.authenticated()) return false;                   // обрываем цепочку
        return passToNext(req);                                    // иначе — дальше
    }
}
class RateLimitHandler extends Handler {
    boolean handle(Request req) {
        if (overLimit(req)) return false;                         // обрыв
        return passToNext(req);
    }
    private boolean overLimit(Request req) { return false; }
}
```

Клиент собирает цепочку и отправляет запрос в её голову:

```java
Handler chain = new AuthHandler();
chain.linkTo(new RateLimitHandler()).linkTo(new BusinessHandler());
boolean ok = chain.handle(request);                               // запускаем всю цепочку
```

**Кто обрывает цепочку.** Звено может (а) полностью обработать запрос и **остановить** передачу
(вернуть результат, не вызывая `passToNext`) либо (б) сделать свою часть и **передать дальше**.
Отсюда два прочтения: «чистая» цепочка — запрос обрабатывает ровно одно звено (эскалация обращений,
обработка исключений); «фильтрующая» цепочка — каждое звено делает свой шаг и пропускает запрос
дальше (аутентификация → лимит → бизнес-логика). Если запрос дошёл до конца необработанным, важно
предусмотреть терминальное звено по умолчанию.

**Когда применять.** Запрос может обработать один из нескольких объектов, и заранее неизвестно
какой; набор и порядок обработчиков задаётся динамически; хочется развязать отправителя и
конкретных получателей.

**Подводные камни.**

- **Нет гарантии обработки:** запрос может «выпасть» из конца цепочки — нужен обработчик по умолчанию.
- **Порядок звеньев важен** (аутентификация обязана идти до бизнес-логики); неверно собранная или
  разорванная цепочка молча меняет поведение.
- Длинная цепочка добавляет задержку, а поток управления по звеньям тяжело отлаживать; цикл в
  цепочке приводит к бесконечному обходу.

**Реальные проявления.** Классика — **цепочка Servlet-фильтров** (`javax.servlet.Filter`: каждый фильтр
вызывает `chain.doFilter(...)`, передавая запрос дальше) и построенная на той же идее **цепочка
фильтров Spring Security** — упорядоченная цепочка фильтров безопасности, где каждый может пропустить запрос
дальше или прервать обработку; разбор — [spring-frameworks/SPRING_SECURITY.md](../../spring-frameworks/theory/SPRING_SECURITY.md).
Также по этой схеме устроены цепочка `Handler`-ов в `java.util.logging`, перехватчики
`HandlerInterceptor` в Spring MVC и конвейеры промежуточных обработчиков в веб-фреймворках.

---

## Где почитать дальше

- [INTRO.md](INTRO.md) — таксономия паттернов, UML-нотация, принципы GoF и GRASP.
- [STRUCTURAL.md](STRUCTURAL.md) — структурные паттерны (Adapter, Decorator, Proxy…).
- [BEHAVIORAL_2.md](BEHAVIORAL_2.md) — поведенческие II: Command, Observer, Mediator, Memento.
- [BEHAVIORAL_3.md](BEHAVIORAL_3.md) — поведенческие III: Iterator, Visitor, Interpreter.
- [COMPARISONS.md](COMPARISONS.md) — глубокие сравнения: Strategy vs State vs Template Method и др.
- Strategy и OCP (объектная замена `switch`/`if`): [software-engineering/SOLID_OOP.md](../../software-engineering/theory/SOLID_OOP.md).
- Chain of Responsibility в Spring Security (цепочка фильтров безопасности): [spring-frameworks/SPRING_SECURITY.md](../../spring-frameworks/theory/SPRING_SECURITY.md).

---

## Источники

- *Design Patterns: Elements of Reusable Object-Oriented Software* — Gamma, Helm, Johnson, Vlissides (GoF), 1994 — глава «Behavioral Patterns».
- *Head First Design Patterns* (2nd ed.) — Freeman & Robson — Strategy (глава 1), State, Template Method («Hollywood principle»).
- refactoring.guru — иллюстрированный справочник поведенческих паттернов.
- Официальная документация: `java.util.Comparator`, `javax.servlet.Filter` / `FilterChain`, `javax.servlet.http.HttpServlet`, `java.util.AbstractList`, Spring Framework Reference (Spring Security filter chain).
