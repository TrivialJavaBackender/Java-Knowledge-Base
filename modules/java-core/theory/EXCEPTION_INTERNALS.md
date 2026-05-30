# Exception Internals

---

## 1. Почему exceptions — нетривиальная тема

«Throw exception» кажется простой операцией: создал `new IOException()`, бросил, поймал, обработал. На senior-собесе под этим — целый набор тонкостей: производительность, semantics finally, suppressed exceptions, sealed hierarchies, Helpful NPE, checked-vs-unchecked policy, как exception влияет на JIT.

В отличие от C++, где exception — относительно прозрачная вещь, в Java вокруг exceptions слой инфраструктуры (`Throwable.fillInStackTrace`, HotSpot Omit-trace optimization, JEP 358, try-with-resources bytecode generation). Знание этого слоя отличает senior-разработчика от middle.

---

## 2. Иерархия `Throwable`

```
Throwable
├── Error                          // catastrophic, обычно не ловить
│   ├── OutOfMemoryError
│   ├── StackOverflowError
│   ├── VirtualMachineError        // InternalError, UnknownError, ZipError, ...
│   ├── NoClassDefFoundError
│   ├── ExceptionInInitializerError
│   └── LinkageError (parent для NoClassDef и ClassFormatError)
└── Exception
    ├── RuntimeException           // unchecked
    │   ├── NullPointerException
    │   ├── IllegalArgumentException
    │   ├── ClassCastException
    │   ├── IndexOutOfBoundsException
    │   └── ...
    └── IOException, SQLException, ParseException, ... // checked
```

### 2.1. Три категории

**`Error`** — environment-level катастрофы. `OutOfMemoryError`, `StackOverflowError`, `VirtualMachineError`. По соглашению **не ловить**:
- состояние JVM может быть **поломано** (OOM = непредсказуемо, какой объект не получилось аллоцировать);
- `Thread.UncaughtExceptionHandler` — место «последнего слова»;
- Servlet-containers всё равно перезапустят запрос.

Исключение — `StackOverflowError` в parser, где **известно**, как восстановиться (ANTLR error recovery).

**`Checked Exception`** (`IOException`, `SQLException`) — компилятор требует `throws` или `try/catch`. Идея — заставить программиста думать об ошибке.

**`Unchecked` (`RuntimeException`/`Error`)** — компилятор не требует. Использовать когда:
- bug в коде (NPE, IndexOutOfBounds, IllegalArgumentException);
- environment-failure, который нельзя осмысленно обработать (OOM, файл удалён).

---

## 3. Checked vs Unchecked — большая дискуссия

Концепция checked exceptions казалась элегантной в 1995. Реальность 2025 — большинство сообщества **отказались** от них в пользу unchecked.

### 3.1. Аргументы против checked

1. **Не композируются с лямбдами.** `Function<T, R>.apply` объявлен без `throws`. Любая lambda с checked exception → не валидна:
   ```java
   files.stream()
        .map(Files::readString)   // COMPILE ERROR: IOException
        .toList();
   ```
   Workaround — обернуть в RuntimeException, что обесценивает идею checked.

2. **Утечка implementation details.** `throws SQLException` в interface обязывает все implementations либо тоже бросать SQLException, либо ловить и оборачивать. Это **связывает** abstraction с конкретным backend.

3. **«Catch and ignore» антипаттерн.** Программист видит обязательный `try/catch`, пишет `catch (Exception e) {}` — exception тихо съедается.

4. **Огромный `throws` clause.** Метод с пятью checked exceptions нечитабельный.

### 3.2. Кто как поступил

- **Spring**: всё `RuntimeException`. `DataAccessException` обёртка над `SQLException`.
- **Hibernate**: `HibernateException` — unchecked.
- **Jackson**: `JsonProcessingException` (checked в 2.x, оставили из совместимости).
- **Kotlin**: **не имеет** checked exceptions вообще. `@Throws` annotation для Java interop.
- **Scala**: то же — checked exceptions deprecated в practice.

Современная Java практика: **бросай unchecked**, оборачивай checked-from-JDK через `RuntimeException` или специфичный subclass. Checked exceptions используй только когда у вызывающего **есть** осмысленный action в ответ.

---

## 4. Stack trace и `fillInStackTrace`

Главный fact о exception в Java: **создание дорого**.

`Throwable.fillInStackTrace()` — native метод, обходящий весь стек потока и копирующий frame info. Стоимость пропорциональна глубине стека: типично **10–100 µs** на throw.

`new RuntimeException(...)` вызывает `fillInStackTrace()` в конструкторе. **Поэтому создание exception дорого даже без `throw`.**

```java
RuntimeException e = new RuntimeException("test");
// уже стоит 50 µs, даже если throw не сделать
```

### 4.1. Exception как control flow — антипаттерн

```java
// Парсер чисел с exception для backtracking
try {
    return Integer.parseInt(s);
} catch (NumberFormatException e) {
    return defaultValue;
}
```

Если `parseInt` фейлится на 30% входов в hot loop — `fillInStackTrace` доминирует. **Real-world**: Jackson при парсинге JSON внутренне использует exception-as-control-flow, и платит за это.

### 4.2. «Дешёвый» exception

```java
class FastException extends RuntimeException {
    public FastException(String msg) {
        super(msg, null, false, false);   // Java 7+
        // 3rd arg = enableSuppression
        // 4th arg = writableStackTrace
    }
}
```

`Throwable(message, cause, enableSuppression, writableStackTrace)` — конструктор с Java 7+. Отключение `writableStackTrace` означает `fillInStackTrace` — no-op. Cost: ~100 ns.

Альтернатива — переопределить:
```java
class FastException extends RuntimeException {
    @Override public synchronized Throwable fillInStackTrace() { return this; }
}
```

Полезно для:
- Cancellation exceptions (нужны для signaling, не для дебага);
- Internal parser exceptions;
- Hot-path failure paths где stack trace бесполезен.

### 4.3. HotSpot OmitStackTraceInFastThrow

HotSpot оптимизация: для **frequently thrown** built-in exceptions (NPE, ArrayIndexOutOfBounds, ArithmeticException, ClassCastException) после warmup JIT **обнуляет stack trace** — кидает singleton-instance с пустым trace:

```
java.lang.NullPointerException
        at MyClass.method(MyClass.java:42)

... после нескольких сотен throws того же exception ...

java.lang.NullPointerException
        (no stack trace)
```

Production-лог теряет место — отладка превращается в ад. Чинится JVM-флагом:
```
-XX:-OmitStackTraceInFastThrow
```

В dev/staging обязательно отключать. В prod — оставлять (производительность важна), но **фиксить root cause** быстро.

> [Aleksey Shipilëv on stack trace cost](https://shipilev.net/jvm/anatomy-quarks/22-cooperative-jit-tasks/) — серия про JVM internals.

---

## 5. Helpful NPE (JEP 358, Java 14+)

Старая NPE была информационно бедной:
```
Exception in thread "main" java.lang.NullPointerException
        at MyClass.method(MyClass.java:42)
```

Какое именно выражение было null? В строке может быть 5 dot-accesses:
```java
user.getProfile().getAddress().getCity().toUpperCase();   // что null?
```

JEP 358 анализирует bytecode и говорит:
```
Exception in thread "main" java.lang.NullPointerException: 
        Cannot invoke "Address.getCity()" because the return value 
        of "Profile.getAddress()" is null
        at MyClass.method(MyClass.java:42)
```

Это сразу указывает на root cause. Игнорировать невозможно — экономит часы дебага.

Управление:
- `-XX:+ShowCodeDetailsInExceptionMessages` (default on с 15+);
- Не работает в коде без debug info (`-g:none`);
- В Java 14 был preview, в 15+ — default.

> [JEP 358: Helpful NullPointerExceptions](https://openjdk.org/jeps/358).

---

## 6. `try` / `catch` / `finally` поведение

### 6.1. Когда `finally` НЕ выполняется

`finally` выполняется **почти всегда**. Исключения:
- `System.exit()` (JVM завершает работу);
- `Runtime.halt()` (немедленный exit, без shutdown hooks);
- JVM crash (segfault native кода через JNI);
- kill -9 / OOMKilled от kernel;
- infinite loop / deadlock в `try` (finally никогда не достигается).

### 6.2. `return` в `finally` подменяет

```java
public String method() {
    try { return "a"; }
    finally { return "b"; }
}
// → "b", "a" потеряно
```

Любой return в `finally` **доминирует** над return в `try`. Это же относится к exception в finally:
```java
try { throw new RuntimeException("from try"); }
finally { return "from finally"; }
// → "from finally", exception потерян!
```

IDE и Checkstyle обычно выдают предупреждение на `return` в `finally` — антипаттерн.

### 6.3. `throw` в `finally` подавляет

```java
try { throw new RuntimeException("from try"); }
finally { throw new IllegalStateException("from finally"); }
// → IllegalStateException, "from try" потерян!
```

В обычном `finally` второй throw **затирает** первый. Это причина появления **suppressed exceptions** в try-with-resources (см. §7).

---

## 7. try-with-resources и `Throwable.addSuppressed`

```java
try (var stream = Files.lines(path)) {
    process(stream);
}
```

С Java 7. Resource должен реализовать `AutoCloseable` (или `Closeable`). Компилятор генерирует bytecode эквивалентный:

```java
var stream = Files.lines(path);
Throwable primary = null;
try {
    process(stream);
} catch (Throwable t) {
    primary = t;
    throw t;
} finally {
    if (stream != null) {
        if (primary != null) {
            try { stream.close(); }
            catch (Throwable closeEx) { primary.addSuppressed(closeEx); }
        } else {
            stream.close();
        }
    }
}
```

Ключевая идея — **suppressed exception**. Если `try` бросил `primary`, и `close()` тоже бросил → close-exception **не теряется**, добавляется в `primary.getSuppressed()`. В печати:

```
IOException: from try
        at MyClass.method(MyClass.java:42)
    Suppressed: SQLException: from close
        at MyClass.method(MyClass.java:43)
```

Без try-with-resources при ручном `finally` `close()`-exception **затирал** primary — главный bug (теряли первую причину).

### 7.1. `AutoCloseable` vs `Closeable`

```java
public interface AutoCloseable {
    void close() throws Exception;       // generic, бросает Exception
}

public interface Closeable extends AutoCloseable {
    void close() throws IOException;     // более узкое — для I/O
}
```

- `Closeable extends AutoCloseable` (с Java 7);
- `Closeable.close()` идемпотентен (можно вызывать многократно без эффекта);
- `AutoCloseable.close()` — без такой гарантии.

В современном коде **объявляй `AutoCloseable`** для любых ресурсов (Database connections, locks, scoped objects). `Closeable` оставь для I/O streams (наследуют от 1.5 года).

### 7.2. С Java 9 — `try (existingFinalVar)`

```java
final var s = openStream();
try (s) { ... }
```

Без объявления новой переменной. Полезно для resources, переданных в метод.

---

## 8. Multi-catch

С Java 7:
```java
try { ... }
catch (IOException | SQLException e) {
    log.error("data access failed", e);
}
```

В catch-блоке `e` имеет тип их **common ancestor** (тут `Exception`). Эффективнее, чем дублировать catch.

С Java 7 же — **precise rethrow**:
```java
public void method() throws SQLException, IOException {
    try { ... }
    catch (Exception e) {
        log.error("error", e);
        throw e;   // компилятор знает реальные типы, throws clause correct
    }
}
```

До Java 7 пришлось бы перехватывать отдельно или объявить `throws Exception`.

---

## 9. Sealed exception hierarchies (Java 17+)

```java
public sealed class ParseError extends RuntimeException
    permits SyntaxError, SemanticError, IoError {
    public ParseError(String msg) { super(msg); }
}

public final class SyntaxError extends ParseError { ... }
public final class SemanticError extends ParseError { ... }
public final class IoError extends ParseError { ... }
```

В сочетании с `switch` pattern matching — **exhaustive error handling**:
```java
String describe(ParseError e) {
    return switch (e) {
        case SyntaxError s   -> "syntax at " + s.position();
        case SemanticError s -> "semantic: " + s.reason();
        case IoError s        -> "I/O: " + s.path();
    };
}
```

Если добавишь `NetworkError` в иерархию — все switch с `ParseError` сломаются на compile-time. Это **forced** обновление всех call sites — то, что нужно для evolving error models.

Особенно полезно в functional / domain-driven коде. Подробнее — [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md).

---

## 10. Catch-and-throw паттерны

### 10.1. Wrap-and-rethrow (chained)

```java
try { dbCall(); }
catch (SQLException e) {
    throw new DataAccessException("Cannot read user", e);  // chained
}
```

`Throwable.getCause()` → `e`. Цепочка пробегается через `Throwable.printStackTrace()`:
```
DataAccessException: Cannot read user
    at MyService.read(MyService.java:42)
Caused by: SQLException: ...
    at JDBC...
```

Этот паттерн используется массово в Spring (`DataAccessException`), Hibernate (`HibernateException`).

### 10.2. Anti-pattern: log-and-throw

```java
try { ... }
catch (Exception e) {
    log.error("failed", e);    // лог 1
    throw e;                    // ... перебросили
}
// catch ниже снова логирует exception → ДВА одинаковых stack trace в логах
```

Решения:
- **Либо** лог, **либо** throw — не оба;
- Если оба нужны — лог с уровнем DEBUG, throw для production handler.

См. [`modules/infrastructure/theory/LOGGING.md`](../../infrastructure/theory/LOGGING.md) — этот антипаттерн обсуждается отдельно.

### 10.3. SneakyThrow — спорный

```java
@SuppressWarnings("unchecked")
static <T extends Throwable> void sneaky(Throwable t) throws T {
    throw (T) t;
}
sneaky(new IOException());   // компилятор не видит checked!
```

Используется Lombok `@SneakyThrows`. Технически легально — JVM не проверяет declared throws, только компилятор. Обходит compile-time контракты.

Аргументы за: упрощает interop с APIs, которые не должны были использовать checked.
Аргументы против: ломает caller assumptions; вызывающий может неожиданно получить checked exception, который думал, что метод бросает только unchecked.

**Используй умеренно**, документируй каждое использование. В команде согласовать как convention.

---

## 11. JIT и exceptions

JIT может **частично** оптимизировать exception-aware код, но exceptions остаются **слепой зоной** для большинства оптимизаций:

- **Inline** методов с `throws` — частично работает;
- **Escape analysis** для exception object — обычно не делает (объект имеет cycle через addSuppressed);
- **Throws сразу убивает** branch prediction prefetch;
- **OmitStackTraceInFastThrow** — единственная серьёзная JIT-optimization для exception path.

В hot path **избегай** exceptions для control flow — Optional, sentinel values, или explicit error-return type (`Either`, `Result`).

---

## 12. Stack overflow и tail call

JVM **не делает** tail-call optimization (TCO). Глубокая рекурсия → `StackOverflowError`:

```java
int sum(int n, int acc) {
    if (n == 0) return acc;
    return sum(n - 1, acc + n);   // tail call! но JVM создаст frame
}
sum(1_000_000, 0);   // StackOverflowError
```

Workarounds:
- Итеративный код (`for` loop);
- Explicit stack-based reformulation;
- **Kotlin `tailrec`** — компилируется в loop, но это compile-time trick Kotlin'a, не JVM feature.

**Project Loom / Valhalla** возможно принесут TCO в будущем. Пока — нет.

---

## 13. Что обязательно знать на собесе

1. **Throwable hierarchy**: Error / Exception / RuntimeException — кто что значит.
2. **Checked vs unchecked** — современная практика (Spring/Hibernate всё unchecked).
3. **`fillInStackTrace`** — почему создание exception дорого, как сделать «дешёвый».
4. **`OmitStackTraceInFastThrow`** — почему trace «исчезает», флаг для отключения.
5. **Helpful NPE (JEP 358)** — что это, как помогает.
6. **try-with-resources + addSuppressed** — что генерирует компилятор, как работает.
7. **`AutoCloseable` vs `Closeable`** — разница.
8. **Multi-catch + precise rethrow** — что добавила Java 7.
9. **Sealed exceptions** — exhaustive switch handling.
10. **Log-and-throw antipattern** — почему плохо.

---

## Related

- Logging exception, MDC, correlation ID → [`modules/infrastructure/theory/LOGGING.md`](../../infrastructure/theory/LOGGING.md)
- CoroutineExceptionHandler и cancellation → [`modules/kotlin-coroutines/theory/CANCELLATION_EXCEPTIONS.md`](../../kotlin-coroutines/theory/CANCELLATION_EXCEPTIONS.md)
- Sealed classes, pattern matching → [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md)
- StackOverflowError и `-Xss` → [`JVM_MEMORY_AREAS.md`](JVM_MEMORY_AREAS.md)

### Внешние ресурсы

- **JEP 358 Helpful NPE**: <https://openjdk.org/jeps/358>
- **Joshua Bloch, *Effective Java*** — Items 69-77 про exceptions
- **Brian Goetz, *Exception of None*** — <https://www.infoq.com/articles/exceptions-java-best-practices/>
- **Inside Java — exceptions tag**: <https://inside.java/tag/exceptions/>
- **Shipilëv on exception cost** — обсуждение в [JMH samples](https://github.com/openjdk/jmh/blob/master/jmh-samples/src/main/java/org/openjdk/jmh/samples/JMHSample_35_Profilers.java)
