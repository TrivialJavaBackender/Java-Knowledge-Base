# Locks: ReentrantLock, ReadWriteLock, StampedLock, Condition

---

## 1. ReentrantLock vs synchronized

| | `synchronized` | `ReentrantLock` |
|---|---|---|
| Синтаксис | Блок/метод | Явный `lock()` / `unlock()` |
| `tryLock()` | Нет | Да (без ожидания или с таймаутом) |
| Interruptible | Нет | `lockInterruptibly()` |
| Fairness | Всегда unfair | Fair или unfair (`new ReentrantLock(true)`) |
| Условий ожидания | 1 (`wait/notify`) | Несколько `Condition` |
| `unlock()` в finally | Не нужен | **Обязателен!** |
| Производительность | ~Одинаково (Java 6+) | Чуть быстрее при high contention |

**Правило (классическое, JCP 2006):** используй `synchronized` по умолчанию. `ReentrantLock` — только когда нужны его фичи.

**Актуальная поправка:** на Java 21–23 `synchronized` вызывает **pinning** виртуальных потоков — carrier thread блокируется и не может взять другой VT. Если код может выполняться в виртуальных потоках, предпочитай `ReentrantLock`. Java 24 (JEP 491) убрала pinning для `synchronized`, но пока не стала стандартом в большинстве проектов. В библиотечном коде — всегда `ReentrantLock`, среда выполнения неизвестна.

```java
ReentrantLock lock = new ReentrantLock();

// Базовое использование — ВСЕГДА unlock в finally
lock.lock();
try {
    // критическая секция
} finally {
    lock.unlock();  // обязательно даже при исключении
}

// tryLock — не блокируется
if (lock.tryLock()) {
    try { ... }
    finally { lock.unlock(); }
} else {
    // не смогли захватить — альтернативное действие
}

// tryLock с таймаутом
if (lock.tryLock(500, TimeUnit.MILLISECONDS)) {
    try { ... }
    finally { lock.unlock(); }
}

// Прерываемый lock (для deadlock prevention)
lock.lockInterruptibly();  // бросит InterruptedException если поток прерван

// Kotlin extension
lock.withLock { /* критическая секция */ }
```

**Fair lock** — потоки получают lock в порядке FIFO ожидания.
Предотвращает starvation, но снижает throughput (каждый lock = kernel transition).

---

## 2. Condition — множественные условия ожидания

```java
ReentrantLock lock = new ReentrantLock();
Condition notFull  = lock.newCondition();
Condition notEmpty = lock.newCondition();

// Producer
lock.lock();
try {
    while (buffer.isFull()) notFull.await();    // ждёт "не полон"
    buffer.add(item);
    notEmpty.signal();                          // сигнализирует "не пуст"
} finally { lock.unlock(); }

// Consumer
lock.lock();
try {
    while (buffer.isEmpty()) notEmpty.await();  // ждёт "не пуст"
    Item item = buffer.take();
    notFull.signal();                           // сигнализирует "не полон"
} finally { lock.unlock(); }
```

**Преимущество перед wait/notifyAll:**
С двумя Condition можно разбудить только нужных (producers ИЛИ consumers).
С одним `notifyAll()` — будишь всех (лишние накладные расходы).

**Методы Condition:**
```java
condition.await();                    // отпускает lock + ждёт
condition.await(1, TimeUnit.SECONDS); // с таймаутом → bool
condition.awaitNanos(nanos);
condition.awaitUninterruptibly();     // не реагирует на interrupt
condition.signal();                   // будит один поток
condition.signalAll();                // будит всех
```

---

## 3. ReentrantReadWriteLock

```
         Читатель 1 ──┐
         Читатель 2 ──┤──► READ LOCK (одновременно всем)
         Читатель 3 ──┘

         Писатель ────────► WRITE LOCK (эксклюзивно, блокирует читателей)
```

```java
ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();
Lock readLock  = rwLock.readLock();
Lock writeLock = rwLock.writeLock();

// Kotlin extension:
rwLock.read  { map[key] }           // read lock
rwLock.write { map[key] = value }   // write lock
```

**Правила:**
- Несколько потоков могут держать read lock одновременно
- Write lock — эксклюзивный (никого нет)
- Пока есть хотя бы один reader — writer ждёт
- Не поддерживает **upgrade** read→write (только downgrade write→read)

**Когда выгоден:** чтений >> записей (иначе overhead от двух lock'ов не оправдан).

### Lock Downgrade (write → read)

```java
writeLock.lock();
try {
    // Изменяем данные
    data = newValue;
    readLock.lock();   // взять read lock ДО отпускания write
} finally {
    writeLock.unlock();  // отпустить write — никакой writer не проскочит
}
try {
    // Работаем с данными под read lock
    process(data);
} finally {
    readLock.unlock();
}
```

**Зачем?** Между `writeLock.unlock()` и `readLock.lock()` другой поток мог бы изменить данные.
Downgrade гарантирует что мы работаем с данными, которые сами только что записали.

**Lock upgrade (read → write) — НЕ поддерживается**, вызовет deadlock:
```java
readLock.lock();
// ... читаем ...
writeLock.lock();   // ❌ DEADLOCK! reader ждёт writer, writer ждёт reader
```

---

## 4. StampedLock (Java 8+)

Три режима: write, read, **optimistic read** (без блокировки).

```java
StampedLock sl = new StampedLock();

// Write lock
long stamp = sl.writeLock();
try { x = newX; y = newY; }
finally { sl.unlockWrite(stamp); }

// Read lock
long stamp = sl.readLock();
try { return Math.sqrt(x*x + y*y); }
finally { sl.unlockRead(stamp); }

// Optimistic read — САМОЕ ИНТЕРЕСНОЕ
long stamp = sl.tryOptimisticRead();  // не блокируется, stamp != 0
double curX = x, curY = y;           // читаем данные
if (!sl.validate(stamp)) {           // проверяем: был ли write?
    stamp = sl.readLock();           // fallback на обычный read lock
    try { curX = x; curY = y; }
    finally { sl.unlockRead(stamp); }
}
return Math.sqrt(curX*curX + curY*curY);
```

**Преимущества:**
- Optimistic read: нет блокировки, читатели не мешают друг другу И писателю
- Максимальная производительность при редких записях

**Ограничения:**
- **НЕ reentrant** (lock.readLock() внутри lock.readLock() → deadlock)
- **НЕ поддерживает Condition**
- Нельзя конвертировать stamp произвольно

---

## 5. LockSupport

Низкоуровневый примитив, основа для всего `java.util.concurrent`.

```java
// Заблокировать текущий поток
LockSupport.park();
LockSupport.park(blocker);      // с объектом для диагностики
LockSupport.parkNanos(nanos);
LockSupport.parkUntil(deadline);

// Разблокировать конкретный поток (из любого потока)
LockSupport.unpark(thread);
```

**Особенность:** Каждый поток имеет один "permit". `unpark()` выдаёт permit; `park()` потребляет его. Если permit уже есть — `park()` возвращается немедленно. `unpark()` перед `park()` — park не блокирует.

---

## 6. Шпаргалка: что выбрать

```
Простая синхронизация                      → synchronized
tryLock / interruptible / fair lock        → ReentrantLock
Множество условий ожидания                 → ReentrantLock + Condition
Много читателей, мало писателей            → ReentrantReadWriteLock
Максимальная производительность, редко пишем → StampedLock (optimistic read)
Lock downgrade нужен                       → ReentrantReadWriteLock
```

---

## Вопросы для самопроверки

1. Почему `unlock()` должен быть в `finally`?
2. Как сделать fair ReentrantLock? В чём его минус?
3. Что такое lock downgrade и зачем он нужен?
4. Почему lock upgrade невозможен в ReentrantReadWriteLock?
5. В чём отличие `Condition.await()` от `Object.wait()`?
6. Как работает optimistic read в StampedLock?
7. Когда ReadWriteLock НЕ даёт преимущества над synchronized?

---

## Источники

**Спецификации / JEP:**
- [JEP 491: Synchronize Virtual Threads without Pinning (JDK 24)](https://openjdk.org/jeps/491) — почему `synchronized` блокировал carrier-поток до Java 24 и как это решили.
- [JEP 444: Virtual Threads (final, JDK 21)](https://openjdk.org/jeps/444) — раздел Pinning, рекомендация переходить на `ReentrantLock`.

**Официальная документация:**
- [`java.util.concurrent.locks` package summary (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/package-summary.html)
- [`ReentrantLock` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)
- [`StampedLock` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/StampedLock.html)

**Книги / papers:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 13 (Explicit Locks), Ch. 14 (Building Custom Synchronizers).
- [Doug Lea — «The java.util.concurrent Synchronizer Framework» (AQS paper, 2005)](https://gee.cs.oswego.edu/dl/papers/aqs.pdf) — внутреннее устройство `AbstractQueuedSynchronizer`, на котором построены все локи.

**Engineering blogs / posts:**
- [Heinz Kabutz — «Phaser, StampedLock and friends» (JavaSpecialists Newsletter)](https://www.javaspecialists.eu/archive/Issue215.html) — практические нюансы StampedLock.
- [Aleksey Shipilëv — «Java Object Header Layout» (для biased locking)](https://shipilev.net/jvm/objects-inside-out/) — что было в заголовке объекта до отмены biased locking в JEP 374.
- [JEP 374: Disable and Deprecate Biased Locking (JDK 15)](https://openjdk.org/jeps/374) — почему `synchronized` стало проще, но не быстрее.
