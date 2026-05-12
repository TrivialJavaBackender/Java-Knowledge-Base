# Channels

> `Channel<T>` — конкурентная очередь для передачи значений между корутинами.
> Аналог `BlockingQueue`, но `send`/`receive` — `suspend`-функции, не блокируют поток.

> Когда выбрать Channel vs Flow — см. §7.

---

## 1. Что такое Channel

```kotlin
val channel = Channel<Int>()

launch {
    for (i in 1..5) channel.send(i)
    channel.close()
}

launch {
    for (v in channel) println(v)   // итерирует пока не close
}
```

`Channel<T>` имеет два интерфейса:
- `SendChannel<T>` — `send`, `trySend`, `close`.
- `ReceiveChannel<T>` — `receive`, `tryReceive`, `consumeEach`, `for (v in c)`.

При `close()` все ожидающие `send` отдают результат (если буфер) и `for`-loop заканчивается.

---

## 2. Capacity типы

```kotlin
Channel<T>()                          // RENDEZVOUS (default), capacity = 0
Channel<T>(Channel.UNLIMITED)         // unbounded, как LinkedBlockingQueue
Channel<T>(capacity = 16)             // bounded buffered
Channel<T>(Channel.CONFLATED)         // capacity = 1, новый перезаписывает старый
Channel<T>(Channel.BUFFERED)          // default 64 (или -Dkotlinx.coroutines.channels.defaultBuffer)
```

| Тип | `send` блокирует | Drop policy |
|-----|------------------|-------------|
| `RENDEZVOUS` (0) | до тех пор, пока кто-то не сделает `receive` | – |
| `UNLIMITED` (-2) | никогда | – |
| `BUFFERED` (-1) | когда буфер полон | `SUSPEND` |
| `CONFLATED` (-3) | никогда | заменяет старое значение |
| `N` (>0) | когда буфер полон | по `onBufferOverflow` |

### `onBufferOverflow`

```kotlin
Channel<T>(capacity = 4, onBufferOverflow = BufferOverflow.DROP_OLDEST)
```

- `SUSPEND` — `send` ждёт места.
- `DROP_OLDEST` — выкидывает самое старое.
- `DROP_LATEST` — игнорирует новое.

---

## 3. `produce { }` — корутинный builder для ReceiveChannel

```kotlin
fun CoroutineScope.numbers(): ReceiveChannel<Int> = produce {
    for (i in 1..5) {
        delay(100)
        send(i)
    }
}

val nums = numbers()
for (v in nums) println(v)
```

`produce` — это `launch`, который привязывает `Channel` к `Job` корутины. При отмене Job — channel закрывается.

`channelFlow { }` — родственник `produce` для Flow API (см. `FLOW.md`).

---

## 4. `actor { }` — `@ObsoleteCoroutinesApi`

Канонический producer-consumer с одним приёмником-actor:

```kotlin
sealed class Msg
object Inc : Msg()
class Get(val resp: CompletableDeferred<Int>) : Msg()

fun CoroutineScope.counterActor() = actor<Msg> {
    var counter = 0
    for (msg in channel) when (msg) {
        is Inc -> counter++
        is Get -> msg.resp.complete(counter)
    }
}
```

Помечен `@ObsoleteCoroutinesApi` — JetBrains рекомендует **не использовать** в новом коде. Вместо actor — комбинация `Channel` + `launch`. Или вообще `StateFlow`, если actor нужен только для счётчика.

---

## 5. `select { }` — выбрать готовый источник

`select` позволяет ждать **первого готового** из нескольких suspend-источников:

```kotlin
suspend fun loadFastest(): Data = select {
    api1Channel.onReceive { it }
    api2Channel.onReceive { it }
    onTimeout(1000) { Data.empty }
}
```

Поддерживаемые "пункты":
- `Channel.onReceive` — получить значение
- `Channel.onSend(value)` — отправить
- `Deferred.onAwait` — дождаться
- `Job.onJoin` — дождаться завершения
- `onTimeout(ms)`

```kotlin
// Race нескольких deferred'ов
suspend fun first(a: Deferred<R>, b: Deferred<R>): R = select {
    a.onAwait { it }
    b.onAwait { it }
}
```

`select` атомарен: ровно один пункт сработает.

---

## 6. Паттерны

### 6.1 Pipeline

```kotlin
fun CoroutineScope.numbers() = produce {
    var i = 1
    while (true) send(i++)
}
fun CoroutineScope.squares(input: ReceiveChannel<Int>) = produce {
    for (x in input) send(x * x)
}

fun main() = runBlocking {
    val n = numbers()
    val sq = squares(n)
    repeat(5) { println(sq.receive()) }
    coroutineContext.cancelChildren()
}
```

### 6.2 Fan-out (несколько consumer'ов)

```kotlin
val tasks = produce { repeat(100) { send(it) } }
repeat(4) { workerId ->
    launch { for (task in tasks) process(workerId, task) }
}
```

Все воркеры читают **из одного** channel — каждое сообщение получит **один** воркер (mutex-семантика).

### 6.3 Fan-in (несколько producer'ов)

```kotlin
val merged = Channel<String>()
launch { while (true) merged.send(source1.next()) }
launch { while (true) merged.send(source2.next()) }
for (m in merged) println(m)
```

### 6.4 Poison pill / закрытие

```kotlin
sealed class Msg
data class Item(val v: Int) : Msg()
object Stop : Msg()

// Любой producer может прислать Stop, consumer ловит и завершается.
```

Альтернатива — `channel.close()`, и consumer завершается через `for`.

---

## 7. Channel vs Flow — когда что

| | `Channel<T>` | `Flow<T>` |
|---|---|---|
| Hot/Cold | hot | cold (по умолчанию) |
| Backpressure | через capacity и suspend | через suspend |
| Multi-producer | да | нет |
| Multi-consumer | каждое значение **одному** | каждый получает **все** (cold) |
| Завершение | `close()` | tail элемент |
| Сериализуется | можно с трудом | нет |
| Идиоматично для | конкурентной очереди | реактивных потоков значений |

**Правило:**
- Поток данных, реактивная цепочка трансформаций, UI-биндинг → `Flow` (или `StateFlow`/`SharedFlow`).
- Очередь между конкурирующими producer/consumer, where ровно один consumer должен получить значение → `Channel`.
- Bridge callback → `callbackFlow` (Flow поверх Channel).

---

## 8. Закрытие и отмена

```kotlin
val ch = Channel<Int>()
launch {
    try {
        for (i in 1..10) ch.send(i)
    } finally {
        ch.close()
    }
}
```

- `close()` — нормальное завершение, оставшиеся в буфере элементы обрабатываются consumer'ом.
- `close(cause)` — закрытие с ошибкой; `receive()` бросит этот `cause`.
- `cancel()` — экстренное закрытие, очищает буфер.

`channel.consume { ... }` — gурантирует `cancel` при выходе (даже с исключением). Лучше `consumeEach { }`.

---

## 9. Анти-паттерны

### 9.1 `Channel.UNLIMITED` без оснований

Может маскировать неконтролируемый рост памяти. Используй bounded + `SUSPEND` для естественного backpressure.

### 9.2 Сложный actor вместо StateFlow

Если "actor" хранит одно значение и принимает `Inc`/`Get` — это `MutableStateFlow` + `update { }`. Проще и без `@ObsoleteCoroutinesApi`.

### 9.3 Использование Channel там, где Flow

```kotlin
fun events(): Channel<Event>            // ❌ возвращать Channel в API
fun events(): Flow<Event>               // ✅
```

Channel в API делает caller'а ответственным за `close`. Flow — холодный, подписчик контролирует подписку.

### 9.4 Забыть `close()` в `produce`

`produce` закрывает автоматически по завершении тела. Если ты используешь raw `Channel` — закрывай явно в `finally`.

---

## Шпаргалка

```kotlin
// Bounded buffer
val ch = Channel<Int>(capacity = 16)

// Pipeline
fun CoroutineScope.numbers() = produce { repeat(100) { send(it) } }

// Fan-out
val tasks = produce { ... }
repeat(4) { launch { for (t in tasks) handle(t) } }

// Race через select
val data = select<Data> {
    chA.onReceive { it }
    chB.onReceive { it }
    onTimeout(1000) { Data.empty }
}

// Закрытие
ch.close()
ch.close(IOException("source dead"))
```

---

## Источники

**Официальная документация:**
- [Channels (kotlinlang.org)](https://kotlinlang.org/docs/channels.html) — capacity, `produce`, `consumeEach`, fan-out/fan-in.
- [Select Expression](https://kotlinlang.org/docs/select-expression.html) — `onReceive`, `onSend`, `onTimeout`.
- [`Channel` API reference](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.channels/-channel/)

**Posts:**
- [Roman Elizarov — «Cold flows, hot channels»](https://elizarov.medium.com/cold-flows-hot-channels-d74769805f9) — каноническое объяснение когда Channel, когда Flow.
- [Roman Elizarov — «Kotlin Flow Tips»](https://elizarov.medium.com/kotlin-flow-tips-9d1c4a6c9d2c) — про producer-consumer без Channel.
- [Sebastian Aigner — «Kotlin Coroutines and Channels»](https://www.youtube.com/watch?v=HpWQUoVURWQ) — KotlinConf-style talk.

**Theory:**
- [Hoare (1978) — «Communicating Sequential Processes» (CSP, CACM)](https://dl.acm.org/doi/10.1145/359576.359585) — теоретическая основа Channel-семантики (как и в Go).

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Moskała)](https://kt.academy/book/coroutines) — главы про Channel, Select.
