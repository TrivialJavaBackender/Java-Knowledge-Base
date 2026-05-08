package exercises

/**
 * Ex10 — Consistent hashing для шардирования кэша.
 *
 * Реализуй `ConsistentHashRing<N>(virtualNodesPerNode: Int)`.
 *
 * Контракт:
 * - `addNode(node: N)` — добавить узел на хеш-кольцо. Каждый физический узел представлен
 *   `virtualNodesPerNode` точками с разными суффиксами для равномерности.
 * - `removeNode(node: N)` — убрать узел и все его vnode'ы.
 * - `nodeFor(key: String): N?` — вернуть узел, отвечающий за ключ. Логика: hash(key) →
 *   первая vnode по часовой стрелке (или wrap к началу).
 * - `nodes(): Set<N>`.
 *
 * Требования:
 * - `nodeFor` должен быть O(log N×V) — используй `TreeMap<Int, N>` или эквивалент.
 *   (Это единственная операция, которой допустим log; рост ринга не на hot-path.)
 * - Хеш — стабильный (например, MurmurHash или 32-битный из Guava). Можно использовать
 *   `String.hashCode()`, но он смещён — используй что получше: например,
 *   `MessageDigest.getInstance("MD5")` и взять первые 4 байта как Int.
 *
 * Эксперимент в main:
 * 1. Создать ring с 4 узлами ("A", "B", "C", "D"), virtualNodes=200.
 * 2. Сгенерировать 100_000 ключей. Подсчитать распределение по узлам.
 *    Ожидание: ±10% от равномерности (25%/узел при 4 узлах).
 * 3. Добавить узел "E". Подсчитать, сколько ключей **сменили** owner'а.
 *    Ожидание: ~1/5 = 20% (а не 80%, как было бы при naive `% N`).
 * 4. Убрать узел "B". Снова подсчитать, сколько ключей сменили owner'а.
 *    Ожидание: ключи, принадлежавшие B, перераспределяются по остальным; чужие — не трогаются.
 *
 * Сравни с naive `hash(k) % N`:
 * - реализуй простую baseline-функцию `naiveAssign(key, nodes)`.
 * - покажи, что добавление узла переместит ~80% ключей при 4→5.
 *
 * **Печатай реальные числа.** Без чисел упражнение засчитано не будет.
 */

import java.security.MessageDigest
import java.util.TreeMap

class ConsistentHashRing<N>(private val virtualNodesPerNode: Int = 200) {
    // TODO: TreeMap<Int, N>

    fun addNode(node: N) { TODO() }
    fun removeNode(node: N) { TODO() }
    fun nodeFor(key: String): N? { TODO() }
    fun nodes(): Set<N> { TODO() }

    private fun hash(s: String): Int { TODO() }
}

fun naiveAssign(key: String, nodes: List<String>): String =
    nodes[(key.hashCode() and 0x7fffffff) % nodes.size]

fun main() {
    val ring = ConsistentHashRing<String>(virtualNodesPerNode = 200)
    listOf("A", "B", "C", "D").forEach { ring.addNode(it) }

    val keys = (0 until 100_000).map { "k-$it" }
    fun distribution(): Map<String, Int> =
        keys.groupingBy { ring.nodeFor(it)!! }.eachCount()

    println("4 nodes: ${distribution()}")

    val before = keys.associateWith { ring.nodeFor(it)!! }
    ring.addNode("E")
    val after = keys.associateWith { ring.nodeFor(it)!! }
    val moved = keys.count { before[it] != after[it] }
    println("after addNode E: ${distribution()}, moved=$moved (${moved * 100 / keys.size}%)")

    // naive baseline
    val naiveBefore = keys.associateWith { naiveAssign(it, listOf("A", "B", "C", "D")) }
    val naiveAfter = keys.associateWith { naiveAssign(it, listOf("A", "B", "C", "D", "E")) }
    val naiveMoved = keys.count { naiveBefore[it] != naiveAfter[it] }
    println("naive % N moved: $naiveMoved (${naiveMoved * 100 / keys.size}%)")

    ring.removeNode("B")
    val afterRemove = keys.associateWith { ring.nodeFor(it)!! }
    val movedRemove = keys.count { after[it] != afterRemove[it] }
    println("after removeNode B: ${distribution()}, moved=$movedRemove")
}
