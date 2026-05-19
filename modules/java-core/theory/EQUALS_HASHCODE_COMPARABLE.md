# equals / hashCode / Comparable

---

## 1. Почему контракты так важны

`HashMap`, `HashSet`, `TreeMap`, `TreeSet`, `LinkedHashMap` — самые часто используемые коллекции в Java. Все они **опираются** на корректность `equals`, `hashCode`, `compareTo` ключей или элементов. Нарушение контракта **не вызовет exception**: коллекция **молча** возвращает неправильные результаты.

```java
class BrokenKey {
    int x;
    BrokenKey(int x) { this.x = x; }
    @Override public boolean equals(Object o) { return o instanceof BrokenKey b && b.x == x; }
    // hashCode не переопределён!
}

HashMap<BrokenKey, String> m = new HashMap<>();
m.put(new BrokenKey(1), "first");
m.get(new BrokenKey(1));   // null! (или "first" с малой вероятностью)
```

Это не bug коллекции — это нарушение контракта пользователем. И такие баги — **очень типичные** в production. На собесе обязательно проверят, что ты знаешь правила.

---

## 2. Контракт `equals`

JLS / `Object` javadoc определяет 5 правил:

1. **Reflexive**: `x.equals(x) == true` для любого ненулевого `x`.
2. **Symmetric**: `x.equals(y) == y.equals(x)`.
3. **Transitive**: если `x.equals(y) && y.equals(z)` — то `x.equals(z)`.
4. **Consistent**: повторные вызовы при неизменности объектов дают тот же результат.
5. **Null-safe**: `x.equals(null) == false`.

### 2.1. Канонический шаблон

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;                          // 1) reference identity check
    if (!(o instanceof User other)) return false;         // 2) type check + pattern matching
    return Objects.equals(id, other.id)
        && Objects.equals(email, other.email);
}
```

Несколько важных деталей:

- **`this == o` first**: быстрая проверка identity. Если `o == this` — точно equal без дальнейшей работы. Особенно полезно когда equals идёт через цепочку (контейнеры).
- **`instanceof` с pattern matching** (Java 16+): объединяет проверку типа и cast. Раньше: `if (!(o instanceof User)) return false; User other = (User) o;`.
- **`Objects.equals(a, b)`** — null-safe сравнение. Не нужно вручную проверять `if (a == null) ...`.

### 2.2. `instanceof` vs `getClass()` — две школы

```java
// School 1: instanceof — Pugh, modern style
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Point p)) return false;
    return x == p.x && y == p.y;
}

// School 2: getClass() — Bloch (Effective Java 1st ed.)
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;
    Point p = (Point) o;
    return x == p.x && y == p.y;
}
```

Разница проявляется при наследовании:

```java
class Point { int x, y; }
class ColorPoint extends Point { Color color; }
```

С `instanceof`: `ColorPoint.equals(Point)` возможен, но если ColorPoint compares color → нарушение симметрии (red(1,2).equals(plain(1,2)) с одной стороны может быть true, с обратной — false).

С `getClass()`: разные классы — никогда не equal. Симметрия гарантирована.

**Resolution**: Records (см. §10) делают эту проблему moot — они **final** by design, наследование запрещено, проблемы нет.

### 2.3. `@Override` обязателен

```java
public boolean equals(MyType o) { ... }    // overload! не override!
```

Без `@Override` это **новый** метод (overload по типу), не override of `Object.equals(Object)`. `HashMap` использует `equals(Object)` — твой `equals(MyType)` не сработает. Всегда ставь `@Override` — компилятор поймает overload как ошибку.

---

## 3. Контракт `hashCode`

1. **Consistent**: возвращает одно значение при неизменности объекта (в рамках одного запуска JVM).
2. **equal → equal hash**: если `x.equals(y)`, то **обязательно** `x.hashCode() == y.hashCode()`.
3. **Distinct → разные** (желательно, не обязательно): для качества `HashMap`.

Главное правило — **rule 2**: equal objects must have equal hashCodes. Обратное не требуется (collisions OK).

### 3.1. Канонические шаблоны

```java
// 1) Через Objects.hash — удобно, медленновато (Object[] аллокация)
@Override public int hashCode() {
    return Objects.hash(id, email, name);
}

// 2) Bloch-формула — быстрее, для hot path
@Override public int hashCode() {
    int result = Integer.hashCode(id);   // primitive: используй static hashCode
    result = 31 * result + Objects.hashCode(email);
    result = 31 * result + Objects.hashCode(name);
    return result;
}
```

Почему `31`:
- Простое число (помогает в hash distribution);
- `31 * x = (x << 5) - x` — JIT может скомпилировать в `shl + sub` без `imul`. Микро-оптимизация наследие 90-х, но традиция.

### 3.2. Главные ошибки

- **`hashCode` зависит от mutable field**, объект кладётся в `HashSet`, mutates → новый hash → bucket поменялся → объект не найти, leak.
- **`equals` использует поля A, hashCode — поля B** → нарушение rule 2 → `HashSet badly broken`.
- **`hashCode()` всегда возвращает 0** — формально корректно (consistent + equal hash), но HashMap деградирует к O(n).
- **`equals(Object)` обозначен как `equals(MyType)`** — overload, не override.

---

## 4. Identity hashCode

`System.identityHashCode(o)` возвращает hash, как если бы `Object.hashCode()` не был переопределён. Использует адрес-подобный механизм через JVM (но не реальный адрес — JVM может перемещать объекты при GC).

```java
String s = "foo";
s.hashCode();                       // hash content
System.identityHashCode(s);          // identity, ignoring override
```

Использования:
- `IdentityHashMap` — key comparison через `==`, не `equals`;
- Debugging — отличить одинаковые по content объекты;
- JIT internal — кэшируется в mark word объекта.

### 4.1. Тонкость: mark word

HotSpot кэширует identity-hash в **mark word** объекта (биты в header) — поэтому повторные вызовы быстрые. После первого вызова `hashCode()` (если не переопределён) JVM:
1. Запоминает hash в нескольких битах header'а;
2. Объект **перестаёт быть biasable** для biased locking (см. [`modules/concurrency/theory/LOCKS.md`](../../concurrency/theory/LOCKS.md)).

Это малозаметно, но в высоконагруженных приложениях с heavy locking может влиять.

> Biased locking deprecated с Java 15, удалён в JDK 18+. Этот аспект уже исторический.

---

## 5. `Comparable<T>` vs `Comparator<T>`

Два разных интерфейса для сравнения с упорядочением:

| | Comparable<T> | Comparator<T> |
|---|---|---|
| Где определён | Внутри типа T | Внешний объект |
| Метод | `int compareTo(T other)` | `int compare(T a, T b)` |
| Сколько на тип | Один (natural ordering) | Любое число |
| Use case | `Integer`, `String`, `LocalDate` (есть «правильный» порядок) | Сортировка по любому критерию |

### 5.1. Контракт `compareTo`

1. **Anti-symmetric**: `sgn(x.compareTo(y)) == -sgn(y.compareTo(x))`.
2. **Transitive**: если `x.compareTo(y) > 0 && y.compareTo(z) > 0` — то `x.compareTo(z) > 0`.
3. **Consistent с equals (рекомендация)**: `x.compareTo(y) == 0` ↔ `x.equals(y)`.

Rule 3 — **рекомендация**, не строгое требование. Класс может «декларативно» нарушить — например, `BigDecimal`.

### 5.2. TreeMap pitfall с BigDecimal

`TreeMap` использует **`compareTo`**, не `equals`. Если `compareTo == 0` — TreeMap считает их одним ключом → перезапишет:

```java
TreeMap<BigDecimal, String> m = new TreeMap<>();
m.put(new BigDecimal("1.0"), "a");
m.put(new BigDecimal("1.00"), "b");   // compareTo == 0 → перезапишет "a"
m.size();   // 1

HashMap<BigDecimal, String> h = new HashMap<>();
h.put(new BigDecimal("1.0"), "a");
h.put(new BigDecimal("1.00"), "b");   // equals == false → две записи
h.size();   // 2
```

Почему: `BigDecimal.equals` сравнивает scale (1.0 — scale 1, 1.00 — scale 2 — разные), а `compareTo` сравнивает значение (одинаковое). `SortedMap` контракт **явно** разрешает inconsistency с equals — он опирается только на ordering, не на equality.

Решения для BigDecimal:
- Использовать `HashMap` если нужно equals-семантику;
- Нормализовать через `stripTrailingZeros` перед put;
- Использовать custom Comparator.

Это **классический собеседный вопрос**: «У меня TreeMap<BigDecimal, ...>, я кладу '1.0' и '1.00' — что произойдёт?»

---

## 6. Modern Comparator API (Java 8+)

До Java 8 писать сравнения было больно:
```java
Comparator<User> byName = new Comparator<User>() {
    public int compare(User a, User b) {
        return a.getName().compareTo(b.getName());
    }
};
```

С Java 8:
```java
Comparator<User> byName = Comparator.comparing(User::getName);
Comparator<User> byNameAge = byName.thenComparingInt(User::getAge);
Comparator<User> reversed = byName.reversed();
Comparator<User> nullsFirst = Comparator.nullsFirst(byName);
```

Доступные factory methods:
- `Comparator.naturalOrder()` — для Comparable типов;
- `Comparator.reverseOrder()`;
- `Comparator.comparing(keyExtractor)`;
- `Comparator.comparingInt/Long/Double` — primitive versions (без boxing);
- `cmp.thenComparing(...)` — secondary order;
- `cmp.reversed()`;
- `Comparator.nullsFirst(cmp)`, `nullsLast(cmp)` — обработка null.

```java
List<User> users = ...;
users.sort(Comparator
    .comparing(User::getCountry)
    .thenComparing(User::getCity)
    .thenComparingInt(User::getAge).reversed());
```

Это **читабельно**, нет boxing на age (`comparingInt`), nullsafe если nullsFirst добавлен.

---

## 7. Equals/HashCode в иерархии

Главная боль наследования + equals:

```java
class Point {
    int x, y;
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point p)) return false;
        return x == p.x && y == p.y;
    }
}

class ColorPoint extends Point {
    Color color;
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColorPoint p)) return false;
        return x == p.x && y == p.y && color.equals(p.color);
    }
}

Point a = new Point(1, 2);
ColorPoint b = new ColorPoint(1, 2, RED);
a.equals(b);   // true (Point.equals: checks x,y) — но ColorPoint.equals(a) = false
b.equals(a);   // false — symmetry BROKEN
```

Решения:

### 7.1. `getClass() == other.getClass()` (strict)

```java
if (o == null || getClass() != o.getClass()) return false;
```

Не позволяет Point-equals-ColorPoint, но **симметрично**. Bloch рекомендовал в первой редакции *Effective Java*.

### 7.2. Sealed hierarchies (Java 17+)

```java
public sealed class Shape permits Circle, Square, Triangle {}
```

Author явно перечисляет subclasses. Компилятор может проверить exhaustive equals (через pattern matching switch). Подробнее — [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md).

### 7.3. Composition over inheritance

```java
class ColorPoint {
    private final Point point;       // composition!
    private final Color color;
    // ... own equals based on point + color, no inheritance issue
}
```

Часто лучший выбор для domain types.

### 7.4. Records — выход

Records (см. §10) **final**, не наследуются, equals автоматический. Проблема исчезает архитектурно.

---

## 8. Generic equals — Bloch's advice

```java
public boolean equals(Object o) {     // НЕ <T>, type — Object
    ...
}
```

Не используй generics в equals, потому что Object всё равно стирается. Generic equals в bytecode виден как `equals(Object)` через bridge method.

---

## 9. Performance considerations

### 9.1. `Objects.hash` vs Bloch formula

```java
// Objects.hash — Object[] allocation на каждый вызов
return Objects.hash(field1, field2, field3);   // allocate Object[3], box primitives

// Bloch — inline, no allocation
int result = Integer.hashCode(field1);
result = 31 * result + Integer.hashCode(field2);
result = 31 * result + Objects.hashCode(field3);
return result;
```

Для hot path (часто-вызываемые equals/hashCode на ключах HashMap) — Bloch формула. Иначе — `Objects.hash` for readability.

### 9.2. `String.hashCode` cache

`String` кэширует hashCode в поле `hash` (см. [`STRING_INTERNALS.md`](STRING_INTERNALS.md)). Повторный вызов — almost free. Поэтому `HashMap<String, ?>` обычно perform-friendly.

### 9.3. HashMap collision behavior

При плохой hash-функции `HashMap` деградирует:
- До Java 8: linked list в bucket → O(n) lookup при collision;
- Java 8+: после 8 коллизий в bucket bucket превращается в **tree-bin** (red-black tree). Lookup → O(log n). Требует ключи implementing `Comparable` для tree ordering, иначе fallback на linked list.

`HashMap.TREEIFY_THRESHOLD = 8` — после 8 entries в bucket — treeify. `UNTREEIFY_THRESHOLD = 6` — обратно в linked list при resize.

### 9.4. `equals` short-circuit

```java
public boolean equals(Object o) {
    if (this == o) return true;      // fast identity check
    if (!(o instanceof MyType m)) return false;
    return field1 == m.field1 &&     // primitive fields first (cheap)
           field2 == m.field2 &&
           Objects.equals(longString, m.longString);   // expensive last
}
```

Порядок проверок имеет значение — `&&` short-circuit, фильтруй cheap-полями first.

---

## 10. Records — революция в equals/hashCode

С Java 16 ([JEP 395](https://openjdk.org/jeps/395)):

```java
public record User(long id, String email, String name) {}
```

Компилятор генерирует:
- Canonical constructor;
- Accessors `id()`, `email()`, `name()` (без `get`-префикса!);
- `equals` — сравнивает все components, генерируется через `invokedynamic ObjectMethods.bootstrap`;
- `hashCode` — тот же bootstrap;
- `toString` — `User[id=1, email=..., name=...]`.

```java
User a = new User(1, "a@example.com", "Alice");
User b = new User(1, "a@example.com", "Alice");
a.equals(b);   // true, без написания кода
a.hashCode() == b.hashCode();   // true
```

`record` — **final** by design, нельзя расширить. Все поля **final**. Можно реализовать interfaces, добавить static и instance методы:

```java
public record Money(BigDecimal amount, Currency currency) implements Comparable<Money> {
    // Compact constructor для validation:
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.signum() < 0) throw new IllegalArgumentException("negative");
    }
    
    @Override
    public int compareTo(Money other) {
        if (!currency.equals(other.currency)) throw new IllegalArgumentException();
        return amount.compareTo(other.amount);
    }
    
    public static Money zero(Currency c) { return new Money(BigDecimal.ZERO, c); }
}
```

Records закрывают **80% use cases для equals/hashCode** в современном Java коде. Если не нужно наследование — используй record.

---

## 11. Что обязательно знать на собесе

1. **Контракт `equals`**: 5 правил (reflexive, symmetric, transitive, consistent, null-safe).
2. **Контракт `hashCode`**: consistency + `equal → equal hash`.
3. **`@Override` обязателен** — иначе случайный overload.
4. **`instanceof` vs `getClass()`** — две школы, обе валидны.
5. **`Comparable` vs `Comparator`** — natural vs external ordering.
6. **TreeMap pitfall с BigDecimal** — compareTo vs equals inconsistency.
7. **Modern Comparator API** — `comparing`, `thenComparing`, `nullsFirst`, `reversed`.
8. **Records auto-equals** — главное преимущество records.
9. **Bloch formula vs `Objects.hash`** — performance trade-off.
10. **HashMap collision → tree-bin** (8+ collisions, requires Comparable keys).

---

## Related

- Records, sealed, pattern matching → [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md)
- Identity hash, mark word, biased locking → [`modules/concurrency/theory/LOCKS.md`](../../concurrency/theory/LOCKS.md)
- Generics и bridge methods (equals over generic class) → [`GENERICS_ERASURE.md`](GENERICS_ERASURE.md)
- HashMap internals (treeify) — за рамками java-core, см. JDK source

### Внешние ресурсы

- **Joshua Bloch, *Effective Java*** — Items 10-14 про equals/hashCode/compareTo. Главный источник.
- **JLS §3.10.5 (String equality)** — <https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html>
- **JEP 395 (Records)** — <https://openjdk.org/jeps/395>
- **Brian Goetz, *Towards better serialization*** — где обсуждаются records для serialization
- **Inside Java — Records**: <https://inside.java/tag/records/>
