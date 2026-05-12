# Cancellation & Exceptions

> Отмена в корутинах — **кооперативная**: корутина проверяет, не отменили ли её, и сама прерывается на suspension point.
> Исключения распространяются вверх по иерархии (`Job` parent), но `CancellationException` — особенный.

---

## 1. Кооперативная отмена

Корутина **не вытесняется** планировщиком — она должна сама проверить флаг отмены. Все стандартные suspend-функции (`delay`, `withContext`, `await`, `Channel.send/receive`) делают это автоматически: при отмене бросают `CancellationException`.

```kotlin
val job = launch {
    repeat(1000) {
        delay(100)             // <- здесь будет проверка отмены
        println("tick $it")
    }
}
delay(350)
job.cancelAndJoin()            // напечатает 3 раза, потом отменит
```

### CPU-bound корутина может НЕ отмениться

```kotlin
val job = launch(Dispatchers.Default) {
    var i = 0
    while (i < Int.MAX_VALUE) i++   // нет suspension points!
}
job.cancelAndJoin()  // зависнет — в цикле никто не проверяет cancel
```

Чтобы исправить, добавь **явные** проверки:

| Способ | Поведение |
|--------|-----------|
| `ensureActive()` | бросает `CancellationException`, если отменена |
| `if (!isActive) return` | мягкий выход без исключения |
| `yield()` | даёт шанс другим корутинам, проверяет отмену |

```kotlin
val job = launch(Dispatchers.Default) {
    var i = 0
    while (i < Int.MAX_VALUE) {
        ensureActive()    // или yield()
        i++
    }
}
```

---

## 2. `CancellationException` — особенный

`CancellationException` — это **нормальный способ завершения** отменённой корутины. Поэтому:

1. **`coroutineScope`** не считает `CancellationException` сбоем — не отменяет братьев.
2. **`CoroutineExceptionHandler`** не вызывается.
3. **`Job.cancel(cause)`** под капотом бросает `CancellationException(cause)`.

```kotlin
launch {
    try {
        delay(1000)
    } catch (e: CancellationException) {
        // важно: ПРОБРОСЬ дальше
        throw e
    }
}
```

### Анти-паттерн: проглатывание

```kotlin
launch {
    try {
        delay(1000)
    } catch (e: Exception) {   // ❌ ловит и CancellationException
        log(e)
    }
    longTask()  // продолжит после отмены!
}
```

Правильно:
```kotlin
try {
    delay(1000)
} catch (e: CancellationException) {
    throw e          // обязательно пробросить
} catch (e: Exception) {
    log(e)
}
```

Или используй `runCatching`-аналог:
```kotlin
try {
    risky()
} catch (e: Exception) {
    if (e is CancellationException) throw e
    log(e)
}
```

---

## 3. Cleanup в `finally` — `withContext(NonCancellable)`

После `cancel()` корутина больше **не может** выполнять suspend-операции — они сразу бросят `CancellationException`. Если в `finally` нужно сделать что-то suspend (закрыть соединение, отправить итоговую метрику):

```kotlin
launch {
    try {
        doWork()
    } finally {
        withContext(NonCancellable) {
            // здесь можно безопасно делать suspend-вызовы
            connection.closeAsync()
            metrics.flushAsync()
        }
    }
}
```

`NonCancellable` — это `Job`, который игнорирует отмену. Используй **только** в `finally`-блоках для cleanup.

---

## 4. `withTimeout` и `withTimeoutOrNull`

```kotlin
val result = withTimeout(1000) {
    fetchData()
}
```

- `withTimeout` бросает `TimeoutCancellationException` (наследник `CancellationException`).
- `withTimeoutOrNull` возвращает `null` при таймауте.

**Важно:** при таймауте корутина внутри блока отменяется. Все правила кооперативной отмены применимы.

```kotlin
val data = withTimeoutOrNull(500) {
    delay(1000)
    "result"
} ?: "timeout"
```

### Атомарность относительно ресурса

Если ты захватил ресурс **внутри** `withTimeout`, а таймаут наступил **после** захвата, но **до** возврата результата — ресурс может утечь. Решение:

```kotlin
withTimeoutOrNull(500) {
    val resource = acquire()
    try {
        useResource(resource)
    } finally {
        withContext(NonCancellable) { resource.release() }
    }
}
```

---

## 5. Распространение исключений (не `CancellationException`)

### С `Job` (default)

```kotlin
coroutineScope {
    launch { throw RuntimeException("boom") }  // (1)
    launch { delay(1000); println("never") }   // (2)
}
```

1. (1) бросает.
2. Родитель (`coroutineScope`) видит fail → отменяет (2).
3. (2) бросит `CancellationException` на ближайшей suspension.
4. `coroutineScope` пробросит `RuntimeException("boom")` наружу.

### С `SupervisorJob`

```kotlin
supervisorScope {
    launch { throw RuntimeException("boom") }  // упадёт изолированно
    launch { delay(1000); println("hello") }   // выполнится
}
```

`supervisorScope` гасит восходящее распространение. Брат не отменяется.

---

## 6. `CoroutineExceptionHandler`

Обработчик непойманных исключений для **корневых** корутин.

```kotlin
val handler = CoroutineExceptionHandler { _, e ->
    log.error("Unhandled in coroutine", e)
}

val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + handler)
scope.launch { throw IOException("x") }       // попадёт в handler
```

Правила:
- Применяется к **корневой** корутине scope (`launch` напрямую от scope).
- **Не вызывается** для `async` — у `Deferred` исключение хранится до `await()`.
- **Не вызывается** для `CancellationException`.
- Внутри `coroutineScope { launch { ... } }` обработчик вложенной `launch` **не сработает** — исключение пробросится через `coroutineScope`.

### `async` и исключения

```kotlin
val deferred = scope.async { throw IOException("x") }
// исключение НЕ выброшено и НЕ попадёт в handler — оно ждёт await()
val result = deferred.await()  // <- здесь IOException
```

Но при этом! Если `async` запускается внутри `coroutineScope`, исключение всё равно отменит scope, потому что родитель видит fail дочернего Job. Это нюанс: `async` не *собственноручно* выбрасывает, но fail дочернего Job всё равно ломает структуру.

В `supervisorScope` `async` сохраняет исключение **только** до `await()`, не отменяет scope.

---

## 7. `Job.invokeOnCompletion`

Колбэк на завершение, в т.ч. при отмене:

```kotlin
val job = scope.launch { ... }
job.invokeOnCompletion { cause ->
    // cause: null = успешно, CancellationException = отмена, другое = ошибка
    cleanup()
}
```

Удобно для очистки ресурсов снаружи корутины. Колбэк вызывается синхронно в потоке, который завершил Job.

---

## 8. `runCatching` и корутины

`runCatching` ловит **всё**, включая `CancellationException`. В корутинах это опасно:

```kotlin
// ❌ проглотит CancellationException
val res = runCatching { delay(1000) }
```

Используй явный `try/catch` с пробросом `CancellationException` или специальный extension (некоторые проекты определяют `coRunCatching`).

С Kotlin 1.7+ можно использовать паттерн:
```kotlin
suspend inline fun <R> coRunCatching(block: () -> R): Result<R> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: Throwable) {
    Result.failure(e)
}
```

---

## 9. Сравнительная таблица

| Сценарий | Что происходит |
|----------|---------------|
| `job.cancel()` | Job переходит в Cancelling, дети отменяются, suspend бросают `CancellationException` |
| Кидаем `RuntimeException` в дочерней `launch` | Родительский Job отменён, братья отменены, исключение наружу |
| Кидаем `RuntimeException` в `async`, нет `await()` | Исключение хранится в `Deferred`; родитель отменяется (если не `SupervisorJob`) |
| `withTimeout` истёк | Тело отменяется, бросается `TimeoutCancellationException` |
| `try/catch (CancellationException)` без throw | **Анти-паттерн**, ломает cancellation |
| Нет suspension в CPU-loop | Отмена не работает; нужен `ensureActive()` / `yield()` |

---

## Шпаргалка

```kotlin
// Кооперативная отмена в CPU-loop
while (running) {
    ensureActive()           // или yield()
    crunch()
}

// Cleanup после отмены
try { work() }
finally {
    withContext(NonCancellable) {
        closeAsync()
    }
}

// Таймаут
withTimeoutOrNull(1000) { fetch() } ?: default

// Никогда: try/catch (Exception) без throw CancellationException
try { ... } catch (e: Exception) {
    if (e is CancellationException) throw e
    log(e)
}
```

---

## Источники

**Официальная документация:**
- [Cancellation and Timeouts](https://kotlinlang.org/docs/cancellation-and-timeouts.html) — кооперативная отмена, `withTimeout`, `NonCancellable`.
- [Exception Handling and Supervision](https://kotlinlang.org/docs/exception-handling.html) — `CoroutineExceptionHandler`, propagation, supervisor scope.

**Posts (must-read):**
- [Roman Elizarov — «The reason to avoid GlobalScope»](https://elizarov.medium.com/the-reason-to-avoid-globalscope-835337445abc) — почему отмена связана с lifecycle scope, и как `GlobalScope` это ломает.
- [Manuel Vivo — «Cancellation in coroutines» (Android Devs)](https://medium.com/androiddevelopers/cancellation-in-coroutines-aa6b90163629) — пошаговый разбор cooperative cancellation с примерами.
- [Manuel Vivo — «Exceptions in coroutines»](https://medium.com/androiddevelopers/exceptions-in-coroutines-ce8da1ec060c) — propagation, parent-child, `try/catch` гочи.
- [Joffrey Bion — «Cancellation in Kotlin coroutines»](https://jbion.dev/blog/2021/04/02/cancellation-in-kotlin-coroutines/) — глубокий разбор `ensureActive` vs `yield`.

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Moskała)](https://kt.academy/book/coroutines) — главы 7–9 (cancellation, exception handling).
