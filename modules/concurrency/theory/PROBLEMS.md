# Проблемы многопоточности: Deadlock, Livelock, Starvation, Race Condition, JMM

---

## 1. Deadlock

Четыре условия Коффмана — все четыре **необходимы одновременно**:

1. **Mutual exclusion** — ресурс занят эксклюзивно (нельзя разделить)
2. **Hold and wait** — поток держит ресурс и ждёт другой
3. **No preemption** — ресурс нельзя отобрать принудительно
4. **Circular wait** — A ждёт B, B ждёт A (или цепочка длиннее)

```java
// Классический deadlock: два потока, два lock'а
Object lockA = new Object(), lockB = new Object();

Thread t1 = new Thread(() -> {
    synchronized (lockA) {
        Thread.sleep(100);
        synchronized (lockB) { /* ... */ }  // ждёт t2
    }
});

Thread t2 = new Thread(() -> {
    synchronized (lockB) {
        Thread.sleep(100);
        synchronized (lockA) { /* ... */ }  // ждёт t1
    }
});
```

### Предотвращение

**Lock ordering** — все потоки захватывают блокировки в одном порядке:
```java
// ✅ Всегда lockA перед lockB
synchronized (lockA) { synchronized (lockB) { ... } }
// Circular wait невозможен
```

**tryLock с таймаутом** — отступить если не удалось захватить:
```java
while (true) {
    if (lockA.tryLock(50, MILLISECONDS)) {
        try {
            if (lockB.tryLock(50, MILLISECONDS)) {
                try { doWork(); return; }
                finally { lockB.unlock(); }
            }
        } finally { lockA.unlock(); }
    }
    Thread.sleep(random backoff);  // избежать livelock
}
```

**Open calls** — не вызывай чужой код под своим lock'ом.

### Обнаружение

```java
ThreadMXBean bean = ManagementFactory.getThreadMXBean();
long[] deadlockedIds = bean.findDeadlockedThreads();
if (deadlockedIds != null) {
    for (ThreadInfo info : bean.getThreadInfo(deadlockedIds)) {
        System.out.println(info.getThreadName() +
            " blocked on " + info.getLockName());
    }
}
```

```bash
# Из командной строки:
jstack <pid>           # дамп стеков — покажет "Found one Java-level deadlock"
kill -3 <pid>          # то же через сигнал (Unix)
jconsole / VisualVM    # GUI
```

---

## 2. Livelock

Потоки **активны** (не заблокированы), но не прогрессируют — постоянно реагируют на действия друг друга.

```java
// Пример: оба пытаются уступить друг другу
while (!done) {
    if (!lock.tryLock()) {
        // Не смогли захватить — отступаем
        releaseMine();
        continue;  // но другой поток делает то же самое!
    }
}
```

**Решение:** рандомизированный backoff — `Thread.sleep(random milliseconds)`.
TCP/IP использует exponential backoff именно по этой причине.

**Отличие от deadlock:** потоки не заблокированы, CPU занят (100%). Deadlock — потоки заблокированы, CPU свободен.

---

## 3. Starvation

Поток **никогда** (или очень редко) не получает доступ к ресурсу.

**Причины:**
- Unfair lock — поток с высоким приоритетом вытесняет низкоприоритетный
- Длинные synchronized блоки — один поток долго держит lock
- `notify()` вместо `notifyAll()` — будит не тот поток

```java
// ❌ Starvation: задача всегда будит не тот поток
synchronized (lock) {
    condition = true;
    lock.notify();  // может постоянно будить один и тот же поток
}

// ✅ Fair lock
ReentrantLock fairLock = new ReentrantLock(true);
// Потоки получают lock в порядке FIFO
```

**Решение:** fair locks, справедливое разделение времени, `notifyAll()`.

---

## 4. Race Condition vs Data Race

### Data Race

Два потока обращаются к одной переменной, хотя бы один пишет, **без happens-before**.
По JMM это **undefined behavior** — любой результат допустим.

```java
int x = 0;                    // shared, без синхронизации

Thread t1 = new Thread(() -> x = 1);   // пишет
Thread t2 = new Thread(() -> print(x)); // читает
// x может быть 0 или 1 — зависит от реализации JVM, CPU, кэшей
```

### Race Condition

**Логическая ошибка**: результат зависит от порядка выполнения потоков.
Бывает даже при корректной синхронизации (если синхронизирован неправильно).

```java
// Check-then-act — классическая race condition
if (!map.containsKey(key)) {       // Поток A проверил — нет
    // Поток B вставил!
    map.put(key, expensive());     // Поток A тоже вставил — дублирование!
}

// ✅ Атомарно
map.computeIfAbsent(key, k -> expensive());
```

```java
// Read-modify-write
counter++;  // read → modify → write — три операции, race condition!

// ✅ Атомарно
AtomicInteger counter = new AtomicInteger();
counter.incrementAndGet();
```

| | Data Race | Race Condition |
|---|---|---|
| Определение | Нет HB для concurrent доступа | Неверный результат из-за порядка |
| Требует | Concurrent read+write без sync | Логически некорректная синхронизация |
| Может быть без другого | Теоретически да (benign data race), но по JMM — всегда UB | Да (race condition без data race) |

> **Benign data race** — data race, который "случайно работает" на конкретной JVM/CPU (например, идемпотентная запись одного и того же значения). Формально это всё равно UB по JMM и полагаться на него нельзя. На практике для собеседований: "data race всегда проблема".

**Race condition без data race** — пример: два потока атомарно читают и записывают в `AtomicReference`, но вместе делают check-then-act:
```java
if (ref.get() == null)       // атомарно, но...
    ref.set(new Value());    // между ними вклинился другой поток!
```

---

## 5. Java Memory Model (JMM)

### Проблема без JMM

Современные CPU и JVM **переупорядочивают** инструкции для производительности:
- CPU out-of-order execution
- JIT компилятор оптимизирует
- Каждое ядро имеет свой кэш

```java
// Без синхронизации другой поток может увидеть в ЛЮБОМ порядке:
a = 1;
b = 2;
// Другой поток может увидеть: b=2 до a=1!
```

### Happens-Before — что создаёт гарантию видимости

```
Правило                           Пример
─────────────────────────────────────────────────────
Program order                     x=1; y=x → y всегда 1
Monitor unlock → lock             unlock(m) → lock(m)
Volatile write → read             write(v) → read(v)
Thread.start()                    start(t) → первая op в t
Thread.join()                     последняя op в t → join()
Transitive A→B→C → A→C
```

### Double-Checked Locking

```java
// ❌ Сломанный вариант (без volatile) — unsafe publication
private Singleton instance;

Singleton getInstance() {
    if (instance == null) {                  // Поток может увидеть частично
        synchronized (this) {               // инициализированный объект!
            if (instance == null) {
                instance = new Singleton(); // 3 шага: alloc, init, assign
            }                               // JIT может переупорядочить!
        }
    }
    return instance;
}

// ✅ С volatile — безопасно
private volatile Singleton instance;
// volatile запрещает переупорядочивание: assign всегда после init
```

### Safe Publication

Объект **безопасно опубликован** если другие потоки видят его полностью инициализированным:

```java
// ✅ Безопасные способы публикации:
private static final Obj obj = new Obj();           // static final (class loading HB)
private volatile Obj ref = new Obj();               // volatile
private final AtomicReference<Obj> ref = new AtomicReference<>(new Obj()); // atomic
// Через synchronized block при публикации

// ❌ Unsafe publication:
private Obj ref;
new Thread(() -> { ref = new Obj(); }).start();
// другой поток может увидеть частично инициализированный Obj!
```

---

## 6. Дополнительные проблемы

### False Sharing

Разные переменные в одной **кэш-линии** (64 байта). Запись одной инвалидирует кэш других ядер.

```java
// ❌ counter0 и counter1 скорее всего в одной кэш-линии
long[] counters = new long[2];
// Поток 1 пишет counters[0], Поток 2 пишет counters[1] — замедление!

// ✅ Padding (@Contended — Java 8+)
@sun.misc.Contended  // доступен через модуль jdk.unsupported (Java 9+)
class Counter { volatile long value; }
// JVM добавляет padding вокруг поля до 128 байт

// ⚠️ Для пользовательского кода нужен JVM-флаг:
// -XX:-RestrictContended
// Без флага аннотация применяется только к классам самой JDK!
```

### Thread Confinement

Объект используется только одним потоком — синхронизация не нужна.

```java
// Stack confinement — переменные внутри метода
void process() {
    List<String> local = new ArrayList<>();  // только этот поток видит
    // no sync needed
}

// ThreadLocal
ThreadLocal<SimpleDateFormat> formatter =
    ThreadLocal.withInitial(SimpleDateFormat::new);
// Каждый поток свой экземпляр
```

---

## Шпаргалка: как предотвратить

```
Deadlock          → Lock ordering / tryLock / open calls
Livelock          → Randomized backoff
Starvation        → Fair locks / notifyAll() / минимальный scope lock
Race condition    → Synchronized / Atomic / правильный выбор структур данных
Data race         → Volatile / synchronized — обеспечить HB
False sharing     → @Contended / padding
```

---

## Вопросы для самопроверки

1. Назови 4 условия Коффмана. Как нарушить каждое?
2. Чем livelock отличается от deadlock? Как обнаружить каждый?
3. Что такое data race? Чем отличается от race condition?
4. Почему double-checked locking без volatile — UB?
5. Что такое safe publication? Назови 4 способа.
6. Что такое false sharing? Как диагностировать?
7. Может ли race condition быть без data race? Пример.

---

## Источники

**Спецификации / стандарты:**
- [JLS §17.4 — Memory Model (Java SE 21)](https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html#jls-17.4) — формальное определение happens-before, data race, well-formed executions.
- [JSR-133 FAQ (Manson, Goetz)](https://www.cs.umd.edu/~pugh/java/memoryModel/jsr-133-faq.html) — DCL, safe publication, volatile semantics.

**Books / papers:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 10 (Avoiding Liveness Hazards), Ch. 16 (The Java Memory Model).
- [Coffman, Elphick, Shoshani (1971) — «System Deadlocks» (ACM Computing Surveys 3(2))](https://dl.acm.org/doi/10.1145/356586.356588) — оригинал четырёх условий deadlock'а.
- *The Art of Multiprocessor Programming*, 2nd ed. (Herlihy/Shavit, 2020) — Ch. 7 (Spin Locks and Contention).

**Официальная документация:**
- [`ThreadMXBean#findDeadlockedThreads` (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.management/java/lang/management/ThreadMXBean.html#findDeadlockedThreads()) — программное обнаружение deadlock'а.
- [`jdk.internal.vm.annotation.Contended` / `jstack(1)`, `jcmd Thread.print`](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jstack.html)

**Engineering blogs / posts:**
- [Aleksey Shipilëv — «Close Encounters of the Java Memory Model Kind»](https://shipilev.net/blog/2014/jmm-pragmatics/) — детальный разбор DCL, publication, volatile, final.
- [Aleksey Shipilëv — «Java Concurrency Stress Tests (jcstress)»](https://github.com/openjdk/jcstress) — стресс-тесты, ловящие data races на реальной JVM.
- [Cliff Click — «False Sharing» (talk + slides)](https://www.youtube.com/watch?v=PVkRl5XAWzE) — что это, как диагностировать perf-tools.
- [Martin Thompson — «False sharing && @Contended»](https://mechanical-sympathy.blogspot.com/2011/07/false-sharing.html)
- [Doug Lea — «The JSR-133 Cookbook for Compiler Writers»](https://gee.cs.oswego.edu/dl/jmm/cookbook.html) — реальные барьеры, генерируемые JIT'ом для разных JMM-конструкций.
