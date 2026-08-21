# Разделяемое состояние в корутинах

> **Какую проблему решает.** Несколько корутин трогают одни и те же данные — как не потерять
> обновления и при этом не заблокировать поток.
> **Кому это надо.** Тому, у кого есть счётчик, кэш, буфер или любое поле, которое пишут из
> нескольких корутин; и тому, кто ограничивает число одновременных вызовов наружу.
> **Когда НЕ надо.** Если состояние не разделяется (каждая корутина работает со своими данными) —
> синхронизация не нужна вообще, и это лучший вариант.

Отдельный файл нужен потому, что привычные из мира потоков инструменты здесь работают
**неправильно**: `synchronized` вокруг suspend-вызова нельзя, а `ReentrantLock` блокирует поток,
которого у корутины, строго говоря, нет.

> Про JVM-примитивы (`synchronized`, `ReentrantLock`, `java.util.concurrent.Semaphore`,
> `AtomicInteger`, happens-before) — модуль
> [`concurrency`](../../concurrency/theory/LOCKS.md). Здесь только корутинная специфика.

---

## 1. Гонка возможна даже на одном потоке

Первое, что ломает интуицию. Классическая гонка на многопоточном диспетчере очевидна:

```kotlin
var counter = 0

coroutineScope {
    repeat(100) {
        launch(Dispatchers.Default) {
            repeat(1000) { counter++ }     // потеряем часть инкрементов
        }
    }
}
println(counter)                            // почти никогда не 100_000
```

`counter++` — это три операции: прочитать, прибавить, записать. Два потока читают одно и то же
значение, и одно обновление теряется.

Но вот менее очевидный случай — **однопоточный** диспетчер:

```kotlin
val single = Dispatchers.Default.limitedParallelism(1)
var balance = 100

suspend fun withdraw(amount: Int) = withContext(single) {
    val current = balance          // прочитали 100
    delay(1)                       // ← точка приостановки: сюда влезает другая корутина
    balance = current - amount     // записали 100 - amount, затерев чужую запись
}
```

Здесь параллельности нет вообще — но есть **конкурентность**. В точке приостановки поток уходит
выполнять другую корутину, и та успевает изменить `balance` между чтением и записью.

> **Правило.** Атомарность даёт не «однопоточность», а отсутствие точек приостановки внутри
> критической секции — либо явная синхронизация.

---

## 2. Арсенал: от дешёвого к дорогому

| Средство | Цена | Когда |
|---|---|---|
| Не разделять состояние вообще (иммутабельные данные, локальные переменные) | ноль | всегда, когда возможно |
| `MutableStateFlow` + `update { }` | очень низкая | «состояние = значение», которое ещё и надо наблюдать |
| Атомики (`AtomicInteger`, `AtomicReference`) | очень низкая | счётчики, CAS-обновления одной ячейки |
| `Dispatchers.X.limitedParallelism(1)` (confinement) | низкая | изолировать кусок состояния, доступ к нему сериализован по построению |
| `Mutex.withLock { }` | средняя | нужна критическая секция, внутри которой есть suspend-вызовы |
| `Semaphore.withPermit { }` | средняя | ограничить **число** одновременных участников (это не взаимное исключение) |
| Актор на `Channel` | высокая | сложное состояние с очередью команд и своим протоколом |

```kotlin
// 1. Атомик — когда состояние это одна ячейка
val processed = AtomicInteger()
processed.incrementAndGet()

// 2. StateFlow — когда состояние ещё и наблюдают
private val _state = MutableStateFlow(UiState.empty)
_state.update { it.copy(count = it.count + 1) }    // CAS-цикл внутри, не теряет обновления

// 3. Confinement — всё состояние обслуживается «одним потоком»
private val stateDispatcher = Dispatchers.Default.limitedParallelism(1)
private var cache = mutableMapOf<Long, User>()
suspend fun put(id: Long, u: User) = withContext(stateDispatcher) { cache[id] = u }

// 4. Mutex — критическая секция с suspend внутри
private val mutex = Mutex()
suspend fun refresh(key: String) = mutex.withLock {
    if (key !in cache) cache[key] = loadValue(key)   // loadValue — suspend
}

// 5. Semaphore — не больше 8 одновременных вызовов наружу
private val semaphore = Semaphore(8)
suspend fun call(item: Item) = semaphore.withPermit { api.send(item) }
```

`Mutex` и `Semaphore` здесь — из `kotlinx.coroutines.sync`, а не из `java.util.concurrent`. Разница
принципиальная: корутинные версии **приостанавливают корутину**, а не блокируют поток.

---

## 3. Почему `synchronized` не годится

```kotlin
// ❌ даже не скомпилируется
synchronized(lock) {
    loadUser()          // suspend-вызов внутри synchronized запрещён компилятором
}
```

Причина в самой природе монитора: **монитор JVM принадлежит потоку**. Корутина же после
приостановки может продолжиться на другом потоке ([`SUSPEND_INTERNALS.md`](SUSPEND_INTERNALS.md) §4)
— и отпускать монитор будет «не тот» поток, что немедленно даёт `IllegalMonitorStateException` либо
навсегда заклинивший замок. Kotlin просто запрещает такой код.

Обход через `ReentrantLock` формально компилируется, но хуже: `lock()` **блокирует поток** пула,
пока замок занят, — то есть съедает ровно тот ресурс, ради экономии которого брали корутины. И
реентерабельность здесь тоже не спасает: корутина, приостановившись, продолжится на другом потоке, а
владельцем замка числится первый.

`Mutex` устроен кооперативно: если замок занят, корутина **приостанавливается**, поток уходит
работать дальше, а `unlock` возобновит одну из ожидающих.

### `Mutex` не реентерабельный

```kotlin
suspend fun outer() = mutex.withLock {
    inner()                       // ❌ если inner() тоже берёт mutex — дедлок навсегда
}
```

У `Mutex` нет понятия «владелец-поток», поэтому он не может понять, что повторный захват делает та
же самая корутина. Это осознанное решение авторов: реентерабельность прячет ошибки проектирования.
Лечение — вынести общую часть в приватную функцию, которая **не** берёт замок, и вызывать её из
обеих точек под уже взятым замком.

---

## 4. Как выбирать: confinement, `Mutex` или актор

Три инструмента решают одну задачу, но с разной ценой.

**`limitedParallelism(1)` (confinement).** Состояние обслуживается «одним потоком» — все обращения
сериализованы диспетчером, синхронизация не нужна вообще. Дёшево и просто. Ограничение: защищает
только то, к чему **все** обращения идут через этот диспетчер. Один прямой доступ мимо — и гарантии
нет.

**`Mutex`.** Явная критическая секция вокруг конкретного участка кода. Подходит, когда состояние
трогают из разных мест и загонять всё под один диспетчер неудобно. Цена: надо помнить про
нереентерабельность и про порядок захвата, если замков несколько.

**Актор на `Channel`.** Состояние живёт внутри одной корутины, снаружи в неё шлют команды:

```kotlin
sealed interface Cmd
data class Add(val n: Int) : Cmd
data class Get(val reply: CompletableDeferred<Int>) : Cmd

fun CoroutineScope.counterActor(): SendChannel<Cmd> {
    val commands = Channel<Cmd>(capacity = 64)
    launch {
        var value = 0
        for (cmd in commands) when (cmd) {
            is Add -> value += cmd.n
            is Get -> cmd.reply.complete(value)
        }
    }
    return commands
}
```

Что это даёт сверх `Mutex`: **очередь и протокол**. Команды упорядочены, у них есть обратное давление (backpressure)
(канал ограничен), можно добавлять команды со сложной семантикой, а состояние физически недоступно
снаружи. Что это стоит: больше кода, ответы приходят асинхронно, нужен свой scope и корректное
закрытие канала.

> Практический критерий: если «актор» хранит одно значение и принимает `Inc`/`Get` — это
> `MutableStateFlow` + `update { }`, и актор здесь лишний. Актор оправдан, когда команд несколько,
> они меняют состояние по-разному и порядок обработки важен.

Готовый билдер `actor { }` помечен `@ObsoleteCoroutinesApi` — в новом коде собирайте актора руками
из `Channel` + `launch`, как выше (см. [`CHANNELS.md`](CHANNELS.md)).

---

## 5. `Semaphore` — это не про взаимное исключение

Частая путаница. `Mutex` отвечает на вопрос «кто сейчас трогает состояние» (ровно один).
`Semaphore(n)` отвечает на вопрос «сколько операций идёт одновременно» (не больше `n`) и обычно не
защищает никакого состояния вообще:

```kotlin
suspend fun <T, R> List<T>.mapLimited(limit: Int, transform: suspend (T) -> R): List<R> =
    coroutineScope {
        val semaphore = Semaphore(limit)
        map { item -> async { semaphore.withPermit { transform(item) } } }.awaitAll()
    }
```

Типичное применение — не уронить внешний сервис и не выбрать весь пул соединений. Это уже
прикладной паттерн, разбор — в [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md), практика — упражнение
[Ex13](../src/main/kotlin/exercises/Ex13_BoundedParallelism.kt).

Альтернативы `Semaphore` для той же цели: `limitedParallelism(n)` на диспетчере,
`flatMapMerge(concurrency = n)` для `Flow`, fan-out воркеров на канале.

---

## 6. Правила против дедлоков

1. **Держите критическую секцию короткой.** Никаких сетевых вызовов под `Mutex`: пока один ждёт
   ответа, все остальные стоят — вы сериализовали всю систему.
2. **Не блокируйте поток внутри `withLock`** (`Thread.sleep`, JDBC без `withContext`) — заблокируете
   поток пула, держа при этом замок.
3. **Два замка — фиксированный глобальный порядок захвата.** Классическое правило из мира потоков
   работает и здесь.
4. **Никакой рекурсии под `Mutex`** — он не реентерабельный (§3).
5. **Не вызывайте под замком чужой код** (колбеки, лямбды из параметров): вы не знаете, что он
   сделает, и не можете гарантировать, что он не попросит тот же замок.

---

## 7. Частые ошибки

1. **`var` под конкурентным доступом без синхронизации** — потерянные обновления, даже на одном
   потоке (§1).
2. **`synchronized`/`ReentrantLock` вокруг suspend-кода** — блокировка потока и некорректное
   владение монитором (§3).
3. **Долгая операция под `Mutex`** — латентность и сериализация всей системы.
4. **Рекурсивный `withLock`** — дедлок навсегда.
5. **`MutableStateFlow.value = value + 1`** вместо `update { }` — это read-modify-write, то есть
   гонка (см. [`FLOW_ADVANCED.md`](FLOW_ADVANCED.md) §10.1).
6. **`Semaphore` там, где нужен `Mutex`** (`Semaphore(1)` — работающий, но неочевидный способ
   написать взаимное исключение) и наоборот.
7. **Confinement с «одной дверцей мимо»** — один прямой доступ к состоянию в обход диспетчера
   обнуляет гарантию.

---

## Шпаргалка

```kotlin
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

private val mutex = Mutex()                 // взаимное исключение, НЕ реентерабельный
suspend fun update() = mutex.withLock { … }

private val gate = Semaphore(8)             // лимит одновременных операций
suspend fun call() = gate.withPermit { api.send() }

private val confined = Dispatchers.Default.limitedParallelism(1)   // сериализация доступа
suspend fun put(k: K, v: V) = withContext(confined) { map[k] = v }

_state.update { it.copy(n = it.n + 1) }     // атомарное обновление StateFlow
```

- Гонка возможна и на одном потоке: между чтением и записью может быть точка приостановки.
- `synchronized` вокруг suspend нельзя: монитор принадлежит потоку, корутина — нет.
- `Mutex` приостанавливает, а не блокирует; и он **не реентерабельный**.
- `Mutex` — «кто трогает состояние»; `Semaphore` — «сколько операций идёт».
- Порядок предпочтений: не разделять → атомик/`StateFlow` → confinement → `Mutex` → актор.
- Под замком — коротко, без ввода-вывода, без чужого кода, без рекурсии.

---

## Источники

**Официальная документация:**
- [Shared mutable state and concurrency](https://kotlinlang.org/docs/shared-mutable-state-and-concurrency.html) — канонический разбор с теми же примерами счётчика.
- [`Mutex` API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.sync/-mutex/) — явно оговорена нереентерабельность.
- [`Semaphore` API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.sync/-semaphore/)
- [`limitedParallelism`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-dispatcher/limited-parallelism.html)

**Смежные модули:**
- [`concurrency/theory/LOCKS.md`](../../concurrency/theory/LOCKS.md) — `synchronized`, `ReentrantLock`, семантика мониторов JVM.
- [`concurrency/theory/ATOMIC_CAS.md`](../../concurrency/theory/ATOMIC_CAS.md) — CAS, `Atomic*`, ABA.
- [`concurrency/theory/SYNCHRONIZERS.md`](../../concurrency/theory/SYNCHRONIZERS.md) — блокирующий `java.util.concurrent.Semaphore`.

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Marcin Moskała)](https://kt.academy/book/coroutines) — глава «The problem with shared state».
