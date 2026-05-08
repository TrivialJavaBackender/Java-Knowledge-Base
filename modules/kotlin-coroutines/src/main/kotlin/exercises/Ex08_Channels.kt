package exercises

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 8: Channels — pipeline, fan-out, select
 *
 * Задание 1: Реализуй `producer(scope, count: Int): ReceiveChannel<Int>` —
 *            корутину-producer, отправляющую count чисел в bounded Channel(capacity = 8).
 *            Закрывает канал по завершении.
 *
 * Задание 2: Реализуй `fanOut(input: ReceiveChannel<Int>, workers: Int)` —
 *            запускает N воркеров, каждый читает из общего канала и обрабатывает
 *            (имитация delay). Каждое сообщение получает ровно один воркер.
 *
 * Задание 3: Реализуй `mergeWithSelect(a: ReceiveChannel<String>, b: ReceiveChannel<String>): ReceiveChannel<String>` —
 *            возвращает новый канал, в который через `select { }` сливаются оба источника.
 *            Закрывается, когда оба источника закрыты.
 *
 * Задание 4: Реализуй `pipeline(scope)` — трёхступенчатый конвейер:
 *              numbers() -> squares() -> sums() (пары из squares, суммы пар).
 *
 * Задание 5 (бонус): Сравни поведение Channel(RENDEZVOUS) и Channel(capacity=10) —
 *            покажи, что в RENDEZVOUS producer ждёт каждого consumer'а.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex08_ChannelsKt"
 */

fun producer(scope: kotlinx.coroutines.CoroutineScope, count: Int): ReceiveChannel<Int> {
    TODO("scope.produce { repeat(count) { send(...) } }")
}

suspend fun fanOut(input: ReceiveChannel<Int>, workers: Int) {
    TODO("coroutineScope { repeat(workers) { launch { for (v in input) ... } } }")
}

fun kotlinx.coroutines.CoroutineScope.mergeWithSelect(
    a: ReceiveChannel<String>,
    b: ReceiveChannel<String>,
): ReceiveChannel<String> {
    TODO("produce { while (a or b open) select { a.onReceive { send(it) }; b.onReceive { send(it) } } }")
}

fun main() = runBlocking {
    coroutineScope {
        val src = producer(this, count = 20)
        fanOut(src, workers = 4)
    }
    println("--- done ---")
}
