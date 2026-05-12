# Atomic операции и CAS

---

## 1. CAS — Compare-And-Swap

Атомарная CPU-инструкция (`CMPXCHG` на x86):

```
CAS(address, expected, new):
  if *address == expected:
    *address = new
    return true
  else:
    return false
  // Всё выше — атомарно, одна инструкция
```

```java
AtomicInteger counter = new AtomicInteger(0);

// compareAndSet — основа всего
boolean success = counter.compareAndSet(0, 1);  // if (counter == 0) counter = 1

// CAS-цикл (основной паттерн)
int current;
do {
    current = counter.get();
} while (!counter.compareAndSet(current, current + 1));
// Аналог: counter.incrementAndGet()
```

**Преимущество перед synchronized:** нет блокировок, нет context switch.
**Недостаток:** при высоком contention — spin в цикле (CPU-intensive).

---

## 2. Семейство Atomic

```java
// Числа
AtomicInteger     ai = new AtomicInteger(0);
AtomicLong        al = new AtomicLong(0L);
AtomicBoolean     ab = new AtomicBoolean(false);

// Ссылки
AtomicReference<T>           ar = new AtomicReference<>(obj);
AtomicStampedReference<T>    asr;  // с версией (против ABA)
AtomicMarkableReference<T>   amr;  // с boolean-флагом

// Массивы
AtomicIntegerArray  aia = new AtomicIntegerArray(10);
AtomicLongArray     ala;
AtomicReferenceArray<T> ara;

// Updaters (для полей существующих объектов)
AtomicIntegerFieldUpdater.newUpdater(MyClass.class, "count");
```

### Ключевые методы

```java
AtomicInteger ai = new AtomicInteger(5);

ai.get()                     // 5
ai.set(10)                   // volatile write
ai.getAndSet(20)             // атомарный swap → 10
ai.compareAndSet(20, 30)     // CAS → true, теперь 30
ai.getAndIncrement()         // → 30, теперь 31
ai.incrementAndGet()         // → 32
ai.getAndAdd(5)              // → 32, теперь 37
ai.addAndGet(3)              // → 40
ai.updateAndGet(x -> x * 2) // → 80  (Java 8+)
ai.accumulateAndGet(10, Integer::sum) // → 90  (Java 8+)
```

---

## 3. ABA-проблема

```
Поток 1:  читает A ──────────────────── CAS(A, B) → success!
Поток 2:             меняет A→B→A

Поток 1 думает что ничего не менялось, но состояние изменилось.
```

**Пример:** lock-free stack. Поток 1 хочет сделать pop. Между get() и CAS() другой поток сделал pop(A) + push(B) + pop(B) + push(A). Стек выглядит так же, но структура другая → `next` ссылка устарела.

### AtomicStampedReference

```java
AtomicStampedReference<String> ref =
    new AtomicStampedReference<>("A", 0);  // значение + версия

int[] stampHolder = new int[1];
String value = ref.get(stampHolder);     // получить значение И версию
int stamp = stampHolder[0];

// CAS проверяет И значение, И версию
ref.compareAndSet("A", "B", stamp, stamp + 1);
// Если stamp поменялся (другой поток изменил) — CAS вернёт false
```

---

## 4. LongAdder vs AtomicLong

### AtomicLong

```
Все потоки → [один счётчик] ← CAS contention!
                                При N потоках, N-1 проигрывают CAS и крутятся в цикле
```

### LongAdder

```
Поток 1 → [Cell-1]
Поток 2 → [Cell-2]   ← Каждый поток свою ячейку
Поток 3 → [Cell-3]

sum() = base + Cell-1 + Cell-2 + Cell-3
```

```java
LongAdder adder = new LongAdder();
adder.increment();          // Thread-local CAS — минимальный contention
adder.add(5);
long sum = adder.sum();     // ⚠️ Не точен во время записей!
long total = adder.sumThenReset(); // sum + reset атомарно
```

| | `AtomicLong` | `LongAdder` |
|---|---|---|
| Low contention | Одинаково | Чуть медленнее (overhead) |
| High contention | Медленно (spin) | **Намного быстрее** |
| `get()` точность | Точно | **Приблизительно** |
| CAS по значению | Да | Нет |
| Применение | Счётчик + CAS | Статистика, метрики |

**Правило:** для счётчиков-метрик — `LongAdder`. Для CAS и точного get() — `AtomicLong`.

`LongAccumulator` — обобщение `LongAdder` с произвольной ассоциативной функцией (max, min, …).

---

## 5. Lock-free структуры данных

### Treiber Stack (lock-free stack)

```java
class LockFreeStack<T> {
    private final AtomicReference<Node<T>> top = new AtomicReference<>();

    public void push(T value) {
        Node<T> newNode = new Node<>(value);
        Node<T> oldTop;
        do {
            oldTop = top.get();
            newNode.next = oldTop;
        } while (!top.compareAndSet(oldTop, newNode));
    }

    public T pop() {
        Node<T> oldTop;
        do {
            oldTop = top.get();
            if (oldTop == null) return null;
        } while (!top.compareAndSet(oldTop, oldTop.next));
        return oldTop.value;
    }
}
```

### Michael-Scott Queue (ConcurrentLinkedQueue внутри)

Lock-free очередь на двух указателях (head/tail) с CAS.

---

## 6. VarHandle (Java 9+)

Более мощная замена `AtomicXxxFieldUpdater`. Прямой доступ к полям через CAS.

```java
class Counter {
    private volatile int count = 0;
    private static final VarHandle COUNT;

    static {
        COUNT = MethodHandles.lookup()
            .findVarHandle(Counter.class, "count", int.class);
    }

    void increment() {
        COUNT.getAndAdd(this, 1);  // CAS по полю count
    }
}
```

---

## Вопросы для самопроверки

1. Как работает CAS? Что возвращает?
2. Что такое ABA-проблема? Как её решить?
3. Почему LongAdder быстрее AtomicLong при высоком contention?
4. Когда sum() у LongAdder неточен?
5. Что такое spin-loop? Когда он вреден?
6. Реализуй incrementAndGet() через compareAndSet без использования incrementAndGet().
7. Чем AtomicStampedReference отличается от AtomicMarkableReference?

---

## Источники

**Спецификации / JEP:**
- [JEP 193: Variable Handles (JDK 9)](https://openjdk.org/jeps/193) — `VarHandle` как замена `sun.misc.Unsafe` и `AtomicXxxFieldUpdater`.
- [Intel® 64 and IA-32 Architectures Software Developer's Manual, Vol. 2A: «CMPXCHG»](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html) — что именно делает CPU-инструкция за `compareAndSet`.

**Официальная документация:**
- [`java.util.concurrent.atomic` package summary (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/package-summary.html)
- [`LongAdder` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html) — раздел про striping и `Striped64`.
- [`VarHandle` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/invoke/VarHandle.html)

**Books / papers:**
- *The Art of Multiprocessor Programming*, 2nd ed. (Maurice Herlihy, Nir Shavit, Victor Luchangco, Michael Spear, 2020) — Ch. 5 (Primitive Synchronization Instructions), Ch. 9–11 (lock-free structures).
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 15 (Atomic Variables and Nonblocking Synchronization).
- [Treiber, R.K. (1986) — «Systems Programming: Coping with Parallelism» (IBM Research Report RJ 5118)](https://dominoweb.draco.res.ibm.com/58319a2ed2b1078985257003004617ef.html) — оригинал Treiber stack.
- [Michael & Scott (1996) — «Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms» (PODC '96)](https://www.cs.rochester.edu/~scott/papers/1996_PODC_queues.pdf) — алгоритм за `ConcurrentLinkedQueue`.

**Engineering blogs / posts:**
- [Aleksey Shipilëv — «Nanotrusting the nanotime» (про CAS-cost и memory ordering)](https://shipilev.net/blog/2014/nanotrusting-nanotime/)
- [Cliff Click — «A Lock-Free Hash Table» (talk + paper)](https://web.stanford.edu/class/ee380/Abstracts/070221_LockFreeHash.pdf) — глубокое погружение в lock-free структуры.
- [Martin Thompson — Mechanical Sympathy: «Memory Barriers / Fences»](https://mechanical-sympathy.blogspot.com/2011/07/memory-barriersfences.html)
