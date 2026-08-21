package exercises

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import kotlin.system.measureTimeMillis

/**
 * УПРАЖНЕНИЕ 15: Rate limiter со скользящим окном
 *
 * Зачем в реальном коде: у внешнего API есть контракт «не больше N запросов за окно».
 * Превысил — получаешь 429 на всё подряд, включая критичные запросы, и разбираешься
 * с чужим rate limiting'ом вместо своего.
 *
 * Теория: theory/BACKEND_PATTERNS.md §2, theory/SHARED_STATE.md §5
 *
 * Задание 1: Реализуй `Ex15RateLimiter.withPermit(block)`.
 *            Требования:
 *              1. За любое окно длительностью [windowMillis] СТАРТУЕТ не более [permits] операций.
 *              2. Разрешение возвращается ровно через [windowMillis] после ВЫДАЧИ (скользящее
 *                 окно), а не после завершения операции — иначе долгие операции искажали бы лимит.
 *              3. Ожидающие вызовы приостанавливаются: никакого `Thread.sleep` и busy-wait.
 *              4. Отложенный возврат разрешений выполняется в переданном [scope] — так его
 *                 жизненный цикл контролирует владелец лимитера, а не случайный вызывающий.
 *              5. Ошибка внутри блока не должна «съедать» разрешение навсегда.
 *
 * Задание 2 (бонус): подумай, чем этот лимитер отличается от token bucket и что произойдёт,
 *            если [scope] отменят, пока кто-то ждёт разрешения.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex15_RateLimiterKt"
 * Тесты:  mvn test -Dtest=Ex15RateLimiterTest
 */
class Ex15RateLimiter(
    private val permits: Int,
    private val windowMillis: Long,
    private val scope: CoroutineScope,
) {

    suspend fun <T> withPermit(block: suspend () -> T): T {
        TODO("Задание 1: не более permits стартов за окно windowMillis")
    }
}

fun main() = runBlocking {
    val limiter = Ex15RateLimiter(permits = 3, windowMillis = 300, scope = this)

    val elapsed = measureTimeMillis {
        coroutineScope {
            List(9) { i ->
                async { limiter.withPermit { println("вызов $i на ${System.currentTimeMillis() % 100_000}") } }
            }.awaitAll()
        }
    }

    println("9 вызовов по 3 за 300 мс заняли ~$elapsed мс (ожидали ≈ 600)")
}
