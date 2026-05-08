package exercises

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 6: Flow — холодные потоки и операторы
 *
 * Задание 1: Реализуй `pagedItems(pageSize: Int): Flow<Item>` — холодный Flow,
 *            который страница за страницей "грузит" из имитированного API
 *            (имитация через delay) и излучает каждый Item. Всего 5 страниц.
 *            Демонстрируй ленивость: тело должно начинаться только при collect.
 *
 * Задание 2: Реализуй `expensiveTransform(items: Flow<Item>): Flow<EnrichedItem>`,
 *            где трансформация — CPU-bound (имитация). Используй `flowOn` так,
 *            чтобы upstream считался на Default, а collect — на текущем диспатчере.
 *
 * Задание 3: Реализуй `searchAsYouType(queries: Flow<String>): Flow<List<Item>>`:
 *              - debounce 300 мс,
 *              - distinctUntilChanged,
 *              - flatMapLatest на API-вызов (имитация delay 200 мс).
 *
 * Задание 4: Реализуй `withRetry(source: Flow<Int>, max: Int): Flow<Int>` —
 *            Flow с retry до `max` раз при IOException.
 *
 * Задание 5 (бонус): Реализуй `groupedByPage(items: Flow<Item>, pageSize: Int): Flow<List<Item>>` —
 *            трансформация одного потока в поток "страниц" фиксированного размера.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex06_FlowKt"
 */

data class EnrichedItem(val id: Long, val text: String, val score: Double)

fun pagedItems(pageSize: Int): Flow<Item> {
    TODO("flow { … emit per item across 5 pages with delay }")
}

fun expensiveTransform(items: Flow<Item>): Flow<EnrichedItem> {
    TODO("map с CPU-имитацией + flowOn(Dispatchers.Default)")
}

fun searchAsYouType(queries: Flow<String>): Flow<List<Item>> {
    TODO("debounce + distinctUntilChanged + flatMapLatest")
}

fun withRetry(source: Flow<Int>, max: Int): Flow<Int> {
    TODO("retry(max) { it is IOException }")
}

fun groupedByPage(items: Flow<Item>, pageSize: Int): Flow<List<Item>> {
    TODO("buffer items into chunks of pageSize and emit each chunk")
}

fun main() = runBlocking {
    println("--- pagedItems ---")
    pagedItems(pageSize = 4).collect { println(it) }
}
