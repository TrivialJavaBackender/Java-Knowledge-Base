package exercises

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class Ex16GracefulShutdownTest {

    @Test
    fun `успевшие задачи дорабатывают, shutdown возвращает true`() = runTest {
        val service = Ex16TaskService(StandardTestDispatcher(testScheduler))
        val finished = AtomicInteger()

        repeat(3) { service.submit("t$it") { delay(100); finished.incrementAndGet() } }
        runCurrent()

        val clean = service.shutdown(timeoutMillis = 1_000)

        assertTrue(clean, "все задачи успели — ожидали true")
        assertEquals(3, finished.get())
    }

    @Test
    fun `не успевшие задачи отменяются, shutdown возвращает false`() = runTest {
        val service = Ex16TaskService(StandardTestDispatcher(testScheduler))
        val finished = AtomicInteger()

        service.submit("быстрая") { delay(50); finished.incrementAndGet() }
        service.submit("медленная") { delay(10_000); finished.incrementAndGet() }
        runCurrent()

        val clean = service.shutdown(timeoutMillis = 200)

        assertFalse(clean, "медленная задача не успела — ожидали false")
        assertEquals(1, finished.get(), "успеть должна была только быстрая")
    }

    @Test
    fun `после начала остановки новые задачи не принимаются`() = runTest {
        val service = Ex16TaskService(StandardTestDispatcher(testScheduler))

        assertTrue(service.submit("до") { delay(10) })
        runCurrent()
        service.shutdown(timeoutMillis = 100)

        assertFalse(service.submit("после") { }, "после shutdown приём должен быть закрыт")
    }

    @Test
    fun `падение одной задачи не мешает остальным`() = runTest {
        val service = Ex16TaskService(StandardTestDispatcher(testScheduler))
        val finished = AtomicInteger()

        service.submit("падающая") { delay(10); error("упала") }
        service.submit("живая") { delay(50); finished.incrementAndGet() }
        runCurrent()

        val clean = service.shutdown(timeoutMillis = 1_000)

        assertTrue(clean)
        assertEquals(1, finished.get(), "живая задача обязана доработать")
        assertEquals(1, service.failureCount, "ошибка задачи должна быть замечена, а не потеряна")
    }

    @Test
    fun `activeCount отражает число выполняющихся задач`() = runTest {
        val service = Ex16TaskService(StandardTestDispatcher(testScheduler))

        assertEquals(0, service.activeCount)

        repeat(2) { service.submit("t$it") { delay(500) } }
        runCurrent()
        assertEquals(2, service.activeCount)

        service.shutdown(timeoutMillis = 1_000)
        assertEquals(0, service.activeCount)
    }

    @Test
    fun `повторный shutdown не падает`() = runTest {
        val service = Ex16TaskService(StandardTestDispatcher(testScheduler))
        service.submit("t") { delay(10) }
        runCurrent()

        service.shutdown(timeoutMillis = 100)
        service.shutdown(timeoutMillis = 100)
    }
}
