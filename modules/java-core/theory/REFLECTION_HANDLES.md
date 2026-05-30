# Reflection, MethodHandle, VarHandle

---

## 1. Три механизма, три эпохи

Java имеет три **поколения** API для динамического доступа к классам, полям и методам. Каждое поколение решает проблемы предыдущего:

| API | Год | Сценарий использования | Что добавил |
|---|---|---|---|
| **Reflection** | 1997 (Java 1.1) | introspection, фреймворки, сериализация | runtime API |
| **MethodHandle** | 2011 (Java 7) | indirect calls, lambda, language runtimes | typed, JIT-friendly invocation |
| **VarHandle** | 2017 (Java 9) | atomic-доступ к полям, замена `Unsafe` | typed access modes для concurrency |

В современном коде они **сосуществуют** — для разных задач. Reflection остаётся правильным выбором для большинства introspection-задач (Jackson, Spring DI, JPA). MethodHandle — для performance-критичного invocation. VarHandle — для lock-free concurrency.

---

## 2. Reflection API

Корневые типы в пакете `java.lang.reflect`:

- `Class<T>` — метаобъект класса. Получить можно через `obj.getClass()`, `Foo.class`, `Class.forName(name)`.
- `Method` — метод (включая static), получить через `Class.getMethod(name, paramTypes)` / `getDeclaredMethod`.
- `Constructor` — конструктор.
- `Field` — поле.
- `Parameter` — параметр метода (с Java 8, с info об имени если `javac -parameters`).
- `Annotation`, `AnnotatedType` — аннотации, type-use annotations с Java 8.

### 2.1. Базовое использование

```java
Class<?> c = Class.forName("com.foo.Bar");
Method m = c.getDeclaredMethod("doStuff", int.class);
m.setAccessible(true);                          // см. §5
Object result = m.invoke(instance, 42);

Field f = c.getDeclaredField("counter");
f.setAccessible(true);
long val = f.getLong(instance);
```

### 2.2. `getMethods()` vs `getDeclaredMethods()` — постоянная путаница

```java
class Parent {
    public void publicInherited() {}
    private void privateInParent() {}
}

class Child extends Parent {
    public void publicInChild() {}
    private void privateInChild() {}
}

Child.class.getMethods();
// → publicInherited, publicInChild, + 9 от Object (hashCode, equals, toString, ...)
// БЕЗ private!

Child.class.getDeclaredMethods();
// → publicInChild, privateInChild
// ТОЛЬКО Child, БЕЗ унаследованных, ВКЛЮЧАЯ private
```

| Method | Унаследованные? | Private? |
|---|---|---|
| `getMethods()` | да | нет |
| `getDeclaredMethods()` | нет | да |

Чтобы получить **все** методы — нужно идти по иерархии вручную: `class.getSuperclass()` и т.д. Это типичная задача для фреймворков (Jackson обходит классы рекурсивно).

### 2.3. `Class.forName` triggers `<clinit>`

```java
Class.forName("com.foo.Heavy");    // ЗАПУСКАЕТ <clinit>!
```

Это запускает initialization класса (см. [`CLASS_LOADERS.md`](CLASS_LOADERS.md) §4.4). Если `<clinit>` упадёт — `ExceptionInInitializerError` пойдёт через твой код.

Чтобы загрузить без init:
```java
Class.forName("com.foo.Heavy", false, classLoader);
```

Или использовать `Class.forName(name).getClassLoader()...` для metadata.

---

## 3. Стоимость reflection

Это **главный** аргумент против reflection в hot path. Что происходит при `Method.invoke(obj, args)`:

1. **Access check** (если не `setAccessible(true)`): security manager + JPMS validation. Микросекунды.
2. **Argument boxing** в `Object[]`: primitives → wrappers (Integer, Long). Allocation per call.
3. **Метод dispatch**: ищется реализация (virtual / interface lookup).
4. **Inflation**: первые ~15 вызовов идут через native реализацию. После — JVM генерирует **`MethodAccessor`** (bytecode-генерированный wrapper) — становится быстрее.
5. **Return value boxing** обратно из primitive.

```
Direct call: ~1 ns
MethodHandle invoke: ~1-2 ns (после JIT inline)
Reflection (after inflation): ~10-50 ns
Reflection (per-call check): 100-1000 ns
```

### 3.1. Когда reflection нормально

- **Бутстрап фреймворков** — один раз на старте Spring DI, Jackson type discovery, JPA mapping. Cost = milliseconds total → invisible.
- **Конфигурация** — выбор класса из properties файла.
- **Тесты** — Mockito spy через reflection.
- **Annotation discovery** — сканирование classpath.

### 3.2. Когда reflection — проблема

- **Hot path** — в каждом HTTP-запросе сериализатор делает reflection. Накопленная задержка → реальный hit. Серьёзные сериализаторы (Jackson, Gson) кэшируют reflection lookups, делают MethodHandle / generated code.
- **Tight loop** — миллиард invocations. Должно быть direct call или MethodHandle.

JIT может **частично** оптимизировать reflection (если `Method` объект — стабильная константа), но обычно **рассматривает reflection как барьер для оптимизаций**.

Альтернативы:
- **MethodHandle** (см. §6) — для invocation;
- **Кодогенерация** (Lombok, MapStruct, ImmutableAnnotation) — code-time;
- **Records** (см. [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md)) — auto-generated equals/hashCode без reflection.

---

## 4. Reflection и JPMS

С Java 9 reflection **не может** обращаться к internal JDK-классам (`sun.misc.Unsafe`, `jdk.internal.*`) без явного разрешения. Это часть JPMS encapsulation (см. [`JPMS_MODULES.md`](JPMS_MODULES.md)).

```
WARNING: An illegal reflective access operation has occurred
WARNING: Illegal reflective access by org.lombok.Lombok 
  (file:.../lombok.jar) to field java.lang.String.value
```

Эволюция строгости:
- **Java 9–15**: warning, доступ работает (deprecated by default).
- **Java 16** ([JEP 396](https://openjdk.org/jeps/396)): **strong encapsulation by default** — warning превращается в `IllegalAccessException`.
- **Java 17+**: окончательно strong, никаких backdoor флагов кроме `--add-opens`.

Сломались: Lombok (до 1.18.x), Mockito (до v3.x), Spring (до 5.2 в специфических случаях), Hibernate, JRebel, всё что глубоко лезло в reflection.

Решения:
1. **`--add-opens`** JVM флаг для разрешения reflection на конкретный пакет:
   ```
   --add-opens java.base/java.lang=ALL-UNNAMED
   --add-opens java.base/java.util=ALL-UNNAMED
   ```
2. **`opens` в module-info.java** — официальное разрешение со стороны автора модуля:
   ```java
   module my.app {
       opens com.foo.dto to com.fasterxml.jackson.databind;
   }
   ```
3. **Reflection-free APIs**: VarHandle, MethodHandle вместо `Field`, `Method`.

### 4.1. `exports` vs `opens`

| | Видимость |
|---|---|
| `exports pkg` | compile-time access from other modules to public types |
| `opens pkg` | runtime reflection access (deep, к private членам) |

`exports` НЕ позволяет reflection. `opens` НЕ позволяет static use без `requires`. Это разные axes encapsulation.

`open module` — short form, открывает все пакеты для reflection:
```java
open module com.example.app { ... }
```

---

## 5. `setAccessible(true)` — что это даёт

`AccessibleObject.setAccessible(true)` отключает access check для **этого конкретного объекта** (`Method`/`Field`/`Constructor`).

```java
Field f = obj.getClass().getDeclaredField("password");
f.setAccessible(true);
Object value = f.get(obj);   // достаём private field
```

Что **отключает**:
- Visibility check (`private`, `protected`, package-private);
- Per-call access verification.

Что **НЕ отключает** для JPMS-encapsulated modules:
- `IllegalAccessException` без явного `opens` в module-info.

Performance: после `setAccessible(true)` invoke быстрее (нет per-call check). Поэтому фреймворки делают это один раз на старте и кэшируют `Method`/`Field`.

### 5.1. SecurityManager (deprecated)

До Java 17 `SecurityManager` мог отвергать `setAccessible`:
```java
SecurityManager sm = System.getSecurityManager();
if (sm != null) sm.checkPermission(new ReflectPermission("suppressAccessChecks"));
```

С Java 17 ([JEP 411](https://openjdk.org/jeps/411)) `SecurityManager` deprecated for removal. На практике никто не использует, можно игнорировать.

---

## 6. `MethodHandle` — современный indirect call

См. также [`BYTECODE_INVOKEDYNAMIC.md`](BYTECODE_INVOKEDYNAMIC.md) §8. Главное:

```java
import java.lang.invoke.*;
import static java.lang.invoke.MethodType.*;

MethodHandles.Lookup lk = MethodHandles.lookup();
MethodHandle add = lk.findStatic(Math.class, "addExact",
                                  methodType(int.class, int.class, int.class));
int r = (int) add.invokeExact(2, 3);   // 5
```

`Lookup` — это **capability**, привязанная к classloader/permissions создавшего его класса. Доступ к private членам — только из того же класса:

```java
class Foo {
    private int x;
    static final Lookup INTERNAL = MethodHandles.lookup();
}

// В другом классе:
Lookup priv = MethodHandles.privateLookupIn(Foo.class, MethodHandles.lookup());
// priv может находить private членов Foo, если modules позволяют
```

### 6.1. Factory methods

- `findStatic(class, name, MethodType)` — `invokestatic`;
- `findVirtual(class, name, MethodType)` — `invokevirtual`;
- `findConstructor(class, MethodType)` — `<init>`;
- `findGetter(class, name, fieldType)` / `findSetter` — для полей;
- `findStaticGetter` / `findStaticSetter` — static полей;
- `findSpecial(class, name, MethodType, callerClass)` — `invokespecial` для super calls.

### 6.2. `invokeExact` vs `invoke`

`invokeExact` — самый быстрый, требует **точного** соответствия типов. `WrongMethodTypeException` если не совпадают.

`invoke` — допускает widening (int → long), boxing (int → Integer), null checking. Чуть медленнее (один уровень indirection).

Reference type — must use **typed cast at call site**:
```java
int r = (int) add.invokeExact(2, 3);   // (int) ОБЯЗАТЕЛЕН
```

Без cast — `WrongMethodTypeException`.

### 6.3. Combinators — functional language

`java.lang.invoke.MethodHandles` имеет десятки методов для композиции MH. Это минималистичный functional language:

```java
// Partial application
MethodHandle add = ...   // (int, int) -> int
MethodHandle inc = MethodHandles.insertArguments(add, 1, 1);  // (int) -> int

// Permute args
MethodHandle subReverse = MethodHandles.permuteArguments(sub,
    methodType(int.class, int.class, int.class), 1, 0);  // (a,b) -> sub(b,a)

// Filter args
MethodHandle wrappedAdd = MethodHandles.filterArguments(add, 0,
    lk.findStatic(Math.class, "abs", methodType(int.class, int.class)));
// → add(abs(a), b)

// Conditional dispatch
MethodHandle safeDiv = MethodHandles.guardWithTest(checkNonZero, divide, returnZero);

// Exception handling
MethodHandle safeCall = MethodHandles.catchException(unsafeCall, IOException.class, recovery);
```

Используется LambdaMetafactory, StringConcatFactory, MethodHandle-based proxies.

### 6.4. JIT inlining

JIT inline-ит MH-цепочки **полностью** через специальный механизм. Метод `MethodHandle.invokeExact` имеет аннотацию `@PolymorphicSignature` — JIT может специализировать его для конкретных типов call site. После inline и оптимизации MH-чейн обычно сравним с direct call.

---

## 7. `VarHandle` — atomic access к полям

`VarHandle` ([JEP 193](https://openjdk.org/jeps/193), Java 9) — замена `Unsafe.compareAndSwapInt` и `AtomicXxxFieldUpdater`. Доступ к **полю или элементу массива** с явным **memory ordering**.

### 7.1. Создание и использование

```java
class Counter {
    @SuppressWarnings("unused")
    private volatile long value;

    private static final VarHandle VAL;
    static {
        try {
            VAL = MethodHandles.lookup()
                .findVarHandle(Counter.class, "value", long.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    long get()           { return (long) VAL.getAcquire(this); }
    void set(long v)     { VAL.setRelease(this, v); }
    long inc()           { return (long) VAL.getAndAdd(this, 1L); }
    boolean cas(long expected, long updated) {
        return VAL.compareAndSet(this, expected, updated);
    }
}
```

VarHandle хранится в `static final` поле — это даёт constant-folding JIT, нет overhead на lookup.

### 7.2. Access modes — 5 уровней

VarHandle предоставляет 5 уровней access modes, от слабого к сильному. **Это ключевое отличие** от обычного volatile / synchronized — можно явно выбирать **минимально достаточный** уровень синхронизации.

#### Plain (`get`, `set`)

Нет memory ordering. Эквивалентно обычному полю **не volatile**. Compiler/CPU могут reorder вокруг этого доступа. Самый быстрый.

Сценарий: thread-local access, или поля защищённые внешним lock.

#### Opaque (`getOpaque`, `setOpaque`)

**Coherent**: один поток видит свои собственные записи в порядке. Без cross-thread effects.

Сценарий: progress indicators, statistics counters, где **не нужны** happens-before гарантии cross-thread.

#### Acquire / Release

**Acquire** (`getAcquire`): после этого чтения, все последующие операции **не могут** быть reordered перед ним.

**Release** (`setRelease`): перед этой записью, все предыдущие операции **не могут** быть reordered после неё.

**Пара** acquire-release создаёт happens-before: всё, что было до `setRelease` в одном потоке — видно после `getAcquire` в другом.

Дешевле volatile (нет full StoreLoad fence). Стандартный паттерн **producer-consumer** в lock-free дизайне:

```java
// Producer
data = computeBigThing();
VAL.setRelease(this, READY);  // publish

// Consumer
if (VAL.getAcquire(this) == READY) {  // observe
    use(data);   // safe to read
}
```

Используется в Disruptor LMAX, очередях с одним producer и consumer.

#### Volatile (`getVolatile`, `setVolatile`)

Семантика обычного volatile-поля: sequential consistency для этого field. Дороже acquire-release.

Сценарий: ring-buffer indices, cross-thread flags requiring strict ordering.

#### Atomic ops

- `compareAndSet(expected, updated)` — CAS, full memory ordering, returns boolean.
- `compareAndExchange(expected, updated)` — like CAS, but returns witness value.
- `getAndAdd(delta)`, `getAndSet(value)`, `getAndBitwiseOr(...)` — fetch-and-modify atomics.

Все CAS-семантика, full ordering.

### 7.3. Array element access

```java
VarHandle ARRAY_INT = MethodHandles.arrayElementVarHandle(int[].class);
int[] arr = new int[100];
ARRAY_INT.compareAndSet(arr, 5, 0, 42);   // CAS arr[5] from 0 to 42
```

Полезно для lock-free структур (Treiber stack, Michael-Scott queue, hash tables).

### 7.4. Memory layout (for FFM)

С Java 14+ можно делать VarHandle над `MemorySegment` для off-heap atomic operations:

```java
VarHandle INT_AT = ValueLayout.JAVA_INT.varHandle();
try (Arena arena = Arena.ofConfined()) {
    MemorySegment seg = arena.allocate(8);
    INT_AT.compareAndSet(seg, 0L, 0, 42);
}
```

См. [`FOREIGN_MEMORY_VECTOR.md`](FOREIGN_MEMORY_VECTOR.md).

---

## 8. `AtomicXxxFieldUpdater` — legacy

До Java 9 атомарный доступ к volatile-полю — через `AtomicLongFieldUpdater`:

```java
class Counter {
    volatile long value;
    static final AtomicLongFieldUpdater<Counter> UPD =
        AtomicLongFieldUpdater.newUpdater(Counter.class, "value");

    long inc() { return UPD.incrementAndGet(this); }
}
```

Семантически эквивалентно `VarHandle.getAndAdd(this, 1L)`. Использует `Unsafe` под капотом. **Deprecated в пользу VarHandle** — VarHandle быстрее (constant-folding), безопаснее (typed), и портативно (без Unsafe).

---

## 9. Annotation processing — runtime vs compile-time

### 9.1. Runtime reflection для аннотаций

```java
@Retention(RetentionPolicy.RUNTIME)   // ОБЯЗАТЕЛЬНО — иначе аннотация исчезнет
@interface Service { String value(); }

Service s = MyClass.class.getAnnotation(Service.class);
if (s != null) System.out.println(s.value());
```

Retention:
- `SOURCE` — только в исходниках, выкидывается javac (`@Override`, `@SuppressWarnings`);
- `CLASS` — в bytecode, но не доступно reflection (default);
- `RUNTIME` — в bytecode + reflection.

Сценарии использования: Spring `@Service`, JPA `@Entity`, Jackson `@JsonProperty` — все RUNTIME.

### 9.2. Compile-time processing

```java
@SupportedAnnotationTypes("com.foo.MyAnnotation")
@SupportedSourceVersion(SourceVersion.RELEASE_21)
public class MyProcessor extends AbstractProcessor {
    @Override
    public boolean process(Set<? extends TypeElement> annotations,
                           RoundEnvironment roundEnv) {
        for (Element e : roundEnv.getElementsAnnotatedWith(MyAnnotation.class)) {
            // ходим по AST через `Element`
            // генерируем код через `processingEnv.getFiler()`
        }
        return true;
    }
}
```

Регистрация: через `META-INF/services/javax.annotation.processing.Processor` или `@AutoService` (Google).

Используется в:
- **Dagger 2** (Google DI) — генерирует код без reflection;
- **MapStruct** — DTO ↔ Entity mapping;
- **AutoValue** — `@AutoValue` → builder + equals/hashCode (pre-records);
- **Immutables** — immutable wrappers с builder;
- **Lombok** — через злоупотребление annotation processing (модифицирует AST, что технически unsupported).

Преимущества vs reflection:
- **Zero runtime overhead** (код уже сгенерирован);
- **Compile-time errors** (если что-то не так — ошибка компиляции, а не NPE в проде);
- **IDE поддержка** через generated source.

---

## 10. Когда что использовать

| Сценарий | Подходящий инструмент |
|---|---|
| Сериализация по private полям | Reflection (Jackson, Gson) |
| Высокочастотный getter в фреймворке | MethodHandle (cached `findGetter`) |
| Lock-free counter (замена `AtomicLong` field) | VarHandle |
| Замена `Unsafe.compareAndSwapInt` на типизированный API | VarHandle с CAS |
| Generation кода для DTO mapper | Annotation processor (MapStruct) |
| Dynamic proxy для AOP | `Proxy.newProxyInstance` (reflection) или ByteBuddy (bytecode) |
| Configuration через имя класса | Reflection `Class.forName` + `newInstance` |
| Records auto-equals/hashCode | Built-in (через `invokedynamic ObjectMethods.bootstrap`) |

---

## 11. Что обязательно знать на собесе

1. **Reflection cost** — почему дорого, что такое inflation, что инлайнится JIT, а что нет.
2. **`getMethods()` vs `getDeclaredMethods()`** — разница в видимости и наследовании.
3. **`Class.forName` triggers `<clinit>`** — как обойти, если init дорогой.
4. **JPMS encapsulation** — `--add-opens`, `opens` в module-info, что сломалось в 16+.
5. **MethodHandle**: `invokeExact` vs `invoke`, basic combinators.
6. **VarHandle**: 5 access modes (plain / opaque / acquire-release / volatile / atomic ops), use cases.
7. **`AtomicFieldUpdater` → VarHandle migration** — почему, что лучше.
8. **Annotation processing**: SOURCE / CLASS / RUNTIME retention, compile-time vs runtime.

---

## Related

- Bytecode / `invokedynamic` / lambda → [`BYTECODE_INVOKEDYNAMIC.md`](BYTECODE_INVOKEDYNAMIC.md)
- JPMS, `opens` / `exports` / `--add-opens` → [`JPMS_MODULES.md`](JPMS_MODULES.md)
- VarHandle и atomic CAS концептуально → [`modules/concurrency/theory/ATOMIC_CAS.md`](../../concurrency/theory/ATOMIC_CAS.md)
- Access modes семантика через JMM → [`modules/concurrency/theory/THREADS_BASICS.md`](../../concurrency/theory/THREADS_BASICS.md)
- FFM API с VarHandle → [`FOREIGN_MEMORY_VECTOR.md`](FOREIGN_MEMORY_VECTOR.md)

### Внешние ресурсы

- **JEP 193 VarHandle**: <https://openjdk.org/jeps/193>
- **JEP 396 Strongly Encapsulate JDK Internals**: <https://openjdk.org/jeps/396>
- **John Rose, *MethodHandles and VarHandles*** — <https://wiki.openjdk.org/display/HotSpot/MethodHandles>
- **Doug Lea, *VarHandles* presentation** — <http://gee.cs.oswego.edu/dl/concurrency-interest/index.html>
- **Brian Goetz on access modes**: JLS §17 (JMM)
- **Mockito's bytecode generation**: <https://github.com/mockito/mockito>
- **Aleksey Shipilëv, *Memory access modes*** — раздел в [JMM Pragmatics](https://shipilev.net/blog/2014/jmm-pragmatics/)
