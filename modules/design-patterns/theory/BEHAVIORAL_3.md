# Design Patterns — Поведенческие паттерны III: Iterator, Visitor, Interpreter

Поведенческие паттерны описывают распределение обязанностей и способы взаимодействия объектов.
Эта третья часть собирает три паттерна вокруг темы «обход структуры и операции над ней»: как
пройти по коллекции, не раскрывая её устройства (Iterator); как добавлять новые операции к
иерархии объектов, не трогая её классы (Visitor); как представить простой язык деревом и вычислить
его (Interpreter). Все три встречаются реже «топовой четвёрки» поведенческих, но Iterator вшит в
язык, а Visitor и Interpreter любят спрашивать «на понимание».

| Паттерн | Одной строкой | Ключевая идея |
|---------|---------------|---------------|
| Iterator (итератор) | последовательный обход агрегата без раскрытия его устройства | вынести курсор обхода в отдельный объект |
| Visitor (посетитель) | новая операция над иерархией без изменения её классов | двойная диспетчеризация (double dispatch) |
| Interpreter (интерпретатор) | грамматика языка как дерево объектов + вычисление | один класс на правило грамматики |

---

## 1. Iterator (итератор)

**Назначение.** Дать последовательный доступ к элементам агрегата (коллекции), **не раскрывая его
внутреннее устройство**. Логика обхода выносится из коллекции в отдельный объект-итератор: агрегат
может быть массивом, связным списком или деревом, а клиентский код обхода остаётся одинаковым.

**Участники.**

| Роль (GoF) | Обязанность |
|------------|-------------|
| `Iterator` | интерфейс обхода: `hasNext()`, `next()` |
| `ConcreteIterator` | хранит текущую позицию (курсор) обхода конкретного агрегата |
| `Aggregate` | интерфейс-фабрика итераторов (`iterator()`) |
| `ConcreteAggregate` | возвращает подходящий `ConcreteIterator` |

```
Aggregate.iterator() ─────────► Iterator (hasNext / next)
       ▲                              ▲
ConcreteAggregate ───────────► ConcreteIterator (хранит курсор)
```

В Java паттерн встроен в язык: `java.util.Iterator<E>` (`hasNext`/`next`/`remove`) и
`java.lang.Iterable<E>` (`iterator()`). Достаточно реализовать `Iterable`, и тип начинает работать
в цикле for-each.

**Пример на Java.**

```java
class Playlist implements Iterable<String> {          // ConcreteAggregate
    private final String[] tracks;
    Playlist(String... tracks) { this.tracks = tracks; }

    @Override public Iterator<String> iterator() {    // фабрика итераторов
        return new Iterator<>() {                     // ConcreteIterator
            private int pos = 0;                       // курсор — состояние обхода
            @Override public boolean hasNext() { return pos < tracks.length; }
            @Override public String next() {
                if (!hasNext()) throw new NoSuchElementException();
                return tracks[pos++];
            }
        };
    }
}

for (String track : new Playlist("a", "b", "c")) { /* клиент не знает, что внутри массив */ }
```

Каждый вызов `iterator()` возвращает свежий курсор, поэтому несколько одновременных обходов одной
коллекции независимы — ключевое преимущество перед хранением позиции прямо в коллекции.

**Внешняя vs внутренняя итерация.** При **внешней** итерации клиент «тянет» элементы сам
(`hasNext`/`next`, for-each) и управляет циклом. При **внутренней** — клиент передаёт, что сделать
с элементом, а циклом управляет сама коллекция (`forEach`, Stream API).

| | Внешняя | Внутренняя |
|---|---------|------------|
| Кто управляет циклом | клиент | коллекция |
| Пример | `Iterator`, for-each | `forEach`, Stream API |
| Прерывание | `break`/`return` тривиально | нужен short-circuit (`takeWhile`, `findFirst`) |
| Параллелизм | вручную | `stream().parallel()` почти бесплатно |

Внутренняя итерация, функциональный стиль, `Collectors` и ленивость Stream — тема
[software-engineering/STREAM_API_FP.md](../../software-engineering/theory/STREAM_API_FP.md), здесь
не дублируется.

**Когда применять.** Нужен единый способ обхода разных структур; хочется скрыть устройство
коллекции; нужны несколько одновременных или разных порядков обхода (in-order, level-order) одной
структуры.

**Подводные камни.**

- **fail-fast (быстрый отказ) и `ConcurrentModificationException`.** Итераторы коллекций `java.util`
  работают в режиме fail-fast: структурная модификация коллекции во время обхода (не через
  `iterator.remove()`) обнаруживается по счётчику `modCount` и приводит к
  `ConcurrentModificationException`. Это диагностика по принципу best-effort, а не гарантия. Удалять
  элемент во время обхода можно только через `iterator.remove()`.
- Для конкурентного обхода без исключения нужны слабо-согласованные (weakly consistent) итераторы
  `ConcurrentHashMap` и снапшот-итераторы `CopyOnWriteArrayList` — см.
  [concurrency/CONCURRENT_COLLECTIONS.md](../../concurrency/theory/CONCURRENT_COLLECTIONS.md).
- `next()` без проверки `hasNext()` бросает `NoSuchElementException`; итератор одноразов — «перемотать»
  его нельзя, нужен новый.

**Реальные примеры.** Весь `java.util` (`ArrayList`, `HashMap.entrySet()`, …) через
`Iterator`/`Iterable`; for-each — синтаксический сахар над `Iterator`; `Scanner` и
`java.nio.file.DirectoryStream`; в драйверах баз данных `ResultSet` — по сути курсор-итератор по
строкам. Ленивые итераторы (`Stream`, `Files.lines`) отдают элементы по требованию, не материализуя
всю последовательность.

---

## 2. Visitor (посетитель)

**Назначение.** Вынести операцию над элементами иерархии объектов в отдельный объект-посетитель,
чтобы **добавлять новые операции, не изменяя классы элементов**. Паттерн разделяет структуру данных
и операции над ней.

**Проблема.** Есть иерархия узлов (узлы AST, геометрические фигуры, файловые узлы) и много
разнородных операций над ней (площадь, отрисовка, сериализация, оценка стоимости). Складывать все
методы в сами классы узлов — нарушение принципа единственной обязанности и разбухание иерархии:
каждая новая операция правит все классы. Visitor выносит операцию наружу.

**Двойная диспетчеризация (double dispatch).** Java, как и большинство объектных языков,
поддерживает одиночную диспетчеризацию (single dispatch): вызываемый метод выбирается по
рантайм-типу **одного** объекта — получателя. Чтобы выбрать поведение по **паре** типов (тип
элемента × тип операции), нужна двойная диспетчеризация. Visitor эмулирует её двумя виртуальными
вызовами:

```
element.accept(visitor)  ──1──►  visitor.visitCircle(this)  ──2──►  ConcreteVisitor.visitCircle
        ▲                                 ▲                                    ▲
   Circle / Square             this уже статически типа Circle          AreaVisitor / RenderVisitor
```

1. `element.accept(visitor)` — диспетчеризация по рантайм-типу **элемента** (получатель — элемент).
2. Внутри `accept` вызывается `visitor.visitCircle(this)` — диспетчеризация по типу **посетителя**,
   причём `this` статически известен как `Circle`, поэтому компилятор выбирает нужную перегрузку
   `visitCircle`. Два виртуальных вызова = выбор по двум типам = double dispatch.

**Участники.** `Visitor` (интерфейс с `visitXxx(ConcreteElement)` на каждый тип элемента),
`ConcreteVisitor` (конкретная операция), `Element` (интерфейс с `accept(Visitor)`),
`ConcreteElement` (реализует `accept`, вызывая `visitor.visitXxx(this)`), `ObjectStructure`
(коллекция элементов, обходит их и вызывает `accept`).

**Пример на Java (double dispatch).**

```java
interface Shape { <R> R accept(ShapeVisitor<R> v); }        // Element
record Circle(double r)   implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visitCircle(this); }   // 2-й dispatch
}
record Square(double side) implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visitSquare(this); }
}

interface ShapeVisitor<R> {                                  // Visitor
    R visitCircle(Circle c);
    R visitSquare(Square s);
}

class AreaVisitor implements ShapeVisitor<Double> {          // ConcreteVisitor — новая операция
    public Double visitCircle(Circle c) { return Math.PI * c.r() * c.r(); }
    public Double visitSquare(Square s) { return s.side() * s.side(); }
}

double area = new Circle(2).accept(new AreaVisitor());       // 1-й dispatch: accept(...)
```

Новая операция (периметр, отрисовка в SVG) — это новый `ConcreteVisitor`; классы `Circle`/`Square`
не трогаются. В этом весь смысл паттерна.

**Когда применять.** Иерархия элементов стабильна, а операции добавляются часто; операции разнородны
и не относятся к «сути» элемента; нужно накапливать состояние при обходе структуры (например,
собрать все листья дерева).

**Подводные камни (главный минус).**

- **Асимметрия расширения (проблема расширения, expression problem).** Visitor дёшев при добавлении
  новых **операций**, но враждебен к добавлению новых **типов элементов**: каждый новый
  `ConcreteElement` требует нового метода `visitXxx` во **всех** посетителях. Поэтому Visitor
  оправдан, только когда иерархия элементов меняется реже набора операций.
- Посетителю часто нужен доступ к внутренностям элемента, что вынуждает открывать геттеры и ослабляет
  инкапсуляцию.
- Циклическая зависимость `Visitor` ↔ `Element` и много «церемониального» кода (`accept`/`visit`).

**Современная альтернатива в Java.** sealed-интерфейсы + pattern matching for switch дают ту же
«операцию снаружи» без церемоний `accept`/`visit`: закрытая иерархия (`sealed`) даёт компилятору
исчерпывающесть `switch`, а новую операцию пишут отдельным `switch` по типам.

```java
sealed interface Shape permits Circle, Square {}
double area = switch (shape) {                      // операция «снаружи», без accept/visit
    case Circle c -> Math.PI * c.r() * c.r();
    case Square s -> s.side() * s.side();
};                                                  // новый подтип → компилятор укажет на этот switch
```

Компилятор при добавлении нового подтипа заставит обновить все неисчерпывающие `switch` — это
закрывает главную дыру Visitor («забыли обработать новый тип»). Механику `sealed` и pattern matching
см. в [java-core/MODERN_JAVA_FEATURES.md](../../java-core/theory/MODERN_JAVA_FEATURES.md) — здесь не
дублируется.

**Реальные примеры.** `java.nio.file.FileVisitor` (`Files.walkFileTree`) — обход дерева файлов;
`javax.lang.model.element.ElementVisitor`/`TypeVisitor` в обработке аннотаций; `ClassVisitor` в
библиотеке ASM для байткода; AST-посетители в компиляторах и линтерах (javac, деревья ANTLR).

---

## 3. Interpreter (интерпретатор)

**Назначение.** Для языка с простой грамматикой — представить его предложения деревом объектов (по
одному классу на грамматическое правило) и определить операцию `interpret`, вычисляющую это дерево.
Грамматика становится классами, разобранное предложение — деревом, а вычисление — рекурсивным
обходом.

**Ключевые понятия.**

- **Грамматика** — правила языка, например `expr := number | variable | expr '+' expr`.
- **AST (абстрактное синтаксическое дерево)** — дерево, узлы которого соответствуют правилам
  грамматики. Терминалы (числа, переменные) — листья; нетерминалы (сложение) — внутренние узлы.
- **Разграничение ответственности.** Interpreter описывает только **вычисление** уже построенного
  дерева. Разбор (парсинг) текста в дерево — отдельная задача, паттерном не покрытая.

**Участники.** `AbstractExpression` (интерфейс с `interpret(Context)`), `TerminalExpression` (лист:
число, переменная), `NonterminalExpression` (правило-композиция, хранит под-выражения), `Context`
(глобальные данные интерпретации — например, значения переменных), `Client` (строит AST и вызывает
`interpret`).

```
            Expression.interpret(ctx)
           /            |             \
     Num(лист)      Plus(узел)      Var(лист)
                    /       \
                 Var        Num           ← рекурсия, структурно как Composite
```

**Пример на Java.**

```java
interface Expr { int interpret(Map<String,Integer> ctx); }   // AbstractExpression
record Num(int value)  implements Expr {                      // TerminalExpression
    public int interpret(Map<String,Integer> ctx) { return value; }
}
record Var(String name) implements Expr {                     // TerminalExpression
    public int interpret(Map<String,Integer> ctx) { return ctx.get(name); }
}
record Plus(Expr left, Expr right) implements Expr {          // NonterminalExpression
    public int interpret(Map<String,Integer> ctx) {
        return left.interpret(ctx) + right.interpret(ctx);   // рекурсия по дереву
    }
}

Expr ast = new Plus(new Var("x"), new Num(2));               // дерево для "x + 2" (обычно строит парсер)
int result = ast.interpret(Map.of("x", 40));                // 42
```

Каждый узел умеет вычислить себя и делегирует детям — та же рекурсия, что в Composite (см.
[STRUCTURAL.md](STRUCTURAL.md)).

**Когда применять.** Простая и стабильная грамматика (условия правил доступа, формулы, фильтры,
маршрутные шаблоны); выгодно иметь предложения языка как объекты, чтобы переиспользовать и
комбинировать их.

**Подводные камни.**

- **Плохо масштабируется.** Каждый новый элемент грамматики — новый класс; для реального языка это
  десятки классов и трудно поддерживаемая иерархия.
- Паттерн покрывает только вычисление, но не разбор: превращение текста в AST (рекурсивный спуск и
  т.п.) пишется отдельно и часто сложнее самой интерпретации.
- Интерпретация дерева медленнее скомпилированного кода.

**Практичная замена — генераторы парсеров.** Вручную Interpreter пишут редко. Для нетривиального
языка берут генератор парсеров: по декларативной грамматике (`.g4`) ANTLR генерирует лексер, парсер
и строит дерево разбора, а обход дерева делают через сгенерированные Visitor/Listener (снова
Visitor). Грамматика описывается декларативно, а не руками через классы правил. Глубокое сравнение
Interpreter с этими подходами — в [COMPARISONS.md](COMPARISONS.md).

**Реальные примеры.** `java.util.regex.Pattern` — скомпилированное регулярное выражение как дерево
«интерпретируемых» узлов; `java.text.MessageFormat`; Spring Expression Language (SpEL) и Unified EL;
движки правил (Drools) и генераторы ANTLR/JavaCC как индустриальная замена ручного Interpreter.

---

## 4. Где почитать дальше

- [BEHAVIORAL_1.md](BEHAVIORAL_1.md) — Strategy, State, Template Method, Chain of Responsibility.
- [BEHAVIORAL_2.md](BEHAVIORAL_2.md) — Command, Observer, Mediator, Memento.
- [STRUCTURAL.md](STRUCTURAL.md) — Composite (Interpreter опирается на ту же рекурсию; Iterator часто ходит по Composite).
- [COMPARISONS.md](COMPARISONS.md) — Interpreter vs генераторы парсеров; Visitor + Composite; внешний Iterator vs внутренний Stream.
- [INTRO.md](INTRO.md) — таксономия паттернов, UML-нотация, принципы GoF и GRASP.
- Внутренняя итерация (Stream API, `forEach`, `Collectors`): [software-engineering/STREAM_API_FP.md](../../software-engineering/theory/STREAM_API_FP.md).
- Безопасная конкурентная итерация (`CopyOnWriteArrayList`, слабо-согласованные итераторы, `ConcurrentHashMap`): [concurrency/CONCURRENT_COLLECTIONS.md](../../concurrency/theory/CONCURRENT_COLLECTIONS.md).
- Альтернатива Visitor (sealed + pattern matching for switch): [java-core/MODERN_JAVA_FEATURES.md](../../java-core/theory/MODERN_JAVA_FEATURES.md).

---

## Источники

- *Design Patterns: Elements of Reusable Object-Oriented Software* — Gamma, Helm, Johnson, Vlissides (GoF), 1994 — глава «Behavioral Patterns» (Iterator, Visitor, Interpreter).
- *Head First Design Patterns* (2nd ed.) — Freeman & Robson — Iterator (и его связь с Composite).
- refactoring.guru — иллюстрированный справочник по Iterator, Visitor, Interpreter.
- Официальная документация: `java.util.Iterator` / `java.lang.Iterable`, `java.nio.file.FileVisitor`, `javax.lang.model.element.ElementVisitor`.
- *The Definitive ANTLR 4 Reference* — Terence Parr — генераторы парсеров как практическая замена ручного Interpreter.
