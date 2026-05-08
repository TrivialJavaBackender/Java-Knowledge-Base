# Flow — холодные асинхронные потоки

> `Flow<T>` — асинхронный stream, который может **последовательно** излучать значения, лениво и с поддержкой отмены.
> "Холодный" = тело не запускается, пока никто не подписался; каждая подписка — отдельный запуск.

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
| Backpressure | – | да (через suspend) | – |

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
| `catch { e -> emit(...) }` | поймать upstream-исключение |
| `flowOn(ctx)` | сменить диспатчер для **upstream** части |
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
| `flatMapLatest { x -> ... }` | при новом upstream-элементе отменяет предыдущую внутреннюю подписку |
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

`catch { }` ловит **только upstream**. Исключения из `collect { }` лучше оборачивать в `try/catch` снаружи или использовать `onEach { }`.

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

## 7. Backpressure

`Flow` решает backpressure **через suspend**: если `collect { }` медленный, `emit { }` ждёт его. Никакого внутреннего буфера по умолчанию.

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

- [kotlinlang.org/docs/flow.html](https://kotlinlang.org/docs/flow.html)
- Roman Elizarov, "Cold flows, hot channels" — Medium
- Kotlin coroutines guide §4
