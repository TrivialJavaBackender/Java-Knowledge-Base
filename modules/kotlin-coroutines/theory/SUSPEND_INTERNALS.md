# Suspend Internals — как работает CPS-трансформация

> Понимание того, как `suspend` функции компилируются в state-machine, помогает рассуждать о производительности, правильно мостить callback API и не паниковать при просмотре stack trace.

---

## 1. Continuation — главная абстракция

Из `kotlin.coroutines`:

```kotlin
public interface Continuation<in T> {
    public val context: CoroutineContext
    public fun resumeWith(result: Result<T>)
}
```

`Continuation<T>` — это **колбэк**: "когда suspend-операция завершится, вызови меня с результатом".

`Result<T>` — это `success(value)` или `failure(throwable)`. Поэтому в одном и том же `Continuation` рантайм возобновляет корутину как при успехе, так и при ошибке.

---

## 2. CPS-трансформация (Continuation-Passing Style)

Компилятор Kotlin превращает `suspend fun` так:

```kotlin
// Источник
suspend fun foo(): Int {
    val a = bar()
    val b = baz()
    return a + b
}

// После компиляции (упрощённо, JVM bytecode):
fun foo(cont: Continuation<Int>): Any? {
    // ...state machine
}
```

Возвращаемый тип становится `Any?`:
- При successful завершении возвращает `Int` (boxed).
- При suspension возвращает специальный маркер `COROUTINE_SUSPENDED`.
- Передаётся скрытый параметр `Continuation<Int>` в качестве "куда вернуть результат".

---

## 3. State machine — пример

```kotlin
suspend fun load(): String {
    delay(100)              // suspension point 1
    val a = fetchA()        // suspension point 2
    val b = fetchB()        // suspension point 3
    return "$a $b"
}
```

Псевдокод после компиляции:

```kotlin
class LoadStateMachine(completion: Continuation<String>) : ContinuationImpl(completion) {
    var label: Int = 0
    var a: String? = null

    override fun invokeSuspend(result: Result<Any?>): Any? {
        when (label) {
            0 -> {
                label = 1
                val r = delay(100, this)
                if (r === COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED
                // fallthrough если delay вернулся синхронно
            }
            1 -> {
                label = 2
                val r = fetchA(this)
                if (r === COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED
                a = r as String
            }
            2 -> {
                label = 3
                val r = fetchB(this)
                if (r === COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED
                val b = r as String
                return "$a $b"   // комплит, передаст в parent.resumeWith
            }
        }
    }
}
```

Каждая suspension-точка — это `case` в switch. Локальные переменные, живые между точками, становятся **полями** state-machine объекта.

### Что важно

1. Один `suspend fun` = один объект state-machine (на каждый вызов).
2. Стэк JVM **не сохраняется** — корутина "парсит" свой call-stack в поля объекта.
3. Это объясняет, почему suspend-функции **дёшевы**: нет переключения OS-потока, нет copy of stack — только аллокация state-machine объекта на куче.

---

## 4. `suspendCoroutine` — мост из callback API

Раз есть `Continuation`, можно предоставить его callback'у и завершить корутину явно:

```kotlin
suspend fun awaitCallback(): String = suspendCoroutine { cont ->
    legacyApi.fetchAsync(object : Callback {
        override fun onSuccess(value: String) = cont.resume(value)
        override fun onError(e: Throwable) = cont.resumeWithException(e)
    })
}
```

`suspendCoroutine { cont -> ... }` приостанавливает текущую корутину и даёт тебе `Continuation`. Когда вызовешь `cont.resume(...)` — корутина возобновится.

**Правила:**
- `cont.resume` или `cont.resumeWithException` нужно вызвать **ровно один раз**.
- Если вызвать дважды — `IllegalStateException`.
- Если не вызвать — корутина зависнет.

---

## 5. `suspendCancellableCoroutine` — мост с поддержкой отмены

```kotlin
suspend fun awaitWithCancel(): String = suspendCancellableCoroutine { cont ->
    val task = legacyApi.fetchAsync(object : Callback {
        override fun onSuccess(v: String) = cont.resume(v)
        override fun onError(e: Throwable) = cont.resumeWithException(e)
    })
    cont.invokeOnCancellation { task.cancel() }
}
```

Главное отличие — `cont.invokeOnCancellation { ... }` позволяет отменить **внешнюю работу** при отмене корутины. Без этого `cancel()` корутины оставит callback "висеть".

**Используй `suspendCancellableCoroutine` всегда**, когда мостишь:
- Java callback API (Future, ListenableFuture)
- HTTP клиенты (OkHttp Call.cancel)
- Listener-based API

`suspendCoroutine` — только для гарантированно быстрых, не-отменяемых операций.

---

## 6. Почему `suspend` "free" — анализ производительности

### Стоимость
- **Аллокация**: один объект `ContinuationImpl` на каждый вызов suspend-функции с >0 suspension points.
- **JIT может elide**: если функция компилируется и continuation не убегает — escape analysis может выкинуть аллокацию (теоретически; на практике зависит от JIT).
- **Tail-call оптимизации нет** — каждая suspension добавляет state-machine.

### Сравнение с потоком
- Поток ОС: ~1 МБ стека + syscall на создание + контекст-switching через kernel.
- Continuation: ~десятки байт + аллокация + planning через user-space scheduler.

Корутины выгодны когда **число задач >> число потоков**. Для долгих CPU-задач преимущества в "лёгкости" исчезают.

---

## 7. `intrinsics` — продвинутые мосты

```kotlin
import kotlin.coroutines.intrinsics.*

suspend fun fastPath(): Int = suspendCoroutineUninterceptedOrReturn { cont ->
    if (cached != null) cached!!     // synchronously return — БЕЗ suspension
    else {
        startAsync(cont)
        COROUTINE_SUSPENDED
    }
}
```

`suspendCoroutineUninterceptedOrReturn` позволяет **не приостанавливаться**, если значение готово синхронно. Используется в performance-critical библиотеках (`kotlinx-coroutines` сама внутри).

В обычном коде — используй `suspendCancellableCoroutine`. Intrinsics — `@DangerousCoroutineApi`-территория.

---

## 8. Stack trace в корутинах

Поскольку JVM-стек не отражает иерархию suspend-вызовов, классический stack trace может быть неинформативен:

```
at com.example.MyClass$loadData$1.invokeSuspend(MyClass.kt:42)
at kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(...)
at kotlinx.coroutines.DispatchedTask.run(...)
```

### `-Dkotlinx.coroutines.debug=on`

Включает имя корутины в имя потока:
```
DefaultDispatcher-worker-1 @loader#42
```

И "stitching" — stack trace включает информацию о родителях.

### `-Dkotlinx.coroutines.stacktrace.recovery=true` (default since 1.3)

Восстанавливает stack trace через caller frames при пробросе исключения.

В тестах используй `runTest` — там stack trace обогащён.

---

## 9. Continuation Interceptor

`CoroutineDispatcher` extends `ContinuationInterceptor`. Метод `interceptContinuation(cont)` оборачивает каждое возобновление в логику диспатчера.

Это объясняет, почему смена диспатчера так дёшева — это просто **обёртывание** `Continuation`, не создание потоков.

---

## 10. Реальная польза знания внутренностей

Знать CPS-трансформацию полезно для:

1. **Мостить callback API** — `suspendCancellableCoroutine` + `invokeOnCancellation`.
2. **Понимать утечки памяти** — state-machine может удерживать ссылки на крупные объекты, если они в локальных переменных вокруг suspension.
3. **Не паниковать при "странных" stack trace** — много `BaseContinuationImpl`, `invokeSuspend`, dispatch frames.
4. **Объяснить, почему `suspend fun` дешёвая** — аллокация state-machine vs. поток.
5. **Правильно реализовать кастомный диспатчер** — переопределить `dispatch(context, block)`.

---

## Шпаргалка

```kotlin
// Мост Java callback → suspend
suspend fun fetch(id: Long): Data = suspendCancellableCoroutine { cont ->
    val call = client.fetchAsync(id, object : Callback {
        override fun onSuccess(d: Data) = cont.resume(d)
        override fun onError(e: Throwable) = cont.resumeWithException(e)
    })
    cont.invokeOnCancellation { call.cancel() }
}

// CompletableFuture → Deferred (готовый mosti, KX:
import kotlinx.coroutines.future.await
val data = future.await()
```

---

## Источники

- KEEP-176, секция "Implementation details"
- [kotlinlang.org/docs/composing-suspending-functions.html](https://kotlinlang.org/docs/composing-suspending-functions.html)
- Roman Elizarov, "Coroutines: First things first" — KotlinConf 2017
- [github.com/Kotlin/kotlin-coroutines (KEEP)](https://github.com/Kotlin/KEEP/blob/master/proposals/coroutines.md)
