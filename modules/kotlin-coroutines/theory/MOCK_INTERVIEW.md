# Мок-интервью: 60 минут

> **Какую проблему решает.** На реальном собеседовании теряют не из-за незнания, а из-за
> разъезжающегося ответа. Этот файл — репетиция вслух с критериями оценки.
> **Кому это надо.** Тому, кто прошёл теорию и решил упражнения; либо другу, который будет вас гонять.
> **Когда НЕ надо.** До прохождения [`QUIZ_PREDICT_OUTPUT.md`](QUIZ_PREDICT_OUTPUT.md) — рано.

Три блока: теория (15 мин), live coding (30 мин), системный вопрос (15 мин). Отвечайте **вслух** и
засекайте время.

---

## Блок 1. Теория-разминка (15 минут, 10 вопросов)

| # | Вопрос | Зачёт, если прозвучало | Незачёт |
|---|--------|------------------------|---------|
| 1 | Что такое suspend-функция? | «не блокирует поток», «приостановка и продолжение», «поток свободен» | «выполняется в фоновом потоке» |
| 2 | Что компилятор делает с suspend? | `Continuation`, state machine, `label`, `COROUTINE_SUSPENDED` | «магия компилятора» |
| 3 | Кто и как возобновляет корутину после `delay`? | продолжение отдано таймеру; таймер зовёт `resume`; диспетчер решает, где продолжить | «планировщик корутин её будит» |
| 4 | `launch` vs `async` vs `withContext` | `Job` / `Deferred` / смена контекста; когда что; `async{}.await()` подряд — антипаттерн | путает `withContext` и `async` |
| 5 | Структурная конкурентность | родитель ждёт детей, отмена и ошибки по дереву, нет утечек | «это про scope» без последствий |
| 6 | Чем плох `GlobalScope`? | нет владельца, никто не отменит, контекст не наследуется | «он глобальный, поэтому плохо» |
| 7 | Как работает отмена? | кооперативная, `CancellationException` в точках приостановки, `ensureActive` | «отменяет корутину сразу» |
| 8 | Почему нельзя глотать `CancellationException`? | корутина переживёт отмену, зомби-задачи, зависший `cancelAndJoin` | не знает про `runCatching` |
| 9 | `Default` vs `IO` | ядра против 64, CPU против блокировок, общий пул, голодание | «IO для сети, Default для всего» |
| 10 | Cold vs Hot Flow | продюсер на каждый `collect`; `StateFlow`/`SharedFlow`/`Channel` и их отличия | путает `StateFlow` и `SharedFlow` |

Норма: 8 из 10 уверенно. Всё ниже — темы на повтор: порядок прохождения указан в `ROADMAP.md` модуля.

---

## Блок 2. Live coding (30 минут, 3 задачи)

### Задача 1 (8 мин, разминка) — параллельная загрузка с таймаутом

> «Есть три независимых вызова: профиль, заказы, рекомендации. Собери страницу. Профиль критичен,
> рекомендации — нет: если они не пришли за 200 мс, отдаём пустой список. Общий бюджет — 1 секунда.»

**Что должен спросить кандидат:** можно ли терять рекомендации; что делать при ошибке заказов; нужен
ли общий дедлайн.

**Эталон:**

```kotlin
suspend fun buildPage(id: Long): Page = withTimeout(1.seconds) {
    coroutineScope {
        val profile = async { api.profile(id) }
        val orders = async { api.orders(id) }
        val recs = async { withTimeoutOrNull(200.milliseconds) { api.recommendations(id) } }
        Page(profile.await(), orders.await(), recs.await().orEmpty())
    }
}
```

**Критерии:** использован `coroutineScope` + `async` (а не последовательные вызовы); таймаут на
некритичном вызове — `withTimeoutOrNull`; понимает, что при падении `profile` остальные отменятся
автоматически.
**Наводящие:** «а если `api.orders` кинет исключение — что произойдёт с двумя другими?»; «где здесь
может утечь соединение?»
→ [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md) §1, упражнение [Ex01](../src/main/kotlin/exercises/Ex01_Basics.kt)

### Задача 2 (10 мин) — ограничение параллелизма

> «Есть 1000 идентификаторов и метод `suspend fun load(id: Long): Item`. Загрузи все, но не больше 10
> одновременно, результаты — в исходном порядке. Ошибка любой загрузки должна отменять остальные.»

**Что должен спросить:** нужен ли порядок; что делать с ошибками (падать или собирать); есть ли дедлайн.

**Эталон:**

```kotlin
suspend fun loadAll(ids: List<Long>, concurrency: Int = 10): List<Item> = coroutineScope {
    val semaphore = Semaphore(concurrency)
    ids.map { id -> async { semaphore.withPermit { load(id) } } }.awaitAll()
}
```

**Критерии:** знает `Semaphore.withPermit`; понимает, что `awaitAll` сохраняет порядок; знает
альтернативы (`flatMapMerge(concurrency)`, `limitedParallelism`, воркеры на канале) и может объяснить
разницу.
**Типичные тупики:** `chunked(10).forEach { chunk -> chunk.map { async … }.awaitAll() }` — работает,
но простаивает на «хвосте» каждого чанка (правильный ответ — сказать об этом самому); попытка
ограничить через `Dispatchers.IO.limitedParallelism(10)` без понимания, что это ограничивает
диспетчер, а не сами вызовы.
**Развитие:** «а если нужно собрать частичные результаты и не падать целиком?» → `supervisorScope` +
`Result` с пробросом `CancellationException`.
→ [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md) §2, упражнение [Ex13](../src/main/kotlin/exercises/Ex13_BoundedParallelism.kt)

### Задача 3 (12 мин, senior) — свой оператор Flow

> «Напиши оператор `Flow<T>.chunked(size: Int, timeout: Duration): Flow<List<T>>`: отдавать батч,
> когда накопилось `size` элементов или истёк `timeout` с момента первого элемента батча. Остаток
> отдать при завершении апстрима.»

**Что должен спросить:** считать ли таймаут от первого элемента батча или от предыдущей выдачи;
эмитить ли пустые батчи.

**Эталон (один из вариантов):**

```kotlin
fun <T> Flow<T>.chunked(size: Int, timeout: Duration): Flow<List<T>> = channelFlow {
    require(size > 0)
    val upstream = produceIn(this)
    val buffer = mutableListOf<T>()
    var deadline: Long? = null

    while (true) {
        val remaining = deadline?.let { it - System.currentTimeMillis() }
        val result = if (remaining == null) {
            upstream.receiveCatching()
        } else {
            withTimeoutOrNull(remaining.coerceAtLeast(0)) { upstream.receiveCatching() }
        }

        if (result == null) {                       // таймаут батча
            if (buffer.isNotEmpty()) { send(buffer.toList()); buffer.clear(); deadline = null }
            continue
        }
        val value = result.getOrNull() ?: break     // апстрим закончился
        buffer += value
        if (buffer.size == 1) deadline = System.currentTimeMillis() + timeout.inWholeMilliseconds
        if (buffer.size >= size) { send(buffer.toList()); buffer.clear(); deadline = null }
    }
    if (buffer.isNotEmpty()) send(buffer.toList())
}
```

**Критерии:** понимает, зачем здесь `channelFlow` (в `flow { }` нельзя параллельно ждать таймер и
апстрим, и эмиссия из другой корутины нарушит инвариант); не теряет остаток; не эмитит пустые батчи;
корректно завершается.
**Наводящие:** «почему не `flow { }`?»; «что будет, если коллектор медленный?»; «как это
протестировать без реального времени?» (ответ: `runTest` + виртуальное время).
→ [`FLOW_INTERNALS.md`](FLOW_INTERNALS.md), упражнение [Ex17](../src/main/kotlin/exercises/Ex17_CustomFlowOperators.kt)

---

## Блок 3. Системный вопрос (15 минут)

> «Спроектируй обработчик очереди событий: читаем сообщения из брокера, для каждого делаем
> HTTP-вызов во внешний сервис, результат пишем в БД. Нагрузка — до 5000 сообщений в секунду,
> внешний сервис держит 200 RPS. Нужны повторы и корректная остановка сервиса при деплое.»

**Чек-лист того, что должно прозвучать:**

1. Свой `CoroutineScope(SupervisorJob() + dispatcher)` у сервиса, а не `GlobalScope`.
2. Ограничение параллелизма под внешний сервис: `Semaphore(200)`, `flatMapMerge(concurrency)` или воркеры на канале.
3. Отдельный диспетчер под БД, согласованный с пулом соединений (`limitedParallelism(размер пула)`).
4. Блокирующие вызовы (JDBC) — на `Dispatchers.IO` + `runInterruptible`.
5. Таймаут на каждый внешний вызов и общий дедлайн обработки сообщения.
6. Повторы с экспоненциальным backoff и jitter, только для retryable-ошибок и идемпотентных операций.
7. `CancellationException` пробрасывается, не повторяется, не логируется как ошибка.
8. Что делать с неудачными сообщениями: dead-letter queue, а не бесконечные повторы.
9. Коммит offset только после успешной обработки; понимание at-least-once и требований к идемпотентности.
10. Обратное давление (backpressure): не вычитывать быстрее, чем обрабатываем (ограниченный `Channel`, а не `UNLIMITED`).
11. Порядок по ключу, если он нужен: партиционирование, по одному воркеру на партицию.
12. Плавное завершение (graceful shutdown): перестать читать → дождаться текущих с таймаутом → `cancelAndJoin` → закрыть ресурсы.
13. Наблюдаемость: метрики (лаг, длина очереди, задержки, ошибки), `CoroutineName`, debug-режим для дампов.
14. Тестируемость: диспетчеры инжектируются, тесты на `runTest` с виртуальным временем.
15. Что будет при рестарте: дубликаты, идемпотентность записи в БД.

**Красные флаги:**
- «Просто `GlobalScope.launch` на каждое сообщение» — нет лимитов, нет отмены, нет обратного давления.
- `Channel(UNLIMITED)` «чтобы не приостанавливалось» — очередь съест память.
- Повторы без ограничения и без jitter — добьют внешний сервис.
- `runBlocking` внутри обработчика.
- Нет ответа, что происходит при деплое во время обработки.

→ [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md) §7–§8

---

## Таблица самооценки

Заполните после прогона: 🟢 уверен · 🟡 плаваю · 🔴 надо учить.

| Тема | Оценка | Что повторить |
|------|--------|---------------|
| Зачем корутины, чем заменяют колбеки | | [`WHY_COROUTINES.md`](WHY_COROUTINES.md) |
| suspend, `Continuation`, кто возобновляет | | [`SUSPEND_INTERNALS.md`](SUSPEND_INTERNALS.md) |
| Билдеры и scope | | [`BASICS.md`](BASICS.md) |
| Контекст и наследование | | [`SCOPE_CONTEXT.md`](SCOPE_CONTEXT.md) |
| Структурная конкурентность | | [`STRUCTURED_CONCURRENCY.md`](STRUCTURED_CONCURRENCY.md) |
| Отмена и исключения | | [`CANCELLATION_EXCEPTIONS.md`](CANCELLATION_EXCEPTIONS.md) |
| Диспетчеры и блокирующий код | | [`DISPATCHERS.md`](DISPATCHERS.md) |
| Синхронизация состояния | | [`SHARED_STATE.md`](SHARED_STATE.md) |
| Channels | | [`CHANNELS.md`](CHANNELS.md) |
| Flow: основы и операторы | | [`FLOW.md`](FLOW.md) |
| Hot flows | | [`FLOW_ADVANCED.md`](FLOW_ADVANCED.md) |
| Внутренности Flow | | [`FLOW_INTERNALS.md`](FLOW_INTERNALS.md) |
| Интероп с существующим кодом | | [`INTEROP.md`](INTEROP.md) |
| Тестирование | | [`TESTING_INTEROP.md`](TESTING_INTEROP.md) |
| Бэкенд-паттерны | | [`BACKEND_PATTERNS.md`](BACKEND_PATTERNS.md) |

---

## Как отвечать

1. Сначала короткий тезис («отмена кооперативна»), потом развёртка («поэтому CPU-цикл надо проверять
   `ensureActive`»).
2. Называйте последствия, а не только механику: «это утечка», «это заблокирует пул», «это потеряет
   ошибку».
3. Знаете ловушку — упоминайте её сами: `runCatching` и `CancellationException`, handler на дочерней
   корутине, `StateFlow` для событий. Это главный маркер опыта.
4. Не уверены — скажите, как проверили бы: «напишу тест на `runTest` и посмотрю `currentTime`».
