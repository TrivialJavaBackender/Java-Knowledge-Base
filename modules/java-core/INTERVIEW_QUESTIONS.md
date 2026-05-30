# Interview Questions — java-core

## 1. Garbage Collection

### Q1: Чем G1 отличается от ZGC и Shenandoah, и когда что выбирать?

**A:** Все три — concurrent collectors, но цели разные:

- **G1** (default since 9) — региональный, generational, **partial STW** (initial mark, remark, evacuation pause). Target — `MaxGCPauseMillis` (default 200 ms). Хорош для heap 4–32 GB, типичный default для web/backend.
- **ZGC** — почти полностью concurrent, **STW < 1 ms** независимо от heap. Использует colored pointers (метаинформация в верхних битах) и load barriers (перенаправление чтения). До JDK 21 был non-generational → большие footprint и worse throughput на small heap. **Generational ZGC (JEP 439, Java 21+)** исправил. Подходит для low-latency и heap до TB.
- **Shenandoah** (Red Hat) — concurrent compact через Brooks forwarding pointer (доп. слот в header). **STW < 10 ms**, throughput чуть хуже G1. Generational версия в работе.

Выбор: G1 — default; ZGC — если pause-budget < 10 ms критичен (trading, real-time); Shenandoah — Red Hat OpenJDK / large heap.

> JEP 333 (ZGC), JEP 379 (Shenandoah), JEP 439 (Generational ZGC)

---

### Q2: Что такое safepoint и почему длинный tight loop может вызвать pause time bug?

**A:** Safepoint — точка в JIT-коде, где поток может быть **безопасно** приостановлен (его stack отсканирован GC, JFR sampling, debugger). JVM ставит safepoint-полл (загрузка из safepoint-page → trap при STW request) в backward branches циклов, return из методов, не-leaf вызовах.

**Tight counted loop** (`for (int i = 0; i < N; i++) { ... простая арифметика ... }`) JIT может **удалить** safepoint-полл для скорости. Если N огромно, поток крутит loop **минуты без safepoint**, и при STW-запросе **остальные потоки ждут** этого одного — pause time растёт катастрофически.

Чинится:
- `-XX:+UseCountedLoopSafepoints` (default in modern JVMs, on);
- разбить loop на chunks с явным safepoint (например, метод-вызов внутри);
- избегать gigantic tight loops без I/O.

---

### Q3: Зачем нужны write barriers и в чём разница между SATB и Incremental Update?

**A:** **Write barrier** — runtime-hook, исполняющийся на каждой записи reference-поля (`obj.field = ref`). Цель — поддерживать GC-метаданные (card table / remembered set) и **tri-color invariant** при concurrent mark (нет белой ссылки из чёрного объекта).

Два класса:
- **SATB (Snapshot-At-The-Beginning, G1)** — фиксирует «фотографию» ссылок на старте mark-фазы. Перед перезаписью `field` барьер **сохраняет старое значение** в queue → concurrent mark гарантированно обработает всё, что было живо на старте.
- **Incremental Update (CMS, Shenandoah)** — барьер **сохраняет новое значение**. При записи `black.field = white` — newRef добавляется в work queue, чтобы пройти его потом.

SATB более консервативен (может оставить уже умершие объекты до next GC), но проще и быстрее. Incremental update точнее, но дороже на каждой записи.

---

## 2. JVM Memory Areas

### Q4: Почему `-Xmx == container_limit` — плохая идея?

**A:** Heap — только **часть** RSS Java-процесса. Сверх него идут:

- **Metaspace** (метаданные классов; растёт при classloader leak или dynamic proxies);
- **Code Cache** (JIT-скомпилированный код, default 240 MB);
- **Thread stacks** (`-Xss × N_threads`, 1 MB × 200 потоков = 200 MB);
- **Direct ByteBuffer** / `Unsafe.allocateMemory` (Netty, Cassandra);
- **GC structures** (card tables, remembered sets, marking bitmaps);
- **JNI / FFM** native allocations.

Если `-Xmx == container_limit`, любой рост non-heap → cgroup OOMKiller убьёт процесс. Правильно: `-XX:MaxRAMPercentage=75` (адаптивно к limit) с резервом 25–30% на non-heap, или явно `-Xmx = limit × 0.7`. И **`-XX:+UseContainerSupport`** (on by default since 10) — JVM читает cgroup limits.

---

### Q5: Что такое Metaspace и почему он может расти бесконечно?

**A:** **Metaspace** (Java 8+) — область **native memory** (вне heap), хранящая Klass-структуры, bytecode методов, constant pool, аннотации. Заменила PermGen, у которой был фиксированный размер.

Default `-XX:MaxMetaspaceSize = unlimited` → может расти, пока есть физическая память. Типичные причины утечки:

- **ClassLoader leak**: webapp redeploy, старый CL остался жить (ThreadLocal / static reference / зарегистрированный listener) → его классы не сборщатся → Metaspace растёт после каждого deploy → `OutOfMemoryError: Metaspace` через N deploy.
- **Dynamic bytecode generation** (CGLIB, ByteBuddy, lambda proxies) без bounded cache: каждый сгенерированный класс — отдельная Klass-структура.
- **Reflection on synthetic types** в Spring AOP, Hibernate proxies.

Лечение: всегда ставить `-XX:MaxMetaspaceSize=256m` (или сколько нужно) — лучше явный OOM, чем медленная деградация узла.

---

## 3. Class Loaders

### Q6: Что такое parent delegation и где оно нарушается?

**A:** **Parent delegation** — стандартное правило `ClassLoader.loadClass`: перед попыткой загрузить класс самому, CL спрашивает родителя. Только если родитель сказал «не нашёл» — пытается сам.

Цели:
- предотвратить подмену core-классов (нельзя переопределить `java.lang.String`);
- единая идентичность класса (один `Class` объект для одного name на CL-дереве).

**Нарушения**:
- **Tomcat WebappClassLoader**: сначала ищет в `WEB-INF/classes/lib`, потом у parent — иначе версия библиотеки webapp никогда не победила бы общесерверную;
- **OSGi BundleClassLoader**: ищет по declared imports/exports, parent практически не использует;
- **JPMS ModuleLayer** loaders: routes по graph модулей.

Цена нарушения: возможны два разных `Class` для одного FQN из разных CL → `ClassCastException: com.X cannot be cast to com.X` (любимый wtf-момент в production).

---

### Q7: Чем `ClassNotFoundException` отличается от `NoClassDefFoundError`?

**A:** Совсем разная семантика, постоянно путают:

- **`ClassNotFoundException`** (checked Exception) — explicit lookup by name не сработал. Бросают `Class.forName`, `ClassLoader.loadClass`, `ClassLoader.findClass`. Это означает: «ты попросил класс, я его не нашёл». Типичный сценарий — конфиг с FQN опечатан, или JAR не на classpath.
- **`NoClassDefFoundError`** (Error) — класс был **в compile-time**, но в runtime его не оказалось при linking. Часто причина — **`<clinit>` упал**:
  ```
  java.lang.NoClassDefFoundError: Could not initialize class com.foo.Bar
  ```
  Это значит: «инициализация раньше упала с `ExceptionInInitializerError`; класс помечен как initialization-failed; повторные обращения дают NoClassDefFoundError».

Другой сценарий — class был на compile classpath, нет на runtime classpath (Maven scope mismatch).

---

### Q8: Как происходит классическая утечка ClassLoader (Tomcat redeploy scenario)?

**A:** Сценарий:

1. Tomcat загружает webapp через `WebappCL_v1`. Все классы приложения в Metaspace, помечены этим CL.
2. Webapp при старте регистрирует:
   - JDBC `Driver` в статическом `DriverManager`;
   - JUL `Logger` через `LogManager`;
   - MBean в общий `MBeanServer`;
   - cleanup-thread через shared executor (создан Tomcat-CL, его поток будет жить дольше webapp).
3. Тебе нужен hot-redeploy. Tomcat создаёт `WebappCL_v2`, грузит новый код.
4. **Старый WebappCL_v1 хочет умереть**, но один GC root (driver, logger, MBean, thread) держит **хоть один** объект, чей `getClass().getClassLoader() == WebappCL_v1`.
5. Поэтому **весь** `WebappCL_v1` (и все его Klass-структуры в Metaspace) живёт. После N redeploy — `OutOfMemoryError: Metaspace`.

Защита:
- `Driver Deregister` listener (`ServletContextListener.contextDestroyed`);
- `ThreadLocal.remove()` в финальных filters;
- unregister всех MBean / shutdown hooks;
- Tomcat's "Find leaks" feature использует heap dump для поиска зомби-CL.

---

## 4. JIT Compilation

### Q9: Что такое tiered compilation и какие уровни она использует?

**A:** **Tiered Compilation** (default since 8, `-XX:+TieredCompilation`) — компромисс между быстрым стартом (C1) и оптимальным финальным кодом (C2):

| Level | Compiler | Profiling | Use |
|---|---|---|---|
| 0 | Interpreter | базовое | старт |
| 1 | C1 | no profile | trivial методы |
| 2 | C1 | counters | стартовая |
| 3 | C1 | full profile | сбор данных для C2 |
| 4 | C2 | usage profile | финальный, агрессивные optimizations |

Hot-метод проходит `0 → 3 → 4`. Уровни 1/2 — для коротких/trivial методов, чтобы не тратить время на профилирование. C2 использует профиль с level 3.

Без tiered (`-XX:-TieredCompilation`) — сразу `0 → 4`, медленный warmup, но финальный код такой же.

---

### Q10: Что такое escape analysis и какие optimizations она открывает?

**A:** **Escape Analysis (EA)** — JIT-анализ, определяющий, **выходит ли объект** из метода / потока. Три категории:

- **NoEscape** — объект не покидает метод → **scalar replacement**: объект «разваливается» на local-variables, heap allocation вообще не происходит. `Iterator` в `for-each` часто scalar-replace’ится.
- **ArgEscape** — объект ушёл в other method, но не глобально → виден только в текущем потоке → **lock elision**: `synchronized(this)` для thread-local объекта компилируется в no-op, поскольку нет contention.
- **GlobalEscape** — объект ушёл за пределы метода (поле объекта, return, static, в другой поток) → обычная heap-аллокация и locks.

Дополнительно EA включает:
- **Lock coarsening** — соседние `synchronized` блоки на одном мониторе сливаются в один.

EA — одна из главных причин, почему «лишние объекты» в Java дёшевы для JIT.

> JEP 169 (EA)

---

### Q11: Что такое deoptimization и какие триггеры её вызывают?

**A:** **Deoptimization** — JIT откатывается с скомпилированного кода обратно в interpreter (и потом перекомпилирует). Случается, когда **assumption**, на которой строилась оптимизация, нарушилась.

Триггеры:
- **`unstable_if`** — JIT решил «эта ветка никогда не исполнялась, пропускаем», но она внезапно исполнилась;
- **`class_check`** — call site считался monomorphic (одна реализация), но пришёл другой класс;
- **CHA (Class Hierarchy Analysis) invalidation**: JIT inline-нул виртуальный вызов в одну реализацию, потом ClassLoader загрузил наследника → все скомпилированные методы, полагающиеся на CHA, дереоптимизируются;
- **null_check** в коде, где JIT считал null невозможным.

Цена: десятки µs + потеря профиля + перекомпиляция. На warmup-фазе много deopt — нормально; в steady state — алерт о nondeterministic load (typecheck site видит много типов).

Лог: `-XX:+UnlockDiagnosticVMOptions -XX:+TraceDeoptimization`.

---

## 5. String Internals

### Q12: Как устроены compact strings (JEP 254) и какую экономию дают?

**A:** До Java 9: `String` хранил `char[] value` (2 байта на символ, UTF-16).

С Java 9 (JEP 254 **Compact Strings**): `String` хранит `byte[] value` + `byte coder` (0 = LATIN1, 1 = UTF16).

- если все символы LATIN1 (один байт): `byte[]` ровно length байт — **2× экономия**;
- если есть хоть один не-LATIN1 символ (кириллица, эмодзи) → переключается в UTF16, `byte[]` 2×length.

API остаётся прежним (`charAt`, `length`), но внутри есть branch по coder.

Эффект: в ASCII-нагруженных приложениях (логи, JSON-keys, HTTP-headers) heap сокращается на 10–30%. В UI/мультиязычных — мало. Hot loops становятся чуть медленнее из-за branch'а (можно отключить `-XX:-CompactStrings` для бенчмарка).

---

### Q13: Как работает `+` для строк в Java 9+ и почему это лучше StringBuilder?

**A:** До Java 9 `javac` превращал `"a" + b + "c"` в `new StringBuilder().append("a").append(b).append("c").toString()`. Аллокация StringBuilder + char[] + копирование, плюс resize при overflow.

С Java 9 (JEP 280 **Indify String Concatenation**) — `invokedynamic` к bootstrap `StringConcatFactory.makeConcatWithConstants`:

```
ldc "Hello, "
aload local_user
invokedynamic makeConcatWithConstants ("Hello, \1!", ...)
```

В runtime JVM сама выбирает strategy: обычно `MH_INLINE_SIZED_EXACT` — строит `MethodHandle`, который вычисляет финальный размер, аллоцирует **один** `byte[]`, копирует в него аргументы напрямую. **Без StringBuilder, без промежуточных копий.**

Преимущества:
- 2–5× быстрее на типичных concat-pattern;
- меньше garbage;
- backward-compatible — старый bytecode с `StringBuilder.append` продолжает работать;
- стратегию можно менять в JVM без перекомпиляции пользовательского кода.

> JEP 280

---

## 6. Bytecode & invokedynamic

### Q14: Что такое invokedynamic и зачем JVM эту инструкцию добавили?

**A:** `invokedynamic` (JEP 292, Java 7+) — «поздно связываемый» вызов. В отличие от `invokevirtual` / `invokestatic`, у которых тип цели фиксирован в bytecode, `invokedynamic` указывает на **bootstrap method** (BSM). При первом исполнении JVM:

1. Вызывает BSM с `(Lookup, name, MethodType, BSM-args)`;
2. BSM возвращает `CallSite` (обычно с `MethodHandle`);
3. CallSite «приклеивается» к этой точке — последующие вызовы идут через MH без bootstrap.

Изначальная мотивация — поддержка не-Java языков на JVM (Groovy, JRuby, Scala) — им нужно решать в runtime, какой метод вызывать.

JDK сам использует:
- **Lambda** (`(x) -> x + 1`) → invokedynamic → `LambdaMetafactory.metafactory` создаёт class lazily;
- **String concat** (Java 9+) → `StringConcatFactory.makeConcatWithConstants`;
- **`switch` на String / sealed** → `SwitchBootstraps`;
- **Record's equals/hashCode/toString** → `ObjectMethods.bootstrap`.

JIT inline-ит resolved CallSite **как direct call** — нет оверхеда после bootstrap.

---

### Q15: Как создаётся lambda в bytecode? Есть ли у неё .class файл на диске?

**A:** Когда компилятор видит:
```java
Function<Integer, Integer> inc = x -> x + 1;
```

В bytecode появляется:
```
invokedynamic apply (LambdaMetafactory.metafactory bootstrap)
```

Тело лямбды компилируется в **private static synthetic method** в текущем классе (имя типа `lambda$inc$0`).

В runtime `LambdaMetafactory`:
1. Получает `MethodType` функционального интерфейса (`(Object)Object` для `Function`);
2. Получает `MethodHandle` на synthetic-метод;
3. Через `MethodHandles.Lookup.defineHiddenClass` (Java 15+, JEP 371) генерирует **hidden class**, реализующий `Function`. До 15 — через `Unsafe.defineAnonymousClass`.
4. Возвращает singleton (non-capturing lambda) или factory MH (capturing).

Имя сгенерированного класса — `MyClass$$Lambda$1/0x000...` — **на диске НЕТ файла**, генерируется в runtime. **Hidden classes** не видны reflection, не имеют permanent name, GC-able вместе с CL.

Поэтому stack trace часто содержит загадочные `MyClass$$Lambda$1/0x000abc.apply` — это синтетические lambda-классы.

> JEP 276 (Dynamic Linking of Language-Defined Object Models, lambda) + JEP 371 (Hidden Classes)

---

## 7. Reflection, MethodHandle, VarHandle

### Q16: В чём разница между Reflection, MethodHandle и VarHandle? Когда что использовать?

**A:**

| | Reflection (`Method`) | MethodHandle | VarHandle |
|---|---|---|---|
| Год | 1.1 | 7 | 9 |
| Use case | runtime introspection, фреймворки | indirect calls, lambda, lang runtimes | atomic-доступ к полям/массивам |
| Performance | dispatch + access check + boxing — медленно | JIT-friendly, near-direct после bootstrap | inline в hot path |
| Type safety | runtime `IllegalArgumentException` | compile-time via `MethodType` | typed accessor с access modes |
| Replaces | — | reflection для perf-критики | `Unsafe`, `AtomicXxxFieldUpdater` |

**Когда что**:
- **Reflection** — для convenience (фреймворки, Jackson по private полям). Не в hot path.
- **MethodHandle** — для performance в indirect calls (DI-фреймворки, language runtimes). Composable через combinators (`bindTo`, `insertArguments`, `filterArguments`).
- **VarHandle** — для concurrency primitives: lock-free counter, CAS, replace AtomicLongFieldUpdater. Поддерживает 5 access modes: plain / opaque / acquire-release / volatile / atomic ops.

---

### Q17: Что такое access modes у VarHandle и какие гарантии они дают?

**A:** VarHandle предоставляет 5 уровней access modes — от слабого к сильному:

1. **plain** (`get`, `set`) — нет ordering, обычное чтение/запись. Compiler/CPU могут реоrdering.
2. **opaque** (`getOpaque`, `setOpaque`) — coherent: один поток видит свои записи в порядке. Без cross-thread эффектов (нет happens-before).
3. **acquire / release** (`getAcquire`, `setRelease`) — пара для producer-consumer pattern. `setRelease` пишет с release-semantics; последующий `getAcquire` в другом потоке гарантирует **happens-before** для всех записей до `setRelease`. Дешевле volatile (нет full fence).
4. **volatile** (`getVolatile`, `setVolatile`) — семантика обычного volatile-поля: sequential consistency для этого field.
5. **atomic ops** — `compareAndSet`, `getAndAdd`, `getAndBitwiseOr` — CAS-семантика, full memory ordering.

Зачем уровни: позволяют lock-free алгоритмам использовать **минимальный** уровень синхронизации, не платя за volatile, когда хватает acquire/release (Disruptor LMAX, очереди с одним producer/consumer).

> JEP 193 (VarHandle), JLS §17 (JMM access modes)

---

## 8. JPMS

### Q18: Что такое `requires transitive` и зачем оно нужно?

**A:** В `module-info.java`:

```java
module com.example.web {
    requires transitive java.sql;
}
```

Без `transitive`: код `com.example.web` использует `java.sql`, но **клиенты** `com.example.web` должны сами добавить `requires java.sql`, если хотят использовать его типы.

С `transitive`: клиенты автоматически получают `java.sql` через зависимость от `com.example.web`.

Use case: модуль re-exports API другого модуля через свои сигнатуры. Например, `Repository.find()` возвращает `java.sql.Connection` — клиент должен иметь доступ к `Connection`. Если `requires` без transitive — клиент будет получать compile-error «type Connection not visible».

Это «implementation hiding decision»: автор модуля решает, **показать ли** транзитивную зависимость в API.

> JLS §7 (модули), JEP 261

---

## 9. Generics & Type Erasure

### Q19: Что нельзя из-за type erasure и какие workarounds?

**A:** После компиляции generics стираются → `T` становится `Object` (или upper bound). Это закрывает несколько возможностей:

- **`new T()`** — нет конструктора. Workaround: `Supplier<T>` или `Class<T> clazz` + `clazz.getDeclaredConstructor().newInstance()`.
- **`new T[N]`** — нельзя (JVM не знает element type). Workaround: `(T[]) new Object[n]` (unchecked warning) или `Array.newInstance(clazz, n)`.
- **`obj instanceof T`** — нельзя. Workaround: `clazz.isInstance(obj)`.
- **`T.class`** — нет литерала. Workaround: passing `Class<T> token`.
- **Перегрузка по generic параметру** (`foo(List<String>)` + `foo(List<Integer>)`) — same erasure → compile error.
- **Static-поля типа `T`** — `T` per-instance, static — per-class, конфликт.
- **`catch (T extends Exception)`** — запрещено.
- **`T[]` в varargs создаёт unchecked warning** — `@SafeVarargs` подавляет.

Reified generics (Kotlin `reified` через `inline`) — compile-time trick, не Java solution.

---

### Q20: Что такое bridge method? Зачем компилятор их генерирует?

**A:** Bridge method — synthetic метод, генерируемый компилятором для совместимости erasure + override.

Пример:
```java
class Box<T> { public T get() { return null; } }
class StringBox extends Box<String> {
    @Override public String get() { return "foo"; }
}
```

После стирания типов `Box.get()` имеет сигнатуру `Object get()`. `StringBox.get()` — `String get()`. Это **разные** сигнатуры, override не работает по правилам JVM.

Компилятор добавляет в `StringBox` **bridge**:
```java
public Object get() { return this.get(); }   // bridge → forwards to typed
public String get() { return "foo"; }
```

Bridge помечен ACC_SYNTHETIC | ACC_BRIDGE, видим в `javap`. `Method.getDeclaredMethods()` возвращает оба — типичная багу-ловушка («два метода `get`»). Чтобы отфильтровать: `Method.isBridge()`.

Аналогично с возвратными типами (`@Override` `Number` → `Integer`) — covariant return types через bridge.

---

## 10. equals / hashCode / Comparable

### Q21: Какие контракты у equals и hashCode и какие их нарушения опасны?

**A:** **`equals` контракт** (JLS / `Object` javadoc):

1. **Reflexive**: `x.equals(x) == true`.
2. **Symmetric**: `x.equals(y) == y.equals(x)`.
3. **Transitive**: `x.equals(y) && y.equals(z) → x.equals(z)`.
4. **Consistent**: повторные вызовы при неизменности — same result.
5. **Null-safe**: `x.equals(null) == false`.

**`hashCode` контракт**:
1. **Consistent** — при неизменности возвращает одно значение.
2. **equal → equal hash** (главное правило).
3. distinct → different (желательно).

**Опасные нарушения**:
- **`hashCode` через mutable field** → объект в `HashSet`, mutate → не найти, leak.
- **`equals` сравнивает поля A, hashCode — поля B** → нарушение rule 2 → HashSet badly broken.
- **`equals(MyType)` без `@Override`** = overload, не override → HashMap не использует. Всегда `@Override`.
- **Symmetric ломается при наследовании** с `instanceof`-проверкой и subclass добавил поле → red(1,2).equals(plain(1,2)) ≠ обратно.
- **TreeMap inconsistency с equals** — TreeMap использует `compareTo`, не equals; `BigDecimal("1.0").compareTo("1.00") == 0` но `equals == false` → keys сливаются.

---

### Q22: Чем `Comparable` отличается от `Comparator` и где появляется TreeMap pitfall с BigDecimal?

**A:**

- **`Comparable<T>`** — реализуется самим типом, описывает **natural ordering** (`Integer`, `String`, `LocalDate`).
- **`Comparator<T>`** — внешний объект, любой порядок. Java 8+: `Comparator.comparing(User::getName).thenComparingInt(User::getAge).reversed()`.

**TreeMap pitfall**: `TreeMap.put(key, value)` сравнивает через `compareTo` (или внешний Comparator), **не** через `equals`. Если `compareTo == 0` — TreeMap считает их одним ключом → перезапишет.

`BigDecimal`:
```java
TreeMap<BigDecimal, String> m = new TreeMap<>();
m.put(new BigDecimal("1.0"), "a");
m.put(new BigDecimal("1.00"), "b");   // compareTo == 0 → "b" перезаписал "a"!
m.size();   // 1, не 2

HashMap<BigDecimal, String> h = new HashMap<>();
h.put(new BigDecimal("1.0"), "a");
h.put(new BigDecimal("1.00"), "b");   // equals == false → две записи
h.size();   // 2
```

Это **легально по `SortedMap` контракту** — он явно говорит «может быть inconsistent с equals», но удивляет на собеседовании. Для BigDecimal — использовать HashMap или нормализовать через `stripTrailingZeros`.

---

## 11. Exception Internals

### Q23: Почему создание Exception дорого и как сделать «дешёвый» exception?

**A:** Конструктор `Throwable` вызывает **`fillInStackTrace()`** — native метод, обходящий весь стек потока и копирующий frame info. Стоимость пропорциональна глубине стека: типично 10–100 µs на throw.

Если используешь exception как **flow control** (parser backtracking, Jackson internal, Kotlin coroutines `CancellationException` для some subclass) — fillInStackTrace доминирует.

«Дешёвый» exception:
```java
class FastException extends RuntimeException {
    public FastException(String msg) { super(msg, null, false, false); }   // Java 7+
    // или
    @Override public synchronized Throwable fillInStackTrace() { return this; }
}
```

Первый вариант (Java 7+) использует four-arg конструктор `Throwable(message, cause, enableSuppression, writableStackTrace)` — отключает оба механизма.

Дополнительно: HotSpot оптимизация **`-XX:-OmitStackTraceInFastThrow`** — после warmup JVM кидает singleton встроенных exception (NPE, ArrayIndexOutOfBounds) **без стэка** — `null` trace. Чинится `-XX:-OmitStackTraceInFastThrow` (в dev/staging).

---

### Q24: Как работает try-with-resources и что такое suppressed exception?

**A:** `try-with-resources` (Java 7+) превращает:
```java
try (var stream = open()) { use(stream); }
```

В bytecode:
```java
var stream = open();
Throwable primary = null;
try { use(stream); }
catch (Throwable t) { primary = t; throw t; }
finally {
    if (stream != null) {
        if (primary != null) {
            try { stream.close(); }
            catch (Throwable closeEx) { primary.addSuppressed(closeEx); }
        } else stream.close();
    }
}
```

**Suppressed exception**: если `try`-блок бросил `primary`, и `close()` тоже бросил → `close`-exception **не теряется**, добавляется в `primary.getSuppressed()`. В печати:
```
IOException: from try
    Suppressed: SQLException: from close
```

Без try-with-resources при ручном `finally` `close()`-exception **затирал** primary — главный bug (теряли первую причину).

Resource должен реализовать `AutoCloseable` (или `Closeable`). С Java 9 — `try (existingFinalVar) { ... }` без объявления (effectively final var).

---

## 12. Modern Java Features

### Q25: Что такое sealed классы и зачем они нужны?

**A:** **Sealed class / interface** (JEP 409, stable Java 17) — ограниченная иерархия: автор класса **явно** перечисляет наследников.

```java
public sealed interface Shape permits Circle, Square, Triangle {}

public record Circle(double radius) implements Shape {}
public record Square(double side)   implements Shape {}
public final class Triangle implements Shape { ... }
```

Subclass должен быть `final`, `sealed`, или `non-sealed` (явно открыть обратно). `permits` обязателен, если subclass не в том же compilation unit.

**Use cases**:
1. **Exhaustive pattern matching** — `switch (shape)` без default, компилятор проверяет, что все cases покрыты. Если добавишь новый subclass `Pentagon` — все switch на shape поломаются → compile error → форсирует обновить всё, что зависит от иерархии.
2. **ADT (Algebraic Data Types)**: record (product) + sealed (sum) = ADT из functional languages. Чистая моделька для Domain.
3. **API stability**: библиотека публикует sealed interface — пользователи **не могут** создать свои implementations → автор гарантирует backward compatibility.

> JEP 409

---

### Q26: Что такое record patterns и где они полезны?

**A:** **Record patterns** (JEP 440, stable Java 21) — деструктуризация records в pattern matching.

```java
record Point(int x, int y) {}
record Line(Point from, Point to) {}

double length(Line line) {
    return switch (line) {
        case Line(Point(var x1, var y1), Point(var x2, var y2))
            -> Math.hypot(x2 - x1, y2 - y1);
    };
}
```

Можно:
- nested patterns (Line содержит Point);
- сочетание с `var` (auto-infer типов);
- сочетание с `when` guards: `case Line(Point(var x, _), Point(var x2, _)) when x == x2 -> "vertical"`;
- `_` (unnamed pattern, JEP 456 stable 22) — игнорировать component.

Где полезны:
- ADT-обход (sealed + record + record patterns);
- destructuring API responses в pattern matching switch;
- functional-style алгоритмы без mutable state.

Под капотом — bytecode через invokedynamic → `SwitchBootstraps.typeSwitch`. Компилятор может оптимизировать в jump table.

> JEP 440

---

### Q27: Что можно делать с `var` и что нельзя? Какие style guidelines?

**A:** `var` (JEP 286, Java 10+) — **local variable type inference**.

**Можно**:
- local variables: `var list = new ArrayList<String>();`;
- loop vars: `for (var entry : map.entrySet())`, `for (var i = 0; i < n; i++)`;
- try-with-resources: `try (var stream = openStream())`;
- lambda parameters (с Java 11+, нужны annotations): `(var x) -> ...`.

**Нельзя**:
- field declaration;
- method parameter / return type;
- lambda parameter без annotations;
- `var x = null;` (нет инициализатора с реальным типом);
- `var arr = {1, 2, 3};` (array initializer без типа);
- two declarations: `var x = 1, y = 2;`.

**Style**:
- ✅ когда тип очевиден: `var users = userRepo.findAll();` (видно `List<User>` в имени метода);
- ❌ когда тип непрозрачен: `var result = service.compute();` — что вернулось?
- ✅ с long generic types: `var map = new HashMap<String, List<UserDto>>();`;
- ❌ как сокращение для маленьких primitives: `var x = 0;` — лишний;
- `var` — **не keyword** (reserved type name), можно иметь поле `int var`. Но `class var {}` нельзя.

---

## 13. Foreign Memory & Vector API

### Q28: Что такое FFM API и чем оно лучше JNI и `Unsafe`?

**A:** **Foreign Function & Memory API** (JEP 454, stable Java 22) — комбинированная замена двух «грязных» механизмов:

**JNI** (старое):
```java
public native long strlen(String s);   // в C: JNIEXPORT jlong JNICALL ...
```
Проблемы: ручной JNIEnv, ref management, медленный context switch, hard to debug.

**`Unsafe.allocateMemory`** (старое):
```java
long addr = unsafe.allocateMemory(1024);
unsafe.putLong(addr, 0, 42);
unsafe.freeMemory(addr);
```
Проблемы: undocumented, type-unsafe, лёгкие segfault, не освобождение → leak.

**FFM** (новое):
```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment buf = arena.allocate(1024);
    buf.set(ValueLayout.JAVA_LONG, 0, 42L);
}  // memory freed automatically

// Foreign call:
Linker linker = Linker.nativeLinker();
MemorySegment strlen = linker.defaultLookup().find("strlen").orElseThrow();
MethodHandle mh = linker.downcallHandle(strlen,
    FunctionDescriptor.of(JAVA_LONG, ADDRESS));
```

Преимущества:
- **Type-safe**: `ValueLayout.JAVA_LONG` vs `putLong`;
- **Lifetime через Arena**: confined / shared / auto / global;
- **Confinement check**: `ofConfined` arena недоступна другим потокам → `WrongThreadException`;
- **Foreign Linker заменяет JNI** без C-обёрток;
- **JIT-friendly intrinsics**.

> JEP 454

---

## 14. Serialization

### Q29: Почему Java Serialization считается «security-уязвимым» и что такое gadget chain?

**A:** `ObjectInputStream.readObject` **исполняет код произвольных классов**: их `readObject`, `readResolve`, getter'ы вызываются во время десериализации. Если атакующий контролирует stream — он строит **gadget chain**: цепочку существующих в classpath классов, чьи `readObject` побочно делают `Runtime.exec` или эквивалент.

Известный пример: **Apache Commons Collections** (CVE-2015-4852, **CommonsCollections1**):

```
InvokerTransformer → ChainedTransformer → LazyMap → AnnotationInvocationHandler
```

Десериализация `LazyMap.get(key)` триггерит цепочку трансформеров → `Runtime.exec("calc")`. Атакующий присылает blob — RCE.

Влияние: WebLogic, JBoss, OpenNMS, Jenkins, Solr — все принимали Java-serialized данные через HTTP/JNDI/RMI. **ysoserial** — public tool, генерирующий payloads для разных gadget chains.

**Защита**:
1. **Не принимать Java serialization** от ненадёжных источников. Переход на JSON / Protobuf.
2. **Serialization filter** (JEP 290, Java 9+):
   ```java
   ObjectInputFilter filter = ObjectInputFilter.Config.createFilter(
       "java.util.*;java.lang.*;!*");        // whitelist
   ois.setObjectInputFilter(filter);
   ```
   Или JVM-флаг `-Djdk.serialFilter="..."`.
3. **JEP 415** (Java 17+) — context-specific filter factory для per-stream правил.

> JEP 290, JEP 415

---

## 15. JMM Reference

### Q30: Где в `java-core` затрагивается JMM и почему сама модель — в `concurrency`?

**A:** Repo использует правило **NO OVERLAP** — каждая тема принадлежит ровно одному модулю. JMM (Java Memory Model — happens-before, volatile, synchronized, final-publication semantics) — фундамент **concurrent программирования**, который изучается вместе с locks, atomics, virtual threads. Поэтому JMM canonical owner — модуль `concurrency`, файл `THREADS_BASICS.md`.

В `java-core` есть **смежные** темы, использующие концепты JMM:
- **VarHandle access modes** (plain / opaque / acquire-release / volatile / atomic) — в [`REFLECTION_HANDLES.md`](theory/REFLECTION_HANDLES.md). Это API-аспект, реализующий JMM-семантику.
- **GC write barriers** (card table, SATB) — в [`GARBAGE_COLLECTION.md`](theory/GARBAGE_COLLECTION.md). Барьеры — runtime-механизм, обеспечивающий GC-инварианты, не JMM напрямую.
- **JIT lock elision / coarsening** — в [`JIT_COMPILATION.md`](theory/JIT_COMPILATION.md). JIT-оптимизации, легальные **именно потому, что JMM их разрешает**.

Файл [`JMM_REFERENCE.md`](theory/JMM_REFERENCE.md) — короткий cross-reference, указывающий на канонические locations в `concurrency`. Если на собесе спрашивают «знаешь JMM?» — отвечай через короткое определение happens-before и направляй на `concurrency/THREADS_BASICS.md` для деталей.

> JLS §17 (Threads and Locks), JEP 188 (Java Memory Model Update)
