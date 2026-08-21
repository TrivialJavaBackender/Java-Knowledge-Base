package exercises

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.util.concurrent.atomic.AtomicInteger

/**
 * УПРАЖНЕНИЕ 14: Single-flight — дедупликация одновременных загрузок
 *
 * Зачем в реальном коде: ключ вылетел из кэша, и сто параллельных запросов одновременно
 * пошли в базу за одним и тем же значением (cache stampede). Single-flight превращает
 * сто походов в один.
 *
 * Теория: theory/BACKEND_PATTERNS.md §5
 *
 * Задание 1: Реализуй `Ex14SingleFlightCache.get(key)`.
 *            Требования:
 *              1. N параллельных `get(key)` для одного ключа → loader вызван РОВНО ОДИН раз,
 *                 все получают одно значение.
 *              2. Успешный результат кэшируется: следующий `get` не вызывает loader.
 *              3. Ошибка НЕ кэшируется: все ожидающие получают эту ошибку, а следующий `get`
 *                 пробует загрузить заново.
 *              4. Разные ключи грузятся параллельно и не блокируют друг друга.
 *              5. Отмена одного из ожидающих не должна ломать загрузку для остальных.
 *
 * Главный вопрос задачи: почему нельзя просто сделать `async { loader(key) }` в scope того,
 * кто пришёл первым? (Подсказка — в требовании 5.)
 *
 * Задание 2 (бонус): а что произойдёт, если отменят самого ЛИДЕРА (того, кто выполняет загрузку)?
 *            Простая реализация уронит ожидающих вместе с ним. Подумай, как этого избежать
 *            и какой ценой (подсказка: загрузка должна жить в scope владельца кэша,
 *            а не вызывающего).
 *
 * Задание 3 (бонус): добавь `size` и `invalidate(key)`; подумай, что должно произойти,
 *            если `invalidate` вызвали во время загрузки этого ключа.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex14_SingleFlightKt"
 * Тесты:  mvn test -Dtest=Ex14SingleFlightTest
 */
class Ex14SingleFlightCache<K : Any, V : Any>(
    private val loader: suspend (K) -> V,
) {

    suspend fun get(key: K): V {
        TODO("Задание 1: дедуплицировать одновременные загрузки одного ключа")
    }
}

fun main() = runBlocking {
    val calls = AtomicInteger()
    val cache = Ex14SingleFlightCache<String, String> { key ->
        calls.incrementAndGet()
        delay(200)
        "значение для $key"
    }

    val results = coroutineScope {
        List(50) { async { cache.get("user:1") } }.awaitAll()
    }

    println("получили ${results.distinct().size} различных значений: ${results.first()}")
    println("loader вызван ${calls.get()} раз (ожидали 1)")

    cache.get("user:1")
    println("после кэширования loader вызван ${calls.get()} раз (ожидали по-прежнему 1)")
}
