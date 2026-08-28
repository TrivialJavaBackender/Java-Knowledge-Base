# Hibernate / JPA — Составные ключи (@EmbeddedId, @IdClass, @MapsId)

Как JPA отображает первичный ключ из нескольких столбцов, чем `@EmbeddedId` отличается от
`@IdClass`, почему класс составного ключа обязан переопределять `equals`/`hashCode`, и как через
`@MapsId` дочерняя сущность разделяет первичный ключ с родителем. Отдельно — почему Hibernate с
составными ключами становится неудобен и когда суррогатный ключ выигрывает у естественного.

---

## 1. Зачем составной ключ

Составной первичный ключ — это идентичность строки по нескольким столбцам сразу. Канонические
случаи:

- **Таблица-связка** многие-ко-многим с атрибутами: строка `enrollment` идентифицируется парой
  `(student_id, course_id)`.
- **Естественная композиция** предметной области: позиция заказа `(order_id, line_no)`, курс валют
  `(currency_from, currency_to, date)`.

JPA даёт два механизма представить такой ключ в объектной модели: `@EmbeddedId` и `@IdClass`. Оба
требуют отдельного класса ключа — и оба предъявляют к нему жёсткие требования.

---

## 2. `@EmbeddedId` vs `@IdClass`

| Критерий | `@EmbeddedId` | `@IdClass` |
|----------|---------------|------------|
| Класс ключа | помечен `@Embeddable`, встроен как одно поле | обычный класс, поля ключа продублированы в сущности |
| Поля идентификатора | сгруппированы в объекте ключа | плоско лежат в сущности, каждое под `@Id` |
| Доступ в коде | `entity.getId().getCourseId()` | `entity.getCourseId()` |
| Запросы JPQL | через путь к полю ключа: `e.id.courseId` | напрямую: `e.courseId` |
| Дублирование полей | нет | да (поля есть и в ключе, и в сущности) |
| Когда удобнее | ключ — самостоятельный value-объект, переиспользуется | ключ — деталь маппинга, нужен «плоский» доступ |

### `@EmbeddedId`

Ключ — отдельный `@Embeddable`-класс, встроенный в сущность одним полем.

```java
@Embeddable
public class EnrollmentId implements Serializable {
    private Long studentId;
    private Long courseId;

    protected EnrollmentId() { }   // обязательный no-arg конструктор

    public EnrollmentId(Long studentId, Long courseId) {
        this.studentId = studentId;
        this.courseId = courseId;
    }

    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof EnrollmentId that)) return false;
        return Objects.equals(studentId, that.studentId)
            && Objects.equals(courseId, that.courseId);
    }

    @Override public int hashCode() {
        return Objects.hash(studentId, courseId);
    }
}

@Entity
public class Enrollment {
    @EmbeddedId
    private EnrollmentId id;

    private LocalDate enrolledAt;
}
```

### `@IdClass`

Поля ключа лежат прямо в сущности (каждое под `@Id`), а отдельный класс ключа дублирует их по
имени и типу и указывается в `@IdClass`.

```java
public class EnrollmentId implements Serializable {
    private Long studentId;   // имена и типы должны совпадать с @Id-полями сущности
    private Long courseId;

    protected EnrollmentId() { }
    // equals + hashCode по обоим полям — обязательны
}

@Entity
@IdClass(EnrollmentId.class)
public class Enrollment {
    @Id private Long studentId;
    @Id private Long courseId;
    private LocalDate enrolledAt;
}
```

`@IdClass` — наследие EJB 2, остаётся ради совместимости и «плоского» доступа к полям. В новом коде
по умолчанию выбирают `@EmbeddedId`: ключ как самостоятельный объект чище инкапсулирует
идентичность и не дублирует поля. `@IdClass` оправдан, когда поля ключа удобнее держать прямо в
сущности (например, для лаконичных JPQL-запросов без префикса `id.`).

---

## 3. Требования к классу составного ключа

Спецификация Jakarta Persistence предъявляет к классу ключа (и `@Embeddable`, и `@IdClass`)
жёсткий набор требований:

- реализует `Serializable`;
- имеет **public или protected конструктор без аргументов** (для рефлексии и инстанцирования
  провайдером);
- переопределяет `equals` и `hashCode` **по всем полям ключа**;
- сам класс — public, поля — простых типов или других встраиваемых (не ссылки на сущности, кроме
  derived-сценария с `@MapsId`).

Невыполнение любого пункта приводит либо к ошибке загрузки на старте, либо — что хуже — к тихо
некорректному поведению в рантайме.

---

## 4. equals / hashCode для класса ключа — почему обязательны

> Это `equals`/`hashCode` **класса ключа**, не сущности. Идентичность сущности и proxy-safe
> сравнение — отдельная тема, см. [ENTITY_IDENTITY_EQUALS.md](ENTITY_IDENTITY_EQUALS.md).

Hibernate использует объект составного ключа как **ключ в Identity Map** persistence context (L1).
Когда вы загружаете сущность через `em.find(Enrollment.class, new EnrollmentId(1L, 2L))` или когда
провайдер ищет уже управляемую строку, он сравнивает объекты ключа через `equals`/`hashCode`.

Без корректной реализации работает дефолтный `Object.equals` (идентичность по ссылке). Последствия:

- `em.find(...)` с **новым** экземпляром ключа, описывающим уже загруженную строку, не находит её в
  L1-кэше и уходит в БД повторно — а в худшем случае Identity Map начинает хранить два «разных»
  объекта на одну строку, нарушая инвариант «одна строка = один экземпляр в контексте».
- ассоциации и проверки `contains` ломаются молча, как и с некорректным `equals` сущности.

`equals` и `hashCode` обязаны учитывать **все** поля ключа и быть согласованы между собой. Поля
ключа должны быть неизменяемыми после `persist` — мутация поля ключа меняет `hashCode` и теряет
объект в Identity Map ровно так же, как мутабельный `hashCode` теряет элемент в `HashSet`.

---

## 5. Производные идентификаторы — `@MapsId`

Derived identifier («производный идентификатор») — это когда первичный ключ дочерней сущности
**произведён** из её ассоциации с родителем. Дочерняя строка не имеет собственного суррогатного
id, а разделяет (shares) первичный ключ родителя.

### Разделяемый первичный ключ в `@OneToOne`

Классика — `@OneToOne`, где `UserProfile` использует `user_id` одновременно как свой первичный ключ
и как внешний ключ на `User`:

```java
@Entity
public class User {
    @Id @GeneratedValue
    private Long id;
}

@Entity
public class UserProfile {
    @Id
    private Long id;          // тот же, что у User

    @MapsId                   // id берётся из ассоциации user
    @OneToOne
    @JoinColumn(name = "user_id")
    private User user;

    private String bio;
}
```

`@MapsId` говорит провайдеру: «значение `@Id` бери из первичного ключа связанной сущности `user`».
Не нужно вручную проставлять `id` — Hibernate выставит его при привязке `user`. На уровне БД
`user_id` одновременно `PRIMARY KEY` и `FOREIGN KEY`. Это устраняет лишний суррогатный столбец и
гарантирует строго один профиль на пользователя.

### `@MapsId` с составным ключом в `@ManyToOne`

Когда у дочерней сущности составной ключ и одна из его частей приходит от родителя, `@MapsId`
указывает, какое именно поле встроенного ключа покрывается ассоциацией:

```java
@Embeddable
public class OrderItemId implements Serializable {
    private Long orderId;     // придёт от Order через @MapsId
    private Long productId;
    // equals/hashCode по обоим полям
}

@Entity
public class OrderItem {
    @EmbeddedId
    private OrderItemId id;

    @MapsId("orderId")        // покрывает поле orderId встроенного ключа
    @ManyToOne
    @JoinColumn(name = "order_id")
    private Order order;
}
```

### `@PrimaryKeyJoinColumn`

Старший по возрасту способ разделить первичный ключ в `@OneToOne` — `@PrimaryKeyJoinColumn`. Он
объявляет, что столбец первичного ключа дочерней таблицы одновременно является внешним ключом на
родителя, но, в отличие от `@MapsId`, не синхронизирует значение `id` из ассоциации
автоматически — id приходится выставлять самому. В новом коде предпочитают `@MapsId`;
`@PrimaryKeyJoinColumn` остаётся в наследовании `JOINED` (см.
[IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md)) и в legacy-маппингах.

---

## 6. Составные внешние ключи

Если на сущность с составным первичным ключом ссылается ассоциация, внешний ключ тоже становится
составным — несколько столбцов описываются через `@JoinColumns`:

```java
@Entity
public class Shipment {
    @ManyToOne
    @JoinColumns({
        @JoinColumn(name = "order_id",   referencedColumnName = "order_id"),
        @JoinColumn(name = "product_id", referencedColumnName = "product_id")
    })
    private OrderItem orderItem;   // у OrderItem составной ключ (orderId, productId)
}
```

`referencedColumnName` указывает, на какой именно столбец составного первичного ключа смотрит
каждый столбец внешнего ключа. Порядок и соответствие столбцов должны точно совпадать с целевым
ключом — иначе провайдер либо откажет на старте, либо сгенерирует неверный `JOIN`.

---

## 7. Суррогатные vs естественные ключи

| | Суррогатный ключ | Естественный / составной ключ |
|--|------------------|-------------------------------|
| Источник | сгенерирован системой (sequence, UUID) | значение(я) предметной области |
| Стабильность | абсолютная, никогда не меняется | может меняться при эволюции домена |
| Размер FK | один узкий столбец | несколько столбцов, шире индексы |
| JDBC-батчинг вставок | работает с `SEQUENCE` | страдает (см. ниже) |
| Ассоциации | простой однопольный FK | громоздкий `@JoinColumns` |
| Когда уместен | по умолчанию для большинства сущностей | таблицы-связки, естественная композиция |

### Почему Hibernate с составными ключами неудобен

- **Батчинг и генерация.** Составной ключ обычно естественный, то есть назначается приложением, а
  не последовательностью. Преимущества `SEQUENCE`-генератора и пула значений (см.
  [IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md)) к нему неприменимы; для derived id через
  `@MapsId` генерация тоже сложнее.
- **Ассоциации.** Любая ссылка на сущность с составным ключом тянет за собой `@JoinColumns` с
  ручным перечислением столбцов и `referencedColumnName` — многословно и хрупко при переименованиях.
- **Рефакторинг.** Естественный ключ «протекает» во все ссылающиеся таблицы как составной FK.
  Изменение состава ключа (добавили столбец в идентичность) каскадом ломает все внешние ключи и
  ассоциации, ссылающиеся на него. Суррогатный ключ изолирует идентичность от домена.
- **Обязательный boilerplate.** Класс ключа требует `Serializable`, no-arg конструктор и аккуратные
  `equals`/`hashCode` — забыли любой пункт, получили тихий баг в Identity Map.

### Когда составной ключ всё же оправдан

- **Чистая таблица-связка** многие-ко-многим без собственных атрибутов и без входящих ссылок:
  пара `(student_id, course_id)` и есть идентичность, суррогатный id здесь — лишний столбец.
- **Естественная неизменяемая композиция**, на которую ничего не ссылается составным FK: курс
  валют `(from, to, date)`, где композиция стабильна и семантически точна.

Практическое правило: по умолчанию — узкий суррогатный ключ (`SEQUENCE`/UUID); составной берут
осознанно для таблиц-связок и стабильных естественных композиций, понимая цену в батчинге,
ассоциациях и рефакторинге.

---

## 8. Battle-story: потерянная строка из-за забытого equals

Команда добавила таблицу-связку `account_role` с `@EmbeddedId(accountId, roleId)` и торопилась —
класс ключа сгенерировали без `equals`/`hashCode`. Тесты на одной транзакции проходили: внутри
одного persistence context Hibernate возвращал тот же экземпляр по ссылке. В проде же повторный
`em.find(AccountRole.class, new AccountRoleId(a, r))` приходил с **новым** объектом ключа — и из-за
дефолтного `Object.equals` каждый раз промахивался мимо L1-кэша, уходя в БД. Под нагрузкой это дало
кратный рост числа `SELECT` и деградацию задержек. Хуже — в одном сценарии Identity Map подхватил
два «разных» экземпляра ключа на одну строку, и dirty checking записал противоречивые `UPDATE`.
Починка — один метод `equals` и один `hashCode` по обоим полям ключа. Урок: для класса составного
ключа `equals`/`hashCode` не опциональны, это часть контракта идентичности.

---

## 9. Где почитать дальше

- [IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md) — генерация одиночных id и стратегии наследования (`@PrimaryKeyJoinColumn` в `JOINED`).
- [ENTITY_IDENTITY_EQUALS.md](ENTITY_IDENTITY_EQUALS.md) — идентичность сущности и proxy-safe `equals`/`hashCode`.
- [MAPPINGS_ASSOCIATIONS.md](MAPPINGS_ASSOCIATIONS.md) — `@Embeddable`, ассоциации, `@JoinColumn`, владелец связи.
- [ADVANCED_MAPPINGS.md](ADVANCED_MAPPINGS.md) — продвинутые маппинги.
- [ENTITY_LIFECYCLE.md](ENTITY_LIFECYCLE.md) — состояния сущности и persistence context (Identity Map).

## Источники

- *Hibernate ORM User Guide* — раздел Identifiers (Composite identifiers, `@EmbeddedId`, `@IdClass`, derived identifiers, `@MapsId`).
- Vlad Mihalcea, *High-Performance Java Persistence* — главы про составные идентификаторы и derived identifiers.
- Vlad Mihalcea — «The best way to map a composite primary key with JPA and Hibernate» и «How to map a @OneToOne relationship with @MapsId».
- *Jakarta Persistence Specification* — разделы Primary Keys and Entity Identity, Composite Primary Keys, Derived Identities.
