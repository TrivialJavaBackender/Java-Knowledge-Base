# Stream API и функциональное программирование в Java

## Функциональные интерфейсы

Java 8 ввёл `@FunctionalInterface` — интерфейс с ровно одним абстрактным методом. Все они из `java.util.function`:

| Интерфейс | Сигнатура | Применение |
|-----------|-----------|-----------|
| `Predicate<T>` | `T → boolean` | Фильтрация, проверка условий |
| `Function<T,R>` | `T → R` | Преобразование |
| `Consumer<T>` | `T → void` | Побочные эффекты (печать, запись) |
| `Supplier<T>` | `() → T` | Ленивое создание объекта |
| `BiFunction<T,U,R>` | `(T,U) → R` | Функция двух аргументов |
| `UnaryOperator<T>` | `T → T` | Function<T,T> (модификация) |
| `BinaryOperator<T>` | `(T,T) → T` | Операция над двумя T |

```java
Predicate<String> isLong = s -> s.length() > 10;
Function<String, Integer> length = String::length;   // method reference
Consumer<String> printer = System.out::println;
Supplier<List<String>> listFactory = ArrayList::new;

// Композиция
Predicate<String> isLongAndNotEmpty = isLong.and(s -> !s.isEmpty());
Function<String, String> upperAndTrim = ((Function<String,String>) String::trim).andThen(String::toUpperCase);
```

---

## Lambda и Method References

```java
// Lambda
list.sort((a, b) -> a.compareTo(b));

// Method reference — 4 вида
String::toUpperCase          // instance method (unbound): obj -> obj.toUpperCase()
System.out::println          // instance method (bound): s -> System.out.println(s)
Integer::parseInt            // static method: s -> Integer.parseInt(s)
ArrayList::new               // constructor: () -> new ArrayList<>()
```

---

## Stream API — основы

Stream — ленивый конвейер операций над последовательностью элементов. Не хранит данные.

```
Source → intermediate operations (lazy) → terminal operation (eager, запускает pipeline)
```

### Создание

```java
Stream.of("a", "b", "c")
list.stream()
list.parallelStream()
Arrays.stream(array)
Stream.iterate(0, n -> n + 1)        // бесконечный
Stream.generate(Math::random)         // бесконечный
IntStream.range(0, 10)               // 0..9
IntStream.rangeClosed(1, 10)         // 1..10
Files.lines(Path.of("file.txt"))
```

### Промежуточные операции (Intermediate — lazy)

```java
stream.filter(s -> s.length() > 3)         // Predicate
stream.map(String::toUpperCase)             // Function
stream.flatMap(List::stream)                // T → Stream<R>, разворачивает вложенные
stream.distinct()                           // уникальные (через equals)
stream.sorted()                             // естественный порядок
stream.sorted(Comparator.reverseOrder())
stream.limit(10)                            // первые N
stream.skip(5)                              // пропустить N
stream.peek(System.out::println)            // для дебага — не используй в prod
stream.mapToInt(String::length)             // → IntStream (нет boxing)
```

### Терминальные операции (Terminal — запускают pipeline)

```java
// Сбор
List<String> list = stream.collect(Collectors.toList());
List<String> list = stream.toList();                    // Java 16+, unmodifiable
Set<String> set  = stream.collect(Collectors.toSet());
String joined    = stream.collect(Collectors.joining(", ", "[", "]"));
Map<Integer, List<String>> grouped = stream.collect(Collectors.groupingBy(String::length));
Map<Boolean, List<String>> partitioned = stream.collect(Collectors.partitioningBy(s -> s.length() > 3));

// Агрегация
long count = stream.count();
Optional<String> first = stream.findFirst();
Optional<String> any   = stream.findAny();          // параллельные стримы — быстрее
boolean all  = stream.allMatch(s -> s.length() > 0);
boolean any  = stream.anyMatch(String::isEmpty);
boolean none = stream.noneMatch(String::isEmpty);
Optional<String> max = stream.max(Comparator.naturalOrder());
Optional<String> min = stream.min(Comparator.naturalOrder());

// Reduce
Optional<Integer> sum = IntStream.rangeClosed(1, 100).reduce(Integer::sum);
int sum2 = IntStream.rangeClosed(1, 100).reduce(0, Integer::sum);

// forEach
stream.forEach(System.out::println);   // порядок не гарантирован у parallel
stream.forEachOrdered(System.out::println); // порядок гарантирован
```

---

## Collectors — продвинутые

```java
// Downstream collector
Map<Integer, Long> countByLength =
    stream.collect(Collectors.groupingBy(String::length, Collectors.counting()));

Map<Integer, String> joinByLength =
    stream.collect(Collectors.groupingBy(String::length, Collectors.joining(", ")));

// toMap
Map<String, Integer> lengthMap =
    stream.collect(Collectors.toMap(Function.identity(), String::length));
// Осторожно: дубликаты ключей → IllegalStateException
Map<String, Integer> safeMap =
    stream.collect(Collectors.toMap(s -> s, String::length, (a, b) -> a)); // merge function

// teeing (Java 12) — два коллектора + merger
Map.Entry<Long, Long> minMax = stream.collect(
    Collectors.teeing(
        Collectors.minBy(Comparator.naturalOrder()),
        Collectors.maxBy(Comparator.naturalOrder()),
        (min, max) -> Map.entry(min.orElseThrow(), max.orElseThrow())
    )
);
```

---

## Optional

Контейнер значения, которое может отсутствовать. Альтернатива `null`.

```java
Optional<String> opt = Optional.of("hello");
Optional<String> empty = Optional.empty();
Optional<String> nullable = Optional.ofNullable(maybeNull);

// Получение
opt.get()                             // NoSuchElementException если пустой
opt.orElse("default")                 // значение по умолчанию
opt.orElseGet(() -> compute())        // ленивое — Supplier вызывается только при пустом
opt.orElseThrow()                     // NoSuchElementException, Java 10+
opt.orElseThrow(NotFoundException::new)

// Трансформация
opt.map(String::toUpperCase)          // Optional<String>
opt.flatMap(s -> findUser(s))         // если map возвращает Optional
opt.filter(s -> s.length() > 3)
opt.ifPresent(System.out::println)
opt.ifPresentOrElse(System.out::println, () -> System.out.println("empty"));

// Антипаттерн:
if (opt.isPresent()) { opt.get(); }  // лучше orElse/map
```

**Когда не использовать Optional:**
- В полях класса (увеличивает serialization complexity)
- Как параметр метода (используй overloading или null)
- В коллекциях (`List<Optional<T>>` → уродливо)

---

## Параллельные стримы

```java
list.parallelStream()                           // параллельный
stream.parallel()                               // переключить в параллельный
stream.sequential()                             // обратно

// Используют ForkJoinPool.commonPool() — общий для всего приложения
// Опасно: если задача блокирует → голодание других задач

// Пример когда имеет смысл: CPU-интенсивные операции, большие данные
long sum = LongStream.rangeClosed(1, 100_000_000L)
    .parallel()
    .sum();
```

**Когда НЕ использовать parallel:**
- IO операции (блокируют common pool)
- Маленькие коллекции (overhead на разбиение > выигрыш)
- Ordered операции над LinkedList (сложное разбиение)
- При наличии общего состояния (race condition)

**thread-safe reduce/collect:** при параллельном стриме `reduce` и `collect` безопасны если combiner/collector статeless.

---

## Функциональные принципы

### Чистые функции (Pure Functions)

Нет побочных эффектов, результат зависит только от аргументов:
```java
// Чистая
int add(int a, int b) { return a + b; }

// Нечистая: читает внешнее состояние
int addWithTax(int amount) { return amount + TAX_RATE; } // TAX_RATE может измениться
```

### Иммутабельность

```java
// Record (Java 16+) — автоматически иммутабельный
record Point(int x, int y) {}

// Unmodifiable collections
List<String> immutable = List.of("a", "b", "c");
List<String> copy = Collections.unmodifiableList(new ArrayList<>(mutable));
```

### Функциональная композиция

```java
Function<Integer, Integer> doubler = x -> x * 2;
Function<Integer, Integer> adder = x -> x + 10;

Function<Integer, Integer> doubleThenAdd = doubler.andThen(adder); // (x*2)+10
Function<Integer, Integer> addThenDouble = doubler.compose(adder);  // (x+10)*2
```

---

## Практика: типичные паттерны на собеседовании

```java
// Топ-3 самых длинных строк
List<String> top3 = words.stream()
    .sorted(Comparator.comparingInt(String::length).reversed())
    .limit(3)
    .collect(Collectors.toList());

// Частота слов
Map<String, Long> freq = words.stream()
    .collect(Collectors.groupingBy(Function.identity(), Collectors.counting()));

// Плоский список из вложенного
List<String> flat = nested.stream()
    .flatMap(List::stream)
    .collect(Collectors.toList());

// Есть ли дубликаты
boolean hasDups = list.stream().anyMatch(new HashSet<>()::add).noneMatch(b -> b); // NO
boolean hasDups2 = list.size() != new HashSet<>(list).size(); // проще

// Сумма int полей объектов
int total = orders.stream()
    .mapToInt(Order::amount)
    .sum();

// Объединить Optional цепочкой
Optional<User> user = findById(id)
    .or(() -> findByEmail(email))   // Java 9+
    .filter(User::isActive);
```

---

## Источники

**Официальная документация:**
- [`java.util.stream` package summary (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/package-summary.html) — characteristics, lazy evaluation, parallel.
- [`java.util.function` package summary](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/function/package-summary.html) — все functional interfaces.
- [`Optional` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Optional.html) — официальные anti-patterns и intended use.

**JEPs (эволюция функциональных API):**
- [JEP 126: Lambda Expressions & Virtual Extension Methods (JDK 8)](https://openjdk.org/jeps/126)
- [JEP 269: Convenience Factory Methods for Collections (JDK 9)](https://openjdk.org/jeps/269) — `List.of`, `Map.of`.
- [JEP 461: Stream Gatherers (JDK 22 Preview / JDK 24 Final)](https://openjdk.org/jeps/461) — кастомные intermediate операции.

**Книги:**
- *Modern Java in Action* (Raoul-Gabriel Urma, Mario Fusco, Alan Mycroft, Manning 2018) — основной справочник по Stream/Optional/Collectors.
- *Effective Java*, 3rd ed. (Joshua Bloch, 2018) — Items 42–48 (lambdas and streams).
- *Java by Comparison* (Simon Harrer, Jörg Lenhard, Linus Dietz, Pragmatic 2018) — рефакторинг к функциональному стилю.

**Talks / posts:**
- [Brian Goetz — «Stream API: Beyond the Basics» (Devoxx)](https://www.youtube.com/watch?v=1OpAgZvYXLQ) — внутренности spliterator'ов и parallel streams.
- [Stuart Marks — «Diving into the Optional class»](https://stuartmarks.wordpress.com/2016/09/27/vjug24-session-on-optional/) — лучший разбор «когда использовать, когда нет».
- [Maurice Naftalin — «Java Streams Tutorial»](https://www.oracle.com/technical-resources/articles/java/architect-streams-pt2.html)
