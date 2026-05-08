package exercises

/**
 * Ex07 — Write-through vs write-behind.
 *
 * Реализуй два репозитория поверх одной "медленной БД" и сравни их поведение.
 *
 * `SlowDb` имитирует БД: `write(k, v)` спит 50мс. У БД есть `writeCount` (single ops) и
 * `batchCount` (batch ops).
 *
 * Часть 1: `WriteThroughRepo`.
 * - `put(k, v)`: синхронно пишет в кэш и в БД, потом возвращается. Если БД упала — бросаем
 *   исключение, кэш не обновляется.
 * - `get(k)`: hit → из кэша; miss → null (мы только что писали, всё должно быть в кэше).
 * - Thread-safe.
 *
 * Часть 2: `WriteBehindRepo`.
 * - `put(k, v)`: моментально пишет в кэш, ставит запись в очередь на flush в БД.
 *   Возвращается сразу (latency ≈ 0).
 * - Фоновый flusher раз в `flushIntervalMs` забирает из очереди до `batchSize` записей и
 *   шлёт их в БД одним батчем (`SlowDb.writeBatch(list)`).
 * - На `close()` — flush оставшегося, потом shutdown.
 * - Если flush упал (имитируй через флаг) — записи возвращаются в очередь.
 *
 * В `main` проведи бенчмарк:
 * - 1000 put'ов в каждый репозиторий, замерь латентность `put` (медиана).
 * - Через секунду после write-behind: распечатай writeCount и batchCount БД.
 * - Сравни: write-through делает 1000 single writes, write-behind — несколько батчей.
 *
 * Не используй Caffeine для кэша внутри репозитория — для упражнения хватит ConcurrentHashMap.
 */

import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicInteger

class FlakySlowDb {
    val writeCount = AtomicInteger(0)
    val batchCount = AtomicInteger(0)
    @Volatile var failNextBatch = false

    fun write(key: Int, value: String) {
        Thread.sleep(50)
        writeCount.incrementAndGet()
    }

    fun writeBatch(items: List<Pair<Int, String>>) {
        if (failNextBatch) {
            failNextBatch = false
            error("simulated batch failure")
        }
        Thread.sleep(50)  // батч стоит как одна операция (главное — RTT)
        batchCount.incrementAndGet()
        writeCount.addAndGet(items.size)
    }
}

class WriteThroughRepo(private val db: FlakySlowDb) {
    // TODO

    fun put(key: Int, value: String) { TODO() }
    fun get(key: Int): String? { TODO() }
}

class WriteBehindRepo(
    private val db: FlakySlowDb,
    private val flushIntervalMs: Long = 100,
    private val batchSize: Int = 50
) : AutoCloseable {
    // TODO: cache, очередь, ScheduledExecutorService для flusher'а

    fun put(key: Int, value: String) { TODO() }
    fun get(key: Int): String? { TODO() }
    override fun close() { TODO() }
}

fun main() {
    run {
        val db = FlakySlowDb()
        val repo = WriteThroughRepo(db)
        val latencies = LongArray(1000)
        for (i in 0 until 1000) {
            val s = System.nanoTime()
            repo.put(i, "v$i")
            latencies[i] = System.nanoTime() - s
        }
        latencies.sort()
        println("write-through median latency=${latencies[500] / 1_000_000}ms, db.writeCount=${db.writeCount.get()}")
    }

    run {
        val db = FlakySlowDb()
        WriteBehindRepo(db).use { repo ->
            val latencies = LongArray(1000)
            for (i in 0 until 1000) {
                val s = System.nanoTime()
                repo.put(i, "v$i")
                latencies[i] = System.nanoTime() - s
            }
            latencies.sort()
            println("write-behind put-latency median=${latencies[500] / 1_000}us")
            Thread.sleep(2_000)  // дать flusher'у завершить
            println("after 2s: db.writeCount=${db.writeCount.get()} batchCount=${db.batchCount.get()}")
        }
    }
}
