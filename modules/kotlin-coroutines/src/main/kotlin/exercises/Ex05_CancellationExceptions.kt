package exercises

import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 5: Cancellation & Exceptions
 *
 * Задание 1: Реализуй `processFile(path: String)` — корутину, которая:
 *              - "открывает" ресурс (логирует "OPEN $path"),
 *              - в цикле обрабатывает 100 порций данных через delay(50),
 *              - корректно реагирует на отмену (cooperative),
 *              - в `finally` логирует "CLOSE $path",
 *              - если "запись итоговой метрики" нужно делать suspend-вызовом, использует
 *                NonCancellable, чтобы операция не пропала при отмене.
 *
 * Задание 2: Реализуй `processCpuLoop()` — CPU-bound loop без естественных
 *            suspension points, который ВСЁ РАВНО отменяется (через явные проверки).
 *
 * Задание 3: Реализуй `tryWithTimeout()` — вызывает медленную операцию через
 *            `withTimeoutOrNull(500)` и возвращает значение или null.
 *
 * Задание 4: Создай scope с `CoroutineExceptionHandler`, который логирует
 *            непойманные исключения корневых корутин. Запусти в нём `launch`,
 *            бросающую RuntimeException, и убедись, что handler сработал.
 *
 * Задание 5 (бонус): Покажи разницу между `launch { throw X }` (handler ловит)
 *            и `async { throw X }` без `await` (исключение хранится до await).
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex05_CancellationExceptionsKt"
 */

suspend fun processFile(path: String) {
    TODO("Открыть, обработать в цикле, закрыть в finally, метрика через NonCancellable")
}

suspend fun processCpuLoop(): Long {
    TODO("CPU-bound loop с явной проверкой ensureActive/yield")
}

suspend fun tryWithTimeout(): String? {
    TODO("withTimeoutOrNull(500) { delay(1000); ... }")
}

fun main() = runBlocking {
    val job = launch { processFile("/tmp/big.bin") }
    delay(120)
    job.cancelAndJoin()
    println("--- file done ---")

    val r = tryWithTimeout()
    println("tryWithTimeout = $r")
}
