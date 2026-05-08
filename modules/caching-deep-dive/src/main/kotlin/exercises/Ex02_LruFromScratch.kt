package exercises

/**
 * Ex02 — LRU from scratch (O(1) get/put).
 *
 * Реализуй `LruCache<K, V>(capacity)` со следующими гарантиями:
 *
 * - `get(key)`: O(1). Возвращает значение или null, и ОБНОВЛЯЕТ recency (этот ключ становится
 *   самым "свежим").
 * - `put(key, value)`: O(1). Если ключ есть — обновляет значение и recency. Если ключа нет —
 *   добавляет; при превышении capacity вытесняет least-recently-used и зовёт `onEvict(k, v)`.
 * - `size()`: число элементов.
 * - `keysInOrder()`: список ключей от most-recent к least-recent (для дебага/тестов).
 *
 * Требования:
 * - Не использовать `LinkedHashMap` или другие готовые LRU-структуры.
 *   Только `HashMap` + двусвязный список, который ты пишешь сам.
 * - Не нужно делать thread-safe (синхронизация будет в Ex04).
 * - Минимизируй аллокации: при move-to-front не создавай новые ноды.
 *
 * В `main` проверь:
 * - put 1,2,3,4 при capacity=3 → вытесняется 1.
 * - put 1,2,3, get 1, put 4 → вытесняется 2 (а не 1).
 * - put 1,2,3, put 1=11, put 4 → вытесняется 2.
 * - Корректность `keysInOrder()` после серии операций.
 */

class LruCache<K, V>(
    private val capacity: Int,
    private val onEvict: (K, V) -> Unit = { _, _ -> }
) {
    init {
        require(capacity > 0)
    }

    // TODO: HashMap<K, Node<K, V>> + sentinel head/tail двусвязного списка

    fun get(key: K): V? {
        // TODO
        throw NotImplementedError()
    }

    fun put(key: K, value: V) {
        // TODO
        throw NotImplementedError()
    }

    fun size(): Int {
        // TODO
        throw NotImplementedError()
    }

    fun keysInOrder(): List<K> {
        // TODO: head → tail = MRU → LRU
        throw NotImplementedError()
    }
}

fun main() {
    val evicted = mutableListOf<Pair<Int, String>>()
    val c = LruCache<Int, String>(capacity = 3, onEvict = { k, v -> evicted += k to v })

    c.put(1, "a"); c.put(2, "b"); c.put(3, "c")
    println(c.keysInOrder())  // [3, 2, 1]
    c.put(4, "d")
    println("evicted=$evicted")  // [(1, a)]

    val c2 = LruCache<Int, String>(3)
    c2.put(1, "a"); c2.put(2, "b"); c2.put(3, "c")
    c2.get(1)
    c2.put(4, "d")  // должен вытеснить 2
    println(c2.keysInOrder())  // [4, 1, 3]
}
