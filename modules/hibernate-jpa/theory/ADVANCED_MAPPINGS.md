# Hibernate / JPA — Продвинутый маппинг и генерируемые БД значения

Базовые аннотации (`@Entity`, `@Embeddable`, ассоциации, owning/inverse, cascade) разобраны в
[MAPPINGS_ASSOCIATIONS.md](MAPPINGS_ASSOCIATIONS.md). Здесь — детали столбцов и таблиц, кастомные
конвертеры типов, маппинг одной сущности на несколько таблиц, Hibernate-специфичные read-only и
фильтрующие аннотации, а также значения, которые формирует сама база (timestamp-метки, генерируемые
столбцы, триггеры) и флаги `insertable`/`updatable`, управляющие участием поля в SQL.

---

## `@Column` — детальная настройка столбца

```java
@Column(
    name = "unit_price",
    nullable = false,        // NOT NULL в DDL + проверка перед INSERT/UPDATE
    unique = true,           // UNIQUE-ограничение (одностолбцовое)
    length = 64,             // VARCHAR(64); игнорируется для не-строковых типов
    precision = 19,          // всего значащих цифр (DECIMAL/NUMERIC)
    scale = 4,               // цифр после запятой
    columnDefinition = "numeric(19,4) default 0",  // сырой DDL-фрагмент
    insertable = true,
    updatable = true
)
private BigDecimal unitPrice;
```

- `length` влияет только на строковые столбцы; для денег и точных дробей используют `precision`/`scale`
  (никогда не `double` — потеря точности).
- `columnDefinition` — аварийный люк: задаёт точный тип столбца строкой, отключая выбор типа диалектом.
  Делает маппинг непортируемым между БД, применять только когда стандартных атрибутов не хватает.
- `unique = true` создаёт ограничение по одному столбцу. Для составного уникального ключа — `@Table`
  (`uniqueConstraints`), см. ниже.
- `nullable`, `length`, `unique`, `columnDefinition` влияют на DDL только при генерации схемы
  (`hbm2ddl.auto`, см. [JPA_VS_HIBERNATE.md](JPA_VS_HIBERNATE.md)); при готовой схеме это лишь метаданные.

---

## `@Table` — таблица, ограничения, индексы

```java
@Entity
@Table(
    name = "product",
    schema = "catalog",
    uniqueConstraints = @UniqueConstraint(
        name = "uq_product_sku_vendor",
        columnNames = {"sku", "vendor_id"}),   // составной уникальный ключ
    indexes = {
        @Index(name = "idx_product_name", columnList = "name"),
        @Index(name = "idx_product_price", columnList = "unit_price DESC")
    })
public class Product { /* ... */ }
```

`uniqueConstraints` и `indexes` — это подсказки генератору DDL; на работающей схеме их меняют миграциями
(Flyway/Liquibase), а не аннотациями. Имена ограничений лучше задавать явно: иначе диалект сгенерирует
случайные имена, и миграции станут невоспроизводимы.

---

## `@JoinColumn` / `@JoinTable` — продвинутое

Базовое назначение — в [MAPPINGS_ASSOCIATIONS.md](MAPPINGS_ASSOCIATIONS.md). Дополнительно:

- `referencedColumnName` — указывает столбец на стороне «один», на который ссылается внешний ключ,
  когда это **не** первичный ключ (ссылка на альтернативный уникальный столбец).
- `foreignKey = @ForeignKey(...)` — имя ограничения внешнего ключа или его отключение
  (`ConstraintMode.NO_CONSTRAINT`).
- `@JoinColumns` — составной внешний ключ из нескольких столбцов (ссылка на составной первичный ключ,
  см. [COMPOSITE_KEYS.md](COMPOSITE_KEYS.md)).

```java
@ManyToOne
@JoinColumn(name = "vendor_code",
            referencedColumnName = "code",        // ссылка на уникальный code, не на id
            foreignKey = @ForeignKey(name = "fk_product_vendor"))
private Vendor vendor;
```

---

## `@Enumerated` — ORDINAL против STRING

`@Enumerated(EnumType.ORDINAL)` хранит порядковый номер константы (0, 1, 2…). `EnumType.STRING` хранит
имя константы.

| Свойство | `ORDINAL` | `STRING` |
|----------|-----------|----------|
| Что в столбце | целое (позиция в enum) | имя константы |
| Перестановка констант | портит данные молча | безопасна |
| Вставка значения в середину | сдвигает номера → порча | безопасна |
| Переименование константы | безопасно для данных | ломает чтение старых строк |
| Размер столбца | компактный | `VARCHAR` |

### Battle-story: ORDINAL после вставки нового значения

Enum `Status { NEW, PAID, SHIPPED }`. В БД лежат заказы: `NEW=0`, `PAID=1`, `SHIPPED=2`. Через полгода
бизнес попросил статус «ожидает оплаты», разработчик добавил его «логично» — в середину:
`Status { NEW, PENDING, PAID, SHIPPED }`. Деплой прошёл «успешно». Теперь все исторические заказы со
значением `1` читаются как `PENDING` вместо `PAID`, а `2` — как `PAID` вместо `SHIPPED`. Ни ошибки, ни
исключения: молчаливая порча всех данных. С `STRING` этого бы не случилось — в столбце лежало бы `"PAID"`.

Правило: для enum по умолчанию `STRING`. `ORDINAL` оправдан только если столбец защищён от изменения
порядка (или используется явный конвертер с фиксированными кодами, см. `@Convert` ниже).

---

## `@Temporal` — legacy против java.time

`@Temporal` нужен **только** для старых типов `java.util.Date` и `java.util.Calendar`, чтобы указать,
отображать ли их как `DATE`, `TIME` или `TIMESTAMP`:

```java
@Temporal(TemporalType.TIMESTAMP)
private java.util.Date createdAt;   // legacy
```

Для типов `java.time` (`LocalDate`, `LocalDateTime`, `Instant`, `OffsetDateTime`) `@Temporal` **не нужен
и запрещён** — JPA 2.2+ отображает их нативно с корректной точностью. Современный код использует `java.time`:

```java
private Instant createdAt;          // отображается на TIMESTAMP без @Temporal
private LocalDate birthDate;        // на DATE
```

`Instant`/`OffsetDateTime` сохраняют момент времени однозначно; `LocalDateTime` зависит от часового пояса
сессии БД — для меток событий предпочтительнее `Instant`.

---

## `@Lob` — большие объекты

`@Lob` отображает поле на `BLOB` (бинарные данные) или `CLOB` (символьные):

```java
@Lob
private byte[] document;            // BLOB

@Lob
private String articleBody;         // CLOB
```

LOB-столбцы тяжёлые: их почти всегда делают ленивыми (`@Basic(fetch = LAZY)` + bytecode enhancement),
иначе каждый `SELECT` тянет мегабайты. Семантика LOB различается по диалектам (PostgreSQL: `bytea` против
`oid`/Large Object API) — на PostgreSQL `@Lob` над `String` исторически даёт сюрпризы, поэтому часто
отображают явно через `@Column(columnDefinition = "text")` вместо `@Lob`.

---

## `@Transient` и `@Access`

`@Transient` исключает поле из персистентности (вычисляемое в памяти, кэш, флаг). Не путать с
`transient` Java — это разные механизмы (одно про JPA, другое про сериализацию).

`@Access` задаёт способ доступа Hibernate к состоянию:

| Режим | Как читает/пишет | Когда выбирать |
|-------|------------------|----------------|
| `AccessType.FIELD` | напрямую через рефлексию полей | по умолчанию, если `@Id` на поле; геттеры могут содержать логику |
| `AccessType.PROPERTY` | через геттеры/сеттеры | если нужна трансформация в аксессорах |

Режим по умолчанию определяется размещением `@Id`: на поле → `FIELD`, на геттере → `PROPERTY`. `@Access`
можно переопределить точечно на отдельном свойстве. При `FIELD` геттеры могут делать что угодно — Hibernate
их не вызывает.

---

## `@AttributeOverride` / `@AssociationOverride`

Переопределяют маппинг столбцов/ассоциаций встраиваемого типа (`@Embeddable`) в конкретном владельце —
например, когда один тип встроен дважды:

```java
@Embedded
@AttributeOverrides({
    @AttributeOverride(name = "city",   column = @Column(name = "ship_city")),
    @AttributeOverride(name = "zip",    column = @Column(name = "ship_zip"))
})
private Address shippingAddress;

@Embedded
@AttributeOverrides({
    @AttributeOverride(name = "city",   column = @Column(name = "bill_city")),
    @AttributeOverride(name = "zip",    column = @Column(name = "bill_zip"))
})
private Address billingAddress;
```

`@AssociationOverride` делает то же для ассоциаций внутри `@Embeddable` (переопределяет `@JoinColumn`).
Базовая семантика `@Embeddable` — в [MAPPINGS_ASSOCIATIONS.md](MAPPINGS_ASSOCIATIONS.md).

---

## `@Convert` + `@AttributeConverter` — кастомные конвертеры типов

Конвертер описывает двунаправленное преобразование «атрибут сущности ↔ значение столбца». Это
стандартный (не Hibernate-специфичный) механизм JPA для типов, которые провайдер не умеет отображать сам.

```java
@Converter(autoApply = false)
public class MoneyConverter implements AttributeConverter<Money, BigDecimal> {
    @Override public BigDecimal convertToDatabaseColumn(Money m) {
        return m == null ? null : m.amount();
    }
    @Override public Money convertToEntityAttribute(BigDecimal db) {
        return db == null ? null : new Money(db);
    }
}

@Convert(converter = MoneyConverter.class)
private Money price;
```

- `autoApply = true` применяет конвертер ко **всем** полям подходящего типа автоматически, без `@Convert`
  на каждом поле.
- Конвертер не применяется к `@Id`, `@Version` и ассоциациям.
- `@Convert(attributeName = "...")` нацеливает конвертер на конкретное поле внутри `@Embeddable`.

### `@Convert` для enum против `@Enumerated`

Когда нужны **стабильные явные коды** для enum (защита от перестановки констант и компактность ORDINAL
одновременно), вместо `@Enumerated` пишут конвертер с фиксированным отображением:

```java
@Converter(autoApply = true)
public class StatusConverter implements AttributeConverter<Status, Integer> {
    @Override public Integer convertToDatabaseColumn(Status s) { return s.getCode(); }
    @Override public Status convertToEntityAttribute(Integer code) {
        return Status.fromCode(code);   // явное отображение, не зависит от порядка
    }
}
```

Код константы (`getCode()`) задан явно и не меняется при перестановке/вставке констант — устраняет
ORDINAL-ловушку, сохраняя компактный целочисленный столбец.

---

## `@SecondaryTable` — одна сущность на нескольких таблицах

Поля одной сущности раскладываются по основной и дополнительной таблицам, связанным по первичному ключу:

```java
@Entity
@Table(name = "employee")
@SecondaryTable(name = "employee_details",
    pkJoinColumns = @PrimaryKeyJoinColumn(name = "employee_id"))
public class Employee {
    @Id private Long id;

    @Column(name = "name")                         // основная таблица employee
    private String name;

    @Column(table = "employee_details", name = "bio")  // вторичная таблица
    private String bio;
}
```

Каждый `SELECT` сущности делает JOIN основной и вторичной таблиц, каждый `INSERT`/`UPDATE` пишет в обе.
Применяют редко — для маппинга на legacy-схему, где сущность исторически разнесена по двум таблицам.

---

## Hibernate-специфичные: `@Formula`, `@Where`, `@Filter`

Это аннотации Hibernate (не часть JPA-спецификации), привязывающие сущность к фрагментам SQL.

### `@Formula` — вычисляемое read-only поле

```java
@Formula("(select avg(r.score) from review r where r.product_id = id)")
private Double averageScore;       // read-only, считается в SELECT
```

Подзапрос подставляется прямо в `SELECT` сущности. Поле read-only: Hibernate его никогда не пишет, только
читает. Удобно для агрегатов и денормализованных значений без отдельной колонки. Цена — подзапрос в каждой
выборке сущности; для горячих путей лучше материализованная колонка или проекция (см.
[QUERYING.md](QUERYING.md)).

### `@Where` — статический фильтр сущности/коллекции (мягкое удаление)

```java
@Entity
@Where(clause = "deleted = false")     // добавляется в каждый SELECT сущности
public class Account {
    private boolean deleted;
}
```

`@Where` дописывает фиксированное условие во все запросы сущности — классический приём мягкого удаления
(soft delete): «удалённые» строки остаются в таблице, но Hibernate их не видит. Можно вешать и на
коллекцию (фильтрует элементы ассоциации). Ограничение: условие статично, параметров нет. В новых версиях
Hibernate аналог — `@SQLRestriction`.

### `@Filter` / `@FilterDef` — параметризованные динамические фильтры

```java
@FilterDef(name = "tenantFilter",
           parameters = @ParamDef(name = "tenantId", type = Long.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
@Entity
public class Document { /* ... */ }
```

В отличие от `@Where`, фильтр **выключен по умолчанию** и включается явно на уровне сессии с параметром:

```java
session.enableFilter("tenantFilter").setParameter("tenantId", currentTenant());
```

Основной кейс — разделяемая мультиарендность (multi-tenancy) по дискриминатору: один параметр сессии
прозрачно отсекает чужие строки во всех запросах. Фильтр действует только в текущей сессии и только пока
включён; на `get()`/`find()` по id Hibernate-фильтры (как и `@Where`) исторически не применялись —
учитывать при проектировании.

---

## Значения, генерируемые базой данных

### `@CreationTimestamp` / `@UpdateTimestamp` (Hibernate)

Hibernate проставляет метки **в приложении** в момент `INSERT`/`UPDATE` (не в БД):

```java
@CreationTimestamp
private Instant createdAt;          // ставится один раз при INSERT

@UpdateTimestamp
private Instant updatedAt;          // переписывается при каждом UPDATE
```

Это значения, формируемые провайдером Hibernate, а не базой. Просты и портируемы, но время берётся с часов
JVM, а не сервера БД — при рассинхроне часов метки разъезжаются.

### `@Generated(VALUE)` и генерируемые столбцы БД

Если значение формирует **сама БД** (DEFAULT, триггер, GENERATED-столбец), Hibernate должен прочитать его
обратно после записи, иначе в кэше первого уровня (см. [ENTITY_LIFECYCLE.md](ENTITY_LIFECYCLE.md)) останется
устаревшее значение:

```java
@Generated(event = {EventType.INSERT, EventType.UPDATE})
@Column(insertable = false, updatable = false,
        columnDefinition = "timestamp default now()")
private Instant dbCreatedAt;
```

`@Generated` приказывает Hibernate перечитать столбец из БД (через `RETURNING`/дополнительный `SELECT`)
сразу после `INSERT`/`UPDATE`. Так синхронизируются значения от DB-триггеров и генерируемых столбцов:
приложение их не пишет (`insertable=false`/`updatable=false`), но видит актуальные после flush.

### Флаги `insertable` / `updatable`

Управляют участием столбца в генерируемых `INSERT`/`UPDATE`:

| `insertable` | `updatable` | Поведение | Типичный случай |
|:---:|:---:|---|---|
| `true` | `true` | обычный столбец (по умолчанию) | большинство полей |
| `false` | `false` | read-only: Hibernate только читает | значение от триггера/`@Generated`/`@Formula` |
| `true` | `false` | пишется при вставке, потом неизменен | `created_at`, иммутабельный ключ |
| `false` | `true` | не вставляется, но обновляется | редкий; столбец с DEFAULT при INSERT |

Частая ошибка — два маппинга на один физический столбец (например `@ManyToOne @JoinColumn(name="vendor_id")`
и отдельное поле `vendorId`). Чтобы Hibernate не пытался писать в столбец дважды (ошибка «repeated column»),
одному из маппингов ставят `insertable=false, updatable=false` — он становится read-only зеркалом.

---

## Где почитать дальше

- [MAPPINGS_ASSOCIATIONS.md](MAPPINGS_ASSOCIATIONS.md) — базовые аннотации, `@Embeddable`, ассоциации,
  owning/inverse, cascade, `orphanRemoval`, `equals`/`hashCode`.
- [COLLECTIONS.md](COLLECTIONS.md) — `@ElementCollection` (коллекции value-типов), `@OrderBy`/`@OrderColumn`,
  bag/list/set.
- [COMPOSITE_KEYS.md](COMPOSITE_KEYS.md) — `@EmbeddedId`, `@IdClass`, составные внешние ключи.
- [IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md) — генерация id, `@GeneratedValue`, наследование.
- [ENTITY_LIFECYCLE.md](ENTITY_LIFECYCLE.md) — состояния сущности, persistence context, dirty checking,
  flush (важно для понимания `@Generated`).
- [QUERYING.md](QUERYING.md) — JPQL/HQL, проекции вместо `@Formula` на горячих путях.

## Источники

- *Hibernate ORM User Guide* — разделы Basic types, Generated properties, `@Formula`, `@Where`/`@Filter`,
  Secondary tables, AttributeConverter.
- *Jakarta Persistence Specification* — разделы `@Column`/`@Table`, `@Convert`/`AttributeConverter`,
  `@SecondaryTable`, `@Enumerated`, `@Temporal`, `@Lob`, `@Access`.
- Vlad Mihalcea, *High-Performance Java Persistence* — главы про базовые типы, конвертеры,
  генерируемые значения и `insertable`/`updatable`.
- Vlad Mihalcea — статьи «AttributeConverter», «@Formula», «How to map @CreationTimestamp / @Generated».
