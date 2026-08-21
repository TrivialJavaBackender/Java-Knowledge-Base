# Как устроен Flow внутри

> **Какую проблему решает.** Объясняет странности, с которыми сталкиваешься на практике:
> `Flow invariant is violated`, сломавшийся `take(1)`, отсутствие параллельности между стадиями,
> лишние каналы от `buffer()`.
> **Кому это надо.** Тому, кто пишет свой оператор; тому, кто отлаживает эти ошибки; тому, кого на
> собеседовании спрашивают «что такое `Flow` с точки зрения кода».
> **Когда НЕ надо.** Чтобы собирать цепочки из готовых операторов, это знать не обязательно —
> хватит [`FLOW.md`](FLOW.md).

---

## 1. `Flow` — это один метод

Весь интерфейс целиком:

```kotlin
public interface Flow<out T> {
    public suspend fun collect(collector: FlowCollector<T>)
}

public fun interface FlowCollector<in T> {
    public suspend fun emit(value: T)
}
```

Всё остальное — операторы — это обёртки, реализующие тот же интерфейс. Вот настоящий `map`, без
упрощений:

```kotlin
public fun <T, R> Flow<T>.map(transform: suspend (T) -> R): Flow<R> = flow {
    collect { value -> emit(transform(value)) }
}
```

Из этого следует почти всё поведение `Flow`:

- **У `Flow` нет своей корутины и своего потока.** `collect` выполняется в корутине того, кто его
  позвал. Поэтому отмена коллектора отменяет и продюсера — это одна и та же корутина.
- **Обратное давление (backpressure) достаётся бесплатно.** `emit` — suspend-функция: пока коллектор обрабатывает значение, `emit`
  не возвращается, и продюсер ждёт.
- **Цепочка `map.filter.take` — это вложенные вызовы `collect`**, которые на каждый элемент
  разворачиваются в стек suspend-вызовов. Аллокация происходит на построение цепочки, а не на
  элемент.
- **Порядок операторов важен:** `filter { }.map { }` дешевле, чем `map { }.filter { }`, потому что
  во втором случае трансформация выполняется и для отфильтрованных элементов.
- **Параллельности между стадиями по умолчанию нет.** Пока коллектор обрабатывает элемент, продюсер
  стоит. Параллельность появляется только там, где её явно попросили: `buffer`, `flowOn`,
  `channelFlow`, `flatMapMerge`.

---

## 2. `SafeCollector` и инвариант «эмиссия из своей корутины»

Билдер `flow { }` возвращает не голую реализацию, а `SafeFlow`, который оборачивает коллектор в
`SafeCollector`. Тот на **каждом** `emit` проверяет два условия:

1. **Контекст тот же**, в котором стартовал сбор.
2. **Эмиссия происходит из той же корутины**, что и вызов `collect`.

Нарушение любого — `IllegalStateException: Flow invariant is violated…`.

```kotlin
// ❌ смена контекста внутри flow { }
flow {
    withContext(Dispatchers.IO) { emit(load()) }   // Flow invariant is violated
}

// ❌ эмиссия из другой корутины
flow {
    coroutineScope {
        launch { emit(1) }                          // Flow invariant is violated
    }
}
```

**Зачем этот запрет.** Он даёт свойство, которое называется *context preservation*: коллектор
получает значения в предсказуемом контексте — том самом, в котором он позвал `collect`. Без этого
`collect { }` мог бы внезапно исполняться на чужом диспетчере, и любые рассуждения о потоках
рассыпались бы.

Легальные способы сделать то, что запрещено:

```kotlin
// Сменить контекст апстрима — оператором, а не изнутри
flow { emit(load()) }.flowOn(Dispatchers.IO)

// Эмитить конкурентно — другим билдером
channelFlow {
    launch { send(fetchA()) }        // внутри канал, поэтому конкурентные send безопасны
    launch { send(fetchB()) }
}
```

`callbackFlow` — это тот же `channelFlow` с дополнительным требованием: в конце обязан быть
`awaitClose { }`, иначе билдер бросит `IllegalStateException` (см. [`INTEROP.md`](INTEROP.md) §4).

Проверки `SafeCollector` стоят денег, поэтому для горячего пути в библиотеках есть `AbstractFlow` —
базовый класс, который делает те же проверки один раз, и «ручной» `object : Flow<T>`, который не
делает их вовсе (и потому опасен).

---

## 3. `AbortFlowException`: как `take(1)` останавливает бесконечный поток

`Flow` не умеет «отписаться» — у него нет подписки. Поэтому операторы, которым хватило данных,
останавливают апстрим **исключением**:

```kotlin
public fun <T> Flow<T>.take(count: Int): Flow<T> = flow {
    var remaining = count
    collect { value ->
        emit(value)
        if (--remaining == 0) throw AbortFlowException(this)   // «хватит», а не «ошибка»
    }
}
```

`AbortFlowException` ловится тем же оператором выше по цепочке и наружу не выходит. Так же устроены
`first`, `takeWhile`, `firstOrNull`.

Отсюда — правило **exception transparency**, и это его техническое обоснование, а не стилистическое
пожелание:

```kotlin
// ❌ перехватили служебное исключение — take сломался
flow {
    try {
        emit(1); emit(2)
    } catch (e: Throwable) {
        emit(-1)                      // проглотили AbortFlowException
    }
}.take(1).collect { … }
```

> **Правило.** Продюсер не должен ловить исключения, приходящие «снизу», из `emit`. Для ошибок
> апстрима есть оператор `catch { }`, который по построению видит только исключения выше по
> цепочке.

Тот же запрет объясняет, почему `try/catch` вокруг `collect { }` — плохая идея: он поймает и ошибку
апстрима, и ошибку самого коллектора, и служебные исключения операторов.

---

## 4. Fusion: почему `flowOn(io).buffer()` не создаёт два канала

`flowOn`, `buffer`, `conflate` и `produceIn` реализованы через общий класс `ChannelFlow`. Соседние
операторы этого семейства **сливаются в один объект**:

```kotlin
flow { … }
    .flowOn(Dispatchers.IO)   // ┐
    .buffer(64)               // ├─ схлопнутся в один ChannelFlowOperator
    .conflate()               // ┘
    .collect { … }
```

При слиянии контексты комбинируются, а ёмкость и стратегия переполнения выбираются по правилам
слияния — грубо говоря, «побеждает последний». Практические выводы:

- `.flowOn(io).buffer()` — один канал, а не два; накладные расходы не удваиваются.
- `.conflate().buffer(64)` — не «сначала конфлейт, потом буфер», а один канал с итоговой
  конфигурацией. Если вы рассчитывали на две стадии — вы получите не то, что задумали.
- **`flowOn` сам по себе добавляет буферизацию**, потому что смена контекста требует канала. Именно
  поэтому «медленный коллектор + `flowOn`» уже работает быстрее, чем без него, даже если `buffer`
  вы не писали.

---

## 5. Что `collect` делает с контекстом

`collect` не создаёт корутин. Он выполняется в корутине вызывающего, и из этого следует:

- `flow.collect { }` внутри `scope.launch(Dispatchers.IO)` целиком идёт на IO — если в цепочке нет
  `flowOn`;
- отмена корутины коллектора отменяет и продюсера — это буквально одна корутина;
- исключение продюсера — обычное исключение внутри `collect`, поэтому `try/catch` **вокруг сбора**
  работает (в отличие от `try/catch` вокруг `emit`, §3).

---

## 6. `SharedFlow` и `StateFlow` изнутри

**`SharedFlow`:**

- кольцевой буфер размером `replay + extraBufferCapacity`;
- массив слотов подписчиков, у каждого — свой индекс в буфере;
- ячейка буфера освобождается, когда её прочитали все слоты. Если самый медленный подписчик отстал и
  буфер заполнен, `emit` либо приостанавливается (`BufferOverflow.SUSPEND`), либо теряет значения
  (`DROP_OLDEST` / `DROP_LATEST`).

Отсюда практическое следствие: **один медленный подписчик тормозит издателя** — и это не баг, а
выбранная стратегия. Разбор с точки зрения применения — в [`FLOW_ADVANCED.md`](FLOW_ADVANCED.md).

**`StateFlow`:**

- хранит текущее значение и версию (счётчик обновлений);
- подписчик читает **актуальное значение**, а не очередь, — отсюда конфлейт «бесплатно»: пока
  подписчик обрабатывал одно значение, промежуточные могли смениться, и он увидит только последнее;
- `distinctUntilChanged` встроен: обновление значением, `equals`-равным текущему, не увеличивает
  версию и не будит подписчиков (частая причина «почему подписчик не получил обновление» — мутировали
  объект вместо создания нового);
- `update { }` — CAS-цикл поверх `compareAndSet`, поэтому он не теряет конкурентные обновления, а
  `value = value + 1` теряет.

---

## 7. Стоимость

| Ситуация | Что происходит |
|---|---|
| Цепочка `map`/`filter` без буферов | вложенные suspend-вызовы; аллокаций на элемент почти нет |
| `flowOn` / `buffer` | добавляется канал: аллокации и переключения, зато стадии работают параллельно |
| `channelFlow` | канал всегда: дороже `flow { }`, брать только при конкурентной эмиссии |
| `flatMapMerge(n)` | n внутренних сборов плюс канал слияния |
| `SharedFlow` с большим `replay` | буфер держит значения в памяти, пока их не прочитают все подписчики |

> **Правило.** Не сыпьте `buffer()` и `channelFlow` по привычке: они превращают дешёвую цепочку
> вложенных вызовов в конвейер с каналами.

---

## 8. Мост в Reactive Streams

Модели обратного давления разные: в Reactive Streams потребитель явно просит порцию через `request(n)`, в
`Flow` того же добиваются приостановкой `emit`. Конвертация двусторонняя (`Publisher.asFlow()`,
`Flow.asPublisher()`), отмена пробрасывается. Артефакты и примеры — в [`INTEROP.md`](INTEROP.md) §5.

---

## 9. Частые ошибки

1. **`emit` из `launch` внутри `flow { }`** — нарушение инварианта; нужен `channelFlow`.
2. **`try/catch (Throwable)` вокруг `emit`** — ломает `take`/`first`, перехватывая
   `AbortFlowException`.
3. **`withContext` внутри `flow { }`** — то же нарушение; менять контекст апстрима надо `flowOn`.
4. **`channelFlow` вместо `flow` без нужды** — лишний канал и аллокации.
5. **Ожидание параллельности стадий без `buffer`** — по умолчанию продюсер и коллектор работают
   строго по очереди.
6. **`callbackFlow` без `awaitClose`** — `IllegalStateException` и утечка подписки.
7. **Мутация объекта внутри `StateFlow`** — версия не меняется, подписчики не просыпаются.

---

## Шпаргалка

- `Flow` = один suspend-метод `collect`; операторы — обёртки над ним, своей корутины у `Flow` нет.
- `SafeCollector` проверяет: тот же контекст, та же корутина. Иначе `Flow invariant is violated`.
- Конкурентная эмиссия — только `channelFlow` / `callbackFlow`.
- `take`/`first` останавливают апстрим через `AbortFlowException` → нельзя ловить `Throwable` вокруг
  `emit` (exception transparency).
- `flowOn`/`buffer`/`conflate` сливаются в один `ChannelFlow`; `flowOn` сам добавляет буфер.
- Параллельность стадий надо просить явно: `buffer`, `flowOn`, `flatMapMerge`, `channelFlow`.
- `StateFlow` = значение + версия + встроенный `distinctUntilChanged`; `update { }` — CAS-цикл.

Практика — упражнение [Ex17](../src/main/kotlin/exercises/Ex17_CustomFlowOperators.kt): свои
операторы поверх `flow { }` и `channelFlow`.

---

## Источники

**Официальная документация:**
- [Asynchronous Flow](https://kotlinlang.org/docs/flow.html) — разделы «Flow context» и «Exception transparency».
- [`Flow` API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-flow/) — KDoc интерфейса содержит формулировку инвариантов.
- [`channelFlow`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/channel-flow.html), [`buffer`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/buffer.html)

**Исходники:**
- `kotlinx-coroutines-core` → `flow/Builders.kt` (`SafeFlow`), `flow/internal/SafeCollector.kt`,
  `flow/internal/ChannelFlow.kt` (fusion), `flow/operators/Limit.kt` (`take`, `AbortFlowException`),
  `flow/SharedFlow.kt`, `flow/StateFlow.kt`.

**Posts:**
- [Roman Elizarov — «Cold flows, hot channels»](https://elizarov.medium.com/cold-flows-hot-channels-d74769805f9)
- [Roman Elizarov — «Execution context of Kotlin Flows»](https://elizarov.medium.com/execution-context-of-kotlin-flows-b8c151c9309b) — про context preservation и `flowOn`.
- [Roman Elizarov — «Exceptions in Kotlin Flows»](https://elizarov.medium.com/exceptions-in-kotlin-flows-b59643c940fb) — про exception transparency.

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Marcin Moskała)](https://kt.academy/book/coroutines) — главы «Understanding Flow» и «Flow building».
