package exercises

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.runBlocking

/**
 * УПРАЖНЕНИЕ 3: Dispatchers — CPU + IO + bounded parallelism
 *
 * Задание 1: Реализуй `parseDocument(raw: ByteArray): Document` — CPU-bound работа,
 *            эмуляция через busy-loop или тяжёлый Stream-вычисление.
 *
 * Задание 2: Реализуй `readDocumentBytes(path: String): ByteArray` — БЛОКИРУЮЩЕЕ чтение
 *            (через Thread.sleep, имитируя медленный диск).
 *
 * Задание 3: Реализуй `processDocument(path: String): Document` — корректно
 *            переключает диспатчеры: read на IO, parse на Default. Не должно блокировать
 *            "не свой" пул.
 *
 * Задание 4: Реализуй `dbSave(record: DbRecord)`, использующий `dbDispatcher` —
 *            ограниченный диспатчер, имитирующий пул соединений на 4 потока.
 *            Реализуй `saveAll(records: List<DbRecord>)` — параллельная запись через
 *            этот диспатчер; убедись, что одновременно не более 4 операций.
 *
 * Задание 5 (бонус): Замерь время `saveAll` со списком 20 записей и
 *            проверь, что оно ≈ ceil(20/4) * (время одной записи).
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex03_DispatchersKt"
 */

data class Document(val title: String, val wordCount: Int)
data class DbRecord(val id: Long, val data: String)

val dbDispatcher: CoroutineDispatcher = TODO("Создать ограниченный диспатчер на 4 потока")

fun parseDocument(raw: ByteArray): Document {
    TODO("CPU-bound парсинг (имитация busy work)")
}

fun readDocumentBytes(path: String): ByteArray {
    TODO("Блокирующее чтение через Thread.sleep + dummy data")
}

suspend fun processDocument(path: String): Document {
    TODO("read на Dispatchers.IO, parse на Dispatchers.Default")
}

suspend fun dbSave(record: DbRecord) {
    TODO("Имитация записи в БД через delay, выполняется на dbDispatcher")
}

suspend fun saveAll(records: List<DbRecord>) {
    TODO("Параллельная запись через dbDispatcher")
}

fun main() = runBlocking {
    val doc = processDocument("/tmp/report.txt")
    println("Parsed: $doc")

    val records = (1..20L).map { DbRecord(it, "rec-$it") }
    val time = kotlin.system.measureTimeMillis { saveAll(records) }
    println("Saved 20 records in $time ms")
}
