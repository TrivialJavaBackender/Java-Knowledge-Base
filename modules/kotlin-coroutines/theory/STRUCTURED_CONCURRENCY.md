# Structured Concurrency

> **Структурированная конкурентность** = у каждой корутины есть родитель, иерархия живёт как дерево, родитель ждёт детей и отменяет их при ошибке.
> Это **самое важное** свойство Kotlin-корутин — оно делает их безопасными.

> Для Java-аналога (`StructuredTaskScope`, JEP 453/505) см. `concurrency/theory/VIRTUAL_THREADS.md`.

---

## 1. Принцип

Без structured concurrency:

```java
// Java, classic
ExecutorService es = Executors.newCachedThreadPool();
es.submit(() -> { ... });  // куда улетела задача? кто её отменит? кто поймает исключение?
```

С Kotlin coroutines:

```kotlin
coroutineScope {
    launch { taskA() }
    launch { taskB() }
}  // <- блокирует здесь, пока taskA и taskB не завершатся (или не упадут)
```

**Гарантии structured concurrency:**

1. **Wait-for-all** — `coroutineScope` не вернётся, пока все запущенные дети не завершатся.
2. **Cancellation propagation** — если внешний код отменил корневую корутину, отмена доберётся до всех потомков.
3. **Error propagation** — если ребёнок упал, родитель отменяет всех братьев и тоже завершается с этим исключением.
4. **Resource cleanup** — нет "залипших" корутин, которые продолжают жить после того, как контекст уже не нужен.

---

## 2. `coroutineScope { }` — fail-fast скоуп

```kotlin
suspend fun loadAll(): Triple<A, B, C> = coroutineScope {
    val a = async { loadA() }
    val b = async { loadB() }
    val c = async { loadC() }
    Triple(a.await(), b.await(), c.await())
}
```

Поведение:
- Запускает дочерние корутины.
- **Suspends** (без блокировки потока) до завершения всех детей.
- Если **любой** ребёнок падает с исключением (не `CancellationException`) → **отменяет всех братьев** и пробрасывает исключение из `coroutineScope` наружу.
- Если внешний скоуп отменён → отменяет всех детей.

Используется внутри `suspend fun` — результат естественно возвращается.

### Чем `coroutineScope` отличается от `runBlocking`?

| | `coroutineScope` | `runBlocking` |
|---|---|---|
| Где можно вызвать | внутри `suspend fun` | где угодно |
| Блокирует поток | нет (suspends) | **да** |
| Назначение | структурный скоуп для параллельных задач | мост из не-suspend в suspend |

---

## 3. `supervisorScope { }` — fail-isolated скоуп

```kotlin
suspend fun loadAll(): Map<String, Result<Data>> = supervisorScope {
    listOf("a", "b", "c").associateWith { id ->
        async {
            runCatching { load(id) }
        }
    }.mapValues { (_, deferred) -> deferred.await() }
}
```

Главное отличие: **падение одного ребёнка НЕ отменяет братьев**.

Используется, когда задачи **независимы** и ты хочешь собрать частичные результаты.

### Когда что использовать

| Сценарий | Скоуп |
|----------|-------|
| Запросить три API, нужны все три | `coroutineScope` |
| Дашборд: загрузить 5 виджетов независимо | `supervisorScope` |
| Сервис, обрабатывающий N независимых событий | `SupervisorJob` в scope сервиса |
| Нужно отменить всех при ошибке одного | `coroutineScope` |

---

## 4. `SupervisorJob` — supervisor на уровне скоупа

`supervisorScope` — это, по сути, скоуп с `SupervisorJob`. Но `SupervisorJob` можно использовать и в долгоживущих scope:

```kotlin
class EventBus {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun handle(event: Event) {
        scope.launch {
            process(event)
        }
    }
}
```

Если один `process(event)` упадёт — другие продолжат. Без `SupervisorJob` падение одного хендлера убило бы scope сервиса целиком.

### `SupervisorJob` ≠ "ничего не отменяется"

Отмена **сверху вниз** работает: если кто-то снаружи делает `scope.cancel()`, все дети `SupervisorJob` отменятся. Supervisor только гасит **восходящее** распространение ошибок.

---

## 5. Семантика отмены — пример

```kotlin
coroutineScope {
    launch {
        repeat(100) {
            delay(100)
            println("A: $it")
        }
    }
    launch {
        delay(250)
        throw RuntimeException("boom")
    }
}
```

Что произойдёт:
1. Запустились две корутины.
2. Первая печатает A: 0, A: 1.
3. Вторая через 250 мс бросает.
4. `coroutineScope` ловит исключение → отменяет первую.
5. Первая получает `CancellationException` на ближайшей suspension point (обычно следующий `delay`).
6. `coroutineScope` пробрасывает `RuntimeException("boom")` наружу.

Если бы был `supervisorScope`:
1. `RuntimeException("boom")` НЕ отменил бы первую.
2. Но т.к. у второй нет `CoroutineExceptionHandler`, и она дочерняя `launch` — ошибка попадёт в default handler (печать в stderr).

---

## 6. Job-иерархия и `launch` без `Job` в контексте

```kotlin
val scope = CoroutineScope(Dispatchers.Default)  // авто-создаст Job()
val job1 = scope.launch { ... }
val job2 = scope.launch { ... }
// job1 и job2 — дети scope.coroutineContext[Job]
```

Можно проверить родителя через `(job as JobSupport).parent` (internal API), но обычно достаточно понимать, что **родительский Job** = `coroutineContext[Job]` в момент вызова билдера.

### Передача `Job` в билдер

```kotlin
val externalJob = Job()
scope.launch(externalJob) { ... }
```

Здесь `externalJob` становится **родителем** новой корутины, а сам встраивается в иерархию scope. Это редкий паттерн.

---

## 7. `coroutineScope` внутри корневой `runBlocking`

```kotlin
fun main() = runBlocking {                      // root scope
    val data = coroutineScope {                  // вложенный fail-fast
        val a = async { ... }
        val b = async { ... }
        a.await() to b.await()
    }
    println(data)
}
```

`runBlocking` сам по себе scope. `coroutineScope` создаёт под-scope с теми же характеристиками (диспатчер унаследован), но **новым `Job`**, чьим родителем является `Job` `runBlocking`.

---

## 8. Ошибки и анти-паттерны

### 8.1 `try/catch` вокруг `launch` не ловит исключение из тела

```kotlin
try {
    scope.launch { throw RuntimeException("x") }
} catch (e: Exception) {
    // НИКОГДА сюда не попадёт
}
```

`launch` запускает корутину **асинхронно**. Тело упадёт позже, и исключение не пройдёт через эту строку. Лови **внутри** `launch` или используй `CoroutineExceptionHandler`.

### 8.2 `try/catch (CancellationException)` без `throw`

```kotlin
launch {
    try {
        delay(1000)
    } catch (e: CancellationException) {
        // ❌ проглотили — нарушили cooperative cancellation
    }
    longComputation()  // продолжает работать после отмены!
}
```

`CancellationException` нужно **пробросить** дальше или вообще не ловить. См. `CANCELLATION_EXCEPTIONS.md`.

### 8.3 Использование `GlobalScope`

```kotlin
fun handleRequest(req: Req) {
    GlobalScope.launch { processSlowly(req) }  // ❌
}
```

Корутина теперь не привязана к lifecycle запроса. Если клиент отвалился — она продолжит работу. Если упала — никто не узнает. Используй scope с осмысленным родителем.

---

## 9. Отношение к Java's `StructuredTaskScope`

JEP 453/505 (Java 24+) ввёл `StructuredTaskScope` — почти такой же API:

```java
try (var scope = StructuredTaskScope.open(Joiner.allSuccessfulOrThrow())) {
    var a = scope.fork(() -> loadA());
    var b = scope.fork(() -> loadB());
    scope.join();
    return new Pair(a.get(), b.get());
}
```

Идеи те же: иерархия задач, отмена при ошибке, ожидание всех. Подробно — в `concurrency/theory/VIRTUAL_THREADS.md` §5.

В Kotlin это работает поверх suspend-машины, в Java — поверх виртуальных потоков.

---

## Шпаргалка

```kotlin
// Все нужны → fail-fast
coroutineScope {
    val a = async { ... }
    val b = async { ... }
    a.await() + b.await()
}

// Независимые → fail-isolated
supervisorScope {
    launch { taskA() }
    launch { taskB() }
}

// Долгоживущий сервис → SupervisorJob
class Service {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
}

// Никогда: try/catch вокруг launch (ловит снаружи), GlobalScope, проглатывание CancellationException
```

---

## Источники

- [kotlinlang.org/docs/composing-suspending-functions.html](https://kotlinlang.org/docs/composing-suspending-functions.html)
- [kotlinlang.org/docs/exception-handling.html](https://kotlinlang.org/docs/exception-handling.html)
- Roman Elizarov, "Structured Concurrency" — Medium 2018
- KEEP-176
