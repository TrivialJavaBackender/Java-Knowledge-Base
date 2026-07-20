# Domain-Driven Design — Антипаттерны

Каждый антипаттерн ниже — с «плохим» кодом (как легко получается само собой) и разбором, как правильно, со ссылкой на файл-владелец темы. Порядок примерно по частоте и вредности: первый встречается почти в каждом «DDD-проекте», который на деле им не является.

Общие OOP-смеллы (God Object вообще, Primitive Obsession как code smell, over-engineering/patternitis) — в [../../design-patterns/theory/ANTIPATTERNS.md](../../design-patterns/theory/ANTIPATTERNS.md); здесь — их **доменное** прочтение и антипаттерны, специфичные именно для DDD.

## 1. Анемичная модель (Anemic Domain Model) — враг №1

Классы-«мешки с данными», вся логика — в сервисах:

```kotlin
// ПЛОХО: данные тут, правила где-то там
class Order {
    var status: String = ""
    var lines: MutableList<OrderLine> = mutableListOf()
}
class OrderService {
    fun placeOrder(order: Order) {
        if (order.lines.isEmpty()) throw IllegalStateException("пустой")
        order.status = "PLACED"          // а другой сервис выставит что угодно
    }
}
```

**Чем плохо:** инварианты живут **вне** объекта — их можно забыть, обойти, продублировать с расхождениями. Любой код в системе способен сделать `order.status = "ОПЛАЧЕН НАВЕРНОЕ"`. Данные и правила, которые ими управляют, разлучены — а это и есть суть объектной инкапсуляции.

**Как правильно:** богатый агрегат — состояние под `private set`, переходы только через методы с бизнес-смыслом, проверки внутри:

```kotlin
class Order private constructor(/* … */) {
    var status: OrderStatus = OrderStatus.DRAFT
        private set                                  // менять — только методам агрегата
    fun place() {
        check(status == OrderStatus.DRAFT) { "Заказ уже оформлен" }
        check(_lines.isNotEmpty()) { "Нельзя оформить пустой заказ" }   // инвариант ВНУТРИ
        status = OrderStatus.PLACED
    }
}
```

**Когда допустима:** в Generic/CRUD-поддоменах анемичная модель — не антипаттерн, а адекватная простота: там нет инвариантов, которые стоило бы защищать. Антипаттерном она становится **в ядре** (Core Domain), где правила — главная ценность. Богатый агрегат — тема [AGGREGATE_DESIGN.md](AGGREGATE_DESIGN.md).

## 2. God Aggregate (агрегат-гигант)

```kotlin
// ПЛОХО: «Customer знает всё»
class Customer {
    val orders: MutableList<Order>       // все 10 000 заказов
    val payments: MutableList<Payment>   // вся история платежей
    val tickets: MutableList<Ticket>     // и обращения в поддержку
}
```

**Чем плохо:** загрузка тянет полбазы; любые два одновременных изменения чего угодно конфликтуют (одна версия/блокировка на всё); транзакция раздувается. **Как правильно:** маленькие агрегаты, ссылка на чужой агрегат **только по ID**, связь — доменными событиями:

```kotlin
class Order private constructor(
    val id: OrderId,
    val customerId: CustomerId,          // не Customer, а ID: заказ не владеет покупателем
) { /* … агрегат размером с одну транзакцию … */ }
```

Правила размера агрегата (что входит в границу консистентности, почему маленький, ссылки по ID) — [AGGREGATE_DESIGN.md](AGGREGATE_DESIGN.md). Это доменная версия общего God Object.

## 3. Обход корня агрегата

```kotlin
// ПЛОХО: внутренняя сущность изменена в обход инвариантов
order.lines[0].quantity = 999            // а заказ-то уже PLACED!
```

**Чем плохо:** правило «состав меняется только у черновика» защищает корень `Order`, но если наружу отдан изменяемый список внутренних сущностей — правило обходится напрямую, минуя корень. **Как правильно:** `OrderLine` имеет `internal`-конструктор и `internal set`, а наружу корень отдаёт **копию** списка; единственный путь изменения — метод корня, который проверяет статус:

```kotlin
val lines: List<OrderLine> get() = _lines.toList()       // наружу — неизменяемая КОПИЯ
fun addLine(productId: ProductId, unitPrice: Money, quantity: Int) {
    check(status == OrderStatus.DRAFT) { "Нельзя менять состав в статусе $status" }
    /* … */
}
```

Инкапсуляция здесь — не стиль, а **механизм защиты инвариантов**. Подробно — [AGGREGATE_DESIGN.md](AGGREGATE_DESIGN.md).

## 4. Repository на таблицу (DAO-мышление)

`OrderLineRepository` — ошибка. Строки не существуют отдельно от заказа; сохранение агрегата обязано быть атомарным (весь `Order` с его строками — одной транзакцией). Заводить репозиторий на внутреннюю сущность — значит вернуть мышление «класс на таблицу» и разорвать границу консистентности.

**Правило:** один репозиторий = один агрегат. `OrderRepository`, `CartRepository`, `AccountRepository` — да; `OrderLineRepository` — нет. Repository как паттерн — [TACTICAL_PATTERNS.md](TACTICAL_PATTERNS.md).

## 5. Протекание доменной модели наружу

Отдавать агрегат прямо в JSON/API:

```kotlin
// ПЛОХО: контроллер сериализует агрегат как есть
@GetMapping("/orders/{id}")
fun get(id: String): Order = repo.findById(OrderId(id))!!   // весь агрегат — в ответ
```

**Чем плохо:** изменил модель — сломал всех клиентов; хуже — клиенты **начинают зависеть** от твоих внутренних инвариантов и полей, и модель застывает. **Как правильно:** наружу — только **контракты** (плоские, стабильные) и **read-DTO** для экранов, через трансляторы:

```kotlin
// исходящий контракт — плоский, стабильный, отвязан от агрегата
data class OrderPlacedContract(val orderId: String, val customerId: String, val total: String)
data class OrderSummaryDto(val id: String, val status: String, val total: String)   // read-DTO для UI
```

Внутренняя модель свободна меняться, пока транслятор держит контракт. Тема границ и трансляторов — [INTEGRATION_PATTERNS.md](INTEGRATION_PATTERNS.md).

## 6. Протекание инфраструктуры внутрь

Обратная утечка: `KafkaTemplate` в Entity, `@Autowired` в агрегате, доменный сервис, знающий про транзакции и HTTP.

```kotlin
// ПЛОХО: домен склеен с инфраструктурой
class Order(
    @Autowired val kafka: KafkaTemplate<String, String>,   // агрегат знает про Kafka?!
) { fun place() { /* … */ kafka.send("orders", "…") } }
```

**Чем плохо:** домен перестаёт быть чистым и переносимым; его нельзя протестировать без брокера, а смена технологии задевает ядро. **Как правильно:** агрегат максимум **запоминает** доменное событие «в копилку», а куда оно пойдёт — решают внешние слои:

```kotlin
private val _events = mutableListOf<DomainEvent>()
fun place() { /* … */ _events += OrderPlaced(id, customerId, total, Instant.now()) }
fun pullEvents(): List<DomainEvent> = _events.toList().also { _events.clear() }
```

Лучшая защита — **граница сборки**: у доменного модуля просто нет зависимости на Kafka/Spring, поэтому утечка физически невозможна (Dependency Rule). См. [ARCHITECTURE.md](ARCHITECTURE.md).

## 7. Primitive Obsession

```kotlin
// ПЛОХО: перепутанные аргументы компилируются, деньги в Double, валидация размазана
fun transfer(from: String, to: String, amount: Double)
```

**Чем плохо:** `transfer(to, from, …)` — компилятор молчит; `Double` теряет копейки (0.1 + 0.2 ≠ 0.3); правила валидации суммы дублируются по всем вызовам. **Как правильно:** Value Object и типизированные ID, которые несут правило внутри себя:

```kotlin
fun transfer(from: AccountId, to: AccountId, amount: Money)   // перепутать типы нельзя
```

`Money` знает про валюту и точность, `AccountId` не спутать с `CustomerId`. Value Object — [TACTICAL_PATTERNS.md](TACTICAL_PATTERNS.md); смарт-конструктор как «дверь внутрь» — [FUNCTIONAL_DDD.md](FUNCTIONAL_DDD.md). Общий code smell — в [../../design-patterns/theory/ANTIPATTERNS.md](../../design-patterns/theory/ANTIPATTERNS.md); здесь важно, что в DDD лечение — именно VO домена.

## 8. «Универсальная» модель на всю компанию

Один `Product` с полями для каталога, склада, доставки и бухгалтерии сразу:

```kotlin
// ПЛОХО: один класс на все отделы
class Product(
    val price: Money, val stockQty: Int, val weightKg: Double,
    val vatRate: BigDecimal, val seoTitle: String, /* … и ещё 40 полей … */
)
```

**Чем плохо:** каждое поле нужно лишь одному отделу, но меняют класс все — команды блокируют друг друга, класс распухает, а «товар» означает для витрины и склада **разное**. **Как правильно:** своя модель `Product` в каждом Bounded Context — маленькая и точная под свой контекст; связь между контекстами по ID и через контракты. Границы контекстов — [STRATEGIC_DESIGN.md](STRATEGIC_DESIGN.md).

## 9. Раздутый Shared Kernel

«Положим в `common`, вдруг пригодится» → через год все контексты сцеплены общей библиотекой, которую страшно трогать: правка ради одной команды перекомпилирует и рискует сломать всех.

**Как правильно:** Shared Kernel держат **минимальным** и меняют только по согласию всех команд-совладельцев. В демо в нём — лишь `Money`, типизированные ID и `DomainEvent`; всё остальное принадлежит контекстам. Что законно кладут в общее ядро и почему его берегут — [STRATEGIC_DESIGN.md](STRATEGIC_DESIGN.md) и [INTEGRATION_PATTERNS.md](INTEGRATION_PATTERNS.md).

## 10. DDD ради DDD (over-modeling)

Пятнадцать паттернов на CRUD-справочник стран: фабрика для объекта из двух полей, сага для одной таблицы, Event Sourcing для лога посещений, репозиторий с спецификациями поверх словаря.

**Чем плохо:** тяжесть инструмента не окупается — сложность добавлена там, где правил нет, и её теперь всем сопровождать. **Принцип:** тяжесть паттерна должна быть пропорциональна **сложности правил и ценности поддомена**. В демо это показано намеренно обратным: `Cart` — простой агрегат без церемоний; `warehouse` — один модуль без слоёв; `Order` — **без** Event Sourcing (обычное хранение), а ES применён точечно лишь в `billing`, где история денег ценна сама по себе. Дозировку тактики диктует дистилляция ядра — [SUPPLE_DESIGN.md](SUPPLE_DESIGN.md); общий разбор over-engineering/patternitis — [../../design-patterns/theory/ANTIPATTERNS.md](../../design-patterns/theory/ANTIPATTERNS.md).

### Когда DDD не нужен вообще

- **CRUD поверх базы**, форма-в-таблицу — без бизнес-правил моделировать нечего.
- **Прототип** с горизонтом жизни в недели — стратегия не окупится.
- **Чисто технические задачи** без домена — прокси, ETL, шлюз: там нет предметной области, есть данные и трубы.

Минимальный набор DDD, который окупается почти всегда: единый язык (Ubiquitous Language) + границы контекстов + Value Object вместо примитивов + логика в агрегатах + репозиторий на агрегат. Остальное — по мере появления **реальной** боли, а не заранее.

## Где почитать дальше

- [AGGREGATE_DESIGN.md](AGGREGATE_DESIGN.md) — богатый агрегат, размер, ссылки по ID, инкапсуляция корня (антипаттерны 1–3).
- [TACTICAL_PATTERNS.md](TACTICAL_PATTERNS.md) — Value Object и Repository на агрегат (антипаттерны 4, 7).
- [ARCHITECTURE.md](ARCHITECTURE.md) — Dependency Rule против протекания инфраструктуры внутрь (антипаттерн 6).
- [INTEGRATION_PATTERNS.md](INTEGRATION_PATTERNS.md) — контракты и трансляторы против протекания модели наружу (антипаттерн 5).
- [STRATEGIC_DESIGN.md](STRATEGIC_DESIGN.md) — контексты против «универсальной» модели и раздутого Shared Kernel (антипаттерны 8, 9).
- [../../design-patterns/theory/ANTIPATTERNS.md](../../design-patterns/theory/ANTIPATTERNS.md) — общие God Object, Primitive Obsession, patternitis.

## Источники

- Martin Fowler. *AnemicDomainModel.* 2003 — martinfowler.com/bliki (первоисточник термина).
- Eric Evans. *Domain-Driven Design.* Addison-Wesley, 2003 — агрегаты, границы, Shared Kernel, дистилляция.
- Vaughn Vernon. *Implementing Domain-Driven Design.* Addison-Wesley, 2013 — правила проектирования агрегатов, «маленькие агрегаты».
- Vlad Khononov. *Learning Domain-Driven Design.* O'Reilly, 2021 — соответствие тяжести инструмента ценности поддомена.
