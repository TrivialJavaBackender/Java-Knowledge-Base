# Потокобезопасные коллекции: что выбрать и почему

> **Какую проблему решает.** Обычная `HashMap` под конкуренцией не просто «иногда ошибается» — она
> молча теряет данные и способна зациклиться. Этот файл — про то, чем её заменить, и, что важнее,
> про то, как выбрать замену по задаче, а не по названию класса.
> **Кому это надо.** Всем, кто держит общее состояние в коллекции: кэши, реестры, очереди задач,
> списки слушателей.
> **Когда НЕ надо.** Если коллекция принадлежит одному потоку или неизменяема — берите обычную:
> потокобезопасная стоит дороже (см. §4).

Гарантии видимости — в [`MEMORY_MODEL.md`](MEMORY_MODEL.md); механика блокировок внутри —
в [`JUC_INTERNALS.md`](JUC_INTERNALS.md). Примеры прогнаны на Temurin 21.0.9.

---

## 1. Что происходит без потокобезопасной коллекции

```java
// Chm.java — четыре потока кладут по 25 000 РАЗНЫХ ключей в обычную HashMap
Map<Integer,Integer> plain = new HashMap<>();
// ...
System.out.println("положили 100 000, в HashMap оказалось: " + plain.size());
```

```
положили 100 000, в HashMap оказалось: 64067
```

Треть записей исчезла. Ключи не пересекались — «потерянного обновления» в обычном смысле здесь нет.
Испортилась сама структура: одновременные вставки затирают ссылки в бинах и обновления счётчика
размера. На старых версиях Java повреждение при расширении таблицы могло привести к бесконечному
циклу в `get()` — потоку, который зависал на 100% процессора и не выходил никогда.

Вывод: обычная коллекция под конкуренцией даёт не «неточный результат», а **неопределённое
поведение**.

---

## 2. Четыре стратегии сделать коллекцию безопасной

| Стратегия | Реализации | Цена | Когда |
|---|---|---|---|
| Обёртка с одним локом | `Collections.synchronizedXxx` | всё сериализуется | нужна семантика конкретной коллекции (`LinkedHashMap`) |
| Тонкая блокировка | `ConcurrentHashMap` (лок на бин) | почти нет | основной выбор для карт |
| Копирование при записи | `CopyOnWriteArrayList/Set` | запись O(n) | читают часто, пишут почти никогда |
| Без блокировок (CAS) | `ConcurrentLinkedQueue`, `ConcurrentSkipListMap` | деградирует при высокой конкуренции ([`ATOMIC_CAS.md §2`](ATOMIC_CAS.md)) | очереди и отсортированные карты |

Ещё одна стратегия, которую часто забывают: **не делать коллекцию общей**. Локальная копия,
`ThreadLocal`, неизменяемый снимок — это дешевле любой из четырёх.

---

## 3. `ConcurrentHashMap`

### Устройство (Java 8+)

```
Node[] table
 ├─ бин пуст      → вставка через CAS, без блокировки вообще
 ├─ бин занят     → synchronized (первый узел бина) — блокируется ТОЛЬКО этот бин
 └─ длинный бин   → красно-чёрное дерево вместо списка
```

В Java 7 карта делилась на 16 сегментов, каждый со своим локом, — параллельных писателей было не
больше 16. С Java 8 сегментов нет: конкуренция ограничена числом бинов, то есть практически не
ограничена.

**Порог превращения в дерево — не один, а два.** Списку в бине мало вырасти до 8 узлов:

```java
// ConcurrentHashMap.java:545, 560, 2665
static final int TREEIFY_THRESHOLD = 8;
static final int MIN_TREEIFY_CAPACITY = 64;

private final void treeifyBin(Node<K,V>[] tab, int index) {
    if ((n = tab.length) < MIN_TREEIFY_CAPACITY)
        tryPresize(n << 1);          // ← таблица мала: расширяем её, а не строим дерево
    else …                            // и только теперь дерево
}
```

Логика: короткая таблица даёт длинные бины просто из-за нехватки места — правильнее увеличить
таблицу. Дерево строится, только когда таблица уже не меньше 64 и бин всё равно длинный
(значит, дело в плохих хеш-кодах). Обратно в список бин превращается при падении до 6
(`UNTREEIFY_THRESHOLD`) — зазор между 8 и 6 не даёт структуре «дребезжать».

### Составные операции — главное, ради чего берут `ConcurrentHashMap`

Потокобезопасность отдельных методов не спасает от логической гонки
([`MEMORY_MODEL.md §7`](MEMORY_MODEL.md)):

```java
// ❌ Два атомарных вызова не дают атомарности пары
if (!map.containsKey(key)) map.put(key, value);

Integer n = map.get(word);
map.put(word, n == null ? 1 : n + 1);          // потерянные обновления

// ✅ Одна атомарная операция
map.putIfAbsent(key, value);
map.merge(word, 1, Integer::sum);
map.compute(key, (k, v) -> v == null ? init() : update(v));
map.computeIfAbsent(key, this::load);
```

### `computeIfAbsent`: что гарантировано и что запрещено

Проверим гарантию «функция вызовется один раз» — 16 потоков одновременно за одним ключом:

```
потоков=16, вызовов функции загрузки=1
```

Гарантия работает: бин держится под `synchronized`, остальные ждут. Распространённое утверждение,
будто в Java 8 функция могла вызваться дважды, неверно — атомарность была с самого начала;
в JDK 9 чинили другое (лишнюю блокировку бина, когда ключ уже присутствует).

Отсюда же два практических ограничения:

**1. Долгая функция блокирует бин.** Пока идёт загрузка, все, кто попал в тот же бин, стоят.
Для «загрузить из БД на 200 мс» это неприемлемо — нужен либо специализированный кэш (Caffeine),
либо схема с `CompletableFuture` вместо значения.

**2. Рекурсивное обновление той же карты запрещено:**

```java
map.computeIfAbsent("a", k -> map.computeIfAbsent("a", k2 -> "v"));
//  → IllegalStateException: Recursive update
```

Причём срабатывает это не только на том же ключе, но и на **любом ключе из того же бина**:

```
тот же ключ:                             IllegalStateException: Recursive update
другой ключ, но тот же бин (коллизия):   IllegalStateException: Recursive update
```

Проверка внутри узнаёт `ReservationNode` — заглушку, которую `computeIfAbsent` кладёт в бин на время
вычисления (`ConcurrentHashMap.java:1063`). Если бы её не было, поток заблокировал бы сам себя.

### Почему `null` запрещён

```java
map.put("k", null);   // NullPointerException
map.get("отсутствующий");   // null
```

В обычной `HashMap` неоднозначность «нет ключа» и «есть ключ со значением `null`» разрешается через
`containsKey()`. В конкурентной карте это не работает: между `get()` и `containsKey()` карта может
измениться, и достоверного ответа не существует в принципе. Дуг Ли решил проблему, запретив `null`.

Практический вывод: если значение может отсутствовать — кладите `Optional` или объект-заглушку.

### `size()` приблизителен

Счётчик размера распределён по ячейкам, как в `LongAdder` ([`ATOMIC_CAS.md §6`](ATOMIC_CAS.md)):
`size()` суммирует их без общей блокировки, поэтому при активных изменениях результат — оценка.
`mappingCount()` возвращает то же самое как `long` (размер может превысить `int`).

Для проверки «пусто ли» используйте `isEmpty()` — он дешевле.

---

## 4. Когда потокобезопасная коллекция — неправильный ответ

Три случая, в которых `ConcurrentHashMap` берут зря:

1. **Коллекция читается конкурентно, но не меняется после инициализации.** Заполните обычную
   `HashMap` и опубликуйте её через `final`-поле либо оберните в `Map.copyOf()` — синхронизация не
   нужна вовсе ([`MEMORY_MODEL.md §6.3`](MEMORY_MODEL.md)).
2. **Нужна атомарность нескольких операций сразу** — например, «переложить из одной карты в другую».
   Ни одна конкурентная коллекция этого не даёт; нужен лок вокруг обеих
   ([`LOCKS.md`](LOCKS.md)).
3. **Конкуренции почти нет, а критическая секция короткая.** Замер из
   [`LOCKS.md §4`](LOCKS.md) показал: при коротких операциях обычный `synchronized` может обойти
   более «продвинутые» механизмы. Не усложняйте, пока не измерили.

---

## 5. `BlockingQueue`: выбираем по задаче, а не по классу

Блокирующая очередь — не просто потокобезопасный список. Её ценность в двух вещах: **потребитель
ждёт, не тратя процессор**, а **производитель тормозится, когда очередь полна** (обратное давление).

```java
// Три группы методов — на все случаи
//              бросает исключение   возвращает признак   блокирует       блокирует с таймаутом
// добавить:    add(e)               offer(e)             put(e)          offer(e, t, unit)
// забрать:     remove()             poll()               take()          poll(t, unit)
// посмотреть:  element()            peek()               —               —
```

Выбор по задаче:

| Что нужно | Реализация | Почему |
|---|---|---|
| Буфер фиксированного размера, предсказуемая память | `ArrayBlockingQueue(n)` | кольцевой массив, один лок, ёмкость обязательна |
| То же, но максимум пропускной способности | `LinkedBlockingQueue(n)` | **два лока** (`putLock` и `takeLock`) — класть и забирать можно одновременно |
| Передача из рук в руки, без накопления | `SynchronousQueue` | ёмкость 0: `put` ждёт `take`. Используется в `newCachedThreadPool` |
| Задачи разной важности | `PriorityBlockingQueue` | куча; **не ограничена** — обратного давления нет |
| «Выполнить не раньше времени T» | `DelayQueue` | `take()` отдаёт элемент, только когда его задержка истекла |
| Нужно узнать, забрал ли потребитель | `LinkedTransferQueue` | `transfer()` ждёт получателя, `tryTransfer()` — нет |

Ключевое различие первых двух — не структура, а число локов: `ArrayBlockingQueue` держит один
`ReentrantLock` на всё (`ArrayBlockingQueue.java:121`), `LinkedBlockingQueue` — два
(`LinkedBlockingQueue.java:156, 163`), поэтому при высокой нагрузке она обычно быстрее. Взамен —
непредсказуемая память: **по умолчанию её ёмкость `Integer.MAX_VALUE`**, и именно это делает
`Executors.newFixedThreadPool` опасным ([`EXECUTORS_FUTURES.md §5`](EXECUTORS_FUTURES.md)).

**Правило.** В продакшене очередь всегда ограниченная. Неограниченная очередь — это не «нет
ограничения», а «ограничение в размер кучи, и узнаете вы о нём в момент OOM».

---

## 6. `CopyOnWriteArrayList` / `CopyOnWriteArraySet`

Каждая мутация создаёт **полную копию** массива; читатели работают со снимком.

```
Писатель:  [A,B,C] → создаёт [A,B,C,D] → volatile-ссылка переключается
Читатель:  продолжает читать [A,B,C] — итератор не сломается и CME не бросит
```

- Чтение — без блокировок, O(1), и **никогда** не бросит `ConcurrentModificationException`.
- Запись — O(n) плюс лок; при частых записях это катастрофа.
- Итератор работает со снимком: изменения, сделанные после его создания, не видны, а `remove()`
  у итератора бросает `UnsupportedOperationException`.

Канонический сценарий — список слушателей: их читают на каждое событие, а меняют раз в жизни.

```java
List<EventListener> listeners = new CopyOnWriteArrayList<>();
for (EventListener l : listeners) {      // безопасно даже если кто-то подписывается прямо сейчас
    l.onEvent(event);
}
```

Признак неправильного применения: размер больше сотен элементов или записи чаще, чем раз в секунду.

---

## 7. `ConcurrentSkipListMap` / `ConcurrentSkipListSet`

Отсортированная конкурентная карта — конкурентный аналог `TreeMap`. Реализована списком с пропусками
(skip list) на CAS, без блокировок.

```
Уровень 2:  HEAD ─────────── 15 ─────────── 50 ─────── NIL
Уровень 1:  HEAD ──── 7 ──── 15 ──── 25 ─── 50 ─── 72 ─ NIL
Уровень 0:  HEAD ─ 3 ─ 7 ─ 12 ─ 15 ─ 25 ─ 31 ─ 50 ─ 65 ─ 72 ─ NIL
```

Берут её ровно тогда, когда нужен **порядок или диапазонные запросы**:

```java
ConcurrentSkipListMap<Long, Order> byTime = new ConcurrentSkipListMap<>();
byTime.subMap(now - 3_600_000, now);     // все заказы за последний час
byTime.headMap(deadline);                 // всё, что просрочено
byTime.firstEntry();                      // самое старое
```

За порядок платим: O(log n) вместо O(1) и заметно больший расход памяти на узлы. Если порядок
не нужен — `ConcurrentHashMap`.

---

## 8. `ConcurrentLinkedQueue`

Неблокирующая неограниченная очередь (алгоритм Майкла — Скотта). Отличие от `BlockingQueue`
принципиальное: **ждать она не умеет**, `poll()` на пустой очереди сразу вернёт `null`.

```java
// ❌ Так делать нельзя: активное ожидание сжигает ядро
while (true) {
    Item item = queue.poll();
    if (item != null) process(item);
}

// ✅ Если потребителю нужно ждать — это работа для BlockingQueue
Item item = blockingQueue.take();
```

Ещё одна особенность, следующая из отсутствия общего счётчика: **`size()` обходит всю очередь,
то есть O(n)**. Использовать его в цикле или в метриках — верный способ уронить производительность;
для проверки на пустоту есть `isEmpty()`.

---

## 9. `Collections.synchronizedXxx` против конкурентных коллекций

Обёртка добавляет `synchronized (mutex)` в каждый метод — и всё:

```java
public V get(Object key)        { synchronized (mutex) { return map.get(key); } }
public V put(K key, V value)    { synchronized (mutex) { return map.put(key, value); } }
```

Две ловушки, обе следуют прямо из этой реализации:

```java
Map<K,V> map = Collections.synchronizedMap(new HashMap<>());

// ❌ Итерация НЕ защищена: каждый вызов под локом, а обход — нет
for (K key : map.keySet()) { … }              // ConcurrentModificationException

// ✅ Нужен внешний лок на весь обход
synchronized (map) { for (K key : map.keySet()) { … } }

// ❌ Составная операция не атомарна по той же причине
if (!map.containsKey(k)) map.put(k, v);
```

| | `Collections.synchronizedXxx` | Конкурентные коллекции |
|---|---|---|
| Гранулярность | один лок на весь объект | бин / узел / без локов |
| Итерация | нужен внешний лок, иначе `ConcurrentModificationException` | безопасна, слабо согласованный итератор |
| Составные операции | не атомарны | атомарны (`putIfAbsent`, `merge`, …) |
| Накладные расходы | минимальные | выше (доп. структуры) |

**Слабо согласованный итератор** — центральное понятие: он не бросает исключений, отражает состояние
на момент создания и может, но не обязан, показать более поздние изменения. Именно этот компромисс
позволяет читать без блокировок.

Обёртка остаётся оправданной ровно в одном случае: когда нужна **семантика конкретной коллекции**,
которой нет среди конкурентных. Классика — LRU на `LinkedHashMap`:

```java
Map<K,V> lru = Collections.synchronizedMap(new LinkedHashMap<>(16, 0.75f, true) {
    protected boolean removeEldestEntry(Map.Entry<K,V> e) { return size() > MAX; }
});
// при обходе всё равно нужен synchronized (lru) { … }
```

---

## 10. Шпаргалка

```
Карта общего назначения                 → ConcurrentHashMap
Нужен порядок / диапазоны               → ConcurrentSkipListMap
Множество                               → ConcurrentHashMap.newKeySet()
Список слушателей, пишем редко          → CopyOnWriteArrayList
Очередь задач, потребитель должен ждать → BlockingQueue (обязательно ограниченная)
   предсказуемая память                 → ArrayBlockingQueue(n)
   максимум пропускной способности      → LinkedBlockingQueue(n)  ← n указывать обязательно
   передача из рук в руки               → SynchronousQueue
   по времени                           → DelayQueue
Очередь, ждать не нужно                 → ConcurrentLinkedQueue (size() = O(n)!)
Нужна семантика LinkedHashMap           → Collections.synchronizedMap + внешний лок на обход
Коллекция не меняется после старта      → обычная HashMap + безопасная публикация
```

---

## 11. Упражнения

- [`Ex06: ConcurrentMapWordCount`](../src/main/kotlin/exercises/Ex06_ConcurrentMapWordCount.kt) —
  `merge`, `CopyOnWriteArrayList`.
- [`Ex07: BlockingQueuePipeline`](../src/main/kotlin/exercises/Ex07_BlockingQueuePipeline.kt) —
  конвейер, «отравленная пилюля».
- [`Ex13: CHM Advanced`](../src/main/kotlin/exercises/Ex13_ConcurrentHashMapAdvanced.kt) —
  `computeIfAbsent`, `merge`, массовые операции.
- [`Ex14: BlockingQueues Deep`](../src/main/kotlin/exercises/Ex14_BlockingQueuesDeep.kt) — все разновидности.
- [`Ex15: SkipList & Sets`](../src/main/kotlin/exercises/Ex15_ConcurrentSkipListAndSets.kt).

---

## Вопросы для самопроверки

1. Четыре потока кладут разные ключи в `HashMap` — почему исчезла треть записей?
2. Что блокирует `ConcurrentHashMap` при записи? Что происходит, если бин пуст?
3. При каких **двух** условиях бин превращается в дерево? Почему одного порога мало?
4. Сколько раз вызовется функция `computeIfAbsent` при 16 конкурентных вызовах с одним ключом?
5. Почему `map.computeIfAbsent("a", k -> map.computeIfAbsent("b", …))` может упасть, даже если
   ключи разные?
6. Почему `ConcurrentHashMap` запрещает `null`? Как это обойти?
7. Почему `size()` у `ConcurrentHashMap` приблизителен, а у `ConcurrentLinkedQueue` — O(n)?
8. Чем `ArrayBlockingQueue` отличается от `LinkedBlockingQueue` по устройству и по последствиям?
9. Почему неограниченная очередь опаснее, чем кажется?
10. Когда `CopyOnWriteArrayList` — плохой выбор?
11. Почему обход `Collections.synchronizedMap` без внешнего лока небезопасен, хотя все методы синхронизированы?
12. Что такое слабо согласованный итератор и что он даёт взамен?

---

## Источники

**Исходники JDK 21:** `ConcurrentHashMap.java` (`TREEIFY_THRESHOLD` — 545, `UNTREEIFY_THRESHOLD` — 552,
`MIN_TREEIFY_CAPACITY` — 560, «Recursive update» — 1063, `treeifyBin` — 2665),
`ArrayBlockingQueue.java` (121–129), `LinkedBlockingQueue.java` (156, 163).

**Официальная документация:**
- [`java.util.concurrent` package summary (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/package-summary.html) — определение слабо согласованного итератора.
- [`ConcurrentHashMap`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html) · [`BlockingQueue`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/BlockingQueue.html) · [`ConcurrentSkipListMap`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentSkipListMap.html)

**Papers:**
- [Pugh (1990) — «Skip Lists: A Probabilistic Alternative to Balanced Trees»](https://15721.courses.cs.cmu.edu/spring2018/papers/08-oltpindexes1/pugh-skiplists-cacm1990.pdf)
- [Michael & Scott (1996) — «Simple, Fast, and Practical Non-Blocking… Concurrent Queue Algorithms»](https://www.cs.rochester.edu/~scott/papers/1996_PODC_queues.pdf)

**OpenJDK:**
- [JDK-8062841: ConcurrentHashMap.computeIfAbsent recursive update](https://bugs.openjdk.org/browse/JDK-8062841)
- [JDK-8161372: computeIfAbsent locks bin when key is present](https://bugs.openjdk.org/browse/JDK-8161372)

**Книги:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 5 (Building Blocks).
