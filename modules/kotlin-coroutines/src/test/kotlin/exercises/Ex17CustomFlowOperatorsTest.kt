package exercises

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class Ex17CustomFlowOperatorsTest {

    @Test
    fun `батч эмитится по достижении размера`() = runTest {
        val result = flowOf(1, 2, 3, 4, 5, 6)
            .ex17Chunked(size = 2, timeoutMillis = 10_000)
            .toList()

        assertEquals(listOf(listOf(1, 2), listOf(3, 4), listOf(5, 6)), result)
    }

    @Test
    fun `неполный батч эмитится по таймауту от первого элемента`() = runTest {
        val source = flow {
            emit(1)
            delay(50)
            emit(2)          // таймаут отсчитывается от элемента 1 → в 100 мс уйдёт [1, 2]
            delay(500)
            emit(3)
        }

        val result = source.ex17Chunked(size = 10, timeoutMillis = 100).toList()

        assertEquals(listOf(listOf(1, 2), listOf(3)), result)
    }

    @Test
    fun `остаток эмитится сразу при завершении апстрима`() = runTest {
        val result = flowOf(1, 2, 3)
            .ex17Chunked(size = 10, timeoutMillis = 10_000)
            .toList()

        assertEquals(listOf(listOf(1, 2, 3)), result)
        assertTrue(testScheduler.currentTime < 10_000L, "ждать таймаут после завершения апстрима не нужно")
    }

    @Test
    fun `пустой апстрим не даёт пустых батчей`() = runTest {
        val result = emptyFlow<Int>().ex17Chunked(size = 3, timeoutMillis = 100).toList()

        assertEquals(emptyList(), result)
    }

    @Test
    fun `неположительный размер батча недопустим`() = runTest {
        assertFailsWith<IllegalArgumentException> {
            flowOf(1).ex17Chunked(size = 0, timeoutMillis = 100).toList()
        }
    }

    @Test
    fun `throttleFirst пропускает первый и глушит окно`() = runTest {
        val source = flow {
            repeat(6) { emit(it); delay(60) }   // 0..5 через каждые 60 мс
        }

        val result = source.ex17ThrottleFirst(windowMillis = 200).toList()

        // t=0 → 0 (окно до 200); 60, 120, 180 глушатся; t=240 → 4 (окно до 440); t=300 глушится
        assertEquals(listOf(0, 4), result)
    }

    @Test
    fun `throttleFirst пропускает всё, если элементы реже окна`() = runTest {
        val source = flow {
            repeat(3) { emit(it); delay(300) }
        }

        val result = source.ex17ThrottleFirst(windowMillis = 100).toList()

        assertEquals(listOf(0, 1, 2), result)
    }

    @Test
    fun `throttleFirst ничего не буферизует`() = runTest {
        val source = flow {
            emit(1); emit(2); emit(3)          // все три мгновенно
        }

        val result = source.ex17ThrottleFirst(windowMillis = 100).toList()

        assertEquals(listOf(1), result, "подавленные элементы не должны прийти позже")
    }
}
