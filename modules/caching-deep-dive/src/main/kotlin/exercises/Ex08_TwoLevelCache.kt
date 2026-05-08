package exercises

/**
 * Ex08 — Two-level cache (near-cache: L1 Caffeine + L2 simulated Redis + DB).
 *
 * Архитектура:
 *   client → L1 (Caffeine, локальный) → L2 (имитация Redis с задержкой 1мс) → DB (50мс)
 *
 * Реализуй `TwoLevelRepo`:
 * - `get(key)`: L1 → L2 → DB. На каждом уровне miss спускаемся ниже; на возврате —
 *   "промываем" вверх (DB-результат кладём в L2 и L1; L2-hit поднимаем в L1).
 * - `update(key, value)`:
 *   - Записать в DB.
 *   - Инвалидировать в L2.
 *   - Инвалидировать в L1 на ВСЕХ инстансах через `Broadcaster` (имитация Redis pub/sub).
 *
 * Несколько инстансов — для имитации near-cache:
 * - Создай 3 экземпляра `TwoLevelRepo`, каждый со своим L1, общим L2 и общим Broadcaster.
 * - Каждый репо подписан на Broadcaster; на сообщение "invalidate K" удаляет K из своего L1.
 *
 * Тест в main:
 * 1. repo[0].get(42) → DB hit, всё промыто. Сделай get(42) на repo[0..2] — у [0] L1-hit, у [1,2] L2-hit (и потом L1-hit на следующих).
 * 2. repo[0].update(42, "v2"):
 *    - Через 100мс убедись, что repo[1].get(42) не вернёт стейл. Должен быть L2-miss → DB → "v2".
 *    - А до broadcast'а repo[1] мог бы вернуть стейл из своего L1 — поэтому broadcast и нужен.
 * 3. Распечатай счётчики hits/misses на каждом уровне.
 *
 * Подсказка по архитектуре (не реализация):
 * - L1 — Caffeine с recordStats.
 * - L2 — простая `ConcurrentHashMap<K,V>` с искусственным sleep 1мс на get.
 * - Broadcaster — `CopyOnWriteArrayList<Listener>`. Никаких сетей, только in-memory.
 */

import com.github.benmanes.caffeine.cache.Cache
import com.github.benmanes.caffeine.cache.Caffeine
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

class FakeRedis {
    val getCount = AtomicInteger(0)
    val missCount = AtomicInteger(0)
    private val data = ConcurrentHashMap<Int, String>()

    fun get(k: Int): String? {
        getCount.incrementAndGet()
        Thread.sleep(1)
        return data[k].also { if (it == null) missCount.incrementAndGet() }
    }

    fun put(k: Int, v: String) { data[k] = v }
    fun invalidate(k: Int) { data.remove(k) }
}

class FakeDb {
    val readCount = AtomicInteger(0)
    private val data = ConcurrentHashMap<Int, String>().apply { put(42, "v1") }

    fun read(k: Int): String? {
        readCount.incrementAndGet()
        Thread.sleep(50)
        return data[k]
    }
    fun write(k: Int, v: String) { data[k] = v }
}

class Broadcaster {
    private val listeners = CopyOnWriteArrayList<(Int) -> Unit>()
    fun subscribe(l: (Int) -> Unit) { listeners += l }
    fun publish(key: Int) { listeners.forEach { it(key) } }
}

class TwoLevelRepo(
    private val id: Int,
    private val l2: FakeRedis,
    private val db: FakeDb,
    private val bus: Broadcaster
) {
    // TODO: l1 Caffeine + recordStats
    // TODO: подписаться на bus

    fun get(key: Int): String? { TODO() }
    fun update(key: Int, value: String) { TODO() }

    fun statsString(): String { TODO() }
}

fun main() {
    val l2 = FakeRedis()
    val db = FakeDb()
    val bus = Broadcaster()
    val repos = (0..2).map { TwoLevelRepo(it, l2, db, bus) }

    repos[0].get(42)  // DB hit
    repeat(2) { repos[0].get(42) }  // L1 hits
    repos[1].get(42)  // L2 hit
    repos[2].get(42)  // L2 hit

    repos[0].update(42, "v2")
    Thread.sleep(50)

    println("repo[1].get(42) = ${repos[1].get(42)}")  // должно быть "v2"

    repos.forEach { println(it.statsString()) }
    println("L2: gets=${l2.getCount.get()} misses=${l2.missCount.get()}")
    println("DB: reads=${db.readCount.get()}")
}
