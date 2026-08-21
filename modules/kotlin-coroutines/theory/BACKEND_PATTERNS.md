# Бэкенд-паттерны на корутинах

> **Какую проблему решает.** Собирает разрозненные знания (отмена, диспетчеры, `Mutex`, `Flow`) в
> набор решений для задач, которые возникают в каждом сервисе: дедлайны, лимиты, повторы,
> дедупликация, корректная остановка.
> **Кому это надо.** Тому, кто пишет или ревьюит серверный код на корутинах.
> **Когда НЕ надо.** Если в сервисе один вызов на запрос и нет внешних зависимостей — большая часть
> этих паттернов будет усложнением.

Это прикладной файл: механику каждого инструмента разбирают отдельные главы, здесь — как их
складывать.

---

## 1. Дедлайн и деградация: собрать ответ и не ждать вечно

```kotlin
suspend fun buildPage(userId: Long): Page = withTimeout(1.seconds) {   // бюджет всего запроса
    coroutineScope {
        val profile = async { profiles.load(userId) }                       // критично
        val orders = async { orders.load(userId) }                          // критично
        val recs = async {
            withTimeoutOrNull(200.milliseconds) { recommender.load(userId) } // некритично
        }

        Page(
            profile = profile.await(),          // упадёт → упадёт весь запрос: так и надо
            orders = orders.await(),
            recommendations = recs.await().orEmpty(),
        )
    }
}
```

Три решения, которые здесь приняты явно:

1. **Дедлайн ставится один раз на границе операции**, а не таймаутом на каждом вызове. Иначе
   суммарное время не ограничено ничем: три вызова по 1 с с личными таймаутами дают 3 с.
2. **Критичные и некритичные вызовы обрабатываются по-разному.** Первые пробрасывают ошибку, вторые
   деградируют до значения по умолчанию (`withTimeoutOrNull`, `?: emptyList()`).
3. **`coroutineScope` гарантирует, что при ошибке любого вызова остальные будут отменены** — иначе
   они продолжат жечь соединения ради ответа, который уже никто не получит (см.
   [`CANCELLATION_EXCEPTIONS.md`](CANCELLATION_EXCEPTIONS.md)).

Практика — упражнение [Ex01](../src/main/kotlin/exercises/Ex01_Basics.kt).

---

## 2. Ограничение параллелизма

Самая частая пропущенная деталь. Без лимита 10 000 входящих событий превращаются в 10 000
одновременных HTTP-запросов — и падает не ваш сервис, а соседний. Плюс исчерпание пула соединений и
таймауты по всей цепочке.

Четыре рабочих способа, выбор зависит от того, что у вас на входе:

```kotlin
// 1) Semaphore — точечно, для списка задач
val sem = Semaphore(8)
items.map { async { sem.withPermit { call(it) } } }.awaitAll()

// 2) Диспетчер с лимитом — под пул соединений БД
val dbDispatcher = Dispatchers.IO.limitedParallelism(10)

// 3) Flow — когда источник это поток
events.flatMapMerge(concurrency = 8) { event -> flow { emit(handle(event)) } }.collect()

// 4) Fan-out воркеров на канале — когда задачи разбираются из очереди
repeat(8) { launch { for (task in channel) handle(task) } }
```

Как выбрать: список в памяти — `Semaphore`; ограничение ресурса (БД, файловая система) —
`limitedParallelism`; поток событий — `flatMapMerge`; очередь с воркерами — fan-out.

Практика — упражнение [Ex13](../src/main/kotlin/exercises/Ex13_BoundedParallelism.kt).

---

## 3. Повторы: backoff и jitter

```kotlin
suspend fun <T> retryWithBackoff(
    maxAttempts: Int = 4,
    initial: Duration = 100.milliseconds,
    factor: Double = 2.0,
    maxDelay: Duration = 5.seconds,
    retryOn: (Throwable) -> Boolean = { it is IOException },
    block: suspend (attempt: Int) -> T,
): T {
    var delayMs = initial.inWholeMilliseconds
    repeat(maxAttempts - 1) { attempt ->
        try {
            return block(attempt)
        } catch (e: CancellationException) {
            throw e                                          // отмену не повторяем никогда
        } catch (e: Throwable) {
            if (!retryOn(e)) throw e
            delay(delayMs + Random.nextLong(delayMs / 2))    // jitter против «стада»
            delayMs = (delayMs * factor).toLong().coerceAtMost(maxDelay.inWholeMilliseconds)
        }
    }
    return block(maxAttempts - 1)
}
```

Что здесь принципиально:

- **Повторять можно только идемпотентные операции.** `GET`, `PUT` с ключом идемпотентности — да;
  «списать деньги» без ключа идемпотентности — нет, получите дубли платежей.
- **`CancellationException` пробрасывается немедленно.** Иначе отменённая операция будет
  «повторяться» после отмены — и `cancelAndJoin` наверху зависнет.
- **Jitter обязателен.** Без него все клиенты, отвалившиеся в одну секунду, повторят одновременно и
  добьют сервис, который только начал подниматься.
- **Повторы должны укладываться в общий дедлайн** (§1): нет смысла делать четвёртую попытку, когда
  клиент уже ушёл.
- **Различайте ошибки.** Таймаут, 5xx, обрыв соединения — retryable; 4xx, ошибка валидации — нет,
  повтор ничего не изменит.

> Сам рецепт «экспоненциальный backoff + full jitter», бюджеты повторов и шторм повторов (retry storm) — в
> [`system-design/theory/RELIABILITY_PATTERNS.md`](../../system-design/theory/RELIABILITY_PATTERNS.md).
> Здесь — корутинная реализация.

Практика — упражнение [Ex12](../src/main/kotlin/exercises/Ex12_ResilientCalls.kt).

---

## 4. Повторы и circuit breaker решают **разные** задачи

Частый вопрос на собеседовании — и частая ошибка в проде: ставят повторы и считают, что защитились.

| | Повторы | Circuit breaker |
|---|---|---|
| Против чего | **единичный** сбой: моргнула сеть, попали на рестарт пода | **длительная** деградация: зависимость лежит целиком |
| Что делает | повторяет вызов | быстро отказывает, не делая вызов |
| Что будет без него | случайные ошибки долетают до клиента | повторы умножают нагрузку на лежащий сервис и держат ваши потоки в ожидании таймаутов |

Ключевое: **повторы без circuit breaker вредны**. Когда зависимость легла, каждый запрос превращается в
четыре, каждый ждёт таймаут, ваши соединения и корутины заняты ожиданием — вы устроили себе
самоотказ вслед за чужим.

Набросок на корутинах, чтобы показать идею:

```kotlin
class CircuitBreaker(private val threshold: Int, private val resetAfter: Duration) {
    private val mutex = Mutex()
    private var failures = 0
    private var openedAt: TimeMark? = null

    suspend fun <T> call(block: suspend () -> T): T {
        mutex.withLock {
            openedAt?.let {
                if (it.elapsedNow() < resetAfter) error("circuit open")
                openedAt = null; failures = 0                      // half-open: пробуем снова
            }
        }
        return try {
            block().also { mutex.withLock { failures = 0 } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            mutex.withLock { if (++failures >= threshold) openedAt = TimeSource.Monotonic.markNow() }
            throw e
        }
    }
}
```

> Сам паттерн (состояния closed/open/half-open, метрики, скользящее окно) — в
> [`system-design/theory/microservice_patterns.md`](../../system-design/theory/microservice_patterns.md);
> продакшен-реализация — Resilience4j, см.
> [`spring-frameworks/theory/SPRING_CLOUD.md`](../../spring-frameworks/theory/SPRING_CLOUD.md).
> В своём коде breaker обычно не пишут — берут готовый.

---

## 5. Single-flight: дедупликация одинаковых загрузок

Проблема: 100 параллельных запросов одного ключа промахиваются мимо кэша и дают 100 одинаковых
походов в БД. Это **cache stampede** (разбор явления — в
[`caching-deep-dive/theory/ANTI_PATTERNS.md`](../../caching-deep-dive/theory/ANTI_PATTERNS.md)).

Решение: первый вызывающий грузит, остальные ждут его результат.

```kotlin
class SingleFlightCache<K : Any, V : Any>(private val loader: suspend (K) -> V) {
    private val mutex = Mutex()
    private val inFlight = mutableMapOf<K, CompletableDeferred<V>>()
    private val cache = mutableMapOf<K, V>()

    suspend fun get(key: K): V {
        cache[key]?.let { return it }

        val (deferred, isLeader) = mutex.withLock {
            cache[key]?.let { return it }
            inFlight[key]?.let { it to false }
                ?: (CompletableDeferred<V>().also { inFlight[key] = it } to true)
        }

        if (!isLeader) return deferred.await()          // ждём чужую загрузку

        try {
            val value = loader(key)
            mutex.withLock { cache[key] = value; inFlight -= key }
            deferred.complete(value)
            return value
        } catch (e: Throwable) {
            mutex.withLock { inFlight -= key }          // ошибку не кэшируем
            deferred.completeExceptionally(e)
            throw e
        }
    }
}
```

**Почему `CompletableDeferred`, а не `async` в scope первого вызывающего.** `async` привязал бы
загрузку к жизненному циклу того, кто пришёл первым: он отменился (клиент закрыл соединение) — и
загрузка умерла для всех остальных, кто её ждал. `CompletableDeferred` — просто «обещание», не
привязанное ни к какому scope; загрузку выполняет тот, кто стал лидером, а остальные лишь ждут
результат.

Практика — упражнение [Ex14](../src/main/kotlin/exercises/Ex14_SingleFlight.kt).

---

## 6. Блокирующие API и пул соединений

```kotlin
class UserRepository(
    private val io: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(10),  // = размеру пула
) {
    suspend fun findById(id: Long): User? = withContext(io) {
        runInterruptible { jdbc.queryForObject("select …", id) }
    }
}
```

- **Размер диспетчера согласуйте с пулом соединений.** Больше корутин, чем соединений, — это просто
  очередь за соединением и рост латентности; меньше — недоиспользование БД.
- **`runInterruptible` нужен, чтобы отмена доходила до драйвера.** Без него отменённый запрос
  продолжит выполняться и держать соединение.
- Альтернатива на JDK 21 — диспетчер на виртуальных потоках; лимит всё равно нужен (см.
  [`DISPATCHERS.md`](DISPATCHERS.md) §7).

---

## 7. Обработка очереди событий

```kotlin
fun consumeLoop(): Job = scope.launch {
    while (isActive) {                                       // корректная остановка по отмене scope
        val batch = withContext(io) { consumer.poll(1.seconds) }   // блокирующий вызов
        batch.asFlow()
            .flatMapMerge(concurrency = 8) { record ->             // параллельно, но ограниченно
                flow { emit(handleWithRetry(record)) }
            }
            .collect()
        consumer.commit()                                    // коммит после успешной обработки батча
    }
}
```

- Обработка внутри батча параллельная и ограниченная, коммит — после.
- Ошибка одного сообщения не должна ронять цикл: либо повтор (§3), либо dead-letter.
- Если нужен **строгий порядок по ключу** — партиционируйте: по одному воркеру на ключ
  (`limitedParallelism(1)` на партицию), иначе `flatMapMerge` перемешает порядок.

---

## 8. Плавное завершение (graceful shutdown)

Три шага в строгом порядке: перестать принимать новое → дождаться текущих с таймаутом → добить.

```kotlin
class TaskService(context: CoroutineContext = Dispatchers.Default) {
    private val scope = CoroutineScope(SupervisorJob() + context + CoroutineName("tasks"))
    @Volatile private var accepting = true

    fun submit(task: suspend () -> Unit): Boolean {
        if (!accepting) return false                       // 1. новые задачи не принимаем
        scope.launch { task() }
        return true
    }

    suspend fun shutdown(timeout: Duration): Boolean {
        accepting = false
        val job = scope.coroutineContext[Job]!!
        val finished = withTimeoutOrNull(timeout) {          // 2. даём доработать
            job.children.toList().joinAll()
            true
        } ?: false
        if (!finished) job.cancelAndJoin()                   // 3. добиваем
        return finished
    }
}
```

Тот же порядок применим к HTTP-серверу: снять себя с балансировщика → дождаться активных запросов →
отменить остаток → закрыть внешние ресурсы. Обратите внимание: **сначала перестаём принимать**, иначе
ждать текущие бессмысленно — их количество не уменьшается.

`SupervisorJob` здесь обязателен: падение одной фоновой задачи не должно останавливать сервис.

Практика — упражнение [Ex16](../src/main/kotlin/exercises/Ex16_GracefulShutdown.kt).

---

## 9. Контекст логирования: MDC и requestId

**Кому это надо и что теряется без этого.** Логи сервиса читает дежурный, разбирая инцидент: у него
есть `requestId` из ответа или трейса, и он хочет увидеть все строки этого запроса. Если `requestId`
не попадает в лог, инцидент разбирается по таймстампам — то есть не разбирается.

Проблема специфична именно для корутин: MDC в SLF4J построен на `ThreadLocal`, а корутина после
приостановки продолжается на другом потоке, где MDC пуст (см. [`SCOPE_CONTEXT.md`](SCOPE_CONTEXT.md) §6).

```kotlin
withContext(MDCContext()) { … }                              // kotlinx-coroutines-slf4j
withContext(requestIdThreadLocal.asContextElement("req-42")) { … }   // без доп. артефакта
```

Самый дешёвый минимум, если тащить артефакт не хочется: `CoroutineName("request-42")` — имя видно в
дампах корутин и в именах потоков в debug-режиме.

---

## 10. Чек-лист код-ревью асинхронного кода

1. У каждой корутины есть scope-владелец с понятным жизненным циклом? Нет ли `GlobalScope`?
2. Все блокирующие вызовы уехали на `IO` или выделенный диспетчер?
3. Ограничен ли параллелизм внешних вызовов?
4. Пробрасывается ли `CancellationException` во всех `catch` и нет ли `runCatching` вокруг suspend?
5. Есть ли очистка ресурсов в `finally` и нужен ли там `NonCancellable`?
6. Задан ли дедлайн операции и укладываются ли в него повторы?
7. Идемпотентны ли повторяемые операции? Есть ли jitter?
8. Не теряются ли ошибки `async` без `await`?
9. Правильно ли выбран `Job` vs `SupervisorJob` для группы задач?
10. Не используется ли `StateFlow` там, где нужны события?
11. Ограничены ли буферы (`Channel(UNLIMITED)`, `buffer(UNLIMITED)`)?
12. Инжектируются ли диспетчеры (тестируемость)?
13. Есть ли плавное завершение работы и покрыто ли оно тестом?
14. Не потеряется ли контекст логирования после приостановки?
15. Покрыты ли тестами отмена, таймаут и лимит конкурентности?

---

## Шпаргалка

```kotlin
// Дедлайн + деградация
withTimeout(1.seconds) { coroutineScope { … withTimeoutOrNull(200.milliseconds) { … } } }

// Лимит конкурентности
Semaphore(8).withPermit { … }                 // список
Dispatchers.IO.limitedParallelism(10)         // ресурс с пулом
flatMapMerge(concurrency = 8) { … }           // Flow

// Retry
catch (e: CancellationException) { throw e }  // ВСЕГДА первым
delay(backoff + jitter)

// Single-flight
Mutex() + mutableMapOf<K, CompletableDeferred<V>>()

// Блокирующий вызов
withContext(io) { runInterruptible { jdbc.query(…) } }

// Shutdown
accepting = false; withTimeoutOrNull(t) { job.children.toList().joinAll() } ?: job.cancelAndJoin()
```

---

## Источники

**Смежные модули (механика паттернов живёт там):**
- [`system-design/theory/RELIABILITY_PATTERNS.md`](../../system-design/theory/RELIABILITY_PATTERNS.md) — backoff + full jitter, retry budget, load shedding, hedged requests.
- [`system-design/theory/microservice_patterns.md`](../../system-design/theory/microservice_patterns.md) — Circuit Breaker, Bulkhead.
- [`caching-deep-dive/theory/ANTI_PATTERNS.md`](../../caching-deep-dive/theory/ANTI_PATTERNS.md) — cache stampede и другие кэш-патологии.
- [`concurrency/theory/VIRTUAL_THREADS.md`](../../concurrency/theory/VIRTUAL_THREADS.md) — виртуальные потоки как исполнитель блокирующих вызовов.

**Официальная документация:**
- [`runInterruptible`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/run-interruptible.html)
- [`CompletableDeferred`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-completable-deferred/)
- [`kotlinx-coroutines-slf4j` (MDCContext)](https://github.com/Kotlin/kotlinx.coroutines/tree/master/integration/kotlinx-coroutines-slf4j)

**Posts:**
- [AWS Architecture Blog — «Exponential Backoff And Jitter»](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — первоисточник рецепта с jitter.
- [Roman Elizarov — «Structured concurrency»](https://elizarov.medium.com/structured-concurrency-722d765aa952)
