# Атомарные операции и CAS: сколько на самом деле стоит «без блокировок»

> **Какую проблему решает.** Объясняет, как обновлять общее значение без лока, почему это часто
> быстрее — и почему в четверти случаев наоборот, медленнее лока в несколько раз.
> **Кому это надо.** Тому, кто ведёт счётчики и метрики, пишет кэши и структуры без блокировок,
> и тому, кому скажут «возьми `AtomicLong`, он же lock-free и потому быстрый» — а это неправда.
> **Когда НЕ надо.** Если инвариант связывает несколько полей — атомик не поможет в принципе,
> нужен лок ([`LOCKS.md`](LOCKS.md)).

Гарантии видимости, на которые опираются все атомики, — в [`MEMORY_MODEL.md`](MEMORY_MODEL.md).
Замеры: Apple M4 (10 ядер), Temurin 21.0.9; не JMH, порядок величин.

---

## 1. Задача и механизм

```java
class Counter {
    private long value;
    void increment() { value++; }        // читаем, увеличиваем, пишем — три операции
}
```

Взять лок можно, но кажется расточительным: критическая секция — одна инструкция. Процессор
предлагает более дешёвый примитив.

**Compare-And-Swap** — одна атомарная инструкция процессора (`CMPXCHG` на x86, пара `LDXR/STXR`
на ARM):

```
CAS(адрес, ожидаемое, новое):
    если *адрес == ожидаемое:  *адрес = новое; вернуть true
    иначе:                     вернуть false
    ← всё это неделимо
```

Из неё строится всё остальное — цикл «прочитал, посчитал, попробовал записать»:

```java
AtomicLong counter = new AtomicLong();

long cur;
do { cur = counter.get(); }
while (!counter.compareAndSet(cur, cur + 1));     // не вышло — значит, кто-то опередил, пробуем снова
// это и есть incrementAndGet()
```

Ключевое отличие от лока: **поток никогда не засыпает**. Если операция не удалась, он немедленно
повторяет её. Отсюда название — неблокирующий алгоритм: остановка одного потока не мешает остальным
продвигаться.

---

## 2. Чем платит CAS: измерение

«Без блокировок» звучит как «бесплатно». Проверим: посчитаем не только время, но и **сколько попыток
CAS понадобилось на один успешный инкремент**.

```java
// CasRetry.java — java CasRetry.java
long cur;
do { cur = counter.get(); attempts++; }
while (!counter.compareAndSet(cur, cur + 1));
```

```
потоков=1  инкрементов=200 000    попыток CAS=200 000    (1.00 попытки на инкремент)    3 мс
потоков=2  инкрементов=400 000    попыток CAS=556 077    (1.39 попытки на инкремент)    9 мс
потоков=4  инкрементов=800 000    попыток CAS=1 283 223  (1.60 попытки на инкремент)   18 мс
потоков=8  инкрементов=1 600 000  попыток CAS=7 458 448  (4.66 попытки на инкремент)  284 мс
```

Читаем: при восьми потоках **почти пять попыток из шести пропадают впустую**. Время выросло
непропорционально — в 95 раз при восьмикратном росте работы.

Почему так. Каждый CAS требует получить строку кэша в **эксклюзивное владение**, то есть отобрать её
у всех остальных ядер. Восемь ядер по очереди перетягивают одну строку туда-сюда, и на полезную
работу (`+1`) уходит ничтожная доля времени. Формально алгоритм неблокирующий — прогресс есть всегда;
практически он деградирует хуже, чем лок, который просто усыпляет лишних.

Тот же вывод в замере из [`WHY_CONCURRENCY.md §4`](WHY_CONCURRENCY.md): при 8 потоках `AtomicLong`
(234–247 мс) оказался **в 4 раза медленнее** `ReentrantLock` и в 26 раз медленнее одного потока
без синхронизации.

**Правило.** CAS выигрывает при **низкой** конкуренции (одна-две нити, короткие операции) и
проигрывает при высокой. «Lock-free» — это гарантия прогресса, а не обещание скорости.

---

## 3. Ложное разделение: конкуренция там, где общих данных нет

Единица когерентности — не переменная, а **строка кэша** (64 байта на x86, 128 на Apple Silicon).
Два потока могут писать в разные переменные и всё равно драться за одну строку.

```java
// FalseShare2.java: 4 потока пишут в AtomicLongArray
// вариант A — в соседние индексы (0,1,2,3): все в одной строке кэша
// вариант B — с шагом 16 long = 128 байт: каждый в своей строке
```

```
прогон 1:  соседние 230 мс | шаг 16 52 мс | замедление ×4.4
прогон 2:  соседние 412 мс | шаг 16 35 мс | замедление ×11.8
прогон 3:  соседние 116 мс | шаг 16 43 мс | замедление ×2.7
```

Логически потоки полностью независимы. Замедление — от 3 до 12 раз, и оно целиком паразитное.

Практический признак ложного разделения: несколько потоков часто пишут в **элементы одного массива**
или в **соседние поля одного объекта**. Разнесённые по куче объекты страдают редко (об этом прямо
сказано в комментарии `Striped64.java:60`).

Как разносить:

```java
// Аннотация JDK — но для своего кода нужен флаг, иначе она игнорируется
@jdk.internal.vm.annotation.Contended     // + --add-exports java.base/jdk.internal.vm.annotation=ALL-UNNAMED
class Counter { volatile long value; }    // + -XX:-RestrictContended

// Ручное разнесение: шаг между «своими» ячейками ≥ размера строки кэша
long[] counters = new long[threads * 16]; // работаем только с counters[i * 16]
```

> `sun.misc.Contended` **не существует** начиная с Java 9: `Class.forName("sun.misc.Contended")`
> на JDK 21 бросает `ClassNotFoundException`. Актуальное имя —
> `jdk.internal.vm.annotation.Contended`, и без `-XX:-RestrictContended` она действует только внутри
> самой JDK.

---

## 4. Семейство `Atomic`

```java
AtomicInteger / AtomicLong / AtomicBoolean          // числа и флаг
AtomicReference<T>                                  // ссылка
AtomicStampedReference<T>                           // ссылка + версия (против ABA, §5)
AtomicMarkableReference<T>                          // ссылка + булев признак
AtomicIntegerArray / AtomicLongArray / AtomicReferenceArray<T>
LongAdder / LongAccumulator / DoubleAdder           // счётчики под высокой конкуренцией (§6)
```

Методы, которые стоит знать:

```java
ai.get(); ai.set(v);                     // чтение и запись с семантикой volatile
ai.getAndSet(v);                         // атомарный обмен
ai.compareAndSet(expect, update);        // основа всего
ai.incrementAndGet(); ai.getAndAdd(5);   // готовые CAS-циклы
ai.updateAndGet(x -> x * 2);             // произвольная функция в CAS-цикле (Java 8+)
ai.accumulateAndGet(10, Integer::sum);
```

Важно про `updateAndGet`/`accumulateAndGet`: функция **может быть вызвана несколько раз**, потому
что она внутри CAS-цикла. Она обязана быть чистой — без побочных эффектов, без записи в лог,
без обращения к БД.

---

## 5. Проблема ABA

```
Поток 1: прочитал A ──────────────────────────── CAS(A → B): успех!
Поток 2:            изменил A → B → A
```

CAS сравнивает **значение**, а не историю. Если за время между чтением и CAS значение успело
измениться и вернуться, поток 1 не заметит подмены.

Когда это реально ломает: структуры на ссылках. Классика — стек без блокировок. Поток 1 прочитал
вершину `A` и её `next`. Пока он думал, другой поток снял `A`, снял `B`, вернул `A` обратно —
теперь у `A` другой `next`. CAS у потока 1 пройдёт (вершина по-прежнему `A`), и стек будет
восстановлен в устаревшее состояние.

Для чисел-счётчиков ABA безвредна: важно значение, а не то, каким путём к нему пришли.

```java
AtomicStampedReference<Node> top = new AtomicStampedReference<>(head, 0);

int[] stampHolder = new int[1];
Node cur = top.get(stampHolder);
top.compareAndSet(cur, cur.next, stampHolder[0], stampHolder[0] + 1);  // сверяем И версию
```

`AtomicMarkableReference` — то же самое, но вместо счётчика один булев признак («узел логически
удалён»); используется в алгоритмах ленивого удаления.

---

## 6. `LongAdder`: как обойти §2 и §3 сразу

`AtomicLong` — одна ячейка на всех. `LongAdder` (и его база `Striped64`) даёт **массив ячеек**:

```
AtomicLong:   все потоки ──► [одно значение]  ← перетягивание строки кэша

LongAdder:    поток 1 ──► [Cell 0]
              поток 2 ──► [Cell 1]     каждая Cell помечена @Contended → своя строка кэша
              поток 3 ──► [Cell 2]
              sum() = base + Σ cells
```

В исходнике это видно дословно:

```java
// Striped64.java:124
@jdk.internal.vm.annotation.Contended static final class Cell {
    volatile long value;
    final boolean cas(long cmp, long val) { … }
}
```

Ячейки создаются лениво — только когда обнаружена конкуренция, и их число не превышает количество
процессоров (`Striped64.java:153, 264`). При одном потоке `LongAdder` работает по единственному
полю `base` и не платит за массив.

Замер: 8 потоков × 1 млн инкрементов — `LongAdder` 5–6 мс против `AtomicLong` 234–247 мс.
**Разница в сорок раз.**

Цена — `sum()`:

> *The returned value is **NOT** an atomic snapshot; invocation in the absence of concurrent updates
> returns an accurate result, but concurrent updates that occur while the sum is being calculated
> might not be incorporated.* — javadoc `LongAdder.sum`

То есть сумма собирается обходом ячеек без общей блокировки, и параллельные изменения могут не попасть
в результат. Для метрик это допустимо, для «остатка на счёте» — нет.

| | `AtomicLong` | `LongAdder` |
|---|---|---|
| Один поток | быстрее (нет накладных) | чуть медленнее |
| Много потоков | деградирует (§2) | масштабируется |
| Точное чтение | да | нет (приблизительно при активных записях) |
| `compareAndSet` по значению | есть | **нет** |
| Память | 1 поле | до `NCPU` ячеек по строке кэша |

**Правило.** Счётчики и метрики (запросов, ошибок, байтов) — `LongAdder`. Идентификаторы, лимиты,
всё, где нужен CAS по значению или точное чтение — `AtomicLong`.

`LongAccumulator` — обобщение: та же схема ячеек, но с произвольной **ассоциативной и коммутативной**
функцией (`max`, `min`, `sum`). Требование не формальность: порядок объединения ячеек не определён.

---

## 7. `VarHandle` и режимы доступа

`VarHandle` (Java 9+, JEP 193) обычно подают как «замена `AtomicFieldUpdater`». Главное в нём другое —
он даёт **выбор силы гарантии** для каждого обращения.

```java
class Counter {
    private volatile long value;
    private static final VarHandle VALUE;
    static {
        try { VALUE = MethodHandles.lookup().findVarHandle(Counter.class, "value", long.class); }
        catch (ReflectiveOperationException e) { throw new ExceptionInInitializerError(e); }
    }
    void increment() { VALUE.getAndAdd(this, 1L); }
}
```

Четыре режима, от слабого к сильному:

| Режим | Методы | Что гарантирует | Когда использовать |
|---|---|---|---|
| **plain** | `get` / `set` | ничего, кроме отсутствия «разрыва» значения; компилятор волен кэшировать в регистре и переставлять | доступ, уже защищённый локом |
| **opaque** | `getOpaque` / `setOpaque` | обращение реально произойдёт и будет видно «когда-нибудь»; переупорядочивание с другими переменными разрешено | флаг отмены, счётчик прогресса — когда важен факт, а не порядок |
| **acquire / release** | `getAcquire` / `setRelease` | всё, записанное до `setRelease`, видно после `getAcquire` того же поля | публикация данных — дешевле `volatile`, потому что нет барьера `StoreLoad` |
| **volatile** | `getVolatile` / `setVolatile` / `compareAndSet` | полная семантика `volatile` плюс атомарность CAS | когда нужен полный порядок |

Практический смысл: `volatile` — самый дорогой режим, потому что требует барьера `StoreLoad`
(см. [`MEMORY_MODEL.md §3`](MEMORY_MODEL.md)). Если нужно всего лишь «опубликовать заполненный
объект», достаточно `setRelease`/`getAcquire` — гарантия та же, барьер дешевле. Именно так написаны
внутренности `ConcurrentHashMap` и AQS (`node.setPrevRelaxed(t)` в `AbstractQueuedSynchronizer` —
запись без лишнего барьера с комментарием «avoid unnecessary fence»).

`AtomicInteger` и коллеги — по сути обёртки над `volatile`-режимом `VarHandle`.

---

## 8. Структуры без блокировок

### Стек Трейбера

```java
class LockFreeStack<T> {
    private final AtomicReference<Node<T>> top = new AtomicReference<>();

    void push(T value) {
        Node<T> node = new Node<>(value), old;
        do { old = top.get(); node.next = old; }
        while (!top.compareAndSet(old, node));
    }

    T pop() {
        Node<T> old;
        do {
            old = top.get();
            if (old == null) return null;
        } while (!top.compareAndSet(old, old.next));   // ← здесь возможна ABA (§5)
        return old.value;
    }
}
```

Тот же алгоритм используется внутри `CompletableFuture` для стека зависимых действий
([`ASYNC_COMPOSITION.md §2`](ASYNC_COMPOSITION.md)).

### Очередь Майкла — Скотта

Двухуказательная очередь без блокировок (`head`/`tail`, оба обновляются CAS); реализована в
`ConcurrentLinkedQueue`. Особенность, вытекающая из lock-free устройства: `size()` обходит всю
очередь — это O(n) ([`CONCURRENT_COLLECTIONS.md`](CONCURRENT_COLLECTIONS.md)).

### Когда писать своё — не надо

Собственные структуры без блокировок почти всегда проигрывают. Причины:

- их **очень трудно проверить**: ошибка проявляется раз на миллионы операций и зависит от железа
  (нужен `jcstress`, см. [`MEMORY_MODEL.md §8`](MEMORY_MODEL.md));
- под конкуренцией они деградируют так же, как `AtomicLong` в §2;
- в `java.util.concurrent` уже есть проверенные реализации, написанные Дугом Ли.

Разумный порядок выбора: неизменяемость → готовая потокобезопасная коллекция → атомик →
лок → и только потом собственный алгоритм.

---

## 9. Шпаргалка

```
Счётчик, конкуренции мало           → AtomicLong / AtomicInteger
Счётчик метрик, потоков много       → LongAdder (sum() приблизителен, CAS по значению нет)
Максимум / минимум по многим потокам → LongAccumulator
Одна ссылка, менять по условию      → AtomicReference.compareAndSet
Структура на ссылках (стек, список) → AtomicStampedReference: возможна ABA
Несколько потоков пишут в массив    → разносить по строкам кэша (@Contended / шаг ≥ 16 long)
Нужна публикация без полного барьера → VarHandle.setRelease / getAcquire
Инвариант охватывает несколько полей → атомик не поможет, нужен лок
```

Формулировки для собеседования:

1. «CAS — одна инструкция процессора; из неё циклом строятся все атомарные операции».
2. «Lock-free — это гарантия прогресса, а не скорости: при 8 потоках у меня 4.66 попытки CAS на
   один успешный инкремент, и это в 4 раза медленнее лока».
3. «`LongAdder` разносит счётчик по ячейкам с `@Contended`, поэтому не платит за строку кэша;
   расплата — `sum()` не атомарный снимок».
4. «Единица когерентности — строка кэша, поэтому два независимых счётчика рядом в массиве
   замедляют друг друга в разы».

---

## 10. Упражнения

- [`Ex05: AtomicCounter`](../src/main/kotlin/exercises/Ex05_AtomicCounter.kt) — CAS-цикл,
  стек Трейбера, сравнение `AtomicLong` и `LongAdder`.

---

## Вопросы для самопроверки

1. Что делает CAS и что возвращает? Как из него получить `incrementAndGet`?
2. Сколько попыток CAS приходится на один инкремент при восьми потоках? Почему не одна?
3. Почему «без блокировок» не означает «быстро»?
4. Что такое ложное разделение? Как проверить, что оно есть, и как его убрать?
5. Почему `sun.misc.Contended` не работает на JDK 21?
6. Что такое ABA? Для счётчика она опасна? Для стека?
7. Как устроен `LongAdder` внутри и почему его `sum()` неточен?
8. Когда `LongAdder` — неправильный выбор?
9. Чем `setRelease` дешевле `setVolatile` и что он всё-таки гарантирует?
10. Почему функция в `updateAndGet` обязана быть чистой?

---

## Источники

**Исходники JDK 21:** `java/util/concurrent/atomic/Striped64.java` (комментарий про `@Contended` — 60,
класс `Cell` — 124, ограничение по числу ячеек — 153 и 264), `LongAdder.java` (javadoc `sum` — 111).

**Спецификации / JEP:**
- [JEP 193: Variable Handles (JDK 9)](https://openjdk.org/jeps/193) — режимы доступа и мотивация.
- [`VarHandle` Javadoc (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/invoke/VarHandle.html) — раздел «Access modes».
- [`java.util.concurrent.atomic` package summary](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/package-summary.html)

**Papers:**
- [Treiber (1986) — «Systems Programming: Coping with Parallelism»](https://dominoweb.draco.res.ibm.com/58319a2ed2b1078985257003004617ef.html) — стек без блокировок.
- [Michael & Scott (1996) — «Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms»](https://www.cs.rochester.edu/~scott/papers/1996_PODC_queues.pdf) — алгоритм `ConcurrentLinkedQueue`.

**Книги / разборы:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 15 (Atomic Variables and Nonblocking Synchronization).
- *The Art of Multiprocessor Programming*, 2nd ed. (Herlihy, Shavit, 2020) — Ch. 5, 9–11.
- [Martin Thompson — «False Sharing»](https://mechanical-sympathy.blogspot.com/2011/07/false-sharing.html)
- [Aleksey Shipilëv — «Nanotrusting the nanotime»](https://shipilev.net/blog/2014/nanotrusting-nanotime/) — как правильно мерить такие вещи (и почему без JMH цифры пляшут).
