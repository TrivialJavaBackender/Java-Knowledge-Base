# Flow — холодные асинхронные потоки

> **Какую проблему решает.** Значений много, они появляются во времени, и их надо преобразовывать,
> не собирая всё в память и не теряя отмену.
> **Кому это надо.** Тому, кто читает постранично из API или БД, обрабатывает очередь событий,
> стримит ответ клиенту или делает поиск по мере ввода.
> **Когда НЕ надо.** Один результат — `suspend fun`. Готовая коллекция в памяти — `List` и обычные
> операции над ним.

## 0. Зачем `Flow`, если есть `List`, `Sequence` и `suspend fun`

Самый честный способ понять `Flow` — посмотреть, где ломаются три привычных инструмента.

**`suspend fun` возвращает одно значение.** Функция `suspend fun loadAll(): List<Item>` вернётся
только тогда, когда соберёт всё. Значит: клиент ждёт до конца, промежуточные результаты недоступны,
а если элементов миллион — они все окажутся в памяти. Стримить нечего.

**`List` требует, чтобы всё поместилось и закончилось.** Он не умеет представлять «данные, которые
всё ещё приходят»: поток событий из очереди не заканчивается никогда, и `List` для него — не тип.

**`Sequence` ленив, но не умеет приостанавливаться.** Вот это не скомпилируется:

```kotlin
val items = sequence {
    val page = api.load(1)   // ❌ suspend-вызов внутри sequence запрещён
    yieldAll(page)
}
```

`Sequence` спроектирован для **синхронных** ленивых вычислений: его `yield` приостанавливает только
внутри самой последовательности (`@RestrictsSuspension`), поэтому сходить по сети между элементами
нельзя. Единственный способ — заблокировать поток, то есть вернуться в мир номер один из
[`WHY_COROUTINES.md`](WHY_COROUTINES.md).

`Flow` — это ровно `Sequence`, которому разрешили приостанавливаться:

```kotlin
val items: Flow<Item> = flow {
    var page = 1
    while (true) {
        val batch = api.load(page)      // suspend — можно
        if (batch.isEmpty()) break
        batch.forEach { emit(it) }      // отдаём по одному, не копим
        page++
    }
}
```

Отсюда и всё остальное: ленивость (пока не подписались — ничего не происходит), обратное давление (backpressure)
(`emit` приостанавливается, если коллектор медленный), отмена (сбор идёт в корутине коллектора).

**Критерий выбора одной строкой:**

| Что у вас | Что брать |
|---|---|
| Один результат | `suspend fun` |
| Готовая коллекция в памяти, без ввода-вывода | `List` + обычные операции |
| Ленивая цепочка без приостановок | `Sequence` |
| Много значений во времени, между ними ввод-вывод | `Flow` |
| Значения нужны всем подписчикам сразу и живут без них | `SharedFlow`/`StateFlow`, см. [`FLOW_ADVANCED.md`](FLOW_ADVANCED.md) |
| Каждое значение должно достаться ровно одному обработчику | `Channel`, см. [`CHANNELS.md`](CHANNELS.md) |

---

## 1. Что такое Flow

```kotlin
val numbers: Flow<Int> = flow {
    for (i in 1..3) {
        delay(100)
        emit(i)
    }
}

// Ничего ещё не выполнилось!
numbers.collect { println(it) }   // тут запустится тело
```

Сравнение:

| | `Sequence<T>` | `Flow<T>` | `List<T>` |
|---|---|---|---|
| Холодный | да | да | нет (готовый) |
| Suspend-операции в теле | нет | **да** | нет |
| Отмена | через исключение | кооперативная | – |
| Обратное давление | – | да (через suspend) | – |

`Flow` — это suspend-аналог `Sequence`. Каждая операция (`map`, `filter`) — лениво композируется, никакой работы не делается до **терминальной** операции (`collect`, `toList`, ...).

---

## 2. Builders

```kotlin
flow { emit(...); emit(...) }                       // основной builder
flowOf(1, 2, 3)                                     // готовые значения
listOf(1, 2, 3).asFlow()                            // из коллекции
channelFlow { send(...); send(...) }                // конкурентный builder (см. CHANNELS.md)
callbackFlow { send(...); awaitClose { ... } }      // мост из callback API
```

### `flow { }` vs `channelFlow { }`

- `flow { }` — **последовательный**: внутри блока нельзя `emit` из другой корутины (ломает контекст-preservation).
- `channelFlow { }` — позволяет `send` из дочерних корутин (использует Channel внутри).

```kotlin
// ❌ Compile error: Flow invariant is violated
flow {
    coroutineScope {
        launch { emit(1) }   // нельзя emit из другой корутины
    }
}

// ✅
channelFlow {
    coroutineScope {
        launch { send(1) }
    }
}
```

---

## 3. Промежуточные операторы (intermediate)

Возвращают новый `Flow`, не запускают вычисления.

| Оператор | Что делает |
|----------|-----------|
| `map { x -> ... }` | трансформация |
| `filter { x -> ... }` | фильтрация |
| `transform { x -> emit(...) }` | произвольное число emit'ов на каждый элемент |
| `take(n)` / `takeWhile { }` | первые N |
| `drop(n)` / `dropWhile { }` | пропустить N |
| `onEach { x -> ... }` | side-effect, прозрачно прокидывает |
| `onStart { emit(...) }` | вызов перед первым элементом |
| `onCompletion { cause -> ... }` | вызов в конце (нормально или с ошибкой) |
| `catch { e -> emit(...) }` | поймать исключение из апстрима |
| `flowOn(ctx)` | сменить диспатчер для **апстрима** (всё, что выше по цепочке) |
| `buffer(n)` | буферизовать между producer и consumer |
| `conflate()` | пропускать промежуточные значения, если consumer медленный |
| `debounce(t)` | излучать только после паузы t |
| `sample(t)` | брать снэпшот каждые t |
| `distinctUntilChanged()` | не излучать повторы подряд |
| `scan(init) { acc, v -> ... }` | runningFold |

### Композиция нескольких Flow

| Оператор | Поведение |
|----------|-----------|
| `flatMapConcat { x -> ... }` | по очереди (как `flatMap` в Sequence) |
| `flatMapMerge { x -> ... }` | параллельно, до `concurrency` подписок |
| `flatMapLatest { x -> ... }` | при новом элементе из апстрима отменяет предыдущую внутреннюю подписку |
| `combine(other) { a, b -> ... }` | при изменении любого — пересчитать |
| `zip(other) { a, b -> ... }` | пары (подождать оба) |
| `merge(f1, f2, ...)` | объединить несколько flows |

`flatMapLatest` особенно полезен для search-as-you-type: при новом запросе отменяет старый.

---

## 4. Терминальные операторы

Запускают сбор данных, suspend.

```kotlin
flow.collect { v -> ... }              // основной
flow.toList()
flow.toSet()
flow.first()                            // первое и отписаться
flow.firstOrNull()
flow.single()                           // ровно одно или Exception
flow.count()
flow.fold(initial) { acc, v -> ... }
flow.reduce { acc, v -> ... }
flow.launchIn(scope)                    // collect внутри scope, возвращает Job
```

### `launchIn` и побочные эффекты

```kotlin
flow.onEach { handle(it) }
    .launchIn(scope)
```

— это эквивалент `scope.launch { flow.collect { handle(it) } }`, но короче и идиоматичнее, когда тебе не нужен результат.

---

## 5. `flowOn` и контекст-preservation

```kotlin
flow {
    emit(slowComputation())     // тяжёлая работа
}
.flowOn(Dispatchers.Default)    // upstream считается на Default
.collect {                       // collect — на текущем диспатчере
    update(it)
}
```

`flowOn(ctx)` меняет контекст для **всего, что выше** в цепочке. Это единственный правильный способ менять диспатчер внутри Flow.

### Анти-паттерн: `withContext` внутри `emit`

```kotlin
// ❌ нарушает Flow invariant
flow {
    withContext(Dispatchers.IO) {
        emit(loadData())   // emit ИЗ другого диспатчера запрещён!
    }
}
```

Используй `flowOn(Dispatchers.IO)` снаружи.

---

## 6. Обработка ошибок

```kotlin
flow { ... }
    .map { transform(it) }
    .catch { e ->
        // ловит upstream (flow + map)
        emit(fallback)
    }
    .collect { ... }            // НЕ ловит исключения здесь — они улетят выше
```

`catch { }` ловит **только апстрим**. Исключения из `collect { }` лучше оборачивать в `try/catch` снаружи или использовать `onEach { }`.

```kotlin
flow.onEach { process(it) }
    .catch { e -> log(e) }      // catch не сработает, если процесс упал в onEach? сработает!
```

Точнее: `catch` ловит всё, что произошло **выше по цепочке**. `onEach` — это intermediate, его блок выполняется до `catch`. Поэтому он попадёт в catch.

### `retry` и `retryWhen`

```kotlin
flow.retry(3) { it is IOException }                        // retry до 3 раз
flow.retryWhen { cause, attempt -> cause is IOException && attempt < 3 }
```

---

## 7. Обратное давление (backpressure)

`Flow` решает обратное давление **через suspend**: если `collect { }` медленный, `emit { }` ждёт его. Никакого внутреннего буфера по умолчанию.

Для контроля — `buffer`, `conflate`, `collectLatest`:

```kotlin
flow.buffer(50)                  // буфер на 50, emit и collect параллельно
flow.conflate()                  // если consumer не успевает, держим только последнее
flow.collectLatest { v ->        // при новом v отменяет предыдущий блок collect
    process(v)
}
```

---

## 8. Cancellation

`Flow` отменяется автоматически — `collect` это suspend-оператор, при отмене корутины он перестаёт собирать.

Внутри `flow { }` нужно **проверять отмену** (как в любой suspend-функции):

```kotlin
flow {
    while (true) {
        ensureActive()       // или просто emit/delay сделают это
        emit(read())
    }
}
```

---

## 9. Hot vs Cold

`Flow` по умолчанию **холодный**: каждая подписка — независимый запуск.

Если нужен **горячий** Flow (один источник, несколько подписчиков, общее состояние):
- `StateFlow` — для текущего состояния (всегда есть значение).
- `SharedFlow` — для событий (broadcast).

См. `FLOW_ADVANCED.md`.

---

## 10. Типичные ошибки

### 10.1 Использование Flow вместо `suspend fun` для одноразового результата

```kotlin
// ❌ Избыточно
fun loadUser(id: Long): Flow<User> = flow { emit(api.user(id)) }

// ✅
suspend fun loadUser(id: Long): User = api.user(id)
```

`Flow` — для **последовательности значений во времени**. Для одного значения — просто `suspend fun`.

### 10.2 Сбор Flow без отмены

```kotlin
GlobalScope.launch { flow.collect { ... } }  // ❌ никогда не остановится
```

Привязывай к scope с lifecycle (`viewModelScope`, ваш сервисный scope).

### 10.3 `forEach` на холодном Flow

`Flow` не имеет `.forEach` — используй `.collect { }`. (`forEach` определён только для коллекций / Sequence.)

---

## Шпаргалка

```kotlin
// Builder
val nums: Flow<Int> = flow {
    for (i in 1..10) {
        delay(100); emit(i)
    }
}

// Цепочка
nums
    .map { it * 2 }
    .filter { it > 5 }
    .flowOn(Dispatchers.Default)
    .catch { e -> emit(-1) }
    .collect { println(it) }

// Композиция
flow1.combine(flow2) { a, b -> a + b }

// Параллельная карта (упорядочивая результаты — нужен flatMapMerge)
flow.flatMapMerge(concurrency = 4) { x ->
    flow { emit(loadAsync(x)) }
}

// Поиск-as-you-type
queryFlow
    .debounce(300)
    .distinctUntilChanged()
    .flatMapLatest { q -> searchApi(q) }
    .collect { update(it) }
```

---

## Источники

**Официальная документация:**
- [Asynchronous Flow (kotlinlang.org)](https://kotlinlang.org/docs/flow.html) — builders, операторы, контекст, обработка исключений.
- [`Flow` API reference](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-flow/) — все операторы с примерами.

**Posts (must-read):**
- [Roman Elizarov — «Cold flows, hot channels»](https://elizarov.medium.com/cold-flows-hot-channels-d74769805f9) — почему Flow холодный и почему это важно.
- [Roman Elizarov — «Kotlin Flow Tips»](https://elizarov.medium.com/kotlin-flow-tips-9d1c4a6c9d2c)
- [Manuel Vivo — «Migrating from LiveData to Kotlin's Flow»](https://medium.com/androiddevelopers/migrating-from-livedata-to-kotlins-flow-379292f419fb)
- [Christophe Beyls — «Flow operators: real differences»](https://medium.com/androiddevelopers/47bc4783b5a)

**Talks:**
- [Roman Elizarov — «Asynchronous Data Streams with Kotlin Flow» (KotlinConf 2019)](https://www.youtube.com/watch?v=tYcqn48SMT8)

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Moskała)](https://kt.academy/book/coroutines) — Part 2 целиком про Flow.
