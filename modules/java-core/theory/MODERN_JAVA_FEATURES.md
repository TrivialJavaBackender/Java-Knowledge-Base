# Modern Java Features (JEP-обзор 14 → 25)

---

## 1. Эволюция языка с 2018: как Java оживала

К 2015 году Java имела репутацию «корпоративного скучного» языка. Kotlin, Scala, Groovy появились частично как ответ на её verbosity. С Java 8 (2014) пришли lambdas и Stream API — первый шаг к функциональному стилю. Но дальше шло медленно: между Java 8 и Java 11 (2018) — три года.

Главное событие — **переход на six-month cadence** в 2017 году. Каждые 6 месяцев — новая версия. Каждые 2 года — LTS (long-term support). Это позволило быстрее экспериментировать через **preview features**.

В результате 2019–2025 годы — самый продуктивный период в эволюции языка: records, sealed, pattern matching, text blocks, switch expressions, virtual threads. Java догнала Kotlin/Scala по выразительности (хотя и не везде).

> Brian Goetz, [*Java Language Architect*](https://www.infoq.com/articles/java-language-architect/) interview. [Inside Java — JDK Project Amber](https://openjdk.org/projects/amber/) — Java language evolution project.

---

## 2. Records (JEP 395, stable Java 16)

**Цель**: убрать boilerplate для immutable data carriers (DTO, value objects). Это самая значимая фича со времён lambdas.

### 2.1. Basic syntax

```java
public record User(long id, String email, String name) {}
```

В четырёх словах больше, чем в 30 строках классического Java:

```java
// Classic equivalent:
public final class User {
    private final long id;
    private final String email;
    private final String name;
    
    public User(long id, String email, String name) {
        this.id = id;
        this.email = email;
        this.name = name;
    }
    
    public long id() { return id; }
    public String email() { return email; }
    public String name() { return name; }
    
    @Override
    public boolean equals(Object o) { /* всё поле сравнение */ }
    @Override
    public int hashCode() { /* через все поля */ }
    @Override
    public String toString() { /* "User[id=..., email=..., ...]" */ }
}
```

### 2.2. Что компилятор генерирует

- **Private final fields** + canonical constructor;
- **Accessors**: `id()`, `email()`, `name()` (без `get`-префикса! — другой convention);
- **`equals`** — через `invokedynamic ObjectMethods.bootstrap`;
- **`hashCode`** — тот же bootstrap;
- **`toString`** — `User[id=1, email=..., name=...]`;
- Наследует `java.lang.Record` (abstract).

### 2.3. Compact constructor

Для validation без дублирования параметров:
```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("negative amount");
        }
    }
}
```

Внутри compact constructor можно изменять параметры (но не this — fields ещё не выставлены):
```java
public record Range(int low, int high) {
    public Range {
        if (low > high) {
            int tmp = low; low = high; high = tmp;   // swap params before init
        }
    }
}
```

### 2.4. Custom constructors

```java
public record Range(int low, int high) {
    // Delegating constructor:
    public Range(int single) { this(single, single); }
}
```

Любой non-canonical constructor должен в конце вызвать canonical.

### 2.5. Override accessor

```java
public record Password(String value) {
    @Override
    public String value() { return "***"; }   // hide actual value
}
```

Можно скрыть данные — accessor не обязан возвращать поле напрямую.

### 2.6. Implementations и methods

Record может:
- Implement interfaces;
- Иметь static и instance methods;
- Иметь static fields (но **не** instance!);
- Override `equals`/`hashCode`/`toString` (но обычно не нужно).

```java
public record Money(BigDecimal amount, Currency currency) implements Comparable<Money> {
    public static Money zero(Currency c) { return new Money(BigDecimal.ZERO, c); }
    
    public Money plus(Money other) {
        if (!currency.equals(other.currency)) throw new IllegalArgumentException();
        return new Money(amount.add(other.amount), currency);
    }
    
    @Override
    public int compareTo(Money other) { return amount.compareTo(other.amount); }
}
```

### 2.7. Ограничения

- Record **final** (нельзя extend);
- Нельзя extend other classes (наследует только `Record`);
- Нельзя добавить instance fields кроме declared components;
- Нельзя добавить native methods.

**Когда record не подходит**:
- Immutable объект с большим числом optional полей → используй Builder;
- Объект с мутируемым state → обычный class;
- Объект с глубокой иерархией → класс с наследованием.

> [JEP 395: Records](https://openjdk.org/jeps/395). Brian Goetz, [*Towards Better Serialization*](https://cr.openjdk.org/~briangoetz/amber/serialization.html) — где records обсуждаются.

---

## 3. Sealed classes / interfaces (JEP 409, stable Java 17)

**Цель**: ограниченная иерархия — автор класса **явно** перечисляет наследников. Это даёт типу свойство «closed sum type» — функциональная концепция ADT.

### 3.1. Syntax

```java
public sealed interface Shape permits Circle, Square, Triangle {}

public record Circle(double radius) implements Shape {}
public record Square(double side)   implements Shape {}
public final class Triangle implements Shape { 
    public final double a, b, c;
    public Triangle(double a, double b, double c) { 
        this.a = a; this.b = b; this.c = c; 
    }
}
```

Правила:
- `permits` обязателен, если subclasses не в том же compilation unit;
- Subclass **должен** быть `final`, `sealed`, или `non-sealed`;
- `non-sealed` — escape hatch, открывает обратно (`non-sealed class Other extends Shape`).

### 3.2. Use case 1: exhaustive pattern matching

С Java 21:
```java
double area(Shape s) {
    return switch (s) {
        case Circle c   -> Math.PI * c.radius() * c.radius();
        case Square sq  -> sq.side() * sq.side();
        case Triangle t -> heronArea(t.a, t.b, t.c);
    };
}
```

Без default! Компилятор знает все варианты. Если добавишь `Pentagon` в permits — все switch на Shape **сломаются на compile-time** → forced refactor. Это **good** — нельзя забыть обработать новый вариант.

### 3.3. Use case 2: ADT

Records (product type) + sealed (sum type) = ADT из functional languages:

```java
public sealed interface Result<T> {
    record Ok<T>(T value) implements Result<T> {}
    record Err<T>(String message) implements Result<T> {}
}

Result<User> r = userService.find(id);
String msg = switch (r) {
    case Result.Ok<User> ok -> "Found: " + ok.value().name();
    case Result.Err<User> err -> "Error: " + err.message();
};
```

Эквивалент `Result<T, E>` из Rust, sealed hierarchy из Kotlin. Без exceptions, без null — explicit error path в типах.

### 3.4. Use case 3: API stability

Библиотека публикует sealed interface — пользователи **не могут** создать свои implementations → автор гарантирует backward compatibility. Может добавлять новые subclasses в minor versions без breaking changes.

> [JEP 409: Sealed Classes](https://openjdk.org/jeps/409). Brian Goetz, [*Sealed types*](https://cr.openjdk.org/~briangoetz/amber/datum.html) — design doc.

---

## 4. Pattern matching (JEP series 394 → 441 → 488)

Эволюция в три волны.

### 4.1. `instanceof` pattern (JEP 394, stable 16)

```java
if (obj instanceof User u) {
    System.out.println(u.email());     // u — scoped binding, типа User
}
```

`u` доступен только там, где условие истинно (flow scoping). Эквивалентно Kotlin smart cast или Scala pattern matching.

Compose:
```java
if (obj instanceof User u && u.isActive()) { /* ... */ }
if (!(obj instanceof User u)) return;   // negative flow: u доступен после return
useUser(u);
```

### 4.2. Switch expression (JEP 361, stable 14)

```java
int days = switch (month) {
    case JAN, MAR, MAY, JUL, AUG, OCT, DEC -> 31;
    case APR, JUN, SEP, NOV -> 30;
    case FEB -> isLeap ? 29 : 28;
};
```

- `->` arrow form: no fallthrough, returns value;
- Multiple labels через запятую;
- `yield` для блоков:
  ```java
  int x = switch (key) {
      case "a", "b" -> 1;
      case "c" -> {
          log.info("c selected");
          yield 2;
      }
      default -> 0;
  };
  ```
- Exhaustiveness required если используется как expression.

### 4.3. Pattern matching for switch (JEP 441, stable 21)

```java
String desc = switch (shape) {
    case Circle c     -> "circle r=" + c.radius();
    case Square s     -> "square " + s.side();
    case Triangle t   -> "triangle";
    case null         -> "no shape";
};
```

Pattern matching на типах. Над sealed-иерархией — compiler знает все cases, exhaustive по умолчанию.

`case null` — separate ветка для null (default не покрывает null автоматически, в отличие от старого switch).

### 4.4. Record patterns (JEP 440, stable 21)

Деструктуризация:
```java
record Point(int x, int y) {}

double distFromOrigin(Object o) {
    return switch (o) {
        case Point(int x, int y) -> Math.hypot(x, y);
        default -> 0;
    };
}
```

Nested record patterns:
```java
record Line(Point from, Point to) {}

int dx(Line line) {
    return switch (line) {
        case Line(Point(int x1, _), Point(int x2, _)) -> x2 - x1;
    };
}
```

`_` (unnamed pattern, [JEP 456](https://openjdk.org/jeps/456), stable 22) — игнорировать component.

### 4.5. Guarded patterns (`when`)

```java
case Integer i when i > 0 -> "positive";
case Integer i            -> "zero or negative";
```

`when` clause фильтрует более точно. Полезно для разделения cases по условиям.

> [Brian Goetz, *Pattern Matching for Java*](https://cr.openjdk.org/~briangoetz/amber/pattern-match.html). [Inside Java — pattern matching](https://inside.java/tag/pattern-matching/).

---

## 5. Text blocks (JEP 378, stable 15)

```java
String json = """
        {
          "id": 1,
          "name": "Alice"
        }
        """;
```

Решает классическую проблему: SQL/JSON/HTML внутри Java строк выглядят ужасно с escape-последовательностями и конкатенациями.

### 5.1. Правила indentation

Компилятор вычисляет **common leading whitespace** (минимум по всем непустым строкам, включая закрывающий `"""`), убирает. Поэтому **положение `"""` определяет**, сколько indent остаётся:

```java
String s1 = """
        hello
        """;
// s1 = "hello\n" — leading whitespace убран

String s2 = """
        hello
""";
// s2 = "        hello\n" — закрывающий """ на col 0, indent остаётся
```

### 5.2. Escape sequences

```java
String s = """
    Line 1
    Line 2 \
    continues here
    """;
// "Line 1\nLine 2 continues here\n"  
// \<newline> — line continuation, без actual newline
```

- `\n`, `\t` — обычные;
- `\<newline>` (backslash в конце строки) — continuation;
- `\s` — non-stripped space (полезно для conservative trailing whitespace);
- `"""` — внутри text block нужен `\"\"\"` или break.

### 5.3. Use cases

- **SQL queries**:
  ```java
  String q = """
          SELECT u.id, u.name, p.title
          FROM users u
          JOIN posts p ON p.user_id = u.id
          WHERE u.active = true
          """;
  ```
- **JSON templates** (с `String.formatted`):
  ```java
  String json = """
          { "id": %d, "name": "%s" }
          """.formatted(id, name);
  ```
- **GraphQL queries, HTML fragments, regex** (multi-line).

---

## 6. `var` — local-variable type inference (JEP 286, stable 10)

```java
var list = new ArrayList<String>();   // ArrayList<String>
var map = Map.of("a", 1);              // Map<String, Integer>
for (var entry : map.entrySet()) { ... }   // Map.Entry<String, Integer>
```

### 6.1. Где можно

- Local variables;
- Loop variables (`for`, foreach);
- Try-with-resources: `try (var stream = openStream())`;
- Lambda parameters (Java 11+, нужны annotations): `(var x) -> ...`.

### 6.2. Где НЕЛЬЗЯ

- Field declaration;
- Method parameter / return type;
- Lambda parameter без annotations;
- `var x = null;` — нет inferable типа;
- `var arr = {1, 2, 3};` — array initializer без типа;
- Two declarations: `var x = 1, y = 2;` — запрещено.

### 6.3. Style guidelines

✅ Когда тип очевиден из инициализатора:
```java
var users = userRepo.findAll();   // видно List<User> из имени
var map = new HashMap<String, List<UserDto>>();   // очень длинный generic
```

❌ Когда тип непрозрачен:
```java
var result = service.compute();   // что вернулось? IDE подскажет, но в diff — нет
var x = 0;   // лишний sugar для тривиальных primitives
```

`var` — **не keyword** (reserved type name). Можно иметь поле `int var;` (но не `class var {}`).

> Brian Goetz, [*Style Guidelines for Local Variable Type Inference*](https://openjdk.org/projects/amber/guides/lvti-style-guide).

---

## 7. Helpful NullPointerException (JEP 358, stable 14)

Подробно в [`EXCEPTION_INTERNALS.md`](EXCEPTION_INTERNALS.md). Кратко:

```
Cannot invoke "Address.getCity()" because the return value 
of "Profile.getAddress()" is null
```

JVM анализирует bytecode и говорит **какое именно выражение** было null. `-XX:+ShowCodeDetailsInExceptionMessages` (default since 15).

---

## 8. `Stream` updates по версиям

- **Java 9** (JEP 269): `takeWhile`, `dropWhile`, `iterate(seed, hasNext, next)`, `ofNullable`;
- **Java 10**: `Collectors.toUnmodifiableList`;
- **Java 16** (JEP 392): `Stream.toList()` — terminal operation, возвращает **unmodifiable**:
  ```java
  List<String> l = stream.toList();   // вместо .collect(Collectors.toUnmodifiableList())
  ```
- **Java 22** ([JEP 461](https://openjdk.org/jeps/461)): `Stream.gather(...)` — пользовательские stateful intermediate ops:
  ```java
  stream.gather(Gatherers.windowFixed(3))   // sliding windows
        .toList();
  ```
  Финально решает все «у меня нет `chunked` как в Kotlin» жалобы.

---

## 9. `Optional` updates

- `Optional.or(Supplier<Optional<T>>)` — chain optionals;
- `Optional.ifPresentOrElse(action, emptyAction)`;
- `Optional.stream()` — `flatMap(Optional::stream)`;
- `Optional.orElseThrow()` — синоним `get()` без сbiased значения.

Помни: `Optional` — **для возврата** из методов (`findById`). **Не** используй как:
- Field type (boxing overhead, сериализация broken);
- Method parameter (`void foo(Optional<X> x)` — пользователю сложнее);
- Сериализация (`Jackson` не любит Optional out-of-box).

---

## 10. Concurrency-related features

### 10.1. Virtual threads (JEP 444, stable 21)

Подробно — [`modules/concurrency/theory/VIRTUAL_THREADS.md`](../../concurrency/theory/VIRTUAL_THREADS.md). Краткое:
```java
Thread.startVirtualThread(() -> handleRequest());
// или
Executors.newVirtualThreadPerTaskExecutor()
```

Lightweight threads, GB-scale (миллионы потоков на стандартном железе). M:N модель: виртуальный thread исполняется на pool **carrier** platform-threads.

### 10.2. Structured Concurrency (JEP 462, preview)

`StructuredTaskScope` — закрытый scope для concurrent tasks. См. модуль `concurrency`.

### 10.3. Scoped Values (JEP 446, preview)

Замена ThreadLocal для virtual threads — immutable, scope-bound.

---

## 11. Files / I/O updates

- **Java 11**: `Files.readString`, `Files.writeString`, `Files.mismatch`, `String.repeat`, `String.lines`, **HttpClient** ([JEP 321](https://openjdk.org/jeps/321)) — naked HTTP без Apache HttpClient;
- **Java 18**: `SimpleWebServer` (`jwebserver`) для статики, удобно для дев-окружений.

`HttpClient` пример:
```java
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder(URI.create("https://api.com/data")).build();
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
```

Async через `sendAsync` → `CompletableFuture<HttpResponse<...>>`.

---

## 12. LTS-обзор: что внести в собес

| LTS | Год | Главное |
|---|---|---|
| **8** (2014) | lambda, Stream, `Optional`, `default` methods, `LocalDateTime` |
| **11** (2018) | `var`, HttpClient, `String.repeat/lines`, deprecated Applet API |
| **17** (2021) | Sealed, records (16+), pattern match instanceof, text blocks |
| **21** (2023) | Virtual threads, pattern matching switch, record patterns, sequenced collections, Generational ZGC |
| **25** (2025, плановый LTS) | Scoped values stable, structured concurrency stable, ещё pattern features |

Spring Boot 3 требует **минимум 17**. Spring 6 LTS — `17+`. В 2025 enterprise обычно на 17 или 21.

---

## 13. Что превентно ушло

- **Apple Java**: больше не существует с 2014, OS X использует AdoptOpenJDK/Eclipse Temurin;
- **`finalize()`**: deprecated for-removal с 9, не использовать;
- **`Security Manager`**: deprecated for-removal в [JEP 411](https://openjdk.org/jeps/411), не использовать;
- **CMS GC**: удалён в 14;
- **Applets, JNLP, Web Start, Java EE classes**: удалены в 11;
- **`com.sun.awt.AWTUtilities`** и internal sun-API: warning → error с 16;
- **Biased locking**: удалён в 18+ (давал false safety, медленнее современных uncontended locks).

---

## 14. Что обязательно знать на собесе

1. **Records (JEP 395)** — что генерируется, ограничения, canonical/compact constructor.
2. **Sealed (JEP 409)** — зачем, как пара с pattern matching → ADT.
3. **Pattern matching evolution** — instanceof (16) → switch (21) → record patterns (21) → `_` (22).
4. **Text blocks** — indentation rules, escape sequences.
5. **`var`** — где можно/нельзя, style guidelines.
6. **Helpful NPE** — что показывает, флаг.
7. **`Stream.toList()` vs `Collectors.toUnmodifiableList`** — что появилось в 16.
8. **`Stream.gather`** (Java 22) — пользовательские stateful ops.
9. **HttpClient** (Java 11) — реактивный + sync API.
10. **Virtual threads** — JEP 444, изменение модели concurrency.

---

## Related

- Records и canonical equals → [`EQUALS_HASHCODE_COMPARABLE.md`](EQUALS_HASHCODE_COMPARABLE.md)
- Pattern matching bytecode (invokedynamic + SwitchBootstraps) → [`BYTECODE_INVOKEDYNAMIC.md`](BYTECODE_INVOKEDYNAMIC.md)
- Helpful NPE / sealed exceptions → [`EXCEPTION_INTERNALS.md`](EXCEPTION_INTERNALS.md)
- Virtual threads → [`modules/concurrency/theory/VIRTUAL_THREADS.md`](../../concurrency/theory/VIRTUAL_THREADS.md)

### Внешние ресурсы

- **JEP index** — <https://openjdk.org/jeps/0>
- **Project Amber** (language features) — <https://openjdk.org/projects/amber/>
- **Inside Java** (Oracle blog) — <https://inside.java/>
- **Brian Goetz YouTube** — talks на JVM Language Summit, Devoxx
- **Nicolai Parlog (nipafx)**: <https://nipafx.dev/> — особенно «Features in JDK X»
- **JDK Release Notes** — <https://www.oracle.com/java/technologies/javase/jdk-relnotes-index.html>
