# Потоки, synchronized, volatile, wait/notify

---

## 1. Жизненный цикл потока

```
NEW ──start()──► RUNNABLE ──────────────────────────────► TERMINATED
                    │   ▲
          blocked   │   │ lock acquired / sleep ends
                    ▼   │
                 BLOCKED (ждёт монитор)
                    │   ▲
          wait()    │   │ notify()/notifyAll()
                    ▼   │
                 WAITING / TIMED_WAITING
```

| Состояние | Причина |
|---|---|
| `NEW` | Создан, `start()` не вызван |
| `RUNNABLE` | Выполняется или готов к выполнению |
| `BLOCKED` | Ждёт захвата монитора (`synchronized`) |
| `WAITING` | `wait()`, `join()`, `LockSupport.park()` |
| `TIMED_WAITING` | `sleep(n)`, `wait(n)`, `join(n)` |
| `TERMINATED` | Завершён (нормально или с исключением) |

---

## 2. Thread API

```java
Thread t = new Thread(() -> doWork());
t.setName("worker-1");
t.setDaemon(true);  // должно быть ДО start()!
t.start();

// Из другого потока:
t.interrupt();          // устанавливает interrupt flag
t.join();               // ждёт завершения
t.join(1000);           // ждёт не более 1000ms
Thread.currentThread(); // текущий поток

// Внутри задачи:
Thread.sleep(100);                    // бросает InterruptedException
Thread.interrupted();                 // проверяет и СБРАСЫВАЕТ флаг
Thread.currentThread().isInterrupted(); // проверяет без сброса
```

**Daemon thread** — JVM завершается когда остались только daemon-потоки.
GC, finalizer — daemon. Потоки из thread pool — non-daemon.

**interrupt()** — не убивает поток. Устанавливает флаг прерывания.
Методы `sleep()`, `wait()`, `join()` при установленном флаге бросают `InterruptedException` и **сбрасывают** флаг. Правильная реакция:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt(); // восстановить флаг!
    return;
}
```

---

## 3. synchronized — монитор

Каждый объект в Java имеет встроенный монитор (intrinsic lock).

```java
// Монитор объекта this:
synchronized void method() { ... }
synchronized (this) { ... }

// Монитор класса:
static synchronized void staticMethod() { ... }
synchronized (MyClass.class) { ... }

// Произвольный объект-замок:
private final Object lock = new Object();
synchronized (lock) { ... }
```

**Свойства:**
- **Reentrant** — поток может повторно захватить уже захваченный им монитор
- **Взаимное исключение** — только один поток владеет монитором
- **Visibility** — выход из synchronized flushes все записи в main memory; вход invalidates кэш

```java
// synchronized на разных объектах — НЕ защищают одно и то же!
synchronized (lockA) { counter++; }  // поток 1
synchronized (lockB) { counter++; }  // поток 2 — race condition!
```

---

## 4. volatile

```java
private volatile boolean running = true;

// Поток 1:
running = false;

// Поток 2:
while (running) { doWork(); }  // гарантированно увидит false
```

**Гарантирует:**
- **Visibility** — запись видна другим потокам немедленно (без кэширования в регистрах/L1)
- **Happens-before** — запись в volatile HB чтению той же переменной
- **Порядок** — запрещает переупорядочивание (memory barrier)

**НЕ гарантирует:**
- **Атомарность составных операций** — `count++` это read→modify→write, три операции

```java
volatile int count = 0;
count++;  // ❌ НЕ атомарно! Используй AtomicInteger
```

**Когда достаточно volatile:**
- Один поток пишет, остальные читают (simple flag)
- Публикация ссылки на immutable объект

---

## 5. Happens-Before (JMM)

Отношение частичного порядка: если A happens-before B, то все записи A гарантированно видны в B.

**Правила happens-before:**
1. **Program order** — в одном потоке: каждая операция HB следующей
2. **Monitor lock** — unlock(m) HB lock(m) того же монитора
3. **Volatile** — запись в volatile HB чтению той же переменной
4. **Thread start** — `t.start()` HB первая операция потока t
5. **Thread join** — последняя операция t HB возврат из `t.join()`
6. **Transitive** — A HB B, B HB C → A HB C

```java
int x = 0;
Thread t = new Thread(() -> {
    x = 42;  // запись
});
t.start();
t.join();
System.out.println(x);  // гарантированно 42 (join создаёт HB)
```

---

## 6. wait / notify / notifyAll

**Правило:** всегда вызывать только внутри `synchronized` по тому же объекту.

```java
// Producer
synchronized (lock) {
    while (buffer.isFull()) {   // while, не if!
        lock.wait();            // атомарно: отпускает монитор + усыпляет
    }
    buffer.add(item);
    lock.notifyAll();
}

// Consumer
synchronized (lock) {
    while (buffer.isEmpty()) {
        lock.wait();
    }
    Item item = buffer.take();
    lock.notifyAll();
}
```

**Почему while, а не if?**
Spurious wakeup — поток может проснуться без `notify()`. Всегда проверяй условие повторно.

**notify() vs notifyAll():**
- `notify()` — будит один произвольный поток
- `notifyAll()` — будит все ждущие потоки
- Почти всегда используй `notifyAll()`: `notify()` опасен если несколько условий ожидания на одном объекте — сигнал может достаться "не тому" потоку (signal hijacking)

---

## 7. Типичные ошибки

```java
// ❌ Проверка без синхронизации
if (!initialized) {  // может увидеть устаревшее значение
    initialize();
}

// ❌ Синхронизация на разных объектах
synchronized (new Object()) { ... }  // каждый раз новый монитор — бесполезно

// ❌ notify() вместо notifyAll() с несколькими условиями
// Одно условие — можно notify()
// Несколько — обязательно notifyAll()

// ❌ wait() без цикла
synchronized (lock) {
    if (!condition) lock.wait();  // spurious wakeup!
    // используй while
}

// ❌ Длинные synchronized блоки
synchronized (this) {
    compute();        // долгая операция — блокирует всех
    db.save(result);  // I/O внутри lock — антипаттерн
}
```

---

## 8. Шпаргалка

```
Нужна видимость одного флага?              → volatile
Нужна атомарность составных операций?      → synchronized или AtomicXxx
Нужна координация (жди условия)?           → synchronized + wait/notify
Нужно ограничить блок синхронизации?       → synchronized(lock) { ... }
Нужен более мощный инструмент?             → ReentrantLock + Condition
```

---

## Вопросы для самопроверки

1. Чем `Thread.interrupted()` отличается от `isInterrupted()`?
2. Почему `wait()` должен вызываться в цикле?
3. Что такое spurious wakeup?
4. Чем `notify()` опасен при нескольких условиях?
5. Что произойдёт если `volatile` переменную инкрементируют 2 потока?
6. Назови все правила happens-before.
7. Почему синхронизация на `new Object()` внутри метода бесполезна?

---

## Источники

**Спецификации / стандарты:**
- [JLS §17 — Threads and Locks (Java SE 21)](https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html) — правила happens-before, semantics `volatile`, монитора, `final`-полей.
- [JSR-133: Java Memory Model and Thread Specification Revision](https://www.cs.umd.edu/~pugh/java/memoryModel/) — оригинальная редакция JMM (Pugh, Manson, Adve, Goetz, Lea).
- [JSR-133 FAQ (Jeremy Manson, Brian Goetz)](https://www.cs.umd.edu/~pugh/java/memoryModel/jsr-133-faq.html) — самая прагматичная версия объяснения JMM.

**Официальная документация:**
- [`java.lang.Thread` (Javadoc, JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Thread.html)
- [`java.lang.Object#wait/notify/notifyAll`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html#wait())

**Книги:**
- *Java Concurrency in Practice* (Brian Goetz et al., 2006) — Ch. 3 (Sharing Objects), 14 (Building Custom Synchronizers), 16 (The Java Memory Model).
- *Effective Java*, 3rd ed. (Joshua Bloch, 2018) — Items 78–84 (concurrency).
- *Concurrent Programming in Java*, 2nd ed. (Doug Lea, 1999) — фундамент того, как устроен `java.util.concurrent`.

**Engineering blogs / posts:**
- [Aleksey Shipilëv — «Close Encounters of the Java Memory Model Kind» (JMM Pragmatics)](https://shipilev.net/blog/2014/jmm-pragmatics/) — лучшее современное объяснение JMM с примерами.
- [Java Concurrency Stress Tests (jcstress) — OpenJDK](https://github.com/openjdk/jcstress) — тесты, которые ловят реальные нарушения JMM на твоей JVM.
- [Brian Goetz — «Java theory and practice» (IBM developerWorks, archive.org)](https://web.archive.org/web/20210417000000*/developerWorks/java/library/j-jtp*) — серия статей-первоисточников по JCIP.
- [Mechanical Sympathy (Martin Thompson)](https://mechanical-sympathy.blogspot.com/) — про CPU-кэши, барьеры, false sharing.
