package exercises

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class Ex13BoundedParallelismTest {

    @Test
    fun `порядок результатов совпадает с порядком входа`() = runTest {
        val input = (1..20).toList()

        val result = input.ex13ParallelMap(concurrency = 4) { id ->
            delay((20 - id).toLong() * 5)   // чем позже элемент, тем быстрее готов
            "item-$id"
        }

        assertEquals(input.map { "item-$it" }, result)
    }

    @Test
    fun `конкурентность не превышает лимит`() = runTest {
        val active = AtomicInteger()
        val peak = AtomicInteger()

        (1..30).toList().ex13ParallelMap(concurrency = 5) {
            val now = active.incrementAndGet()
            peak.updateAndGet { max -> maxOf(max, now) }
            try {
                delay(50)
            } finally {
                active.decrementAndGet()
            }
        }

        assertTrue(peak.get() <= 5, "пиковая конкурентность ${peak.get()}, ожидали не больше 5")
        assertTrue(peak.get() > 1, "работа шла последовательно — параллелизма нет")
    }

    @Test
    fun `ошибка пробрасывается и отменяет остальные`() = runTest {
        val cancelled = AtomicInteger()

        assertFailsWith<IOException> {
            (1..10).toList().ex13ParallelMap(concurrency = 10) { id ->
                if (id == 3) {
                    delay(10)
                    throw IOException("элемент $id сломался")
                }
                try {
                    delay(1_000)
                } catch (e: CancellationException) {
                    cancelled.incrementAndGet(); throw e
                }
                id
            }
        }

        assertTrue(cancelled.get() > 0, "остальные трансформации должны быть отменены")
    }

    @Test
    fun `неположительная конкурентность недопустима`() = runTest {
        assertFailsWith<IllegalArgumentException> {
            listOf(1, 2, 3).ex13ParallelMap(concurrency = 0) { it }
        }
    }

    @Test
    fun `пустой список не вызывает transform`() = runTest {
        val calls = AtomicInteger()

        val result = emptyList<Int>().ex13ParallelMap(concurrency = 4) {
            calls.incrementAndGet(); it
        }

        assertEquals(emptyList(), result)
        assertEquals(0, calls.get())
    }

    @Test
    fun `Flow-версия обрабатывает все элементы с ограничением`() = runTest {
        val active = AtomicInteger()
        val peak = AtomicInteger()

        val result = (1..20).asFlow().ex13MapParallel(concurrency = 4) { id ->
            val now = active.incrementAndGet()
            peak.updateAndGet { max -> maxOf(max, now) }
            try {
                delay(30)
            } finally {
                active.decrementAndGet()
            }
            id * 2
        }.toList()

        assertEquals((1..20).map { it * 2 }.toSet(), result.toSet())
        assertTrue(peak.get() <= 4, "пиковая конкурентность ${peak.get()}, ожидали не больше 4")
        assertTrue(peak.get() > 1, "Flow-версия работала последовательно")
    }

    @Test
    fun `Flow-версия завершается ошибкой трансформации`() = runTest {
        assertFailsWith<IOException> {
            (1..5).asFlow().ex13MapParallel(concurrency = 2) { id ->
                if (id == 3) throw IOException("элемент $id сломался")
                delay(10)
                id
            }.toList()
        }
    }
}
