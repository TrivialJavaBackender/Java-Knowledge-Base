# Hibernate / JPA — Идентичность сущностей и equals/hashCode

Один из самых частых каверзных вопросов на senior-собеседовании. Корень проблемы в том, что у
JPA-сущности есть **три разных вида идентичности**, и они расходятся в самые неудачные моменты:
сразу после `persist()`, между сессиями, при `detach`/`merge`, при работе через прокси. Неверный
`equals`/`hashCode` не падает с ошибкой — он молча теряет сущность в `HashSet`, ломает
`orphanRemoval` и приводит к дубликатам в коллекциях.

Общий Java-контракт `equals`/`hashCode` (рефлексивность, симметричность, транзитивность,
согласованность с `hashCode`) описан в
[`../../java-core/theory/EQUALS_HASHCODE_COMPARABLE.md`](../../java-core/theory/EQUALS_HASHCODE_COMPARABLE.md).
Здесь — специфика, которая ломает именно управляемые сущности.

---

## Три вида идентичности

| Вид | Чем определяется | Оператор / метод |
|-----|------------------|------------------|
| Объектная идентичность | один и тот же объект в куче JVM | `a == b` |
| Идентичность БД | одинаковый первичный ключ (PK) | `a.getId().equals(b.getId())` |
| Идентичность по `equals` | пользовательская реализация `equals` | `a.equals(b)` |

В пределах одного persistence context эти три совпадают: благодаря Identity Map (кэш L1, см.
[ENTITY_LIFECYCLE.md](ENTITY_LIFECYCLE.md)) одна строка БД загружается ровно в один объект. Поэтому
внутри одной сессии даже дефолтный `Object.equals` (по ссылке) работает «правильно».

Расхождение начинается за пределами сессии:

- **Между сессиями.** Та же строка, загруженная в двух разных persistence context, — это два
  разных объекта в куче. Объектная идентичность их различает, идентичность БД — отождествляет.
- **При detach/merge.** Detached-копия и её свежезагруженная версия — разные объекты. `merge()`
  возвращает управляемый экземпляр, отличный от того, что вы передали, — снова два объекта на одну
  строку.

Корректный `equals` сущности обязан опираться на идентичность БД (или бизнес-ключ), а не на ссылку.

---

## Почему дефолтный `Object.equals` рвётся

`Object.equals` — это идентичность по ссылке. Пока сущность не покидает сессию, всё хорошо. Но
как только сущность пересекает границу транзакции, кэшируется во втором уровне или
сериализуется/десериализуется в DTO, появляются два объекта на одну строку:

```java
Book detached;
try (var em1 = emf.createEntityManager()) {
    detached = em1.find(Book.class, 1L);   // объект A
}
try (var em2 = emf.createEntityManager()) {
    Book managed = em2.find(Book.class, 1L);   // объект B, та же строка
    managed.equals(detached);              // Object.equals → false (!)
}
```

Та же ловушка — внутри `Set<Book>`, собранного из нескольких сессий: одна логическая книга
попадёт в множество дважды.

---

## Проблема сгенерированного БД `id`

Соблазнительно реализовать `equals`/`hashCode` по первичному ключу `id`. Но при стратегии
`IDENTITY`/`SEQUENCE` (см. [IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md)) `id` присваивается
**базой данных при insert**. До `flush()` он `null`, после — внезапно становится числом. А `hashCode`
по контракту обязан быть **стабильным всё время жизни объекта**, пока поля, по которым он считается,
не меняются. Сгенерированный `id` это нарушает: для `HashSet`/`HashMap` объект кладётся в бакет по
старому `hashCode`, а ищется по новому — и теряется.

### Battle-story: потеря сущности в Set после persist

```java
@Override public int hashCode() { return Objects.hashCode(id); }   // ПЛОХО: id генерируется БД

Set<OrderItem> items = new HashSet<>();
OrderItem item = new OrderItem();   // id == null
items.add(item);                    // лёг в бакет по hashCode(null) == 0
order.addItem(item);
em.persist(order);
em.flush();                         // БД присвоила id = 42 → hashCode стал 42

items.contains(item);               // false — ищем в бакете 42, лежит в бакете 0
items.remove(item);                 // не находит → элемент не удаляется
```

Самое коварное: ошибка не воспроизводится в юнит-тестах без реальной БД (там `id` назначают
руками) и всплывает только в интеграции после `flush()`. С `orphanRemoval` это приводит к тому, что
отвязанный ребёнок не помечается на удаление.

---

## Почему мутабельные поля рвут hash-коллекции

Контракт `HashSet`/`HashMap`: пока объект лежит в коллекции, его `hashCode` обязан оставаться
неизменным. Любое поле, которое может измениться за жизнь объекта (`id`, статус, цена,
lazy-ассоциация), нельзя включать в `hashCode`:

```java
@Override public int hashCode() { return Objects.hash(title, status); }   // ПЛОХО: status мутабелен

set.add(book);
book.setStatus(ARCHIVED);   // hashCode изменился
set.contains(book);         // false — объект в «неправильном» бакете
```

Отсюда правило: основа `hashCode` сущности — только **иммутабельное, назначаемое до persist**
значение. Идеально — бизнес-ключ; если его нет — константа.

---

## Бизнес-ключ как правильная основа

Бизнес-ключ (natural key) — иммутабельный идентификатор предметной области, заданный до сохранения
в БД: ISBN книги, номер паспорта, e-mail пользователя, SKU товара. Он стабилен на всём жизненном
цикле и не зависит от того, прошёл объект через `flush()` или нет.

```java
@Entity
public class Book {
    @Id @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;                                  // суррогатный PK — для БД

    @Column(nullable = false, unique = true, updatable = false, length = 13)
    private String isbn;                              // бизнес-ключ — для equals

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Book book)) return false;  // instanceof, не getClass()!
        return isbn != null && isbn.equals(book.isbn);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(isbn);                // стабилен всё время жизни
    }
}
```

`updatable = false` на бизнес-ключе — обязателен: он не должен меняться, иначе вернётся проблема
мутабельного поля.

### Что если бизнес-ключа нет

Многие сущности не имеют естественного ключа (`Order`, `Payment`, лог-запись). Канонический выход —
**назначаемый приложением UUID**, сгенерированный в коде **до** `persist()`:

```java
@Entity
public class Order {
    @Id
    @Column(columnDefinition = "uuid", updatable = false)
    private UUID id = UUID.randomUUID();   // известен сразу при new, не зависит от БД

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Order order)) return false;
        return id != null && id.equals(order.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);   // id назначен до persist → стабилен
    }
}
```

Это та же стратегия «equals по id», но id здесь известен сразу и **не меняется** при `flush()` — в
отличие от сгенерированного базой `IDENTITY`/`SEQUENCE`. По генерации идентификаторов см.
[IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md). Для классов составного ключа (`@IdClass`,
`@EmbeddedId`) их собственный `equals`/`hashCode` рассмотрен в [COMPOSITE_KEYS.md](COMPOSITE_KEYS.md).

---

## Proxy-safe equals/hashCode: почему `getClass()` ломается

Для lazy-ассоциаций Hibernate подсовывает не саму сущность, а **прокси** — динамически
сгенерированный подкласс (bytecode enhancement, см. [FETCHING_NPLUS1.md](FETCHING_NPLUS1.md)).
Поэтому `book.getClass()` вернёт не `Book`, а что-то вроде `Book$HibernateProxy$a1B2c3`.

Если `equals` написан через `getClass()`:

```java
// ПЛОХО: ломается на прокси
if (o == null || getClass() != o.getClass()) return false;
```

то сравнение реальной сущности с прокси той же строки даст `false`, хотя это одна логическая
запись. Симметричность контракта тоже нарушается. Два корректных решения:

1. **`instanceof`** — прокси является подклассом, поэтому `proxy instanceof Book == true`. Это
   рекомендованный путь (и он же даёт паттерн-матчинг в современной Java).
2. **`Hibernate.getClass(obj)`** — возвращает реальный класс сущности, снимая прокси-обёртку
   (аналогично `Hibernate.unproxy(obj)` для самого объекта). Нужен, когда иерархия наследования
   требует точного сравнения классов, а не «является подтипом».

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null) return false;
    if (!(o instanceof Book)) return false;          // прокси проходит
    Book other = (Book) o;
    return isbn != null && isbn.equals(other.isbn);
}
```

Важно: внутри `equals`/`hashCode` обращайтесь к **полям через геттеры** (`getIsbn()`), а не к полю
напрямую (`o.isbn`) — у прокси поля не инициализированы, пока не вызван геттер, инициирующий
дозагрузку. Прямой доступ к полю прокси вернёт `null`.

---

## Канонический рецепт (Vlad Mihalcea)

Когда бизнес-ключа нет и приходится опираться на сгенерированный `id`, общепринятый рецепт —
**константный `hashCode` + `equals` по `id` через `instanceof`**:

```java
@Entity
public class Order {
    @Id @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Order order)) return false;
        return id != null && id.equals(order.id);    // null != null трактуется как «не равны»
    }

    @Override
    public int hashCode() {
        return getClass().hashCode();   // КОНСТАНТА для всех экземпляров класса
    }
}
```

Почему это работает:

- `hashCode` — **константа** (один и тот же для всех `Order`), поэтому он не меняется после `flush()`
  и контракт hash-коллекций не нарушается. Платой служат коллизии: все `Order` падают в один бакет,
  внутри которого работает `equals`. Для типичных размеров коллекций сущностей (десятки элементов)
  это несущественно.
- `equals` сравнивает `id`, но **два transient-объекта с `id == null` считаются не равными** (кроме
  случая `this == o`). Это сознательное нарушение строгого равенства ради безопасности коллекций:
  два ещё не сохранённых `Order` — это всегда два разных заказа.

Предпочтительный порядок выбора: **бизнес-ключ → назначаемый UUID → константный hashCode + id**.

---

## Lombok `@Data`/`@EqualsAndHashCode` на сущностях — почему опасно

Никогда не вешайте Lombok-аннотации `@Data` или `@EqualsAndHashCode` без настройки на JPA-сущности:

- `@Data` включает `@EqualsAndHashCode`, который по умолчанию берёт **все поля**, включая
  мутабельный сгенерированный `id` (проблема нестабильного `hashCode`) и **lazy-ассоциации**.
- Обращение к lazy-полю внутри сгенерированного `equals`/`hashCode` вызывает дозагрузку или
  `LazyInitializationException` вне сессии (см. [FETCHING_NPLUS1.md](FETCHING_NPLUS1.md)).
- `@Data` ещё и генерирует `@ToString` по всем полям — тот же риск дозагрузки и циклов по
  двунаправленным связям.

Если Lombok всё же используется, минимально безопасная настройка — явно ограничить поля
бизнес-ключом:

```java
@Entity
@EqualsAndHashCode(onlyExplicitlyIncluded = true)   // ничего, кроме помеченных полей
@ToString(onlyExplicitlyIncluded = true)
public class Book {
    @Id @GeneratedValue private Long id;

    @EqualsAndHashCode.Include
    @ToString.Include
    @Column(unique = true, updatable = false)
    private String isbn;                            // только бизнес-ключ
}
```

Лучшее правило для сущностей — писать `equals`/`hashCode` руками: они короткие, а цена ошибки
высока.

---

## Где почитать дальше

- [MAPPINGS_ASSOCIATIONS.md](MAPPINGS_ASSOCIATIONS.md) — маппинг, владеющая/обратная сторона, `Set` и helper-методы коллекций.
- [COMPOSITE_KEYS.md](COMPOSITE_KEYS.md) — `@IdClass`/`@EmbeddedId` и их собственные `equals`/`hashCode`.
- [FETCHING_NPLUS1.md](FETCHING_NPLUS1.md) — прокси, bytecode enhancement, `LazyInitializationException`.
- [ENTITY_LIFECYCLE.md](ENTITY_LIFECYCLE.md) — состояния сущности, persistence context, Identity Map.
- [IDENTIFIERS_INHERITANCE.md](IDENTIFIERS_INHERITANCE.md) — стратегии генерации `id`, назначаемый UUID.
- [`../../java-core/theory/EQUALS_HASHCODE_COMPARABLE.md`](../../java-core/theory/EQUALS_HASHCODE_COMPARABLE.md) — общий Java-контракт `equals`/`hashCode`.

## Источники

- Vlad Mihalcea — «The best way to implement equals, hashCode, and toString with JPA and Hibernate».
- Vlad Mihalcea — «How to implement equals and hashCode using the JPA entity identifier (primary key)».
- *Hibernate ORM User Guide* — разделы Equality, Proxies, Identifiers.
- *Jakarta Persistence Specification* — раздел Entities (Entity Identity).
