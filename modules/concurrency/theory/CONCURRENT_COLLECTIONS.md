# Concurrent Collections — Полная теория

---

## Обзорная карта

```
                        ┌─────────────────────────────────────┐
                        │       Concurrent Collections        │
                        └──────────────┬──────────────────────┘
           ┌───────────┬───────────────┼──────────────┬────────────────┐
           ▼           ▼               ▼              ▼                ▼
        Maps        Lists           Queues          Sets           Deques
           │           │               │              │                │
  ConcurrentHashMap  CopyOnWrite    Blocking      CopyOnWrite    ConcurrentLinked
  ConcurrentSkipList ArrayList      Non-blocking  ArraySet       LinkedBlocking
  Map/Set                           Priority      SkipListSet    Deque
                                    Delay
                                    Synchronous
                                    Transfer
```

---

## 1. ConcurrentHashMap

### Внутреннее устройство (Java 8+)

```
┌──────────────────────────────────────────────────┐
│  Node[] table  (лениво инициализируется)          │
├────┬────┬────┬────┬────┬────┬────┬────┬─────────┤
│ 0  │ 1  │ 2  │ 3  │ 4  │ 5  │ 6  │... │ n-1     │
└─┬──┴────┴─┬──┴────┴────┴─┬──┴────┴────┴─────────┘
  │         │               │
  ▼         ▼               ▼
 Node     null          TreeBin (>8 элементов)
  │                      /    \
  ▼                   TreeNode TreeNode
 Node                  /  \      \
  │                  TN    TN    TN
  ▼
 null
```

**Эволюция:**
- **Java 7:** Массив сегментов (`Segment[]`), каждый сегмент — mini-HashMap со своим `ReentrantLock`. По умолчанию 16 сегментов → 16 потоков могут писать параллельно.
- **Java 8+:** Сегменты убраны. Блокировка на уровне bucket'а (первый Node). Пустой bucket → CAS. Непустой → `synchronized(firstNode)`. При >8 элементах в bucket → трансформация в красно-чёрное дерево (TreeBin).

**Ключевые свойства:**
- **Null запрещён** — ни key, ни value не могут быть null
- **Weakly consistent iterators** — не бросают CME, отражают состояние на момент создания
- **size()** — приблизительный (использует `baseCount` + `CounterCell[]`, как LongAdder)
- **Default concurrency level** — игнорируется с Java 8, но принимается для совместимости

### API, который надо знать наизусть

```java
// Атомарные compound operations — ЭТО ГЛАВНОЕ
V putIfAbsent(K key, V value)              // put только если key отсутствует
V computeIfAbsent(K key, Function<K,V> f)  // вычислить+put если отсутствует
V computeIfPresent(K key, BiFunction f)    // вычислить+replace если присутствует
V compute(K key, BiFunction f)             // вычислить всегда
V merge(K key, V value, BiFunction f)      // если есть — merge, если нет — put

// Bulk operations (Java 8, parallelismThreshold)
void forEach(long threshold, BiConsumer action)
<U> U reduce(long threshold, BiFunction transformer, BiFunction reducer)
<U> U search(long threshold, BiFunction<K,V,U> searchFunction)
```

### Типичные ошибки

```java
// ❌ НЕАТОМАРНО — race condition!
if (!map.containsKey(key)) {
    map.put(key, value);
}

// ✅ Атомарно
map.putIfAbsent(key, value);

// ❌ НЕАТОМАРНО — check-then-act
Integer count = map.get(word);
if (count == null) map.put(word, 1);
else map.put(word, count + 1);

// ✅ Атомарно
map.merge(word, 1, Integer::sum);
// или
map.compute(word, (k, v) -> v == null ? 1 : v + 1);
```

### computeIfAbsent для кэша/мемоизации

```java
// Thread-safe lazy cache
Map<String, Connection> pool = new ConcurrentHashMap<>();
Connection conn = pool.computeIfAbsent(url, this::createConnection);
// Гарантия (Java 9+): createConnection вызовется ровно 1 раз для данного url
// В Java 8 был баг (JDK-8221462): при гонке функция могла вызваться дважды — исправлено в 9.
// НО: не используй для долгих вычислений — bucket заблокирован!
// ❌ Нельзя рекурсивно вызывать computeIfAbsent на той же карте — deadlock!
```

> **Источник:** JCP §5.2.1, OpenJDK source `ConcurrentHashMap.java`

---

## 2. ConcurrentSkipListMap / ConcurrentSkipListSet

### Структура данных

```
Level 3:  HEAD ──────────────────────────────── 50 ──────────── NIL
Level 2:  HEAD ──────── 15 ──────────────────── 50 ──── 72 ─── NIL
Level 1:  HEAD ── 7 ─── 15 ──── 25 ──────────── 50 ──── 72 ─── NIL
Level 0:  HEAD ── 7 ─── 15 ── 20 ── 25 ── 31 ── 50 ── 65 ── 72 ── NIL
```

**Что это:** Concurrent sorted map. Аналог `TreeMap`, но lock-free (CAS).

**Свойства:**
- O(log n) для get/put/remove — как TreeMap
- **Sorted** — навигация: `firstKey()`, `lastKey()`, `headMap()`, `tailMap()`, `subMap()`
- **Lock-free** — никаких блокировок, только CAS
- Weakly consistent iterators
- `ConcurrentSkipListSet` — обёртка, аналог `TreeSet`

**Когда использовать:**
- Нужна concurrent sorted map
- Нужны range queries (`subMap(from, to)`)
- Нужен concurrent NavigableMap

```java
ConcurrentSkipListMap<Long, Order> orders = new ConcurrentSkipListMap<>();
// Все заказы за последний час:
orders.subMap(System.currentTimeMillis() - 3600_000, System.currentTimeMillis());
```

> **Источник:** JCP §5.2.3, Javadoc ConcurrentSkipListMap

---

## 3. CopyOnWriteArrayList / CopyOnWriteArraySet

### Принцип работы

```
                  Поток-Writer
                      │ add("D")
                      ▼
  Старый массив:  [A, B, C]     ← Поток-Reader1 итерирует (snapshot)
  Новый массив:   [A, B, C, D]  ← Новые читатели видят это
                      │
         volatile ссылка обновлена
```

**Механизм:** Каждая мутация (add, set, remove) создаёт ПОЛНУЮ КОПИЮ внутреннего массива. Чтение — без блокировок. Итератор работает со snapshot'ом массива на момент создания.

**Свойства:**
- Чтение: O(1), без блокировок
- Запись: O(n) — копирование массива + lock
- Итератор: snapshot, никогда не бросит CME
- Итератор НЕ поддерживает `remove()` — `UnsupportedOperationException`

**Когда использовать:**
- Чтений >> записей (listener lists, config, routing tables)
- Маленькие коллекции (десятки элементов, не тысячи)
- Нужна безопасная итерация без внешней синхронизации

**Когда НЕ использовать:**
- Частые записи — каждая копирует весь массив
- Большие коллекции — O(n) на каждую мутацию

```java
// Классический use case — список слушателей
List<EventListener> listeners = new CopyOnWriteArrayList<>();

// Безопасная итерация + модификация
for (EventListener l : listeners) {  // snapshot iterator
    l.onEvent(event);
    if (l.isExpired()) listeners.remove(l);  // не сломает итерацию
}
```

> **Источник:** JCP §5.2.3, Javadoc CopyOnWriteArrayList

---

## 4. BlockingQueue — семейство

### Сравнительная таблица

| Реализация | Bounded | Структура | Locks | Особенности |
|---|---|---|---|---|
| `ArrayBlockingQueue` | Да (обязательно) | Circular array | 1 ReentrantLock | Fair mode доступен |
| `LinkedBlockingQueue` | Опционально (default MAX_INT) | Linked nodes | 2 locks (put+take) | Выше throughput |
| `PriorityBlockingQueue` | Нет (unbounded) | Heap | 1 ReentrantLock | Элементы по приоритету |
| `SynchronousQueue` | 0 (нет буфера) | — | Lock-free (unfair) | Прямая передача |
| `DelayQueue` | Нет | Heap | 1 ReentrantLock | Элементы по времени |
| `LinkedTransferQueue` | Нет | Linked nodes | Lock-free | transfer() блокирует |

### API BlockingQueue

```java
// Три группы методов:
//                 Бросает исключение    Возвращает значение    Блокирует     Блокирует с timeout
// Insert:         add(e)                offer(e) → bool        put(e)        offer(e, time, unit)
// Remove:         remove() → E          poll() → E|null        take() → E    poll(time, unit)
// Examine:        element() → E         peek() → E|null        —             —
```

### ArrayBlockingQueue — подробно

```
Circular Buffer:
  ┌───┬───┬───┬───┬───┬───┬───┬───┐
  │ D │ E │   │   │   │ A │ B │ C │    capacity = 8
  └───┴───┴───┴───┴───┴───┴───┴───┘
                        ↑       ↑
                      take    put
                      index   index
```

- **ОДИН lock** для put и take → ниже throughput чем LinkedBlockingQueue
- Fair mode: `new ArrayBlockingQueue<>(capacity, true)` — FIFO для ожидающих потоков
- Предсказуемый memory footprint (массив фиксированного размера)

### LinkedBlockingQueue — подробно

```
  head → Node1 → Node2 → Node3 → ... → NodeN ← tail

  putLock (для записи)     takeLock (для чтения)
  ↓                         ↓
  Можно класть и брать ОДНОВРЕМЕННО!
```

- **ДВА lock'а** — `putLock` и `takeLock` → выше throughput
- Default capacity = `Integer.MAX_VALUE` — **ОСТОРОЖНО: OOM!**
- Используется внутри `Executors.newFixedThreadPool()`

### SynchronousQueue — подробно

```
  Producer.put(X) ─────── БЛОКИРУЕТСЯ ─────── Consumer.take() → X
                    Нет буфера!
                    Прямая передача.
```

- Ёмкость = 0. Нет хранилища.
- `put()` блокируется пока кто-то не вызовет `take()` (и наоборот)
- Используется в `Executors.newCachedThreadPool()`
- Fair mode: очередь ожидающих (FIFO). Unfair: стек (LIFO, быстрее).

### PriorityBlockingQueue

- Unbounded, backed by heap (array)
- Элементы должны реализовывать `Comparable` или передать `Comparator`
- `take()` возвращает элемент с наименьшим значением
- Нет гарантий порядка для элементов с одинаковым приоритетом

### DelayQueue

```java
class DelayedTask implements Delayed {
    private final long executeAt;

    public long getDelay(TimeUnit unit) {
        return unit.convert(executeAt - System.currentTimeMillis(), MILLISECONDS);
    }
}
// take() блокируется пока delay не истечёт
```

- Элементы реализуют `Delayed`
- `take()` возвращает элемент только когда его delay истёк
- Use cases: scheduled tasks, cache expiration, rate limiting

### LinkedTransferQueue (Java 7+)

```java
// transfer() — как SynchronousQueue, но с буфером
queue.transfer(item);  // блокируется пока consumer не заберёт ЭТОТ элемент
queue.tryTransfer(item);  // не блокируется, true если consumer ждал
queue.put(item);  // как обычная очередь — не ждёт consumer'а
```

- Объединяет лучшее из `LinkedBlockingQueue` и `SynchronousQueue`
- Lock-free (CAS)

> **Источник:** JCP §5.3, Javadoc BlockingQueue

---

## 5. ConcurrentLinkedQueue / ConcurrentLinkedDeque

### Свойства
- **Non-blocking** (lock-free, CAS)
- Unbounded
- Weakly consistent iterator
- `size()` — O(n)! Обходит всю очередь. Используй `isEmpty()`.

### Когда использовать
- Высокий contention, нужна максимальная производительность
- Не нужна блокировка (если нет элементов — `poll()` вернёт null, не заблокируется)
- Producer-consumer где consumer не должен ждать

```java
// ❌ Антипаттерн — busy wait
while (true) {
    Item item = queue.poll();
    if (item != null) process(item);
    // else — впустую крутит CPU
}

// ✅ Для ожидания используй BlockingQueue.take()
```

> **Источник:** JCP §15.4, Javadoc ConcurrentLinkedQueue

---

## 6. Collections.synchronizedXxx vs Concurrent

### Механизм работы

`Collections.synchronizedXxx` — это тонкая обёртка: каждый метод оборачивается в `synchronized(mutex)`, где `mutex` — сам объект-обёртка. Никакой новой логики.

```java
// Что происходит внутри (упрощённо):
public V get(Object key) {
    synchronized (mutex) { return map.get(key); }
}
public V put(K key, V value) {
    synchronized (mutex) { return map.put(key, value); }
}
```

`ConcurrentHashMap`, `CopyOnWriteArrayList` и другие Concurrent-коллекции — специально спроектированные структуры данных с тонкой блокировкой (на уровне bucket/node) или вообще без блокировок (CAS, lock-free).

### Сравнительная таблица

```
Характеристика        Collections.synchronized*     java.util.concurrent.*
─────────────────────────────────────────────────────────────────────────────
Механизм              synchronized(this) на всём     Тонкие локи / CAS / COW
Granularity           Весь объект (1 lock)           Bucket / node / segment
Throughput            Низкий (полная сериализация)   Высокий (параллельный доступ)
Iterator              Fail-fast (бросает CME!)       Weakly consistent (нет CME)
Итерация              Нужен внешний synchronized     Безопасна без блокировки
Compound-операции     НЕ атомарны!                   Атомарны (putIfAbsent и др.)
Null-значения         Зависит от wrapped-коллекции   CHM: запрещены; COW: разрешены
Накладные расходы     Минимальные (обёртка ~0 байт)  Выше (доп. поля и структуры)
```

### Главная ловушка — итерация в synchronizedXxx

```java
Map<K,V> map = Collections.synchronizedMap(new HashMap<>());

// ❌ НЕБЕЗОПАСНО: итерация без внешней блокировки → ConcurrentModificationException
for (K key : map.keySet()) { ... }

// ✅ Нужен явный synchronized на весь блок итерации
synchronized (map) {
    for (K key : map.keySet()) { ... }
}
```

Это контрintuit'ивно: коллекция "thread-safe", а итерация — нет. Проблема в том, что итератор держит состояние снаружи lock'а.

### Главная ловушка — compound-операции

```java
Map<K,V> map = Collections.synchronizedMap(new HashMap<>());

// ❌ Race condition: два метода вызываются под разными lock'ами
if (!map.containsKey(key)) {   // lock захвачен и отпущен
    map.put(key, value);       // другой поток уже вставил ключ
}

// Чтобы сделать атомарно — нужен внешний synchronized:
synchronized (map) {
    if (!map.containsKey(key)) map.put(key, value);
}

// ✅ ConcurrentHashMap — атомарно без лишних усилий
concurrentMap.putIfAbsent(key, value);
```

### Когда synchronizedXxx всё же оправдан

- Нужно сделать thread-safe **существующую** коллекцию с минимальными изменениями
- Работа ведётся под **единым внешним lock'ом** (вся логика уже синхронизирована снаружи)
- Коллекция маленькая и contention низкий — overhead от CHM не нужен
- Нужна **точная семантика** обёрнутой коллекции (например, `LinkedHashMap` для LRU-кэша)

```java
// LRU-кэш с сохранением порядка — без ConcurrentHashMap не сделать
Map<K,V> lruCache = Collections.synchronizedMap(
    new LinkedHashMap<K,V>(16, 0.75f, true) {  // accessOrder=true
        protected boolean removeEldestEntry(Map.Entry e) {
            return size() > MAX_SIZE;
        }
    }
);
// Всё равно нужен внешний synchronized при итерации!
```

### Резюме

| Если нужно...                         | Использовать                   |
|---------------------------------------|-------------------------------|
| Высокий concurrent доступ к Map        | `ConcurrentHashMap`           |
| Атомарные compound-операции            | `ConcurrentHashMap`           |
| Безопасная итерация без внешних локов  | `ConcurrentHashMap` / `COW*`  |
| Обернуть существующую коллекцию        | `Collections.synchronized*`   |
| `LinkedHashMap` (LRU) thread-safe      | `Collections.synchronized*`   |
| Простота и всё под одним внешним локом | `Collections.synchronized*`   |

> **Источник:** JCP §5.1, §5.2

---

## 7. Шпаргалка: какую коллекцию выбрать

```
Нужна Map?
  ├─ Sorted? → ConcurrentSkipListMap
  └─ Нет    → ConcurrentHashMap

Нужна List?
  ├─ Чтений >> записей? → CopyOnWriteArrayList
  └─ Иначе → Collections.synchronizedList или переосмысли дизайн

Нужна Queue?
  ├─ Producer должен ждать если полна?
  │   ├─ Да → BlockingQueue
  │   │   ├─ Фиксированный размер → ArrayBlockingQueue
  │   │   ├─ Максимальный throughput → LinkedBlockingQueue(capacity!)
  │   │   ├─ Приоритеты → PriorityBlockingQueue
  │   │   ├─ Прямая передача → SynchronousQueue
  │   │   └─ Задержка → DelayQueue
  │   └─ Нет → ConcurrentLinkedQueue
  └─ Deque? → ConcurrentLinkedDeque / LinkedBlockingDeque

Нужен Set?
  ├─ Sorted? → ConcurrentSkipListSet
  ├─ Чтений >> записей? → CopyOnWriteArraySet
  └─ Нет → ConcurrentHashMap.newKeySet() (Java 8+)
```

---

## Вопросы для самопроверки

1. Почему ConcurrentHashMap не разрешает null ключи/значения?
2. Чем отличается weakly consistent iterator от fail-fast?
3. Почему LinkedBlockingQueue имеет выше throughput чем ArrayBlockingQueue?
4. В каком Executors фабричном методе используется SynchronousQueue?
5. Когда CopyOnWriteArrayList — плохой выбор?
6. Как ConcurrentHashMap.size() считает количество элементов?
7. Чем transfer() отличается от put() в LinkedTransferQueue?
8. Почему итерация по `Collections.synchronizedMap` без внешнего `synchronized` небезопасна, хотя каждый метод синхронизирован?
9. В каком случае `Collections.synchronizedMap(new LinkedHashMap<>(...))` предпочтительнее `ConcurrentHashMap`?

---

## Источники

**Официальная документация:**
- [`java.util.concurrent` package summary (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/package-summary.html) — формальное определение weakly consistent iterators, memory consistency effects.
- [`ConcurrentHashMap` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html) — разделы Bulk Operations и Stream support.
- [`ConcurrentSkipListMap` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentSkipListMap.html)
- [`BlockingQueue` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/BlockingQueue.html) — таблица «throws / returns / blocks / times out».

**Books / papers:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 5 (Building Blocks).
- [William Pugh — «Skip Lists: A Probabilistic Alternative to Balanced Trees» (CACM 1990)](https://15721.courses.cs.cmu.edu/spring2018/papers/08-oltpindexes1/pugh-skiplists-cacm1990.pdf) — структура за `ConcurrentSkipListMap`.
- [Michael & Scott (1996) — «Simple, Fast, and Practical Non-Blocking… Concurrent Queue Algorithms»](https://www.cs.rochester.edu/~scott/papers/1996_PODC_queues.pdf) — алгоритм за `ConcurrentLinkedQueue`.
- [Lea (2014) — «ForkJoin / Striped64 internals» (OpenJDK source comments)](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/atomic/Striped64.java) — почему `LongAdder`-подход применён в `ConcurrentHashMap.size()`.

**Bug reports / OpenJDK:**
- [JDK-8071667: ConcurrentHashMap.computeIfAbsent rentry behavior](https://bugs.openjdk.org/browse/JDK-8071667)
- [JDK-8161372 / JDK-8221462: computeIfAbsent atomicity (fixed in JDK 9)](https://bugs.openjdk.org/browse/JDK-8161372)

**Engineering blogs / posts:**
- [Doug Lea — `ConcurrentHashMap` design overview (concurrency-interest archive)](https://gee.cs.oswego.edu/dl/concurrency-interest/) — рассылка с обсуждениями API.
- [Heinz Kabutz — «Concurrent Maps» (JavaSpecialists)](https://www.javaspecialists.eu/archive/Issue197.html)
- [Brian Goetz — «Concurrent collections» (developerWorks, archive)](https://web.archive.org/web/2021*/developerWorks/java/library/j-jtp07233.html)
