package exercises

/**
 * Ex06 — Cache stampede protection (single-flight без Caffeine).
 *
 * Сценарий: горячий ключ только что expired. 1000 потоков одновременно делают `get(key)`.
 * Loader из БД дорогой (200мс). Без защиты loader вызовется 1000 раз.
 *
 * Задача: реализуй `SingleFlightCache<K, V>`, где для одного ключа в один момент
 * времени может выполняться **не более одного** обращения к loader'у. Все остальные
 * параллельные `get` по этому ключу ждут результат и получают его без повторного вызова loader'а.
 *
 * Контракт:
 * - `get(key, loader: () -> V): V` — синхронно ждёт результат.
 * - Если loader бросает исключение — все ожидающие получают это исключение, а ключ удаляется
 *   из in-flight (следующий get запустит loader снова).
 * - Не должно быть memory-утечек: после успешного get'а promise/future убирается из in-flight
 *   таблицы. Кэш самого значения — отдельная мапа с TTL.
 *
 * Подсказка ПО ПОДХОДУ (не реализация): подумай о `ConcurrentHashMap.computeIfAbsent` с
 * `CompletableFuture` как значением. Не вызывай loader.invoke() ВНУТРИ `computeIfAbsent` — это
 * заблокирует другие операции на CHM (даже в других bin'ах при reentrant).
 *
 * В `main`:
 * - Без защиты (baseline): 1000 потоков делают `loader.get()` напрямую → распечатать loaderCalls.
 * - С защитой: 1000 потоков делают `cache.get("k", loader)` → loaderCalls должен быть **1**.
 * - Прогон с loader, который бросает исключение на первый вызов и ОК на второй:
 *   убедись, что в первой волне (1000 параллельных) все получили ошибку, а второй вызов
 *   из main thread вернул значение (то есть состояние очистилось).
 */

import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicInteger

class SingleFlightCache<K, V> {
    // TODO: in-flight + (опционально) value cache с TTL для уже загруженных

    fun get(key: K, loader: () -> V): V {
        // TODO
        throw NotImplementedError()
    }
}

fun main() {
    val loaderCalls = AtomicInteger(0)
    val loader: () -> String = {
        loaderCalls.incrementAndGet()
        Thread.sleep(200)
        "v"
    }

    // baseline: без защиты
    loaderCalls.set(0)
    val pool = Executors.newFixedThreadPool(64)
    val baselineFutures = (1..1000).map { pool.submit<String> { loader() } }
    baselineFutures.forEach { it.get() }
    println("baseline loaderCalls=${loaderCalls.get()}")

    // protected
    loaderCalls.set(0)
    val cache = SingleFlightCache<String, String>()
    val protectedFutures = (1..1000).map { pool.submit<String> { cache.get("k") { loader() } } }
    protectedFutures.forEach { it.get() }
    println("protected loaderCalls=${loaderCalls.get()}")

    // exception cleanup
    val callCount = AtomicInteger(0)
    val flakyLoader: () -> String = {
        if (callCount.incrementAndGet() == 1) error("boom")
        "ok"
    }
    val cache2 = SingleFlightCache<String, String>()
    val errors = AtomicInteger(0)
    val futures = (1..1000).map {
        pool.submit<String> {
            try { cache2.get("k", flakyLoader) }
            catch (e: Exception) { errors.incrementAndGet(); "err" }
        }
    }
    futures.forEach { it.get() }
    println("first wave: errors=${errors.get()} callCount=${callCount.get()}")
    println("second call: ${cache2.get("k", flakyLoader)} callCount=${callCount.get()}")

    pool.shutdown()
}
