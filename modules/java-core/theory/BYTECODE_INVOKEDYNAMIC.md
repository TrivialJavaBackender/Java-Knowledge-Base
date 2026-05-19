# Bytecode & invokedynamic

---

## 1. Зачем разработчику знать bytecode

90% Java-разработчиков никогда не читают bytecode напрямую. Тогда зачем эта тема на собесе уровня senior?

Несколько причин:

1. **Дебаг** странных проблем. `ClassCastException` без видимой причины, `LinkageError` после deploy, `VerifyError` от bytecode agent — без понимания формата найти источник невозможно.
2. **Перформанс**. Знать, какие конструкции компилируются в эффективный bytecode, а какие нет (например, lambda vs anonymous class, `+` vs `StringBuilder`).
3. **Метапрограммирование**. ASM, ByteBuddy, CGLIB, Javassist — основа всего AOP, mocking, proxy generation. Если работаешь со Spring, Hibernate, Mockito — ты уже косвенно работаешь с bytecode generation.
4. **Кодогенерация**. Annotation processors, Kotlin/Scala compilers, GraalVM Native Image — всё опирается на знание JVM class file format.
5. **Понимание JVM features**. `invokedynamic`, MethodHandle, hidden classes — фундамент для lambdas, records, pattern matching. Без bytecode-знаний эти feature кажутся магией.

Чтение bytecode — это **навык за час**: знаешь основные опкоды, читаешь `javap -c -v`, дебажишь. Стоит того.

---

## 2. Class file format

`.class` — бинарный формат, описанный в **JVMS §4** ([docs.oracle.com/javase/specs/jvms](https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html)). Структура:

```
ClassFile {
    u4 magic;                       // 0xCAFEBABE (буквально кофе)
    u2 minor_version;
    u2 major_version;               // 65 = Java 21, 61 = Java 17, 52 = Java 8, 44 = Java 1.0
    u2 constant_pool_count;
    cp_info constant_pool[count-1]; // нумерация с 1!
    u2 access_flags;                // ACC_PUBLIC, ACC_FINAL, ACC_INTERFACE, ACC_SYNTHETIC, ...
    u2 this_class;                  // index в constant pool
    u2 super_class;
    u2 interfaces_count;
    u2 interfaces[];
    u2 fields_count;
    field_info fields[];
    u2 methods_count;
    method_info methods[];
    u2 attributes_count;
    attribute_info attributes[];    // SourceFile, BootstrapMethods, Module, ...
}
```

### 2.1. Версионирование

JVM N может **читать** byte-code, скомпилированный для версии N или **более старых**, но **не более новых**. Если запустишь class file для Java 17 на JVM 11 — получишь `UnsupportedClassVersionError: class file version 61.0, this JRE only recognizes up to 55.0`.

```bash
file MyClass.class
# MyClass.class: compiled Java class data, version 61.0 (Java 17)

javap -v MyClass | head -3
# major version: 61
```

`javac --release 11` — целевая компиляция под Java 11 (используя API только этой версии). `-target 11` без `--release` — только устанавливает version, но позволяет использовать API более новых версий (что в runtime упадёт `NoSuchMethodError`).

---

## 3. Constant Pool

Таблица констант — **самая большая часть** class file. Индексируется с 1, не с 0. Типы записей:

- `CONSTANT_Utf8` — UTF-8 строки (имена методов, дескрипторы, литералы);
- `CONSTANT_Integer / Long / Float / Double` — числовые литералы;
- `CONSTANT_String` — String-литералы (ref на UTF8);
- `CONSTANT_Class` — class reference (ref на UTF8 с FQN, `java/lang/String`);
- `CONSTANT_Fieldref / Methodref / InterfaceMethodref` — символические ссылки на члены классов;
- `CONSTANT_NameAndType` — пара (имя + дескриптор);
- `CONSTANT_MethodHandle / MethodType` — для invokedynamic;
- `CONSTANT_InvokeDynamic / Dynamic` — bootstrap call sites.

Пример вывода `javap -v`:
```
Constant pool:
   #1 = Methodref          #6.#23         // java/lang/Object."<init>":()V
   #2 = Fieldref           #5.#24         // com/foo/Bar.x:I
   #3 = String             #25            // hello
   ...
```

### 3.1. Type descriptors

Стандартное кодирование типов — компактнее, чем FQN:

| Java type | Descriptor |
|---|---|
| `byte` | `B` |
| `char` | `C` |
| `double` | `D` |
| `float` | `F` |
| `int` | `I` |
| `long` | `J` (не `L` — конфликт!) |
| `short` | `S` |
| `boolean` | `Z` |
| `void` | `V` (только для return) |
| `String` | `Ljava/lang/String;` |
| `int[]` | `[I` |
| `String[][]` | `[[Ljava/lang/String;` |

**Method descriptors**: `(args)return`:
- `String foo(int, long)` → `(IJ)Ljava/lang/String;`
- `void clear()` → `()V`
- `int[] sort(int[], int)` → `([II)[I`

Это и есть формат, который ты видишь в stack traces:
```
at com.foo.Bar.method(IJLjava/lang/String;)V
```

---

## 4. Stack-based execution

JVM — **stack-based** VM, в отличие от register-based Dalvik (Android) или V8 (JavaScript). У каждого метода frame:

```
┌──────────────┐
│ Operand Stack│  ← bytecode операции push/pop здесь
├──────────────┤
│ Local Vars   │  [0]=this (для instance), [1..]=args, потом locals
├──────────────┤
│ Const Pool ref│ → constant pool текущего класса
└──────────────┘
```

Каждый opcode — это операция над stack. Например, `int x = a + b;` где `a, b` — local-vars:

```
iload_1     // push a (local[1]) → stack
iload_2     // push b (local[2]) → stack
iadd        // pop два, push sum
istore_3    // pop, store в local[3] (это `x`)
```

Размеры stack и locals — фиксированные для метода (записаны в `Code` attribute как `max_stack`, `max_locals`). Если bytecode превышает — `VerifyError`.

### 4.1. Stack vs register VMs

Аргументы за stack-based:
- **Compact bytecode**: не нужно кодировать индексы регистров. `iadd` — 1 байт vs `add r1, r2, r3` — 3+ байта.
- **Простота verifier**: stack-effect каждой инструкции фиксирован.
- **Платформенная независимость**: число CPU-регистров разное на разных платформах; abstract stack — нет.

Аргументы против:
- **Больше bytecode instructions**: `iload + iload + iadd + istore` vs одна `add`. Для interpreter — больше работы.
- **JIT всё равно делает register allocation**. На выходе нативного кода — операции с регистрами.

В современной JVM stack-based — historical, JIT переводит в register-based representation. Performance not affected.

---

## 5. Главные опкоды

Полный список — 200+ opcodes (JVMS §6). Запоминать все не нужно, важно знать категории.

### 5.1. Load/Store

```
iload, lload, fload, dload, aload   // push local var → stack (i/l/f/d/a = int/long/float/double/ref)
istore, lstore, fstore, dstore, astore // pop stack → local var
ldc, ldc_w, ldc2_w                  // push константа из constant pool
bipush, sipush                       // push short integer constant inline (1-2 байта)
iconst_0, iconst_1 ... iconst_5     // оптимизированные push для частых констант
aconst_null                          // push null
```

### 5.2. Arithmetic

```
iadd, isub, imul, idiv, irem        // int +, -, *, /, %
ineg                                  // -x
iand, ior, ixor                      // битовые
ishl, ishr, iushr                    // shift (s=signed, us=unsigned)
i2l, i2f, l2i, ...                   // type conversion
```

### 5.3. Объекты, массивы, поля

```
new                  // allocate object (но без <init>)
dup                  // duplicate top stack (для <init>)
dup_x1, dup_x2       // duplicate с сдвигом
pop, pop2            // discard
getfield, putfield   // instance fields
getstatic, putstatic // static fields
anewarray, newarray  // создание массива
multianewarray       // многомерный массив
arraylength
aaload, aastore      // array element (для references)
iaload, iastore      // int[]
```

`new` создаёт только память; конструктор вызывается отдельно через `invokespecial <init>`. Поэтому `new` всегда идёт парой с `dup` (чтобы reference остался после `<init>`).

Bytecode for `new Bar()`:
```
new com/foo/Bar       // push uninitialized ref
dup                    // duplicate
invokespecial <init>   // pop one ref, init it
                       // one ref still on stack — для дальнейшего использования
```

### 5.4. Method invocations — главное

Пять опкодов для вызовов:

- **`invokestatic`** — `static` метод. Самый дешёвый, прямой dispatch.
- **`invokevirtual`** — обычный полиморфный вызов на instance. Через vtable.
- **`invokespecial`** — `super.method()`, `<init>`, `private`. Без полиморфизма.
- **`invokeinterface`** — interface methods. Через itable (хеш-таблица), чуть дороже invokevirtual.
- **`invokedynamic`** — динамически вычисляемый call site (см. §7).

Compile-time дискриминация:
- `foo()` где `foo` static → `invokestatic`;
- `obj.foo()` где `obj` — concrete class и метод не private/final → `invokevirtual`;
- `super.foo()` или `Foo.this.<init>(...)` → `invokespecial`;
- `iface.foo()` где `iface` объявлен как interface → `invokeinterface`;
- lambda, switch on sealed, String concat, record methods → `invokedynamic`.

### 5.5. Control flow

```
ifeq, ifne, iflt, ifle, ifgt, ifge   // if int op 0
if_icmpeq, if_icmpne, ...             // if int op int (с CMP)
if_acmpeq, if_acmpne                  // если refs equal
ifnull, ifnonnull
goto, goto_w
tableswitch, lookupswitch             // switch
athrow                                 // throw
return, ireturn, lreturn, freturn, dreturn, areturn
```

`tableswitch` — для dense (consecutive) cases (`switch(x) case 0,1,2,3,4`). `lookupswitch` — для sparse (`case 1, 100, 1000`). Сomputer ситуация выбирается компилятором на основе плотности значений.

### 5.6. Synchronization

```
monitorenter
monitorexit
```

`synchronized` блок:
```java
synchronized (obj) { code; }
```

Bytecode:
```
aload obj
monitorenter
... code ...
aload obj
monitorexit
goto exitLabel
... exception handler: вызвать monitorexit + перебросить ...
exitLabel:
```

Дополнительный exception handler нужен, чтобы lock освободился даже при exception. Это инвариант: каждому `monitorenter` соответствует `monitorexit` на normal или exceptional пути.

---

## 6. Stack Map Frames (`StackMapTable` attribute)

Java 7+ ([JEP 202](https://openjdk.org/jeps/202)) ввёл атрибут `StackMapTable` в каждый метод. Он описывает типы на стэке и в локалах **перед каждой branch-target** инструкцией.

Зачем: bytecode verifier (см. [`CLASS_LOADERS.md`](CLASS_LOADERS.md) §4.2) для проверки stack-effect раньше делал abstract interpretation. StackMapTable позволяет verifier работать **линейно** — просто сверяет с заранее посчитанными frames.

```
StackMapTable: number_of_entries = 3
  frame_type = 252 (append)
  ...
```

Если **сам генерируешь bytecode** (ASM, ByteBuddy) — **обязан** генерировать StackMapTable, или использовать `ClassWriter.COMPUTE_FRAMES` flag (тогда ASM посчитает за тебя). Без этого — `java.lang.VerifyError` при загрузке.

---

## 7. `invokedynamic` (JEP 292, Java 7+)

«Поздно связываемый» вызов — главная фича JVM 7. Опкод указывает на запись `InvokeDynamic` в constant pool, которая ссылается на **bootstrap method (BSM)**. При первом исполнении:

```
invokedynamic apply  // первый раз
        ↓
JVM вызывает BSM(Lookup, methodName, MethodType, BSM-args)
        ↓
BSM возвращает CallSite (содержит MethodHandle)
        ↓
JVM «приклеивает» CallSite к этой точке
        ↓
все последующие вызовы — прямо через MethodHandle (без bootstrap)
```

### 7.1. Зачем нужен

Изначальная мотивация — поддержка не-Java языков на JVM (Groovy, JRuby, Scala). Им нужно решать **в runtime**, какой метод вызвать (dynamic dispatch). Без invokedynamic пришлось бы либо генерировать вспомогательные классы каждый раз (медленно), либо использовать reflection (ещё медленнее).

С точки зрения JIT: `invokedynamic` после bootstrap — это просто **monomorphic call site** с прямым MethodHandle. JIT inline-ит, оптимизирует — производительность как у direct call.

### 7.2. Где использует сам JDK

| Feature | Bootstrap class | Что генерирует |
|---|---|---|
| Lambda | `LambdaMetafactory.metafactory` | Hidden class реализующий functional interface |
| String concat (9+) | `StringConcatFactory.makeConcatWithConstants` | MethodHandle для concat |
| `switch` на String | `SwitchBootstraps.typeSwitch` (старая версия) | Hash-table lookup |
| Pattern matching switch (21+) | `SwitchBootstraps.typeSwitch` | Type-checking dispatch |
| Record equals/hashCode/toString | `ObjectMethods.bootstrap` | MethodHandle для всех accessors |
| Enum switch на enum constants | `SwitchBootstraps.enumSwitch` (24+) | Ordinal-based dispatch |

Каждое использование экономит **аллокацию classes на диске** и даёт **runtime flexibility** — JVM может менять стратегию между версиями без перекомпиляции пользовательского кода.

> [JEP 292: Defining a Bootstrap Method for invokedynamic](https://openjdk.org/jeps/292). [JEP 309: Dynamic Class-File Constants](https://openjdk.org/jeps/309).

---

## 8. `MethodHandle` (`java.lang.invoke`)

`MethodHandle` — **typed, immutable function reference**. Это «современная reflection» для perf-критичного кода.

```java
import java.lang.invoke.*;
import static java.lang.invoke.MethodType.*;

MethodHandles.Lookup lk = MethodHandles.lookup();
MethodHandle add = lk.findStatic(Math.class, "addExact",
                                  methodType(int.class, int.class, int.class));
int r = (int) add.invokeExact(2, 3);    // 5
```

Различия от reflection (`Method.invoke`):

| | Reflection | MethodHandle |
|---|---|---|
| Performance | per-call dispatch + access check | JIT-friendly, near-direct call |
| Type safety | runtime `IllegalArgumentException` | compile-time через `MethodType` |
| API | старый, до generics | post-7, чистый, immutable |
| Composability | нет | combinators: bindTo, insertArguments, asType, asSpreader |
| `setAccessible` | per-call check | один раз через `Lookup` |

### 8.1. `invokeExact` vs `invoke`

```java
add.invokeExact(2, 3)   // OK, types match
add.invokeExact(2L, 3)  // WrongMethodTypeException, нужен int не long
add.invoke(2L, 3)        // OK, делает widening conversion
```

`invokeExact` — самый быстрый, но требует **точного** совпадения типов. `invoke` — допускает widening, boxing, primitive conversion. Используй `invokeExact` всегда, когда можно — это explicit declaration «я знаю типы».

### 8.2. Combinators

```java
MethodHandle add = lk.findStatic(Math.class, "addExact",
                                  methodType(int.class, int.class, int.class));

// Bind: partial application
MethodHandle increment = MethodHandles.insertArguments(add, 1, 1);   // bind 2nd arg = 1
increment.invokeExact(41);  // → 42

// Compose: map output
MethodHandle addThenAbs = MethodHandles.filterReturnValue(add,
    lk.findStatic(Math.class, "abs", methodType(int.class, int.class)));
addThenAbs.invokeExact(-3, -5);  // abs(-3 + -5) = 8

// Guard: conditional
MethodHandle safeDiv = MethodHandles.guardWithTest(
    /*test:*/ checkNotZero,
    /*if true:*/ divide,
    /*if false:*/ returnZero);
```

Это минималистичный functional combinator language. Используется в LambdaMetafactory, StringConcatFactory, MethodHandle-based proxies.

JIT inline-ит MH-цепочки **полностью** через `@PolymorphicSignature` magic, поэтому в hot path MH-композиция сравнима по скорости с direct call.

---

## 9. `LambdaMetafactory` — как работает lambda

```java
Function<Integer, Integer> inc = x -> x + 1;
```

Bytecode для этого:

```
invokedynamic apply()Ljava/util/function/Function;  // BSM = LambdaMetafactory.metafactory
```

Тело lambda компилируется в **private static synthetic method** в текущем классе. Имя типа `lambda$methodName$0`:

```java
private static int lambda$myMethod$0(int x) { return x + 1; }
```

В runtime BSM:
1. Получает `MethodType` функционального интерфейса (`(Object)Object` для `Function<T,R>` — стирается!);
2. Получает `MethodHandle` на synthetic-метод;
3. Через `MethodHandles.Lookup.defineHiddenClass` ([JEP 371](https://openjdk.org/jeps/371), Java 15+) **генерирует hidden class**, реализующий `Function`. До 15 — через `Unsafe.defineAnonymousClass`.
4. Возвращает singleton instance (для non-capturing lambda) или factory-MH (для capturing).

Имя сгенерированного класса — `MyClass$$Lambda$1/0x000abc.apply`. **На диске НЕТ файла**, генерируется в runtime. **Hidden classes** не видны reflection, не имеют permanent name, GC-able вместе с CL.

Поэтому stack trace часто содержит загадочные имена:
```
at MyClass$$Lambda$1/0x000abc.apply(Unknown Source)
```

### 9.1. Non-capturing vs capturing lambda

```java
// Non-capturing — singleton
Function<Integer, Integer> inc = x -> x + 1;
// каждый вызов возвращает ТОТ ЖЕ объект

// Capturing — new instance каждый раз
int delta = 5;
Function<Integer, Integer> add = x -> x + delta;
// LambdaMetafactory создаёт factory; каждый call factory создаёт новый instance
```

Captured variables живут как поля сгенерированного hidden class. Если capture — `final` или effectively final local, JIT может элиминировать аллокацию через escape analysis.

---

## 10. Reading bytecode на практике

```bash
javac -g MyClass.java                # с debug info (для line numbers)
javap -p -c -v MyClass               # bytecode + cp + flags
javap -p -c -v -constants MyClass    # с константами раскрытыми
javap -s MyClass                      # с дескрипторами
```

Полный пример:
```bash
$ javap -p -c -v Bar.class | head -30
public class com.foo.Bar
  minor version: 0
  major version: 65    // Java 21
  flags: (0x0021) ACC_PUBLIC, ACC_SUPER
  this_class: #15
  super_class: #2
Constant pool:
   #1 = Methodref          #2.#3   // java/lang/Object."<init>":()V
   ...
{
  public void method();
    descriptor: ()V
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=2, locals=1, args_size=1
         0: iconst_1
         1: istore_1
         2: return
}
```

### 10.1. Tools

- **ASM** ([asm.ow2.io](https://asm.ow2.io/)) — низкоуровневая lib (Visitor API). Foundation для CGLIB, Hibernate, Spring AOP, agents.
- **ByteBuddy** ([bytebuddy.net](https://bytebuddy.net/)) — высокоуровневая, fluent API. Build classes без знания ASM напрямую. Используется Mockito, Hibernate (modern proxies).
- **Javassist** — позволяет писать bytecode «как Java-код в строке». Reflection-style, медленнее ASM, но проще для простых случаев.
- **JBE, Recaf, JD-GUI, CFR, Procyon** — декомпиляторы / GUI byte-code viewers.
- **IntelliJ IDEA** — встроенный bytecode viewer (`View → Show Bytecode`).

---

## 11. Что обязательно знать на собесе

1. **Class file format**: constant pool, methods, attributes, version числа.
2. **Type descriptors**: `Ljava/lang/String;`, `(IJ)V` — уметь читать.
3. **Stack-based execution**: operand stack + locals, операции push/pop.
4. **5 invoke-опкодов**: static / virtual / special / interface / **dynamic** — разница.
5. **`invokedynamic`**: BSM, CallSite, для чего нужен (lambda, string concat, pattern matching).
6. **`MethodHandle` vs Reflection**: performance, type safety, combinators.
7. **`LambdaMetafactory`**: как создаётся lambda, что такое hidden classes.
8. **StackMapTable** — для чего, обязательность при bytecode generation.
9. **`new` + `dup` + `invokespecial <init>`** — паттерн создания объекта.
10. **Tools**: javap для чтения, ASM/ByteBuddy для генерации.

---

## Related

- JIT инлайнинг invokedynamic, hidden classes → [`JIT_COMPILATION.md`](JIT_COMPILATION.md)
- String concat через invokedynamic → [`STRING_INTERNALS.md`](STRING_INTERNALS.md)
- ClassLoader, defineClass, hidden classes → [`CLASS_LOADERS.md`](CLASS_LOADERS.md)
- Reflection vs MethodHandle vs VarHandle → [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md)
- Sealed types и pattern matching bootstrap → [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md)

### Внешние ресурсы

- **JVMS §4 Class File Format**: <https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html>
- **JVMS §6 Instructions**: <https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-6.html>
- **ASM Framework**: <https://asm.ow2.io/asm4-guide.pdf> — bible
- **ByteBuddy Tutorial**: <https://bytebuddy.net/#/tutorial>
- **JEP 292 invokedynamic**: <https://openjdk.org/jeps/292>
- **JEP 371 Hidden Classes**: <https://openjdk.org/jeps/371>
- **John Rose, *invokedynamic and the JVM*** — <https://wiki.openjdk.org/display/HotSpot/Bytecode+Behaviours>
- **Brian Goetz on records and invokedynamic**: <https://cr.openjdk.org/~briangoetz/amber/datum.html>
