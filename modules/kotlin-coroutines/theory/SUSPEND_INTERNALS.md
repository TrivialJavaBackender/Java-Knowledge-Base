# Suspend Internals — что генерирует компилятор и кто возобновляет корутину

> **Какую проблему решает.** Убирает магию: показывает, что `suspend` — это обычный JVM-метод с
> дополнительным параметром, а «приостановка» — обычный `return`.
> **Кому это надо.** Тому, кто мостит callback-API, отлаживает зависшие корутины, объясняет на
> собеседовании «почему поток не блокируется», или ловит утечку памяти через продолжение.
> **Когда НЕ надо.** Чтобы просто писать `launch`/`async`/`Flow`, эта глава не нужна —
> хватит [`BASICS.md`](BASICS.md).

Предыстория — [`WHY_COROUTINES.md`](WHY_COROUTINES.md): корутина не «лёгкий поток», а колбек,
который написал компилятор. Здесь — доказательство и подробности.

Все листинги ниже проверяются на коде этого модуля: команды `javap` можно выполнить у себя.

---

## 1. `Continuation` — «что делать дальше»

Весь механизм держится на одном интерфейсе из стандартной библиотеки
(`kotlin.coroutines.Continuation`):

```kotlin
public interface Continuation<in T> {
    public val context: CoroutineContext
    public fun resumeWith(result: Result<T>)
}
```

Читается так: «у меня есть контекст, и когда у тебя появится значение типа `T` — позови меня».
Это ровно тот колбек, который в мире колбеков ([`WHY_COROUTINES.md`](WHY_COROUTINES.md) §2) писали
руками.

**Почему один метод, а не пара `resume` / `resumeWithException`.** Успех и ошибка идут одним каналом
через `Result<T>` — это делает возобновление единообразным: возобновляющей стороне не нужно знать,
чем закончилась операция, она просто передаёт `Result`. Привычные `resume(value)` и
`resumeWithException(e)` — это `@InlineOnly`-обёртки в той же stdlib:

```kotlin
public inline fun <T> Continuation<T>.resume(value: T): Unit = resumeWith(Result.success(value))
public inline fun <T> Continuation<T>.resumeWithException(e: Throwable): Unit = resumeWith(Result.failure(e))
```

---

## 2. Что компилятор делает с сигнатурой

Возьмём функцию из упражнения [Ex01](../src/main/kotlin/exercises/Ex01_Basics.kt):

```kotlin
suspend fun fetchProfile(id: Long): Profile
```

Скомпилируем модуль и посмотрим на реальную JVM-сигнатуру:

```bash
mvn -q compile
javap -p target/classes/exercises/Ex01_BasicsKt.class
```

```
public final class exercises.Ex01_BasicsKt {
  public static final java.lang.Object fetchProfile(long, kotlin.coroutines.Continuation<? super exercises.Profile>);
  public static final java.lang.Object fetchPosts(long, kotlin.coroutines.Continuation<? super java.util.List<exercises.Post>>);
  ...
}
```

Изменений ровно два:

1. **Добавлен скрытый параметр** `Continuation<? super Profile>` — тот самый колбек.
2. **Возвращаемый тип стал `Object`** (в Kotlin-терминах `Any?`), хотя в исходнике был `Profile`.

### Почему `Object`, а не `Profile`

Потому что функция возвращает **одно из двух**:

- готовое значение `Profile` — если результат уже есть;
- специальный маркер `COROUTINE_SUSPENDED` (объект-синглтон
  `kotlin.coroutines.intrinsics.CoroutineSingletons.COROUTINE_SUSPENDED`) — если результата пока нет.

Общий тип для «`Profile` или маркер» — `Any?`. Отсюда важнейшее следствие:

> **Fast path.** Приостановка — не обязательное, а *возможное* поведение. Если значение уже готово
> (лежит в кэше, канал не пуст, `delay(0)`), suspend-функция возвращает его как обычная функция:
> ни переключения потока, ни постановки в очередь, ни лишних аллокаций.

Именно поэтому нельзя говорить «suspend-функция всегда приостанавливается» или «suspend-функция
уходит в фон». Она *может* приостановиться. И решает это не ключевое слово, а конкретная реализация.

---

## 3. Машина состояний

Тело функции с точками приостановки компилятор превращает в конечный автомат. Исходник:

```kotlin
suspend fun handle(id: Long): Report {
    val user = loadUser(id)        // точка приостановки #1
    val orders = loadOrders(user)  // точка приостановки #2
    return Report(user, orders)
}
```

Псевдо-Java того, что генерируется (упрощённо, но по сути так):

```java
Object handle(long id, Continuation<?> $cont) {
    StateMachine sm = ($cont instanceof StateMachine) ? (StateMachine) $cont : new StateMachine($cont);
    Object result = sm.result;

    switch (sm.label) {
        case 0:
            sm.label = 1;
            result = loadUser(id, sm);                 // передаём САМ автомат как продолжение
            if (result == COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED;
            // иначе проваливаемся дальше: значение уже готово (fast path)
        case 1:
            User user = (User) result;
            sm.user = user;                            // локальная переменная → поле объекта
            sm.label = 2;
            result = loadOrders(user, sm);
            if (result == COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED;
        case 2:
            return new Report(sm.user, (List<Order>) result);
    }
}
```

Что здесь важно:

- **Локальные переменные, живущие через приостановку, становятся полями** объекта состояния
  (в байткоде это `L$0`, `L$1`, …). Поэтому корутина «весит» столько, сколько её живые локальные
  переменные, а не мегабайт стека.
- **Одна и та же функция вызывается повторно** с тем же объектом-продолжением — столько раз, сколько
  в ней точек приостановки. Реального стека вызовов между приостановками не существует.
- **Автомат сам является продолжением**: он передаётся вниз как `Continuation`, и его же позовут при
  возобновлении.

Это не гипотеза — посмотрите на любую лямбду билдера в скомпилированном модуле:

```bash
javap -p 'target/classes/exercises/Ex06_FlowKt$main$1.class'
```

```
final class exercises.Ex06_FlowKt$main$1 extends kotlin.coroutines.jvm.internal.SuspendLambda
        implements kotlin.jvm.functions.Function2<...> {
  int label;
  public final java.lang.Object invokeSuspend(java.lang.Object);
  public final kotlin.coroutines.Continuation<kotlin.Unit> create(java.lang.Object, kotlin.coroutines.Continuation<?>);
}
```

`int label` — номер шага автомата. `invokeSuspend` — один шаг. `SuspendLambda` — базовый класс из
stdlib, наследник `BaseContinuationImpl` (см. §4, шаг 5).

---

## 4. Кто и как возобновляет корутину

Самый частый вопрос — и самый непроговорённый. Разберём по шагам на `delay(1000)`.

### Шаг 1. `delay` никого не усыпляет

`delay` — не `Thread.sleep`. Вот его тело (`kotlinx-coroutines-core`, `Delay.kt`):

```kotlin
public suspend fun delay(timeMillis: Long) {
    if (timeMillis <= 0) return                      // fast path: приостановки не будет вовсе
    return suspendCancellableCoroutine { cont ->
        cont.context.delay.scheduleResumeAfterDelay(timeMillis, cont)
    }
}
```

То есть `delay` делает ровно одно: **отдаёт своё продолжение таймеру** и возвращает
`COROUTINE_SUSPENDED`. Никто нигде не спит.

### Шаг 2. Поток уходит

Метод вернул управление — кадр стека снят, поток возвращается в пул и берёт следующую задачу из
очереди. Приостановленную корутину теперь держит **только** ссылка на объект-продолжение, которая
лежит у таймера. Это обычный объект в куче; ничего «не замораживается», потому что замораживать
нечего — состояние уже сохранено в полях.

### Шаг 3. Таймер зовёт `resume`

Через 1000 мс поток планировщика задержек (в kotlinx это `DefaultExecutor` / event loop диспетчера)
вызывает `cont.resume(Unit)`.

Возобновляющая сторона может быть какой угодно — это и есть ответ на «кто возобновляет»:

| Что приостановило | Кто возобновит |
|---|---|
| `delay`, `withTimeout` | поток планировщика задержек |
| `Channel.receive` | корутина, которая позвала `send` |
| `Mutex.lock`, `Semaphore.acquire` | корутина, которая освободила разрешение |
| `Job.join`, `Deferred.await` | корутина, которая завершилась |
| `suspendCancellableCoroutine` вокруг HTTP-клиента | поток пула этого клиента, из колбека |
| `CompletableFuture.await()` | поток, который завершил future |

Никакого «планировщика корутин», который ходит и проверяет, не пора ли кого-то разбудить, **не
существует**. Возобновление всегда инициирует тот, у кого появился результат.

### Шаг 4. Диспетчер решает, *где* продолжить

`cont` — это не голое продолжение из §3, а обёртка `DispatchedContinuation`, которую надел диспетчер
(см. §6). Её `resumeWith` (`kotlinx-coroutines-core`, `internal/DispatchedContinuation.kt`):

```kotlin
override fun resumeWith(result: Result<T>) {
    val state = result.toState()
    if (dispatcher.safeIsDispatchNeeded(context)) {
        _state = state
        dispatcher.safeDispatch(context, this)   // положить себя задачей в очередь диспетчера
    } else {
        executeUnconfined(state, MODE_ATOMIC) { … }  // продолжить прямо здесь и сейчас
    }
}
```

Две ветки — это буквально весь выбор:

- **`isDispatchNeeded == true`** (`Dispatchers.Default`, `IO`, `Main`): продолжение упаковывается в
  задачу и кладётся в очередь. Дальше её подхватит воркер пула — поток с именем вида
  `DefaultDispatcher-worker-3`. Поток таймера при этом свободен через микросекунды.
- **`isDispatchNeeded == false`** (`Dispatchers.Unconfined`): продолжение выполняется **прямо на
  потоке того, кто позвал `resume`** — то есть на потоке таймера. Отсюда «странный» порядок вывода в
  примерах с `Unconfined` и правило «в проде почти никогда».

### Шаг 5. Трамплин: возврат по «стеку корутины» — это цикл

Воркер достал задачу и в конце концов вызвал `resumeWith` у самого автомата. Он унаследован от
`BaseContinuationImpl` (`kotlin-stdlib`, `kotlin/coroutines/jvm/internal/ContinuationImpl.kt`), и вот
что там:

```kotlin
public final override fun resumeWith(result: Result<Any?>) {
    var current = this
    var param = result
    while (true) {                                        // ← цикл, а не рекурсия
        with(current) {
            val completion = completion!!
            val outcome: Result<Any?> = try {
                val outcome = invokeSuspend(param)        // один шаг автомата
                if (outcome === COROUTINE_SUSPENDED) return   // ← снова приостановились: поток свободен
                Result.success(outcome)
            } catch (exception: Throwable) {
                Result.failure(exception)
            }
            if (completion is BaseContinuationImpl) {
                current = completion                      // «вернулись» вызывающей корутине
                param = outcome
            } else {
                completion.resumeWith(outcome)            // дошли до корня
                return
            }
        }
    }
}
```

В комментарии самой stdlib это названо прямо: *«This loop unrolls recursion in
`current.resumeWith(param)` to make saner and shorter stack traces on resume»*.

Два практических следствия:

1. **Цепочка suspend-вызовов любой глубины не даёт `StackOverflowError` при возврате** — возврат
   реализован циклом, а не вложенными вызовами.
2. **Стектрейсы «рваные»**: JVM-стек в момент ошибки содержит один шаг автомата плюс кадры
   диспетчера, а не всю логическую цепочку вызовов. Лечится восстановлением трейса — §8.

---

## 5. Почему поток не блокируется

Собрав §2–§4 вместе, получаем ответ в одном предложении:

> В момент приостановки suspend-функция делает `return COROUTINE_SUSPENDED` — обычный возврат из
> обычного JVM-метода. Кадр стека снимается, поток идёт за следующей задачей. Состояние корутины
> уже лежит в объекте на куче, поэтому ничего сохранять и «замораживать» не нужно.

Сравните с блокировкой: `Thread.sleep(1000)` или `socket.read()` **не возвращают управление**. Поток
остаётся в состоянии `TIMED_WAITING`/`RUNNABLE`-в-ядре, его стек живёт, и планировщик ОС не может
отдать этот поток кому-то другому.

### Граница честности

Всё вышесказанное работает **только** для операций, которые умеют отдать своё продолжение: `delay`,
каналы, `Mutex`, `await`, неблокирующие клиенты, обёрнутые колбеки. Вот это по-прежнему блокирует
поток целиком, несмотря на `suspend` в сигнатуре:

```kotlin
suspend fun bad(): ByteArray {
    Thread.sleep(1000)                  // поток занят: возврата не было
    return File("/tmp/x").readBytes()   // поток занят
}
```

Компилятор такое не ловит. Поэтому существуют:

- `Dispatchers.IO` — пул потоков, которые не жалко заблокировать (см. [`DISPATCHERS.md`](DISPATCHERS.md));
- `runInterruptible` — чтобы отмена корутины дошла до блокирующего вызова через `Thread.interrupt`
  (см. [`INTEROP.md`](INTEROP.md)).

---

## 6. Диспетчер — это перехватчик продолжений

`CoroutineDispatcher` наследует `ContinuationInterceptor` — элемент контекста
(см. [`SCOPE_CONTEXT.md`](SCOPE_CONTEXT.md)). Его работа — один метод:

```kotlin
public fun <T> interceptContinuation(continuation: Continuation<T>): Continuation<T>
```

Когда корутина стартует, библиотека спрашивает у контекста перехватчик и даёт ему обернуть
продолжение. Диспетчер возвращает `DispatchedContinuation` из §4 — обёртку, которая при возобновлении
кладёт работу в нужную очередь.

Отсюда два вывода:

- **Смена диспетчера дёшева**: `withContext(Dispatchers.IO)` не создаёт потоков, а меняет элемент
  контекста, то есть обёртку над продолжением.
- **«На каком потоке я выполняюсь» определяется контекстом, а не словом `suspend`.** Без диспетчера
  suspend-код выполняется там же, где его позвали.

---

## 7. Мост из мира колбеков

Раз возобновление — это вызов `resumeWith`, любой callback-API превращается в suspend-функцию
выдачей продолжения наружу:

```kotlin
suspend fun fetch(id: Long): Data = suspendCancellableCoroutine { cont ->
    val call = client.fetchAsync(id, object : Callback {
        override fun onSuccess(d: Data) = cont.resume(d)
        override fun onError(e: Throwable) = cont.resumeWithException(e)
    })
    cont.invokeOnCancellation { call.cancel() }   // без этого отмена не доедет до библиотеки
}
```

| API | Отмена | Когда использовать |
|---|---|---|
| `suspendCoroutine` | нет | почти никогда: ожидание становится неотменяемым |
| `suspendCancellableCoroutine` | да, через `invokeOnCancellation` | любые колбеки, futures, слушатели |
| `suspendCoroutineUninterceptedOrReturn` | — | intrinsics: вернуть значение синхронно, если оно готово; территория библиотек |

Разбор всех мостов (колбеки, `CompletableFuture`, блокирующий Java-API, обратное направление) —
в [`INTEROP.md`](INTEROP.md). Практика — упражнение
[Ex09](../src/main/kotlin/exercises/Ex09_SuspendInternals.kt).

---

## 8. Стектрейсы и диагностика

Так как непрерывного стека между приостановками нет, «сырой» трейс выглядит так:

```
at com.example.MyClass$loadData$1.invokeSuspend(MyClass.kt:42)
at kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(ContinuationImpl.kt:33)
at kotlinx.coroutines.DispatchedTask.run(DispatchedTask.kt:104)
```

Что с этим делать:

- **Stacktrace recovery** (включено по умолчанию): при пересечении границы приостановки исключение
  копируется, и в трейс добавляется кадр `(Coroutine boundary)` с информацией о том, откуда пришли.
  Отключается флагом `-Dkotlinx.coroutines.stacktrace.recovery=false`.
- **Debug-режим**: `-ea` или `-Dkotlinx.coroutines.debug` — имя корутины попадает в имя потока:
  `DefaultDispatcher-worker-1 @loader#42`. Отсюда польза от `CoroutineName("...")` в контексте.
- **Живая диагностика зависаний**: артефакт `kotlinx-coroutines-debug` и
  `DebugProbes.dumpCoroutines()` печатают дерево живых корутин с их состоянием и точкой
  приостановки. Это прямой ответ на «как понять, где висит прод»: видно не потоки (они свободны!),
  а именно приостановленные корутины.

```kotlin
DebugProbes.install()
// ... воспроизвели зависание
DebugProbes.dumpCoroutines()   // кто где приостановлен и как долго
```

---

## 9. Сколько стоит корутина

| | Поток платформы JVM | Корутина |
|---|---|---|
| Память | ~1 МБ зарезервированного стека + объект ядра | объект-продолжение: заголовок + поля живых локальных переменных, сотни байт |
| Создание | системный вызов, десятки–сотни микросекунд | аллокация объекта |
| Переключение | контекст ядра | вызов метода + возможная постановка задачи в очередь |
| Порядок величин | тысячи | миллионы |

Уточнения, которые стоит держать в голове:

- Аллокация автомата происходит **на вызов suspend-функции, у которой есть хотя бы одна точка
  приостановки**. Функция без точек приостановки компилируется почти как обычная.
- Fast path (§2) не аллоцирует ничего сверх уже созданного автомата.
- Для **CPU-bound** работы преимущество «лёгкости» исчезает: там узкое место — ядра, а не потоки.
- **Утечка памяти через продолжение** — реальный сценарий: если большой объект лежит в локальной
  переменной, живущей через приостановку, он становится полем автомата и удерживается всё время
  ожидания. Лечится сужением области видимости переменной.

---

## 10. Зачем это знать на практике

1. **Мостить callback-API корректно** — `suspendCancellableCoroutine` + `invokeOnCancellation`.
2. **Отлаживать зависания** — потоки пустые, а корутины висят; смотреть `DebugProbes`, а не дамп потоков.
3. **Понимать `Dispatchers.Unconfined`** и почему порядок вывода с ним «неправильный» (§4, шаг 4).
4. **Не бояться странных стектрейсов** и знать, каким флагом их починить.
5. **Объяснять на собеседовании**, почему поток не блокируется, — не словом «магия», а через
   `return COROUTINE_SUSPENDED`.
6. **Видеть утечку через локальную переменную** вокруг долгой приостановки.

---

## Шпаргалка

```kotlin
// Сигнатура: suspend fun f(x: Int): R  →  Object f(int x, Continuation<? super R> $cont)
// Возврат: либо R, либо COROUTINE_SUSPENDED

// Мост из колбека
suspend fun fetch(id: Long): Data = suspendCancellableCoroutine { cont ->
    val call = client.fetchAsync(id, { cont.resume(it) }, { cont.resumeWithException(it) })
    cont.invokeOnCancellation { call.cancel() }
}
```

- `Continuation` = `context` + `resumeWith(Result<T>)`. Это колбек, сгенерированный компилятором.
- Приостановка = `return COROUTINE_SUSPENDED`; поток свободен, состояние — в полях автомата.
- Возобновляет тот, у кого появился результат: таймер, другая корутина, поток HTTP-клиента.
- Диспетчер решает не «кто», а **где**: `dispatch` в очередь либо продолжение на месте (`Unconfined`).
- `BaseContinuationImpl.resumeWith` — цикл-трамплин: нет `StackOverflowError`, но и нет цельного стека.
- `suspend` не делает блокирующий вызов неблокирующим — для этого `Dispatchers.IO` + `runInterruptible`.

---

## Источники

**Исходники (всё в этом файле сверено по ним):**
- `kotlin-stdlib` → `kotlin/coroutines/Continuation.kt`, `kotlin/coroutines/jvm/internal/ContinuationImpl.kt` (`BaseContinuationImpl.resumeWith`).
- `kotlinx-coroutines-core` → `Delay.kt` (`delay`, `scheduleResumeAfterDelay`), `internal/DispatchedContinuation.kt` (`resumeWith`).
- Локально распаковываются из `~/.m2/repository/.../kotlin-stdlib-<v>-sources.jar` и `kotlinx-coroutines-core-jvm-<v>-sources.jar`.

**Спецификация:**
- [KEEP-176: Coroutines proposal](https://github.com/Kotlin/KEEP/blob/master/proposals/coroutines.md) — раздел «Implementation details»: CPS-трансформация и state machine.
- [`Continuation` (stdlib API)](https://kotlinlang.org/api/latest/jvm/stdlib/kotlin.coroutines/-continuation/)
- [`suspendCancellableCoroutine`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/suspend-cancellable-coroutine.html)

**Talks:**
- [Roman Elizarov — «Deep Dive into Coroutines on JVM» (KotlinConf 2017)](https://www.youtube.com/watch?v=YrrUCSi72E8) — пошаговый разбор генерации автомата.
- [Pavlo Liesnikov — «Kotlin Coroutines under the hood»](https://www.youtube.com/watch?v=Xo94e3WTw78)

**Книги:**
- [*Kotlin Coroutines: Deep Dive* (Marcin Moskała)](https://kt.academy/book/coroutines) — главы «How does suspension work» и «Coroutines under the hood».

**Компилятор:**
- [`codegen/coroutines` в JetBrains/kotlin](https://github.com/JetBrains/kotlin/tree/master/compiler/backend/src/org/jetbrains/kotlin/codegen/coroutines) — сама трансформация в байткод.
