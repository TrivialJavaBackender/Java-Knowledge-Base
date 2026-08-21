package exercises

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import java.util.concurrent.ConcurrentLinkedQueue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class Ex15RateLimiterTest {

    @Test
    fun `за окно стартует не больше permits операций`() = runTest {
        val limiter = Ex15RateLimiter(permits = 3, windowMillis = 1_000, scope = backgroundScope)
        val starts = ConcurrentLinkedQueue<Long>()

        coroutineScope {
            List(9) {
                async { limiter.withPermit { starts += testScheduler.currentTime } }
            }.awaitAll()
        }

        assertEquals(9, starts.size)
        val sorted = starts.sorted()
        // В любом окне длиной 1000 мс не должно оказаться больше 3 стартов.
        sorted.forEach { from ->
            val inWindow = sorted.count { it >= from && it < from + 1_000 }
            assertTrue(inWindow <= 3, "в окне [$from, ${from + 1_000}) стартовало $inWindow операций")
        }
    }

    @Test
    fun `разрешение возвращается через окно после выдачи, а не после операции`() = runTest {
        val limiter = Ex15RateLimiter(permits = 1, windowMillis = 500, scope = backgroundScope)
        val starts = ConcurrentLinkedQueue<Long>()

        coroutineScope {
            List(3) {
                async {
                    limiter.withPermit {
                        starts += testScheduler.currentTime
                        delay(2_000)      // операция длиннее окна: на лимит это влиять не должно
                    }
                }
            }.awaitAll()
        }

        assertEquals(listOf(0L, 500L, 1_000L), starts.sorted(),
            "старты должны идти раз в окно, а не раз в (окно + длительность операции)")
    }

    @Test
    fun `первые permits вызовов проходят без ожидания`() = runTest {
        val limiter = Ex15RateLimiter(permits = 5, windowMillis = 1_000, scope = backgroundScope)

        coroutineScope {
            List(5) { async { limiter.withPermit { } } }.awaitAll()
        }

        assertEquals(0L, testScheduler.currentTime, "пока лимит не выбран, ждать нечего")
    }

    @Test
    fun `ошибка внутри блока не съедает разрешение`() = runTest {
        val limiter = Ex15RateLimiter(permits = 1, windowMillis = 100, scope = backgroundScope)

        assertFailsWith<IllegalStateException> {
            limiter.withPermit { error("упало внутри блока") }
        }

        assertEquals("ok", limiter.withPermit { "ok" })
    }

    @Test
    fun `результат блока возвращается вызывающему`() = runTest {
        val limiter = Ex15RateLimiter(permits = 2, windowMillis = 100, scope = backgroundScope)

        assertEquals(42, limiter.withPermit { 42 })
    }
}
