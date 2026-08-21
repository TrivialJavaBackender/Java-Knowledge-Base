package exercises

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 11: Разделяемое состояние — гонка и четыре способа её вылечить
 *
 * Зачем в реальном коде: счётчики метрик, локальный кэш и лимит на внешний сервис — это
 * ровно те четыре инструмента, что ниже. Выбор между ними определяет и корректность,
 * и пропускную способность сервиса.
 *
 * Теория: theory/SHARED_STATE.md
 *
 * Задание 0 (разминка, реализовано за тебя): `ex11UnsafeCounter` показывает саму гонку.
 *          Запусти main и убедись, что результат меньше ожидаемого.
 *
 * Задание 1: Реализуй `ex11AtomicCounter(workers, perWorker)` — тот же счётчик через атомик.
 *            Должен вернуть ровно workers * perWorker.
 *
 * Задание 2: Реализуй `ex11MutexCounter(workers, perWorker)` — через корутинный Mutex.
 *            Внимание: Mutex НЕ реентерабельный, а критическая секция должна быть короткой.
 *
 * Задание 3: Реализуй `ex11ConfinedCounter(workers, perWorker)` — через confinement:
 *            обычная `var` без всякой синхронизации, но все обращения к ней сериализованы
 *            диспетчером с параллелизмом 1.
 *
 * Задание 4: Реализуй `Ex11LimitedApi.call(block)` — пропускать не более `limit`
 *            одновременных вызовов. Это НЕ взаимное исключение: при limit = 4 четыре
 *            вызова должны идти параллельно.
 *            Требования:
 *              - разрешение освобождается и при ошибке блока (проверь finally-семантику),
 *              - никакого busy-wait: ожидание должно быть приостановкой.
 *
 * Задание 5 (бонус): объясни в комментарии, почему `synchronized(lock) { }` вокруг
 *            suspend-вызова не компилируется, и почему `ReentrantLock` здесь тоже плох.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex11_SharedStateKt"
 * Тесты:  mvn test -Dtest=Ex11SharedStateTest
 */

/** Демонстрация гонки: намеренно небезопасный счётчик. Реализовано, менять не нужно. */
suspend fun ex11UnsafeCounter(workers: Int, perWorker: Int): Int {
    var counter = 0
    coroutineScope {
        repeat(workers) {
            launch(Dispatchers.Default) {
                repeat(perWorker) { counter++ }
            }
        }
    }
    return counter
}

suspend fun ex11AtomicCounter(workers: Int, perWorker: Int): Int {
    TODO("Задание 1: посчитать через атомик")
}

suspend fun ex11MutexCounter(workers: Int, perWorker: Int): Int {
    TODO("Задание 2: посчитать под корутинным Mutex")
}

suspend fun ex11ConfinedCounter(workers: Int, perWorker: Int): Int {
    TODO("Задание 3: обычная var, но доступ сериализован диспетчером")
}

/**
 * Ограничитель одновременных вызовов.
 * [limit] — сколько блоков может выполняться параллельно.
 */
class Ex11LimitedApi(private val limit: Int) {

    suspend fun <T> call(block: suspend () -> T): T {
        TODO("Задание 4: пропустить не более limit одновременных вызовов")
    }
}

fun main() = runBlocking {
    val workers = 100
    val perWorker = 1_000
    val expected = workers * perWorker

    println("ожидали:   $expected")
    println("unsafe:    ${ex11UnsafeCounter(workers, perWorker)}   ← почти наверняка меньше")
    println("atomic:    ${ex11AtomicCounter(workers, perWorker)}")
    println("mutex:     ${ex11MutexCounter(workers, perWorker)}")
    println("confined:  ${ex11ConfinedCounter(workers, perWorker)}")
}
