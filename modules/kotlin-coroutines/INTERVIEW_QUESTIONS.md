# Kotlin Coroutines — Вопросы для собеседований

Источники: KDoc = Kotlin/kotlinx documentation, KEEP-176 = Coroutines proposal, Elizarov = posts/talks Romana Elizarova.

---

## 1. Основы и suspend

### Q1: Чем корутина отличается от потока?
**A:** Корутина — это suspendable computation. Не привязана к одному потоку: может приостановиться (suspend) на одном и продолжить на другом. Лёгкая (миллионы корутин на пуле из десятков потоков), кооперативная (приостанавливается в suspension point, не вытесняется), структурирована (есть родитель, образует дерево). Поток ОС — ~1 МБ стека + syscall на создание; корутина — объект на куче.
> Elizarov, KEEP-176

### Q2: Что компилятор делает с suspend-функцией?
**A:** Применяет CPS (Continuation-Passing Style) трансформацию. К функции добавляется скрытый параметр `Continuation<T>`, тело превращается в state-machine: каждая suspension point — `case` в switch, локальные переменные между точками сохраняются как поля state-machine объекта. Возвращаемый тип становится `Any?`: либо результат, либо специальный маркер `COROUTINE_SUSPENDED`.
> KEEP-176

### Q3: Когда использовать `runBlocking`?
**A:** Только в трёх местах: (1) `main`-функция, (2) тесты (хотя `runTest` лучше), (3) мост из не-suspend в suspend код (legacy интеграция). В suspend-функции и внутри корутин — **никогда**, потому что блокирует поток-носитель и убивает преимущество корутин.
> KDoc, Elizarov

### Q4: В чём разница `launch`, `async`, `withContext`?
**A:**
- `launch { }` — fire-and-forget, возвращает `Job`, нет результата.
- `async { }` — параллельная декомпозиция с результатом, возвращает `Deferred<T>`, результат через `.await()`.
- `withContext(ctx) { }` — последовательный (не запускает новую корутину), переключает контекст для блока, возвращает результат напрямую. Главный инструмент смены диспатчера.
> KDoc

---

## 2. Scope & Context

### Q5: Что хранится в `CoroutineContext`?
**A:** Иммутабельная мап-подобная коллекция элементов. Главные: `Job` (handle для отмены, родитель), `ContinuationInterceptor` (обычно `CoroutineDispatcher`), `CoroutineName` (для отладки), `CoroutineExceptionHandler` (только для root-корутин). Композиция через `+`. Доступ: `ctx[Job]`, `ctx[CoroutineDispatcher]`.
> KDoc CoroutineContext

### Q6: Что наследует дочерняя корутина при запуске через `launch`?
**A:** Контекст родителя + аргументы билдера + **новый дочерний `Job`**, чьим родителем является `Job` родителя. Diapatcher, name, handler — наследуются (если не переопределены). Job — НЕ наследуется (создаётся новый, привязанный к родителю).
> KEEP-176

### Q7: Почему `GlobalScope` помечен как `@DelicateCoroutinesApi`?
**A:** Корутина в `GlobalScope` не имеет родителя, не наследует никакого scope, не отменяется автоматически. Жизнь корутины должна быть привязана к lifecycle владельца (`viewModelScope`, scope сервиса). `GlobalScope` подходит только для top-level фоновых задач, переживающих весь процесс — крайне редкий случай.
> Elizarov, "The reason to avoid GlobalScope"

---

## 3. Dispatchers

### Q8: Когда использовать `Dispatchers.IO` vs `Dispatchers.Default`?
**A:**
- `Default` — CPU-bound (парсинг, сериализация, шифрование). Размер пула = `Runtime.availableProcessors()`.
- `IO` — блокирующий IO (JDBC, файлы, classic blocking HTTP). До 64 потоков. Под капотом тот же scheduler, что у Default, но с большим лимитом.
- Если код non-blocking (Reactor, Ktor CIO) — Default.
> KDoc Dispatchers

### Q9: Что делает `limitedParallelism(N)`?
**A:** Создаёт **view** на исходный диспатчер с ограничением: одновременно не более N корутин выполняются. Реализован через семафор. Используется когда нужно ограничить параллелизм для конкретной задачи: connection pool БД (HikariCP с pool=10 → `Dispatchers.IO.limitedParallelism(10)`), внешний API с rate limit.
> KDoc CoroutineDispatcher

### Q10: Что такое `Dispatchers.Unconfined` и когда его использовать?
**A:** Запускает корутину в текущем потоке до первой suspension. После — продолжает на потоке, который сделал `resume` (часто внутренний таймер для `delay`). В продакшене почти никогда не нужен — используется в библиотеках для оптимизаций и в тестах. Основной "тестовый" аналог — `UnconfinedTestDispatcher`.
> KDoc

---

## 4. Structured Concurrency

### Q11: Что гарантирует structured concurrency?
**A:** Четыре свойства:
1. **Wait-for-all** — `coroutineScope` не вернётся, пока все дети не завершатся.
2. **Cancellation propagation** — отмена родителя отменяет всех потомков.
3. **Error propagation** — падение ребёнка отменяет братьев и пробрасывает наружу.
4. **Resource cleanup** — нет залипших корутин после завершения скоупа.

Реализуется через иерархию `Job`: дочерний `Job` зависит от родителя, родительский ждёт детей.
> KEEP-176, Elizarov

### Q12: `coroutineScope` vs `supervisorScope`?
**A:**
- `coroutineScope` — **fail-fast**: один ребёнок упал → отменяет всех братьев → пробрасывает исключение.
- `supervisorScope` — **fail-isolated**: падение одного НЕ отменяет братьев. Пригодно для независимых задач (загрузка нескольких виджетов дашборда).

`SupervisorJob` гасит **только восходящее** распространение ошибок; нисходящая отмена работает в обоих случаях.
> KDoc

### Q13: Почему `try/catch` вокруг `launch` не ловит исключение из тела?
**A:** `launch` асинхронен — он создаёт корутину и возвращает `Job` мгновенно. Тело упадёт **позже**, и исключение не пройдёт через ту строку. Лови **внутри** `launch` или используй `CoroutineExceptionHandler` в контексте scope.
> KDoc

### Q14: Чем отличается обработка исключений в `launch` и `async`?
**A:** `launch` бросает исключение **немедленно** в parent Job (родитель отменяется, исключение попадает в `CoroutineExceptionHandler` или дальше наверх). `async` сохраняет исключение в `Deferred` до вызова `await()` — оттуда оно и выбросится. НО! В `coroutineScope`/`supervisorScope` падение `async` всё равно влияет на родителя через дочерний Job — это деталь structured concurrency.
> KDoc, Elizarov

---

## 5. Cancellation & Exceptions

### Q15: Почему отмена корутины называется кооперативной?
**A:** JVM не вытесняет корутины — корутина сама проверяет флаг отмены на suspension points. Все стандартные suspend (delay, await, withContext, send/receive у Channel) делают эту проверку. CPU-bound цикл без suspension точек **не отменится** — нужны явные `ensureActive()` или `yield()`.
> KDoc Job.cancel

### Q16: Почему опасно ловить `CancellationException`?
**A:** `CancellationException` — нормальный способ завершения отменённой корутины. Если её проглотить и продолжить работать — нарушится контракт structured concurrency: scope думает, что корутина отменена, а она продолжает крутиться. Правило: либо не ловить вовсе, либо явно `throw e` после очистки.

```kotlin
try { ... }
catch (e: Exception) {
    if (e is CancellationException) throw e
    log(e)
}
```
> KDoc

### Q17: Зачем нужен `withContext(NonCancellable)`?
**A:** После `cancel()` корутина не может выполнять suspend-операции — они сразу бросят `CancellationException`. Если в `finally` нужно сделать suspend cleanup (закрыть соединение, отправить метрику), оборачивай в `withContext(NonCancellable)` — это специальный `Job`, игнорирующий отмену. Использовать **только** в `finally`-блоках.
> KDoc NonCancellable

### Q18: Чем `withTimeout` отличается от `withTimeoutOrNull`?
**A:** Оба запускают блок и отменяют его при истечении времени. `withTimeout` бросает `TimeoutCancellationException` (наследник `CancellationException`). `withTimeoutOrNull` возвращает `null` при таймауте. Тонкость: ресурс, захваченный внутри блока, может утечь, если таймаут наступил между захватом и возвратом — нужен `try { } finally { withContext(NonCancellable) { release() } }`.
> KDoc

---

## 6. Flow

### Q19: Что значит "холодный" в контексте Flow?
**A:** Тело `flow { }` не выполняется до тех пор, пока кто-то не вызовет терминальный оператор (`collect`, `toList`, `first`). Каждая подписка — независимый запуск тела. Это противоположность hot streams (`StateFlow`, `SharedFlow`), которые работают всегда и broadcast'ят значения.
> KDoc Flow

### Q20: Что делает `flowOn`?
**A:** Меняет диспатчер для **upstream** части цепочки (всё, что выше по цепочке от `flowOn`). Это единственный правильный способ менять контекст внутри Flow. `withContext` внутри `flow { }` нарушит инвариант (нельзя `emit` из другого диспатчера) — будет runtime error.

```kotlin
flow { emit(slowOp()) }
    .flowOn(Dispatchers.Default)        // upstream на Default
    .collect { ... }                     // collect на текущем
```
> KDoc Flow.flowOn

### Q21: Чем отличаются `flatMapConcat`, `flatMapMerge`, `flatMapLatest`?
**A:**
- `flatMapConcat` — последовательно: следующий внутренний flow начинается только после завершения предыдущего.
- `flatMapMerge(concurrency = N)` — параллельно, до N подписок одновременно.
- `flatMapLatest` — при каждом новом upstream-элементе **отменяет** предыдущую внутреннюю подписку и начинает новую. Идеально для search-as-you-type.
> KDoc

### Q22: Как работает backpressure в Flow?
**A:** Через suspend: если `collect { }` медленный, `emit` ждёт. Никакого внутреннего буфера по умолчанию — emit и collect синхронны. Для контроля: `buffer(N)` (буфер с producer/consumer параллельно), `conflate()` (выкидывать промежуточные если consumer медленный), `collectLatest { }` (отменять обработку при новом значении).
> KDoc

### Q23: Зачем `catch` в Flow и что он ловит?
**A:** `catch { }` ловит исключения, произошедшие **в upstream** (всё что выше по цепочке от него). Не ловит исключения из `collect { }` — те улетают наружу. Для retry-логики есть `retry(n)` и `retryWhen { cause, attempt -> ... }`.
> KDoc Flow.catch

---

## 7. StateFlow / SharedFlow

### Q24: `StateFlow` vs `MutableSharedFlow(replay = 1)` — в чём разница?
**A:**
| | StateFlow | SharedFlow(replay=1) |
|---|---|---|
| Initial value | обязательный | нет (буфер пуст до первого emit) |
| `value` property | да | нет |
| `distinctUntilChanged` | встроен | нет |
| Подписчик до emit | получит initial | получит ничего |

`StateFlow` — специализация `SharedFlow` с conflate-семантикой и обязательным начальным значением. Для текущего состояния — `StateFlow`, для последнего события — `SharedFlow(replay=1)`.
> KDoc

### Q25: Зачем `update { }` в `MutableStateFlow`?
**A:** Атомарно обновить значение под высоким contention. Реализован как loop с CAS на `compareAndSet`. Аналог `AtomicReference.updateAndGet`. Простое `value = value + 1` под параллелизмом теряет обновления.
```kotlin
_state.update { it.copy(loading = true) }
```
> KDoc

### Q26: Что такое `WhileSubscribed(timeout)` и зачем он?
**A:** Стратегия `SharingStarted` для `shareIn`/`stateIn`: запускать upstream когда есть подписчики, останавливать через `timeout` мс после ухода последнего. Канонический выбор `WhileSubscribed(5_000)` для UI на Android — переживает rotation и навигацию между фрагментами без перезапуска тяжёлого upstream.
> KDoc SharingStarted

---

## 8. Channels

### Q27: Чем `Channel<T>` отличается от `Flow<T>`?
**A:**
- `Channel` — hot, конкурентная очередь. Многократные producer/consumer, каждое значение получает **один** consumer (mutex-семантика).
- `Flow` — cold, реактивный поток. Одна подписка = один независимый запуск. Multi-cast только через `shareIn`/`stateIn`.

Channel в API делает caller'а ответственным за `close()`. Идиома: возвращать `Flow` из API, использовать `Channel` внутри для координации.
> Elizarov, "Cold flows, hot channels"

### Q28: Какие типы capacity у Channel?
**A:**
- `RENDEZVOUS` (0, default) — `send` ждёт `receive`. Hand-off.
- `UNLIMITED` (-2) — неограниченная очередь (опасно для памяти).
- `BUFFERED` (-1) — буфер 64 (или из конфига), `SUSPEND` при переполнении.
- `CONFLATED` (-3) — capacity 1, новый перезаписывает старый.
- `N` (>0) — bounded buffered, поведение задаётся `onBufferOverflow`: `SUSPEND` / `DROP_OLDEST` / `DROP_LATEST`.
> KDoc Channel

### Q29: Как работает `select { }`?
**A:** Атомарно ждёт первого готового из нескольких источников. Поддерживает `Channel.onReceive`, `Channel.onSend(v)`, `Deferred.onAwait`, `Job.onJoin`, `onTimeout(ms)`. Гарантирует, что сработает ровно один пункт. Используется для race нескольких deferred'ов, выбора между несколькими channel'ами, или как timeout без отдельной корутины.
> KDoc select

---

## 9. Suspend Internals & Testing

### Q30: Как мостить Java callback API в suspend?
**A:** `suspendCancellableCoroutine { cont -> ... }`:
```kotlin
suspend fun fetch(): Data = suspendCancellableCoroutine { cont ->
    val task = api.fetchAsync(object : Callback {
        override fun onSuccess(d: Data) = cont.resume(d)
        override fun onError(e: Throwable) = cont.resumeWithException(e)
    })
    cont.invokeOnCancellation { task.cancel() }
}
```
Главное: вызвать `resume` ровно один раз; добавить `invokeOnCancellation` чтобы отмена корутины отменяла внешнюю работу. `suspendCoroutine` (без Cancellable) — только если работа гарантированно быстрая и не отменяется.
> KEEP-176, KDoc

### Q31: Зачем `runTest` вместо `runBlocking` в тестах?
**A:** `runTest` использует **виртуальное время**: `delay(1000)` мгновенен, можно `advanceTimeBy(ms)` чтобы переместить часы. Тесты быстрые и детерминированные. `runBlocking` ждёт реально → тесты медленные и flaky. `runTest` также проверяет, что после блока нет висящих корутин (детектор утечек). Артефакт: `kotlinx-coroutines-test`.
> KDoc kotlinx-coroutines-test

---

## Шпаргалка: топ-10 тем по частоте на собеседованиях

1. Чем корутина отличается от потока (Q1)
2. `launch` vs `async` vs `withContext` (Q4)
3. Что гарантирует structured concurrency (Q11)
4. `coroutineScope` vs `supervisorScope` (Q12)
5. Кооперативная отмена (Q15, Q16)
6. `Dispatchers.IO` vs `Default` (Q8)
7. Cold Flow vs StateFlow vs SharedFlow (Q19, Q24)
8. Backpressure в Flow (Q22)
9. `flatMapLatest` для search-as-you-type (Q21)
10. Мост Java callback → suspend (Q30)
