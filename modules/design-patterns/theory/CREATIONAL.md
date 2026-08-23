# Design Patterns — Порождающие паттерны (Creational)

Порождающие паттерны абстрагируют создание объектов: клиент получает готовый экземпляр, не завися
от конкретного класса и способа конструирования. Все пять отвечают на вопрос «кто и как создаёт
объект», но с разными акцентами: Factory Method и Abstract Factory прячут *какой класс*
инстанцируется, Builder — *как собрать* сложный объект, Prototype — *как размножить* существующий,
Singleton — *как гарантировать единственность*.

| Паттерн | Что варьируется | Ключевая идея |
|---------|-----------------|---------------|
| Factory Method | конкретный класс продукта | подкласс переопределяет фабричный метод |
| Abstract Factory | семейство согласованных продуктов | одна фабрика создаёт совместимый набор |
| Builder | процесс сборки сложного объекта | пошаговое конструирование, отделённое от результата |
| Prototype | способ создания | копирование готового экземпляра |
| Singleton | количество экземпляров | ровно один на область видимости |

Глубокое попарное сравнение (Factory Method vs Abstract Factory vs Builder — что выбрать на
собеседовании) вынесено в соседний [COMPARISONS.md](COMPARISONS.md); здесь — каждый паттерн по
существу.

---

## Factory Method (фабричный метод)

**Назначение.** Определить интерфейс создания объекта, но отдать решение о конкретном классе
подклассам. Клиентская бизнес-логика работает с продуктом через абстракцию и не знает, какая
именно реализация создана.

**Участники.**

| Роль | Назначение |
|------|-----------|
| `Product` | абстракция создаваемого объекта |
| `ConcreteProduct` | конкретная реализация продукта |
| `Creator` | объявляет фабричный метод, содержит бизнес-логику поверх `Product` |
| `ConcreteCreator` | переопределяет фабричный метод, возвращает конкретный продукт |

```
   Creator ──── factoryMethod() : Product ────▶ Product (интерфейс)
      ▲          someLogic() { use factoryMethod() }        ▲
      │                                                     │
 ConcreteCreator ──── overrides factoryMethod() ───▶ ConcreteProduct
```

```java
interface Transport { void deliver(); }              // Product
class Truck implements Transport { public void deliver() { /* по дороге */ } }
class Ship  implements Transport { public void deliver() { /* по морю   */ } }

abstract class Logistics {                            // Creator
    protected abstract Transport createTransport();   // фабричный метод

    public void planDelivery() {                      // бизнес-логика поверх абстракции
        Transport t = createTransport();
        t.deliver();
    }
}
class RoadLogistics extends Logistics {               // ConcreteCreator
    protected Transport createTransport() { return new Truck(); }
}
class SeaLogistics extends Logistics {
    protected Transport createTransport() { return new Ship(); }
}
```

**Когда применять.**
- Класс не знает заранее, объекты какого типа ему придётся создавать, и нужна точка расширения для
  подклассов — куда подставить свой продукт.
- Требуется убрать из бизнес-логики ветвление `new ConcreteX()` по типу.

**Подводные камни.**
- Не путать с **статическим фабричным методом** (Bloch, Effective Java, Item 1): `Integer.valueOf`,
  `List.of`, `Optional.of` — это именованные конструкторы, а не паттерн Factory Method (в них нет
  переопределения подклассом). На собеседовании это частая подмена понятий.
- Ради одного продукта плодить иерархию `Creator` — избыточное усложнение.

**Реальные примеры.** `Collection.iterator()` (каждая коллекция возвращает свой `Iterator`),
`Calendar.getInstance()`, `NumberFormat.getInstance()` в JDK; `FactoryBean<T>.getObject()` и
`@Bean`-методы конфигурации в Spring; `SessionFactory.openSession()` в Hibernate.

---

## Abstract Factory (абстрактная фабрика)

**Назначение.** Предоставить интерфейс для создания **семейства** связанных объектов без указания
их конкретных классов, гарантируя, что продукты одного семейства согласованы между собой.

**Участники.**

| Роль | Назначение |
|------|-----------|
| `AbstractFactory` | объявляет методы создания каждого продукта семейства |
| `ConcreteFactory` | создаёт согласованный набор конкретных продуктов |
| `AbstractProduct` | абстракции продуктов (`Button`, `Checkbox`, …) |
| `Client` | работает только с абстракциями фабрики и продуктов |

```
        AbstractFactory                 MacFactory  ──▶ MacButton,  MacCheckbox
   createButton() : Button       ◀── реализуют
   createCheckbox() : Checkbox   ◀──          WinFactory ──▶ WinButton,  WinCheckbox
```

```java
interface Button   { void render(); }
interface Checkbox { void render(); }

interface GuiFactory {                                 // AbstractFactory
    Button   createButton();
    Checkbox createCheckbox();
}
class MacFactory implements GuiFactory {               // согласованное семейство macOS
    public Button   createButton()   { return new MacButton(); }
    public Checkbox createCheckbox() { return new MacCheckbox(); }
}
class WinFactory implements GuiFactory {               // согласованное семейство Windows
    public Button   createButton()   { return new WinButton(); }
    public Checkbox createCheckbox() { return new WinCheckbox(); }
}
class App {                                            // клиент не знает конкретное семейство
    private final Button button;
    App(GuiFactory factory) { this.button = factory.createButton(); }
}
```

**Когда применять.**
- Система должна работать с несколькими взаимозаменяемыми семействами продуктов (тема оформления,
  драйвер, платформа), и продукты нельзя смешивать между семействами.
- Конкретное семейство выбирается один раз при конфигурации и дальше скрыто за абстракцией.

**Подводные камни.**
- Добавление нового вида продукта (нового метода в `AbstractFactory`) ломает **все** реализации
  фабрики — интерфейс семейства менять дорого.
- Отличие от Factory Method: тот создаёт **один** продукт через наследование, Abstract Factory —
  **набор** через композицию фабрик.
- **Кто создаёт объекты в реальном приложении.** Ручные абстрактные фабрики в enterprise-коде
  почти вытеснены DI-контейнером: он и есть конфигурируемая фабрика, которая инстанцирует и
  связывает граф объектов. См. [../../spring-frameworks/theory/SPRING_CORE_DI.md](../../spring-frameworks/theory/SPRING_CORE_DI.md)
  (IoC-контейнер, `@Configuration`, связывание зависимостей).

**Реальные примеры.** `DocumentBuilderFactory`, `TransformerFactory`, `SAXParserFactory`
(`javax.xml`) в JDK; JDBC `Connection` как фабрика согласованного семейства `Statement` /
`PreparedStatement` / `CallableStatement`; `BeanFactory` / `ApplicationContext` в Spring.

---

## Builder (строитель)

**Назначение.** Отделить конструирование сложного объекта от его представления, собирая его
пошагово. Позволяет создавать неизменяемые объекты с множеством полей (в т.ч. опциональных) без
телескопических конструкторов и сеттеров.

**Участники.** `Builder` (накапливает поля, шаги возвращают `this` для текучести), `Product`
(неизменяемый результат с приватным конструктором), опционально `Director` (фиксирует типовой
порядок шагов). В Java классический GoF-`Director` почти не используется — прижилась текучая
(fluent) форма из Effective Java (Bloch, Item 2).

```java
public final class HttpRequest {                       // Product — неизменяемый
    private final String method;                       // обязательное
    private final String url;                           // обязательное
    private final Map<String, String> headers;          // опциональное
    private final int timeoutMillis;

    private HttpRequest(Builder b) {                    // приватный конструктор
        this.method = b.method;
        this.url = b.url;
        this.headers = Map.copyOf(b.headers);          // защитная копия → иммутабельность
        this.timeoutMillis = b.timeoutMillis;
    }
    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private String method, url;
        private final Map<String, String> headers = new LinkedHashMap<>();
        private int timeoutMillis = 30_000;            // значение по умолчанию

        public Builder method(String m) { this.method = m; return this; }   // текучесть
        public Builder url(String u)    { this.url = u;    return this; }
        public Builder header(String n, String v) { headers.put(n, v); return this; }
        public Builder timeoutMillis(int t) { this.timeoutMillis = t; return this; }

        public HttpRequest build() {                   // валидация — только здесь
            if (url == null || url.isBlank())
                throw new IllegalStateException("url обязателен");
            return new HttpRequest(this);
        }
    }
}
// HttpRequest r = HttpRequest.builder().method("GET").url("/api").build();
```

**Когда применять.**
- Много параметров конструктора, часть из них опциональна; телескопические конструкторы
  (`new X(a)`, `new X(a,b)`, `new X(a,b,c)`) и JavaBeans-сеттеры (ломают неизменяемость) неудобны.
- Нужен неизменяемый объект с валидацией инвариантов в одной точке — `build()`.
- Одна процедура сборки должна давать разные представления результата.

**Подводные камни.**
- Валидацию обязательных полей делать в `build()`, а не в шагах — иначе порядок вызовов станет
  значимым. Обязательные поля можно потребовать в конструкторе `Builder`.
- Для объекта из двух-трёх полей Builder избыточен — хватит конструктора или `record`.
- Забытая защитная копия коллекций (`Map.copyOf`) пробивает неизменяемость результата.

**Связи.** `@Builder` из Lombok генерирует шаблонный код строителя аннотацией. В Kotlin роль
Builder часто берут на себя именованные аргументы со значениями по умолчанию. Идиоматический
аналог в Go — **functional options** (`func(*T)`-опции вместо строителя): см.
[../../go/theory/IDIOMS_PATTERNS.md](../../go/theory/IDIOMS_PATTERNS.md). Упражнение модуля
[Ex01_HttpRequestBuilder](../src/main/java/exercises/Ex01_HttpRequestBuilder.java) — реализация
текучего строителя с валидацией.

**Реальные примеры.** `StringBuilder`, `Stream.Builder`, `HttpRequest.newBuilder()` и
`HttpClient.newBuilder()` (`java.net.http`), `Locale.Builder`, `Calendar.Builder` в JDK;
`UriComponentsBuilder`, `MockMvcRequestBuilders` в Spring; `CriteriaBuilder` (JPA) в Hibernate.

---

## Prototype (прототип)

**Назначение.** Создавать новые объекты копированием существующего экземпляра-прототипа, а не
вызовом конструктора. Полезно, когда создание с нуля дорого (тяжёлая инициализация, загрузка из
БД), а нужный объект уже есть под рукой.

**Участники.** `Prototype` (объявляет операцию копирования, напр. `copy()`), `ConcretePrototype`
(реализует копирование себя), `Client` (клонирует прототип, не зная его конкретного класса).
Часто дополняется реестром прототипов (`Map<String, Prototype>`).

```java
interface Prototype<T> { T copy(); }

final class Circle implements Prototype<Circle> {
    private final int x, y, radius;
    Circle(int x, int y, int radius) { this.x = x; this.y = y; this.radius = radius; }
    Circle(Circle other) { this(other.x, other.y, other.radius); } // копирующий конструктор
    public Circle copy() { return new Circle(this); }
}
```

**Когда применять.**
- Набор возможных объектов известен в рантайме (прототипы регистрируются), и клиент собирает
  новые экземпляры из образцов.
- Дешевле склонировать преднастроенный объект, чем конструировать и настраивать заново.

**Подводные камни — глубокое vs поверхностное копирование.**
- **Поверхностная копия** дублирует только ссылки: вложенные изменяемые объекты остаются общими, и
  правка копии портит оригинал. **Глубокая копия** рекурсивно копирует граф — но требует обхода
  всех вложенных ссылок и осторожности с циклами.
- `Object.clone()` / `Cloneable` в Java проблемны (Bloch, Item 13): `clone()` не вызывает
  конструктор, `Cloneable` не объявляет метода, копия по умолчанию поверхностная, а контракт хрупок
  при наследовании. Предпочтительны **копирующий конструктор** или **копирующая фабрика** — они
  явны, работают с `final`-полями и не завязаны на `clone()`.

**Реальные примеры.** `Object.clone()` / `ArrayList.clone()` / `Calendar.clone()` в JDK;
`BeanUtils.copyProperties` (поверхностное копирование) в Spring. Осторожно: bean-scope
`prototype` в Spring (`@Scope("prototype")`) — это «новый экземпляр на каждый запрос из
контейнера», а **не** GoF-паттерн Prototype (одинаковое имя, разный смысл — классическая ловушка).

---

## Singleton (одиночка)

**Назначение.** Гарантировать, что у класса ровно один экземпляр, и дать к нему глобальную точку
доступа. Уместно для по-настоящему единичных ресурсов: реестр, пул, конфигурация, фабрика с
дорогой инициализацией.

**Участники.** Сам класс с приватным конструктором и статическим методом/полем доступа.

### Потокобезопасные варианты

Область модели памяти (почему нужен `volatile`, что такое happens-before и корректная публикация
объекта) здесь не раскрывается — канонический владелец темы JMM:
[../../concurrency/theory/MEMORY_MODEL.md](../../concurrency/theory/MEMORY_MODEL.md) и
[../../concurrency/theory/ATOMIC_CAS.md](../../concurrency/theory/ATOMIC_CAS.md).

```java
// 1) Жадная (eager): экземпляр создаётся при инициализации класса.
//    Потокобезопасно по гарантии инициализации класса (JVM сериализует <clinit>).
public final class Eager {
    public static final Eager INSTANCE = new Eager();
    private Eager() {}
}

// 2) Идиома внутреннего держателя (holder idiom / lazy holder):
//    ленивая И потокобезопасная без явной синхронизации — держатель
//    инициализируется JVM при первом обращении к getInstance().
public final class Holder {
    private Holder() {}
    private static final class Lazy { static final Holder INSTANCE = new Holder(); }
    public static Holder getInstance() { return Lazy.INSTANCE; }
}

// 3) Double-checked locking (DCL) — поле ОБЯЗАНО быть volatile.
//    Без volatile другой поток может увидеть частично сконструированный объект.
public final class Dcl {
    private static volatile Dcl instance;
    private Dcl() {}
    public static Dcl getInstance() {
        Dcl local = instance;                 // одно чтение volatile на быстром пути
        if (local == null) {
            synchronized (Dcl.class) {
                local = instance;
                if (local == null) instance = local = new Dcl();
            }
        }
        return local;
    }
}

// 4) enum-Singleton (Bloch, Item 3) — предпочтительный способ.
public enum Config {
    INSTANCE;
    public String value() { return "…"; }
}
```

| Вариант | Ленивый | Потокобезопасен | Защита от рефлексии | Защита при сериализации |
|---------|:-------:|:---------------:|:-------------------:|:-----------------------:|
| Жадный (eager) | нет | да (гарантия инициализации) | нет | нужен `readResolve` |
| Holder idiom | да | да (гарантия инициализации) | нет | нужен `readResolve` |
| DCL + `volatile` | да | да | нет | нужен `readResolve` |
| `enum` | да (по классу) | да | **да** | **да (из коробки)** |

**Подводные камни.**
- **Рефлексия.** `setAccessible(true)` на приватном конструкторе создаёт второй экземпляр в любом
  варианте, кроме `enum` (JVM запрещает рефлексивно инстанцировать enum).
- **Сериализация.** Обычный сериализуемый Singleton при десериализации даёт **новый** объект.
  Лечится методом `readResolve()`, возвращающим канонический `INSTANCE`; `enum` безопасен по
  спецификации; ещё вариант — прокси сериализации. Детали:
  [../../java-core/theory/SERIALIZATION.md](../../java-core/theory/SERIALIZATION.md).
- **Глобальное изменяемое состояние.** Singleton легко вырождается в скрытую глобальную
  зависимость: усложняет тестирование (не подменить mock), прячет связи, мешает переиспользованию.
  В прикладном коде предпочтительнее один экземпляр под управлением DI-контейнера, а не жёсткий
  `getInstance()`. Разбор злоупотребления — в [ANTIPATTERNS.md](ANTIPATTERNS.md).

**Реальные примеры.** `Runtime.getRuntime()`, `System`, `DriverManager` в JDK. В Spring bean по
умолчанию имеет область видимости `singleton` — но это **один экземпляр на контейнер**, управляемый и
тестируемый, а не JVM-глобальный GoF-Singleton (различать на собеседовании). `SessionFactory` в
Hibernate фактически единичен на приложение (тяжёлый, потокобезопасный, дорогой в создании).

---

## Где почитать дальше

- [INTRO.md](INTRO.md) — таксономия, UML, принципы GoF и GRASP, когда паттерн уместен.
- [STRUCTURAL.md](STRUCTURAL.md) — структурные паттерны (Adapter, Decorator, Proxy, …).
- [BEHAVIORAL_1.md](BEHAVIORAL_1.md) — поведенческие (Strategy, State, Template Method, …).
- [COMPARISONS.md](COMPARISONS.md) — Factory Method vs Abstract Factory vs Builder и другие выборы.
- [ANTIPATTERNS.md](ANTIPATTERNS.md) — избыточное усложнение, Singleton как глобальное состояние.

## Источники

- *Design Patterns: Elements of Reusable Object-Oriented Software* — Gamma, Helm, Johnson, Vlissides (GoF).
- *Effective Java* (3rd ed.) — Joshua Bloch: Item 1 (статические фабрики), Item 2 (Builder),
  Item 3 (Singleton через `enum`), Item 13 (осторожно с `clone`).
- [refactoring.guru](https://refactoring.guru/design-patterns/creational-patterns) — иллюстрированный справочник порождающих паттернов.
