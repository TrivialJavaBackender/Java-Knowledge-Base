# Kotlin Coroutines — Основы

> Что такое корутина, suspend-функции, корутинные билдеры (`launch`, `async`, `runBlocking`, `withContext`).
> Это **базовый** модуль — без него остальные не имеют смысла.

---

## 1. Что такое корутина

**Корутина** — это инстанс приостанавливаемого вычисления (suspendable computation).
Она похожа на поток в том смысле, что выполняет блок кода и работает параллельно с другим кодом.
Но в отличие от потока, **корутина не привязана к одному конкретному потоку** — она может приостановиться (suspend) на одном потоке и продолжить выполнение на другом.

Ключевые свойства:
- **Лёгкая** — миллионы корутин на одном JVM-потоке (пул из `Dispatchers.Default` обычно = `Runtime.availableProcessors()`).
- **Кооперативная** — приостанавливается только в точках, помеченных `suspend` (suspension point), а не вытесняется планировщиком ОС.
- **Структурирована** — у каждой корутины есть родитель; отмена/исключение распространяется по дереву (см. `STRUCTURED_CONCURRENCY.md`).

### Корутина ≠ поток

| | Поток (`Thread`) | Корутина |
|---|---|---|
| Создание | дорогое (~1 МБ стек, syscall) | дешёвое (объект на куче) |
| Блокировка | держит поток ОС | suspend → поток освобождается |
| Кол-во | сотни-тысячи | миллионы |
| Контекст | `ThreadLocal` | `CoroutineContext` (см. `SCOPE_CONTEXT.md`) |
| Жизненный цикл | NEW → RUNNABLE → ... | планируется через `Job` / `Dispatcher` |

---

## 2. suspend-функции

`suspend` — модификатор функции, означающий: "эта функция может приостановиться, не блокируя поток".

```kotlin
suspend fun fetchUser(id: Long): User {
    delay(100)              // suspension point — поток освобождается на 100 мс
    return api.getUser(id)
}
```

**Правила:**
1. `suspend`-функцию можно вызвать **только** из другой `suspend`-функции или из корутинного билдера (`launch`/`async`/`runBlocking`).
2. Обычная функция вызвать `suspend` не может — это compile-time ошибка.
3. `suspend`-функция **не означает** "выполнится асинхронно" — она просто *может* приостановиться. Её тело по умолчанию исполняется последовательно в текущем потоке.

### Что компилятор делает с suspend

Компилятор превращает `suspend`-функцию в state-machine с дополнительным параметром `Continuation<T>`. Подробно — в `SUSPEND_INTERNALS.md`. Кратко:

```kotlin
// До компиляции:
suspend fun foo(): Int { delay(100); return 42 }

// После компиляции (упрощённо):
fun foo(cont: Continuation<Int>): Any?
```

Возвращает либо `Int`, либо `COROUTINE_SUSPENDED` (специальный маркер).

---

## 3. Корутинные билдеры

Билдер — функция, запускающая корутину. Их четыре основных:

### 3.1 `runBlocking { }` — мост из обычного кода

```kotlin
fun main() = runBlocking {
    delay(1000)
    println("hello")
}
```

- **Блокирует** вызывающий поток до завершения корутины.
- Используется только в `main`, тестах, или когда нужно "вызвать suspend из не-suspend".
- В продакшене внутри сервиса — почти всегда **анти-паттерн**: блокирует поток, теряя главное преимущество корутин.

### 3.2 `launch { }` — fire-and-forget

```kotlin
val job: Job = scope.launch {
    repeat(10) {
        delay(100)
        println("tick $it")
    }
}
job.join()      // дождаться
job.cancel()    // отменить
```

- Возвращает `Job` (handle для отмены/ожидания).
- **Не возвращает результат**. Если падает — исключение пробрасывается в родителя (см. `CANCELLATION_EXCEPTIONS.md`).
- Запускается **немедленно** (eager) по умолчанию; есть `start = CoroutineStart.LAZY`.

### 3.3 `async { }` — даёт результат

```kotlin
val deferred: Deferred<User> = scope.async {
    fetchUser(42)
}
val user: User = deferred.await()
```

- Возвращает `Deferred<T>` — это `Job` + `await()`.
- Для **параллельной декомпозиции**: запустить N задач, дождаться всех.
- Исключение **не** пробрасывается до вызова `await()` (но всё равно отменяет родителя — это особенность structured concurrency).

### 3.4 `withContext(ctx) { }` — переключить контекст

```kotlin
suspend fun loadAndParse(): Data = withContext(Dispatchers.IO) {
    val raw = readFile()       // на IO-пуле
    parse(raw)
}
```

- **Не запускает** новую "независимую" корутину — это последовательный вызов внутри текущей.
- Главный инструмент для смены диспатчера (см. `DISPATCHERS.md`).
- Возвращает результат напрямую (без `await`).

### Сравнение

| Билдер | Возвращает | Когда |
|--------|-----------|-------|
| `runBlocking` | `T` (блокирует) | `main`, тесты, мост |
| `launch` | `Job` | fire-and-forget, нет результата |
| `async` | `Deferred<T>` | параллельная декомпозиция с результатом |
| `withContext` | `T` | смена диспатчера, последовательный |

---

## 4. Параллельная декомпозиция через `async`

Классический пример — параллельные сетевые запросы:

```kotlin
suspend fun loadDashboard(userId: Long): Dashboard = coroutineScope {
    val profile = async { api.profile(userId) }
    val posts   = async { api.posts(userId) }
    val likes   = async { api.likes(userId) }
    Dashboard(profile.await(), posts.await(), likes.await())
}
```

Ключевые моменты:
1. **`coroutineScope { }`** — структурный скоуп: ждёт всех детей, прокидывает исключения (см. `STRUCTURED_CONCURRENCY.md`).
2. Все три `async` выполняются **параллельно**, общее время ≈ `max(t_profile, t_posts, t_likes)`.
3. Если один падает — остальные **отменяются** (структурная отмена).

### Анти-паттерн: последовательный `await`

```kotlin
// ❌ Плохо: последовательно, как блокирующий код
val profile = async { api.profile(userId) }.await()
val posts = async { api.posts(userId) }.await()
```

Это эквивалентно прямому вызову `suspend`-функций без `async` вообще. Параллельность теряется.

### Анти-паттерн: `runBlocking` в suspend-функции

```kotlin
// ❌ Никогда так не делай
suspend fun foo() = runBlocking { bar() }
```

Блокирует поток-носитель. Делает всё преимущество корутин бесполезным.

---

## 5. `delay` vs `Thread.sleep`

```kotlin
delay(1000)         // ✅ suspend, не блокирует поток
Thread.sleep(1000)  // ❌ блокирует поток-носитель целиком
```

`delay` — `suspend fun`, отдаёт поток обратно в пул. Корутина возобновится через 1000 мс на любом потоке диспатчера.

Если **обязательно** нужно вызвать блокирующий API — оборачивай в `withContext(Dispatchers.IO)` или `runInterruptible { }`.

---

## 6. `Job` и его жизненный цикл

`Job` — handle на корутину. Жизненный цикл:

```
       New → Active → Completing → Completed
                 ↘ Cancelling → Cancelled
```

Состояния (флаги):

| Флаг | New | Active | Completing | Cancelling | Cancelled | Completed |
|------|:---:|:------:|:----------:|:----------:|:---------:|:---------:|
| `isActive` | – | + | + | – | – | – |
| `isCompleted` | – | – | – | – | + | + |
| `isCancelled` | – | – | – | + | + | – |

Главные методы:
- `start()` — запустить (для `LAZY`).
- `cancel(cause)` — пометить отменённой; не дожидается завершения.
- `cancelAndJoin()` — отменить и дождаться (canonical).
- `join()` — дождаться завершения (нормального или с ошибкой).
- `invokeOnCompletion { cause -> ... }` — колбэк на завершение (для очистки ресурсов).

`Deferred<T>` — `Job` + `await(): T`.

---

## 7. Типичные ошибки

### 7.1 Запуск из `GlobalScope`

```kotlin
// ❌ Анти-паттерн: корутина без родителя, не отменяется автоматически
GlobalScope.launch { ... }
```

`GlobalScope` помечен `@DelicateCoroutinesApi`. Используй `CoroutineScope` с явно заданным `Job` (см. `SCOPE_CONTEXT.md`).

### 7.2 Игнорирование `Job` от `launch`

```kotlin
launch { ... }  // забыли .join() / .invokeOnCompletion
```

Если родитель уже завершён к моменту, когда корутина бросает — исключение может потеряться.

### 7.3 Блокирующие вызовы в `Dispatchers.Default`

```kotlin
withContext(Dispatchers.Default) {
    Thread.sleep(10_000)  // ❌ съедает CPU-поток
}
```

Для блокирующего IO — `Dispatchers.IO`. Для CPU-bound — `Dispatchers.Default`. Не путать.

### 7.4 `async` без `await` без `coroutineScope`

```kotlin
fun foo(scope: CoroutineScope) {
    val d = scope.async { ... }
    // никогда не вызвали await — исключения тихо проглатываются (поведение зависит от scope)
}
```

В `coroutineScope { }` дочерний `async` пробрасывает исключение через скоуп даже без `await()` (это особенность structured concurrency). Но в обычном `CoroutineScope.async` без `await()` — исключение может потеряться без `CoroutineExceptionHandler`.

---

## Шпаргалка

```kotlin
// Точка входа в мире suspend
runBlocking { ... }

// Запуск без результата
launch { ... }                            // job.join() / job.cancel()

// Запуск с результатом
async { ... }                             // deferred.await()

// Смена диспатчера, последовательный
withContext(Dispatchers.IO) { ... }

// Параллельная декомпозиция
coroutineScope {
    val a = async { ... }
    val b = async { ... }
    a.await() + b.await()
}

// suspend ≠ async — это просто "может приостановиться"
suspend fun foo() { delay(100) }
```

---

## Источники

**Официальная документация:**
- [Kotlin Coroutines Basics](https://kotlinlang.org/docs/coroutines-basics.html) — `runBlocking`, `launch`, `delay`, structured concurrency intro.
- [Coroutines Guide (full)](https://kotlinlang.org/docs/coroutines-guide.html) — полное руководство, обновляется с релизами.
- [`kotlinx.coroutines` API reference](https://kotlinlang.org/api/kotlinx.coroutines/) — Javadoc-стиль.

**Спецификация / KEEP:**
- [KEEP-176: Coroutines proposal](https://github.com/Kotlin/KEEP/blob/master/proposals/coroutines.md) — каноническая спецификация языка, формальный контракт `suspend`.

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Marcin Moskała, KT Academy)](https://kt.academy/book/coroutines) — самая полная книга по теме, обновляется до текущей версии.

**Talks / posts:**
- [Roman Elizarov — «Structured Concurrency» (KotlinConf 2019)](https://www.youtube.com/watch?v=Mj5P47F6nJg)
- [Roman Elizarov — «Deep Dive into Coroutines on JVM» (KotlinConf 2017)](https://www.youtube.com/watch?v=YrrUCSi72E8) — внутренняя механика `suspend` (см. также `SUSPEND_INTERNALS.md`).
- [Manuel Vivo — «Coroutines and Patterns for work that shouldn't be cancelled» (Android Dev Summit)](https://medium.com/androiddevelopers/coroutines-patterns-for-work-that-shouldnt-be-cancelled-e26c40f142ad)
