package exercises

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CancellationException
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
class Ex12ResilientCallsTest {

    @Test
    fun `успех с первой попытки не даёт задержек`() = runTest {
        val result = ex12RetryWithBackoff(maxAttempts = 3, initialDelayMs = 100) { "ok" }

        assertEquals("ok", result)
        assertEquals(0L, testScheduler.currentTime, "не должно быть ни одной паузы")
    }

    @Test
    fun `паузы растут экспоненциально`() = runTest {
        val attempts = AtomicInteger()

        val result = ex12RetryWithBackoff(
            maxAttempts = 4,
            initialDelayMs = 100,
            factor = 2.0,
        ) { attempt ->
            attempts.incrementAndGet()
            if (attempt < 3) throw IOException("сбой $attempt") else "ok"
        }

        assertEquals("ok", result)
        assertEquals(4, attempts.get())
        assertEquals(700L, testScheduler.currentTime, "ожидали паузы 100 + 200 + 400")
    }

    @Test
    fun `исчерпав попытки, бросает последнее исключение`() = runTest {
        val e = assertFailsWith<IOException> {
            ex12RetryWithBackoff(maxAttempts = 3, initialDelayMs = 10) { attempt ->
                throw IOException("сбой $attempt")
            }
        }
        assertEquals("сбой 2", e.message)
    }

    @Test
    fun `не-retryable ошибка пробрасывается сразу`() = runTest {
        val attempts = AtomicInteger()

        assertFailsWith<IllegalArgumentException> {
            ex12RetryWithBackoff(
                maxAttempts = 5,
                initialDelayMs = 100,
                retryOn = { it is IOException },
            ) {
                attempts.incrementAndGet()
                throw IllegalArgumentException("невалидный запрос")
            }
        }

        assertEquals(1, attempts.get(), "не-retryable ошибку повторять нельзя")
        assertEquals(0L, testScheduler.currentTime)
    }

    @Test
    fun `отмена не ретраится`() = runTest {
        val attempts = AtomicInteger()

        val job = launch {
            ex12RetryWithBackoff(maxAttempts = 10, initialDelayMs = 50) {
                attempts.incrementAndGet()
                delay(1_000)
                "никогда"
            }
        }

        runCurrent()
        job.cancel()
        job.join()

        assertTrue(job.isCancelled)
        assertEquals(1, attempts.get(), "после отмены новых попыток быть не должно")
    }

    @Test
    fun `гонка возвращает первый успешный результат`() = runTest {
        val result = ex12FirstSuccessful(
            listOf(
                { delay(300); "медленный" },
                { delay(50); "быстрый" },
                { delay(100); "средний" },
            )
        )

        assertEquals("быстрый", result)
        assertEquals(50L, testScheduler.currentTime, "не должны ждать медленные источники")
    }

    @Test
    fun `упавший источник не прекращает гонку`() = runTest {
        val result = ex12FirstSuccessful(
            listOf(
                { delay(10); throw IOException("реплика лежит") },
                { delay(100); "живая реплика" },
            )
        )

        assertEquals("живая реплика", result)
    }

    @Test
    fun `проигравшие источники отменяются`() = runTest {
        val cancelled = AtomicInteger()

        ex12FirstSuccessful(
            listOf(
                { delay(20); "победитель" },
                {
                    try {
                        delay(10_000); "медленный"
                    } catch (e: CancellationException) {
                        cancelled.incrementAndGet(); throw e
                    }
                },
            )
        )

        assertEquals(1, cancelled.get(), "проигравший должен быть отменён")
    }

    @Test
    fun `если упали все — ошибки собраны в suppressed`() = runTest {
        val e = assertFailsWith<Throwable> {
            ex12FirstSuccessful<String>(
                listOf(
                    { delay(10); throw IOException("первая") },
                    { delay(20); throw IOException("вторая") },
                    { delay(30); throw IOException("третья") },
                )
            )
        }

        assertTrue(e !is CancellationException, "отмена — не результат гонки")
        assertEquals(2, e.allSuppressed().size, "остальные ошибки должны лежать в suppressed")
    }

    /**
     * kotlinx.coroutines восстанавливает стектрейс при пересечении границы приостановки:
     * наружу приходит КОПИЯ исключения, у которой `cause` — оригинал, и `suppressed` остаётся
     * именно у оригинала. Поэтому смотрим в оба места.
     */
    private fun Throwable.allSuppressed(): List<Throwable> =
        suppressed.toList().ifEmpty { cause?.suppressed?.toList().orEmpty() }

    @Test
    fun `пустой список источников недопустим`() = runTest {
        assertFailsWith<IllegalArgumentException> { ex12FirstSuccessful<String>(emptyList()) }
    }
}
