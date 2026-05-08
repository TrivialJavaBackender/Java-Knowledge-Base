package exercises

/**
 * Ex01 — Cache-aside basic.
 *
 * Реализуй простейший cache-aside поверх "БД" с искусственной задержкой.
 *
 * Условия:
 * - `SlowDb` имитирует БД: `read(key)` спит 200мс, потом возвращает значение.
 * - Реализуй `CacheAsideRepository.get(key)`:
 *   - На hit — возврат из кэша без обращения в БД.
 *   - На miss — читать из БД, класть в кэш, возвращать.
 * - Реализуй `update(key, value)`:
 *   - Записать в БД.
 *   - **Корректно** обновить кэш (подумай, какой порядок безопаснее: invalidate vs put).
 * - Сделать репозиторий thread-safe для concurrent чтения и записи. Никаких глобальных synchronized.
 *
 * В `main`:
 * 1. Запусти 1000 параллельных `get(42)`. Должно быть ровно 1 обращение к БД (счётчик в SlowDb).
 *    Если у тебя обращений больше — в репозитории нет защиты от cache stampede; **на этом этапе
 *    допустимо — Ex06 будет про защиту**, но засеки число и опиши, почему так.
 * 2. После warmup'а вызови `update(42, "v2")` и проверь, что следующий `get(42)` отдаёт "v2"
 *    без захода в БД (или с заходом — зависит от твоей стратегии invalidate vs put).
 *
 * НЕ ИСПОЛЬЗУЙ Caffeine. Ровно `ConcurrentHashMap` и (опционально) `CompletableFuture`.
 */

import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicInteger

class SlowDb {
    val readCount = AtomicInteger(0)
    private val data = ConcurrentHashMap<Int, String>().apply {
        put(42, "v1")
    }

    fun read(key: Int): String? {
        readCount.incrementAndGet()
        Thread.sleep(200)
        return data[key]
    }

    fun write(key: Int, value: String) {
        data[key] = value
    }
}

class CacheAsideRepository(private val db: SlowDb) {
    // TODO: подбери структуру для thread-safe кэша

    fun get(key: Int): String? {
        // TODO
        throw NotImplementedError()
    }

    fun update(key: Int, value: String) {
        // TODO: запиши в БД и обнови кэш корректно
        throw NotImplementedError()
    }
}

fun main() {
    val db = SlowDb()
    val repo = CacheAsideRepository(db)
    val pool = Executors.newFixedThreadPool(50)

    val start = System.currentTimeMillis()
    val futures = (1..1000).map { pool.submit { repo.get(42) } }
    futures.forEach { it.get() }
    val elapsed = System.currentTimeMillis() - start
    println("1000 gets done in ${elapsed}ms, db.readCount=${db.readCount.get()}")

    repo.update(42, "v2")
    println("after update get(42)=${repo.get(42)} db.readCount=${db.readCount.get()}")

    pool.shutdown()
}
