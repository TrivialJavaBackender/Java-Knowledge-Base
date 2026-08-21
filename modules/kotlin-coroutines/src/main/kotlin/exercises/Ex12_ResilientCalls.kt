package exercises

import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 12: Устойчивые вызовы — retry с backoff и гонка реплик
 *
 * Зачем в реальном коде: внешний сервис моргает (retry) или отвечает по-разному быстро
 * с разных реплик (гонка). Обе функции пишутся почти в каждом бэкенде — и обе почти всегда
 * пишутся с одной и той же ошибкой: ретраят или «выигрывают» отмену.
 *
 * Теория: theory/BACKEND_PATTERNS.md §3, theory/CANCELLATION_EXCEPTIONS.md
 *
 * Задание 1: Реализуй `ex12RetryWithBackoff(...)`.
 *            Требования:
 *              1. Всего не больше [maxAttempts] попыток; номер попытки (с 0) передаётся в [block].
 *              2. Пауза растёт экспоненциально: [initialDelayMs], затем ×[factor],
 *                 но не больше [maxDelayMs].
 *              3. `CancellationException` НИКОГДА не ретраится — пробрасывается немедленно.
 *              4. Если [retryOn] вернул false — исключение пробрасывается сразу, без повторов.
 *              5. Попытки исчерпаны — бросить последнее исключение.
 *              6. Без jitter: тест проверяет точные тайминги (в проде jitter обязателен,
 *                 см. задание 3).
 *
 * Задание 2: Реализуй `ex12FirstSuccessful(sources)` — гонка реплик.
 *            Требования:
 *              1. Все источники стартуют параллельно.
 *              2. Возвращается результат первого УСПЕШНОГО; остальные отменяются сразу.
 *              3. Падение источника не прекращает гонку — ждём следующего.
 *              4. Упали все → бросить исключение, в котором остальные лежат в `suppressed`.
 *              5. Пустой список источников → IllegalArgumentException.
 *
 * Задание 3 (бонус): напиши вариант `ex12RetryWithBackoff` с full jitter
 *            (пауза = random(0, backoff)) и объясни в комментарии, почему без него
 *            тысяча клиентов добьёт поднимающийся сервис.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex12_ResilientCallsKt"
 * Тесты:  mvn test -Dtest=Ex12ResilientCallsTest
 */

suspend fun <T> ex12RetryWithBackoff(
    maxAttempts: Int = 4,
    initialDelayMs: Long = 100,
    factor: Double = 2.0,
    maxDelayMs: Long = 5_000,
    retryOn: (Throwable) -> Boolean = { true },
    block: suspend (attempt: Int) -> T,
): T {
    TODO("Задание 1: повторы с экспоненциальным backoff, отмена не ретраится")
}

suspend fun <T> ex12FirstSuccessful(sources: List<suspend () -> T>): T {
    TODO("Задание 2: параллельная гонка, первый успешный побеждает")
}

fun main() = runBlocking {
    var attempts = 0
    val value = ex12RetryWithBackoff(maxAttempts = 4, initialDelayMs = 50) { attempt ->
        attempts++
        if (attempt < 2) throw java.io.IOException("сеть моргнула, попытка $attempt")
        "готово с попытки $attempt"
    }
    println("retry: $value (всего вызовов блока: $attempts)")

    val fastest = ex12FirstSuccessful(
        listOf(
            { kotlinx.coroutines.delay(300); "медленная реплика" },
            { kotlinx.coroutines.delay(50); "быстрая реплика" },
            { kotlinx.coroutines.delay(10); throw IllegalStateException("сломанная реплика") },
        )
    )
    println("гонка: $fastest")
}
