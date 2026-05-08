# CoroutineScope и CoroutineContext

> **Scope** — кто отвечает за жизнь корутины.
> **Context** — какой набор атрибутов (Job, Dispatcher, Name, Handler) она наследует.

---

## 1. `CoroutineContext` — что это

`CoroutineContext` — это **immutable** мап-подобная коллекция элементов, индексированных по типу.
Каждый элемент реализует `CoroutineContext.Element` и имеет уникальный `Key`.

Главные элементы:

| Элемент | Тип | Зачем |
|---------|-----|-------|
| `Job` | `Job` | Handle для отмены, родитель/дети |
| `ContinuationInterceptor` | обычно `CoroutineDispatcher` | На каком потоке запускать |
| `CoroutineName` | имя для отладки/логов | Видно в `Thread.currentThread().name` (если включено) |
| `CoroutineExceptionHandler` | `(ctx, throwable) -> Unit` | Обработка непойманных исключений (только для root корутин) |

### Композиция через `+`

```kotlin
val ctx = Dispatchers.IO + CoroutineName("loader") + Job()
```

`+` объединяет элементы; повторяющийся ключ перезаписывается (правый побеждает).
Получить элемент: `ctx[Job]`, `ctx[CoroutineName]`.
Удалить: `ctx.minusKey(Job.Key)`.

### Что наследуется при запуске дочерней корутины

Когда внутри корутины делаешь `launch { ... }`, дочерний контекст =
**родительский контекст** + **аргументы билдера** + **новый дочерний `Job`** (родитель — `Job` родительской корутины).

```kotlin
withContext(Dispatchers.Default + CoroutineName("parent")) {
    launch(CoroutineName("child")) {
        // ctx[CoroutineName] = "child"
        // ctx[ContinuationInterceptor] = Dispatchers.Default (унаследован)
        // ctx[Job].parent == внешний Job
    }
}
```

---

## 2. `CoroutineScope` — что это

`CoroutineScope` — это просто обёртка над `CoroutineContext`:

```kotlin
public interface CoroutineScope {
    public val coroutineContext: CoroutineContext
}
```

Билдеры `launch`/`async` определены как **extension** на `CoroutineScope`. Это нужно, чтобы у каждой корутины был **родитель** — нельзя случайно запустить unscoped корутину.

### Когда создавать свой scope

Каждый "владелец lifecycle" в приложении должен иметь свой scope:
- ViewModel → `viewModelScope` (Android)
- Service / use-case → собственный `CoroutineScope` с `Job()`
- HTTP handler → `coroutineScope { }` внутри обработчика
- Корневая main-логика → `runBlocking` или `coroutineScope`

Готовые scope:
- `GlobalScope` — `@DelicateCoroutinesApi`. Не имеет родителя, не отменяется. Использовать **очень осторожно**.
- `MainScope()` — `Dispatchers.Main + SupervisorJob()`. Для UI.
- `viewModelScope`, `lifecycleScope` — Android KTX.

---

## 3. Создание собственного scope для класса-владельца

Канонический паттерн: scope живёт столько, сколько живёт его владелец, и **отменяется** в `close()`.

```kotlin
class ReportService(
    parent: Job? = null,
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : AutoCloseable {

    private val scope = CoroutineScope(
        SupervisorJob(parent) + dispatcher + CoroutineName("ReportService")
    )

    fun submit(report: Report) {
        scope.launch {
            persist(report)
        }
    }

    override fun close() {
        scope.cancel()  // отменит ВСЕ дочерние корутины
    }
}
```

Ключевые решения:
1. **`SupervisorJob`** vs `Job` — `SupervisorJob` не отменяет родителя/братьев при ошибке одной корутины. Для "независимых" задач сервиса это правильно (см. `STRUCTURED_CONCURRENCY.md`).
2. **`Job(parent)`** — если хочешь, чтобы scope сервиса был дочерним к более внешнему scope (например, к scope приложения).
3. **Явный диспатчер** — упрощает тестирование (можно передать `TestDispatcher`).
4. **`CoroutineName`** — попадает в имя потока при `-Dkotlinx.coroutines.debug` или в логи через `Thread.currentThread().name`.

---

## 4. `coroutineContext` внутри корутины

Внутри `suspend fun` доступно top-level свойство `coroutineContext`:

```kotlin
suspend fun logCurrent() {
    val name = coroutineContext[CoroutineName]?.name ?: "anon"
    val isActive = coroutineContext[Job]?.isActive ?: false
    println("name=$name active=$isActive")
}
```

Это **не** магия — это extension property `kotlin.coroutines.coroutineContext`. Компилятор передаёт контекст через скрытый параметр `Continuation`.

---

## 5. Scope и lifecycle — частые ошибки

### 5.1 Scope как поле singleton'а без отмены

```kotlin
object Foo {
    val scope = CoroutineScope(Dispatchers.Default + Job())
}
```

Никто никогда не вызовет `scope.cancel()` → утечки при горячей перезагрузке (например, в Spring Boot DevTools, OSGi). Всегда привязывай scope к видимому жизненному циклу.

### 5.2 `runBlocking` внутри scope

```kotlin
scope.launch {
    runBlocking { someSuspendFn() }  // ❌ блокирует поток диспатчера
}
```

Просто вызови `someSuspendFn()` без `runBlocking`. Внутри `launch` уже корутинный контекст.

### 5.3 Создание `Job()` без передачи в scope

```kotlin
val job = Job()
launch { ... }      // ❌ этот launch никак не связан с job
```

Нужно: `CoroutineScope(job).launch { ... }` или `launch(job) { ... }` (но тогда `job` становится **родителем** новой корутины, и его дети не отменятся, пока он не отменён — нюанс).

### 5.4 Cancel scope ≠ cancel job, переданный в scope

```kotlin
val rootJob = Job()
val scope = CoroutineScope(rootJob)
scope.cancel()  // отменит scope; rootJob останется НЕ отменённым? зависит от того, как cancel реализован
```

`scope.cancel()` под капотом делает `coroutineContext[Job]?.cancel()` — то есть отменяет тот `Job`, который в контексте. Так что да, `rootJob` тоже будет отменён. Но если ты передал `Job()` неявно, важно понимать — отмена происходит на том `Job`, который сейчас **в контексте**.

---

## 6. Структурная зависимость родитель-ребёнок

Главное правило structured concurrency: **дочерний `Job` зависит от родительского**.

```kotlin
val parent = Job()
val child = Job(parent)

parent.cancel()
println(child.isCancelled)  // true
```

Поэтому при запуске `launch { ... }` внутри другой корутины:
- Родительский `Job` ждёт завершения дочернего перед своим завершением.
- Отмена родителя → отмена всех детей.
- **Исключение в ребёнке (не `CancellationException`) → отмена родителя и братьев** — кроме случая `SupervisorJob` (см. `STRUCTURED_CONCURRENCY.md`).

---

## 7. `EmptyCoroutineContext` и `+ EmptyCoroutineContext`

`EmptyCoroutineContext` — нейтральный элемент. `ctx + EmptyCoroutineContext == ctx`. Используется как default-значение.

---

## Шпаргалка

```kotlin
// Контекст = набор элементов
val ctx = Dispatchers.IO + CoroutineName("worker") + Job()

// Получить элемент
ctx[Job]
ctx[CoroutineDispatcher]

// Scope для класса-владельца
class Service : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    override fun close() = scope.cancel()
}

// Доступ изнутри корутины
suspend fun whoAmI() {
    val name = coroutineContext[CoroutineName]?.name
}
```

---

## Источники

- [kotlinlang.org/docs/coroutine-context-and-dispatchers.html](https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html)
- KEEP-176, секция "CoroutineScope and CoroutineContext"
- Roman Elizarov, "Coroutine context and scope" — Medium
