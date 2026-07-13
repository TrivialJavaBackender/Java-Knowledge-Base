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

    private val map = HashMap<K, Node<K, V>>()
    private val head = Node<K, V>(null, null, null, null)
    private val tail = Node<K, V>(head, null, null, null)

    init {
        require(capacity > 0)
        head.prev = tail
    }

    class Node<K, V> (
        var next: Node<K, V>?,
        var prev: Node<K, V>?,
        var value: V?,
        val key: K?
    )

    // TODO: HashMap<K, Node<K, V>> + sentinel head/tail двусвязного списка

    fun get(key: K): V? {
        return map[key]?.also {
            val temp = head.prev
            if (temp != it && temp != null) {
                it.prev?.next = it.next
                it.next?.prev = it.prev

                head.prev = it
                temp.next = it

                it.prev = temp
                it.next = head
            }
        }?.value
    }

    fun put(key: K, value: V) {
        if (map[key] != null) {
            get(key)
            map[key]?.value = value
            return
        }
        if (map.size == capacity) {
            val temp = tail.next
            tail.next = tail.next?.next
            temp?.next?.prev = tail
            map.remove(temp?.key)
            onEvict(temp?.key!!, temp.value!!)
        }
        val newNode = Node(head, head.prev, value, key)
        head.prev?.next = newNode
        head.prev = newNode
        map[key] = newNode
    }

    fun size(): Int {
        return map.size
    }

    fun keysInOrder(): List<K> {
        return object : Iterator<K> {
            var current = head.prev!!
            override fun hasNext(): Boolean {
                return current != tail
            }

            override fun next(): K {
                val key = current.key!!
                current = current.prev!!
                return key
            }
        }.asSequence().toList()
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
