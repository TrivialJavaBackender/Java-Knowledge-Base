package exercises

import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 9: Suspend Internals — мост Java callback API → suspend
 *
 * Дано: симуляция Java callback API (см. ниже LegacyAsyncClient + Callback).
 * Метод `fetchAsync(query, callback)` запускает работу в отдельном потоке и
 * вызывает `onSuccess` или `onError`. Возвращает Cancellable handle.
 *
 * Задание 1: Реализуй `fetchSuspending(client, query): String` — suspend-функция,
 *            конвертирующая callback API в suspend через `suspendCancellableCoroutine`.
 *            Требования:
 *              - При нормальном завершении возвращает result.
 *              - При onError бросает соответствующее исключение.
 *              - При отмене корутины вызывает `cancel()` на полученном Cancellable
 *                (через invokeOnCancellation).
 *              - Никогда не вызывает resume больше одного раза.
 *
 * Задание 2: Напиши тест в main:
 *              - Успешный путь: вызвать `fetchSuspending` и получить результат.
 *              - Путь ошибки: вызвать с query == "fail" и убедиться, что бросает.
 *              - Путь отмены: запусти fetchSuspending в launch, отмени через 50 мс
 *                и убедись, что Cancellable.cancel() был вызван.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex09_SuspendInternalsKt"
 */

interface Callback {
    fun onSuccess(value: String)
    fun onError(e: Throwable)
}

interface Cancellable {
    fun cancel()
}

class LegacyAsyncClient {
    fun fetchAsync(query: String, callback: Callback): Cancellable {
        val thread = Thread {
            try {
                Thread.sleep(200)
                if (query == "fail") callback.onError(RuntimeException("server error"))
                else callback.onSuccess("result for $query")
            } catch (_: InterruptedException) {
                callback.onError(RuntimeException("cancelled"))
            }
        }.also { it.isDaemon = true; it.start() }
        return object : Cancellable {
            override fun cancel() { thread.interrupt() }
        }
    }
}

suspend fun fetchSuspending(client: LegacyAsyncClient, query: String): String {
    TODO("suspendCancellableCoroutine { cont -> ... invokeOnCancellation { handle.cancel() } }")
}

fun main() = runBlocking {
    val client = LegacyAsyncClient()

    println("--- success ---")
    println(fetchSuspending(client, "users"))

    println("--- error ---")
    runCatching { fetchSuspending(client, "fail") }
        .onFailure { println("error: ${it.message}") }

    println("--- cancellation ---")
    val job = launch {
        runCatching { fetchSuspending(client, "slow") }
            .onFailure { println("cancelled: ${it::class.simpleName}") }
    }
    delay(50)
    job.cancelAndJoin()
}
