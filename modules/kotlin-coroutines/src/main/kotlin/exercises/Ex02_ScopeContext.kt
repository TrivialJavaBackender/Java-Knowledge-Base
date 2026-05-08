package exercises

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 2: CoroutineScope для класса-владельца
 *
 * Задание 1: Реализуй класс `ReportService` со своим `CoroutineScope`.
 *            Сервис умеет принимать отчёты через `submit(report)`. Каждый отчёт
 *            обрабатывается в отдельной корутине (имитация работы через delay).
 *
 *            Требования:
 *              - Scope сервиса должен переживать падение одной из обработок (один отчёт упал —
 *                остальные продолжают работать).
 *              - При вызове `close()` все запущенные обработки должны быть отменены.
 *              - Контекст должен включать имя ("ReportService") для отладки.
 *
 * Задание 2: Напиши демо в `main`, которое:
 *              - создаёт сервис,
 *              - засылает 5 отчётов (один из них специально падает),
 *              - убеждается, что 4 успешных отработали,
 *              - после `close()` новые `submit` либо игнорируются, либо логируются.
 *
 * Задание 3 (бонус): Проверь, что после `close()` нет утечек — все дочерние Job'ы isCancelled.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex02_ScopeContextKt"
 */

data class Report(val id: Long, val payload: String, val shouldFail: Boolean = false)

class ReportService : AutoCloseable {

    private val scope: CoroutineScope = TODO("Создать scope с SupervisorJob, диспатчером и CoroutineName")

    fun submit(report: Report) {
        TODO("Запустить обработку отчёта в scope")
    }

    suspend fun process(report: Report) {
        TODO("Имитация работы (delay), бросить RuntimeException если report.shouldFail")
    }

    override fun close() {
        TODO("Отменить scope")
    }
}

fun main() = runBlocking {
    val service = ReportService()
    repeat(5) { i ->
        service.submit(Report(id = i.toLong(), payload = "data-$i", shouldFail = (i == 2)))
    }
    kotlinx.coroutines.delay(500)
    service.close()
    println("Service closed")
}
