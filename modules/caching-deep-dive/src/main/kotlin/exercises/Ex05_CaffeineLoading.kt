package exercises

/**
 * Ex05 — Caffeine: LoadingCache + AsyncLoadingCache + refreshAfterWrite.
 *
 * Цель: построить production-grade JVM кэш и продемонстрировать поведение разных
 * политик expiry на одном и том же сценарии.
 *
 * Часть 1: `LoadingCache<String, String>`.
 * - `maximumSize=100`, `expireAfterWrite=2s`, `recordStats()`.
 * - Loader спит 100мс и возвращает "v-${counter.incrementAndGet()}-$key".
 * - Прогрей: get("k1"), get("k1") — проверь, что loader вызвался один раз.
 * - Подожди 3 секунды, get("k1") — loader должен вызваться снова.
 * - Распечатай stats: hitCount, missCount, evictionCount, hitRate.
 *
 * Часть 2: `AsyncLoadingCache<String, String>`.
 * - Тот же loader, но возвращает CompletableFuture.
 * - Запусти 1000 параллельных `get("k1")` сразу. Проверь, что loader вызвался ОДИН раз
 *   (single-flight гарантия).
 *
 * Часть 3: `refreshAfterWrite` на горячих ключах.
 * - `expireAfterWrite=10s`, `refreshAfterWrite=1s`, `recordStats()`.
 * - Loader при каждом вызове увеличивает счётчик и возвращает "v-${counter}".
 * - В цикле каждые 200мс делай get("hot"). Печатай возвращаемое значение и счётчик loader'а.
 * - Что должно происходить:
 *   - первые ~5 итераций возвращают одно и то же (loader вызвался 1 раз).
 *   - после 1 секунды следующий get триггерит async refresh: возвращается СТАРОЕ значение,
 *     но в фоне loader перезапускается.
 *   - значение обновляется на следующем get'е после завершения refresh'а.
 *
 * Опиши наблюдения в конце файла.
 *
 * Зависимость: Caffeine 3.x уже в pom.xml.
 */

import com.github.benmanes.caffeine.cache.AsyncCacheLoader
import com.github.benmanes.caffeine.cache.AsyncLoadingCache
import com.github.benmanes.caffeine.cache.CacheLoader
import com.github.benmanes.caffeine.cache.Caffeine
import com.github.benmanes.caffeine.cache.LoadingCache
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

fun part1Sync() {
    val loaderCalls = AtomicInteger(0)
    // TODO: построй LoadingCache с заданными параметрами
    val cache: LoadingCache<String, String> = TODO()

    // TODO: get, get, sleep 3s, get, печать stats
}

fun part2Async() {
    val loaderCalls = AtomicInteger(0)
    // TODO: построй AsyncLoadingCache. Loader через CompletableFuture.supplyAsync.
    val cache: AsyncLoadingCache<String, String> = TODO()

    // TODO: 1000 параллельных get → join → проверь loaderCalls
}

fun part3RefreshAhead() {
    val loaderCalls = AtomicInteger(0)
    // TODO: LoadingCache с refreshAfterWrite=1s, expireAfterWrite=10s
    val cache: LoadingCache<String, String> = TODO()

    // TODO: цикл с get и логированием
}

fun main() {
    println("=== part1: LoadingCache ===")
    part1Sync()
    println()
    println("=== part2: AsyncLoadingCache single-flight ===")
    part2Async()
    println()
    println("=== part3: refreshAfterWrite ===")
    part3RefreshAhead()
}

/*
 * Наблюдения (заполни после реализации):
 *
 * 1. expireAfterWrite vs refreshAfterWrite:
 *
 * 2. Что было видно по stats:
 *
 * 3. AsyncLoadingCache single-flight:
 */
