package exercises

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class Ex14SingleFlightTest {

    @Test
    fun `параллельные запросы одного ключа вызывают loader один раз`() = runTest {
        val calls = AtomicInteger()
        val cache = Ex14SingleFlightCache<String, String> { key ->
            calls.incrementAndGet()
            delay(100)
            "значение-$key"
        }

        val results = coroutineScope {
            List(100) { async { cache.get("k") } }.awaitAll()
        }

        assertEquals(1, calls.get(), "loader должен быть вызван ровно один раз")
        assertEquals(setOf("значение-k"), results.toSet())
    }

    @Test
    fun `успешный результат кэшируется`() = runTest {
        val calls = AtomicInteger()
        val cache = Ex14SingleFlightCache<String, String> {
            calls.incrementAndGet(); delay(10); "v"
        }

        assertEquals("v", cache.get("k"))
        assertEquals("v", cache.get("k"))
        assertEquals("v", cache.get("k"))

        assertEquals(1, calls.get())
    }

    @Test
    fun `ошибка не кэшируется и достаётся всем ожидающим`() = runTest {
        val calls = AtomicInteger()
        val cache = Ex14SingleFlightCache<String, String> {
            val n = calls.incrementAndGet()
            delay(50)
            if (n == 1) throw IOException("первая загрузка упала") else "восстановились"
        }

        val failures = coroutineScope {
            List(5) {
                async { runCatching { cache.get("k") } }
            }.awaitAll()
        }

        assertTrue(failures.all { it.isFailure }, "ошибка должна достаться всем ожидающим")
        assertEquals("восстановились", cache.get("k"), "после ошибки загрузка должна повториться")
        assertEquals(2, calls.get())
    }

    @Test
    fun `разные ключи грузятся параллельно`() = runTest {
        val cache = Ex14SingleFlightCache<String, String> { key ->
            delay(100)
            "значение-$key"
        }

        val results = coroutineScope {
            listOf("a", "b", "c").map { async { cache.get(it) } }.awaitAll()
        }

        assertEquals(listOf("значение-a", "значение-b", "значение-c"), results)
        assertEquals(100L, testScheduler.currentTime, "разные ключи не должны выстраиваться в очередь")
    }

    @Test
    fun `отмена одного ожидающего не ломает загрузку для остальных`() = runTest {
        val calls = AtomicInteger()
        val cache = Ex14SingleFlightCache<String, String> {
            calls.incrementAndGet(); delay(200); "значение"
        }

        // Первый вызывающий становится «лидером» и выполняет загрузку.
        val leader = async { cache.get("k") }
        runCurrent()

        // Двое ждут его результат; одного из них отменяем.
        val doomed = async { cache.get("k") }
        val survivor = async { cache.get("k") }
        runCurrent()

        doomed.cancel()

        assertEquals("значение", leader.await())
        assertEquals("значение", survivor.await(), "оставшийся ожидающий обязан получить результат")
        assertEquals(1, calls.get(), "загрузка должна была произойти ровно один раз")
    }

    @Test
    fun `исключение loader-а имеет исходный тип`() = runTest {
        val cache = Ex14SingleFlightCache<String, String> { throw IOException("нет связи") }

        assertFailsWith<IOException> { cache.get("k") }
    }
}
