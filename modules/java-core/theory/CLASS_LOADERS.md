# Class Loaders

---

## 1. Зачем вообще нужны class loaders

Простая модель: javac компилит `MyClass.java` в `MyClass.class` (байт-код), JVM читает `.class` и исполняет. Почему между ними понадобилась целая абстракция — **ClassLoader**?

Ответ кроется в требованиях, которые Sun и сообщество предъявили к JVM в середине 90-х:

1. **Lazy loading**. Класс не нужно загружать заранее — только когда программа реально к нему обращается. Это критично для applets (помните applets?): не качать весь jar на старте, грузить по мере необходимости.
2. **Изоляция приложений в одной JVM**. Servlet container держит десятки webapps в одном процессе. Каждое webapp может зависеть от **разных версий** одной библиотеки — Spring 5 и Spring 6 одновременно. Без изоляции это невозможно.
3. **Hot reload**. Замени `.class` файл — webapp перезагрузится без рестарта JVM. Tomcat, Spring DevTools, JRebel — всё построено на этом.
4. **Безопасность**. Bootstrap-классы (`java.lang.*`) загружены отдельно, и **никто** не может их подменить. Иначе зловредный applet переопределил бы `String` и читал ваши пароли.
5. **Dynamic class generation**. CGLIB, lambdas, JDK Proxy создают классы **в runtime** — без файла на диске. Нужен механизм «вот байты, регистрируй как класс».

ClassLoader — это абстракция, отвечающая за все эти случаи. Каждый ClassLoader — фабрика классов с собственным namespace.

---

## 2. Иерархия (Java 9+)

```
            ┌──────────────────────────┐
            │ Bootstrap ClassLoader    │  null (написан на C++)
            │   java.base, java.sql... │
            └─────────────┬────────────┘
                          │
            ┌─────────────▼────────────┐
            │ Platform ClassLoader     │  PlatformClassLoader
            │   все non-java.base      │
            │   модули JDK             │
            └─────────────┬────────────┘
                          │
            ┌─────────────▼────────────┐
            │ Application (System) CL  │  AppClassLoader
            │   classpath / modulepath │
            └─────────────┬────────────┘
                          │
            ┌─────────────▼────────────┐
            │ Custom ClassLoader (опц.)│  Tomcat WebappCL, OSGi BundleCL, …
            └──────────────────────────┘
```

До Java 9 второй уровень назывался **Extension ClassLoader** (грузил из `$JAVA_HOME/lib/ext`); JPMS его упразднил, потому что `lib/ext` как механизм plugin'ов был дырой в безопасности — любой jar в этой директории получал JDK-уровень доверия.

### 2.1. Что грузит каждый CL

- **Bootstrap**: всё из модуля `java.base` (что в pre-9 жило в `rt.jar`). На него получить ссылку нельзя — `String.class.getClassLoader()` возвращает `null`.
- **Platform**: всё остальное JDK — `java.sql`, `java.xml`, `java.logging`, `jdk.compiler`. Это позволяет `jlink`-у вырезать неиспользуемые модули из дистрибутива.
- **Application**: classpath (`-cp`) + module path (`--module-path`). Ваше приложение.
- **Custom**: на ваш выбор. Tomcat создаёт `WebappClassLoader` для каждого деплоя. OSGi — `BundleClassLoader` для каждого bundle.

### 2.2. Почему bootstrap = null

JVM реализована на C++. Bootstrap CL — это не Java-объект, а C++ структура внутри HotSpot. Чтобы избежать рекурсии (`getClassLoader()` возвращает `null` → создавать Java-обёртку которая сама требует загрузки → ...) разработчики приняли соглашение: `null` ≡ Bootstrap.

```java
String.class.getClassLoader();           // null  (Bootstrap)
java.sql.Connection.class.getClassLoader();  // PlatformClassLoader
MyApp.class.getClassLoader();            // AppClassLoader
```

Если в собственном коде нужно «грузить как bootstrap» — не получится. Загрузка native-кода JDK классами — implementation detail.

---

## 3. Parent delegation — главный принцип

```java
protected Class<?> loadClass(String name, boolean resolve) {
    Class<?> c = findLoadedClass(name);          // 1) уже грузил?
    if (c == null) {
        try {
            if (parent != null) {
                c = parent.loadClass(name, false);  // 2) спросить родителя
            } else {
                c = findBootstrapClassOrNull(name);
            }
        } catch (ClassNotFoundException ignored) {}
        if (c == null) {
            c = findClass(name);                  // 3) сам ищи
        }
    }
    if (resolve) resolveClass(c);
    return c;
}
```

Каждый ClassLoader перед загрузкой класса **спрашивает родителя**. Только если родитель сказал «не нашёл» — пытается сам. Это правило обеспечивает:

- **Единая идентичность core-классов**. `java.lang.String` всегда загружается Bootstrap → один `Class` объект на всю JVM.
- **Невозможность подмены**. Custom CL не может определить «свой» `java.lang.String` — Bootstrap ответит первым.
- **Иерархия видимости**. Child видит то, что грузит parent (через делегирование), но parent не видит child-классы.

### 3.1. Когда parent delegation нарушается

Иногда строгая иерархия не работает, и фреймворки сознательно ломают правило:

**Tomcat WebappClassLoader** — обратное правило: сначала ищет в `WEB-INF/classes` и `WEB-INF/lib`, **потом** у parent. Иначе версия библиотеки, поставленная webapp, никогда не победила бы общесерверную. Например, webapp хочет Jackson 2.15, а сервер пришёл с 2.10 — без нарушения parent delegation webapp получит 2.10.

**OSGi BundleClassLoader** — вообще не использует parent для большинства запросов. Каждый bundle декларирует `Import-Package` / `Export-Package`; ClassLoader bundle'а ходит **по графу зависимостей**, а не по дереву CL. Это позволяет иметь Spring 5 и Spring 6 в одной JVM одновременно.

**JPMS ModuleLayer loaders** — routes по graph модулей, а не родительскому CL.

### 3.2. Цена нарушения: ClassCastException

Если **один** FQN загружен **двумя** разными CL — это **два разных `Class` объекта**:

```java
Class<?> a = webappCL.loadClass("com.example.Util");
Class<?> b = serverCL.loadClass("com.example.Util");
a.equals(b)             // false
a == b                  // false
```

При этом `instanceof` между ними даёт `false`. Самый загадочный wtf:

```
ClassCastException: com.example.Util cannot be cast to com.example.Util
```

Тип на левой стороне = `com.example.Util из CL_A`, на правой = `com.example.Util из CL_B`. Текст ошибки одинаковый, потому что включает только имя класса, не CL. Дебаг:

```java
log.error("Left CL = {}, Right CL = {}",
    leftObj.getClass().getClassLoader(),
    rightObj.getClass().getClassLoader());
```

---

## 4. Lifecycle класса: loading → linking → initialization

JVMS §5 разбивает «жизнь» класса на три фазы:

```
   .class bytes
        ▼
   1. Loading        ← ClassLoader.defineClass()
        ▼
   2. Linking
        ├ Verification    (bytecode safe?)
        ├ Preparation     (static fields = default values)
        └ Resolution      (symbolic refs → direct refs; lazy)
        ▼
   3. Initialization  ← <clinit> executes
        ▼
   Ready to use
```

### 4.1. Loading

Чтение `.class` (с диска / jar / network / в-памяти буфера / сгенерированных bytecode) и создание `java.lang.Class` объекта. Финальная инструкция — `defineClass(name, bytes, off, len)` — нативный метод JVM, превращающий байты в `Class`. Это **точка входа** для всего dynamic class generation: ASM, ByteBuddy, JDK Proxy, lambda factory — все вызывают `defineClass` под капотом.

### 4.2. Linking

**Verification** — проверка корректности bytecode по JVMS §4.10:
- Каждая инструкция имеет валидные операнды;
- Operand stack не переполняется и не схлопывается;
- Локальные переменные правильных типов;
- Final-методы не переопределены;
- Доступ к private/protected не нарушается.

Хорошая новость: после этой фазы JVM **может** агрессивно оптимизировать (нет рантайм-проверок). Плохая: bytecode patching agent должен генерировать **корректный** код, иначе `VerifyError` на старте.

**Preparation** — выделение памяти под static-поля и присвоение **default-значений**: 0, null, false. Это НЕ выполнение `static {}` блоков!

```java
class Demo {
    static int x = 42;        // preparation: x = 0; initialization: x = 42
    static String s = "foo";  // preparation: s = null; initialization: s = "foo"
}
```

**Resolution** — символические ссылки в constant pool разворачиваются в прямые. `Methodref "java/lang/String.length()I"` превращается в указатель на конкретный метод. Может быть **lazy** (откладывается до первого use).

### 4.3. Initialization

Выполняется `<clinit>` — синтетический метод, в котором javac собрал:
- static field initializers;
- static initializer blocks `static { ... }`.

JVMS гарантирует, что `<clinit>` исполняется **под блокировкой на классе ровно один раз** на CL. Это даёт классический thread-safe singleton без `synchronized`:

```java
class Singleton {
    private static class Holder {
        static final Singleton INSTANCE = new Singleton();
    }
    public static Singleton getInstance() {
        return Holder.INSTANCE;
    }
}
```

`Holder` не инициализируется, пока `getInstance` не вызвана. Первый вызов триггерит JVM — JVM lock'ит класс, исполняет `<clinit>`, освобождает lock. Параллельные потоки ждут.

### 4.4. Триггеры initialization (active use)

Не любое упоминание класса вызывает initialization. JVMS §5.5 точно перечисляет:

- `new Foo()`;
- доступ к **non-final non-constant** static-полю (если поле `static final int X = 42` — это compile-time константа, инициализация не нужна, javac инлайнит значение);
- вызов static-метода;
- `Class.forName(name)` (с `initialize=true` — default);
- инициализация subclass требует super-инициализации;
- запуск main-класса.

**НЕ инициализирует**:
- `Foo.class` literal;
- `Class.forName(name, false, cl)`;
- `Foo[].class` (массивы — отдельные классы);
- упоминание в throws clause.

---

## 5. `ClassNotFoundException` vs `NoClassDefFoundError`

Самая частая путаница на собесе. Разные семантики:

| | ClassNotFoundException | NoClassDefFoundError |
|---|---|---|
| Тип | checked Exception | Error |
| Когда | `Class.forName`, `ClassLoader.loadClass` не нашёл класс | linker не смог разрешить класс, который **был известен** на этапе компиляции |
| Причина | name не существует на classpath | jar пропал между compile и runtime, ИЛИ `<clinit>` упал на предыдущей попытке инициализации |

`ClassNotFoundException`:
```java
Class.forName("com.example.Plugin");   // нет такого класса → ClassNotFoundException
```

`NoClassDefFoundError`:
```java
class A {
    static B b = new B();              // <clinit> зависит от B
}
class B {
    static { throw new RuntimeException("boom"); }
}

new A();    // первый раз: ExceptionInInitializerError: caused by RuntimeException
new A();    // второй раз: NoClassDefFoundError: Could not initialize class A
```

Класс A **помечен** как initialization-failed. Повторные обращения **не перезапускают** `<clinit>` — кидается `NoClassDefFoundError`. Это деталь, которая ломает мозг при дебаге production: реальная ошибка случилась когда-то давно, в логах видна только пустая `NoClassDefFoundError` без причины.

---

## 6. Custom ClassLoader — как написать свой

Шаблон:
```java
public class JarClassLoader extends ClassLoader {
    private final Path jarPath;

    public JarClassLoader(Path jarPath, ClassLoader parent) {
        super(parent);
        this.jarPath = jarPath;
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        try {
            byte[] bytes = readClassBytes(name);          // твоя логика
            return defineClass(name, bytes, 0, bytes.length);
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    }

    private byte[] readClassBytes(String name) throws IOException {
        try (JarFile jar = new JarFile(jarPath.toFile())) {
            String entryName = name.replace('.', '/') + ".class";
            ZipEntry entry = jar.getEntry(entryName);
            if (entry == null) throw new IOException("not found: " + entryName);
            try (InputStream is = jar.getInputStream(entry)) {
                return is.readAllBytes();
            }
        }
    }
}
```

Ключевые правила:
- **Override `findClass`, не `loadClass`** — тогда parent delegation работает автоматически.
- `defineClass` — точка входа JVM. После неё `Class` существует.
- Один CL может определить класс с данным FQN **только один раз**. Повторный `defineClass` с тем же name = `LinkageError`.

Если хочешь нарушить parent delegation (как Tomcat) — override `loadClass` целиком, контролируй порядок.

### 6.1. Hidden Classes (JEP 371)

С Java 15 появился `Lookup.defineHiddenClass(byte[], boolean, ClassOption...)`. Hidden class:
- Не имеет binary name в обычной форме (используется `Class.getName()` с `/0x000abc` суффиксом);
- Не виден `Class.forName` и reflection;
- GC-able вместе с создавшим его CL;
- Может быть `NestMate` существующего класса (доступ к private).

Используется внутри `LambdaMetafactory`, `StringConcatFactory`, и фреймворками типа ByteBuddy для генерации one-shot классов без засорения namespace.

---

## 7. ClassLoader leak — главная operational боль

Сценарий webapp redeploy:

```
[t=0]   Tomcat start
        AppCL загружает Tomcat libs

[t=1]   Deploy webapp v1
        Создан WebappCL_v1 (parent=AppCL)
        WebappCL_v1 загружает классы webapp v1
        Webapp инициализируется:
          - Регистрирует JDBC Driver в shared DriverManager
          - Создаёт ThreadLocal в shared ExecutorService
          - Запускает background scheduler-thread
          - Регистрирует MBean в shared MBeanServer

[t=2]   Hot redeploy (та же версия или v2)
        Tomcat останавливает webapp:
          - Вызывает ServletContextListener.contextDestroyed
          - Останавливает threads, закрывает sessions
        Tomcat создаёт WebappCL_v2

[t=3]   WebappCL_v1 хочет умереть
        Но:
          - DriverManager.drivers содержит Driver, чей getClass().getClassLoader() == WebappCL_v1
          - MBeanServer hold MBean того же CL
          - shared thread pool's thread всё ещё имеет ThreadLocal
        ==>  WebappCL_v1 reachable из GC roots ==> не GC-ится
        ==>  все классы webapp v1 остаются в Metaspace

[t=4...] После N redeploy
        Metaspace растёт ==> OutOfMemoryError: Metaspace
```

### 7.1. Главные виновники

Я расположу по частоте:

1. **JDBC Drivers** — `DriverManager` хранит статический список. Webapp v1 зарегистрировал → `DriverManager` держит → весь CL живёт. Решение: явный `DriverManager.deregisterDriver(driver)` в `contextDestroyed`.

2. **`java.util.logging.LogManager`** — держит конфигурацию через static. До Java 11 проблема была серьёзной, потом частично решена. Workaround: `LogManager.getLogManager().reset()`.

3. **ThreadLocal в shared thread pool** — value живёт, пока живёт thread. Shared executor создан Tomcat-CL → его потоки переживут webapp redeploy → их ThreadLocal содержат webapp v1 объекты → CL v1 жив. Решение: `ThreadLocal.remove()` в finally блоке.

4. **Custom MBean без `unregisterMBean`** в `contextDestroyed`.

5. **AOP agents** (Byte Buddy, Spring Instrument) — кэшируют classes/methods глобально, могут держать ссылки на webapp v1 классы.

6. **`shutdown hooks`** — `Runtime.addShutdownHook` регистрирует thread в JVM. После redeploy hook остаётся → его run-method ссылается на webapp v1 классы.

7. **Static caches фреймворков** — Jackson `TypeFactory`, Hibernate `SessionFactory`, Spring `BeanDefinitionRegistry` если живут в parent CL.

### 7.2. Диагностика

```bash
jmap -dump:format=b,file=heap.hprof <pid>
```

Открыть в **Eclipse MAT** (Memory Analyzer Tool):
1. `Histogram` — найти `*ClassLoader` классы (`WebappClassLoader`, `org.apache.catalina.loader.WebappClassLoaderBase`).
2. Если их **больше одного** на одно webapp — почти наверняка leak.
3. `Path to GC Roots` на одном из них (исключая weak/phantom) — найти конкретный GC root, держащий ссылку.

Tomcat 9+ имеет встроенную фичу «Find leaks» в Manager App — runs detection logic после redeploy.

> Mark Thomas (Tomcat committer), [*Tomcat memory leak prevention*](https://cwiki.apache.org/confluence/display/TOMCAT/MemoryLeakProtection) — каноническая статья.

---

## 8. ServiceLoader — SPI mechanism

`java.util.ServiceLoader` — стандартный механизм plugin-discovery. Используется внутри JDK и большинством фреймворков:

```java
ServiceLoader<JsonProvider> loaders = ServiceLoader.load(JsonProvider.class);
for (JsonProvider p : loaders) { /* use */ }
```

**Pre-JPMS механизм**: в каждом jar лежит файл `META-INF/services/com.example.JsonProvider` со списком реализаций (по одной FQN на строку):

```
com.example.jackson.JacksonJsonProvider
com.example.gson.GsonJsonProvider
```

`ServiceLoader.load(X)` читает все такие файлы на classpath и инстанциирует.

**JPMS механизм**: в `module-info.java`:
```java
module my.api {
    uses com.example.JsonProvider;
}

module my.impl {
    provides com.example.JsonProvider with my.impl.MyProvider;
}
```

Без `META-INF/services/`, но семантика та же.

Использования внутри JDK:
- `java.sql.Driver` (JDBC drivers);
- `java.nio.charset.spi.CharsetProvider`;
- `java.util.spi.LocaleNameProvider`;
- `javax.tools.ToolProvider` (`javac`, `javap` доступны программно через ServiceLoader);
- `java.net.spi.URLStreamHandlerProvider`.

ServiceLoader использует **TCCL** (`Thread.currentThread().getContextClassLoader()`) по умолчанию — это часто причина «не находит implementation в OSGi» проблем. См. §10.

---

## 9. JPMS module layers

Java 9+ ввёл `java.lang.ModuleLayer` — набор модулей с associated CL. Layers формируют **DAG** (не дерево!): boot layer (JVM-загруженный) + child layers (user-defined).

```java
ModuleFinder finder = ModuleFinder.of(Paths.get("plugins"));
Configuration cfg = ModuleLayer.boot().configuration()
    .resolve(finder, ModuleFinder.of(), Set.of("plugin.a", "plugin.b"));
ModuleLayer layer = ModuleLayer.boot()
    .defineModulesWithOneLoader(cfg, ClassLoader.getSystemClassLoader());
```

Используется фреймворками для plugin-architecture с изоляцией:
- Spring 6+ с native compilation;
- Apache NetBeans Platform;
- Pf4j;
- jlink-generated runtime images.

Подробности про JPMS как таковой — [`JPMS_MODULES.md`](JPMS_MODULES.md).

---

## 10. Thread Context ClassLoader (TCCL)

Каждый thread имеет `Thread.currentThread().getContextClassLoader()` — обычно AppClassLoader. Используется фреймворками, которые **сами загружены родительским CL**, но должны находить классы **child CL**.

Классический пример: `ServiceLoader.load(X)` в `java.sql.DriverManager`. DriverManager загружен Bootstrap CL. Но JDBC driver — в webapp lib, под WebappCL. Bootstrap CL не видит WebappCL. **Решение**: `DriverManager` использует TCCL — drivers ищутся через **thread context loader**, который webapp выставил в `WebappCL`.

Pattern:
```java
ClassLoader original = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(myWebappCL);
    // вызывать код, который под капотом делает ServiceLoader или Class.forName
} finally {
    Thread.currentThread().setContextClassLoader(original);
}
```

Сложности:
- TCCL **наследуется** дочерним thread (`Thread.inheritedAccessControlContext`);
- Shared thread pool сохраняет TCCL, который установил создавший pool — это снова источник CL leak.

Spring, EJB, Servlet containers устанавливают TCCL на каждый request — поэтому фреймворки работают.

---

## 11. Common pitfalls — что обязательно помнить

### 11.1. Diamond problem с CL

Library X загружена двумя CL. Class A (под CL₁) пытается передать объект класса X в Class B (под CL₂). `ClassCastException`. Решение — поднять library в parent CL или использовать interfaces (которые в parent).

### 11.2. `Class.forName` в библиотеке

Без явного `ClassLoader` аргумента используется CL вызывающего класса:
```java
Class.forName("com.user.Plugin")    // ищет в CL библиотеки, не пользователя
```

Если библиотека грузит plugin → нужно `Class.forName(name, true, Thread.currentThread().getContextClassLoader())`.

### 11.3. `<clinit>` упал — класс мёртв

После `ExceptionInInitializerError` класс помечен failed. Дальше всё — `NoClassDefFoundError`. Перезагрузить можно **только** через новый CL.

### 11.4. Reflection на static-поле триггерит init

```java
Field f = MyClass.class.getDeclaredField("counter");
f.getLong(null);   // триггерит <clinit>!
```

Если init дорогой, и ты «просто хочешь почитать описание» — используй `Class.forName(name, false, cl)` или ходи через `MethodHandle` без init.

---

## 12. Что обязательно знать на собесе

1. **Иерархия CL** (Bootstrap / Platform / App / Custom) и почему она нужна.
2. **Parent delegation** — что это, зачем, где нарушается (Tomcat, OSGi).
3. **`defineClass`** — что делает, где используется (custom CL, dynamic generation, lambda).
4. **`ClassNotFoundException` vs `NoClassDefFoundError`** — точная семантика.
5. **Class lifecycle** (loading → linking [verify/prepare/resolve] → initialization) и триггеры `<clinit>`.
6. **ClassLoader leak** — сценарий, главные виновники (Driver, ThreadLocal, MBean), диагностика через MAT.
7. **`ServiceLoader`** — как работает, разница pre-/post-JPMS.
8. **Hidden classes (JEP 371)** — для чего, кто использует.
9. **TCCL** — что такое, зачем нужен (ServiceLoader, JNDI, JDBC).
10. **Initialization-On-Demand Holder** — thread-safe singleton без synchronized, опирается на `<clinit>` гарантии.

---

## Related

- Metaspace и classloader leaks (где «живут» классы) → [`JVM_MEMORY_AREAS.md`](JVM_MEMORY_AREAS.md)
- JPMS, named modules, module-info → [`JPMS_MODULES.md`](JPMS_MODULES.md)
- `Class.forName`, `MethodHandle`, reflection cost → [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md)
- Hidden classes и LambdaMetafactory → [`BYTECODE_INVOKEDYNAMIC.md`](BYTECODE_INVOKEDYNAMIC.md)
- Spring DevTools hot reload (через restart CL) → [`modules/spring-frameworks/theory/SPRING_BOOT.md`](../../spring-frameworks/theory/SPRING_BOOT.md)

### Внешние ресурсы

- **JVMS §5: Loading, Linking, Initializing** — <https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-5.html>
- **Mark Thomas, Tomcat memory leaks** — <https://cwiki.apache.org/confluence/display/TOMCAT/MemoryLeakProtection>
- **Stuart Marks, Lifecycle of Classes** — <https://stuartmarks.wordpress.com/>
- **OpenJDK Hidden Classes JEP 371** — <https://openjdk.org/jeps/371>
- **Eclipse MAT — guide** — <https://eclipse.dev/mat/2.0.0/userguide/index.html>
