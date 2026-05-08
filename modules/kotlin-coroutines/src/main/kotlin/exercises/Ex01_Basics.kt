package exercises

import kotlinx.coroutines.runBlocking
import kotlin.system.measureTimeMillis

/**
 * УПРАЖНЕНИЕ 1: Основы — параллельная декомпозиция
 *
 * Задание 1: Реализуй suspend-функции `fetchProfile`, `fetchPosts`, `fetchLikes`,
 *            каждая имитирует сетевой вызов через `delay(...)` и возвращает данные.
 *
 * Задание 2: Реализуй `loadDashboardSequential()` — последовательно вызывает все три,
 *            возвращает агрегат `Dashboard(profile, posts, likes)`.
 *
 * Задание 3: Реализуй `loadDashboardParallel()` — три вызова идут **параллельно**,
 *            возвращает тот же агрегат. Используй structured-concurrency builders.
 *
 * Задание 4: В `main` сравни время `loadDashboardSequential()` и `loadDashboardParallel()`.
 *            Параллельная версия должна быть ≈ max(t1, t2, t3), последовательная ≈ t1+t2+t3.
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex01_BasicsKt"
 */

data class Profile(val id: Long, val name: String)
data class Post(val id: Long, val text: String)
data class Like(val postId: Long, val count: Int)
data class Dashboard(val profile: Profile, val posts: List<Post>, val likes: List<Like>)

suspend fun fetchProfile(id: Long): Profile {
    TODO("Имитировать сетевой вызов (delay), вернуть Profile")
}

suspend fun fetchPosts(userId: Long): List<Post> {
    TODO("Имитировать сетевой вызов, вернуть список постов")
}

suspend fun fetchLikes(userId: Long): List<Like> {
    TODO("Имитировать сетевой вызов, вернуть список лайков")
}

suspend fun loadDashboardSequential(userId: Long): Dashboard {
    TODO("Последовательно вызвать три fetch и собрать Dashboard")
}

suspend fun loadDashboardParallel(userId: Long): Dashboard {
    TODO("Параллельно через async/await внутри coroutineScope")
}

fun main() = runBlocking {
    val seqTime = measureTimeMillis {
        val d = loadDashboardSequential(1L)
        println("Sequential: $d")
    }
    val parTime = measureTimeMillis {
        val d = loadDashboardParallel(1L)
        println("Parallel:   $d")
    }
    println("\nSequential ${seqTime} ms vs Parallel ${parTime} ms")
}
