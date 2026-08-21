# Тестирование корутин

> **Какую проблему решает.** Тест с `delay(5.seconds)` не должен идти пять секунд, а тест
> конкурентного кода не должен быть флаки. Всё это даёт виртуальное время `runTest`.
> **Кому это надо.** Всем, кто пишет корутинный код: без инжекта диспетчера код нетестируем, и это
> выясняется поздно.
> **Когда НЕ надо.** Для чисто последовательной suspend-функции без задержек хватит обычного
> `runTest { }` без управления временем.
>
> Артефакт: `kotlinx-coroutines-test` (test scope).
> Интероп с `CompletableFuture`, Rx и колбеками вынесен в отдельный файл — [`INTEROP.md`](INTEROP.md).

**Главный тезис файла:** виртуальное время работает только для корутин на **тестовом** диспетчере.
Жёстко зашитый в код `Dispatchers.IO` превращает быстрый тест в `Thread.sleep`-тест — см. §5.

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

## 4. `backgroundScope` и почему тест зависает

Типичная картина: тест собирает горячий поток и **не завершается**.

```kotlin
@Test
fun bad() = runTest {
    launch { hotFlow.collect { … } }   // ❌ никогда не закончится
    assertEquals(1, service.value)
}                                       // runTest ждёт всех детей → зависание
```

Причина: `runTest` реализует структурную конкурентность — он ждёт завершения всех корутин,
запущенных в его scope. Бесконечный сбор не завершится никогда, и тест повиснет (а если корутина
останется активной после теста — `runTest` упадёт на утечке).

Для этого есть `backgroundScope`: корутины в нём живут, пока идёт тест, и **автоматически
отменяются**, когда тело теста дошло до конца.

```kotlin
@Test
fun good() = runTest {
    val seen = mutableListOf<Int>()
    backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
        service.state.collect { seen += it }
    }

    service.inc()
    runCurrent()

    assertEquals(listOf(0, 1), seen)
}                                       // сбор отменён автоматически
```

Правило: **всё, что должно работать «фоном» в течение теста, запускается в `backgroundScope`** —
подписки на горячие потоки, сервисы-демоны, мосты наружу (`future { }`, `mono { }`).

---

## 5. Тестирование `StateFlow` / `SharedFlow`

Hot flows никогда не завершаются — `toList()` зависнет. Решения:

### Вариант 1: launch в backgroundScope + runCurrent

```kotlin
@Test
fun stateFlowTest() = runTest {
    val vm = CounterViewModel()
    val emitted = mutableListOf<Int>()
    backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
        vm.state.toList(emitted)
    }

    vm.inc()
    vm.inc()

    assertEquals(listOf(0, 1, 2), emitted)
}   // сбор отменится сам вместе с backgroundScope
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

## 6. Интероп с существующим кодом — карта

Подробный разбор каждого моста — в [`INTEROP.md`](INTEROP.md). Здесь только карта, чтобы знать,
что искать:

| Что есть | Что нужно | Инструмент |
|---|---|---|
| колбек-API | `suspend fun` | `suspendCancellableCoroutine` + `invokeOnCancellation` |
| `CompletableFuture` | `suspend fun` / `Deferred` | `.await()` / `.asDeferred()` |
| `suspend fun` | `CompletableFuture` для Java | `scope.future { … }` |
| блокирующий метод | `suspend fun` | `withContext(io) { runInterruptible { … } }` |
| слушатель событий | `Flow` | `callbackFlow` + `awaitClose` |
| Reactor / RxJava | оба направления | `mono { }`, `rxSingle { }`, `asFlow()`, `asFlux()` |

Два факта, важных именно для тестов:

- `await()` и `future { }` живут в `kotlinx-coroutines-core` (пакет `kotlinx.coroutines.future`) —
  отдельный артефакт `kotlinx-coroutines-jdk8` не нужен.
- Мост наружу (`future { }`, `mono { }`) требует scope. В тесте передавайте `backgroundScope`
  (§4) — иначе `runTest` либо зависнет в ожидании, либо упадёт на утечке корутин.

---

## 7. Проверка параллельности и конкурентности

Два вопроса, которые обычно и надо проверить в тесте конкурентного кода.

**«Действительно ли вызовы шли параллельно?»** — смотрим на виртуальные часы, а не на настенные:

```kotlin
@Test
fun `три вызова по 300 мс идут параллельно`() = runTest {
    val page = buildPage(userId = 1)          // внутри три async по delay(300)

    assertEquals(300, currentTime)            // было бы 900 при последовательном коде
}
```

`currentTime` — виртуальное время `TestScope`. Реальный тест при этом отрабатывает мгновенно.

**«Не превышен ли лимит конкурентности?»** — считаем сами, а не угадываем по таймингам:

```kotlin
@Test
fun `одновременно не больше четырёх`() = runTest {
    val active = AtomicInteger()
    val peak = AtomicInteger()

    (1..50).map { id ->
        async {
            val now = active.incrementAndGet()
            peak.updateAndGet { maxOf(it, now) }
            try { delay(100) } finally { active.decrementAndGet() }
        }
    }.awaitAll()

    assertTrue(peak.get() <= 4, "пиковая конкурентность ${peak.get()}, ожидали ≤ 4")
}
```

Это же приём используют тесты упражнений
[Ex13](../src/main/kotlin/exercises/Ex13_BoundedParallelism.kt) и
[Ex15](../src/main/kotlin/exercises/Ex15_RateLimiter.kt).

---

## 8. Тестирование отмены и очистки

```kotlin
@Test
fun `ресурс закрывается при отмене`() = runTest {
    val resource = FakeResource()

    val job = launch { useResource(resource) }
    runCurrent()                       // дали корутине стартовать
    job.cancelAndJoin()                // отмена + ожидание finally

    assertTrue(resource.closed)
}
```

Что важно:

- `cancelAndJoin()`, а не `cancel()`: `cancel()` только помечает `Job`, и проверка сработает
  раньше, чем отработает `finally`.
- `runCurrent()` перед отменой — иначе корутина, запущенная на `StandardTestDispatcher`, ещё не
  начинала выполняться и отменять будет нечего.
- Если очистка внутри `finally` — suspend, она должна быть в `withContext(NonCancellable)`, иначе
  упадёт на первой же приостановке (см. [`CANCELLATION_EXCEPTIONS.md`](CANCELLATION_EXCEPTIONS.md)).

---

## 9. Тестирование с виртуальным временем — типичный кейс

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

## 10. Тестирование исключений

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

## 11. Анти-паттерны

### 11.1 `Thread.sleep` в тесте

```kotlin
@Test
fun bad() = runTest {
    launch { delay(1000); doX() }
    Thread.sleep(1500)                 // ❌ реальный sleep
    assertX()
}
```

`Thread.sleep` блокирует тред реально. Замени на `advanceTimeBy(1500)` или `advanceUntilIdle()`.

### 11.2 Использование `runBlocking` в тестах

`runBlocking { }` работает с реальным временем — `delay` будет ждать на самом деле. Тесты медленные и flaky. Используй `runTest`.

### 11.3 Не подменять `Dispatchers.Main`

Тест UI-кода с реальным `Dispatchers.Main` упадёт в JVM-юнит-тесте. Подменяй через `Dispatchers.setMain(testDispatcher)`.

### 11.4 Утечка корутин из `runTest`

Если после завершения теста остались активные дочерние корутины, `runTest` упадёт по таймауту
ожидания. Правильное лечение — запускать фоновую работу в `backgroundScope` (§4), а не отменять
вручную. `coroutineContext.cancelChildren()` — крайняя мера, которая обычно означает, что тест
запустил что-то не в том scope.

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

// Фоновая работа на время теста
backgroundScope.launch { service.state.collect { … } }

// Параллельность видно по виртуальным часам
assertEquals(300, currentTime)
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
