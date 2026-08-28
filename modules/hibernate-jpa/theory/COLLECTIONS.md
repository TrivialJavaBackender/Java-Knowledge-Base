# Hibernate / JPA — Семантика коллекций: bag, list, set

Hibernate отображает Java-коллекции на ассоциации `*ToMany` и `@ElementCollection`, но за тремя
обычными типами `List`, `Set`, `Map` скрываются **разные** реляционные семантики с разной
производительностью. Один и тот же `List` может вести себя как неупорядоченное мультимножество без
идентичности строк или как настоящий индексированный список — разница в одной аннотации, а
последствия для SQL громадны. Здесь — как устроены `PersistentBag`/`PersistentSet`/`PersistentList`,
почему bag не умеет точечно удалять, откуда берётся `MultipleBagFetchException`, и чем `@OrderBy`
отличается от `@OrderColumn`.

> Базовый маппинг ассоциаций (owning vs inverse side, `mappedBy`, cascade, `equals`/`hashCode`) —
> в [`MAPPINGS_ASSOCIATIONS.md`](MAPPINGS_ASSOCIATIONS.md). N+1 при загрузке коллекций, `@BatchSize`
> и ловушки `JOIN FETCH` — в [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md). Здесь — только семантика
> самих коллекций.

---

## 1. Три семантики: bag vs set vs list

Тип поля в Java определяет, какую обёртку (persistent collection) подставит Hibernate и какую
реляционную семантику он гарантирует.

| Java-тип + аннотации | Семантика Hibernate | Обёртка | Дубликаты | Колонка позиции | Точечный `DELETE` |
|---|---|---|---|---|---|
| `List` без `@OrderColumn` | **bag** — мультимножество | `PersistentBag` | разрешены | нет | нет (delete-all + reinsert) |
| `Set` | **set** — множество | `PersistentSet` | запрещены | нет | да |
| `List` + `@OrderColumn` | **list** — индексированный список | `PersistentList` | разрешены | есть (`*_order`) | да, но с пересдвигом индексов |

Ключевой и контринтуитивный факт: **`List` по умолчанию — это bag, а не список.** Слово «list» в
имени Java-типа ничего не говорит Hibernate о порядке. Без `@OrderColumn` Hibernate не хранит
позицию элемента, поэтому порядок при загрузке — недетерминированный (тот, что вернёт БД).

```java
// bag: List без @OrderColumn
@OneToMany(mappedBy = "post", cascade = ALL, orphanRemoval = true)
private List<Comment> comments = new ArrayList<>();   // PersistentBag

// set
@OneToMany(mappedBy = "post", cascade = ALL, orphanRemoval = true)
private Set<Comment> comments = new HashSet<>();       // PersistentSet

// настоящий список
@OneToMany(mappedBy = "post", cascade = ALL, orphanRemoval = true)
@OrderColumn(name = "position")
private List<Comment> comments = new ArrayList<>();    // PersistentList
```

### Чем bag опасен — delete-all-and-reinsert

У bag нет ни первичного ключа строки коллекции (как у set по составу), ни колонки позиции (как у
list). Hibernate не может однозначно сопоставить элемент Java-списка со строкой таблицы. Поэтому при
**любом** изменении однонаправленной bag-коллекции (`@JoinColumn` без `mappedBy`) он применяет
стратегию «удалить всё и вставить заново»:

```java
post.getComments().remove(0);   // убрали один элемент из bag из 100
em.flush();
// SQL:
// DELETE FROM comment WHERE post_id = ?           -- стёрли все 100 строк
// INSERT INTO comment (...) VALUES (...)           -- вставили обратно 99 (×99 INSERT)
```

Удаление одного элемента превращается в `DELETE` всей коллекции плюс N−1 `INSERT`. На больших
коллекциях это катастрофа по числу запросов и по нагрузке на индексы.

> Нюанс: для **двунаправленного** `@OneToMany(mappedBy=...)`, где внешним ключом владеет
> `@ManyToOne`-сторона, delete-all-and-reinsert не возникает — Hibernate управляет каждой строкой
> через её владельца (`UPDATE`/`DELETE` по id дочерней сущности). Антипаттерн в полную силу бьёт по
> однонаправленным bag и `@ElementCollection`. Тем не менее, как тип коллекции по умолчанию bag
> остаётся менее эффективным, чем set.

### Set удаляет точечно

`PersistentSet` опирается на `equals`/`hashCode` элементов, чтобы понять, какие строки добавлены, а
какие удалены, и выпускает ровно нужные `INSERT`/`DELETE`:

```java
post.getComments().remove(comment);
em.flush();
// SQL: DELETE FROM comment WHERE id = ?            -- ровно одна строка
```

Цена корректности — `equals`/`hashCode` сущностей-элементов **обязаны** быть стабильными (бизнес-ключ
или назначаемый UUID, не сгенерированный базой `id`). Иначе set «теряет» элементы — см.
[`MAPPINGS_ASSOCIATIONS.md`](MAPPINGS_ASSOCIATIONS.md), раздел про `equals`/`hashCode`.

---

## 2. MultipleBagFetchException — battle-story

Классическая боль. Сущность с двумя bag-коллекциями, и кто-то пытается догрузить обе одним запросом:

```java
@Entity
public class Post {
    @OneToMany(mappedBy = "post")
    private List<Comment> comments = new ArrayList<>();   // bag

    @OneToMany(mappedBy = "post")
    private List<Tag> tags = new ArrayList<>();           // bag
}

// JOIN FETCH сразу двух bag
em.createQuery(
    "SELECT p FROM Post p JOIN FETCH p.comments JOIN FETCH p.tags", Post.class)
   .getResultList();
```

На старте приложения (или при выполнении запроса) Hibernate бросает:

```
org.hibernate.loader.MultipleBagFetchException:
    cannot simultaneously fetch multiple bags: [Post.comments, Post.tags]
```

**Почему это запрещено.** Два `JOIN FETCH` коллекций дают декартово произведение: пост с 10
комментариями и 5 тегами вернёт 50 строк. Для **set** Hibernate смог бы дедуплицировать строки по
составу, но **bag не имеет средства различить дубль, порождённый джойном, от настоящего дубликата в
данных.** 50 строк он не сумеет корректно свернуть обратно в 10 комментариев и 5 тегов — поэтому
Hibernate отказывается выполнять запрос вообще, а не молча портит данные.

### Три решения

1. **Заменить `List` на `Set`** (если дубликаты в коллекции не нужны). `PersistentSet`
   дедуплицирует строки декартова произведения по `equals`, и два `JOIN FETCH` set допустимы. Самое
   простое и предпочтительное решение.

   ```java
   private Set<Comment> comments = new HashSet<>();
   private Set<Tag> tags = new HashSet<>();
   ```

   > Хотя два `JOIN FETCH` set синтаксически разрешены, декартово произведение (10 × 5 = 50 строк)
   > никуда не девается — по сети едет 50 строк. На больших коллекциях это всё равно плохо: лучше
   > двухзапросный паттерн (ниже).

2. **Грузить коллекции разными запросами.** Загружаем посты с первой коллекцией, затем те же
   управляемые сущности «обогащаем» второй. Благодаря L1-кэшу (persistence context) второй запрос
   дозаполняет уже загруженные объекты:

   ```java
   List<Post> posts = em.createQuery(
       "SELECT DISTINCT p FROM Post p JOIN FETCH p.comments WHERE p.id IN :ids", Post.class)
       .setParameter("ids", ids).getResultList();
   em.createQuery(
       "SELECT DISTINCT p FROM Post p JOIN FETCH p.tags WHERE p.id IN :ids", Post.class)
       .setParameter("ids", ids).getResultList();
   // posts уже содержат и comments, и tags — обогащены через persistence context
   ```

3. **`@OrderColumn`** превращает bag в `PersistentList`. Список с колонкой позиции — уже не bag,
   и запрет на множественную загрузку на него не распространяется (хотя декартово произведение строк
   остаётся, со всеми его минусами).

> Лучший дефолт против `MultipleBagFetchException` — `Set` для коллекций без дубликатов плюс
> загрузка крупных коллекций отдельными запросами или через `@BatchSize`
> (см. [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md)).

---

## 3. Упорядоченные (ordered) vs отсортированные (sorted) коллекции

Две разные стратегии задать порядок, которые легко перепутать. Различие — **где** происходит
сортировка: в SQL при загрузке или в памяти JVM.

| Подход | Аннотация | Java-тип | Где сортируется | SQL |
|---|---|---|---|---|
| **ordered** | `@OrderBy("field ASC")` | `List` / любой | в БД, при каждой загрузке | добавляет `ORDER BY` |
| **sorted** | `@SortNatural` / `@SortComparator` | `SortedSet` / `SortedMap` | в памяти JVM | без `ORDER BY` |

### Ordered — сортировка на стороне БД

`@OrderBy` добавляет `ORDER BY` в SQL загрузки коллекции. Порядок устанавливается базой при каждой
выборке; в памяти Hibernate ничего не пересортировывает.

```java
@OneToMany(mappedBy = "post")
@OrderBy("createdAt DESC")
private List<Comment> comments = new ArrayList<>();
// SELECT * FROM comment WHERE post_id = ? ORDER BY created_at DESC
```

Пустой `@OrderBy` сортирует по первичному ключу. Порядок гарантируется только в момент загрузки —
если потом добавить элемент в коллекцию в памяти, он встанет в конец `List`, а не на своё место по
сортировке.

### Sorted — сортировка в памяти

`SortedSet`/`SortedMap` (реализуемые `PersistentSortedSet`/`PersistentSortedMap` поверх
`TreeSet`/`TreeMap`) держат элементы отсортированными **в JVM**. SQL `ORDER BY` не добавляется.

```java
@OneToMany(mappedBy = "post")
@SortNatural                       // элементы должны быть Comparable
private SortedSet<Comment> comments = new TreeSet<>();

@OneToMany(mappedBy = "post")
@SortComparator(CommentByDateComparator.class)   // внешний компаратор
private SortedSet<Comment> comments = new TreeSet<>();
// SELECT * FROM comment WHERE post_id = ?   -- БЕЗ ORDER BY, порядок держит TreeSet
```

Разница на интервью: **ordered перекладывает сортировку на БД (можно задействовать индекс), sorted
сортирует на каждом узле приложения в памяти.** Для больших коллекций `@OrderBy` с индексом по
колонке обычно дешевле, чем сортировка `TreeSet` в heap.

---

## 4. PersistentBag / PersistentSet / PersistentList — обёртки

Когда сущность становится управляемой, Hibernate **подменяет** ваш `ArrayList`/`HashSet` на собственную
обёртку — `PersistentBag`, `PersistentSet`, `PersistentList` (или `PersistentSortedSet` и т. д.).
Эти классы реализуют стандартные интерфейсы `List`/`Set`, но добавляют две вещи:

1. **Lazy-инициализация.** Пока коллекция не тронута, она — «пустая ракушка» с флагом
   `initialized = false` и ссылкой на сессию. Первое обращение к содержимому (`iterator()`, `get()`,
   `size()` для большинства типов) инициирует `SELECT` и наполняет обёртку. Обращение к lazy-коллекции
   после закрытия сессии даёт `LazyInitializationException`
   (см. [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md)).

2. **Снапшот для dirty checking.** В момент инициализации обёртка снимает **снапшот** исходного
   состава коллекции (отдельную копию). При flush Hibernate сравнивает текущее состояние со снапшотом
   и определяет, что добавлено и что удалено.

```java
post.getComments();                                  // PersistentBag, initialized=false
post.getComments().size();                           // SELECT → initialized=true, снят snapshot
post.getComments().add(newComment);                  // меняем коллекцию
em.flush();                                          // сравнение со snapshot → INSERT
```

---

## 5. Отслеживание изменений коллекций (dirty checking) — как и почём

Dirty checking сущностей (полей) и dirty checking коллекций — два разных механизма. Для коллекции
Hibernate при flush сравнивает **текущий состав с снапшотом**, снятым при инициализации.

- **Стоимость.** Сравнение — поэлементное; для bag оно ещё и сложнее (нет ключа строки). Чем больше
  коллекция, тем дороже проверка на грязность при каждом flush, даже если коллекция не менялась.
- **Триггер инициализации = триггер снапшота.** Если коллекция так и не была инициализирована, снапшот
  не снят, и dirty checking коллекции её не трогает — это дешёвый сценарий «read-only без обхода».
- **Грязная коллекция != грязная сущность.** Изменение состава коллекции на inverse-стороне
  (`mappedBy`) не транслируется в SQL: внешним ключом владеет другая сторона
  (см. [`MAPPINGS_ASSOCIATIONS.md`](MAPPINGS_ASSOCIATIONS.md)).

> Практический вывод: не инициализируйте крупные коллекции «на всякий случай». Каждая
> проинициализированная коллекция — это память под снапшот плюс работа dirty checking на каждом flush.

---

## 6. Сверхленивые коллекции (Extra lazy)

Обычная lazy-коллекция при первом же `size()` или `contains()` грузит **всё** содержимое. Для очень
больших коллекций это расточительно: чтобы узнать количество, не нужно тянуть 10 000 строк.

Историческая аннотация `@LazyCollection(LazyCollectionOption.EXTRA)` (в современных версиях помечена
deprecated; аналогичное поведение в Hibernate 6 достигается через настройку коллекции/`@CollectionType`)
заставляет Hibernate отвечать на отдельные операции точечными SQL, **не загружая всю коллекцию**:

```java
@OneToMany(mappedBy = "post")
@LazyCollection(LazyCollectionOption.EXTRA)
private List<Comment> comments = new ArrayList<>();

post.getComments().size();        // SELECT COUNT(*) FROM comment WHERE post_id = ?
post.getComments().contains(c);   // SELECT 1 FROM comment WHERE post_id = ? AND id = ?
post.getComments().get(5);        // точечная выборка элемента (для list с @OrderColumn)
// сама коллекция при этом остаётся неинициализированной
```

Когда уместно: огромные коллекции, где нужны только `size()`/`contains()`, а полный обход не
требуется. Минус — каждая такая операция уходит в БД отдельным запросом; в цикле это легко
превращается в N+1.

---

## 7. @ElementCollection — коллекции value-типов

`@ElementCollection` хранит коллекцию **не сущностей**, а value-типов (базовых или `@Embeddable`).
У элементов нет собственного `@Id` и жизненного цикла — они полностью принадлежат владельцу и живут в
отдельной таблице (`@CollectionTable`).

```java
@Entity
public class User {
    @ElementCollection
    @CollectionTable(name = "user_phone",
                     joinColumns = @JoinColumn(name = "user_id"))
    @Column(name = "phone")
    private Set<String> phones = new HashSet<>();

    @ElementCollection
    @CollectionTable(name = "user_address", joinColumns = @JoinColumn(name = "user_id"))
    private List<Address> addresses = new ArrayList<>();   // Address — @Embeddable
}
```

Важный момент: `@ElementCollection` по умолчанию — **bag** (если `List`), со всем риском
delete-all-and-reinsert при изменении. Для `@ElementCollection` это особенно частая ловушка, потому
что у value-типов нет идентичности строки. Лечение — `@OrderColumn` (превратить в list) либо `Set`.

### Map-ассоциации: @MapKey / @MapKeyColumn

`Map` отображается на таблицу, где ключ карты хранится в отдельной колонке.

```java
// ключ — свойство сущности-значения
@OneToMany(mappedBy = "post")
@MapKey(name = "id")
private Map<Long, Comment> commentsById = new HashMap<>();

// ключ — отдельная колонка (для @ElementCollection)
@ElementCollection
@CollectionTable(name = "user_attribute", joinColumns = @JoinColumn(name = "user_id"))
@MapKeyColumn(name = "attr_name")
@Column(name = "attr_value")
private Map<String, String> attributes = new HashMap<>();
```

- `@MapKey(name=...)` — ключом карты служит **поле сущности-значения** (для ассоциаций сущностей).
- `@MapKeyColumn` — ключ хранится в **отдельной колонке** таблицы коллекции (для value-типов).

---

## 8. @OrderBy vs @OrderColumn — частый вопрос

Главная путаница раздела. Названия похожи, семантика — противоположная.

| | `@OrderBy` | `@OrderColumn` |
|---|---|---|
| Что делает | сортирует коллекцию **при загрузке** | материализует **индекс позиции** в отдельной колонке |
| Где хранится порядок | нигде — пересчитывается из данных | в колонке БД (`*_order`, `INTEGER`) |
| SQL при загрузке | `... ORDER BY <field>` | `... ORDER BY <order_column>` |
| Тип коллекции | оставляет bag/set (порядок не персистентен) | превращает `List` в **настоящий** `PersistentList` |
| Стоимость записи | нет — порядок определяется данными | при вставке/удалении в середину — `UPDATE` индексов сдвигаемых строк |
| Когда применять | порядок выводим из поля (дата, имя) | порядок задаёт **пользователь** и его нужно сохранить |

```java
// @OrderBy: порядок ВЫВОДИМ из данных, отдельной колонки нет
@OrderBy("createdAt DESC")
private List<Comment> comments;          // позиция нигде не хранится

// @OrderColumn: позиция МАТЕРИАЛИЗОВАНА, это настоящий список
@OrderColumn(name = "position")
private List<Slide> slides;              // колонка position хранит 0,1,2,...
```

Цена `@OrderColumn` — при вставке элемента в середину Hibernate должен сдвинуть индексы всех
последующих строк отдельными `UPDATE`:

```java
slides.add(2, newSlide);   // вставка в середину
// UPDATE slide SET position = position + 1 WHERE deck_id = ? AND position >= 2
// INSERT INTO slide (..., position) VALUES (..., 2)
```

Правило выбора: если порядок **выводим** из самих данных (по дате, по имени) — `@OrderBy`. Если
порядок — это **сама бизнес-сущность** (порядок слайдов в презентации, пунктов в плейлисте,
заданный пользователем) и его нельзя восстановить из других полей — `@OrderColumn`.

---

## 9. Где почитать дальше

- [`MAPPINGS_ASSOCIATIONS.md`](MAPPINGS_ASSOCIATIONS.md) — owning vs inverse side, `mappedBy`,
  cascade, `orphanRemoval`, `equals`/`hashCode` для элементов set.
- [`FETCHING_NPLUS1.md`](FETCHING_NPLUS1.md) — LAZY/EAGER, прокси, `JOIN FETCH`, `@BatchSize`,
  N+1 при загрузке коллекций, пагинация коллекций.
- [`ADVANCED_MAPPINGS.md`](ADVANCED_MAPPINGS.md) — `@Embeddable`, конвертеры, типы, продвинутый
  маппинг value-объектов.
- [`ENTITY_LIFECYCLE.md`](ENTITY_LIFECYCLE.md) — persistence context, состояния сущности, snapshot
  и dirty checking, flush modes.
- [`PERFORMANCE_PITFALLS.md`](PERFORMANCE_PITFALLS.md) — JDBC-батчинг, `StatelessSession`,
  read-only запросы, OSIV-антипаттерн.

## Источники

- *Hibernate ORM User Guide* — разделы «Collections», «Ordered collections vs sorted collections»,
  «Bags», «Lists», «Sets», «Maps», «`@ElementCollection`».
- Vlad Mihalcea, *High-Performance Java Persistence* — главы про коллекции, `@OrderColumn`,
  bag-семантику и delete-all-and-reinsert.
- Vlad Mihalcea — статьи: «The best way to fix the Hibernate MultipleBagFetchException»,
  «`@OneToMany` Set vs List», «Ordered vs sorted collections», «`@ElementCollection` best practices».
- *Jakarta Persistence Specification* — `@OrderBy`, `@OrderColumn`, `@ElementCollection`,
  `@CollectionTable`, `@MapKey`, `@MapKeyColumn`.
