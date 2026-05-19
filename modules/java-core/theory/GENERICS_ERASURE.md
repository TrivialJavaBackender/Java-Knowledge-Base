# Generics & Type Erasure

---

## 1. Главная истина: generics — compile-time

В Java generics — это **синтаксический сахар**. После компиляции type parameters стираются до `Object` (или upper bound). В bytecode нет понятия `List<String>` — есть только `List`, плюс автоматически вставленные `checkcast`.

```java
List<String> xs = new ArrayList<>();
xs.add("foo");
String x = xs.get(0);
```

После компиляции (decompiled):
```java
List xs = new ArrayList();
xs.add("foo");
String x = (String) xs.get(0);   // checkcast inserted!
```

Это и есть **type erasure**. Главный шок для разработчиков, пришедших из C# / C++: их generics в runtime сохраняют параметры (`List<int>` — реально другой тип), в Java — нет.

### 1.1. Почему так сделали?

Java добавила generics в 2004 году (Java 5). К этому моменту существовала 9 лет экосистема с **миллионами строк** legacy кода, использующего raw `List`, `Map`, `Iterator`. Любая модель runtime generics ломала binary backward compatibility.

Sun выбрала **type erasure** именно потому, что **сохраняла совместимость**: новый код с generics и старый без — могут жить в одной JVM, в одном classpath, даже в одной коллекции. C# сделал по-другому (.NET 2.0 переделал CLR), но цена была фрагментация платформы.

Это **trade-off**: получили совместимость, потеряли возможность runtime introspection generic types. Платим этим до сих пор — все workarounds ниже.

> Maurice Naftalin, Philip Wadler, *Java Generics and Collections* (O'Reilly, 2006) — каноническая монография.

---

## 2. Что нельзя из-за эрасуры

Прямо или косвенно вытекает из «`T` стирается в Object»:

### 2.1. `new T()` — нет конструктора

```java
class Container<T> {
    T item;
    void create() {
        item = new T();   // COMPILE ERROR
    }
}
```

Bytecode не знает, какой `<init>` вызвать. Workarounds:

```java
// 1) Передать factory
class Container<T> {
    final Supplier<T> factory;
    Container(Supplier<T> factory) { this.factory = factory; }
    void create() { item = factory.get(); }
}
new Container<>(User::new);

// 2) Передать Class<T>
class Container<T> {
    final Class<T> clazz;
    Container(Class<T> clazz) { this.clazz = clazz; }
    void create() {
        try {
            item = clazz.getDeclaredConstructor().newInstance();
        } catch (Exception e) { throw new RuntimeException(e); }
    }
}
new Container<>(User.class);
```

Первый вариант предпочтителен — type-safe, не использует reflection.

### 2.2. `new T[N]` — generic arrays запрещены

```java
T[] arr = new T[10];   // COMPILE ERROR
```

Причина: массивы **reified** (хранят element type в runtime), generics — нет. Если бы `new T[]` работало, и `T = String`, получился бы `String[]`. Но передав код далеко, `T` оказался бы `Integer` — `arr[0] = (Integer) 5` нарушил бы invariant `String[]`.

Workarounds:
```java
@SuppressWarnings("unchecked")
T[] arr = (T[]) new Object[10];   // unchecked warning, но работает

// 2) Через Class<T>
T[] arr = (T[]) Array.newInstance(clazz, 10);
```

### 2.3. `obj instanceof T` — невозможно

```java
boolean check(Object o) {
    return o instanceof T;   // COMPILE ERROR
}
```

`T` стёрт; в runtime нет информации, проверять что. Workaround:
```java
boolean check(Object o, Class<T> clazz) {
    return clazz.isInstance(o);
}
```

Можно `obj instanceof List<?>` (raw check на List без типа аргумента), но не `obj instanceof List<String>`.

### 2.4. `T.class` — нет литерала

```java
Class<T> c = T.class;   // COMPILE ERROR
```

Решение — type token pattern:
```java
public <T> T fromJson(String s, Class<T> token) { ... }
fromJson("...", User.class);
```

### 2.5. Перегрузка по generic параметрам

```java
void foo(List<String> l) {}
void foo(List<Integer> l) {}   // COMPILE ERROR: same erasure
```

Обе сигнатуры стираются в `foo(List)` — одинаковые. Можно обойти через разные методы:
```java
void fooString(List<String> l) {}
void fooInt(List<Integer> l) {}
```

### 2.6. Static fields типа `T`

```java
class Foo<T> {
    static T staticField;   // COMPILE ERROR
}
```

`T` — per-instance, static — per-class, концептуально противоречит.

### 2.7. `catch (T extends Throwable)`

```java
try { ... } catch (T e) { ... }   // COMPILE ERROR
```

Catch требует reifiable тип; `T` стёрт.

### 2.8. `T[]` в varargs

```java
@SafeVarargs   // suppress warning
static <T> List<T> asList(T... items) {
    return Arrays.asList(items);
}
```

Без `@SafeVarargs` — unchecked warning. Аннотация обещает, что метод **не** хранит ссылки на varargs array → safe.

---

## 3. Bridge methods — synthetic «мост»

Когда generic-метод переопределяется в наследнике с **более узким типом**, компилятор генерирует **bridge method**.

Пример:
```java
class Box<T> {
    public T get() { return null; }
}

class StringBox extends Box<String> {
    @Override
    public String get() { return "foo"; }
}
```

После эрасуры:
- `Box.get()` имеет сигнатуру `Object get()`.
- `StringBox.get()` объявлен как `String get()`.

Это **разные** сигнатуры по правилам JVM (return type — часть сигнатуры). Override не сработает напрямую. Компилятор добавляет в `StringBox` **bridge**:

```java
class StringBox extends Box {
    public String get() { return "foo"; }      // твой метод
    public Object get() { return this.get(); }  // bridge, generated, ACC_BRIDGE | ACC_SYNTHETIC
}
```

Bridge помечен флагами `ACC_BRIDGE | ACC_SYNTHETIC`. Видим в `javap`:
```
public java.lang.Object get();
    Flags: BRIDGE, SYNTHETIC
    Code:
       aload_0
       invokevirtual #X      // get()Ljava/lang/String;
       areturn
```

### 3.1. Reflection sees both

`Method.getDeclaredMethods()` возвращает **оба** метода — это типичная gotcha. Чтобы отфильтровать:

```java
for (Method m : cls.getDeclaredMethods()) {
    if (m.isBridge()) continue;   // skip synthetic
    // ...
}
```

Похожие bridge'ы создаются для **covariant return types**:
```java
class Parent { Object get() { ... } }
class Child extends Parent { @Override String get() { ... } }
// Child будет иметь два get(): Object и String, второй — bridge.
```

---

## 4. Wildcards — variance

Generics в Java **invariant by default**:
```java
List<Integer> ints = new ArrayList<>();
List<Number> nums = ints;   // COMPILE ERROR
```

Почему? Допусти бы JVM:
```java
List<Number> nums = ints;      // hypothetically OK
nums.add(3.14);                // OK by static type
Integer first = ints.get(0);   // BUT 3.14 isn't Integer → ClassCastException
```

Чтобы не ломать type safety, generics **запрещают** такую подстановку. Hover wildcards вводят **variance**:

### 4.1. `? extends T` — covariance, producer

```java
List<? extends Number> nums = ints;   // OK
Number n = nums.get(0);                // OK (Number — known supertype)
nums.add(5);                            // COMPILE ERROR
nums.add(null);                         // только null OK
```

`? extends T` — «**какой-то конкретный** subtype of T». Читать можно (получишь T или его subtype), писать нельзя (не знаешь, какой именно subtype).

### 4.2. `? super T` — contravariance, consumer

```java
List<? super Integer> ints = new ArrayList<Number>();   // OK
ints.add(5);                                              // OK
ints.add(Integer.valueOf(10));                            // OK
Object o = ints.get(0);                                   // получаешь Object
Integer first = ints.get(0);                              // COMPILE ERROR
```

`? super T` — «**какой-то конкретный** supertype of T». Писать T можно (subtype любого его супертипа корректен), читать только Object.

### 4.3. `?` — unbounded

```java
List<?> any = new ArrayList<String>();
any.add(null);     // только null
any.add("foo");    // COMPILE ERROR
Object o = any.get(0);
```

Эквивалентно `? extends Object`. Используется, когда тип неважен (например, для `clear()`, `isEmpty()`).

---

## 5. PECS — Producer-Extends, Consumer-Super

Classic правило Bloch'а (*Effective Java*, item 31):

> Use `? extends T` when the parameter is a **producer** of T (you read from it).
> Use `? super T` when the parameter is a **consumer** of T (you write to it).

Memo: **P**roducer-**E**xtends, **C**onsumer-**S**uper.

Классический пример — `Collections.copy`:
```java
public static <T> void copy(List<? super T> dst, List<? extends T> src) {
    for (T item : src) dst.add(item);
}
```

`src` — производит T → `? extends T`. `dst` — потребляет T → `? super T`. Это позволяет копировать `List<Integer>` в `List<Number>`, или даже `List<Object>`.

Использования в JDK везде: `Collections.sort(list, comparator)`, `Map.merge`, `Stream.collect`, `CompletableFuture.thenApply`.

---

## 6. Capture conversion

Внутри метода с wildcard-параметром компилятор «захватывает» wildcard в свежую анонимную type variable. Это нужно для типизации внутри метода:

```java
public void swap(List<?> list, int i, int j) {
    list.set(i, list.get(j));   // COMPILE ERROR
    // compiler не знает: get(j) returns "capture#1 of ?",
    // но set(i, ...) requires "capture#1 of ?" — это РАЗНЫЕ captures!
}
```

Workaround — helper-метод с явным type-variable:
```java
public void swap(List<?> list, int i, int j) {
    swapHelper(list, i, j);
}

private <T> void swapHelper(List<T> list, int i, int j) {
    T tmp = list.get(i);
    list.set(i, list.get(j));
    list.set(j, tmp);
}
```

Внутри `swapHelper` `T` — конкретный (хотя и неизвестный) тип; capture не нужен.

Capture-имена в ошибках выглядят как `capture#1 of ?`, `capture#2 of ? extends Number`. Это «скрытые» type variables, генерируемые компилятором.

---

## 7. Reifiable vs non-reifiable types

**Reifiable** — тип полностью представлен в runtime. Можно использовать в `instanceof`, `.class`, array creation:
- `String`, `Integer[]`, `int`, `Class`;
- `List` (raw), `Map<?, ?>` (unbounded wildcard);
- Любой generic class с только unbounded wildcards.

**Non-reifiable** — содержит стёртые type параметры:
- `List<String>`, `Map<String, Integer>`;
- `T`, `T[]`, `List<T>`.

Только reifiable types можно использовать в:
- `instanceof`;
- `.class` literal;
- `new T[]` (array creation);
- exception class hierarchy.

---

## 8. F-bounded polymorphism

Рекурсивный bound `<T extends Comparable<T>>` — T сравним сам с собой:

```java
public static <T extends Comparable<T>> T max(List<T> list) {
    T best = list.get(0);
    for (T x : list) {
        if (x.compareTo(best) > 0) best = x;
    }
    return best;
}
```

В реальности JDK использует более общую форму `<T extends Comparable<? super T>>` — это позволяет `Comparable<Number>` для `T = Integer`:

```java
public static <T extends Comparable<? super T>> T max(List<T> list) { ... }
```

Без `? super T` интерфейс был бы более жёстким. F-bounded — мощный, но трудный для чтения паттерн.

---

## 9. Generic method type inference

Эволюция:

### 9.1. Diamond (`<>`) — Java 7+

```java
Map<String, List<Integer>> m = new HashMap<>();   // тип выводится с левой стороны
```

До Java 7 нужно было: `new HashMap<String, List<Integer>>()` — дублирование.

### 9.2. Target typing — Java 8+

```java
List<String> empty = Collections.emptyList();   // T = String inferred from target
```

`Collections.emptyList()` имеет сигнатуру `<T> List<T>`; T выводится из контекста использования (target).

### 9.3. `var` — Java 10+

```java
var nums = new ArrayList<Integer>();   // ArrayList<Integer>
var any = new ArrayList<>();            // ArrayList<Object>! — diamond без target — bug
```

Будь осторожен: `var x = new ArrayList<>()` без target type → `Object`, не то, что хочется.

---

## 10. `Class<T>` token и super-type tokens

### 10.1. Type token

Поскольку `T.class` нельзя, паттерн **type token**:
```java
public <T> T fromJson(String s, Class<T> token) { ... }
fromJson("...", User.class);
```

Работает для **reifiable** типов. Не работает для generic:
```java
fromJson(s, List<User>.class);   // COMPILE ERROR — нет такого синтаксиса
```

### 10.2. Super-type token (Gafter trick)

Для generic-типов работает **super-type token** — abstract subclass запоминает свой generic-arg:

```java
public abstract class TypeRef<T> {
    public final Type type;
    protected TypeRef() {
        ParameterizedType pt = (ParameterizedType) getClass().getGenericSuperclass();
        this.type = pt.getActualTypeArguments()[0];
    }
}

// Использование:
TypeRef<List<User>> ref = new TypeRef<List<User>>() {};
Type t = ref.type;   // List<User> — Type object!
```

Идея: эрасура **сохраняет** generic-info **в class signature** (атрибут `Signature` в class file). Анонимный subclass с явным `<List<User>>` запоминает тип через свой `genericSuperclass`.

Используется:
- **Jackson `TypeReference`** — `objectMapper.readValue(json, new TypeReference<List<User>>(){})`;
- **Guice/Dagger `TypeLiteral`** — injection generic типов;
- **Spring `ParameterizedTypeReference`** — REST template для generic responses.

> Neal Gafter, *Super Type Tokens* (2006) — оригинальный пост. <https://gafter.blogspot.com/2006/12/super-type-tokens.html>

---

## 11. Reified generics в других языках

### 11.1. Kotlin `reified`

```kotlin
inline fun <reified T> Gson.fromJson(s: String): T = fromJson(s, T::class.java)
```

Это **compile-time trick**: Kotlin компилятор inline'ит тело и подставляет `T::class.java` на каждом call site. JVM по-прежнему не имеет reified generics — это сахар над bytecode.

```kotlin
val users: List<User> = gson.fromJson(json)   // T = User inferred
```

Java таких возможностей не имеет; обычно паттерн — passing `Class<T> token`.

### 11.2. Scala и другие

Scala имеет более развитую систему: `ClassTag`, `TypeTag` через implicit parameters. Реализовано через те же bytecode-трюки + macro magic.

---

## 12. Что обязательно знать на собесе

1. **Type erasure** — что именно стирается, почему так сделано.
2. **Что нельзя из-за эрасуры** (new T(), new T[], instanceof T, T.class, перегрузка, static T, catch T).
3. **Bridge methods** — зачем, как их видеть в reflection, `isBridge()`.
4. **Wildcards**: covariance (`? extends`), contravariance (`? super`), invariance (default).
5. **PECS** — Producer-Extends, Consumer-Super.
6. **Reifiable vs non-reifiable** — где можно использовать `instanceof` / `.class`.
7. **Capture conversion** — почему `swap(List<?>)` не работает без helper.
8. **F-bounded polymorphism** — `<T extends Comparable<T>>`, JDK style `<T extends Comparable<? super T>>`.
9. **Type token / super-type token** (Gafter trick) — паттерны для runtime generic info.
10. **`var` + diamond gotcha** — `var x = new ArrayList<>()` = `ArrayList<Object>`.

---

## Related

- equals/hashCode/compareTo на generic классах → [`EQUALS_HASHCODE_COMPARABLE.md`](EQUALS_HASHCODE_COMPARABLE.md)
- Type tokens, reflection generic info → [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md)
- Records и canonical equals (как стираются generics) → [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md)
- Bridge methods и JIT call sites → [`JIT_COMPILATION.md`](JIT_COMPILATION.md)
- Bytecode `Signature` attribute → [`BYTECODE_INVOKEDYNAMIC.md`](BYTECODE_INVOKEDYNAMIC.md)

### Внешние ресурсы

- **Java Generics FAQ (Angelika Langer)** — <http://www.angelikalanger.com/GenericsFAQ/JavaGenericsFAQ.html> — крупнейший справочник
- **JLS §4.6 Type Erasure** — <https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.6>
- **Neal Gafter, *Super Type Tokens*** — <https://gafter.blogspot.com/2006/12/super-type-tokens.html>
- **Brian Goetz, *Reifying generics in the JVM*** — <https://cr.openjdk.org/~briangoetz/valhalla/sov/02-object-model.html>
- **Project Valhalla** (reified generics in future Java) — <https://openjdk.org/projects/valhalla/>
- **Effective Java 3rd ed., Items 26–33** — главы про generics
