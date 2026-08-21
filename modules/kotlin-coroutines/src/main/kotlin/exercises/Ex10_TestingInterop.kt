package exercises

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import java.util.concurrent.CompletableFuture

/**
 * УПРАЖНЕНИЕ 10: Testing & Interop
 *
 * Часть A — Debouncer для тестирования с виртуальным временем.
 *
 * Задание 1: Реализуй `Debouncer(scope, timeoutMs)`:
 *              - Метод `submit(s: String)` — пишет в внутренний MutableStateFlow.
 *              - Свойство `output: StateFlow<String?>` — debounced поток (initial null).
 *
 * Задание 2: Напиши тест (в `kotlinx-coroutines-test`-стиле, но в main для простоты):
 *              запусти `runTest` с `advanceTimeBy`, чтобы проверить:
 *                - submit("a"), advanceTimeBy(100), submit("b"), advanceTimeBy(100), submit("c")
 *                - advanceTimeBy(299) — output.value == null
 *                - advanceTimeBy(2)   — output.value == "c"
 *
 * Часть B — Interop с CompletableFuture.
 *
 * Задание 3: Реализуй `loadAsCompletableFuture(scope, query): CompletableFuture<String>` —
 *            обёртка над suspend-функцией, возвращающая CompletableFuture (для вызова из Java).
 *
 * Задание 4: Реализуй `awaitCompletableFuture(cf: CompletableFuture<String>): String` —
 *            suspend-функция, которая ждёт CompletableFuture без блокировки потока.
 *            Должна корректно отменять CF при отмене корутины.
 *
 * Задание 5 (бонус): Реализуй `Deferred<T>.toCompletableFuture()` — обратное направление.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex10_TestingInteropKt"
 */

class Debouncer(scope: CoroutineScope, timeoutMs: Long) {
    private val pending = MutableStateFlow<String?>(null)
    val output: StateFlow<String?> = TODO("pending.debounce(timeoutMs).stateIn(...)")

    fun submit(s: String) { pending.value = s }
}

suspend fun loadSlowly(query: String): String {
    TODO("delay + return result")
}

fun loadAsCompletableFuture(scope: CoroutineScope, query: String): CompletableFuture<String> {
    TODO("scope.future { loadSlowly(query) }")
}

suspend fun awaitCompletableFuture(cf: CompletableFuture<String>): String {
    TODO("cf.await() из kotlinx.coroutines.future — он входит в core (или suspendCancellableCoroutine)")
}

fun main() = runBlocking {
    // Часть B (часть A удобнее в тестовом окружении, см. README)
    val cf = loadAsCompletableFuture(this, "users")
    val result = awaitCompletableFuture(cf)
    println("Loaded: $result")
}
