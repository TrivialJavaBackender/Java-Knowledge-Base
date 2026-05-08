package exercises

import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 4: Structured Concurrency — coroutineScope vs supervisorScope
 *
 * Задание 1: Реализуй `loadAllOrFail(ids: List<Long>): List<Item>`:
 *            запускает параллельно загрузку всех item'ов; если хоть один упал —
 *            ВСЕ остальные должны быть отменены, наружу пробрасывается исключение.
 *            Использовать соответствующий скоуп.
 *
 * Задание 2: Реализуй `loadAllOrPartial(ids: List<Long>): Map<Long, Result<Item>>`:
 *            запускает параллельно те же загрузки; падение одного НЕ влияет на остальные.
 *            На выходе мап id -> Result.success/failure.
 *            Использовать соответствующий скоуп.
 *
 * Задание 3: Реализуй `loadItem(id: Long): Item` — имитация (delay) с rule:
 *            если id == 3, бросает RuntimeException("boom").
 *
 * Задание 4: В `main` запусти оба варианта на ids = [1,2,3,4,5] и сравни поведение:
 *              - loadAllOrFail должен бросить, остальные не успели завершиться,
 *              - loadAllOrPartial должен вернуть мап с 4 success и 1 failure.
 *
 * Задание 5 (бонус): Покажи в логах, что в случае coroutineScope + fail=3 корутины
 *            для id=4,5 действительно отменены (не успели напечатать "loaded").
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex04_StructuredConcurrencyKt"
 */

data class Item(val id: Long, val payload: String)

suspend fun loadItem(id: Long): Item {
    TODO("delay, при id==3 бросить RuntimeException")
}

suspend fun loadAllOrFail(ids: List<Long>): List<Item> {
    TODO("coroutineScope + async/await")
}

suspend fun loadAllOrPartial(ids: List<Long>): Map<Long, Result<Item>> {
    TODO("supervisorScope + async + runCatching при await")
}

fun main() = runBlocking {
    val ids = listOf(1L, 2L, 3L, 4L, 5L)

    println("--- loadAllOrFail ---")
    runCatching { loadAllOrFail(ids) }
        .onSuccess { println("ok: $it") }
        .onFailure { println("failed: ${it.message}") }

    println("--- loadAllOrPartial ---")
    val partial = loadAllOrPartial(ids)
    partial.forEach { (id, res) -> println("id=$id -> $res") }
}
