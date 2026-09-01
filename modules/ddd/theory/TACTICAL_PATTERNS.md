# Domain-Driven Design — Тактические паттерны

Тактический DDD отвечает на вопрос «как устроить код **внутри одного** Bounded Context». Это набор строительных блоков, каждый из которых — не техническая абстракция, а способ выразить смысл предметной области в типах и методах. Стратегия (границы, язык, карта контекстов) описана в [STRATEGIC_DESIGN.md](STRATEGIC_DESIGN.md); здесь — то, что живёт под ней, в одном контексте.

| Блок | Роль | Пример из модели заказов |
|---|---|---|
| **Value Object** | значение без идентичности | `Money`, `ShippingAddress`, `OrderId` |
| **Entity** | объект с идентичностью, переживающей изменения | `Order`, `OrderLine`, `Account` |
| **Aggregate** | кластер, меняющийся как одно целое | `Order` + `OrderLine` (подробно в [AGGREGATE_DESIGN.md](AGGREGATE_DESIGN.md)) |
| **Domain Event** | свершившийся факт бизнеса | `OrderPlaced`, `OrderCancelled` |
| **Repository** | коллекция агрегатов | `OrderRepository` |
| **Factory** | сборка сложного агрегата | `OrderFromCartFactory` |
| **Domain Service** | логика без дома в Entity/VO | `FundsTransferService` |
| **Application Service** | оркестратор сценария | `PlaceOrderUseCase` |
| **Specification** | бизнес-правило как объект | `EligibleForFreeShipping` |
| **Policy** | вариативное правило | `DeliveryCostPolicy` |

## 1. Value Object

Value Object (объект-значение) — объект **без идентичности**: он определяется значением своих полей и взаимозаменяем с любым другим таким же, как две купюры одного номинала. У настоящего Value Object четыре обязательных свойства:

1. **Неизменяемость.** Все поля `val`; любая «модификация» (сложение, умножение) возвращает **новый** объект. Неизменяемое значение можно свободно передавать и разделять — его никто не испортит.
2. **Равенство по значению.** `Money(100.00, RUB)` и `Money(100.00, RUB)` — это одно и то же значение (в отличие от Entity, где равенство только по ID).
3. **Самовалидация и каноническая форма.** Единственная «дверь внутрь» — фабрика — не даёт создать бессмысленное значение и приводит его к канонической форме. Если объект существует — он валиден и нормализован.
4. **Поведение.** Value Object — не «структурка»: операции над значением с контролем правил живут **здесь**, а не в утилитах-хелперах.

```kotlin
class Money private constructor(val amount: BigDecimal, val currency: Currency) {

    operator fun plus(other: Money): Money {          // поведение: сложение,
        require(currency == other.currency)           // и бизнес-правило «одна валюта» — тут же
        return Money(amount + other.amount, currency)
    }

    // равенство по ЗНАЧЕНИЮ — руками, поверх канонической формы
    override fun equals(other: Any?): Boolean =
        other is Money && other.amount == amount && other.currency == currency

    companion object {
        operator fun invoke(amount: BigDecimal, currency: Currency): Money {
            require(amount.scale() <= currency.defaultFractionDigits)      // самовалидация
            return Money(amount.setScale(currency.defaultFractionDigits), currency) // каноническая форма
        }
    }
}
```

**Поучительный кейс: почему `Money` — не `data class`.** Сгенерированный `data class`-овый `equals` сравнивал бы `BigDecimal` напрямую, а `BigDecimal("0") != BigDecimal("0.00")` — у «нуля» и «нуля копеек» разный `scale`. Тогда `Money.zero() != Money.rub("0.00")`, хотя это одна сумма. Поэтому конструктор закрыт, фабрика `invoke()` нормализует `scale` к точности валюты (`setScale`), а `equals`/`hashCode` написаны руками по уже нормализованному значению. **Мораль: Value Object обязан канонизировать значение на входе — тогда равенство перестаёт «врать».** (`Double` тоже не годится: `0.1 + 0.2 != 0.3`; голый `BigDecimal` не знает про валюту и позволит сложить рубли с долларами — тип `Money` не позволит.)

**Анти-Primitive Obsession.** «Одержимость примитивами» (Primitive Obsession) — запах, когда доменные понятия передают голыми `String`/`Int`/`UUID`. Компилятор тогда не ловит перестановку аргументов:

```kotlin
fun ship(orderId: String, customerId: String)      // ship(customerId, orderId) скомпилируется — баг в проде
fun ship(orderId: OrderId, customerId: CustomerId)  // перепутать нельзя
```

В Kotlin типизированные ID **бесплатны**: `@JvmInline value class` существует только на этапе компиляции, в байткоде остаётся голый `UUID`/`String` — типобезопасность без оверхеда в рантайме.

```kotlin
@JvmInline
value class OrderId(val value: UUID) {
    companion object { fun new(): OrderId = OrderId(UUID.randomUUID()) }
}
```

Value Object бывает и многополевым — `ShippingAddress` (страна, город, улица, индекс) с той же дисциплиной: неизменяемость, равенство по значению, самовалидация в `init`, поведение в методах (бизнес-вопрос «доставка внутренняя?» отвечается прямо в объекте, а не размазан по сервисам):

```kotlin
data class ShippingAddress(val country: CountryCode, val city: String, /* … */) {
    init { require(city.isNotBlank()) { "Город обязателен" } }
    fun isDomestic(): Boolean = country == CountryCode.RU   // поведение в VO
}
```

> Primitive Obsession как запах кода разобран в [../../design-patterns/theory/ANTIPATTERNS.md](../../design-patterns/theory/ANTIPATTERNS.md); здесь он показан как повод завести Value Object.

## 2. Entity

Entity (сущность) — объект **с идентичностью**, которая переживает изменения полей: заказ с тем же `id` — тот же заказ, даже если его состав уже другой. Признаки: собственный ID (сам по себе Value Object), равенство **только по ID**, изменения — только через методы с бизнес-смыслом, никаких сеттеров.

```kotlin
class OrderLine internal constructor(val id: OrderLineId, /* … */) {
    override fun equals(other: Any?): Boolean = other is OrderLine && other.id == id  // по ID, не по полям
    override fun hashCode(): Int = id.hashCode()
}
```

| Вопрос | Entity | Value Object |
|---|---|---|
| Важно, *который именно* это объект? | да | нет |
| Меняется со временем? | да, сохраняя идентичность | нет, заменяется целиком |
| Равенство | по идентификатору | по значению всех полей |
| Пример | `Order`, `OrderLine`, `Account` | `Money`, `ShippingAddress`, `OrderId` |

Один и тот же концепт может быть Value Object в одном контексте и Entity в другом. Адрес в заказе — **значение** («куда доставить»; изменился — это просто другой адрес). В контексте логистической компании тот же адрес мог бы быть **сущностью** с идентичностью и историей (геокодинг, статус подтверждения). Выбор диктует не сам объект, а роль, которую он играет в контексте.

## 3. Aggregate (кратко)

Aggregate (агрегат) — кластер Entity и Value Object, который меняется **как одно целое** через единственный корень (Aggregate Root). В модели заказов агрегат — `Order` (корень) плюс список внутренних `OrderLine` плюс Value Object (`Money`, статусы). Ключевое равенство: **агрегат = граница инвариантов = граница транзакции.** Внешний мир никогда не трогает `OrderLine` напрямую — только через методы `Order`.

Это сердце тактики, и ему посвящён отдельный файл: четыре правила Вернона, механика инкапсуляции корня, транзакционная и итоговая согласованность, размер агрегата, оптимистичная блокировка — всё в [AGGREGATE_DESIGN.md](AGGREGATE_DESIGN.md).

## 4. Domain Event

Domain Event (доменное событие) — **факт**, случившийся в предметной области и важный бизнесу: «Заказ оформлен», «Деньги списаны». Правила: имя — глагол в **прошедшем** времени; событие **неизменяемо** (`data class` с `val`-полями — прошлое не редактируют); несёт всё, что нужно обработчику.

```kotlin
interface DomainEvent { val occurredAt: Instant }  // момент, когда факт произошёл

data class OrderPlaced(
    val orderId: OrderId,
    val customerId: CustomerId,
    val total: Money,               // сага-подписчик получит сумму, не запрашивая заказ повторно
    override val occurredAt: Instant,
) : DomainEvent
```

Зачем события: связать агрегаты **без общей транзакции** (первый агрегат публикует факт, второй меняется в следующей транзакции), интегрировать контексты (после трансляции в интеграционное событие), питать Event Sourcing. Доменное событие — внутренний язык контекста, оно может содержать доменные типы (`Money`, `OrderId`); интеграционное событие — внешний контракт, плоское и версионируемое. Разница и механика доставки — в [INTEGRATION_PATTERNS.md](INTEGRATION_PATTERNS.md).

## 5. Repository

Repository (репозиторий) — абстракция **коллекции агрегатов**: для домена все заказы будто «лежат в памяти», а как они хранятся на самом деле — не доменная забота. Три правила:

1. **Один репозиторий — один агрегат** (не одна таблица!). `OrderLineRepository` — ошибка: строки не существуют отдельно от заказа; репозиторий загружает и сохраняет агрегат **целиком**. Репозиторий — не DAO на таблицу.
2. **Интерфейс — в домене, реализация — в инфраструктуре.** Это инверсия зависимостей: не домен зависит от базы, а адаптер базы зависит от домена.
3. Репозиторий — для стороны **записи** (загрузить агрегат → вызвать метод → сохранить). Списки для экранов и отчётов («50 заказов с именем клиента») агрегатами не читают — там работают CQRS-проекции мимо репозитория.

```kotlin
interface OrderRepository {           // живёт в модуле domain
    fun findById(id: OrderId): Order?
    fun save(order: Order)            // сохраняет агрегат атомарно: заголовок + строки в одной транзакции
}
```

Реализация (`InMemoryOrderRepository`, а в бою — на JPA/Hibernate) лежит в инфраструктуре. Метод `save` атомарен, потому что агрегат и есть граница транзакции.

> Классические ORM-паттерны за реализацией репозитория — **Data Mapper**, **Identity Map**, **Unit of Work** — разобраны в [../../databases/theory/DATABASE_TYPES.md](../../databases/theory/DATABASE_TYPES.md). Как этот интерфейс реализуют на Hibernate (и почему `@Repository` Spring Data ≠ DDD-репозиторий) — в [../../hibernate-jpa/theory/JPA_VS_HIBERNATE.md](../../hibernate-jpa/theory/JPA_VS_HIBERNATE.md).

## 6. Factory

Factory (фабрика) как **отдельный класс** нужна, когда сборка агрегата требует внешних знаний или зависимостей, которые нельзя тащить в сам агрегат. Превратить корзину в заказ — значит актуализировать цены через порт `ProductPriceProvider` (корзина цен не хранит). Агрегат `Order` не должен зависеть от порта цен — это отдельная ответственность, и у неё отдельный класс:

```kotlin
class OrderFromCartFactory(private val prices: ProductPriceProvider) {
    fun createFrom(cart: Cart, shippingAddress: ShippingAddress): Order {
        val order = Order.draft(cart.customerId, shippingAddress)
        cart.items.forEach { (productId, quantity) ->
            val price = prices.currentPrice(productId) ?: throw ProductUnavailableException(productId)
            order.addLine(productId, price, quantity)
        }
        return order                  // всегда валидный агрегат — «полусобранных» объектов фабрика не выпускает
    }
}
```

Когда создание простое, отдельный класс избыточен — хватает **именованного конструктора** в `companion object` (`Order.draft(...)`, `Account.open(...)`). Он же читаемее публичного конструктора: невозможно создать заказ в произвольном состоянии, только валидный черновик.

> Фабрика DDD — доменная рамка над GoF-паттернами **Factory Method** и **Abstract Factory**; их каноничный разбор — в [../../design-patterns/theory/CREATIONAL.md](../../design-patterns/theory/CREATIONAL.md). Разница акцента: у GoF цель — развязать создание от конкретного класса; у DDD — гарантировать инварианты агрегата в момент рождения.

## 7. Domain Service

Domain Service (доменный сервис) — бизнес-логика, которой **нет естественного дома** в Entity или Value Object. Перевод денег затрагивает **два** счёта: чей это метод — отправителя или получателя? Логика, не принадлежащая ни одной сущности, и есть повод для доменного сервиса. Он **без состояния**, говорит на языке домена и не знает о транзакциях и портах.

```kotlin
class FundsTransferService(private val transferLimit: Money) {
    fun transfer(from: Account, to: Account, amount: Money) {
        require(amount.isPositive())
        if (amount > transferLimit) throw TransferLimitExceededException(amount, transferLimit)
        from.withdraw(amount, "перевод на счёт ${to.id}")   // инвариант «не уйти в минус»
        to.deposit(amount, "перевод со счёта ${from.id}")    // проверит сам Account — не дублируем
    }
}
```

Главное правило: доменный сервис — **последнее прибежище**. Сначала пытайся положить логику в агрегат; сервис заводи, только когда ей действительно негде жить. Иначе сервисы «высосут» модель досуха, вся логика уедет в них, а объекты станут мешком геттеров — это [анемичная модель](ANTIPATTERNS.md). Обрати внимание: проверки «хватает ли денег» в `FundsTransferService` нет — она осталась в `Account.withdraw`, где ей и место.

## 8. Application Service (сценарий использования)

Application Service (сервис приложения, use case) — **оркестратор** одного сценария: получить команду, собрать или загрузить агрегат, вызвать его методы, сохранить. **Бизнес-логики здесь нет** — вся она в агрегате.

```kotlin
class PlaceOrderUseCase(private val orders: OrderRepository, private val prices: ProductPriceProvider) {
    fun execute(command: PlaceOrderCommand): OrderId {
        val order = Order.draft(command.customerId, command.shippingAddress)   // 1. собрать агрегат
        command.items.forEach { item ->
            val price = prices.currentPrice(item.productId)                     // 2. цены строго из каталога,
                ?: throw ProductUnavailableException(item.productId)            //    не из команды клиента
            order.addLine(item.productId, price, item.quantity)
        }
        order.place()                                                          // 3. доменная операция в агрегате
        orders.save(order)                                                     // 4. сохранить (события → outbox)
        return order.id
    }
}
```

Тест на анемичность: если из сценария выкинуть все вызовы портов, в нём не должно остаться ни одного `if` с бизнес-смыслом. «Нельзя оформить пустой заказ» проверяет `Order.place()`, а не этот класс.

| | Application Service | Domain Service |
|---|---|---|
| Бизнес-логика | нет, только координация | да |
| Транзакции и порты | управляет | не знает |
| Знает о слое приложения | да | нет, чистый домен |
| Пример | `PlaceOrderUseCase` | `FundsTransferService` |

Вход сценария — **Command** (команда): намерение пользователя как простая структура данных. Имя — глагол в **повелительном** наклонении (`PlaceOrderCommand`, `CancelOrderCommand`) — в противоположность событию (прошедшее время): команду ещё можно отвергнуть, событие — уже свершившийся факт. REST-контроллер, консольный ввод, консьюмер очереди собирают одну и ту же команду — сценарий не зависит от способа доставки намерения.

```kotlin
data class PlaceOrderCommand(                    // намерение: «оформи заказ вот с этим»
    val customerId: CustomerId,
    val shippingAddress: ShippingAddress,
    val items: List<ItemRequest>,
)
```

## 9. Specification

Specification (спецификация) — бизнес-правило, упакованное в объект с именем. Вместо `if`, закопанного в недра сервиса, правило получает имя из единого языка, живёт в домене, тестируется отдельно и **комбинируется** через `and`/`or`/`not`:

```kotlin
interface Specification<T> {
    fun isSatisfiedBy(candidate: T): Boolean
    infix fun and(other: Specification<T>): Specification<T> = /* … */
}

class EligibleForFreeShipping(private val threshold: Money) : Specification<Order> {
    override fun isSatisfiedBy(candidate: Order): Boolean = candidate.total >= threshold
}
class DomesticOrder : Specification<Order> {
    override fun isSatisfiedBy(candidate: Order): Boolean = candidate.shippingAddress.isDomestic()
}

val freeShipping = EligibleForFreeShipping(Money.rub("5000.00")) and DomesticOrder()
```

`infix`-функции Kotlin превращают код в дословную запись бизнес-фразы: `EligibleForFreeShipping and DomesticOrder` читается как строка из ТЗ. В полной версии паттерна спецификация умеет ещё и транслироваться в SQL-условие репозитория для выборки.

## 10. Policy / Strategy

Policy (политика) — **вариативное** бизнес-правило за интерфейсом. Спецификация отвечает «да/нет», политика — «как именно считать/действовать», причём ответ зависит от обстоятельств (сезон, сегмент клиента, акция):

```kotlin
interface DeliveryCostPolicy { fun costFor(order: Order): Money }

class StandardDeliveryCostPolicy(/* … */) : DeliveryCostPolicy {
    private val freeShipping = EligibleForFreeShipping(threshold) and DomesticOrder()  // переиспользует спецификации!
    override fun costFor(order: Order): Money =
        if (freeShipping.isSatisfiedBy(order)) Money.zero(baseCost.currency) else baseCost
}

class BlackFridayDeliveryCostPolicy : DeliveryCostPolicy {       // подменяется правило —
    override fun costFor(order: Order): Money = Money.rub("0.00") // остальной код не трогается
}
```

Обрати внимание: политика **переиспользует спецификации** — тактические блоки сочетаются, а не живут по отдельности.

> Policy — это доменная рамка над GoF-паттерном **Strategy** (каноничный разбор — [../../design-patterns/theory/BEHAVIORAL_1.md](../../design-patterns/theory/BEHAVIORAL_1.md)). Технически это одно и то же — интерфейс с подменяемыми реализациями; разница в словаре: «Policy» подчёркивает, что варьируется **бизнес-правило**, и имя берётся из единого языка («политика доставки»), а не из механики («стратегия расчёта»).

## 11. Module

Module (модуль) в DDD — нарезка пакетов **по смыслу**, а не по техническим типам. Пакеты режутся по домену (`model/`, `events/`, `spec/`, `policy/`), потому что так «всё про заказы» лежит рядом. Нарезка по типам (`controllers/`, `services/`, `repositories/`) — антипаттерн: чтобы понять один сценарий, приходится собирать его по пяти пакетам, и высокая связность внутри фичи растворяется. Имя пакета — тоже часть единого языка.

## 12. Как блоки сочетаются

Паттерны не самостоятельны — они складываются в единую ткань контекста: Value Object (`Money`) наполняет Entity (`OrderLine`), Entity собираются в Aggregate (`Order`), агрегат публикует Domain Event (`OrderPlaced`) и хранится через Repository; Factory собирает агрегат, дергая порт; Application Service всё это оркеструет по Command; Specification и Policy выносят вариативные правила. Правильно применённый тактический DDD даёт **богатую модель**, где правило живёт рядом с данными, которые оно охраняет, — противоположность анемичной модели.

## 13. Где почитать дальше

- [AGGREGATE_DESIGN.md](AGGREGATE_DESIGN.md) — сердце тактики: границы инвариантов, правила Вернона, согласованность, размер агрегата.
- [STRATEGIC_DESIGN.md](STRATEGIC_DESIGN.md) — контекст, в котором живут эти блоки: Bounded Context, единый язык, порты и ACL.
- [ARCHITECTURE.md](ARCHITECTURE.md) — где физически лежат интерфейс репозитория и его реализация (Hexagonal / Onion).
- [INTEGRATION_PATTERNS.md](INTEGRATION_PATTERNS.md) — Domain Event против Integration Event, Outbox, CQRS-проекции для чтения.
- [ANTIPATTERNS.md](ANTIPATTERNS.md) — анемичная модель и другие грабли тактики.
- [../../design-patterns/theory/CREATIONAL.md](../../design-patterns/theory/CREATIONAL.md), [../../design-patterns/theory/BEHAVIORAL_1.md](../../design-patterns/theory/BEHAVIORAL_1.md) — GoF Factory и Strategy, поверх которых стоят Factory и Policy.
- [../../hibernate-jpa/theory/JPA_VS_HIBERNATE.md](../../hibernate-jpa/theory/JPA_VS_HIBERNATE.md) — реализация репозитория на ORM.

## Источники

- Eric Evans. *Domain-Driven Design*, part II «The Building Blocks of a Model-Driven Design» (Value Object, Entity, Service, Repository, Factory, Module). Addison-Wesley, 2003.
- Vaughn Vernon. *Implementing Domain-Driven Design*, ch. 5–7, 10–12 (Entities, Value Objects, Services, Factories, Repositories). Addison-Wesley, 2013.
- Martin Fowler. *Patterns of Enterprise Application Architecture* (Repository, Data Mapper, Unit of Work, Identity Map). Addison-Wesley, 2002.
- Eric Evans, Martin Fowler. *Specifications* — статья о паттерне Specification. martinfowler.com.
- Erich Gamma et al. *Design Patterns* (GoF) — Factory Method, Abstract Factory, Strategy. Addison-Wesley, 1994.
