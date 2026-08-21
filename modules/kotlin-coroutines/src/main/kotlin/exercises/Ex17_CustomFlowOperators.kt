package exercises

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 17: Свои операторы Flow — chunked(size, timeout) и throttleFirst
 *
 * Зачем в реальном коде: батчинг записей в БД (не по одной и не бесконечно копить) и
 * подавление «дребезга» событий. Обоих операторов нет в стандартной библиотеке, и пишут
 * их руками почти в каждом проекте — обычно с ошибкой в граничных случаях.
 *
 * Теория: theory/FLOW_INTERNALS.md
 *
 * Задание 1: Реализуй `Flow<T>.ex17Chunked(size, timeoutMillis)`.
 *            Требования:
 *              1. Батч эмитится, как только набралось `size` элементов.
 *              2. Батч эмитится по истечении `timeoutMillis`, отсчитанного от ПЕРВОГО
 *                 элемента батча (не от последнего и не от предыдущей выдачи) — даже неполный.
 *              3. При завершении апстрима накопленный остаток эмитится немедленно,
 *                 без ожидания таймаута.
 *              4. Пустые батчи не эмитятся никогда.
 *              5. `size <= 0` → IllegalArgumentException.
 *
 *            Подумай, почему это нельзя написать внутри обычного `flow { }`.
 *
 * Задание 2: Реализуй `Flow<T>.ex17ThrottleFirst(windowMillis)`.
 *            Требования:
 *              1. Первый элемент проходит немедленно.
 *              2. Все элементы в течение `windowMillis` после пропущенного — глушатся.
 *              3. Первый элемент после окончания окна снова проходит и открывает новое окно.
 *              4. Ничего не буферизуется: throttleFirst не «отдаёт последнее позже».
 *
 * Задание 3 (бонус): чем `ex17ThrottleFirst` отличается от `debounce` и от `sample`
 *            и в каких задачах нужен именно он?
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex17_CustomFlowOperatorsKt"
 * Тесты:  mvn test -Dtest=Ex17CustomFlowOperatorsTest
 */

fun <T> Flow<T>.ex17Chunked(size: Int, timeoutMillis: Long): Flow<List<T>> {
    TODO("Задание 1: батч по размеру ИЛИ по таймауту от первого элемента батча")
}

fun <T> Flow<T>.ex17ThrottleFirst(windowMillis: Long): Flow<T> {
    TODO("Задание 2: пропустить первый в окне, остальные проглотить")
}

fun main() = runBlocking {
    val events = flow {
        repeat(5) { emit(it) }        // пять сразу → должен уйти батч по размеру
        delay(400)                    // пауза → неполный батч по таймауту
        emit(100)
        delay(400)
        emit(200)
    }

    println("chunked(3, 200): " + events.ex17Chunked(size = 3, timeoutMillis = 200).toList())

    val clicks = flow {
        repeat(6) { emit(it); delay(50) }   // клики каждые 50 мс
    }
    println("throttleFirst(200): " + clicks.ex17ThrottleFirst(windowMillis = 200).toList())
}
