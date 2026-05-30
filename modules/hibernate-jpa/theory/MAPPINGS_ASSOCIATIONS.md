# Hibernate / JPA — Маппинг и ассоциации

Как декларативная разметка классов (`@Entity`, `@Embeddable`) превращается в строки таблиц,
как описываются связи между сущностями, кто из сторон ассоциации владеет внешним ключом и
почему неверный `equals`/`hashCode` сущности тихо ломает работу с `Set` и lazy-коллекциями.

---

## Базовые аннотации маппинга

| Аннотация | Назначение |
|-----------|------------|
| `@Entity` | Класс — управляемая сущность; обязателен идентификатор `@Id` |
| `@Table` | Имя таблицы, схема, уникальные ограничения, индексы |
| `@Column` | Имя столбца, `nullable`, `length`, `unique`, `insertable`/`updatable` |
| `@Basic` | Базовый тип; `fetch = LAZY` для столбца требует bytecode enhancement |
| `@Transient` | Поле не маппится на столбец |
| `@Enumerated` | Маппинг enum: `STRING` (безопасно) или `ORDINAL` (хрупко) |

```java
@Entity
@Table(name = "book",
       uniqueConstraints = @UniqueConstraint(columnNames = "isbn"),
       indexes = @Index(name = "idx_book_title", columnList = "title"))
public class Book {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Column(nullable = false, length = 13, unique = true)
    private String isbn;

    @Column(nullable = false)
    private String title;
}
```

Сущность обязана иметь конструктор без аргументов (для прокси и рефлексии) и не должна быть
`final` — иначе Hibernate не сможет построить прокси для lazy-загрузки.

> `@Enumerated(EnumType.ORDINAL)` хранит порядковый номер константы. Перестановка значений в enum
> молча портит уже сохранённые данные. По умолчанию используйте `STRING`.

---

## `@Embeddable` / `@Embedded` — компонентный маппинг

Встраиваемый тип (`@Embeddable`) не имеет собственного идентификатора и таблицы: его поля
раскладываются в столбцы таблицы владельца. Это инструмент композиции, а не наследования.

```java
@Embeddable
public class Address {
    private String street;
    private String city;
    private String zip;
}

@Entity
public class Customer {
    @Id @GeneratedValue
    private Long id;

    @Embedded
    private Address address;   // столбцы street, city, zip в таблице customer
}
```

`@AttributeOverride` переименовывает столбцы, если один тип встроен дважды (например, домашний и
рабочий адрес). Встраиваемый тип должен быть value-объектом: его жизненный цикл полностью совпадает
с жизненным циклом владельца, отдельной идентичности у него нет.

---

## Ассоциации: кардинальность

| Аннотация | Кардинальность | Где обычно внешний ключ |
|-----------|----------------|-------------------------|
| `@ManyToOne` | много → один | в таблице текущей сущности (владелец) |
| `@OneToMany` | один → много | в таблице противоположной сущности |
| `@OneToOne` | один → один | в одной из таблиц или общий первичный ключ |
| `@ManyToMany` | много → много | в отдельной join-таблице |

Фундаментальное правило: внешний ключ всегда находится на стороне «много». Поэтому естественный
владелец двунаправленной связи — это `@ManyToOne`-сторона.

---

## Владеющая сторона и обратная сторона: роль `mappedBy`

В реляционной модели связь — это **один** внешний ключ. В объектной модели двунаправленная связь
представлена **двумя** ссылками. Hibernate синхронизирует их с единственным внешним ключом только
по той стороне, которая объявлена владельцем (owning side). Противоположная сторона (inverse) —
лишь зеркало для навигации; изменения на ней в SQL не транслируются.

- **Владеющая сторона** — сторона без `mappedBy`. Именно её состояние определяет значение внешнего ключа.
- **Обратная сторона** — сторона с `mappedBy = "поле_владельца"`. Hibernate её при записи игнорирует.

```java
@Entity
public class Order {
    @OneToMany(mappedBy = "order",      // inverse side
               cascade = CascadeType.ALL,
               orphanRemoval = true)
    private Set<OrderItem> items = new HashSet<>();
}

@Entity
public class OrderItem {
    @ManyToOne                          // owning side: столбец order_id здесь
    @JoinColumn(name = "order_id")
    private Order order;
}
```

Классическая ошибка — добавить элемент только в коллекцию обратной стороны:

```java
order.getItems().add(item);   // НЕ установит order_id — owning side не тронут
// корректно:
item.setOrder(order);                 // owning side
order.getItems().add(item);           // зеркало для согласованности в памяти
```

Поэтому заводят helper-методы, синхронизирующие обе стороны:

```java
public void addItem(OrderItem item) {
    items.add(item);
    item.setOrder(this);
}
```

---

## Join-столбцы и join-таблицы

- `@JoinColumn` — задаёт имя столбца внешнего ключа на владеющей стороне.
- `@JoinTable` — задаёт промежуточную таблицу для `@ManyToMany` (или однонаправленного
  `@OneToMany`, что часто нежелательно).

```java
@Entity
public class Student {
    @ManyToMany
    @JoinTable(name = "student_course",
               joinColumns = @JoinColumn(name = "student_id"),
               inverseJoinColumns = @JoinColumn(name = "course_id"))
    private Set<Course> courses = new HashSet<>();
}
```

`@ManyToMany` без атрибутов на связи допустим, но как только нужны атрибуты самой связи (дата
записи, оценка), join-таблицу выносят в отдельную сущность с двумя `@ManyToOne`.

> Однонаправленный `@OneToMany` без `mappedBy` Hibernate реализует через `@JoinTable` либо через
> отдельные `UPDATE` внешнего ключа — это лишние запросы. Предпочитайте двунаправленную связь с
> владельцем на `@ManyToOne`-стороне.

---

## Типы каскадирования

Каскад распространяет операции жизненного цикла сущности на связанные сущности. Управляется
атрибутом `cascade` ассоциации.

| Тип | Распространяет |
|-----|----------------|
| `PERSIST` | `persist()` |
| `MERGE` | `merge()` |
| `REMOVE` | `remove()` |
| `REFRESH` | `refresh()` |
| `DETACH` | `detach()` |
| `ALL` | все перечисленные |

Каскад уместен в композиции «родитель владеет детьми» (заказ → позиции заказа). Его не вешают на
`@ManyToOne` в сторону справочников: каскадный `REMOVE` на ссылке `OrderItem → Product` удалит
товар из каталога при удалении позиции.

---

## `orphanRemoval`

`orphanRemoval = true` удаляет дочернюю сущность, когда она удалена из коллекции родителя или связь
разорвана — даже без явного `remove()`.

```java
order.getItems().remove(item);   // при orphanRemoval=true → DELETE для item
```

Отличие от `CascadeType.REMOVE`: `REMOVE` срабатывает только при удалении самого родителя;
`orphanRemoval` срабатывает ещё и при отвязывании ребёнка от живого родителя. По смыслу
`orphanRemoval` моделирует строгую композицию (ребёнок не существует вне родителя). На
`@ManyToOne`/`@ManyToMany`-справочниках он недопустим.

---

## equals / hashCode для сущностей

Неверный `equals`/`hashCode` сущности тихо ломает работу с `Set` и lazy-коллекциями: сущность
«теряется» в `HashSet` после `persist()` (сгенерированный `id` меняет `hashCode`), а реализация по
`getClass()` падает на Hibernate-прокси. Правильная основа — неизменяемый бизнес-ключ (или
назначаемый до `persist()` UUID) и proxy-safe-сравнение через `instanceof`.

Полный разбор — идентичность сущностей, generated-id problem, proxy-safe `equals`, бизнес-ключ,
опасность Lombok `@Data` — вынесен в отдельный канонический файл:
[ENTITY_IDENTITY_EQUALS.md](ENTITY_IDENTITY_EQUALS.md). Общий Java-контракт `equals`/`hashCode` —
в [`../../java-core/theory/EQUALS_HASHCODE_COMPARABLE.md`](../../java-core/theory/EQUALS_HASHCODE_COMPARABLE.md);
`equals`/`hashCode` для классов составного ключа — в [COMPOSITE_KEYS.md](COMPOSITE_KEYS.md).

---

## Где почитать дальше

- [JPA_VS_HIBERNATE.md](JPA_VS_HIBERNATE.md) — спецификация JPA vs провайдер Hibernate.
- [ENTITY_LIFECYCLE.md](ENTITY_LIFECYCLE.md) — состояния сущности, persistence context, dirty checking.
- [IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md) — генерация id и стратегии наследования.
- [FETCHING_NPLUS1.md](FETCHING_NPLUS1.md) — LAZY/EAGER, прокси, `JOIN FETCH`, N+1.
- [CACHING.md](CACHING.md) — кэши L1/L2 и query cache.
- [TRANSACTIONS_LOCKING.md](TRANSACTIONS_LOCKING.md) — транзакции, `@Version`, блокировки.
- [QUERYING.md](QUERYING.md) — JPQL/HQL, Criteria API, DTO-проекции.
- [PERFORMANCE_PITFALLS.md](PERFORMANCE_PITFALLS.md) — batching, `StatelessSession`, OSIV.
- [`../../java-core/theory/EQUALS_HASHCODE_COMPARABLE.md`](../../java-core/theory/EQUALS_HASHCODE_COMPARABLE.md) — общий Java-контракт `equals`/`hashCode`.

## Источники

- *Hibernate ORM User Guide* — разделы Associations, Embeddable, Identifiers.
- Vlad Mihalcea, *High-Performance Java Persistence* — главы про ассоциации и `equals`/`hashCode`.
- Vlad Mihalcea — «The best way to implement equals, hashCode, and toString with JPA and Hibernate».
- *Jakarta Persistence Specification* — разделы Entities, Embeddable Classes, Relationships.
