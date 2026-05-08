package exercises

/**
 * Ex04 — TTL cache: ленивая vs фоновая инвалидация.
 *
 * Часть 1: `LazyTtlCache<K, V>(ttlMs)`.
 * - `put(k, v)`: запоминает значение и время записи.
 * - `get(k)`: если запись expired — удалить и вернуть null. Иначе вернуть значение.
 * - Никаких фоновых потоков. Память освобождается только на `get` или `put` по этому ключу.
 *
 * Часть 2: `BackgroundTtlCache<K, V>(ttlMs, sweepIntervalMs)`.
 * - Все методы lazy-варианта.
 * - Дополнительно — фоновый поток sweeper'а, который раз в `sweepIntervalMs` удаляет expired записи.
 * - Sweeper должен корректно завершаться через `close()`.
 *
 * Часть 3: эксперимент.
 * - Создай оба кэша с ttl=100мс. Заполни 10000 ключами. Не делай get'ов. Подожди 1 секунду.
 * - Распечатай размер внутренней мапы (ты должен дать к ней доступ для эксперимента — поле/метод).
 * - В `LazyTtlCache` все 10000 expired записей всё ещё лежат в памяти.
 * - В `BackgroundTtlCache` после sweep — должно быть 0.
 * - Опиши в комментариях ниже **trade-off**: когда выбирать ленивый, когда фоновый.
 *
 * Требования:
 * - Thread-safe.
 * - Используй `System.nanoTime()` для измерения интервалов (не `currentTimeMillis` — wall clock).
 */

import java.util.concurrent.*

class LazyTtlCache<K, V>(private val ttlNs: Long) {
    constructor(ttl: Long, unit: java.util.concurrent.TimeUnit) : this(unit.toNanos(ttl))

    // TODO: внутренняя структура

    fun put(key: K, value: V) {
        // TODO
        throw NotImplementedError()
    }

    fun get(key: K): V? {
        // TODO
        throw NotImplementedError()
    }

    fun internalSize(): Int {
        // TODO: для эксперимента
        throw NotImplementedError()
    }
}

class BackgroundTtlCache<K, V>(
    private val ttlNs: Long,
    private val sweepIntervalMs: Long
) : AutoCloseable {
    constructor(ttl: Long, unit: TimeUnit, sweep: Long, sweepUnit: TimeUnit) :
        this(unit.toNanos(ttl), sweepUnit.toMillis(sweep))

    // TODO: структура + ScheduledExecutorService для sweeper'а

    fun put(key: K, value: V) {
        // TODO
        throw NotImplementedError()
    }

    fun get(key: K): V? {
        // TODO
        throw NotImplementedError()
    }

    fun internalSize(): Int {
        // TODO
        throw NotImplementedError()
    }

    override fun close() {
        // TODO: shutdown sweeper
        throw NotImplementedError()
    }
}

fun main() {
    val lazy = LazyTtlCache<Int, String>(100, TimeUnit.MILLISECONDS)
    repeat(10_000) { lazy.put(it, "v$it") }
    Thread.sleep(1_000)
    println("lazy.internalSize after 1s without gets = ${lazy.internalSize()}")

    BackgroundTtlCache<Int, String>(100, TimeUnit.MILLISECONDS, 200, TimeUnit.MILLISECONDS).use { bg ->
        repeat(10_000) { bg.put(it, "v$it") }
        Thread.sleep(1_000)
        println("background.internalSize after 1s = ${bg.internalSize()}")
    }
}

/*
 * Trade-off (заполни после реализации):
 *
 * LazyTtlCache:
 * - Плюсы:
 * - Минусы:
 *
 * BackgroundTtlCache:
 * - Плюсы:
 * - Минусы:
 *
 * Когда что выбирать:
 */
