# Квиз: предскажи вывод и найди баг

> **Какую проблему решает.** Проверяет, что понимание настоящее, а не пересказ статьи: теорию можно
> прочитать и «согласиться», а вот предсказать вывод — только если действительно понял модель.
> **Кому это надо.** Перед собеседованием и после прочтения теории — как самопроверка.
> **Когда НЕ надо.** Как первое знакомство с темой: без [`BASICS.md`](BASICS.md) и
> [`FLOW.md`](FLOW.md) это будет угадывание.

Все выводы в части A **получены реальным запуском** на Kotlin 2.2.21 / kotlinx-coroutines 1.10.2 /
JDK 21 — это не «как должно быть по документации», а то, что печатает JVM.

Как пользоваться: прочитал код → **сказал вслух ожидаемый вывод** → раскрыл ответ. Ошибся — читай
разбор и возвращайся к соответствующей главе.

---

# Часть A. Что напечатает?

### Задача 1 (junior)

```kotlin
runBlocking {
    println("1")
    launch { println("2") }
    println("3")
    delay(10)
    println("4")
}
```

<details><summary>Ответ</summary>

```
1
3
2
4
```

**Почему.** `launch` только планирует корутину в очередь диспетчера `runBlocking` — тело выполнится, когда текущая
корутина дойдёт до точки приостановки. Поэтому «3» печатается раньше «2», а `delay(10)` даёт запланированной корутине
шанс выполниться.

**Тезис:** «`launch` не выполняет код сразу, он его планирует».
→ [`BASICS.md`](BASICS.md)
</details>

### Задача 2 (junior)

```kotlin
runBlocking {
    val a = async { delay(100); println("A готов"); 1 }
    val b = async { delay(50); println("B готов"); 2 }
    println("сумма = ${a.await() + b.await()}")
}
```

<details><summary>Ответ</summary>

```
B готов
A готов
сумма = 3
```

**Почему.** Оба `async` стартуют сразу и работают параллельно, поэтому B (50 мс) финиширует раньше A (100 мс).
Общее время — 100 мс, а не 150. Порядок `await` на это не влияет: он лишь определяет, где мы ждём результат.

**Тезис:** «`async` запускает работу немедленно; `await` только забирает результат».
→ [`BASICS.md`](BASICS.md)
</details>

### Задача 3 (middle)

```kotlin
runBlocking {
    coroutineScope {
        launch { delay(50); println("ребёнок") }
        println("тело scope закончилось")
    }
    println("после scope")
}
```

<details><summary>Ответ</summary>

```
тело scope закончилось
ребёнок
после scope
```

**Почему.** `coroutineScope` не возвращает управление, пока не завершатся все дети, даже если тело блока уже
отработало. Это и есть структурная конкурентность в действии.

**Тезис:** «родитель переходит в Completing и ждёт детей».
→ [`STRUCTURED_CONCURRENCY.md`](STRUCTURED_CONCURRENCY.md)
</details>

### Задача 4 (middle)

```kotlin
runBlocking {
    val job = launch {
        try {
            delay(1000)
        } finally {
            println("finally начался")
            withContext(NonCancellable) { delay(10); println("очистка выполнена") }
        }
    }
    delay(50)
    job.cancelAndJoin()
    println("отменено")
}
```

<details><summary>Ответ</summary>

```
finally начался
очистка выполнена
отменено
```

**Почему.** В отменённой корутине любой обычный `delay` мгновенно бросил бы `CancellationException`, но
`withContext(NonCancellable)` создаёт неотменяемый контекст, поэтому suspend-очистка доходит до конца.

**Тезис:** «suspend-код в `finally` требует `NonCancellable`».
→ [`CANCELLATION_EXCEPTIONS.md`](CANCELLATION_EXCEPTIONS.md)
</details>

### Задача 5 (middle) — то же самое без `NonCancellable`

```kotlin
runBlocking {
    val job = launch {
        try {
            delay(1000)
        } finally {
            println("finally начался")
            delay(10)
            println("эта строка выполнится?")
        }
    }
    delay(50)
    job.cancelAndJoin()
    println("после cancelAndJoin")
}
```

<details><summary>Ответ</summary>

```
finally начался
после cancelAndJoin
```

**Почему.** `delay(10)` в отменённой корутине немедленно бросает `CancellationException`, и остаток `finally` не
выполняется. Именно так «теряются» закрытия соединений и откаты транзакций.

**Тезис:** «отмена делает весь suspend-код мгновенно падающим — кроме `NonCancellable`».
→ [`CANCELLATION_EXCEPTIONS.md`](CANCELLATION_EXCEPTIONS.md)
</details>

### Задача 6 (senior)

```kotlin
runBlocking {
    val job = launch {
        try {
            delay(1000)
        } catch (e: Exception) {
            println("поймали: ${e::class.simpleName}")
        }
        println("продолжаю работать после отмены!")
    }
    delay(50)
    job.cancelAndJoin()
    println("job.isCancelled=${job.isCancelled}")
}
```

<details><summary>Ответ</summary>

```
поймали: JobCancellationException
продолжаю работать после отмены!
job.isCancelled=true
```

**Почему.** `catch (e: Exception)` перехватывает `CancellationException` (конкретный класс —
`JobCancellationException`), и корутина продолжает выполняться после отмены. `Job` при этом всё равно считается
отменённым. В реальном коде так появляются зомби-задачи, доводящие до конца уже никому не нужную работу.

**Тезис:** «`CancellationException` нельзя глотать; поймали — пробрасываем».
→ [`CANCELLATION_EXCEPTIONS.md`](CANCELLATION_EXCEPTIONS.md)
</details>

### Задача 7 (senior)

```kotlin
runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("handler: ${e.message}") }
    try {
        coroutineScope {
            launch {
                launch(handler) { throw RuntimeException("внук упал") }
            }
        }
    } catch (e: Exception) {
        println("поймали снаружи: ${e.message}")
    }
}
```

<details><summary>Ответ</summary>

```
поймали снаружи: внук упал
```

**Почему.** `CoroutineExceptionHandler` работает только для корневой корутины scope. Здесь он висит на дочерней,
поэтому игнорируется: исключение поднимается по дереву и вылетает из `coroutineScope`, где его и ловит обычный
`try/catch`.

**Тезис:** «handler — последний рубеж корня, а не `try/catch` на каждой корутине».
→ [`CANCELLATION_EXCEPTIONS.md`](CANCELLATION_EXCEPTIONS.md)
</details>

### Задача 8 (middle)

```kotlin
runBlocking {
    val handler = CoroutineExceptionHandler { _, e -> println("handler: ${e.message}") }
    supervisorScope {
        launch(handler) { throw RuntimeException("A упал") }
        launch { delay(50); println("B выжил") }
    }
}
```

<details><summary>Ответ</summary>

```
handler: A упал
B выжил
```

**Почему.** В `supervisorScope` прямые дети независимы: падение A не отменяет B. И здесь `launch(handler)` —
корневая корутина супервизорного scope, поэтому handler срабатывает.

**Тезис:** «supervisor меняет только распространение снизу вверх».
→ [`STRUCTURED_CONCURRENCY.md`](STRUCTURED_CONCURRENCY.md)
</details>

### Задача 9 (junior)

```kotlin
runBlocking {
    var starts = 0
    val f = flow {
        starts++
        println("продюсер стартовал, запуск №$starts")
        emit(1); emit(2)
    }
    f.collect { println("A получил $it") }
    f.collect { println("B получил $it") }
}
```

<details><summary>Ответ</summary>

```
продюсер стартовал, запуск №1
A получил 1
A получил 2
продюсер стартовал, запуск №2
B получил 1
B получил 2
```

**Почему.** Flow холодный: каждый `collect` заново выполняет тело билдера. Если апстрим дорогой (запрос в БД,
WebSocket), два коллектора — это две настоящие подписки; лечится `shareIn`/`stateIn`.

**Тезис:** «холодный поток — это рецепт, а не данные».
→ [`FLOW.md`](FLOW.md), [`FLOW_ADVANCED.md`](FLOW_ADVANCED.md)
</details>

### Задача 10 (senior)

```kotlin
runBlocking {
    val broken = flow {
        try {
            emit(1); emit(2); emit(3)
        } catch (e: Throwable) {
            println("продюсер поймал: ${e::class.simpleName}")
        }
    }
    broken.take(1).collect { println("получено $it") }
    println("collect завершился")
}
```

<details><summary>Ответ</summary>

```
получено 1
продюсер поймал: AbortFlowException
collect завершился
```

**Почему.** `take(1)` останавливает апстрим служебным `AbortFlowException`, а `try/catch` внутри билдера его
перехватывает — это нарушение exception transparency. В более сложных цепочках такой перехват приводит к тому,
что поток продолжает работать после «стоп-сигнала» или молча глотает ошибки.

**Тезис:** «внутри `flow { }` нельзя ловить исключения вокруг `emit`».
→ [`FLOW_INTERNALS.md`](FLOW_INTERNALS.md) §3
</details>

### Задача 11 (senior)

```kotlin
runBlocking {
    val state = MutableStateFlow(0)
    val job = launch { state.collect { println("получено $it") } }
    delay(20)
    state.value = 1
    state.value = 1
    state.value = 2
    delay(20)
    job.cancelAndJoin()
}
```

<details><summary>Ответ</summary>

```
получено 0
получено 2
```

**Почему.** Два эффекта сразу: встроенный `distinctUntilChanged` (второе `1` равно первому и не порождает
обновления) и **конфлейт** — три записи подряд происходят без приостановки, коллектор просыпается уже с последним
значением, поэтому `1` он не увидит вовсе.

**Тезис:** «`StateFlow` — про состояние, а не про историю; промежуточные значения теряются».
→ [`FLOW_ADVANCED.md`](FLOW_ADVANCED.md), [`FLOW_INTERNALS.md`](FLOW_INTERNALS.md) §6
</details>

### Задача 12 (middle)

```kotlin
runBlocking {
    val shared = MutableSharedFlow<Int>()
    shared.emit(1)
    val job = launch { shared.collect { println("получено $it") } }
    delay(30)
    shared.emit(2)
    delay(30)
    job.cancelAndJoin()
}
```

<details><summary>Ответ</summary>

```
получено 2
```

**Почему.** `MutableSharedFlow()` по умолчанию имеет `replay = 0`: значение, отправленное до подписки, никто не
получает и оно теряется навсегда. Чтобы поздний подписчик увидел последнее событие, нужен `replay = 1`.

**Тезис:** «`SharedFlow` без replay — чистое широковещание в реальном времени».
→ [`FLOW_ADVANCED.md`](FLOW_ADVANCED.md)
</details>

### Задача 13 (middle)

```kotlin
runBlocking {
    val a = flow { emit(1); delay(30); emit(2) }
    val b = flow { emit("x"); delay(50); emit("y") }
    println("zip:     " + a.zip(b) { x, y -> "$x$y" }.toList())
    println("combine: " + a.combine(b) { x, y -> "$x$y" }.toList())
}
```

<details><summary>Ответ</summary>

```
zip:     [1x, 2y]
combine: [1x, 2x, 2y]
```

**Почему.** `zip` соединяет строго попарно: первый с первым, второй со вторым. `combine` эмитит на каждое
изменение любого источника после того, как оба дали хотя бы по значению: `1x` (t=0), `2x` (t=30, обновился `a`),
`2y` (t=50, обновился `b`).

**Тезис:** «`zip` — про соответствие, `combine` — про текущее состояние».
→ [`FLOW.md`](FLOW.md)
</details>

### Задача 14 (middle)

```kotlin
runBlocking {
    val flow = flow { repeat(3) { emit(it) } }.onEach { println("onEach $it") }
    flow.collectLatest { value ->
        delay(50)
        println("обработано $value")
    }
}
```

<details><summary>Ответ</summary>

```
onEach 0
onEach 1
onEach 2
обработано 2
```

**Почему.** Продюсер эмитит быстро, а обработка занимает 50 мс: `collectLatest` отменяет незавершённую обработку
при каждом новом значении. До конца доходит только последний элемент.

**Тезис:** «`collectLatest` отменяет обработку, а не эмиссию».
→ [`FLOW.md`](FLOW.md) §7
</details>

### Задача 15 (senior)

```kotlin
runBlocking {
    val flow = flow {
        emit(1)
        throw RuntimeException("ошибка продюсера")
    }
    flow
        .onCompletion { cause -> println("onCompletion: ${cause?.message}") }
        .catch { e -> println("catch: ${e.message}"); emit(-1) }
        .collect { println("получено $it") }
}
```

<details><summary>Ответ</summary>

```
получено 1
onCompletion: ошибка продюсера
catch: ошибка продюсера
получено -1
```

**Почему.** Порядок операторов важен: `onCompletion` стоит **до** `catch`, поэтому он видит исходную ошибку и
срабатывает первым; затем `catch` перехватывает её и эмитит fallback-значение, которое доходит до коллектора.
Если поменять их местами, `onCompletion` увидит `cause == null`.

**Тезис:** «операторы Flow — это цепочка; позиция определяет, что оператор видит».
→ [`FLOW.md`](FLOW.md) §6
</details>

### Задача 16 (senior)

```kotlin
runBlocking {
    flowOf(1, 2, 3)
        .catch { println("catch сработал") }
        .collect { value ->
            if (value == 2) throw RuntimeException("ошибка коллектора")
            println("получено $value")
        }
}
```

<details><summary>Ответ</summary>

```
получено 1
```
и наружу вылетает `RuntimeException: ошибка коллектора`.

**Почему.** `catch` ловит только исключения апстрима. Ошибка в теле `collect` — это ошибка даунстрима, она
проходит мимо и вылетает вызывающему. Лечение: перенести логику в `onEach { }` перед `catch` либо обернуть
`collect` в `try/catch`.

**Тезис:** «`catch` — про апстрим, всегда».
→ [`FLOW.md`](FLOW.md) §6, [`FLOW_INTERNALS.md`](FLOW_INTERNALS.md) §3
</details>

### Задача 17 (middle)

```kotlin
runBlocking {
    val result = withTimeoutOrNull(100) {
        val a = async { delay(50); "быстрый" }
        val b = async { delay(500); "медленный" }
        "${a.await()} + ${b.await()}"
    }
    println("результат = $result")
}
```

<details><summary>Ответ</summary>

```
результат = null
```

**Почему.** Таймаут срабатывает раньше, чем завершится медленный вызов; весь блок отменяется вместе с обоими
`async`, и результат «быстрого» тоже теряется. Если частичный результат нужен — оборачивайте таймаутом каждый
вызов отдельно (`withTimeoutOrNull` внутри `async`).

**Тезис:** «таймаут снаружи отменяет всё поддерево, включая уже готовые результаты».
→ [`CANCELLATION_EXCEPTIONS.md`](CANCELLATION_EXCEPTIONS.md) §4, [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md) §1
</details>

### Задача 18 (senior)

```kotlin
fun main() = runBlocking {
    println("старт в потоке: ${Thread.currentThread().name}")
    launch(Dispatchers.Unconfined) {
        println("до delay: ${Thread.currentThread().name}")
        delay(10)
        println("после delay: ${Thread.currentThread().name}")
    }.join()
}
```

<details><summary>Ответ</summary>

```
старт в потоке: main
до delay: main
после delay: kotlinx.coroutines.DefaultExecutor
```

**Почему.** `Unconfined` не диспетчеризует: до первой приостановки код выполняется в вызывающем потоке, а после
возобновления — в том потоке, который вызвал `resume`. Здесь это внутренний планировщик `delay`.

Первые две строки — имя **вызывающего** потока: при запуске через `mvn exec:java` там будет не `main`, а имя
задачи Maven. Суть от этого не меняется: до `delay` — тот же поток, что у вызывающего, после — чужой.

**Тезис:** «`Unconfined` не даёт никаких гарантий о потоке — поэтому в проде почти не применяется».
→ [`DISPATCHERS.md`](DISPATCHERS.md), [`SUSPEND_INTERNALS.md`](SUSPEND_INTERNALS.md) §4
</details>

---

# Часть B. Найди баг

### Баг 1. Проглоченная отмена (middle)

```kotlin
suspend fun sync() {
    try {
        repeat(100) { chunk -> uploadChunk(chunk) }
    } catch (e: Exception) {
        log.error("Ошибка синхронизации", e)
    }
}
```

<details><summary>Разбор</summary>

**Что не так.** `catch (e: Exception)` перехватывает `CancellationException`: после отмены корутина не завершится,
а спокойно продолжит выполнение и запишет в лог ложную ошибку.

**Как правильно:**
```kotlin
try {
    repeat(100) { chunk -> uploadChunk(chunk) }
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    log.error("Ошибка синхронизации", e)
}
```
**Формулировка:** «`CancellationException` — не ошибка, а сигнал; её всегда пробрасываем».
</details>

### Баг 2. `runCatching` вокруг suspend (senior)

```kotlin
val results = ids.map { id ->
    runCatching { api.load(id) }
}
```

<details><summary>Разбор</summary>

**Что не так.** Два бага сразу: (1) `runCatching` ловит `CancellationException` и превращает отмену в
`Result.failure`; (2) вызовы выполняются последовательно, хотя выглядят как «список задач».

**Как правильно:**
```kotlin
suspend fun <T> runCatchingCancellable(block: suspend () -> T): Result<T> =
    try { Result.success(block()) }
    catch (e: CancellationException) { throw e }
    catch (e: Throwable) { Result.failure(e) }

val results = coroutineScope {
    ids.map { id -> async { runCatchingCancellable { api.load(id) } } }.awaitAll()
}
```
**Формулировка:** «`runCatching` в корутинах — известная ловушка, он глотает отмену».
</details>

### Баг 3. `try/catch` вокруг `emit` (senior)

```kotlin
fun prices(): Flow<Price> = flow {
    try {
        while (true) {
            emit(api.fetchPrice())
            delay(1000)
        }
    } catch (e: Exception) {
        emit(Price.UNKNOWN)
    }
}
```

<details><summary>Разбор</summary>

**Что не так.** Нарушена exception transparency: `catch` внутри билдера перехватывает и ошибки коллектора, и
служебный `AbortFlowException` от `take`/`first`, и `CancellationException`.

**Как правильно:**
```kotlin
fun prices(): Flow<Price> = flow {
    while (true) {
        emit(api.fetchPrice())
        delay(1000)
    }
}.catch { emit(Price.UNKNOWN) }
```
**Формулировка:** «обработка ошибок апстрима — оператором `catch`, а не `try/catch` внутри билдера».
</details>

### Баг 4. Блокирующий вызов на `Default` (middle)

```kotlin
suspend fun report(): Report = withContext(Dispatchers.Default) {
    val rows = jdbcTemplate.query("select …")   // блокирующий вызов
    buildReport(rows)
}
```

<details><summary>Разбор</summary>

**Что не так.** `Dispatchers.Default` рассчитан на CPU-задачи и имеет ровно столько потоков, сколько ядер.
Блокирующий JDBC-вызов отбирает ядро у всей программы; при нескольких параллельных отчётах пул встаёт.

**Как правильно:**
```kotlin
class ReportService(private val io: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(10)) {
    suspend fun report(): Report {
        val rows = withContext(io) { runInterruptible { jdbcTemplate.query("select …") } }
        return withContext(Dispatchers.Default) { buildReport(rows) }   // CPU — на Default
    }
}
```
**Формулировка:** «блокировки — на IO с лимитом под пул соединений, вычисления — на Default».
</details>

### Баг 5. Handler на дочерней корутине (senior)

```kotlin
scope.launch {
    launch(CoroutineExceptionHandler { _, e -> log.error("упало", e) }) {
        risky()
    }
}
```

<details><summary>Разбор</summary>

**Что не так.** `CoroutineExceptionHandler` действует только для корневой корутины scope. У дочерней он
игнорируется: исключение уйдёт родителю и отменит всё поддерево.

**Как правильно:** ставить handler в контекст самого scope
```kotlin
val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + handler)
```
или ловить ошибку внутри корутины через `try/catch`.
**Формулировка:** «handler — свойство корня, а не каждой корутины».
</details>

### Баг 6. `GlobalScope` в сервисе (middle)

```kotlin
fun handleRequest(req: Request): Response {
    GlobalScope.launch { audit.write(req) }
    return process(req)
}
```

<details><summary>Разбор</summary>

**Что не так.** Задача не привязана ни к чему: её никто не отменит при остановке сервиса, ошибки уйдут в
глобальный обработчик, контекст (MDC, requestId) не унаследуется. При деплое часть аудита просто потеряется.

**Как правильно:**
```kotlin
class RequestHandler(private val scope: CoroutineScope) {   // scope сервиса, закрывается при shutdown
    suspend fun handle(req: Request): Response {
        scope.launch { audit.write(req) }
        return process(req)
    }
}
```
**Формулировка:** «у каждой корутины должен быть владелец с понятным жизненным циклом».
</details>

### Баг 7. Гонка в `MutableStateFlow` (middle)

```kotlin
private val counter = MutableStateFlow(0)

fun increment() {
    counter.value = counter.value + 1
}
```

<details><summary>Разбор</summary>

**Что не так.** Классический read-modify-write: при конкурентных вызовах часть инкрементов теряется.

**Как правильно:** `counter.update { it + 1 }` (CAS-цикл) или `counter.compareAndSet(old, new)`.
**Формулировка:** «для чтения-модификации-записи в `StateFlow` есть `update`».
→ [`SHARED_STATE.md`](SHARED_STATE.md)
</details>

### Баг 8. Мутабельное состояние в `StateFlow` (senior)

```kotlin
private val _items = MutableStateFlow(mutableListOf<Item>())

fun add(item: Item) {
    _items.value.add(item)      // подписчики ничего не получат
}
```

<details><summary>Разбор</summary>

**Что не так.** Ссылка не изменилась, `equals` тот же — `StateFlow` не считает это обновлением, и подписчики не
получают уведомления. Плюс список меняется конкурентно без синхронизации.

**Как правильно:**
```kotlin
private val _items = MutableStateFlow<List<Item>>(emptyList())
fun add(item: Item) = _items.update { it + item }
```
**Формулировка:** «в `StateFlow` кладём только неизменяемые данные».
</details>

### Баг 9. Незащищённая коллекция из нескольких корутин (senior)

```kotlin
val results = mutableListOf<String>()
coroutineScope {
    ids.forEach { id ->
        launch(Dispatchers.Default) { results += load(id) }
    }
}
println(results.size)
```

<details><summary>Разбор</summary>

**Что не так.** `ArrayList` не потокобезопасен: конкурентные `add` из разных потоков теряют элементы или ломают
внутреннее состояние.

**Как правильно:**
```kotlin
val results = coroutineScope {
    ids.map { id -> async(Dispatchers.Default) { load(id) } }.awaitAll()   // порядок сохранён, гонок нет
}
```
или `Collections.synchronizedList` / `ConcurrentLinkedQueue`, если порядок не важен.
**Формулировка:** «результаты собираем через `awaitAll`, а не пишем в общую коллекцию».
→ [`SHARED_STATE.md`](SHARED_STATE.md)
</details>

### Баг 10. Утечка подписки в `callbackFlow` (middle)

```kotlin
fun ticks(): Flow<Tick> = callbackFlow {
    val sub = ticker.subscribe { trySend(it) }
    // забыли awaitClose
}
```

<details><summary>Разбор</summary>

**Что не так.** `callbackFlow` требует `awaitClose`: без него билдер сразу завершится и бросит
`IllegalStateException`, а подписка на внешний источник останется висеть.

**Как правильно:**
```kotlin
fun ticks(): Flow<Tick> = callbackFlow {
    val sub = ticker.subscribe { trySend(it) }
    awaitClose { sub.cancel() }
}
```
**Формулировка:** «`awaitClose` — это и есть точка отписки при отмене коллектора».
→ [`INTEROP.md`](INTEROP.md) §4
</details>

### Баг 11. Повтор отменённой операции (senior)

```kotlin
suspend fun <T> retry(times: Int, block: suspend () -> T): T {
    repeat(times - 1) {
        try { return block() } catch (e: Exception) { delay(100) }
    }
    return block()
}
```

<details><summary>Разбор</summary>

**Что не так.** `CancellationException` попадает в общий `catch`, и функция начинает повторять уже отменённую
операцию. Отмена перестаёт работать, запросы продолжают уходить.

**Как правильно:** добавить `catch (e: CancellationException) { throw e }` перед общим `catch`, фильтровать
retryable-ошибки и добавить экспоненциальный backoff с jitter.
→ [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md) §3, упражнение
[Ex12](../src/main/kotlin/exercises/Ex12_ResilientCalls.kt)
</details>

### Баг 12. Неограниченный параллелизм (middle)

```kotlin
suspend fun processAll(events: List<Event>) = coroutineScope {
    events.map { async { httpClient.post(it) } }.awaitAll()
}
```

<details><summary>Разбор</summary>

**Что не так.** На 10 000 событий это 10 000 одновременных запросов: исчерпание пула соединений, отказ внешнего
сервиса, таймауты по всей цепочке.

**Как правильно:**
```kotlin
suspend fun processAll(events: List<Event>, concurrency: Int = 16) = coroutineScope {
    val semaphore = Semaphore(concurrency)
    events.map { async { semaphore.withPermit { httpClient.post(it) } } }.awaitAll()
}
```
**Формулировка:** «конкурентность всегда ограничиваем: `Semaphore`, `limitedParallelism` или `flatMapMerge(n)`».
→ [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md) §2, упражнение
[Ex13](../src/main/kotlin/exercises/Ex13_BoundedParallelism.kt)
</details>

---

## Как считать результат

| Правильных из 30 | Что делать |
|---|---|
| < 15 | вернуться к [`BASICS.md`](BASICS.md), [`CANCELLATION_EXCEPTIONS.md`](CANCELLATION_EXCEPTIONS.md), [`FLOW.md`](FLOW.md) |
| 15–24 | разобрать конкретные провалы по ссылкам под ответами |
| > 24 | переходить к [`MOCK_INTERVIEW.md`](MOCK_INTERVIEW.md) |

Отдельно отметьте задачи, где ответ угадан «по ощущению»: на собеседовании спросят «почему», и
формулировка тезиса важнее самого вывода.
