# JPMS — Java Platform Module System

---

## 1. Откуда взялся JPMS и что он чинит

К середине 2000-х Java accumulated three fundamental issues:

### 1.1. JAR hell

Classpath — flat list jars. При duplicate FQN победит **первый** jar в classpath. Никакого предсказуемого порядка, никакой версии. Типичный сценарий:

```
classpath:
  /libs/jackson-databind-2.10.jar     # старая версия от dependency A
  /libs/jackson-databind-2.15.jar     # новая от dependency B
```

Какая версия загрузится — implementation-dependent. Maven дедуплицирует через `dependencyManagement`, но это **build-time fix**. В runtime — никакой защиты. Один OS classpath order — и production падает с `NoSuchMethodError`.

### 1.2. Слабая encapsulation

`public` в Java 8 означало «видно всем».

```java
package sun.misc;
public class Unsafe { ... }
```

`Unsafe` был помечен как «internal» через package name (`sun.*`), но **технически** не защищён. Сотни библиотек (Netty, Cassandra, Aeron) использовали Unsafe, потому что **могли**. Это создало **дефакто** public API, который Oracle не мог переделать без breakage всей экосистемы.

### 1.3. Нет explicit dependencies

`module-info` отсутствовал. JVM понятия не имела, что `app` зависит от `lib-x`. classpath был просто bag of jars. Нельзя `jlink` минимальный runtime, нельзя static analysis на зависимости, нельзя contract-based design.

### 1.4. Project Jigsaw

В **2008** году Sun начал project Jigsaw — proposal для modular Java. Шесть JEPs прошли через два failed releases (Java 7, Java 8) — каждый раз отложено из-за compatibility concerns. **Java 9 (2017)** наконец-то релизнул JPMS — но **без полного breakage**: classpath остался, и старые приложения работают как unnamed modules.

> Mark Reinhold (chief architect of JVM), [*Project Jigsaw: Module System Quick-Start Guide*](https://openjdk.org/projects/jigsaw/quick-start). [JEP 261: Module System](https://openjdk.org/jeps/261).

---

## 2. `module-info.java` — декларация модуля

Файл в корне модуля (рядом с пакетами):

```java
module com.example.app {
    requires java.sql;
    requires transitive java.logging;
    requires static org.junit.jupiter.api;
    requires com.fasterxml.jackson.databind;

    exports com.example.app.api;
    exports com.example.app.spi to com.example.plugin;

    opens com.example.app.dto;
    opens com.example.app.internal to com.fasterxml.jackson.databind;

    uses com.example.app.spi.Plugin;
    provides com.example.app.spi.Plugin with com.example.app.impl.PluginA;
}
```

Это **первый class file** (`module-info.class`), который JVM смотрит при загрузке модуля.

### 2.1. Директивы

| Директива | Что делает |
|---|---|
| `requires X` | Зависит от модуля X; код X виден |
| `requires transitive X` | Кто зависит от нас, автоматически зависит от X (re-export) |
| `requires static X` | Compile-time зависимость; в runtime optional |
| `exports pkg` | Public types в `pkg` доступны всем модулям |
| `exports pkg to A, B` | Qualified export — только модулям A, B |
| `opens pkg` | Runtime reflection allowed |
| `opens pkg to A` | Qualified opens — reflection allowed только из A |
| `uses ServiceInterface` | `ServiceLoader` найдёт implementations |
| `provides ServiceInterface with ImplA, ImplB` | Мы предоставляем реализацию |

### 2.2. `exports` vs `opens` — критическая разница

| | Compile-time | Reflection |
|---|---|---|
| `exports` | yes (public types видны) | **no** |
| `opens` | no (нельзя `import`) | **yes** (deep, к private) |

Это **разные** axes encapsulation. Можешь exports пакет, но не opens — другие модули могут использовать public API, но не reflection. Это базовая защита от Jackson/Hibernate, лезущих в private поля.

Если хочешь и compile-time и reflection — нужно **обе** директивы.

`open module` — short form, открывает **все** пакеты для reflection:
```java
open module com.example.app {
    requires foo;
    // НЕТ opens, но все пакеты открыты для reflection
}
```

### 2.3. `requires transitive` — re-exporting API

Без `transitive`: модуль использует X внутри, но клиенты модуля **не получают X** автоматически. Пример: `com.example.web` использует `java.sql.Connection` внутри метода, но возвращает только `String` — `java.sql` is implementation detail.

С `transitive`: клиенты получают X автоматически. Используется, когда **API модуля включает** типы из X.

```java
module com.example.web {
    requires transitive java.sql;   // потому что Repository.find() возвращает Connection
}
```

### 2.4. `requires static` — optional dependency

Compile-time-only зависимость. В runtime модуль **необязателен** — `requires static X` пройдёт без ошибки, если X отсутствует.

Use case: optional integrations.

```java
module my.lib {
    requires static spring.context;   // полезно если Spring есть, иначе работаем без него
}
```

В коде нужно `try`-catch на `ClassNotFoundException` или подобное.

---

## 3. Strong encapsulation

В named module **только `exports`-пакеты видны снаружи**. Без `exports`:
- **Compile error** при `import com.example.internal.X`;
- **Runtime `IllegalAccessError`** при reflection без `--add-opens`.

`public class` без `exports`-пакета = всё равно недоступен извне. Это **сильнее**, чем старый `public` модификатор.

### 3.1. Внутренние JDK packages

Прямое следствие: `sun.*`, `com.sun.*`, `jdk.internal.*` **не exports**. Доступ к `Unsafe` теперь требует:

```
--add-opens java.base/jdk.internal.misc=ALL-UNNAMED
```

Эволюция строгости:
- **Java 9–15**: warning при illegal reflective access, allow по умолчанию;
- **Java 16+** ([JEP 396](https://openjdk.org/jeps/396)): warning превращается в error (default deny);
- **Java 17+**: окончательно strong, no escape hatch кроме `--add-opens`.

Что сломалось:
- **Lombok** — модифицирует AST через internal compiler APIs;
- **Mockito** — bytecode generation с deep reflection;
- **JRebel, HotswapAgent** — hot reload через class redefinition;
- **CGLIB, javassist** — bytecode generation;
- **Spring** — частично, в `ReflectionUtils.setField`.

Все либо обновились с поддержкой JPMS, либо требуют `--add-opens` flags.

### 3.2. Аргумент против JPMS

Эта строгость сделала миграцию **больно** для крупных enterprise apps. Многие проекты **остались на classpath** (даже на Java 21), используя JPMS только для:
- внутренние библиотеки с jlink;
- compact distributions;
- native compilation (GraalVM Native Image, который требует чёткий граф).

---

## 4. Named, automatic, unnamed modules

Главная элегантность JPMS — **возможность смешивания** старого и нового кода. Три типа модулей:

| Тип | Источник | Поведение |
|---|---|---|
| **Named module** | jar с `module-info.class` | Full JPMS semantics: encapsulation, declared deps |
| **Automatic module** | обычный jar на module path; имя из `META-INF/MANIFEST.MF` `Automatic-Module-Name` или из имени файла | `requires <name>` работает; всё открыто (как unnamed для exports/opens) |
| **Unnamed module** | обычный jar на **classpath** | Один глобальный «unnamed» module; видит **все** named, но **не наоборот** |

### 4.1. Automatic module name

Если в `META-INF/MANIFEST.MF`:
```
Automatic-Module-Name: org.apache.commons.lang3
```

— это становится именем automatic module. Этот атрибут — public API библиотеки на JPMS-side. Авторы либ обычно добавляют его **раньше**, чем полноценный `module-info`, как первый шаг миграции.

Если нет атрибута — имя выводится из jar-имени по правилу: убрать `-version.jar`, заменить `-` на `.`:
```
spring-core-6.0.5.jar  →  spring.core
```

### 4.2. Split package — запрещено

Два модуля экспортируют **одинаковое имя пакета** — JPMS падает на старте:
```
java.lang.LayerInstantiationException: 
  Package com.foo in both module a.b and module c.d
```

Это раздражение при миграции: либо переименуй пакет, либо merge два jar'а в один. До JPMS classpath спокойно жил с split packages (один пакет в разных jar'ах) — теперь нельзя.

---

## 5. Module path vs classpath

```bash
javac --module-path libs/ -d out --module-source-path src/ --module com.example.app
java  --module-path libs/:out -m com.example.app/com.example.app.Main
```

- **classpath** (`-cp`) — legacy flat list;
- **module path** (`-p`, `--module-path`) — JPMS-aware; ищет `module-info` в каждом jar/dir.

Mixed:
```bash
java -p libs/named-modules -cp legacy-jars/ -m my.app/com.foo.Main
```

Все jars на classpath объединяются в один **unnamed module**. Все jars на module path — отдельные modules (named или automatic).

Правила видимости:
- Named module видит: explicit `requires` + Java SE (если `requires java.base`, которое implicit).
- Automatic module видит: **всё** named + всё automatic + классы unnamed module (через classpath).
- Unnamed module видит: всё named (через unnamed reads all).
- **Named НЕ видит unnamed** — это правило защищает строгость JPMS от случайного использования classpath-кода.

Это правило ломает миграцию: если твоя legacy lib не имеет `Automatic-Module-Name`, и ты пытаешься её использовать в named module — нужно либо положить её на module path (станет automatic), либо переименовать.

---

## 6. `jlink` — minimal runtime image

Главное **практическое** преимущество JPMS. Создаёт **standalone JRE** с только нужными модулями:

```bash
jlink \
    --module-path $JAVA_HOME/jmods:libs/ \
    --add-modules com.example.app \
    --output dist/myapp \
    --launcher run=com.example.app/com.example.app.Main \
    --compress=2 \
    --no-header-files \
    --no-man-pages \
    --strip-debug
```

Результат: `dist/myapp/bin/run` — standalone executable, `dist/myapp/lib/modules` — все нужные JDK modules.

Размер:
- Полный JDK 21: ~310 MB;
- jlink image для backend service: 40–80 MB;
- jlink image для CLI tool: 25–40 MB.

Use cases:
- **Docker image size** — `FROM gcr.io/distroless/java-base` + minimal jlink runtime = ~80 MB container, vs ~250 MB с full JDK;
- **Embedded** — JVM на ARM, Raspberry Pi;
- **Pre-GraalVM-NativeImage** альтернатива для compact distribution.

> Inside Java, [*Making Smaller Application with jlink*](https://inside.java/2023/06/06/jlink-applications/).

---

## 7. `jdeps` — анализ зависимостей

```bash
jdeps --module-path libs -s my.jar
jdeps --generate-module-info out/ my.jar    # генерирует skeleton module-info
jdeps --jdk-internals my.jar                # ищет использование jdk.internal.*
jdeps --print-module-deps my.jar            # для jlink
```

Полезно для миграции на JPMS:
- понять, какие модули нужны;
- что использует `jdk.internal` (это нужно будет добавить через `--add-opens`);
- сгенерировать starter `module-info`.

---

## 8. ModuleLayer и dynamic module loading

`java.lang.ModuleLayer` — runtime API для динамического создания module graph. Layers формируют **DAG** (не дерево!): boot layer (JVM-loaded) + child layers (user-defined).

```java
ModuleFinder finder = ModuleFinder.of(Paths.get("plugins"));
Configuration cfg = ModuleLayer.boot().configuration()
    .resolve(finder, ModuleFinder.of(), Set.of("plugin.a", "plugin.b"));
ModuleLayer layer = ModuleLayer.boot()
    .defineModulesWithOneLoader(cfg, ClassLoader.getSystemClassLoader());

Module pluginModule = layer.findModule("plugin.a").orElseThrow();
Class<?> pluginMain = layer.findLoader("plugin.a").loadClass("plugin.a.Main");
```

Используется фреймворками для plugin-architecture с изоляцией:
- **Spring 6+** в native compilation modes;
- **Pf4j** (pure plugin framework);
- **Apache NetBeans Platform**;
- **JOSM**, **Eclipse Equinox** через interop.

ModuleLayer'ы могут share классы между собой (через `requires`), но **не имеют доступа** к другим layers без explicit `addReads`. Это позволяет изолировать pluginsv с разными версиями зависимостей.

---

## 9. Миграция на JPMS

Два общих подхода:

### 9.1. Bottom-up (от листьев)

Добавляешь `module-info` в **leaf-библиотеки** сначала. Зависимые остаются как automatic modules. Постепенно вверх.

Хорошо для: библиотек с публичным API (Apache Commons, Guava, Jackson).

### 9.2. Top-down (от корня)

Своему приложению добавляешь `module-info`. Обычные jars живут как automatic. Дальше — постепенный подсчёт по зависимостям.

Хорошо для: enterprise applications с большим объёмом legacy.

**Большинство экосистемы выбрала bottom-up.** Spring 6 поддерживает оба режима, явно публикует `Automatic-Module-Name` в manifests. Hibernate, Jackson, Apache Commons — то же самое.

---

## 10. JPMS на практике: за и против

**За:**
- настоящая модульность (можно скрыть internal без обхода через package naming);
- быстрее старт (`java.base` всегда есть, JVM знает граф);
- `jlink` для compact runtime — реальный win для production;
- `jpackage` для native installers (с Java 14+);
- обязательное условие для GraalVM Native Image качества.

**Против:**
- compatibility cost для библиотек (reflection breakage в 16+);
- большинство проектов уже использует Maven/Gradle, где модульность на уровне сборки;
- `module-info` boilerplate с дублированием Maven-зависимостей;
- старые либы (Apache Commons долго принимали JPMS).

Реальность 2025 года: **JPMS — это infrastructure для compact distribution и native image, а не повседневный tool для большинства Java-приложений**. Многие проекты остаются на classpath, и это нормально.

---

## 11. Что обязательно знать на собесе

1. **`requires` / `exports` / `opens`** — точная семантика, разница между exports и opens.
2. **`requires transitive`** — зачем нужно (re-export для API типов).
3. **`requires static`** — optional compile-time dependency.
4. **Named / automatic / unnamed module** — три типа, миграционный path.
5. **Strong encapsulation в 16+** — что сломалось (Lombok, Mockito), решения через `--add-opens`.
6. **Split package — запрещено** — типичная боль при миграции.
7. **`jlink`** — для compact runtime images, реальный win для Docker.
8. **`jdeps`** — анализ зависимостей при миграции.
9. **ModuleLayer** — runtime API для plugin systems.
10. **`Automatic-Module-Name` в MANIFEST.MF** — первый шаг библиотеки в сторону JPMS.

---

## Related

- ClassLoaders и `ModuleLayer` → [`CLASS_LOADERS.md`](CLASS_LOADERS.md)
- Reflection и `--add-opens` → [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md)
- `jlink` и distroless images → [`modules/infrastructure/theory/DOCKER.md`](../../infrastructure/theory/DOCKER.md)
- GraalVM Native Image (требует чёткий module graph) → [`JIT_COMPILATION.md`](JIT_COMPILATION.md)

### Внешние ресурсы

- **Project Jigsaw**: <https://openjdk.org/projects/jigsaw/>
- **Mark Reinhold, *Module System Quick-Start*** — <https://openjdk.org/projects/jigsaw/quick-start>
- **State of the Module System** — <https://openjdk.org/projects/jigsaw/spec/sotms/>
- **JEP 261 (Module System)** — <https://openjdk.org/jeps/261>
- **JEP 396 (Strongly Encapsulate)** — <https://openjdk.org/jeps/396>
- **Inside Java — JPMS tag**: <https://inside.java/tag/jpms/>
- **Nicolai Parlog (nipafx) *Code-First Java 9 Module System Tutorial***: <https://nipafx.dev/java-modules-tutorial/>
- **jdeps documentation**: <https://docs.oracle.com/en/java/javase/21/docs/specs/man/jdeps.html>
