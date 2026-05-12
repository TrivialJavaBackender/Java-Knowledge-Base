# Synchronizers: CountDownLatch, CyclicBarrier, Semaphore, Phaser, Exchanger

---

## 1. CountDownLatch — одноразовый барьер

```
                  countDown()  countDown()  countDown()
Поток A ──────────────►         ─────────►
Поток B ────────────────────────►
Поток C ─────────────────────────────────────►

Main   ──── await() ─────────────────────────────────────► (все завершены)
                              latch(3) → 2 → 1 → 0
```

```java
CountDownLatch latch = new CountDownLatch(3);  // счётчик = 3

// Рабочие потоки:
Thread worker = new Thread(() -> {
    doWork();
    latch.countDown();  // декремент счётчика
});

// Ожидающий поток:
latch.await();              // блокирует пока счётчик != 0
latch.await(5, TimeUnit.SECONDS);  // с таймаутом → bool

// Текущее значение:
latch.getCount();
```

**Одноразовый** — нельзя сбросить.

**Паттерн "стартовый пистолет":**
```java
CountDownLatch start = new CountDownLatch(1);
CountDownLatch finish = new CountDownLatch(nThreads);

for (int i = 0; i < nThreads; i++) {
    new Thread(() -> {
        start.await();    // все ждут сигнала
        doWork();
        finish.countDown();
    }).start();
}

start.countDown();  // СТАРТ! все потоки запускаются одновременно
finish.await();     // ждём всех
```

---

## 2. CyclicBarrier — многоразовый барьер

```
Поток 1 ──── await() ──┐
Поток 2 ──── await() ──┤──► barrier action (если задан) ──► все освобождены
Поток 3 ──── await() ──┘
             Все собрались? Нет → ждём. Да → barrier action → продолжаем.
```

```java
// Barrier action — выполняется последним прибывшим потоком:
CyclicBarrier barrier = new CyclicBarrier(3, () -> {
    System.out.println("Все потоки завершили фазу, начинаем следующую");
});

// В каждом потоке, в каждой фазе:
for (int phase = 0; phase < 3; phase++) {
    doPhaseWork(phase);
    barrier.await();  // ждём остальных, потом продолжаем
}
```

**Cyclic** — автоматически сбрасывается после освобождения, можно переиспользовать.
`barrier.reset()` — ручной сброс (ждущие получат `BrokenBarrierException`).

### CountDownLatch vs CyclicBarrier

| | CountDownLatch | CyclicBarrier |
|---|---|---|
| Переиспользование | Одноразовый | Многоразовый |
| Кто делает отсчёт | Любой поток (countDown) | Только участники (await) |
| Barrier action | Нет | Да |
| Сценарий | "Ждать N событий" | "Все потоки встречаются в точке" |
| Сломан если поток умер | Нет | Да (BrokenBarrierException) |

---

## 3. Semaphore — ограничение доступа

```
Permits = 3

Поток A ── acquire() → permits=2
Поток B ── acquire() → permits=1
Поток C ── acquire() → permits=0
Поток D ── acquire() → БЛОКИРУЕТСЯ (permits=0)
Поток A ── release() → permits=1 → Поток D просыпается
```

```java
Semaphore semaphore = new Semaphore(3);           // 3 одновременных доступа
Semaphore fairSemaphore = new Semaphore(3, true); // FIFO для ожидающих

semaphore.acquire();           // уменьшить permits (блокирует если 0)
semaphore.acquire(2);          // занять 2 permits
semaphore.tryAcquire();        // не блокирует → bool
semaphore.tryAcquire(1, TimeUnit.SECONDS); // с таймаутом
semaphore.release();           // вернуть permit (любой поток может!)
semaphore.release(2);          // вернуть 2 permits

semaphore.availablePermits();  // текущее количество
semaphore.drainPermits();      // забрать все доступные (→ int)
```

**Ключевое отличие от Lock:** `release()` может вызвать ЛЮБОЙ поток, не только тот, что делал `acquire()`. Семафор не имеет "владельца". Бинарный семафор (permits=1) ≠ Lock (не reentrant).

**Классический use case:** пул ресурсов (соединения к БД, HTTP-клиенты).

```java
Semaphore pool = new Semaphore(MAX_CONNECTIONS);

Connection getConnection() {
    pool.acquire();           // ждём свободного слота
    return connections.poll();
}

void returnConnection(Connection c) {
    connections.offer(c);
    pool.release();           // освобождаем слот
}
```

---

## 4. Phaser — гибкий multi-phase барьер

Как `CyclicBarrier`, но:
- Динамическое количество участников (register/deregister)
- Поддержка фаз с номерами
- Можно делать иерархические Phaser'ы (для большого числа потоков)

```java
Phaser phaser = new Phaser(3);  // 3 участника

// Регистрация/дерегистрация динамически:
phaser.register();      // +1 участник
phaser.arriveAndDeregister(); // прийти на барьер и уйти из участников

// Ждать завершения фазы:
phaser.arriveAndAwaitAdvance();  // как barrier.await()
phaser.arrive();                 // прийти, не ждать остальных

// Номер текущей фазы:
int phase = phaser.getPhase();

// Ожидание определённой фазы:
phaser.awaitAdvance(phase);

// Кастомное завершение — переопредели onAdvance():
Phaser phaser = new Phaser(parties) {
    @Override
    protected boolean onAdvance(int phase, int registeredParties) {
        System.out.println("Phase " + phase + " complete");
        return phase >= 2;  // вернуть true → Phaser terminates
    }
};
```

---

## 5. Exchanger — обмен данными между двумя потоками

```
Поток A ──── exchange(bufferA) ──┐
                                  ├──► Оба получают данные друг друга
Поток B ──── exchange(bufferB) ──┘
```

```java
Exchanger<List<Integer>> exchanger = new Exchanger<>();

// Producer
Thread producer = new Thread(() -> {
    for (int i = 0; i < 3; i++) {
        List<Integer> buffer = fillBuffer();
        buffer = exchanger.exchange(buffer);  // отдать полный, получить пустой
    }
});

// Consumer
Thread consumer = new Thread(() -> {
    List<Integer> buffer = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
        buffer = exchanger.exchange(buffer);  // отдать пустой, получить полный
        processBuffer(buffer);
        buffer.clear();
    }
});
```

**Блокирует** пока оба потока не вызовут `exchange()`.
`exchange(value, timeout, unit)` — с таймаутом.

**Use case:** pipeline между двумя стадиями, double-buffering.

---

## Шпаргалка

```
Ждать завершения N задач (одноразово)      → CountDownLatch
Синхронизация фаз между N потоками         → CyclicBarrier
Ограничить параллельный доступ к ресурсу   → Semaphore
Многофазная синхронизация, dynamic parties → Phaser
Обмен данными между ровно двумя потоками   → Exchanger
```

---

## Вопросы для самопроверки

1. Почему CountDownLatch нельзя переиспользовать? Как обойти?
2. Что произойдёт если поток внутри CyclicBarrier бросит исключение?
3. Чем бинарный Semaphore отличается от Lock?
4. Когда нужен Phaser вместо CyclicBarrier?
5. Что такое "broken barrier"?
6. Может ли один поток вызвать release() на Semaphore несколько раз? Что будет?

---

## Источники

**Официальная документация:**
- [`CountDownLatch` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CountDownLatch.html)
- [`CyclicBarrier` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CyclicBarrier.html) — раздел про `BrokenBarrierException` и `reset()`.
- [`Semaphore` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Semaphore.html) — про fair/unfair и почему `release()` может вызвать любой поток.
- [`Phaser` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Phaser.html) — иерархические Phaser'ы, `onAdvance()`.
- [`Exchanger` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Exchanger.html)

**Books / papers:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 5.5 (Synchronizers).
- [Doug Lea — «The java.util.concurrent Synchronizer Framework» (AQS paper)](https://gee.cs.oswego.edu/dl/papers/aqs.pdf) — общий механизм за всеми синхронизаторами.

**Engineering blogs / posts:**
- [Heinz Kabutz — «Phaser, the most underused synchronizer» (JavaSpecialists)](https://www.javaspecialists.eu/archive/Issue199.html)
- [Brian Goetz — «Latches and barriers» (developerWorks, archive)](https://web.archive.org/web/2021*/developerWorks/java/library/j-jtp10264.html)
