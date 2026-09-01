# Design Patterns — Поведенческие паттерны II: Command, Observer, Mediator, Memento

Поведенческие паттерны описывают, **как объекты распределяют обязанности и общаются** между собой.
Эта часть — про четыре паттерна, которые превращают взаимодействие в самостоятельную сущность:
запрос становится объектом (Command), оповещение — подпиской (Observer), связи «все со всеми» —
звездой вокруг координатора (Mediator), а состояние — переносимым снимком (Memento).

| Паттерн | Одной строкой | Что инкапсулирует |
|---------|---------------|-------------------|
| Command (команда) | заворачивает запрос в объект с методом `execute()` | **действие** (вызов) |
| Observer (наблюдатель) | подписка «один ко многим» на изменения субъекта | **оповещение** о событии |
| Mediator (посредник) | координатор общения группы объектов | **взаимодействие** объектов |
| Memento (хранитель) | снимок состояния без нарушения инкапсуляции | **состояние** объекта |

---

## 1. Command (команда)

**Назначение.** Инкапсулировать запрос как объект, чтобы отделить отправителя действия от его
получателя. Это позволяет параметризовать объекты операциями, ставить операции в очередь, журналировать
их и поддерживать отмену (undo/redo).

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `Command` | интерфейс с методом `execute()` (часто и `undo()`) |
| `ConcreteCommand` | связывает `Receiver` с действием, хранит параметры вызова |
| `Receiver` | знает, *как* выполнить работу |
| `Invoker` | хранит команду и запускает `execute()`, не зная деталей |
| `Client` | создаёт `ConcreteCommand` и назначает ему получателя |

```
Client ──создаёт──► ConcreteCommand ──держит ссылку──► Receiver
Invoker ──execute()──► Command (интерфейс)          (получатель делает работу)
```

```java
interface Command { void execute(); void undo(); }        // Command

class Light {                                             // Receiver — знает, как делать
    boolean on;
    void turnOn()  { on = true; }
    void turnOff() { on = false; }
}
class TurnOn implements Command {                         // ConcreteCommand
    private final Light light;
    TurnOn(Light light) { this.light = light; }
    public void execute() { light.turnOn();  }
    public void undo()    { light.turnOff(); }            // обратная операция
}
class Remote {                                            // Invoker
    private final Deque<Command> history = new ArrayDeque<>();
    void press(Command c) { c.execute(); history.push(c); }
    void undoLast()       { if (!history.isEmpty()) history.pop().undo(); }
}
```

**Макрокоманда** — это `Composite` из команд: одна команда, выполняющая список других (откат идёт в
обратном порядке):

```java
class Macro implements Command {                          // композит команд
    private final List<Command> steps;
    Macro(List<Command> steps) { this.steps = steps; }
    public void execute() { steps.forEach(Command::execute); }
    public void undo() {                                  // откатываем с конца
        for (int i = steps.size() - 1; i >= 0; i--) steps.get(i).undo();
    }
}
```

**Когда применять.** Нужно параметризовать объект действием; поставить операции в очередь и выполнить
отложенно или в другом потоке; поддержать отмену/повтор (undo/redo); журналировать операции ради
восстановления после сбоя (транзакционное поведение).

**Подводные камни.**

- Для отмены команда обязана хранить достаточно данных: либо симметричную обратную операцию, либо
  снимок прежнего состояния (тогда undo опирается на **Memento** — см. ниже).
- Неограниченная история команд течёт по памяти; ограничивай её глубину.
- «Толстая» команда, вобравшая бизнес-логику, стирает границу ролей: логика должна жить в `Receiver`,
  а команда — лишь связывать получателя с вызовом.

**Реальные примеры.** `java.lang.Runnable` и `java.util.concurrent.Callable` — это команды: объект
инкапсулирует действие, а `ExecutorService` в роли `Invoker` ставит его в очередь и исполняет, не зная
деталей. `ThreadPoolExecutor` с `BlockingQueue` задач — это буквально **очередь команд**. Также
`javax.swing.Action` (команда, привязанная к кнопке и пункту меню) и транзакционные журналы БД, где
запись лога — отменяемая команда. Отличие Command от Strategy разбирается в COMPARISONS.md.

---

## 2. Observer (наблюдатель)

**Назначение.** Задать зависимость «один ко многим»: когда один объект (субъект) меняет состояние, все
зависящие от него объекты (наблюдатели) оповещаются и обновляются автоматически. Это фундамент слабой
связанности между издателем события и его подписчиками (модель издатель-подписчик).

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `Subject` | ведёт список наблюдателей; `attach`/`detach`/`notify` |
| `ConcreteSubject` | хранит состояние; при его изменении вызывает `notify` |
| `Observer` | интерфейс реакции с методом `update()` |
| `ConcreteObserver` | реагирует на оповещение, при необходимости запрашивает состояние |

```
ConcreteSubject ──notify()──► Observer #1
   (список          ├───────► Observer #2      подписчики не знают
    подписчиков)     └───────► Observer #3      друг о друге
```

**Две модели оповещения.**

- **push-модель** (проталкивание) — субъект сам передаёт данные: `update(данные)`. Наблюдатель получает
  всё сразу, но субъект навязывает формат и может слать лишнее.
- **pull-модель** (вытягивание) — субъект шлёт лишь сигнал `update(subject)`, а наблюдатель сам берёт
  нужное через геттеры субъекта. Гибче, но добавляет обращения и связывает наблюдателя с интерфейсом
  субъекта.

```java
interface Observer { void update(double price); }        // push-модель

interface Subject {
    void attach(Observer o);
    void detach(Observer o);
    void notifyObservers();
}
class Stock implements Subject {                          // ConcreteSubject
    private final List<Observer> observers = new CopyOnWriteArrayList<>();
    private double price;
    public void attach(Observer o) { observers.add(o); }
    public void detach(Observer o) { observers.remove(o); }
    public void setPrice(double p) { this.price = p; notifyObservers(); }
    public void notifyObservers() {
        for (Observer o : observers) o.update(price);     // порядок = порядок подписки
    }
}
```

**Порядок оповещения.** GoF не гарантирует порядок обхода наблюдателей — полагаться на него ошибочно.
`CopyOnWriteArrayList` здесь позволяет наблюдателю отписаться прямо во время оповещения без
`ConcurrentModificationException`.

**Когда применять.** Изменение одного объекта должно обновить заранее неизвестное число других; нужно
рассылать события, не связывая издателя с конкретными типами подписчиков (шина событий, event bus).

**Подводные камни.**

- **Утечка слушателей (lapsed listener).** Субъект держит *сильную* ссылку на наблюдателя; забыли
  `detach` — наблюдатель не собирается сборщиком мусора и живёт столько же, сколько субъект. Классическая
  утечка памяти в UI и долгоживущих сервисах. Лечится явным `detach`, слабыми ссылками (`WeakReference`)
  или подписками, привязанными к жизненному циклу.
- **Каскады и циклы.** `update()` наблюдателя меняет субъект → повторное `notify` → лавина оповещений
  или бесконечный цикл.
- **Реентерабельность и изоляция ошибок.** Исключение в одном наблюдателе прерывает оповещение
  остальных, если его не изолировать; изменение списка во время обхода без потокобезопасной коллекции
  ломает итерацию.
- **Потокобезопасность.** Оповещение из нескольких потоков требует синхронизации; вызов `update()` под
  локом субъекта — прямой путь к дедлоку.

**`java.util.Observable` устарел (deprecated).** Пара `java.util.Observable`/`java.util.Observer`
объявлена устаревшей с Java 9 и использовать её не следует. Причины: `Observable` — *класс*, а не
интерфейс, и занимает единственное наследование; типобезопасности нет (`update` принимает `Object`);
флаг изменения требует ручного `setChanged()`, который легко забыть; класс не сериализуется корректно и
не потокобезопасен. Штатные замены — `java.beans.PropertyChangeListener` для отдельных свойств и
`java.util.concurrent.Flow` (Reactive Streams) для потоков событий.

**Реальные примеры и эволюция.** `java.beans.PropertyChangeSupport`/`PropertyChangeListener`; слушатели
Swing/AWT (`ActionListener`, `addXxxListener`); в Spring — `ApplicationEvent` и `@EventListener`.
Современная эволюция паттерна учитывает разную скорость издателя и подписчика, чего классический
Observer не решает:

- реактивные потоки с обратным давлением (backpressure) и `java.util.concurrent.Flow` (Reactive
  Streams) — [system-design/COMMUNICATION_PATTERNS.md](../../system-design/theory/COMMUNICATION_PATTERNS.md);
- холодные и горячие потоки в Kotlin (`Flow`, `SharedFlow`, `StateFlow`) —
  [kotlin-coroutines/FLOW.md](../../kotlin-coroutines/theory/FLOW.md).

Глубокое сравнение Observer и Mediator (оба ослабляют связанность, но по-разному) — в COMPARISONS.md.

---

## 3. Mediator (посредник)

**Назначение.** Инкапсулировать взаимодействие набора объектов в отдельном объекте-посреднике. Коллеги
не ссылаются друг на друга напрямую, а общаются только через посредника — связи «многие ко многим»
сворачиваются в «звезду» вокруг медиатора, и объекты становятся переиспользуемыми.

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `Mediator` | интерфейс координации коллег |
| `ConcreteMediator` | знает всех коллег и реализует логику их взаимодействия |
| `Colleague` | ссылается на посредника; шлёт событие ему, а не другому коллеге напрямую |

```
Без посредника:            С посредником:
   A ─── B                    A     B
   │ ╳   │                     \   /
   C ─── D   (N×N связей)        M      (звезда: каждый знает только M)
                                / \
                               C   D
```

```java
interface Mediator { void changed(Widget sender); }      // Mediator

abstract class Widget {                                   // Colleague
    protected final Mediator mediator;
    protected Widget(Mediator m) { this.mediator = m; }
}
class Checkbox extends Widget {
    boolean checked;
    Checkbox(Mediator m) { super(m); }
    void toggle() { checked = !checked; mediator.changed(this); }  // сообщаем посреднику
}
class Button extends Widget {
    boolean enabled;
    Button(Mediator m) { super(m); }
}
class LoginDialog implements Mediator {                   // ConcreteMediator
    private final Checkbox agree  = new Checkbox(this);
    private final Button   submit = new Button(this);
    public void changed(Widget sender) {
        if (sender == agree) submit.enabled = agree.checked;  // вся логика связей — здесь
    }
}
```

**Когда применять.** Много объектов с запутанными двунаправленными связями «все со всеми»;
переиспользование объекта затруднено, потому что он жёстко ссылается на десяток других; поведение,
размазанное по объектам, хочется настраивать в одном месте (диалоги UI, чат-комната, авиадиспетчерская
вышка).

**Подводные камни.**

- **God Object.** Главный риск: посредник вбирает всю логику и разрастается в неподдерживаемый монолит.
  Медиатор централизует *координацию*, но не должен становиться свалкой бизнес-логики (см.
  ANTIPATTERNS.md).
- Паттерн не устраняет сложность, а *перемещает* её из связей в сам посредник.
- Единая точка отказа и потенциальное узкое место под нагрузкой.

**Observer vs Mediator (кратко).** Observer — однонаправленная рассылка «издатель → много неизвестных
подписчиков», подписчики не знают ни друг о друге, ни о структуре. Mediator — двунаправленная
координация конкретного, известного набора коллег; внутри медиатор часто сам реализован через Observer.
Полное сравнение — в COMPARISONS.md.

**Реальные примеры.** Spring MVC `DispatcherServlet` координирует контроллеры, резолверы и вью, а те не
знают друг о друге; UI-фреймворки диалоговых форм; чат-сервер как посредник между клиентами; брокер
сообщений (JMS/Kafka) как инфраструктурный посредник, разрывающий прямые связи между сервисами.

---

## 4. Memento (хранитель, снимок)

**Назначение.** Зафиксировать внутреннее состояние объекта и вынести его наружу, **не нарушая
инкапсуляцию**, чтобы позже восстановить объект в это состояние. Это каноническая основа отмены (undo).

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `Originator` | создаёт снимок своего состояния и восстанавливается из него |
| `Memento` | неизменяемый носитель состояния; «широкий» доступ — для `Originator`, «узкий» — для `Caretaker` |
| `Caretaker` | хранит снимки (обычно стек истории), но не заглядывает внутрь них |

```
Originator ──createMemento()──► Memento ──кладёт──► Caretaker (не читает поля)
Originator ◄──restore(Memento)──                   (стек истории undo)
```

**Инкапсуляция — суть паттерна.** `Caretaker` держит `Memento`, но не имеет доступа к его полям; полный
доступ есть только у `Originator`. В Java это выражают вложенным классом с приватными полями:

```java
class Editor {                                           // Originator
    private String text = "";
    void type(String s) { text += s; }
    String text()       { return text; }

    Memento save()          { return new Memento(text); }    // широкий доступ
    void restore(Memento m) { this.text = m.state; }

    static final class Memento {                         // узкий интерфейс для caretaker
        private final String state;                      // недоступно снаружи
        private Memento(String state) { this.state = state; }
    }
}
class History {                                          // Caretaker
    private final Deque<Editor.Memento> stack = new ArrayDeque<>();
    void push(Editor.Memento m) { stack.push(m); }       // хранит, но не читает
    Editor.Memento pop()        { return stack.pop(); }
}
```

**Когда применять.** Нужны снимки состояния для отмены/повтора, контрольных точек (checkpoint) или
транзакционного отката, а прямое чтение полей объекта ради снимка нарушило бы инкапсуляцию.

**Подводные камни.**

- **Стоимость памяти.** Полные снимки крупного состояния дороги; частые снимки без ограничения истории —
  утечка. Оптимизации: инкрементальные снимки (дельты) и ограничение глубины истории.
- **Глубокая копия.** Снимок обязан копировать *изменяемое* состояние глубоко, иначе последующее
  изменение `Originator` «протечёт» в уже сохранённый снимок (та же ловушка мелкой копии, что у
  Prototype).
- В языках без вложенных классов трудно обеспечить настоящий «узкий» интерфейс — инкапсуляция держится
  на дисциплине.

**Связь с сериализацией.** Снимок можно материализовать сериализацией всего состояния объекта в байты
или на диск — так строят персистентные undo и контрольные точки. Механику Java-сериализации
(`Serializable`, `writeObject`/`readObject`, `serialVersionUID`, глубокое копирование через
сериализацию) не переписываем — она в
[java-core/SERIALIZATION.md](../../java-core/theory/SERIALIZATION.md). Важно помнить: сериализация
захватывает весь граф объекта и может быть дороже точечного снимка нужных полей.

**Реальные примеры.** `undo`/`redo` в редакторах и IDE (`javax.swing.undo.UndoManager`,
`UndoableEdit`); контрольные точки вычислений и «сохранения» в игровых движках; точка сохранения
(savepoint) как снимок состояния транзакции. Memento часто работает в паре с Command: команда `undo`
хранит внутри `Memento` прежнего состояния получателя.

---

## 5. Где почитать дальше

- [BEHAVIORAL_1.md](BEHAVIORAL_1.md) — Strategy, State, Template Method, Chain of Responsibility.
- [BEHAVIORAL_3.md](BEHAVIORAL_3.md) — Iterator, Visitor, Interpreter.
- [COMPARISONS.md](COMPARISONS.md) — Command vs Strategy, Observer vs Mediator, выбор паттерна на собеседовании.
- [ANTIPATTERNS.md](ANTIPATTERNS.md) — God Object (риск Mediator), «паттерн ради паттерна».
- [INTRO.md](INTRO.md) — таксономия паттернов, UML-нотация, принципы GoF и GRASP.
- Reactive Streams и обратное давление (эволюция Observer): [system-design/COMMUNICATION_PATTERNS.md](../../system-design/theory/COMMUNICATION_PATTERNS.md).
- Kotlin `Flow`/`SharedFlow` (эволюция Observer): [kotlin-coroutines/FLOW.md](../../kotlin-coroutines/theory/FLOW.md).
- Java-сериализация как способ хранить снимок Memento: [java-core/SERIALIZATION.md](../../java-core/theory/SERIALIZATION.md).

---

## Источники

- *Design Patterns: Elements of Reusable Object-Oriented Software* — Gamma, Helm, Johnson, Vlissides (GoF), 1994 — глава «Behavioral Patterns» (Command, Observer, Mediator, Memento).
- *Head First Design Patterns* (2nd ed.) — Freeman & Robson — Command (пульт с undo), Observer (метеостанция).
- refactoring.guru — иллюстрированный справочник поведенческих паттернов.
- Официальная документация: `java.util.concurrent` (Runnable/Callable/Executor как Command), `java.util.concurrent.Flow`, устаревание `java.util.Observable` (JDK 9+).
