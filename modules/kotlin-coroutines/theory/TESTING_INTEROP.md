# Testing & Interop

> Тестирование корутин с **виртуальным временем** и интероп с Java `CompletableFuture`, RxJava, callback API.
> Артефакт: `kotlinx-coroutines-test` (test scope), `kotlinx-coroutines-jdk8` для CompletableFuture-bridge.

---

## 1. `runTest` — точка входа в тест

```kotlin
import kotlinx.coroutines.test.runTest

@Test
fun myTest() = runTest {
    val r = computeAsync()
    assertEquals(42, r)
}
```

Что делает `runTest`:
1. Создаёт `TestScope` с `TestDispatcher`.
2. Запускает блок как корутину.
3. **Виртуальное время**: `delay(1000)` мгновенно "проходит" — без реального ожидания.
4. По завершении — проверяет, что нет "висящих" корутин (если есть — fail).

Внутри `runTest` все `delay`/`withTimeout` работают на виртуальном времени, контролируемом тестом.

---

## 2. `TestDispatcher` — два варианта

| | `StandardTestDispatcher` | `UnconfinedTestDispatcher` |
|---|---|---|
| Запуск дочерних корутин | по очереди, lazily | сразу, eagerly |
| Контроль времени | вручную (`runCurrent`, `advanceTimeBy`) | вручную |
| Когда использовать | проверять precise timing, eager-семантику | если eager-старт упрощает тест |

```kotlin
@Test
fun standard() = runTest {
    // По default использует StandardTestDispatcher
    val job = launch { delay(1000); println("done") }
    // Здесь launch ещё НЕ начал выполнение
    runCurrent()                  // диспетчирует pending tasks
    advanceTimeBy(500)
    advanceTimeBy(500)
    job.join()
}

@Test
fun unconfined() = runTest(UnconfinedTestDispatcher()) {
    val job = launch { delay(1000); println("done") }
    // launch уже выполнил всё что мог до delay
    advanceTimeBy(1000)
    runCurrent()
    job.join()
}
```

### Ключевые методы

| Метод | Что делает |
|-------|-----------|
| `runCurrent()` | выполнить все таски, готовые к запуску прямо сейчас |
| `advanceTimeBy(ms)` | переместить виртуальное время и выполнить таски, чьи `delay` прошли |
| `advanceUntilIdle()` | пропустить время до тех пор, пока не останется задач |
| `currentTime` | текущее виртуальное время в мс |

---

## 3. Подмена `Dispatchers.Main` в тестах

Если код использует `Dispatchers.Main` (Android, Compose):

```kotlin
@OptIn(ExperimentalCoroutinesApi::class)
class MyTest {
    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun teardown() {
        Dispatchers.resetMain()
    }
}
```

Без этого `Dispatchers.Main` бросит `IllegalStateException` (нет реального main looper в JVM-юнит-тесте).

---

## 4. Тестирование `StateFlow` / `SharedFlow`

Hot flows никогда не завершаются — `toList()` зависнет. Решения:

### Вариант 1: launch + runCurrent

```kotlin
@Test
fun stateFlowTest() = runTest {
    val vm = CounterViewModel()
    val emitted = mutableListOf<Int>()
    val job = launch(UnconfinedTestDispatcher(testScheduler)) {
        vm.state.toList(emitted)
    }

    vm.inc()
    vm.inc()

    assertEquals(listOf(0, 1, 2), emitted)
    job.cancel()
}
```

### Вариант 2: Turbine (внешняя библиотека, идиоматично)

```kotlin
import app.cash.turbine.test

@Test
fun stateFlowTest() = runTest {
    val vm = CounterViewModel()
    vm.state.test {
        assertEquals(0, awaitItem())
        vm.inc()
        assertEquals(1, awaitItem())
        cancelAndIgnoreRemainingEvents()
    }
}
```

Turbine хорошо подходит когда нужно проверять отдельные emit'ы по очереди.

---

## 5. Интероп с `CompletableFuture`

Артефакт: `kotlinx-coroutines-jdk8`.

```kotlin
import kotlinx.coroutines.future.await
import kotlinx.coroutines.future.future

// Java's CompletableFuture → suspend
suspend fun loadFromJava(): Data {
    val cf: CompletableFuture<Data> = javaApi.fetchAsync()
    return cf.await()           // suspend, не блокирует поток
}

// suspend → CompletableFuture (для вызова из Java)
fun loadForJava(): CompletableFuture<Data> = scope.future {
    loadAsync()                  // suspend-функция
}
```

`future { }` — корутинный builder, возвращающий `CompletableFuture`. Используй его в **Java-facing API** (например, REST-контроллер на Spring WebFlux до миграции на co).

`await()` поддерживает отмену: при cancel корутины делает `cf.cancel(true)`.

---

## 6. Интероп с RxJava

Артефакт: `kotlinx-coroutines-rx2` или `-rx3`.

```kotlin
// Single → suspend
val data = single.await()

// Observable → Flow
val flow: Flow<T> = observable.asFlow()

// Flow → Observable
val obs: Observable<T> = flow.asObservable()

// suspend → Single (для вызова из Rx-кода)
val s: Single<Data> = rxSingle { loadAsync() }
```

Семантика отмены сохраняется: dispose'ишь Disposable → отменяется корутина.

---

## 7. Интероп с blocking Java API

Когда нет асинхронного аналога, заверни в `withContext(Dispatchers.IO)`:

```kotlin
suspend fun read(file: Path): String = withContext(Dispatchers.IO) {
    Files.readString(file)            // блокирующий
}
```

Если код делает блокирующие операции, которые поддерживают `interrupt`:

```kotlin
suspend fun longBlocking(): Result = runInterruptible(Dispatchers.IO) {
    legacyBlockingMethod()             // при cancel получит Thread.interrupt()
}
```

`runInterruptible` — обёртка, которая на `cancel` корутины вызывает `Thread.interrupt()` на потоке-исполнителе. Так блокирующая операция выйдет с `InterruptedException`.

---

## 8. Тестирование с виртуальным временем — типичный кейс

```kotlin
class Debouncer(scope: CoroutineScope, private val timeout: Long) {
    private val pending = MutableStateFlow<String?>(null)
    val output: StateFlow<String?> = pending
        .debounce(timeout)
        .stateIn(scope, SharingStarted.Eagerly, null)

    fun submit(s: String) { pending.value = s }
}

@Test
fun debouncesUnder300ms() = runTest {
    val d = Debouncer(this, 300)
    d.submit("a"); advanceTimeBy(100)
    d.submit("b"); advanceTimeBy(100)
    d.submit("c")
    advanceTimeBy(299)
    assertEquals(null, d.output.value)         // ещё не прошло debounce
    advanceTimeBy(2)                            // итого 301 после "c"
    assertEquals("c", d.output.value)
}
```

Без виртуального времени тест бы выполнялся 600 мс и был бы flaky. С `runTest` — мгновенно и детерминированно.

---

## 9. Тестирование исключений

```kotlin
@Test
fun cancellation() = runTest {
    val job = launch {
        try {
            delay(1000)
        } finally {
            // важно: assertion в finally
            assertTrue(coroutineContext[Job]?.isCancelled == true)
        }
    }
    advanceTimeBy(500)
    job.cancelAndJoin()
}

@Test
fun timeoutThrows() = runTest {
    assertFailsWith<TimeoutCancellationException> {
        withTimeout(500) {
            delay(1000)
        }
    }
}
```

---

## 10. Анти-паттерны

### 10.1 `Thread.sleep` в тесте

```kotlin
@Test
fun bad() = runTest {
    launch { delay(1000); doX() }
    Thread.sleep(1500)                 // ❌ реальный sleep
    assertX()
}
```

`Thread.sleep` блокирует тред реально. Замени на `advanceTimeBy(1500)` или `advanceUntilIdle()`.

### 10.2 Использование `runBlocking` в тестах

`runBlocking { }` работает с реальным временем — `delay` будет ждать на самом деле. Тесты медленные и flaky. Используй `runTest`.

### 10.3 Не подменять `Dispatchers.Main`

Тест UI-кода с реальным `Dispatchers.Main` упадёт в JVM-юнит-тесте. Подменяй через `Dispatchers.setMain(testDispatcher)`.

### 10.4 Утечка корутин из `runTest`

Если `runTest` обнаружил, что после завершения теста есть активные дочерние корутины — упадёт. Канселить вручную или использовать `coroutineContext.cancelChildren()`.

---

## Шпаргалка

```kotlin
// Базовый тест
@Test fun t() = runTest {
    val r = doAsync()
    assertEquals(42, r)
}

// Виртуальное время
runTest {
    val job = launch { delay(1000); ... }
    advanceTimeBy(1000)
    job.join()
}

// Подмена Main
@BeforeTest fun setup() = Dispatchers.setMain(UnconfinedTestDispatcher())
@AfterTest fun teardown() = Dispatchers.resetMain()

// Java interop
val cf: CompletableFuture<Data> = scope.future { loadAsync() }
val data = cf.await()
```

---

## Источники

**Официальная документация:**
- [`kotlinx-coroutines-test` API reference](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/) — `runTest`, `TestScope`, `StandardTestDispatcher`, `UnconfinedTestDispatcher`.
- [Migration guide: kotlinx-coroutines-test 1.6+](https://github.com/Kotlin/kotlinx.coroutines/blob/1.6.0/kotlinx-coroutines-test/MIGRATION.md) — переход с `runBlockingTest` на `runTest`.
- [`Dispatchers.setMain` / `resetMain` (Android)](https://developer.android.com/kotlin/coroutines/test) — рекомендованный паттерн для UI-тестов.

**Tooling:**
- [Turbine (Cash App)](https://github.com/cashapp/turbine) — must-have для тестирования `Flow` (`expectItem`, `expectComplete`, `expectError`).
- [MockK](https://mockk.io/) — `coEvery`, `coVerify` для suspend-функций.

**Posts:**
- [Sebastian Aigner — «Coroutines testing: hands-on»](https://kotlinlang.org/docs/coroutines-and-channels.html#testing-coroutines)
- [Manuel Vivo — «Testing Kotlin coroutines on Android» (Android Devs)](https://medium.com/androiddevelopers/testing-kotlin-coroutines-on-android-fa61d5e95cca)
- [Roman Elizarov — «What is `kotlinx.coroutines.test` for?» (issue discussion)](https://github.com/Kotlin/kotlinx.coroutines/issues/1996)

**Java interop:**
- [`kotlinx-coroutines-jdk8`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.future/) — `CompletableFuture.await()`, `future { ... }`.
- [`kotlinx-coroutines-reactor` / `-rx3`](https://kotlinlang.org/api/kotlinx.coroutines/) — interop с реактивными мирами.

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Moskała)](https://kt.academy/book/coroutines) — глава «Testing Kotlin Coroutines».
