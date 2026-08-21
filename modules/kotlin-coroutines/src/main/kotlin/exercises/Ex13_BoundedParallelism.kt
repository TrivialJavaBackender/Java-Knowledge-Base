package exercises

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 13: Ограниченный параллелизм — для списка и для Flow
 *
 * Зачем в реальном коде: 10 000 элементов на входе не должны превратиться в 10 000
 * одновременных HTTP-запросов. Падает при этом не твой сервис, а соседний — и объяснять
 * это придётся тебе.
 *
 * Теория: theory/BACKEND_PATTERNS.md §2, theory/SHARED_STATE.md §5
 *
 * Задание 1: Реализуй `List<T>.ex13ParallelMap(concurrency, transform)`.
 *            Требования:
 *              1. Порядок результатов совпадает с порядком входного списка.
 *              2. Одновременно выполняется не более `concurrency` трансформаций.
 *              3. Ошибка любой трансформации пробрасывается наружу, остальные отменяются.
 *              4. `concurrency <= 0` → IllegalArgumentException.
 *              5. Пустой список → пустой результат, ни одного вызова transform.
 *
 * Задание 2: Реализуй `Flow<T>.ex13MapParallel(concurrency, transform)`.
 *            Требования:
 *              1. Не более `concurrency` одновременных трансформаций.
 *              2. Порядок результатов НЕ гарантирован — в этом и отличие от списочной версии.
 *              3. Отмена коллектора отменяет незавершённые трансформации.
 *              4. Ошибка трансформации завершает поток этой ошибкой.
 *
 * Задание 3 (бонус): в комментарии объясни, чем `ex13ParallelMap` отличается от
 *            `chunked(n).map { it.map { async … }.awaitAll() }` и почему второй вариант хуже.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex13_BoundedParallelismKt"
 * Тесты:  mvn test -Dtest=Ex13BoundedParallelismTest
 */

suspend fun <T, R> List<T>.ex13ParallelMap(
    concurrency: Int,
    transform: suspend (T) -> R,
): List<R> {
    TODO("Задание 1: параллельно, но не более concurrency, порядок сохранён")
}

fun <T, R> Flow<T>.ex13MapParallel(
    concurrency: Int,
    transform: suspend (T) -> R,
): Flow<R> {
    TODO("Задание 2: то же самое, но источник — Flow; порядок не гарантирован")
}

fun main() = runBlocking {
    val ids = (1..10).toList()

    val started = java.util.concurrent.atomic.AtomicInteger()
    val peak = java.util.concurrent.atomic.AtomicInteger()

    val result = ids.ex13ParallelMap(concurrency = 3) { id ->
        val now = started.incrementAndGet()
        peak.updateAndGet { maxOf(it, now) }
        try {
            kotlinx.coroutines.delay(50)
            "item-$id"
        } finally {
            started.decrementAndGet()
        }
    }

    println("результат: $result")
    println("пиковая конкурентность: ${peak.get()} (ожидали ≤ 3)")

    val fromFlow = ids.asFlow().ex13MapParallel(concurrency = 3) { id ->
        kotlinx.coroutines.delay(50); id * id
    }.toList()
    println("из Flow (порядок не гарантирован): $fromFlow")
}
