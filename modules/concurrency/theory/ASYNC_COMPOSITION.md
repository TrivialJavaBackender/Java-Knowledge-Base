# `CompletableFuture`: зачем он нужен и как устроен внутри

> **Какую проблему решает.** `Future.get()` блокирует поток, а колбеки выворачивают код наизнанку.
> `CompletableFuture` — способ описать «что сделать, когда результат появится», не занимая поток
> ожиданием и не проваливаясь в пирамиду колбеков.
> **Кому это надо.** Тому, кто вызывает несколько внешних сервисов на один запрос и хочет делать это
> одновременно; тому, кто поддерживает существующий код на `CompletableFuture`; и тому, кого
> спросят «где выполнится `thenApply`» — а спросят обязательно.
> **Когда НЕ надо.** Если вызов один и он блокирующий — `CompletableFuture` не даст ничего, кроме
> сложности. На JDK 21 для новых сервисов виртуальные потоки часто честнее: тот же выигрыш без
> перестройки кода ([`VIRTUAL_THREADS.md`](VIRTUAL_THREADS.md)).

Про пулы, которые всё это исполняют, — [`EXECUTORS_FUTURES.md`](EXECUTORS_FUTURES.md).
Все примеры прогнаны на **Temurin 21.0.9**; выводы в блоках — реальные, а не придуманные.

---

## 1. Задача и четыре попытки её решить

Сквозной пример: собрать страницу профиля. Три вызова по 100 мс, причём заказы и настройки
**не зависят друг от друга** и могли бы идти одновременно.

### Попытка 1: блокирующий код

```java
Profile profile = api.fetchProfile(id);   // 100 мс — поток стоит
Orders  orders  = api.fetchOrders(id);    // 100 мс — поток стоит
Prefs   prefs   = api.fetchPrefs(id);     // 100 мс — поток стоит
return render(profile, orders, prefs);
```

300 мс, один поток занят целиком. Читается идеально, отлаживается идеально. Проблема одна: по закону
Литтла при 1000 rps таких потоков нужно 300 ([`WHY_CONCURRENCY.md`](WHY_CONCURRENCY.md)).

### Попытка 2: `Future.get()` — асинхронность, которой нет

```java
Future<Orders> o = pool.submit(() -> api.fetchOrders(id));
Future<Prefs>  p = pool.submit(() -> api.fetchPrefs(id));
Orders orders = o.get();       // ← блокирует ровно так же
Prefs  prefs  = p.get();
```

Два вызова действительно пошли параллельно, задержка упала до ~200 мс. Но **вызывающий поток всё
равно стоит** на `get()`. Мы не убрали блокировку, а размножили потоки: теперь заняты три вместо
одного.

Что ещё нельзя сделать с `Future`:

```java
future.thenApply(...)          // ❌ нет цепочек
future.onComplete(...)         // ❌ нельзя подписаться на завершение
combine(f1, f2)                // ❌ нельзя скомбинировать
future.exceptionally(...)      // ❌ ошибка достаётся только через try/catch вокруг get()
if (future.isDone()) ...       // единственный неблокирующий способ хоть что-то узнать
```

`Future` — это «расписка на результат», а не средство композиции. Отсюда и следующий шаг.

### Попытка 3: колбеки

```java
api.fetchProfile(id, profile ->
    api.fetchOrders(id, orders ->
        api.fetchPrefs(id, prefs ->
            respond(render(profile, orders, prefs)),
        error -> respond(error)),                    // обработка на каждом уровне
    error -> respond(error)),
error -> respond(error));
```

Поток свободен — цель достигнута. Цена:

- **Вложенность растёт с числом шагов**, и её нельзя вынести в метод, не разорвав цепочку.
- **`try/catch` не работает.** Исключение возникает в потоке HTTP-клиента, а не в вашем; оператор
  вокруг вызова его не увидит.
- **Обработка ошибок дублируется** на каждом уровне вручную.
- **Отмена и таймаут** делаются руками, потому что общего объекта «эта операция» не существует.

### Попытка 4: `CompletableFuture`

```java
CompletableFuture<Profile> p = supplyAsync(() -> api.fetchProfile(id), pool);
CompletableFuture<Orders>  o = supplyAsync(() -> api.fetchOrders(id),  pool);
CompletableFuture<Prefs>   f = supplyAsync(() -> api.fetchPrefs(id),   pool);

return p.thenCombine(o, Pair::of)
        .thenCombine(f, (pair, prefs) -> render(pair.a, pair.b, prefs))
        .exceptionally(this::fallbackPage);        // одна обработка на всю цепочку
```

Пирамида стала цепочкой, ошибка обрабатывается один раз, задержка ~100 мс. Это и есть ответ на
вопрос «зачем он нужен».

**Чего `CompletableFuture` не делает:** он **не превращает блокирующий вызов в неблокирующий**.
Если `api.fetchProfile` внутри — обычный блокирующий HTTP-клиент, то поток из `pool` будет так же
стоять 100 мс. Выигрыш появляется, только если под капотом действительно неблокирующий клиент
(или если задача просто вынесена с потока запроса на фоновый пул).

---

## 2. Что такое `CompletableFuture` внутри

Весь класс держится на **двух полях** (`CompletableFuture.java`, JDK 21):

```java
volatile Object result;       // Either the result or boxed AltResult
volatile Completion stack;    // Top of Treiber stack of dependent actions
```

`result` — либо значение, либо обёртка `AltResult` с исключением. `stack` — **стек Трейбера**
(lock-free стек на CAS) из «зависимых действий»: всё, что вы навесили через `thenApply`,
`thenAccept`, `thenCombine`, лежит в нём отдельными узлами.

```java
// CompletableFuture.java:467
abstract static class Completion extends ForkJoinTask<Void>
    implements Runnable, AsynchronousCompletionTask {
    volatile Completion next;              // Treiber stack link
    abstract CompletableFuture<?> tryFire(int mode);   // SYNC, ASYNC или NESTED
    public final void run() { tryFire(ASYNC); }
}
```

### Что делает `thenApply`

```java
// CompletableFuture.java:657
private <V> CompletableFuture<V> uniApplyStage(Executor e, Function<? super T,? extends V> f) {
    if (f == null) throw new NullPointerException();
    Object r;
    if ((r = result) != null)                  // ① результат УЖЕ есть
        return uniApplyNow(r, e, f);           //    считаем прямо здесь и сейчас
    CompletableFuture<V> d = newIncompleteFuture();
    unipush(new UniApply<T,V>(e, d, this, f)); // ② иначе кладём узел на стек
    return d;                                  //    и сразу возвращаем пустой CompletableFuture
}
```

Две ветки — и вся «магия» `CompletableFuture` в них:

- **①** Если результат готов, функция выполняется **немедленно, в вызывающем потоке**. Никакой
  асинхронности нет вообще — это fast path.
- **②** Если не готов, создаётся новый пустой `CompletableFuture` и **узел кладётся на стек**
  зависимых действий. Метод возвращается мгновенно, ничего не выполнив.

### Что происходит при завершении

```java
// CompletableFuture.java:492
final void postComplete() {
    /*
     * On each step, variable f holds current dependents to pop and run.
     * It is extended along only one path at a time,
     * pushing others to avoid unbounded recursion.
     */
    CompletableFuture<?> f = this; Completion h;
    while ((h = f.stack) != null || (f != this && (h = (f = this).stack) != null)) {
        ...
        f = (d = h.tryFire(NESTED)) == null ? this : d;
    }
}
```

Тот, кто завершил `CompletableFuture` (вызвал `complete`, либо задача в пуле вернула значение), **сам снимает
стек зависимостей и выполняет их**. Обратите внимание на комментарий JDK: цикл, а не рекурсия,
«pushing others to avoid unbounded recursion» — иначе длинная цепочка стадий переполнила бы стек.

> **Ключевой тезис.** `CompletableFuture` — это стек колбеков, написанный руками. Корутина Kotlin —
> такой же стек, но сгенерированный компилятором, и в ней тоже есть цикл вместо рекурсии
> (`BaseContinuationImpl.resumeWith`). Отсюда и похожие правила, и похожие ловушки —
> см. [`kotlin-coroutines/SUSPEND_INTERNALS.md`](../../kotlin-coroutines/theory/SUSPEND_INTERNALS.md).

---

## 3. Отсюда выводятся все правила «где выполнится код»

Механика из §2 отвечает на самый частый вопрос по `CompletableFuture` без всякого заучивания.
Прогон, подтверждающий каждый случай:

```java
// CFWhere.java — java CFWhere.java
CompletableFuture<String> notReady = new CompletableFuture<>();
notReady.thenApply(v -> { print("thenApply в: " + threadName()); return v; });
new Thread(() -> notReady.complete("x"), "завершитель").start();   // A

CompletableFuture.completedFuture("x")
    .thenApply(v -> { print("thenApply в: " + threadName()); return v; });   // B

CompletableFuture.supplyAsync(() -> { print("supplyAsync в: " + threadName()); return 1; })
    .thenApply(v -> { print("thenApply в: " + threadName()); return v; })
    .thenApplyAsync(v -> { print("thenApplyAsync в: " + threadName()); return v; });   // C
```

```
--- A. результата ещё нет: колбек выполнит тот, кто завершит ---
  thenApply в: завершитель
--- B. результат уже есть: колбек выполнит вызывающий поток ---
  thenApply в: main
--- C. supplyAsync без executor ---
  supplyAsync в:   ForkJoinPool.commonPool-worker-1
  thenApply в:     ForkJoinPool.commonPool-worker-1
  thenApplyAsync в: ForkJoinPool.commonPool-worker-1
```

**Правило, которое из этого следует.** `thenApply` не выбирает поток — он выполняется там, где
оказался результат: у того, кто его завершил (ветка ②), либо прямо у вызывающего (ветка ①).
Значит:

- Никогда не полагайтесь на то, в каком потоке выполнится стадия без суффикса `Async`.
- **Не кладите в неасинхронные стадии ничего долгого или блокирующего.** Иначе вы займёте чужой
  поток — например, поток-обработчик ответа HTTP-клиента, — и подвесите всю его работу.
- Нужна гарантия — используйте `*Async(fn, executor)` с **явным** пулом.

---

## 4. Карта методов, выведенная из типов

Заучивать тридцать методов не нужно: имя однозначно выводится из того, что возвращает ваша функция.

| Ваша функция | Метод | Результат |
|---|---|---|
| `T → U` (значение) | `thenApply` | `CF<U>` |
| `T → CF<U>` (ещё один future) | `thenCompose` | `CF<U>` |
| `T → void` | `thenAccept` | `CF<Void>` |
| ничего не принимает и не возвращает | `thenRun` | `CF<Void>` |
| `(T, U) → V`, два независимых источника | `thenCombine` | `CF<V>` |
| `(T, U) → void` | `thenAcceptBoth` | `CF<Void>` |
| любой из двух, что успеет | `applyToEither` / `acceptEither` | `CF<U>` / `CF<Void>` |

Единственное место, где ошибаются, — `thenApply` против `thenCompose`. Разница видна по типу:

```java
CF<Profile> a = cf.thenApply(id -> loadProfile(id));      // loadProfile: Long → Profile     ✅
CF<CF<Profile>> b = cf.thenApply(id -> fetchProfile(id)); // fetchProfile: Long → CF<Profile> ❌ вложенный
CF<Profile> c = cf.thenCompose(id -> fetchProfile(id));   //                                  ✅
```

Если функция сама возвращает `CompletableFuture`, `thenApply` завернёт его ещё раз и получится
`CF<CF<…>>`, который придётся разворачивать вручную. `thenCompose` разворачивает сам. Это ровно
соотношение `map` и `flatMap`, но полезнее помнить не аналогию, а тип результата.

### Ожидание нескольких

```java
// Все — но allOf возвращает CF<Void>, результаты забираются отдельно
List<CompletableFuture<String>> futures = urls.stream()
    .map(u -> supplyAsync(() -> fetch(u), pool))
    .toList();

CompletableFuture<List<String>> all =
    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
        .thenApply(v -> futures.stream().map(CompletableFuture::join).toList());
//                                              ↑ здесь join уже не блокирует: все завершены
```

```java
// Любой — но anyOf возвращает CF<Object>, нужен приведение типа
CompletableFuture<Object> any = CompletableFuture.anyOf(f1, f2, f3);
```

---

## 5. Кто исполняет: суффикс `Async` и ловушка `commonPool`

```java
cf.thenApply(fn);                   // где окажется результат — см. §3
cf.thenApplyAsync(fn);              // в ForkJoinPool.commonPool()
cf.thenApplyAsync(fn, executor);    // в указанном пуле  ← единственный предсказуемый вариант
```

`supplyAsync`/`runAsync` без указания пула тоже уходят в `ForkJoinPool.commonPool()`. Это тот же
самый пул, который обслуживает **все параллельные потоки данных** (`parallelStream`) в JVM.
Его параллелизм по умолчанию — `availableProcessors() - 1`.

Что происходит, если занять его блокирующими задачами:

```java
// CommonPool.java — java CommonPool.java
int par = ForkJoinPool.getCommonPoolParallelism();
CountDownLatch hold = new CountDownLatch(1);
for (int i = 0; i < par; i++)
    CompletableFuture.runAsync(() -> hold.await());     // заняли весь commonPool

IntStream.range(0, 8).parallel().map(x -> { sleep(100); return x; }).boxed().toList();
```

```
параллелизм commonPool = 9
parallelStream из 8 элементов по 100 мс занял 830 мс (ожидали бы ~100-200)
```

Параллельный поток данных выродился в последовательный: свободных потоков не осталось. И заметьте —
код, который пострадал, находится в совершенно другом месте программы и про `CompletableFuture`
ничего не знает.

**Правила:**

- В приложении **всегда передавайте свой `Executor`** в `supplyAsync` и `*Async`. `commonPool` —
  общий ресурс JVM, а не ваш пул.
- Не выполняйте блокирующие операции в `commonPool` (и вообще в `ForkJoinPool`) без
  `ManagedBlocker` — см. [`EXECUTORS_FUTURES.md`](EXECUTORS_FUTURES.md).
- Заведите **отдельные пулы под разные внешние системы**: медленный отчётный сервис не должен
  съедать потоки, которыми пользуется платёжный.

### Почему `join()` внутри стадии — ошибка

```java
// ❌ Стадия выполняется в потоке пула и блокирует его ожиданием другой задачи того же пула
cf.thenApplyAsync(v -> other.join(), pool);
```

Если `other` ждёт свободного потока в том же `pool`, а этот поток занят ожиданием `other`, —
получается взаимная блокировка через пул. Чем меньше пул, тем вероятнее. Правильно — связать стадии:
`cf.thenCompose(v -> other)`.

---

## 6. Ошибки: две обёртки и позиция в цепочке

### Почему исключение приходит завёрнутым — и по-разному

```java
CompletableFuture<String> failed = supplyAsync(() -> { throw new IllegalStateException("бум"); });
failed.join();   // ?
failed.get();    // ?
```

```
join()  бросил: CompletionException -> IllegalStateException
get()   бросил: ExecutionException  -> IllegalStateException
```

`get()` объявлен в интерфейсе `Future` и обязан бросать проверяемое `ExecutionException`.
`join()` — собственный метод `CompletableFuture`, он бросает непроверяемое `CompletionException`,
чтобы его можно было вызывать внутри лямбд без `try/catch`. Настоящая причина в обоих случаях —
в `getCause()`.

**Практическое следствие:** в `exceptionally`/`handle` вам приходит именно **обёртка**, а не ваше
исключение:

```java
cf.exceptionally(ex -> {
    Throwable real = (ex instanceof CompletionException) ? ex.getCause() : ex;
    if (real instanceof TimeoutException) return cached();
    return fallback();
});
```

### Позиция `exceptionally` определяет, что она поймает

```
exceptionally ПЕРЕД thenApply:  запасной → шаг 2
exceptionally ПОСЛЕ падения не сработает: поймано handle: шаг 2
```

`exceptionally` видит только то, что упало **выше по цепочке**. Ошибка в стадии, стоящей ниже,
пролетит мимо. Это ровно то же правило, что у `catch` в `Flow` корутин: оператор видит апстрим,
не даунстрим.

**Правило.** Обработчик ставится **в конце цепочки** — либо по одному после каждого участка,
который вы хотите деградировать отдельно.

### Три обработчика и чем они отличаются

```java
cf.exceptionally(ex -> defaultValue);         // только ошибка → значение. Успех проходит мимо.
cf.handle((v, ex) -> ex != null ? d : f(v));  // и успех, и ошибка → новое значение. Может «съесть» ошибку.
cf.whenComplete((v, ex) -> log(v, ex));       // побочный эффект; результат НЕ меняется
```

```
whenComplete увидел: исходный
после whenComplete результат: исходный
```

`whenComplete` — для логирования и метрик: он пропускает и значение, и ошибку дальше без изменений.
Если внутри `whenComplete` бросить исключение, оно заменит исходное — и это классический способ
потерять настоящую причину сбоя.

---

## 7. Отмена и таймауты: чего они на самом деле не делают

### `cancel(true)` не прерывает работу

Javadoc `CompletableFuture.cancel` (JDK 21, строка 2503) говорит прямо:

> *`mayInterruptIfRunning` — **this value has no effect in this implementation** because interrupts
> are not used to control processing.*

Прогон:

```
cancel(true) вернул: true, isCancelled=true
задача доработала до конца, хотя future отменён
```

`cancel` переводит **сам объект `CompletableFuture`** в состояние «отменён» — те, кто его ждёт, получат
`CancellationException`. Но задача, уже выполняющаяся в пуле, продолжает занимать поток до конца.
Это отличие от `FutureTask` (который `Future` от `ExecutorService`): там `cancel(true)` реально
вызывает `Thread.interrupt()`.

### `orTimeout` не останавливает работу

```java
supplyAsync(() -> { sleep(500); return "поздно"; }).orTimeout(200, MILLISECONDS);
```

```
join() бросил: TimeoutException
медленная задача всё равно закончилась
```

Таймаут завершает **объект `CompletableFuture`**, а не задачу. Поток продолжает быть занят все 500 мс. Если внешняя
система «залипла» на 30 секунд, `orTimeout(1, SECONDS)` вернёт вам ошибку через секунду, но поток
из пула освободится только через 30. Настоящий таймаут должен быть **на клиенте** (`HttpClient`,
JDBC, драйвере) — только он умеет закрыть соединение.

`completeOnTimeout(fallback, t, unit)` — та же механика, но вместо ошибки подставляет значение.

### «Первый успешный» через `anyOf` не получится

```
anyOf УПАЛ: реплика A упала  ← а «B» был бы успешен
```

`anyOf` завершается по **первому завершившемуся**, включая упавший. Для «первого успешного» нужна
своя сборка:

```java
static <T> CompletableFuture<T> firstSuccessful(List<CompletableFuture<T>> list) {
    CompletableFuture<T> result = new CompletableFuture<>();
    AtomicInteger left = new AtomicInteger(list.size());
    for (CompletableFuture<T> f : list)
        f.whenComplete((v, ex) -> {
            if (ex == null) result.complete(v);                 // первый успех выигрывает
            else if (left.decrementAndGet() == 0)
                result.completeExceptionally(ex);               // упали все
        });
    result.whenComplete((v, ex) -> list.forEach(f -> f.cancel(false)));  // остальные больше не нужны
    return result;
}
```

---

## 8. Рецепты

```java
// Повтор с паузой (Java 12+: exceptionallyCompose)
static <T> CompletableFuture<T> retry(Supplier<CompletableFuture<T>> action, int attempts, Duration pause) {
    CompletableFuture<T> cf = action.get();
    for (int i = 1; i < attempts; i++)
        cf = cf.exceptionallyCompose(ex -> delayed(pause).thenCompose(v -> action.get()));
    return cf;
}
static CompletableFuture<Void> delayed(Duration d) {
    return CompletableFuture.runAsync(() -> {}, CompletableFuture.delayedExecutor(d.toMillis(), MILLISECONDS));
}

// Деградация некритичного вызова: страница соберётся и без рекомендаций
CompletableFuture<List<Item>> recs = supplyAsync(() -> recSvc.get(id), pool)
    .completeOnTimeout(List.of(), 150, MILLISECONDS)
    .exceptionally(ex -> List.of());

// Приведение блокирующего API к CompletableFuture
CompletableFuture<Row> row = supplyAsync(() -> jdbc.query(sql), dbPool);   // dbPool ≈ размеру пула соединений
```

`CompletableFuture.delayedExecutor` (Java 9+) — штатный способ «сделать через N мс» без собственного
`ScheduledExecutorService`.

---

## 9. Что выбирать сейчас

| | Поток занят ожиданием | Код читается линейно | Отмена | Когда брать |
|---|---|---|---|---|
| Блокирующий код + пул | да | да | через `Future.cancel(true)` | обычный сервис, нагрузка укладывается в пул |
| `CompletableFuture` | нет | частично | **условная** (§7) | есть неблокирующий клиент; поддержка существующего кода |
| Виртуальные потоки (JDK 21) | нет | да | `interrupt` работает | новый код на JDK 21+, много блокирующего ввода-вывода |
| Корутины Kotlin | нет | да | сквозная, структурная | проект на Kotlin |

Прямой ответ на «что взять в новом сервисе на JDK 21»: если язык Java и вызовы блокирующие —
виртуальные потоки дают тот же выигрыш без переписывания логики в цепочки.
`CompletableFuture` остаётся оправдан там, где API изначально асинхронный (реактивные клиенты,
брокеры сообщений), и в коде, который уже на нём написан.

Мост между `CompletableFuture` и корутинами — в
[`kotlin-coroutines/INTEROP.md`](../../kotlin-coroutines/theory/INTEROP.md).

---

## 10. Шпаргалка

```
Функция вернёт значение          → thenApply
Функция вернёт CompletableFuture → thenCompose  (иначе получите CF<CF<...>>)
Два независимых результата       → thenCombine
Все                              → allOf + join каждого внутри thenApply
Любой                            → anyOf (но это НЕ «первый успешный»)
Ошибка → значение                → exceptionally (видит только то, что выше по цепочке)
Ошибка и успех → значение        → handle
Логирование, результат не менять → whenComplete
Через N мс                       → delayedExecutor
Гарантированный пул              → *Async(fn, executor) — всегда со своим executor
```

Формулировки для собеседования:

1. «`CompletableFuture` — это стек колбеков на CAS: `thenApply` либо считает сразу, если результат
   уже есть, либо кладёт узел в стек; завершающий поток снимает стек и всё выполняет».
2. «`thenApply` выполнится в потоке того, кто завершил `CompletableFuture`, — или в вызывающем, если результат
   уже был. Поэтому долгую работу туда класть нельзя».
3. «`commonPool` делят с параллельными потоками данных — блокирующая задача в нём тормозит всю JVM».
4. «`cancel(true)` не прерывает выполняющуюся задачу; `orTimeout` завершает результат, но не работу.
   Настоящий таймаут — на клиенте».
5. «`exceptionally` видит только то, что упало выше по цепочке».

---

## Упражнения

- [`Ex08: CompletableFutureChain`](../src/main/kotlin/exercises/Ex08_CompletableFutureChain.kt) —
  цепочки, `allOf`, `anyOf`, `exceptionally`.
- [`Ex17: CompletableFuture Advanced`](../src/main/kotlin/exercises/Ex17_CompletableFutureAdvanced.kt) —
  `thenCombine`, `handle`, повтор с паузой, таймаут, гонка реплик.

---

## Вопросы для самопроверки

1. Какие два поля есть у `CompletableFuture` и что в них лежит?
2. Что делает `thenApply`, если результат уже готов? А если ещё нет?
3. В каком потоке выполнится `thenApply` в каждом из этих случаев? Почему на это нельзя полагаться?
4. Чем `thenApply` отличается от `thenCompose` и какой тип получится, если перепутать?
5. Почему `join()` внутри `thenApplyAsync(…, pool)` может подвесить пул?
6. Почему `join()` бросает `CompletionException`, а `get()` — `ExecutionException`?
7. Что произойдёт с уже запущенной задачей после `cancel(true)`? А после `orTimeout`?
8. Почему `anyOf` не годится для «взять первый успешный ответ из трёх реплик»?
9. Чем `whenComplete` отличается от `handle`? Что будет, если бросить исключение внутри `whenComplete`?
10. Чем `CompletableFuture` принципиально не помогает, если клиент внутри блокирующий?

---

## Источники

**Исходники JDK 21** (`$JAVA_HOME/lib/src.zip`, `java/util/concurrent/CompletableFuture.java`):
поля `result`/`stack`, `Completion` (467), `postComplete` (492), `uniApplyStage` (657),
javadoc `cancel` (2503).

**Официальная документация:**
- [`CompletableFuture` Javadoc (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletableFuture.html) — раздел про поток исполнения зависимых действий.
- [`CompletionStage` Javadoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletionStage.html) — формальные правила: какая стадия в каком потоке.
- [JEP 266: More Concurrency Updates (JDK 9)](https://openjdk.org/jeps/266) — откуда взялись `orTimeout`, `completeOnTimeout`, `delayedExecutor`.

**Книги и статьи:**
- *Java Concurrency in Practice* (Goetz et al., 2006) — Ch. 6 (Task Execution), Ch. 8 — про
  ограничения `Future` и почему понадобилась композиция.
- [Tomasz Nurkiewicz — «Java 8: CompletableFuture in action»](https://www.nurkiewicz.com/2013/05/java-8-completablefuture-in-action.html) — практические сценарии.
- [Inside.java — «The Age of Virtual Threads»](https://inside.java/2022/10/13/the-age-of-virtual-threads/) — Ron Pressler и Brian Goetz о том, почему цепочки стадий перестают быть необходимыми.
