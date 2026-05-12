# Dispatchers

> **Dispatcher** определяет, на каком потоке (или пуле потоков) исполняется корутина.
> Под капотом — `ContinuationInterceptor`, который перехватывает каждое возобновление (`resume`) suspend-функции и решает, на каком потоке продолжить.

---

## 1. Стандартные диспатчеры

| Диспатчер | Назначение | Размер пула |
|-----------|-----------|-------------|
| `Dispatchers.Default` | CPU-bound (вычисления, парсинг, сериализация) | `max(2, Runtime.availableProcessors())` |
| `Dispatchers.IO` | блокирующий IO (JDBC, file I/O, blocking HTTP) | до 64 (или `kotlinx.coroutines.io.parallelism`), elastic |
| `Dispatchers.Main` | UI-поток (Android, Swing, JavaFX) | 1 (только сам UI-thread) |
| `Dispatchers.Unconfined` | НЕ переключает поток — продолжает на том, где `resume` сделал | – |

### `Dispatchers.Default`

CPU-bound пул. Размер фиксирован, обычно = кол-во ядер. Не используй его для блокирующих операций — забьёшь пул и встанут ВСЕ CPU-задачи.

### `Dispatchers.IO`

Под капотом **тот же пул**, что у `Default`, но с большим лимитом потоков (до 64). Реализован через `LimitedDispatcher` — это **view** на shared scheduler. Поэтому `Default` и `IO` могут шарить потоки.

Главная цель: дать корутинам, выполняющим блокирующий код (`Thread.sleep`, JDBC, `File.readText()`), отдельный пул, чтобы они не съели весь `Default`.

### `Dispatchers.Main`

В JVM-only приложении его **нет** — нужен соответствующий артефакт (`kotlinx-coroutines-android`, `-javafx`, `-swing`). Без него `Dispatchers.Main` бросит `IllegalStateException` при первом обращении.

В тестах подменяется через `Dispatchers.setMain(TestDispatcher)` (см. `TESTING_INTEROP.md`).

### `Dispatchers.Unconfined`

Запускает корутину **в текущем потоке**, до первой suspension point. После suspension возобновится на том потоке, который сделал `resume` (часто это поток внутреннего таймера для `delay`).

Использовать в продакшене **редко**. В основном — для:
- внутренних оптимизаций библиотек (`flow.collect`)
- тестов, где не нужно переключение потоков

```kotlin
launch(Dispatchers.Unconfined) {
    println(Thread.currentThread().name)  // main
    delay(100)
    println(Thread.currentThread().name)  // kotlinx.coroutines.DefaultExecutor
}
```

---

## 2. `withContext` — главный инструмент смены диспатчера

```kotlin
suspend fun loadAndRender(): Bitmap = withContext(Dispatchers.IO) {
    val bytes = readFile()                    // на IO
    withContext(Dispatchers.Default) {
        decodeBitmap(bytes)                   // на Default (CPU)
    }
}
```

`withContext` **не запускает** новую корутину — он переключает диспатчер для блока внутри текущей. Возвращает результат напрямую.

### Когда `withContext` действительно переключает поток?

`withContext(ctx)` оптимизирован: если в `ctx` тот же диспатчер, что уже активен, — **переключения нет** (fast path). Это значит, что вызов `withContext(Dispatchers.IO) { ... }` дешёв, если ты уже на IO.

---

## 3. `limitedParallelism` — гранулярный контроль

`Dispatchers.IO` имеет до 64 потоков. Если ты хочешь дать **только 4** потока на работу с конкретной БД (чтобы не перегрузить connection pool):

```kotlin
val dbDispatcher = Dispatchers.IO.limitedParallelism(4)

suspend fun query(): Row = withContext(dbDispatcher) {
    jdbcQuery()
}
```

`limitedParallelism(N)` создаёт **view** на исходный диспатчер, гарантируя, что в любой момент времени параллельно работает не более N корутин.

**Зачем это нужно:**
- Connection pool ограничен (например, HikariCP с pool=10).
- Если запустишь 64 параллельных запроса через `Dispatchers.IO` — 54 корутины зависнут на `getConnection()`, заблокировав потоки.
- С `limitedParallelism(10)` — никогда не запросим больше, чем доступно.

Также подходит для:
- Внешних API с rate-limit
- Disk I/O, где параллельность хуже (HDD)

Под капотом — `LimitedDispatcher`, основанный на семафоре.

---

## 4. Когда какой диспатчер

```kotlin
// CPU-bound (парсинг, сериализация, шифрование)
withContext(Dispatchers.Default) { ... }

// Блокирующий IO (JDBC, file, classic HTTP)
withContext(Dispatchers.IO) { ... }

// UI (Android/JavaFX/Swing — нужен соответствующий артефакт)
withContext(Dispatchers.Main) { ... }

// БД с ограниченным connection pool
val dbCtx = Dispatchers.IO.limitedParallelism(10)
withContext(dbCtx) { ... }

// Внешний API с rate limit
val apiCtx = Dispatchers.IO.limitedParallelism(5)
```

Если используешь **non-blocking** клиент (Reactor Netty, Ktor с CIO, Vert.x) — диспатчер обычно не важен, можно `Default`.

---

## 5. Почему НЕ стоит использовать `runBlocking` для смены диспатчера

```kotlin
// ❌ Плохо
suspend fun foo() = runBlocking(Dispatchers.IO) { bar() }

// ✅ Хорошо
suspend fun foo() = withContext(Dispatchers.IO) { bar() }
```

`runBlocking` блокирует текущий поток. `withContext` — не блокирует. В suspend-функции всегда `withContext`.

---

## 6. Внутреннее устройство (коротко)

`CoroutineDispatcher` extends `ContinuationInterceptor`. Главный метод:

```kotlin
abstract fun dispatch(context: CoroutineContext, block: Runnable)
```

Когда suspend-функция возобновляется, рантайм вызывает `interceptContinuation(cont)` → возвращается `DispatchedContinuation`, который при `resumeWith()` ставит блок в очередь диспатчера.

Это объясняет, почему смена диспатчера **дешёвая** — не создаются новые потоки, просто переключение очереди.

---

## 7. Тестовые диспатчеры

Из `kotlinx-coroutines-test`:

| Диспатчер | Поведение |
|-----------|-----------|
| `StandardTestDispatcher` | задачи буферизуются, `runCurrent()` / `advanceTimeBy()` контролирует выполнение. Канонический для тестов. |
| `UnconfinedTestDispatcher` | как `Unconfined`, но с виртуальным временем. Запускает eagerly. |

Подробно — в `TESTING_INTEROP.md`.

---

## 8. Особенности `Dispatchers.IO` после Kotlin 1.7+

С 1.7 пул `IO` и `Default` разделяют один общий **scheduler**. Это означает:
- Поток из `Default` может быть переиспользован для `IO` (если `IO` нужны новые потоки).
- Лимит `IO` (64) считается отдельно — но физические потоки шарятся.
- Параметр `kotlinx.coroutines.io.parallelism` можно переопределить системным свойством.

Это деталь реализации — на уровне API остаётся тот же контракт: `Default` для CPU, `IO` для блокировок.

---

## Шпаргалка

```kotlin
withContext(Dispatchers.Default)               // CPU
withContext(Dispatchers.IO)                    // blocking IO
withContext(Dispatchers.Main)                  // UI
withContext(Dispatchers.IO.limitedParallelism(10))  // bounded IO

// НЕ используй runBlocking в suspend
// НЕ используй Default для blocking IO
// НЕ используй Unconfined в продакшене
```

---

## Источники

**Официальная документация:**
- [Coroutine Context and Dispatchers](https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html)
- [`CoroutineDispatcher` Javadoc](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-dispatcher/) — `dispatch`, `interceptContinuation`, `limitedParallelism`.

**KEEPs / спецификация:**
- [KEEP-176: Coroutines](https://github.com/Kotlin/KEEP/blob/master/proposals/coroutines.md) — раздел про dispatchers и interception.

**Talks / posts:**
- [Vsevolod Tolstopyatov — «Concurrent coroutines: deep dive» (KotlinConf 2021)](https://www.youtube.com/watch?v=zluKcazgkV4) — внутренности scheduler'а, IO/Default объединение.
- [Roman Elizarov — «Blocking threads, suspending coroutines»](https://elizarov.medium.com/blocking-threads-suspending-coroutines-d33e11bf4761) — почему `Default` для CPU и `IO` для блокировок.
- [Manuel Vivo — «Coroutines on Android (part III): Real work»](https://medium.com/androiddevelopers/coroutines-on-android-part-iii-real-work-2ba8a2ec2f45) — dispatcher-выбор на практике.

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Moskała)](https://kt.academy/book/coroutines) — глава по dispatchers, custom dispatchers.
