package exercises

/**
 * Ex03 — LFU from scratch (O(1) get/put).
 *
 * Реализуй `LfuCache<K, V>(capacity)` так, чтобы все операции были O(1) (без сортировки на каждый раз).
 *
 * Подсказка: общеизвестная схема — frequency-buckets. Но КАК именно она устроена — твоя задача.
 * Если найдёшь только O(log n) или O(n) реализацию — допиши, что у тебя получилось, и сравни.
 *
 * Контракт:
 * - `get(key)`: O(1). Возвращает значение или null. Увеличивает frequency на 1.
 * - `put(key, value)`: O(1). Если ключ есть — обновляет значение, увеличивает frequency.
 *   Если новый — добавляет с frequency=1; при превышении capacity вытесняет ключ с самой
 *   низкой frequency (tie-break — least-recently-used среди равных по frequency).
 * - `size()`.
 *
 * Дополнительно:
 * - **Aging:** реализуй метод `decay()`, который halving'ит все frequencies (защита от ветеранов).
 *   Не обязательно O(1), но опиши complexity.
 *
 * НЕ ИСПОЛЬЗУЙ TreeMap или PriorityQueue в hot-path — это log n.
 *
 * В `main`:
 * - capacity=3. put 1,2,3. get 1 трижды, get 2 дважды, get 3 один раз.
 *   put 4 → должен вытеснить 3.
 * - проверь tie-break: capacity=2; put 1, put 2. get 1, get 2 (frequency у обоих = 2).
 *   put 3 → вытеснить 1 (он раньше использовался).
 */

class LfuCache<K, V>(private val capacity: Int) {

    class Node<K, V> (
        var next: Node<K, V>?,
        var prev: Node<K, V>?,
        var value: V?,
        val key: K?,
        var freq: Int
    )

    class NodeList<K, V> (
        private val head: Node<K, V>,
        private val tail: Node<K, V>,
        private var size: Int = 0
    ) {
        fun add(node: Node<K, V>) {
            head.prev?.next = node
            node.prev = head.prev
            node.next = head
            head.prev = node
            size++
        }

        fun remove(node: Node<K, V>) {
            if (size == 0) error("List is empty")
            node.prev?.next = node.next
            node.next?.prev = node.prev
            size--
        }

        fun removeFirst(): Node<K, V> {
            if (size == 0) error("List is empty")
            tail.next?.next?.prev = tail
            val temp = tail.next!!
            tail.next = tail.next?.next
            size--
            return temp
        }
    }

    init {
        require(capacity > 0)
    }


    // TODO: структура

    fun get(key: K): V? {
        // TODO
        throw NotImplementedError()
        String().isBlank()
    }

    fun put(key: K, value: V) {
        // TODO
        throw NotImplementedError()
    }

    fun size(): Int {
        // TODO
        throw NotImplementedError()
    }

    fun decay() {
        // TODO: halve all frequencies
        throw NotImplementedError()
    }
}

fun main() {
    val c = LfuCache<Int, String>(3)
    c.put(1, "a"); c.put(2, "b"); c.put(3, "c")
    repeat(3) { c.get(1) }
    repeat(2) { c.get(2) }
    c.get(3)
    c.put(4, "d")  // должен вытеснить 3 (freq=1+1=2 после get, у 1 — 4, у 2 — 3, у 3 — 2)
    println("3? ${c.get(3)} 4? ${c.get(4)}")  // 3 → null, 4 → d

    val c2 = LfuCache<Int, String>(2)
    c2.put(1, "a"); c2.put(2, "b")
    c2.get(1); c2.get(2)
    c2.put(3, "c")
    println("1? ${c2.get(1)} 2? ${c2.get(2)} 3? ${c2.get(3)}")  // 1 → null
}
