# Синхронизаторы: `CountDownLatch`, `CyclicBarrier`, `Semaphore`, `Phaser`, `Exchanger`

> **Какую проблему решает.** Лок отвечает на вопрос «кого пускать». Синхронизаторы отвечают на другой:
> «когда пускать» — дождаться N событий, собрать всех участников в одной точке, не пустить больше N
> одновременно.
> **Кому это надо.** Тому, кто координирует старт и остановку сервиса, ограничивает нагрузку на
> внешнюю систему, пишет батчи по фазам или тесты на конкурентность.
> **Когда НЕ надо.** Если задача сводится к «дождаться завершения задач» — обычно достаточно
> `ExecutorService.invokeAll` или `CompletableFuture.allOf`. Синхронизаторы нужны, когда координация
> не совпадает с границами задач.

Все пять построены на одном механизме — см. [`JUC_INTERNALS.md §5`](JUC_INTERNALS.md).
Разница только в том, что означает число `state` и при каком его значении поток пропускают дальше:

| Класс | `state` | Пропускает, когда |
|---|---|---|
| `CountDownLatch` | сколько событий ещё ждём | `state == 0` |
| `Semaphore` | свободные разрешения | хватает разрешений |
| `CyclicBarrier` | не на AQS: `ReentrantLock` + `Condition` | пришли все участники |
| `Phaser` | номер фазы + число участников (упаковано в `long`) | фаза закрыта |

Поэтому «выучить пять классов» не нужно — нужно понять, какую координацию каждый выражает.

---

## 1. `CountDownLatch` — «подождать N событий»

Одноразовый счётчик: сколько-то потоков досчитывают его до нуля, сколько-то ждут этого момента.

```java
CountDownLatch ready = new CountDownLatch(3);

// в каждом из трёх подсистем при старте
initCache();  ready.countDown();

// в главном потоке
ready.await();                      // ждём, пока все три отчитаются
ready.await(30, TimeUnit.SECONDS);  // с таймаутом → boolean
startAcceptingTraffic();
```

Два свойства, определяющие область применения:

- **Считает кто угодно.** `countDown()` не обязан вызывать тот, кто потом ждёт. Это не барьер
  «встретимся все», а «сообщите мне, когда будет готово».
- **Одноразовый.** Досчитав до нуля, защёлка навсегда открыта: последующие `await()` возвращаются
  мгновенно. Сбросить нельзя — нужен новый объект (или `CyclicBarrier`/`Phaser`).

Практическое применение на бэкенде — **готовность сервиса**: не отдавать `/health` и не принимать
трафик, пока не прогреты кэш, пул соединений и подписки на брокер.

### Приём «стартовый пистолет»

Незаменим в тестах на конкурентность: без него потоки стартуют вразнобой и гонка не воспроизводится.

```java
CountDownLatch start = new CountDownLatch(1);          // общий сигнал
CountDownLatch finish = new CountDownLatch(N);

for (int i = 0; i < N; i++) new Thread(() -> {
    start.await();          // все ждут здесь
    hammerSharedState();    // и срываются одновременно
    finish.countDown();
}).start();

start.countDown();          // выстрел
finish.await();             // ждём всех
```

Ровно так собраны замеры в [`WHY_CONCURRENCY.md`](WHY_CONCURRENCY.md) и
[`ATOMIC_CAS.md`](ATOMIC_CAS.md).

---

## 2. `CyclicBarrier` — «встретиться всем в одной точке»

Многоразовая точка сбора: барьер открывается, когда на нём собрались все участники.

```java
CyclicBarrier barrier = new CyclicBarrier(4, () -> mergeResults());  // действие на барьере

// в каждом из четырёх потоков
for (int phase = 0; phase < phases; phase++) {
    computePart(phase);
    barrier.await();          // ждём остальных; последний прибывший выполнит mergeResults()
}
```

Отличия от `CountDownLatch`, которые и определяют выбор:

| | `CountDownLatch` | `CyclicBarrier` |
|---|---|---|
| Многоразовость | нет | да, сбрасывается автоматически |
| Кто отсчитывает | любой поток | только сами участники |
| Действие при открытии | нет | есть (выполняет последний пришедший) |
| Сценарий | «сообщите, когда готово» | «встретимся все и пойдём дальше» |

**Хрупкость — обратная сторона многоразовости.** Если один из участников упал, был прерван или не
дождался по таймауту, барьер переходит в «сломанное» состояние: все остальные получают
`BrokenBarrierException`, и дальше он бесполезен до `reset()`.

```java
try { barrier.await(); }
catch (BrokenBarrierException e) { /* кто-то из участников выбыл — фаза не состоится */ }
```

Логика жёсткая, но правильная: если участников меньше, чем требуется, ждать бессмысленно —
все зависли бы навсегда.

Область применения — итеративные вычисления по фазам: моделирование, обработка матриц,
многоэтапный батч, где следующий этап нельзя начать, пока все не закончили предыдущий.

---

## 3. `Semaphore` — «не больше N одновременно»

Самый практически полезный из пяти на бэкенде.

```java
Semaphore limit = new Semaphore(10);

limit.acquire();                 // берём разрешение (ждём, если их нет)
try { callExternalApi(); }
finally { limit.release(); }     // возвращаем — обязательно в finally

limit.tryAcquire();                              // не ждать вовсе
limit.tryAcquire(200, TimeUnit.MILLISECONDS);    // ждать ограниченно — быстрый отказ вместо очереди
```

### Чем он принципиально не лок

- **У разрешения нет владельца.** `release()` может вызвать любой поток, не только тот, что делал
  `acquire()`. Это позволяет «производить» разрешения — например, пополнять их по таймеру, получая
  ограничитель частоты.
- **Он не реентерабельный.** Двоичный семафор (`new Semaphore(1)`) — не замена `ReentrantLock`:
  повторный `acquire()` тем же потоком заблокирует его навсегда.
- **Разрешений можно вернуть больше, чем взяли** — счётчик просто вырастет. Ошибка в `finally`
  тихо расширит лимит, и обнаружится это только под нагрузкой.

### Зачем это на бэкенде

Ограничивать надо не потоки, а **ресурс**:

```java
// Внешний API разрешает 20 одновременных запросов — независимо от размера нашего пула
private final Semaphore apiLimit = new Semaphore(20);

// Тяжёлые отчёты не должны занимать всю память
private final Semaphore reportLimit = new Semaphore(2);
```

Это особенно важно на JDK 21: с виртуальными потоками пул перестаёт быть регулятором нагрузки,
и семафор становится основным способом сказать «не больше N»
([`VIRTUAL_THREADS.md`](VIRTUAL_THREADS.md), [`EXECUTORS_FUTURES.md §11`](EXECUTORS_FUTURES.md)).

Приём «отказать быстро вместо того, чтобы копить очередь»:

```java
if (!apiLimit.tryAcquire(100, TimeUnit.MILLISECONDS))
    throw new ServiceOverloadedException();   // лучше явная 503, чем таймаут через 30 с
```

---

## 4. `Phaser` — барьер с переменным составом

`CyclicBarrier` требует знать число участников заранее и не позволяет его менять. `Phaser` позволяет.

```java
Phaser phaser = new Phaser(1);            // 1 — сам управляющий поток

for (Task t : tasks) {
    phaser.register();                    // +1 участник, можно на ходу
    pool.submit(() -> {
        process(t);
        phaser.arriveAndDeregister();     // отработал и вышел из состава
    });
}
phaser.arriveAndAwaitAdvance();           // ждём закрытия фазы

// Можно управлять завершением
Phaser p = new Phaser(n) {
    protected boolean onAdvance(int phase, int registered) {
        log.info("фаза {} закрыта", phase);
        return phase >= 2 || registered == 0;   // true → фазер завершён
    }
};
```

Берут его, когда число участников **не известно заранее или меняется** между фазами. В остальных
случаях `CountDownLatch` или `CyclicBarrier` проще и понятнее. Для большого числа участников
`Phaser` умеет объединяться в дерево, снижая конкуренцию.

---

## 5. `Exchanger` — обмен между ровно двумя

```java
Exchanger<ByteBuffer> exchanger = new Exchanger<>();

// Поток-наполнитель                     // Поток-обработчик
buf = fill(buf);                          empty = process(full);
buf = exchanger.exchange(buf);            full  = exchanger.exchange(empty);
```

Оба потока блокируются, пока не встретятся, и обмениваются объектами. Сценарий один — **двойная
буферизация**: пока один буфер обрабатывается, второй наполняется, и аллокаций нет.

На практике встречается редко: в большинстве конвейеров вместо него берут `BlockingQueue` из двух
элементов — понятнее и гибче.

---

## 6. Что из этого действительно нужно

Честная оценка по частоте применения в серверном коде:

1. **`Semaphore`** — постоянно: ограничение конкурентности к любому внешнему ресурсу.
2. **`CountDownLatch`** — регулярно: готовность при старте, ожидание завершения, тесты.
3. **`CyclicBarrier`** — изредка: фазовые вычисления.
4. **`Phaser`**, **`Exchanger`** — почти никогда; знать надо, чтобы узнать в чужом коде и ответить
   на собеседовании.

И общее правило: если координация совпадает с границами задач — синхронизатор не нужен, хватит
`invokeAll`, `CompletableFuture.allOf` или `ExecutorService.awaitTermination`
([`EXECUTORS_FUTURES.md`](EXECUTORS_FUTURES.md)).

---

## 7. Шпаргалка

```
Дождаться N событий, один раз          → CountDownLatch
Запустить N потоков одновременно (тест) → CountDownLatch «стартовый пистолет»
Встретиться всем и пойти дальше, циклически → CyclicBarrier (осторожно: ломается)
Не больше N одновременно               → Semaphore  ← самый полезный на бэкенде
Быстрый отказ вместо очереди           → semaphore.tryAcquire(timeout)
Участники приходят и уходят            → Phaser
Обмен буферами между двумя потоками    → Exchanger (обычно проще BlockingQueue)
Просто дождаться задач                 → invokeAll / allOf / awaitTermination
```

---

## 8. Упражнения

- [`Ex10: Synchronizers`](../src/main/kotlin/exercises/Ex10_Synchronizers.kt) — `CountDownLatch`,
  `CyclicBarrier`, `Semaphore`, `Exchanger`.

---

## Вопросы для самопроверки

1. Что означает `state` у `CountDownLatch` и у `Semaphore`?
2. Чем `CountDownLatch` отличается от `CyclicBarrier` — по многоразовости и по тому, кто отсчитывает?
3. Как воспроизвести гонку в тесте так, чтобы потоки стартовали одновременно?
4. Что произойдёт с остальными участниками, если один поток на `CyclicBarrier` прервали?
5. Почему двоичный `Semaphore` — не замена `ReentrantLock`?
6. Почему `release()` может вызвать поток, который не делал `acquire()`, и как это использовать?
7. Что случится, если вызвать `release()` больше раз, чем `acquire()`?
8. Почему на JDK 21 с виртуальными потоками роль `Semaphore` возрастает?
9. Когда нужен `Phaser`, а не `CyclicBarrier`?

---

## Источники

**Официальная документация (JDK 21):**
- [`CountDownLatch`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CountDownLatch.html) — в javadoc есть канонический пример «стартового пистолета».
- [`CyclicBarrier`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CyclicBarrier.html) — про `BrokenBarrierException` и `reset()`.
- [`Semaphore`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Semaphore.html) — почему у разрешений нет владельца.
- [`Phaser`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Phaser.html) · [`Exchanger`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Exchanger.html)

**Исходники JDK 21:** `Semaphore.java` (183), `CountDownLatch.java` (`Sync`), `CyclicBarrier.java` (159).

**Книги / papers:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 5.5 (Synchronizers), Ch. 5.6 — пример с «стартовым пистолетом».
- [Doug Lea — «The java.util.concurrent Synchronizer Framework»](https://gee.cs.oswego.edu/dl/papers/aqs.pdf)
- [Heinz Kabutz — «Phaser, the most underused synchronizer»](https://www.javaspecialists.eu/archive/Issue199.html)
