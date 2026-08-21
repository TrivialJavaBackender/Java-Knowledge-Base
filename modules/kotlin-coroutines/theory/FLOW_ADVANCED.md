# Flow Advanced — StateFlow, SharedFlow, sharing

> **Какую проблему решают.** Один источник данных нужен нескольким потребителям одновременно, или
> у данных есть «текущее значение», которое должен видеть каждый, кто подключился.
> **Кому это надо.** Тому, кто раздаёт события подписчикам внутри процесса, кэширует состояние
> (конфиг, health, курс валюты) или экономит один дорогой апстрим на N потребителей.
> **Когда НЕ надо.** Один потребитель — обычный холодный `Flow`. Доставка между процессами или
> гарантии «ровно один раз» — это очередь (Kafka, Rabbit), а не `SharedFlow`.

## 0. Какую проблему решает «горячий» поток на бэкенде

Про `StateFlow` обычно рассказывают на примере Android-экрана, из-за чего на бэкенде тема выглядит
чужой. Три сценария, где она своя.

**1. Один дорогой апстрим на N потребителей.** Холодный `Flow` запускает тело на каждую подписку:
десять потребителей — десять подключений к внешнему источнику. `shareIn` делает из него один
живой апстрим, который раздаёт значения всем (§5).

**2. Текущее значение, которое должны видеть все.** Конфигурация из Consul, состояние
circuit breaker, признак «сервис прогрелся», последний курс валюты. Потребителю нужно не «все
изменения с начала времён», а «что сейчас» плюс уведомления об изменениях — это ровно контракт
`StateFlow` (всегда есть `value`, новый подписчик сразу получает актуальное).

**3. Внутрипроцессная шина событий.** Инвалидация локального кэша, уведомление воркеров о смене
настроек, широковещание внутри модуля — `SharedFlow`, потому что событие должно получить **каждый**
подписчик.

Где горячий поток — неправильный ответ:

| Ситуация | Что брать |
|---|---|
| Событие должно обработать ровно один обработчик из пула | `Channel` + fan-out ([`CHANNELS.md`](CHANNELS.md)) |
| Нельзя терять события, нужна доставка между процессами | внешняя очередь; `SharedFlow` живёт в памяти и умирает вместе с процессом |
| Медленный потребитель не должен ничего пропустить | `Channel` с `SUSPEND` или очередь: у `SharedFlow` при переполнении буфера либо приостановится издатель, либо значения потеряются (§4) |
| Одноразовые события (навигация, «показать ошибку») | не `StateFlow`: конфлейт и `distinctUntilChanged` их съедят (§10.2) |

---

## 1. Hot vs Cold — повторение

| | Cold Flow (`flow { }`) | Hot Flow (`StateFlow`/`SharedFlow`) |
|---|---|---|
| Запуск тела | при каждой `collect` | один раз, независимо |
| Подписчики | каждый получает свой запуск | один источник, broadcast |
| Текущее значение | нет | `StateFlow` всегда имеет |
| Обратное давление | через suspend на emit | настраивается (buffer, overflow) |
| Завершение | tail элемент → конец | **никогда** не завершается сам |

---

## 2. `StateFlow<T>` — текущее состояние

```kotlin
class CounterViewModel {
    private val _state = MutableStateFlow(0)
    val state: StateFlow<Int> = _state.asStateFlow()

    fun inc() { _state.value++ }
}
```

Свойства:
- **Всегда имеет значение** (initial value обязателен).
- **`distinctUntilChanged` встроен** — если новое значение `equals` старому, не emit'ится.
- **`replay = 1`** — новый подписчик сразу получает текущее значение.
- Concurrent-safe для `value` (атомарное чтение/запись).

### Когда использовать
- Состояние UI (`isLoading`, `currentUser`).
- Конфигурация, которая меняется во времени.
- Где модель Subject/BehaviorSubject из Rx.

### Атомарное обновление

```kotlin
// ❌ Не атомарно
_state.value = _state.value + 1

// ✅ Атомарно через update
_state.update { it + 1 }
```

`update { }` — это loop с CAS на `compareAndSet`. Под высокой конкуренцией — правильный способ.

---

## 3. `SharedFlow<T>` — события

```kotlin
class EventBus {
    private val _events = MutableSharedFlow<Event>(
        replay = 0,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.SUSPEND,
    )
    val events: SharedFlow<Event> = _events.asSharedFlow()

    suspend fun emit(e: Event) = _events.emit(e)
    fun tryEmit(e: Event): Boolean = _events.tryEmit(e)
}
```

Параметры:

| Параметр | Что |
|----------|-----|
| `replay` | сколько последних значений отдать новому подписчику |
| `extraBufferCapacity` | размер буфера сверх replay |
| `onBufferOverflow` | `SUSPEND` (default), `DROP_OLDEST`, `DROP_LATEST` |

### `replay = 1` vs `StateFlow`

| | `StateFlow` | `MutableSharedFlow(replay=1)` |
|---|---|---|
| Initial value | обязательный | нет (буфер пустой до первого emit) |
| `value` | можно читать | нет |
| `distinctUntilChanged` | встроен | нет |
| Подписчик до emit | получит initial | получит nothing |

`StateFlow` — это специализация `SharedFlow` с `replay=1` и встроенным conflate-семантикой.

### `tryEmit` vs `emit`

- `emit` — suspend, ждёт пока место освободится в буфере (если `SUSPEND`).
- `tryEmit` — non-suspend, возвращает `Boolean`. Используй в callback API, где нет корутины. Если буфер переполнен с `SUSPEND` — вернёт `false`.

---

## 4. `BufferOverflow` стратегии

```kotlin
MutableSharedFlow<T>(extraBufferCapacity = 4, onBufferOverflow = ...)
```

| Стратегия | Когда буфер полный |
|-----------|--------------------|
| `SUSPEND` | `emit` ждёт; `tryEmit` возвращает false |
| `DROP_OLDEST` | удаляет старейший в буфере, добавляет новый |
| `DROP_LATEST` | игнорирует новый |

`DROP_OLDEST` идеален для real-time данных (последнее измерение датчика). `DROP_LATEST` — для idempotent событий (всё равно подхватим следующее).

---

## 5. `shareIn` и `stateIn` — превратить Cold в Hot

Часто хочешь взять холодный Flow (например, от API) и **разделить** между несколькими подписчиками, не запуская исходный Flow несколько раз:

```kotlin
val ticker: Flow<Int> = flow {
    var i = 0
    while (true) { delay(1000); emit(i++) }
}

val sharedTicker: SharedFlow<Int> = ticker.shareIn(
    scope = serviceScope,
    started = SharingStarted.WhileSubscribed(5_000),
    replay = 0,
)
```

```kotlin
val state: StateFlow<UiState> = repository.dataFlow
    .map { toUi(it) }
    .stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = UiState.Loading,
    )
```

### `SharingStarted` стратегии

| Стратегия | Когда запускать upstream |
|-----------|--------------------------|
| `Eagerly` | сразу при `shareIn`/`stateIn`, никогда не останавливать |
| `Lazily` | при появлении первого подписчика, никогда не останавливать |
| `WhileSubscribed(stopTimeout, replayExpiration)` | при появлении подписчика; останавливать через `stopTimeout` после ухода последнего |

`WhileSubscribed(5000)` — канонический выбор для UI: 5 сек grace period покрывает rotation/перенос между фрагментами.

---

## 6. `combine` / `zip` для нескольких StateFlow

```kotlin
val composed: Flow<UiState> = combine(
    profileFlow,
    notificationsFlow,
    networkFlow,
) { profile, notif, online ->
    UiState(profile, notif, online)
}.stateIn(scope, WhileSubscribed(5_000), UiState.empty)
```

`combine` пересчитывает при изменении любого из источников. `zip` ждёт обоих и идёт парами (редко нужно для StateFlow).

---

## 7. Conflate / debounce / sample / throttle

| Оператор | Поведение |
|----------|-----------|
| `conflate()` | если consumer медленный, выдаёт только последнее (старые буферизованные пропускает) |
| `debounce(t)` | излучает значение, только если за `t` не пришло новое |
| `sample(t)` | излучает последнее каждые `t` |
| `throttleFirst` (нет в stdlib, в FlowExt) | первое в окне |

```kotlin
// Поиск-as-you-type
queryFlow
    .debounce(300)
    .distinctUntilChanged()
    .flatMapLatest { q -> api.search(q) }
```

```kotlin
// Telemetry: последние данные раз в секунду
sensorFlow.sample(1000).collect { upload(it) }
```

---

## 8. Жизненный цикл и `WhileSubscribed`

`WhileSubscribed(stopTimeoutMillis, replayExpirationMillis)`:

- **stopTimeoutMillis** — задержка после ухода последнего подписчика, прежде чем остановить upstream. Если за это время появится новый — продолжит без перезапуска.
- **replayExpirationMillis** — после остановки сколько ждать перед сбросом replay-буфера. `Long.MAX_VALUE` (default) — никогда не сбрасывать.

Канонические комбинации:
- UI: `WhileSubscribed(5000)` — переживём смену конфигурации.
- Heavy stream (camera/sensor): `WhileSubscribed(0)` — останавливать сразу.
- Critical service: `Eagerly`.

---

## 9. Тестирование hot flows

`StateFlow`/`SharedFlow` тестируются через сбор в `TestScope`:

```kotlin
@Test
fun `counter increments`() = runTest {
    val vm = CounterViewModel()
    val emitted = mutableListOf<Int>()
    val job = launch { vm.state.toList(emitted) }     // никогда не завершится сам

    vm.inc()
    vm.inc()
    runCurrent()

    assertEquals(listOf(0, 1, 2), emitted)
    job.cancel()
}
```

Альтернатива через [`Turbine`](https://github.com/cashapp/turbine) — внешняя библиотека, но идиоматичнее.

---

## 10. Анти-паттерны

### 10.1 `MutableStateFlow.value =` под высоким contention

```kotlin
// ❌ races possible
counter.value = counter.value + 1

// ✅
counter.update { it + 1 }
```

### 10.2 `replay > 0` для одноразовых событий

```kotlin
val navEvents = MutableSharedFlow<NavEvent>(replay = 1)  // ❌
```

При повороте экрана подписчик получит старый event и снова сделает navigate. Используй `replay = 0` или **single-event** паттерны (`Channel<NavEvent>(BUFFERED).receiveAsFlow()`).

### 10.3 `StateFlow` для непрерывного потока без conflate-семантики

`StateFlow` всегда conflated и `distinctUntilChanged`. Если нужны все промежуточные значения — `SharedFlow(replay=N, extraBufferCapacity=N)`.

### 10.4 Не передавать scope в `shareIn`

```kotlin
flow.shareIn(GlobalScope, ...)   // ❌ утечёт навсегда
```

Используй scope с осмысленным lifecycle.

---

## Шпаргалка

```kotlin
// Состояние
val state: StateFlow<UiState> = repo.dataFlow
    .map(::toUi)
    .stateIn(scope, SharingStarted.WhileSubscribed(5_000), UiState.Loading)

// События
private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 64)
val events: SharedFlow<Event> = _events.asSharedFlow()

// Атомарное обновление
_state.update { it.copy(loading = true) }

// Шарить cold flow
val shared = coldFlow.shareIn(scope, WhileSubscribed(5_000), replay = 0)
```

---

## Источники

**Официальная документация:**
- [`StateFlow` API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-state-flow/) — conflated, `value`, `update`.
- [`SharedFlow` API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-shared-flow/) — `replay`, `extraBufferCapacity`, `BufferOverflow`.
- [`SharingStarted` (`Eagerly` / `Lazily` / `WhileSubscribed`)](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-sharing-started/)

**Posts (canonical):**
- [Roman Elizarov — «Shared flows, broadcast channels»](https://elizarov.medium.com/shared-flows-broadcast-channels-899b675e805c) — почему появились `SharedFlow`/`StateFlow` и как они заменили `BroadcastChannel`.
- [Manuel Vivo — «Things to know about Flow's `shareIn` and `stateIn` operators»](https://medium.com/androiddevelopers/things-to-know-about-flows-sharein-and-statein-operators-20e6ccb2bc74) — как именно работает `WhileSubscribed(5_000)`.
- [Marko Devcic — «StateFlow, end of LiveData?»](https://proandroiddev.com/) — практическое сравнение для Android.

**Talks:**
- [Manuel Vivo — «Flows in Android: Three things every Android developer should know» (Android Dev Summit)](https://www.youtube.com/watch?v=BOHK_w09pVA)

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Moskała)](https://kt.academy/book/coroutines) — глава «SharedFlow and StateFlow».
