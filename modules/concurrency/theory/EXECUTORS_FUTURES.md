# Пулы потоков: `ThreadPoolExecutor`, планировщик, `ForkJoinPool`

> **Какую проблему решает.** Поток стоит дорого, а задач много. Пул отвязывает «задачу» от «потока»:
> задачи ставятся в очередь, ограниченное число потоков их разбирает. Этот файл — про то, как
> выбрать это число, что делать с переполнением и какие три ловушки съедают ошибки молча.
> **Кому это надо.** Всем, кто настраивает `ThreadPoolExecutor` в продакшене или объясняет на
> собеседовании, почему `Executors.newFixedThreadPool` — плохая идея.
> **Когда НЕ надо.** На JDK 21 для блокирующего ввода-вывода пул часто вообще не нужен —
> см. §11 и [`VIRTUAL_THREADS.md`](VIRTUAL_THREADS.md).

Композиция асинхронных результатов (`CompletableFuture`) вынесена в
[`ASYNC_COMPOSITION.md`](ASYNC_COMPOSITION.md) — здесь только исполнение.
Все примеры прогнаны на Temurin 21.0.9.

---

## 1. Зачем пул

Из [`WHY_CONCURRENCY.md`](WHY_CONCURRENCY.md): поток стоит ~2 МБ стека и ~22 мкс на создание.
Пул решает сразу три задачи:

1. **Переиспользование.** Поток создаётся один раз и обслуживает тысячи задач.
2. **Ограничение.** Число потоков — это ваш предел нагрузки на процессор, на БД, на внешний сервис.
   Без ограничения всплеск трафика превращается в отказ.
3. **Очередь как буфер.** Кратковременный всплеск не роняет систему, а ждёт в очереди.

Третий пункт содержит и главную опасность: **очередь — это отложенная задержка**. Неограниченная
очередь не защищает ни от чего, она лишь превращает «отказ сразу» в «ответ через две минуты, когда
он уже не нужен».

---

## 2. `ThreadPoolExecutor`: откуда берутся его правила

### Одно слово состояния

Внутри пула всё состояние — это **один** `AtomicInteger`:

```java
// ThreadPoolExecutor.java:387
private final AtomicInteger ctl = new AtomicInteger(ctlOf(RUNNING, 0));
private static final int COUNT_BITS = Integer.SIZE - 3;      // 29
private static final int COUNT_MASK = (1 << COUNT_BITS) - 1;

private static final int RUNNING    = -1 << COUNT_BITS;      // старшие 3 бита
private static final int SHUTDOWN   =  0 << COUNT_BITS;
private static final int STOP       =  1 << COUNT_BITS;
private static final int TIDYING    =  2 << COUNT_BITS;
private static final int TERMINATED =  3 << COUNT_BITS;
```

Старшие 3 бита — состояние пула, младшие 29 — число живых потоков. Зачем такая упаковка: чтобы
**одним атомарным чтением** получить и то и другое согласованно. Иначе между «пул ещё работает?» и
«сколько потоков?» вклинился бы `shutdown()`.

Отсюда сразу следует формальный предел: `maximumPoolSize` не может превышать 2²⁹−1 ≈ 536 миллионов.
Практического значения это не имеет, но вопрос «почему именно столько» на собеседовании встречается.

### Алгоритм приёма задачи — и почему он именно такой

```java
// ThreadPoolExecutor.java:1339, упрощённо
int c = ctl.get();
if (workerCountOf(c) < corePoolSize) { if (addWorker(command, true)) return; }   // ① core
if (isRunning(c) && workQueue.offer(command)) { … }                              // ② очередь
else if (!addWorker(command, false)) reject(command);                            // ③ max, иначе отказ
```

Порядок: **core → очередь → max → отказ**. Это самый частый вопрос по пулам, и он же самый
контринтуитивный: если очередь неограниченная, потоки сверх `corePoolSize` **не создаются никогда**.

Почему так, а не «сначала расширить пул»: создание потока дороже, чем постановка в очередь, а сама
очередь и задумана как буфер. Новые потоки — крайняя мера, когда буфер уже переполнен.

**Практическое следствие.** `corePoolSize=10, maximumPoolSize=100` с `LinkedBlockingQueue` без
ограничения — это пул на 10 потоков. Остальные 90 не появятся, потому что очередь никогда не
откажется принять задачу.

### Семь параметров

```java
new ThreadPoolExecutor(
    int corePoolSize,                    // сколько потоков держим всегда
    int maximumPoolSize,                 // потолок при переполненной очереди
    long keepAliveTime, TimeUnit unit,   // сколько живёт поток сверх core без работы
    BlockingQueue<Runnable> workQueue,   // буфер; его ёмкость определяет всё поведение
    ThreadFactory threadFactory,         // имена потоков, демон, обработчик ошибок
    RejectedExecutionHandler handler     // что делать, когда всё занято
);
```

`ThreadFactory` часто игнорируют — зря. Осмысленные имена потоков экономят часы при разборе дампа:

```java
ThreadFactory named = r -> {
    Thread t = new Thread(r, "payment-worker-" + counter.incrementAndGet());
    t.setUncaughtExceptionHandler((th, e) -> log.error("необработанная ошибка в {}", th.getName(), e));
    return t;
};
```

---

## 3. Как выбрать размер пула

### Задачи, которые считают

Потолок — число ядер: больше потоков не дадут больше вычислений, только переключения.

```
N = число ядер            (иногда +1, чтобы закрыть редкие промахи по памяти)
```

### Задачи, которые ждут

Формула из *Java Concurrency in Practice* (§8.2):

```
N = Nядер × Uцелевая × (1 + W/C)

Uцелевая — желаемая загрузка процессора (0..1)
W        — время ожидания на задачу
C        — время вычислений на задачу
```

Для сквозного примера модуля (300 мс ожидания, ~1 мс вычислений, 10 ядер, загрузка 1.0):

```
N = 10 × 1 × (1 + 300/1) = 3010
```

Три тысячи потоков — это уже нереалистично, и это честный сигнал: для такой нагрузки модель «поток на
задачу» не подходит. Именно из этой арифметики выросли и асинхронный стиль
([`ASYNC_COMPOSITION.md`](ASYNC_COMPOSITION.md)), и виртуальные потоки.

Второй способ — закон Литтла (`L = λ × W`), см. [`WHY_CONCURRENCY.md §2`](WHY_CONCURRENCY.md).
Он даёт то же число, но исходя из измеренной нагрузки, а не из отношения W/C.

### Что на самом деле определяет размер

Обе формулы дают верхнюю границу «по производительности». В реальном сервисе размер пула чаще
диктуется **внешним ограничением**:

- пул соединений к БД — нет смысла в 50 потоках при 10 соединениях, лишние будут стоять в очереди
  за соединением, а вы не увидите этого в метриках пула;
- лимит запросов внешнего API — если разрешено 20 в секунду, пул на 200 потоков просто создаст 180
  ошибок;
- память: каждый занятый поток держит свои буферы и объекты запроса.

**Правило.** Считайте формулу, потом сравните с ограничениями снизу и возьмите минимум. И заведите
**отдельные пулы под разные зависимости** (bulkhead): медленный отчётный сервис не должен съедать
потоки, нужные платежам.

---

## 4. Очередь и политика отказа

| Очередь | Поведение | Когда |
|---|---|---|
| `ArrayBlockingQueue(n)` | ограниченная, ёмкость фиксирована | **основной выбор для продакшена** |
| `LinkedBlockingQueue(n)` | ограниченная, два лока — выше пропускная способность | много мелких задач |
| `LinkedBlockingQueue()` | **неограниченная** (`Integer.MAX_VALUE`) | почти никогда: скрывает перегрузку до OOM |
| `SynchronousQueue` | ёмкости нет, передача из рук в руки | вместе с большим `maximumPoolSize` |
| `PriorityBlockingQueue` | по приоритету, неограниченная | задачи разной важности |

Подробно про сами очереди — [`CONCURRENT_COLLECTIONS.md`](CONCURRENT_COLLECTIONS.md).

### Четыре политики отказа

| Политика | Что делает | Когда уместна |
|---|---|---|
| `AbortPolicy` (по умолчанию) | бросает `RejectedExecutionException` | быстрый явный отказ; вызывающий решает, что делать |
| `CallerRunsPolicy` | выполняет задачу **в вызывающем потоке** | обратное давление (backpressure): поставщик тормозится сам |
| `DiscardPolicy` | молча выбрасывает | почти никогда — потеря без следа |
| `DiscardOldestPolicy` | выбрасывает самую старую из очереди | когда свежие данные важнее старых (телеметрия) |

`CallerRunsPolicy` заслуживает пояснения: она не «спасает задачу», а **замедляет источник**. Пока
поток, принимающий HTTP-запросы, сам выполняет задачу, он не принимает новые — нагрузка естественным
образом снижается. Это самый простой рабочий механизм обратного давления в JDK.

Своя политика пишется в три строки — например, «подождать место в очереди, но не дольше секунды»:

```java
(task, executor) -> {
    try {
        if (!executor.getQueue().offer(task, 1, TimeUnit.SECONDS))
            throw new RejectedExecutionException("очередь переполнена");
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new RejectedExecutionException(e);
    }
}
```

---

## 5. Фабрики `Executors`: что они прячут

| Фабрика | Что создаёт на самом деле | Мина |
|---|---|---|
| `newFixedThreadPool(n)` | `ThreadPoolExecutor(n, n, 0, MS, new LinkedBlockingQueue<>())` | **очередь неограниченная** → рост до OOM |
| `newSingleThreadExecutor()` | то же с `n = 1` | та же неограниченная очередь |
| `newCachedThreadPool()` | `ThreadPoolExecutor(0, Integer.MAX_VALUE, 60, SEC, new SynchronousQueue<>())` | **потоков неограниченно** → тысячи потоков под всплеском |
| `newScheduledThreadPool(n)` | `ScheduledThreadPoolExecutor` с `DelayedWorkQueue` | очередь неограниченная; см. §8 |
| `newWorkStealingPool()` | `new ForkJoinPool(nCPU, …, asyncMode = true)` | порядок не гарантирован; блокировки голодят пул |
| `newVirtualThreadPerTaskExecutor()` | не пул: поток на задачу | ограничения нет вовсе — ограничивайте семафором |

Проверяется по исходнику (`Executors.java:93, 114, 216`).

```java
// ✅ Что писать вместо фабрик
new ThreadPoolExecutor(
    10, 20, 60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(200),                  // ограничена
    namedFactory("payments"),                       // имена в дампе
    new ThreadPoolExecutor.CallerRunsPolicy());     // обратное давление
```

**Формулировка для собеседования.** «`newFixedThreadPool` опасен не числом потоков, а неограниченной
очередью: перегрузка не отвергается, а копится в куче, пока не кончится память. И `maximumPoolSize`
при такой очереди не работает вовсе».

---

## 6. Жизненный цикл и корректная остановка

```
RUNNING → SHUTDOWN → TIDYING → TERMINATED
   │          ↑
   └── STOP ──┘
```

```java
executor.shutdown();          // новые не принимаем, принятые доделываем
executor.shutdownNow();       // + прерываем выполняющиеся, возвращаем невыполненные
executor.awaitTermination(t, unit);   // ждём завершения
```

Канонический вариант остановки — из javadoc `ExecutorService`:

```java
executor.shutdown();
try {
    if (!executor.awaitTermination(60, TimeUnit.SECONDS)) {
        executor.shutdownNow();                                  // не успели — прерываем
        if (!executor.awaitTermination(10, TimeUnit.SECONDS))
            log.error("пул не остановился");
    }
} catch (InterruptedException e) {
    executor.shutdownNow();
    Thread.currentThread().interrupt();      // восстановить флаг — см. THREADS_BASICS.md §4
}
```

Два замечания:

- `shutdownNow()` **прерывает** задачи, то есть работает только для тех, кто реагирует на
  прерывание ([`THREADS_BASICS.md §4`](THREADS_BASICS.md)). Задача в блокирующем `read()` его
  проигнорирует.
- Потоки пула по умолчанию **не демоны**: забытый `shutdown()` не даёт JVM завершиться.

---

## 7. Три ловушки, которые съедают ошибки

### 7.1 `submit()` проглатывает исключение, `execute()` — нет

```java
// PoolTraps.java
pool.execute(() -> { throw new IllegalStateException("из execute"); });
Future<?> f = pool.submit(() -> { throw new IllegalStateException("из submit"); });
```

```
UncaughtExceptionHandler: из execute
после submit: в консоли ничего не появилось, isDone=true
ошибка нашлась только в f.get(): из submit
```

`submit()` заворачивает задачу в `FutureTask`, который **ловит любое исключение и кладёт его в
`Future`**. Если результат никто не запрашивает — а при `Runnable` его обычно не запрашивают, —
ошибка исчезает бесследно. `UncaughtExceptionHandler` при этом не срабатывает: с точки зрения
потока никакого исключения не было.

**Правило.** Не нужен результат — используйте `execute()`. Если всё же `submit()` — либо
обязательно читайте `Future`, либо оберните тело задачи в `try/catch` с логированием.

### 7.2 Периодическая задача умирает от первого же исключения

```java
ses.scheduleAtFixedRate(() -> {
    int n = runs.incrementAndGet();
    if (n == 3) throw new IllegalStateException("упало на третьем запуске");
}, 0, 100, TimeUnit.MILLISECONDS);
```

```
запуск 1
запуск 2
запуск 3
прошла секунда; всего запусков: 3 (ожидали бы ~10)
isDone=true, isCancelled=false
причина видна только через get(): упало на третьем запуске
```

Javadoc `ScheduledExecutorService` говорит прямо: если очередной запуск бросил исключение,
**«Subsequent executions are suppressed»**. Задача отменяется навсегда и молча.

Это классический продакшен-инцидент: фоновая синхронизация «работала полгода», а потом однажды
упала на сетевой ошибке — и с тех пор не запускалась, потому что никто не смотрел в `Future`.

**Правило.** Тело периодической задачи **всегда** оборачивается целиком:

```java
ses.scheduleAtFixedRate(() -> {
    try { syncCatalog(); }
    catch (Throwable t) { log.error("ошибка синхронизации, продолжаем по расписанию", t); }
}, 0, 1, TimeUnit.MINUTES);
```

### 7.3 `ThreadLocal` переживает задачу

Потоки пула живут вечно, значит и значения `ThreadLocal` в них тоже. Следующая задача увидит чужой
контекст — разбор и замер в [`THREADS_BASICS.md §7`](THREADS_BASICS.md). Убирайте в `finally`.

---

## 8. `ScheduledExecutorService`

```java
ses.schedule(task, 5, SECONDS);                       // один раз через 5 с
ses.scheduleAtFixedRate(task, 0, 10, SECONDS);        // старт каждые 10 с «по часам»
ses.scheduleWithFixedDelay(task, 0, 10, SECONDS);     // 10 с паузы ПОСЛЕ завершения
```

Разница видна, когда задача длится дольше периода:

```
Задача 3 с, период 10 с:
  AtFixedRate:    старт в 0, 10, 20, 30 …    (по расписанию)
  WithFixedDelay: старт в 0, 13, 26, 39 …    (пауза от конца предыдущего)

Задача 15 с, период 10 с:
  AtFixedRate:    старт в 0, 15, 30 …        наложения НЕ будет, запуски просто опаздывают
  WithFixedDelay: старт в 0, 25, 50 …        пауза всегда выдерживается
```

Правило выбора: важна **частота** (сбор метрик, heartbeat) — `AtFixedRate`; важно **не нагружать
систему подряд** (тяжёлая синхронизация, обход БД) — `WithFixedDelay`.

Оговорка: `ScheduledThreadPoolExecutor` — не cron. Он не переживает перезапуск, не знает про часовые
пояса и не координируется между экземплярами приложения. Для расписания в кластере нужен внешний
планировщик.

---

## 9. `ForkJoinPool`

### Идея

Пул для задач, которые **делятся на подзадачи** и ждут их результата. У каждого потока своя
двусторонняя очередь; когда она пустеет, поток **крадёт** задачу с другого конца чужой очереди
(work-stealing).

```
Поток 1: [A][B][C]   ← свои задачи кладёт и берёт с одного конца (LIFO)
                  ↑
Поток 2: []       крадёт с противоположного конца (FIFO) — обычно самую крупную
```

LIFO для своих — лучшая локальность кэша (только что созданная подзадача ещё «горячая»).
FIFO для краж — старая задача обычно крупнее, значит одна кража даёт больше работы.

### Поправка: `newWorkStealingPool` работает не так

Порядок LIFO — у **обычного** `ForkJoinPool` и `commonPool`. Фабрика
`Executors.newWorkStealingPool()` передаёт `asyncMode = true` (`Executors.java:114`), а это, по
javadoc конструктора, «establishes local **first-in-first-out** scheduling mode for forked tasks
that are never joined» — то есть локальная очередь становится FIFO. Режим предназначен для потока
независимых событий, а не для рекурсивного деления.

### `RecursiveTask` и порог деления

```java
class SumTask extends RecursiveTask<Long> {
    private static final int THRESHOLD = 10_000;   // ниже порога — считаем сами
    protected Long compute() {
        if (hi - lo <= THRESHOLD) return computeDirectly();
        SumTask left  = new SumTask(lo, mid);
        SumTask right = new SumTask(mid, hi);
        left.fork();                      // отдали в пул
        long r = right.compute();         // ← правую считаем сами, не создавая лишнюю задачу
        return left.join() + r;
    }
}
```

Порог — главный параметр: слишком мелкий даёт больше накладных расходов, чем работы; слишком крупный
не загружает ядра. Приём `fork()` одной половины и `compute()` другой в текущем потоке — стандартный,
он вдвое сокращает число задач.

`RecursiveAction` — то же без результата.

### `commonPool` и блокировки

`ForkJoinPool.commonPool()` обслуживает `parallelStream()` и `CompletableFuture.*Async` без явного
пула. Параллелизм по умолчанию — `availableProcessors() - 1` (на этой машине 9 при 10 ядрах).

Что бывает, если занять его блокирующими задачами, показано в
[`ASYNC_COMPOSITION.md §5`](ASYNC_COMPOSITION.md): параллельный поток данных из 8 элементов по 100 мс
занял **830 мс вместо ~100**.

Если блокирующего вызова в `ForkJoinPool` не избежать, есть штатный способ сообщить пулу об этом,
чтобы он временно поднял дополнительный поток:

```java
ForkJoinPool.managedBlock(new ForkJoinPool.ManagedBlocker() {
    public boolean block() throws InterruptedException { result = queue.take(); return true; }
    public boolean isReleasable() { return result != null; }
});
```

На практике проще не блокировать `ForkJoinPool` вовсе и завести отдельный `ThreadPoolExecutor`.

---

## 10. Группы задач

```java
// Все задачи, ждём всех. Блокирует до завершения последней (или таймаута).
List<Future<String>> all = executor.invokeAll(callables);

// Первый успешный результат; остальные отменяются
String fastest = executor.invokeAny(callables);

// Результаты по мере готовности — а не в порядке отправки
var ecs = new ExecutorCompletionService<String>(executor);
tasks.forEach(ecs::submit);
for (int i = 0; i < tasks.size(); i++) {
    Future<String> done = ecs.take();     // первый завершившийся
    process(done.get());
}
```

`ExecutorCompletionService` — недооценённый инструмент: если задачи разной длительности, он позволяет
начать обработку с первой готовой, а не ждать самую медленную.

---

## 11. Что меняется на JDK 21

Виртуальные потоки убирают исходную посылку «поток дорог, поэтому его надо переиспользовать».
Для блокирующего ввода-вывода:

```java
// Было: пул, размер которого приходилось угадывать
ExecutorService pool = new ThreadPoolExecutor(50, 50, …);

// Стало: поток на задачу, ограничение — отдельно и явно
ExecutorService ex = Executors.newVirtualThreadPerTaskExecutor();
Semaphore dbLimit = new Semaphore(10);     // ограничиваем ресурс, а не потоки
```

Важный сдвиг мышления: **пул перестаёт быть регулятором нагрузки**. Раньше «10 потоков» одновременно
означало и «10 задач», и «10 соединений к БД». Теперь ограничивать надо то, что действительно
ограничено — соединения, запросы к API, память — семафором.

Для задач, которые считают, пул остаётся правильным ответом: виртуальные потоки не добавляют ядер.
Подробности — [`VIRTUAL_THREADS.md`](VIRTUAL_THREADS.md).

---

## 12. Шпаргалка

```
Задачи считают                       → пул размером с число ядер
Задачи ждут                          → N = Nядер × U × (1 + W/C), но не больше внешнего лимита
Продакшен-пул                        → ThreadPoolExecutor + ArrayBlockingQueue + CallerRunsPolicy + имена
Нужно затормозить поставщика         → CallerRunsPolicy
Нужен быстрый отказ                  → AbortPolicy (по умолчанию)
Периодическая задача                 → тело ВСЕГДА в try/catch, иначе умрёт навсегда
Не нужен результат                   → execute(), а не submit()
Разные зависимости                   → разные пулы (bulkhead)
Деление задачи на подзадачи          → ForkJoinPool + RecursiveTask, порог деления
Блокировка внутри ForkJoinPool       → ManagedBlocker или, лучше, отдельный пул
Результаты по мере готовности        → ExecutorCompletionService
JDK 21, блокирующий ввод-вывод       → виртуальные потоки + Semaphore на ресурс
```

---

## 13. Упражнения

- [`Ex09: ForkJoinMergeSort`](../src/main/kotlin/exercises/Ex09_ForkJoinMergeSort.kt) — `RecursiveTask`,
  порог деления.
- [`Ex16: ExecutorService Deep`](../src/main/kotlin/exercises/Ex16_ExecutorServiceDeep.kt) — все типы
  пулов, политики отказа, `invokeAll`/`invokeAny`/`CompletionService`.
- [`Ex18: Scheduled & ForkJoin`](../src/main/kotlin/exercises/Ex18_ScheduledExecutorAndForkJoin.kt) —
  `AtFixedRate` против `WithFixedDelay`, ограничитель частоты, map-reduce.

---

## Вопросы для самопроверки

1. Что лежит в `ctl` у `ThreadPoolExecutor` и зачем состояние с числом потоков упакованы в одно слово?
2. В каком порядке пул пытается пристроить задачу? Почему сначала очередь, а не новый поток?
3. У пула `core=10, max=100, LinkedBlockingQueue()`. Сколько потоков будет под нагрузкой? Почему?
4. Как посчитать размер пула для задач, которые ждут? Что важнее формулы?
5. Чем `CallerRunsPolicy` отличается от остальных политик по смыслу, а не по механике?
6. Куда девается исключение из `submit(Runnable)`? А из `execute(Runnable)`?
7. Периодическая задача бросила исключение на третьем запуске. Что будет с четвёртым?
8. `AtFixedRate` против `WithFixedDelay` — что выбрать для сбора метрик, а что для тяжёлой синхронизации?
9. Почему `Executors.newWorkStealingPool()` работает не в LIFO-режиме?
10. Почему блокирующая задача в `commonPool` замедляет `parallelStream` в другом месте программы?
11. Что перестаёт быть верным про пулы на JDK 21 с виртуальными потоками?

---

## Источники

**Исходники JDK 21:** `java/util/concurrent/ThreadPoolExecutor.java` (`ctl` — 387, `execute` — 1339),
`java/util/concurrent/Executors.java` (`newFixedThreadPool` — 93, `newWorkStealingPool` — 114,
`newCachedThreadPool` — 216), `java/util/concurrent/ForkJoinPool.java` (`asyncMode` — 2595, 2715).

**Официальная документация:**
- [`ThreadPoolExecutor` Javadoc (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html) — алгоритм приёма задач и политики отказа.
- [`ScheduledExecutorService` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ScheduledExecutorService.html) — «Subsequent executions are suppressed».
- [`ForkJoinPool` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ForkJoinPool.html) · [`ManagedBlocker`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ForkJoinPool.ManagedBlocker.html)
- [`ExecutorService` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ExecutorService.html) — эталонный код остановки пула.

**Книги / papers:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 6 (Task Execution), Ch. 8 (Applying
  Thread Pools) — оттуда формула размера пула; Ch. 7 (Cancellation and Shutdown).
- *Effective Java*, 3rd ed. (Bloch, 2018) — Item 80 («Prefer executors, tasks, and streams to threads»).
- [Doug Lea — «A Java Fork/Join Framework» (PPoPP 2000)](https://gee.cs.oswego.edu/dl/papers/fj.pdf) — теория work-stealing.

**Разборы:**
- [Heinz Kabutz — «ExecutorService — 10 tips and tricks»](https://www.javaspecialists.eu/archive/Issue222.html)
- [Netflix — «Performance under load» (adaptive concurrency limits)](https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581) — почему фиксированный размер пула плохо переносит изменение нагрузки.
