# Domain-Driven Design — Функциональный DDD

Тактический DDD вырос в объектно-ориентированной культуре: богатый агрегат прячет состояние за `private set` и защищает инварианты методами. Но у DDD есть и второе, функциональное прочтение — оно достигает тех же целей другими средствами: не инкапсуляцией изменяемого состояния, а **системой типов и неизменяемостью**. Многие идеи DDD — самовалидация Value Object, явные доменные ошибки, точное моделирование состояний — в функциональном стиле выражаются даже чище, чем в ООП.

Важно с самого начала: функциональный стиль **дополняет** объектный DDD, а не спорит с ним. Kotlin позволяет свободно смешивать оба подхода — держать богатый агрегат там, где нужна инкапсуляция изменяемого жизненного цикла, и чистые функции над неизменяемыми типами там, где логика — это преобразование данных.

Базовые кирпичи функционального программирования — чистые функции, неизменяемость, ссылочная прозрачность (referential transparency), функции высшего порядка (HOF), каррирование — здесь **не** раскрываются: их канонический разбор в [../../software-engineering/theory/STREAM_API_FP.md](../../software-engineering/theory/STREAM_API_FP.md). Эта страница — про то, как приложить их к моделированию домена.

## Сделать невалидные состояния непредставимыми (make illegal states unrepresentable)

Ключевой принцип функционального моделирования: спроектируй типы так, чтобы **невалидное доменное состояние нельзя было даже сконструировать**. Тогда его не придётся проверять в рантайме — компилятор отвергнет неправильную программу.

Посмотрите на типичную анемичную запись платежа:

```kotlin
// ПЛОХО: тип допускает бессмыслицу
class Payment {
    var status: String = "PENDING"      // "магическая строка", опечатка компилируется
    var authCode: String? = null        // осмыслен только когда авторизован
    var capturedAmount: Money? = null   // осмыслен только когда захвачен
    var refundReason: String? = null    // осмыслен только когда возвращён
}
```

Этот тип описывает состояния, которых в домене не бывает: платёж со статусом `"PENDING"`, но заполненным `refundReason`; захваченный платёж с `capturedAmount == null`. Каждый метод вынужден перепроверять комбинации полей (`if (status == "CAPTURED" && capturedAmount != null)`), и рано или поздно одну из проверок забудут. **Nullable-поле, осмысленное лишь в части состояний, — почти всегда сигнал, что здесь должен быть sum-тип.**

## Алгебраические типы данных: product и sum

Алгебраические типы данных (ADT) — два способа собирать типы из других типов.

| Вид | Смысл | Kotlin | Число значений |
|---|---|---|---|
| **Product** | «И»: значение содержит поле A **и** поле B **и** … | `data class` | `A × B × …` |
| **Sum** | «ИЛИ»: значение — это A **или** B **или** … | `sealed class` / `sealed interface` | `A + B + …` |

`data class OrderLine(val productId: ProductId, val unitPrice: Money, val quantity: Int)` — product-тип: строка заказа несёт **все** три поля сразу. Sum-тип, наоборот, говорит «одно из»: `sealed`-иерархия перечисляет **закрытый** список вариантов, и у каждого варианта — **свои** данные.

Перепишем платёж sum-типом — и невалидные комбинации станут непредставимы:

```kotlin
sealed interface PaymentStatus {
    // у каждого состояния — ровно те данные, что для него осмысленны, и не nullable
    data object Pending : PaymentStatus
    data class Authorized(val authCode: String, val at: Instant) : PaymentStatus
    data class Captured(val amount: Money, val at: Instant) : PaymentStatus
    data class Refunded(val reason: String, val at: Instant) : PaymentStatus
}
```

Теперь `Captured` без суммы или `Refunded` без причины просто **не скомпилируется** — данные привязаны к состоянию, к которому относятся. Ни одного nullable-поля, ни одной «магической строки».

Второй выигрыш — **исчерпывающий (exhaustive) `when` под контролем компилятора**. Раз иерархия закрыта, компилятор знает все варианты и требует обработать каждый:

```kotlin
fun describe(status: PaymentStatus): String = when (status) {   // без else!
    PaymentStatus.Pending      -> "ожидает оплаты"
    is PaymentStatus.Authorized -> "авторизован, код ${status.authCode}"
    is PaymentStatus.Captured   -> "оплачен на ${status.amount}"
    is PaymentStatus.Refunded   -> "возвращён: ${status.reason}"
}
```

Добавите пятое состояние — компилятор укажет **каждый** `when`, который его не обрабатывает. Сравните с `enum` + разрозненными nullable-полями, где новый статус тихо проскакивает мимо забытой ветки. В Java та же техника — `sealed`-классы (JEP 409) и pattern matching для `switch`, см. [../../java-core/theory/MODERN_JAVA_FEATURES.md](../../java-core/theory/MODERN_JAVA_FEATURES.md); здесь примеры на Kotlin.

## Функциональное ядро, императивная оболочка (functional core / imperative shell)

Как отделить чистую доменную логику от «грязного» ввода-вывода? Правило **functional core / imperative shell**:

- **Ядро (core)** — чистые функции над неизменяемыми типами. Оно принимает решения (валидация, расчёт, переход состояния) и **не делает I/O**: ни базы, ни сети, ни времени, ни случайностей. Одни и те же аргументы всегда дают один результат — ядро тривиально тестируется без моков.
- **Оболочка (shell)** — тонкий императивный слой, который читает данные из мира, зовёт ядро, записывает результат обратно. Все побочные эффекты живут здесь.

Это прямая функциональная проекция гексагональной архитектуры: ядро = домен внутри шестиугольника, оболочка = адаптеры на портах (см. [ARCHITECTURE.md](ARCHITECTURE.md)). Оболочка зависит от ядра, ядро об оболочке не знает.

### decide / evolve

Каноническая форма функционального ядра для агрегата — **пара функций**:

```kotlin
// decide: текущее состояние + команда → решение (события) ИЛИ доменная ошибка
fun decide(state: Account, cmd: Withdraw): Result<List<AccountEvent>>

// evolve: состояние + свершившееся событие → новое состояние (без проверок!)
fun evolve(state: Account, event: AccountEvent): Account
```

`decide` — единственное место, где живут бизнес-правила: оно смотрит на состояние, проверяет инвариант и **решает**, какие факты произошли. `evolve` слепо применяет уже случившийся факт. Разделение принципиально: восстановление агрегата из истории (replay) прогоняет только `evolve`, минуя `decide`, — поэтому изменение правила «задним числом» не ломает загрузку старых данных, законных по правилам своего времени.

В демо `billing/Account.kt` это разделение зашито прямо в объектный агрегат — команда и `apply` разнесены:

```kotlin
// КОМАНДА (= decide): проверяет инвариант на текущем состоянии, порождает событие
fun withdraw(amount: Money, reason: String) {
    require(amount.isPositive()) { "Сумма списания должна быть положительной" }
    if (balance < amount) {                         // инвариант «баланс ≥ 0»
        throw InsufficientFundsException(id, requested = amount, available = balance)
    }
    raise(MoneyWithdrawn(id, amount, reason, Instant.now()))
}

// ПРИМЕНЕНИЕ (= evolve): меняет состояние по факту, БЕЗ ПРОВЕРОК
private fun applyEvent(event: AccountEvent) = when (event) {
    is AccountOpened   -> { ownerId = event.ownerId; balance = event.initialDeposit }
    is MoneyDeposited  -> balance += event.amount
    is MoneyWithdrawn  -> balance -= event.amount
}
```

Здесь `withdraw` — это `decide`, `applyEvent` — это `evolve`, просто над изменяемым состоянием класса. Чисто функциональный вариант вернул бы **новое** состояние вместо мутации `balance`, но замысел тот же: решение отделено от применения.

## Неизменяемость домена и обновление через copy

В функциональном стиле доменные типы неизменяемы: «изменение» — это **новое значение**, а не мутация старого. Это ровно природа Value Object (канонический разбор — в [TACTICAL_PATTERNS.md](TACTICAL_PATTERNS.md)). `Money` в демо неизменяем: любая операция возвращает новый объект.

```kotlin
operator fun plus(other: Money): Money {          // не меняет this — возвращает НОВЫЙ Money
    requireSameCurrency(other)
    return Money(amount + other.amount, currency)
}
```

Для product-типов Kotlin даёт `copy` — новое значение с частью изменённых полей:

```kotlin
data class OrderLine(val productId: ProductId, val unitPrice: Money, val quantity: Int)

val line = OrderLine(productId, Money.rub("100"), quantity = 1)
val more = line.copy(quantity = 3)                // line не тронут, more — новое значение
```

Неизменяемое значение можно свободно передавать и разделять между потоками — его никто не испортит. Инварианты проверяются один раз, при конструировании, и держатся вечно.

## Result/Either вместо исключений: тотальные функции

Доменная ошибка — это не сбой инфраструктуры, а **нормальный исход**: «недостаточно средств», «заказ пуст», «неверный email». Выбрасывать на такое исключение — значит прятать возможный результат в невидимый в сигнатуре канал. Функциональный ответ: сделать функцию **тотальной** — вернуть ошибку **значением**. Тип `Result`/`Either` кодирует «успех ИЛИ ошибка» (тоже sum-тип):

```kotlin
sealed interface Result<out T> {
    data class Ok<out T>(val value: T) : Result<T>
    data class Err(val error: DomainError) : Result<Nothing>
}

inline fun <T, R> Result<T>.map(f: (T) -> R): Result<R> = when (this) {
    is Result.Ok  -> Result.Ok(f(value))
    is Result.Err -> this
}
inline fun <T, R> Result<T>.flatMap(f: (T) -> Result<R>): Result<R> = when (this) {
    is Result.Ok  -> f(value)
    is Result.Err -> this            // ошибка «проезжает» дальше нетронутой
}
```

Сигнатура `fun withdraw(...): Result<Account>` честно говорит: результат — либо новый счёт, либо доменная ошибка. Вызывающий **обязан** обработать оба варианта (тот же исчерпывающий `when`) — забыть ошибку компилятор не даст.

### Railway-oriented programming

Когда доменная операция — это конвейер шагов, каждый из которых может дать ошибку, композиция через `flatMap` даёт **программирование по рельсам** (railway-oriented programming, Wlaschin). Представьте две колеи: «успех» и «ошибка». Каждый шаг — стрелка: пока всё хорошо, значение едет по верхней колее; первый же `Err` переводит поезд на нижнюю, и остальные шаги проскакивают, не выполняясь.

```kotlin
fun placeOrder(cmd: PlaceOrderCommand): Result<Order> =
    parseCustomerId(cmd.customerId)                  // Result<CustomerId>
        .flatMap { customerId ->
            parseAddress(cmd.address)                // Result<ShippingAddress>
                .map { address -> Order.draft(customerId, address) }
        }
        .flatMap { order -> order.addLines(cmd.lines) }   // Result<Order>
        .flatMap { order -> order.place() }               // Result<Order>: пусто? → Err
```

Никаких вложенных `try/catch`: happy path читается сверху вниз одной цепочкой, а обработка ошибок «растворена» в комбинаторах. Ошибка любого шага короткозамкнёт остаток конвейера и вернётся вызывающему как значение.

## Parse, don't validate: smart constructor

Принцип **«parse, don't validate»** (Alexis King): не проверяй данные раз за разом — **однократно преврати** их в тип, само существование которого гарантирует валидность. Инструмент — **smart constructor** (умный конструктор): приватный конструктор Value Object плюс фабрика-парсер, возвращающая `Result<VO>`.

```kotlin
class EmailAddress private constructor(val value: String) {   // конструктор закрыт
    companion object {
        private val RE = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

        // парсер: сырая строка → валидный тип ИЛИ ошибка
        fun parse(raw: String): Result<EmailAddress> {
            val v = raw.trim().lowercase()
            return if (RE.matches(v)) Result.Ok(EmailAddress(v))
                   else Result.Err(DomainError("Некорректный email: $raw"))
        }
    }
}
```

Дальше по коду вы принимаете `EmailAddress`, а не `String`. **Раз вы держите этот тип — он уже валиден; перепроверять не нужно.** Валидация случилась один раз, на границе, а тип пронёс гарантию через всю программу. Это ровно то, что делает фабрика `Money.invoke()` в демо (валидация точности + нормализация scale), только та бросает исключение, а smart constructor возвращает ошибку значением:

```kotlin
operator fun invoke(amount: BigDecimal, currency: Currency): Money {
    require(amount.scale() <= currency.defaultFractionDigits) { "Недопустимая точность…" }
    return Money(amount.setScale(currency.defaultFractionDigits), currency)  // каноническая форма
}
```

Разница «validate» против «parse»: `validate(x): Boolean` проверяет и **выбрасывает информацию** (после проверки у вас на руках всё тот же `String`, и следующий слой проверит снова); `parse(x): Result<VO>` проверяет и **сохраняет** результат проверки в типе. Первый порождает оборонительное перепроверяющее программирование, второй — устраняет его причину.

> **Врезка.** Функциональный DDD не отменяет богатый агрегат. `Order` из демо остаётся объектом с инкапсулированным жизненным циклом — там, где логика есть управление изменяемым состоянием, ООП уместнее. А `Money`, `PaymentStatus`, конвейер валидации — там, где логика есть преобразование неизменяемых данных, чище функциональный стиль. Kotlin (data-класс + sealed + операторы + Result) позволяет держать оба в одной кодовой базе и выбирать по месту. Композицию операций одного типа (`Money + Money = Money`, `Spec and Spec = Spec`) — closure of operations — см. в [SUPPLE_DESIGN.md](SUPPLE_DESIGN.md).

## Где почитать дальше

- [SUPPLE_DESIGN.md](SUPPLE_DESIGN.md) — closure of operations, side-effect-free functions, гибкий дизайн модели.
- [TACTICAL_PATTERNS.md](TACTICAL_PATTERNS.md) — Value Object и его неизменяемость как объектный фундамент.
- [AGGREGATE_DESIGN.md](AGGREGATE_DESIGN.md) — богатый агрегат `Order`, который функциональный стиль дополняет, а не заменяет.
- [ARCHITECTURE.md](ARCHITECTURE.md) — гексагональная архитектура: ядро внутри, адаптеры снаружи.
- [../../software-engineering/theory/STREAM_API_FP.md](../../software-engineering/theory/STREAM_API_FP.md) — чистые функции, неизменяемость, referential transparency, HOF, каррирование.
- [../../java-core/theory/MODERN_JAVA_FEATURES.md](../../java-core/theory/MODERN_JAVA_FEATURES.md) — sealed-классы (JEP 409) и pattern matching в Java.

## Источники

- Scott Wlaschin. *Domain Modeling Made Functional.* Pragmatic Bookshelf, 2018 — «make illegal states unrepresentable», railway-oriented programming, тип как гарантия.
- Alexis King. *Parse, Don't Validate.* 2019 — smart constructor, парсинг вместо валидации.
- Eric Evans. *Domain-Driven Design.* Addison-Wesley, 2003 — Value Object, Side-Effect-Free Functions.
- Vaughn Vernon. *Implementing Domain-Driven Design.* Addison-Wesley, 2013 — событийные агрегаты, decide/evolve на практике.
- Debasish Ghosh. *Functional and Reactive Domain Modeling.* Manning, 2016 — ADT и алгебры в моделировании домена.
