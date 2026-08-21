# CoroutineScope и CoroutineContext

> **Какую проблему решают.** Контекст отвечает на вопрос «с какими настройками выполняется эта
> корутина» (где возобновлять, как называется, кто родитель); scope — на вопрос «кто отвечает за её
> жизнь и кто её отменит».
> **Кому это надо.** Тому, кто заводит фоновые задачи в сервисе, ловит утечки корутин, теряет MDC
> после первой приостановки или не понимает, почему `withContext(Dispatchers.IO)` вообще работает.
> **Когда НЕ надо.** Если весь код — это `suspend fun`, вызываемые из контроллера, контекст можно
> не трогать: фреймворк создаст его сам.

---

## 1. Контекст — это `Map`?

Почти. Вот что говорит KDoc самого интерфейса в `kotlin-stdlib`:

> *Persistent context for the coroutine. It is an **indexed set** of `Element` instances.
> An indexed set is **a mix between a set and a map**. Every element in this set has a unique `Key`.*

Разберём, чем он похож на map и чем нет.

### Похоже на map

Весь интерфейс — четыре метода, и все они «мапные»:

```kotlin
public interface CoroutineContext {
    public operator fun <E : Element> get(key: Key<E>): E?
    public fun <R> fold(initial: R, operation: (R, Element) -> R): R
    public operator fun plus(context: CoroutineContext): CoroutineContext
    public fun minusKey(key: Key<*>): CoroutineContext
}
```

```kotlin
val ctx = Dispatchers.IO + CoroutineName("import") + SupervisorJob()

ctx[CoroutineName]              // CoroutineName(import)
ctx[Job]                        // JobImpl
ctx.minusKey(CoroutineName)     // контекст без имени
ctx.fold(0) { acc, _ -> acc + 1 }   // сколько элементов
```

Он **иммутабельный** («persistent»): `plus` и `minusKey` не меняют исходный контекст, а возвращают
новый. Поэтому контекст можно безопасно шарить между корутинами.

Оператор `+` — **не объединение, а перезапись по ключу**: правый операнд побеждает.

### Но это не `Map`

Три отличия, которые и делают конструкцию удобной:

**1. Ключ типизирован.** `Key<E : Element>` параметризован типом своего элемента, поэтому `get`
возвращает точный тип, а не `Any?`:

```kotlin
val job: Job? = ctx[Job]                    // Job?, без приведения типов
val name: CoroutineName? = ctx[CoroutineName]
```

В `Map<Any, Any>` пришлось бы писать `ctx[JobKey] as Job?`.

**2. Каждый элемент сам является контекстом.**

```kotlin
public interface Element : CoroutineContext {
    public val key: Key<*>
}
```

`Dispatchers.IO` — это одновременно и диспетчер, и полноценный контекст из одного элемента. Поэтому
`Dispatchers.IO + CoroutineName("x")` — это сложение **двух контекстов**, а не «положить два значения
в мапу». Отсюда же берётся `EmptyCoroutineContext` — нейтральный элемент: `ctx + EmptyCoroutineContext`
возвращает тот же самый `ctx` (в `plus` для этого есть явный fast path). Контекст ведёт себя как
моноид, и именно поэтому наследование контекста — это просто сложение.

**3. Реализация — односвязный список, а не хеш-таблица.** Когда элементов больше одного, `plus`
строит цепочку:

```kotlin
internal class CombinedContext(
    private val left: CoroutineContext,
    private val element: Element,
) : CoroutineContext { … }
```

`get` идёт по цепочке циклом, сравнивая ключи. Почему не `HashMap`: в реальном контексте 2–5
элементов, и для таких размеров список дешевле и по памяти, и по времени — нет хеширования и нет
таблицы.

### Трюк, который многое объясняет

Внутри `plus` в stdlib есть специальная обработка одного ключа:

```kotlin
// make sure interceptor is always last in the context (and thus is fast to get when present)
val interceptor = removed[ContinuationInterceptor]
```

Перехватчик продолжений (то есть диспетчер) при сложении всегда переставляется **в конец цепочки**,
потому что его достают чаще всего: при **каждом** возобновлении корутины. Это прямая связь с
механикой из [`SUSPEND_INTERNALS.md`](SUSPEND_INTERNALS.md) §4: диспетчер — не абстрактная
«настройка», а тот элемент, к которому библиотека обращается на горячем пути.

---

## 2. Из чего состоит контекст

| Элемент | Ключ | За что отвечает |
|---------|------|-----------------|
| `Job` | `Job` | жизненный цикл, отмена, связь родитель–ребёнок |
| `CoroutineDispatcher` | `ContinuationInterceptor` | **где** возобновлять продолжения |
| `CoroutineName` | `CoroutineName` | имя в логах и стектрейсах при `-Dkotlinx.coroutines.debug` |
| `CoroutineExceptionHandler` | `CoroutineExceptionHandler` | последний рубеж для необработанных ошибок корневых корутин |
| свой `ThreadContextElement` | свой | MDC, `ThreadLocal`, трассировка (§6) |

Ключом обычно служит companion-объект самого типа — поэтому и получается лаконичное `ctx[Job]`.

---

## 3. Как контекст попадает в корутину

Контекст новой корутины собирается по формуле:

```
контекст ребёнка = контекст родителя + аргументы билдера + новый Job (дочерний к родительскому)
```

```kotlin
withContext(Dispatchers.Default + CoroutineName("parent")) {
    launch(CoroutineName("child")) {
        // ContinuationInterceptor = Dispatchers.Default  ← унаследован
        // CoroutineName            = "child"             ← перезаписан аргументом
        // Job                      = новый, его parent — Job внешней корутины
    }
}
```

### Почему наследуется всё, кроме `Job`

Это не произвольное правило, его можно вывести. Представим, что `Job` наследовался бы как обычный
элемент — то есть ребёнок получал бы **тот же самый** `Job`, что и родитель. Тогда:

- отмена ребёнка отменяла бы родителя (это один и тот же объект);
- родитель не мог бы «дождаться детей» — детей как отдельных сущностей просто не существовало бы;
- дерева корутин не было бы, а значит, не было бы и структурной конкурентности.

Поэтому `Job` — единственный элемент, который при запуске **создаётся заново** и связывается с
родительским. Всё остальное (диспетчер, имя, MDC) наследуется «даром», потому что это настройки, а
не идентичность.

Доступ к контексту изнутри:

```kotlin
suspend fun whoAmI() {
    val name = coroutineContext[CoroutineName]?.name ?: "anon"   // stdlib property
    val active = coroutineContext[Job]?.isActive ?: false
}
```

Это не магия: `kotlin.coroutines.coroutineContext` берёт контекст из скрытого параметра
`Continuation` (см. [`SUSPEND_INTERNALS.md`](SUSPEND_INTERNALS.md) §1). Внутри `flow { }` и других
мест, где `this` — не корутина, есть `currentCoroutineContext()`.

---

## 4. `CoroutineScope` — держатель контекста

```kotlin
public interface CoroutineScope {
    public val coroutineContext: CoroutineContext
}
```

Буквально одно свойство. Вся его значимость — в том, что билдеры `launch`/`async` объявлены как
extension-функции на `CoroutineScope`. Следствие: **нельзя случайно запустить корутину без
родителя** — её всегда кто-то держит и кто-то отменит.

Готовые scope:

| Scope | Что внутри | Когда |
|---|---|---|
| свой `CoroutineScope(...)` | что задали | компонент со своим жизненным циклом (§5) |
| `coroutineScope { }` | дочерний scope текущей корутины | локальная группа задач внутри suspend-функции |
| `MainScope()` | `Dispatchers.Main + SupervisorJob()` | UI-приложения |
| `viewModelScope`, `lifecycleScope` | Android KTX | Android |
| `GlobalScope` | ничего, без родителя | `@DelicateCoroutinesApi`; на бэкенде — почти всегда баг |

Разница между `CoroutineScope(...)` (конструктор долгоживущего scope) и `coroutineScope { }`
(suspend-функция, ждущая детей) разобрана в
[`STRUCTURED_CONCURRENCY.md`](STRUCTURED_CONCURRENCY.md).

---

## 5. Свой scope для класса-владельца

Канонический паттерн: scope живёт столько же, сколько его владелец, и отменяется в `close()`.

```kotlin
class ReportService(
    parent: Job? = null,
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : AutoCloseable {

    private val scope = CoroutineScope(
        SupervisorJob(parent) + dispatcher + CoroutineName("ReportService")
    )

    fun submit(report: Report) {
        scope.launch { persist(report) }
    }

    override fun close() {
        scope.cancel()   // отменит все дочерние корутины
    }
}
```

Каждое решение здесь осмысленно:

1. **`SupervisorJob`, а не `Job`** — падение одной фоновой задачи не должно убивать сервис вместе с
   остальными задачами (см. [`STRUCTURED_CONCURRENCY.md`](STRUCTURED_CONCURRENCY.md)).
2. **`SupervisorJob(parent)`** — если scope сервиса должен быть частью более крупного scope
   приложения и умирать вместе с ним.
3. **Диспетчер параметром** — иначе тест не сможет подставить `TestDispatcher` и превратится в тест
   с реальными задержками (см. [`TESTING_INTEROP.md`](TESTING_INTEROP.md)).
4. **`CoroutineName`** — бесплатная навигация в логах и дампах корутин.

Если нужно не просто «отменить», а дать текущим задачам доработать — это плавное завершение (graceful shutdown), разбор
в [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md), практика — упражнение
[Ex16](../src/main/kotlin/exercises/Ex16_GracefulShutdown.kt).

---

## 6. `ThreadLocal` в корутинах и `asContextElement`

Прямое следствие §1 и механики возобновления: корутина между приостановками может сменить поток, а
`ThreadLocal` привязан к потоку. Значит, обычный `ThreadLocal` (и построенный на нём MDC) **теряется
после первой приостановки**:

```kotlin
requestId.set("req-42")
delay(10)
requestId.get()   // может быть null: продолжились на другом потоке
```

Решение — сделать значение элементом контекста. Для этого есть `ThreadContextElement`: библиотека
выставляет значение в поток **при каждом возобновлении** и снимает при приостановке.

```kotlin
val requestId = ThreadLocal<String>()

withContext(requestId.asContextElement("req-42")) {
    delay(10)
    log.info("…")      // requestId на месте, на каком бы потоке ни продолжились
}
```

Для SLF4J MDC есть готовый элемент `MDCContext()` из артефакта `kotlinx-coroutines-slf4j`
(в `pom.xml` этого модуля он не подключён). Зачем это нужно на практике и что теряется без этого —
в [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md).

Самый дешёвый минимум, если тащить MDC не хочется: `CoroutineName("request-42")` — имя видно в
дампах корутин и в именах потоков в debug-режиме.

---

## 7. Частые ошибки

### 7.1 Scope как поле синглтона без отмены

```kotlin
object Foo {
    val scope = CoroutineScope(Dispatchers.Default + Job())   // ❌ никто не позовёт cancel()
}
```

Утечка проявится при горячей перезагрузке контекста (Spring DevTools) или при остановке компонента:
задачи переживут владельца. Правило: **у scope должен быть видимый жизненный цикл**.

### 7.2 `runBlocking` внутри корутины

```kotlin
scope.launch {
    runBlocking { someSuspendFn() }   // ❌ блокирует поток диспетчера
}
```

Внутри `launch` уже корутинный контекст — вызывайте `someSuspendFn()` напрямую.

### 7.3 `Job()`, который никуда не передали

```kotlin
val job = Job()
launch { … }        // ❌ этот launch никак не связан с job
```

Надо `CoroutineScope(job).launch { … }` либо `launch(job) { … }`. У второго варианта есть нюанс:
переданный `Job` становится **родителем** новой корутины, и такой `Job` не завершится сам — его
придётся отменять или завершать явно.

### 7.4 Что именно отменяет `scope.cancel()`

```kotlin
val rootJob = Job()
val scope = CoroutineScope(rootJob)
scope.cancel()
rootJob.isCancelled    // true
```

`scope.cancel()` — это `coroutineContext[Job]!!.cancel()`, то есть отменяется тот `Job`, который
лежит **в контексте scope**. Здесь это `rootJob`, поэтому он тоже отменён, и повторно использовать
его для нового scope нельзя: отменённый `Job` не «переоткрывается», и все корутины в новом scope
завершатся мгновенно. Если scope нужно пересоздавать, каждый раз создавайте новый `Job`.

### 7.5 `GlobalScope`

```kotlin
GlobalScope.launch { sendMetrics() }   // ❌
```

Нет родителя → никто не ждёт и никто не отменит; контекст не наследуется (ни диспетчер, ни имя, ни
MDC); исключения уходят в глобальный обработчик, а не туда, где вызвали. Замена — scope компонента
или `coroutineScope { }` внутри suspend-функции.

---

## 8. Родитель и ребёнок

```kotlin
val parent = Job()
val child = Job(parent)

parent.cancel()
child.isCancelled     // true
```

Из этой связи следуют три правила, которые целиком разбираются в
[`STRUCTURED_CONCURRENCY.md`](STRUCTURED_CONCURRENCY.md):

- родительский `Job` не завершится, пока не завершатся все дети;
- отмена родителя рекурсивно отменяет детей;
- необработанное исключение ребёнка (кроме `CancellationException`) отменяет родителя и его
  остальных детей — если только родитель не `SupervisorJob`.

Практика — упражнение [Ex02](../src/main/kotlin/exercises/Ex02_ScopeContext.kt).

---

## Шпаргалка

```kotlin
// Контекст = иммутабельный indexed set; «+» перезаписывает по ключу
val ctx = Dispatchers.IO + CoroutineName("worker") + SupervisorJob()
ctx[Job]                    // типизированный get, вернёт Job?
ctx.minusKey(CoroutineName)

// Scope для класса-владельца
class Service : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + CoroutineName("svc"))
    override fun close() = scope.cancel()
}

// ThreadLocal, переживающий приостановку
withContext(requestId.asContextElement("req-42")) { … }
```

- Контекст — не `Map`, а иммутабельный indexed set: типизированный ключ, элемент сам является
  контекстом, внутри односвязный список.
- Диспетчер (`ContinuationInterceptor`) всегда переставляется в конец цепочки — его читают чаще всех.
- Наследуется всё, кроме `Job`: иначе не было бы дерева и структурной конкурентности.
- `CoroutineScope` — это одно свойство; ценность в том, что билдеры — extension на него.
- У scope обязан быть видимый жизненный цикл и явный `cancel()`/`shutdown()`.
- `ThreadLocal` без `asContextElement` теряется после первой приостановки.

---

## Источники

**Исходники (по ним сверены §1 и §3):**
- `kotlin-stdlib` → `kotlin/coroutines/CoroutineContext.kt` (интерфейс, `plus`, KDoc про indexed set) и `kotlin/coroutines/CoroutineContextImpl.kt` (`CombinedContext`, `EmptyCoroutineContext`).

**Официальная документация:**
- [Coroutine Context and Dispatchers](https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html)
- [`CoroutineContext` (stdlib API)](https://kotlinlang.org/api/latest/jvm/stdlib/kotlin.coroutines/-coroutine-context/)
- [`CoroutineScope` API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-scope/)
- [`ThreadContextElement`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-thread-context-element/)

**Posts:**
- [Roman Elizarov — «Coroutine context and scope»](https://elizarov.medium.com/coroutine-context-and-scope-c8b255d59055) — канонический разбор ровно этой темы.
- [Roman Elizarov — «Structured Concurrency»](https://elizarov.medium.com/structured-concurrency-722d765aa952)

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Marcin Moskała)](https://kt.academy/book/coroutines) — главы «Coroutine context» и «Coroutine scope functions».
