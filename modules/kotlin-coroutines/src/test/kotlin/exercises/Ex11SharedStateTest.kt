package exercises

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class Ex11SharedStateTest {

    private val workers = 50
    private val perWorker = 200
    private val expected = workers * perWorker

    @Test
    fun `атомик не теряет инкременты`() = runTest {
        assertEquals(expected, ex11AtomicCounter(workers, perWorker))
    }

    @Test
    fun `mutex не теряет инкременты`() = runTest {
        assertEquals(expected, ex11MutexCounter(workers, perWorker))
    }

    @Test
    fun `confinement не теряет инкременты`() = runTest {
        assertEquals(expected, ex11ConfinedCounter(workers, perWorker))
    }

    @Test
    fun `лимитер не пропускает больше limit одновременных вызовов`() = runTest {
        val api = Ex11LimitedApi(limit = 4)
        val active = AtomicInteger()
        val peak = AtomicInteger()

        coroutineScope {
            List(20) {
                async {
                    api.call {
                        val now = active.incrementAndGet()
                        peak.updateAndGet { maxOf(it, now) }
                        try {
                            delay(50)
                        } finally {
                            active.decrementAndGet()
                        }
                    }
                }
            }.awaitAll()
        }

        assertTrue(peak.get() <= 4, "пиковая конкурентность ${peak.get()}, ожидали не больше 4")
        assertTrue(peak.get() > 1, "вызовы шли по одному — это мьютекс, а не лимит на 4")
    }

    @Test
    fun `лимитер освобождает разрешение при ошибке блока`() = runTest {
        val api = Ex11LimitedApi(limit = 1)

        assertFailsWith<IllegalStateException> {
            api.call { error("упало внутри блока") }
        }

        // Если разрешение не вернулось, следующий вызов повиснет навсегда.
        assertEquals("ok", api.call { "ok" })
    }
}
