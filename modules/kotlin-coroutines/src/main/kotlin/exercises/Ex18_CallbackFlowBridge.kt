package exercises

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * УПРАЖНЕНИЕ 18: Мост callback-API → Flow и шаринг одного апстрима
 *
 * Зачем в реальном коде: половина существующих SDK (брокеры, тикеры, watcher'ы файлов)
 * отдаёт данные через слушателя. Наивная обёртка утекает подписками, а «холодный» Flow
 * поверх дорогого источника создаёт по подключению на каждого подписчика.
 *
 * Теория: theory/INTEROP.md §4, theory/FLOW_ADVANCED.md §5
 *
 * Дано: `Ex18PriceTicker` — легаси callback-API (реализован, менять не нужно).
 *       Слушатель получает `onUpdate` или `onError`; `subscribe` возвращает handle для отписки.
 *
 * Задание 1: Реализуй `Ex18PriceTicker.ex18Prices(symbol)` — холодный Flow.
 *            Требования:
 *              1. Каждое обновление из `onUpdate` попадает в Flow.
 *              2. Ошибка из `onError` закрывает Flow ЭТОЙ ЖЕ ошибкой, а не «проглатывается»
 *                 и не завершает поток штатно.
 *              3. Отмена коллектора (или естественное завершение) обязана вызвать
 *                 `subscription.cancel()` — иначе подписка утечёт.
 *              4. Каждая новая подписка (`collect`) заново подписывается на тикер.
 *              5. Колбек приходит из чужого потока — эмиссия должна быть безопасной.
 *
 * Задание 2: Реализуй `Flow<T>.ex18Shared(scope, stopTimeoutMillis)` — превратить холодный
 *            поток в горячий так, чтобы:
 *              1. При двух и более подписчиках апстрим стартовал ОДИН раз.
 *              2. Апстрим останавливался через `stopTimeoutMillis` после ухода последнего
 *                 подписчика (а не мгновенно и не никогда).
 *              3. Новый подписчик получал последнее значение сразу.
 *
 * Задание 3 (бонус): что произойдёт, если тикер шлёт быстрее, чем подписчик читает?
 *            Какой параметр за это отвечает и что именно теряется?
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex18_CallbackFlowBridgeKt"
 * Тесты:  mvn test -Dtest=Ex18CallbackFlowBridgeTest
 */

data class Ex18PriceUpdate(val symbol: String, val price: Int)

interface Ex18Listener {
    fun onUpdate(update: Ex18PriceUpdate)
    fun onError(error: Throwable)
}

interface Ex18Subscription {
    fun cancel()
}

/** Легаси callback-API. Реализовано, менять не нужно. */
class Ex18PriceTicker(
    private val periodMillis: Long = 50,
    private val failAfter: Int = Int.MAX_VALUE,
) {
    val activeSubscriptions = AtomicInteger()
    val totalSubscriptions = AtomicInteger()

    private val executor: ScheduledExecutorService =
        Executors.newScheduledThreadPool(2) { r -> Thread(r, "ticker").apply { isDaemon = true } }
    private val cancelled = ConcurrentHashMap<Long, Boolean>()
    private val ids = AtomicInteger()

    fun subscribe(symbol: String, listener: Ex18Listener): Ex18Subscription {
        val id = ids.incrementAndGet().toLong()
        activeSubscriptions.incrementAndGet()
        totalSubscriptions.incrementAndGet()
        val sent = AtomicInteger()

        val future = executor.scheduleAtFixedRate({
            if (cancelled[id] == true) return@scheduleAtFixedRate
            val n = sent.incrementAndGet()
            if (n > failAfter) listener.onError(IllegalStateException("тикер сломался на $n"))
            else listener.onUpdate(Ex18PriceUpdate(symbol, n * 10))
        }, periodMillis, periodMillis, TimeUnit.MILLISECONDS)

        return object : Ex18Subscription {
            override fun cancel() {
                if (cancelled.put(id, true) == null) {
                    activeSubscriptions.decrementAndGet()
                    future.cancel(false)
                }
            }
        }
    }
}

fun Ex18PriceTicker.ex18Prices(symbol: String): Flow<Ex18PriceUpdate> {
    TODO("Задание 1: обернуть callback-API так, чтобы подписка гарантированно снималась")
}

fun <T> Flow<T>.ex18Shared(scope: CoroutineScope, stopTimeoutMillis: Long): SharedFlow<T> {
    TODO("Задание 2: один апстрим на всех подписчиков, остановка по таймауту")
}

fun main() = runBlocking {
    val ticker = Ex18PriceTicker(periodMillis = 30)

    val first = ticker.ex18Prices("BTC").take(3).toList()
    println("получили: $first")
    println("активных подписок после сбора: ${ticker.activeSubscriptions.get()} (ожидали 0)")

    val shared = ticker.ex18Prices("ETH").ex18Shared(this, stopTimeoutMillis = 100)
    val a = async { shared.take(2).toList() }
    val b = async { shared.take(2).toList() }
    println("подписчик A: ${a.await()}, подписчик B: ${b.await()}")
    println("всего подписок на тикер: ${ticker.totalSubscriptions.get()} (ожидали 2: одна на take(3), одна общая)")

    delay(300)
}
