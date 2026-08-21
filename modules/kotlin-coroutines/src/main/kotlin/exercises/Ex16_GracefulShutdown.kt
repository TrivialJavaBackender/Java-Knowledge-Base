package exercises

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers

/**
 * УПРАЖНЕНИЕ 16: Graceful shutdown сервиса
 *
 * Зачем в реальном коде: при деплое под получает SIGTERM. Всё, что не успело корректно
 * завершиться, — это оборванные транзакции, потерянные события аудита и повторные списания
 * после рестарта.
 *
 * Теория: theory/BACKEND_PATTERNS.md §8, theory/SCOPE_CONTEXT.md §5
 *
 * Задание 1: Реализуй `Ex16TaskService`.
 *            Требования:
 *              1. Свой scope с `SupervisorJob` — падение одной задачи не роняет сервис
 *                 и не мешает остальным. При этом ошибка не должна улетать в глобальный
 *                 обработчик: поставь `CoroutineExceptionHandler` в контекст scope
 *                 (иначе в тестах она всплывёт как падение всего теста, а в проде — как
 *                 запись в stderr без контекста).
 *              2. `submit` возвращает true, если задача принята, и false — если сервис
 *                 уже останавливается.
 *              3. `shutdown(timeoutMillis)`:
 *                 — перестаёт принимать новые задачи (сразу, до ожидания);
 *                 — ждёт завершения текущих не дольше таймаута;
 *                 — если не дождался — отменяет их и ДОЖИДАЕТСЯ фактического завершения;
 *                 — возвращает true, если все успели сами, и false, если пришлось отменять.
 *              4. `activeCount` — сколько задач сейчас выполняется.
 *              5. Повторный `shutdown` не должен падать.
 *
 * Задание 2 (бонус): что изменится, если задачам нужно дать «докоммитить» уже начатую
 *            транзакцию даже после отмены? (Подсказка: NonCancellable — на стороне задачи,
 *            а не сервиса.)
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex16_GracefulShutdownKt"
 * Тесты:  mvn test -Dtest=Ex16GracefulShutdownTest
 */
class Ex16TaskService(context: CoroutineContext = Dispatchers.Default) {

    fun submit(name: String, task: suspend () -> Unit): Boolean {
        TODO("Задание 1: принять задачу, если сервис ещё принимает")
    }

    suspend fun shutdown(timeoutMillis: Long): Boolean {
        TODO("Задание 1: перестать принимать → дождаться с таймаутом → добить")
    }

    val activeCount: Int
        get() = TODO("Задание 1: сколько задач выполняется прямо сейчас")

    /** Сколько задач упало с необработанной ошибкой — для метрик и тестов. */
    val failureCount: Int
        get() = TODO("Задание 1: считать ошибки в CoroutineExceptionHandler своего scope")
}

fun main() = runBlocking {
    val service = Ex16TaskService()

    service.submit("быстрая") { delay(100); println("быстрая завершилась") }
    service.submit("медленная") { delay(5_000); println("медленная завершилась") }
    service.submit("падающая") { delay(50); error("упала — сервис должен выжить") }

    delay(200)
    println("активных задач: ${service.activeCount}")

    val clean = service.shutdown(timeoutMillis = 300)
    println("остановились штатно: $clean (ожидали false — медленная не успела)")
    println("принимаем ли новые: ${service.submit("поздняя") { }} (ожидали false)")
}
