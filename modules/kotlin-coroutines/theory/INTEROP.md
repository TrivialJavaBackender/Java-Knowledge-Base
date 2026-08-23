# Интероп — как подружить корутины с тем, что уже написано

> **Какую проблему решает.** В реальном проекте корутины не начинаются с чистого листа: вокруг уже
> есть колбек-API, `CompletableFuture`, блокирующий JDBC и Java-код, который надо чем-то вызывать.
> Этот файл — про мосты в обе стороны.
> **Кому это надо.** Тому, кто внедряет корутины в существующий сервис или пишет библиотеку-обёртку
> над чужим SDK.
> **Когда НЕ надо.** В гринфилде, где весь стек уже корутинный, хватит `BASICS.md` и `FLOW.md`.

Механику, на которой всё это держится, разбирает
[`SUSPEND_INTERNALS.md`](SUSPEND_INTERNALS.md): возобновить корутину — значит вызвать
`resumeWith` у её продолжения. Все мосты ниже — вариации на эту тему.

Сквозная задача — та же, что в [`WHY_COROUTINES.md`](WHY_COROUTINES.md): загрузить профиль
пользователя. Меняется только то, в каком виде эта загрузка уже существует.

---

## Карта мостов

| Что есть | Что нужно | Инструмент |
|---|---|---|
| Колбек `fetch(id, onSuccess, onError)` | `suspend fun` | `suspendCancellableCoroutine` |
| `CompletableFuture` / `CompletionStage` | `suspend fun` | `.await()` |
| `CompletableFuture` | `Deferred` | `.asDeferred()` |
| Блокирующий метод (JDBC, `Files`, legacy SDK) | `suspend fun` | `withContext(io) { runInterruptible { … } }` |
| Поток событий на слушателе | `Flow` | `callbackFlow` + `awaitClose` |
| `suspend fun` | `CompletableFuture` для Java | `scope.future { … }` |
| `suspend fun` | `Mono` / `Single` | `mono { }` / `rxSingle { }` (отдельные артефакты) |
| `Flow` | `Publisher` / `Flux` / `Observable` | `asPublisher()` / `asFlux()` / `asObservable()` |

---

## 1. Мост из колбек-API

Самый частый и самый важный случай. Есть библиотека, которая умеет только так:

```kotlin
interface ProfileApi {
    fun fetch(id: Long, onSuccess: (Profile) -> Unit, onError: (Throwable) -> Unit): Cancellable
}
```

Превращаем в suspend-функцию:

```kotlin
suspend fun ProfileApi.fetch(id: Long): Profile =
    suspendCancellableCoroutine { cont ->
        val call = fetch(
            id = id,
            onSuccess = { profile -> cont.resume(profile) },
            onError = { e -> cont.resumeWithException(e) },
        )
        cont.invokeOnCancellation { call.cancel() }
    }
```

Что здесь происходит по шагам:

1. `suspendCancellableCoroutine` приостанавливает текущую корутину и **отдаёт её продолжение**
   (`cont`) в лямбду. Функция уже вернула `COROUTINE_SUSPENDED` — поток свободен.
2. Мы регистрируем колбеки библиотеки, которые вызовут `cont.resume(...)` или
   `cont.resumeWithException(...)`. Это и есть возобновление: библиотека, сама того не зная, играет
   роль «того, у кого появился результат».
3. `invokeOnCancellation` — обратная связь: если корутину отменят раньше, чем придёт ответ, мы
   отменим и сам запрос.

### Три правила, которые ломают этот мост чаще всего

**`resume` вызывается ровно один раз.** Второй вызов — `IllegalStateException`. Типичный источник:
кривой SDK, который при таймауте зовёт и `onError`, и `onSuccess`. Защита — `cont.isActive` или
неблокирующий вариант:

```kotlin
onSuccess = { profile ->
    cont.tryResume(profile)?.let { token -> cont.completeResume(token) }
}
```

**Без `invokeOnCancellation` отмена не доходит до библиотеки.** Корутина завершится, а HTTP-запрос
продолжит жить, держать соединение и в итоге вызовет колбек в пустоту. Это утечка, которую сложно
заметить: тесты зелёные, а под нагрузкой пул соединений заканчивается.

**`invokeOnCancellation` вызывается на неизвестном потоке и не должен делать ничего долгого.**
Внутри — только «отпустить ресурс»: `call.cancel()`, `subscription.close()`.

### `suspendCoroutine` против `suspendCancellableCoroutine`

| | `suspendCoroutine` | `suspendCancellableCoroutine` |
|---|---|---|
| Тип продолжения | `Continuation` | `CancellableContinuation` |
| Реакция на отмену | нет: ожидание неотменяемое | есть, плюс `invokeOnCancellation` |
| Когда применять | практически никогда | всегда, когда мостите колбек |

Практика — упражнение [Ex09](../src/main/kotlin/exercises/Ex09_SuspendInternals.kt).

---

## 2. Мост из `CompletableFuture`

**Важно про артефакт.** Отдельная зависимость `kotlinx-coroutines-jdk8` больше не нужна: начиная с
1.7 весь этот API живёт прямо в `kotlinx-coroutines-core` (пакет `kotlinx.coroutines.future`).
Достаточно импорта.

```kotlin
import kotlinx.coroutines.future.await
import kotlinx.coroutines.future.asDeferred
import kotlinx.coroutines.future.future
import kotlinx.coroutines.future.asCompletableFuture
```

### Внутрь: future → suspend

```kotlin
suspend fun loadProfile(id: Long): Profile {
    val cf: CompletableFuture<Profile> = javaApi.fetchAsync(id)
    return cf.await()          // приостанавливаемся, поток свободен
}
```

`await()` — это тот же мост из §1: он вешает `whenComplete` на future и отдаёт туда продолжение.
Отмена сквозная: если отменить корутину, `await()` вызовет `cancel(false)` у future.

Если нужен не результат, а «запущенная работа», к которой можно присоединиться позже:

```kotlin
val deferred: Deferred<Profile> = javaApi.fetchAsync(id).asDeferred()
```

### Наружу: suspend → future

Нужно, когда корутинный код вызывают из Java или из фреймворка, который понимает только
`CompletionStage`:

```kotlin
class ProfileFacade(private val scope: CoroutineScope) {
    fun loadForJava(id: Long): CompletableFuture<Profile> = scope.future {
        loadProfile(id)         // обычная suspend-функция
    }
}
```

`future { }` — корутинный билдер: запускает корутину в переданном scope и связывает её с future в
обе стороны. `future.cancel(true)` отменит корутину; ошибка корутины завершит future
исключительно.

Обратите внимание на `scope`: билдер требует владельца жизненного цикла — это тот самый адаптер «на
границе», о котором говорит [`WHY_COROUTINES.md`](WHY_COROUTINES.md) §8. Использовать здесь
`GlobalScope` — значит потерять отмену.

Есть и обратное преобразование без билдера:

```kotlin
val cf: CompletableFuture<Profile> = deferred.asCompletableFuture()
```

> Само API `CompletableFuture` (устройство, цепочки, `thenCompose`, ловушки) — в
> [`concurrency/theory/ASYNC_COMPOSITION.md`](../../concurrency/theory/ASYNC_COMPOSITION.md).

---

## 3. Мост из блокирующего Java-API

Здесь моста в строгом смысле нет: блокирующий вызов приостановить нельзя, его можно только увести с
глаз долой. Задача сводится к двум вопросам — **на каком потоке блокироваться** и **как прервать
блокировку при отмене**.

```kotlin
class UserRepository(
    private val io: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(10),
) {
    suspend fun findById(id: Long): User? = withContext(io) {
        runInterruptible {
            jdbc.queryForObject("select … where id = ?", id)
        }
    }
}
```

- **`withContext(io)`** уводит блокировку в пул, который не жалко заблокировать. Размер
  `limitedParallelism` согласуют с пулом соединений: держать больше корутин, чем есть соединений,
  бессмысленно — они всё равно встанут в очередь за соединением (см. [`DISPATCHERS.md`](DISPATCHERS.md)).
- **`runInterruptible`** переводит отмену корутины в `Thread.interrupt()` на исполняющем потоке.
  Без него отменённый запрос продолжит выполняться в БД и держать соединение до конца — отмена
  «дойдёт» только до кода вокруг, но не до драйвера.

Прервать `interrupt`-ом можно не всё: он работает для `InterruptibleChannel`, сокетов с таймаутом,
`Thread.sleep`, многих JDBC-драйверов — но, например, чистый `InputStream.read` по обычному сокету
может не прерваться. Второй рубеж — таймаут на уровне самого драйвера (`queryTimeout`,
`socketTimeout`).

Альтернатива на JDK 21 — диспетчер на виртуальных потоках:

```kotlin
Executors.newVirtualThreadPerTaskExecutor().asCoroutineDispatcher().use { vt ->
    withContext(vt) { blockingCall() }
}
```

Блокировка становится дешёвой, но лимит всё равно нужен — его роль возьмёт на себя пул соединений
или семафор. Подробности про сами виртуальные потоки —
[`concurrency/theory/VIRTUAL_THREADS.md`](../../concurrency/theory/VIRTUAL_THREADS.md).

---

## 4. Мост из потока событий: `callbackFlow`

Если колбек вызывается **много раз** (тикер цен, слушатель сообщений, watcher файлов), одного
продолжения мало — нужен `Flow`:

```kotlin
fun PriceTicker.prices(symbol: String): Flow<PriceUpdate> = callbackFlow {
    val subscription = subscribe(symbol, object : Listener {
        override fun onUpdate(update: PriceUpdate) {
            trySend(update)                 // не suspend: колбек может прийти откуда угодно
        }
        override fun onError(e: Throwable) {
            close(e)                        // ошибка источника завершает Flow этой же ошибкой
        }
    })
    awaitClose { subscription.cancel() }    // обязательно: иначе подписка утечёт
}
```

Ключевые отличия от §1:

- `callbackFlow` внутри устроен на канале, поэтому `trySend` можно звать из любого потока;
- `awaitClose { }` **обязателен** — без него билдер бросит `IllegalStateException`, потому что иначе
  Flow завершился бы сразу и подписка осталась висеть;
- `close(cause)` доставляет ошибку источника коллектору; просто «замолчать» нельзя — коллектор решит,
  что данные кончились штатно.

Что делать, если события приходят быстрее, чем их читают, — вопрос обратного давления (backpressure), разбор в
[`FLOW.md`](FLOW.md). Практика — упражнение
[Ex18](../src/main/kotlin/exercises/Ex18_CallbackFlowBridge.kt).

---

## 5. Наружу: Reactor, RxJava, Reactive Streams

Нужно, когда сервис живёт в реактивном стеке (Spring WebFlux, RxJava-код) и корутинную функцию надо
отдать наружу в его терминах.

```kotlin
// Требуют отдельных артефактов, в pom.xml этого модуля их нет:
//   kotlinx-coroutines-reactor  → mono { }, awaitSingle(), asFlux()
//   kotlinx-coroutines-rx3      → rxSingle { }, await(), asObservable()
//   kotlinx-coroutines-reactive → asPublisher(), Publisher.asFlow()

fun loadForWebFlux(id: Long): Mono<Profile> = mono { loadProfile(id) }

suspend fun fromReactor(): Profile = webClient.get()… .awaitSingle()

val flux: Flux<Item> = itemsFlow.asFlux()
val flow: Flow<Item> = somePublisher.asFlow()
```

Отмена сквозная в обе стороны: `dispose()` подписки отменяет корутину, отмена корутины отменяет
подписку.

**Разница моделей обратного давления**, которую стоит уметь проговорить: в Reactive Streams потребитель
явно просит порцию через `request(n)`; в `Flow` того же добиваются приостановкой `emit` — продюсер
не может опередить коллектора, потому что `emit` не вернётся, пока значение не обработано.
Конвертация двусторонняя и это соответствие сохраняет.

---

## 6. Правила, чтобы мосты не превратились в кашу

1. **Мост живёт на границе, а не в середине.** Один адаптер на входе в модуль и один на выходе;
   внутри — обычный корутинный код. Разбросанные по всему коду `future { }` и `runBlocking` — признак
   того, что границу не провели.
2. **`runBlocking` — не мост, а затычка.** В продакшен-коде он допустим только в `main` и в
   реализации блокирующего интерфейса, который нельзя изменить. Он блокирует поток и лишает
   вызывающего возможности отменить операцию.
3. **Каждому мосту наружу нужен scope с понятным владельцем** — иначе задача переживёт компонент.
4. **Отмена должна доезжать до конца.** Проверьте на каждом мосту: что произойдёт с внешним
   вызовом, если отменить корутину? Если ответ «ничего» — это утечка.
5. **Диспетчер — параметром.** Мост, жёстко прибитый к `Dispatchers.IO`, невозможно протестировать
   на виртуальном времени (см. [`TESTING_INTEROP.md`](TESTING_INTEROP.md)).

---

## Шпаргалка

```kotlin
// Колбек → suspend
suspend fun fetch(id: Long): Data = suspendCancellableCoroutine { cont ->
    val call = api.fetchAsync(id, { cont.resume(it) }, { cont.resumeWithException(it) })
    cont.invokeOnCancellation { call.cancel() }
}

// CompletableFuture ↔ корутины  (kotlinx.coroutines.future, входит в core)
val data = cf.await()
val deferred = cf.asDeferred()
fun forJava(): CompletableFuture<Data> = scope.future { fetch(1) }

// Блокирующий вызов
suspend fun query(): Row = withContext(io) { runInterruptible { jdbc.query(…) } }

// Много событий → Flow
fun updates(): Flow<Update> = callbackFlow {
    val sub = source.subscribe({ trySend(it) }, { close(it) })
    awaitClose { sub.cancel() }
}
```

- `suspendCancellableCoroutine` + `invokeOnCancellation` — всегда; `suspendCoroutine` — почти никогда.
- `resume` ровно один раз; иначе `IllegalStateException`.
- `await()`/`future { }` лежат в `kotlinx-coroutines-core`, отдельный `-jdk8` не нужен.
- Блокирующий вызов: `withContext(io) { runInterruptible { … } }`, размер `io` = размеру пула соединений.
- `callbackFlow` без `awaitClose` — ошибка и утечка подписки.
- Мост — на границе модуля; `runBlocking` в середине — затычка, а не решение.

---

## Источники

**Исходники (по ним сверен §2):**
- `kotlinx-coroutines-core` → `jvmMain/future/Future.kt`: `future`, `asCompletableFuture`, `asDeferred`, `CompletionStage.await`.
- `kotlinx-coroutines-core` → `jvmMain/Interruptible.kt`: `runInterruptible`.

**Официальная документация:**
- [`suspendCancellableCoroutine`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/suspend-cancellable-coroutine.html)
- [`callbackFlow`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/callback-flow.html)
- [`runInterruptible`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/run-interruptible.html)
- [Модули интеграции `kotlinx.coroutines`](https://github.com/Kotlin/kotlinx.coroutines#modules) — reactive, reactor, rx3, slf4j, jdk9.

**Posts:**
- [Roman Elizarov — «Callbacks and Kotlin Flows»](https://elizarov.medium.com/callbacks-and-kotlin-flows-2b53aa2525cf) — когда `suspendCancellableCoroutine`, а когда `callbackFlow`.

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Marcin Moskała)](https://kt.academy/book/coroutines) — глава «Coroutines under the hood» и раздел про интеграцию с существующим кодом.
