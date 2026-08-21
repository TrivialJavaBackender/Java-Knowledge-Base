package exercises

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Тикер работает на настоящем планировщике, поэтому здесь используется `runBlocking`
 * с реальным временем, а не виртуальное время `runTest`.
 */
class Ex18CallbackFlowBridgeTest {

    @Test
    fun `обновления доходят до коллектора`() = runBlocking {
        val ticker = Ex18PriceTicker(periodMillis = 20)

        val updates = withTimeout(5_000) { ticker.ex18Prices("BTC").take(3).toList() }

        assertEquals(listOf(10, 20, 30), updates.map { it.price })
        assertTrue(updates.all { it.symbol == "BTC" })
    }

    @Test
    fun `подписка снимается после завершения сбора`() = runBlocking {
        val ticker = Ex18PriceTicker(periodMillis = 20)

        withTimeout(5_000) { ticker.ex18Prices("BTC").take(2).toList() }
        delay(100)

        assertEquals(0, ticker.activeSubscriptions.get(), "подписка на тикер утекла")
    }

    @Test
    fun `подписка снимается при отмене коллектора`() = runBlocking {
        val ticker = Ex18PriceTicker(periodMillis = 20)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        scope.launchCollect(ticker)
        delay(200)
        scope.cancel()
        delay(200)

        assertEquals(0, ticker.activeSubscriptions.get(), "подписка должна сниматься при отмене")
    }

    @Test
    fun `ошибка источника завершает поток этой же ошибкой`() = runBlocking {
        val ticker = Ex18PriceTicker(periodMillis = 20, failAfter = 2)

        val e = assertFailsWith<IllegalStateException> {
            withTimeout(5_000) { ticker.ex18Prices("BTC").toList() }
        }

        assertTrue(e.message!!.contains("тикер сломался"))
        delay(100)
        assertEquals(0, ticker.activeSubscriptions.get(), "после ошибки подписка тоже снимается")
    }

    @Test
    fun `каждая новая подписка заново подписывается на тикер`() = runBlocking {
        val ticker = Ex18PriceTicker(periodMillis = 20)
        val prices = ticker.ex18Prices("BTC")

        withTimeout(5_000) { prices.first() }
        withTimeout(5_000) { prices.first() }

        assertEquals(2, ticker.totalSubscriptions.get(), "холодный Flow подписывается на каждый collect")
    }

    @Test
    fun `shared запускает апстрим один раз на нескольких подписчиков`() = runBlocking {
        val ticker = Ex18PriceTicker(periodMillis = 20)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        val shared = ticker.ex18Prices("ETH").ex18Shared(scope, stopTimeoutMillis = 1_000)

        val a = async { withTimeout(5_000) { shared.take(3).toList() } }
        val b = async { withTimeout(5_000) { shared.take(3).toList() } }
        a.await(); b.await()

        assertEquals(1, ticker.totalSubscriptions.get(), "апстрим должен быть общим")
        scope.cancel()
    }

    @Test
    fun `shared останавливает апстрим после ухода последнего подписчика`() = runBlocking {
        val ticker = Ex18PriceTicker(periodMillis = 20)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        val shared = ticker.ex18Prices("ETH").ex18Shared(scope, stopTimeoutMillis = 100)
        withTimeout(5_000) { shared.take(2).toList() }

        delay(500)
        assertEquals(0, ticker.activeSubscriptions.get(), "после stopTimeout апстрим должен остановиться")
        scope.cancel()
    }

    private fun CoroutineScope.launchCollect(ticker: Ex18PriceTicker) =
        launch { ticker.ex18Prices("BTC").collect { } }
}
