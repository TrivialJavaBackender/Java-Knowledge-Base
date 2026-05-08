package exercises

import com.expediagroup.graphql.dataloader.KotlinDataLoader
import graphql.GraphQLContext
import graphql.schema.DataFetchingEnvironment
import org.dataloader.DataLoader
import org.dataloader.DataLoaderFactory
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicInteger

/**
 * УПРАЖНЕНИЕ 4: DataLoader — лечим N+1 для author → posts → user.
 *
 * Контекст: блог. `Post.author` ходит в `UserRepository`. Без батчинга
 *           запрос `posts { author { name } }` делает N походов в репозиторий.
 *
 * Задание 1: Реализовать `class FakeUserRepository`:
 *            - in-memory `Map<Long, User>` с парой десятков значений;
 *            - `findAllById(ids: Collection<Long>): List<User>` — единственный API,
 *              **инкрементирует счётчик `callCount` на каждый вызов**.
 *              Не предоставляй `findById(id)` — заставь резолверы использовать batch API.
 *
 * Задание 2: Реализовать `class UserDataLoader(repo: FakeUserRepository) : KotlinDataLoader<Long, User?>`:
 *            - `dataLoaderName = "UserDataLoader"`;
 *            - `getDataLoader` создаёт `DataLoader<Long, User?>` через
 *              `DataLoaderFactory.newDataLoader { keys -> CompletableFuture.supplyAsync { ... } }`;
 *            - **порядок результата = порядок ключей** (важный инвариант DataLoader).
 *
 * Задание 3: `data class Post(id: Long, title: String, authorId: Long)` плюс
 *            фунция `fun author(post: Post, env: DataFetchingEnvironment): CompletableFuture<User?>`,
 *            использующая `env.getDataLoader<Long, User?>("UserDataLoader")?.load(post.authorId)`.
 *
 * Задание 4: В `main`:
 *            - создай `repo` с 5 пользователями;
 *            - создай 100 постов, каждый ссылается на одного из 5 авторов;
 *            - получи `DataLoader` через `userDataLoader.getDataLoader(GraphQLContext.newContext().build())`;
 *            - вызови `loader.load(post.authorId)` для каждого поста (получишь 100 CF);
 *            - вызови `loader.dispatch()`;
 *            - дождись `CompletableFuture.allOf(...)`;
 *            - проверь:
 *              * `repo.callCount.get() == 1` — был один батч;
 *              * `loader.load(...)` для тех же id возвращает один и тот же CF
 *                (promise cache; используй `assertSame`).
 *
 * Задание 5: Расширение — попробуй ограничить `setMaxBatchSize(2)` через
 *            `DataLoaderOptions`. Сколько батч-вызовов теперь? Объясни цифру.
 *
 * Подумай:
 *  - Что произойдёт, если batch function вернёт список не-той длины, что keys?
 *  - Чем «promise cache» отличается от «value cache»?
 *  - Почему DataLoader **обязательно** per-request scope?
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex04_DataLoaderBatchingKt"
 */

data class User(val id: Long, val name: String)

// TODO Задание 1: class FakeUserRepository с counter и findAllById

// TODO Задание 2: class UserDataLoader : KotlinDataLoader<Long, User?>

// TODO Задание 3: data class Post + author(...) функция

fun main() {
    // TODO Задание 4: сценарий c 100 постами и проверкой callCount == 1
    // TODO Задание 5: эксперимент с maxBatchSize
    TODO("Воспроизведи N+1, исправь его DataLoader’ом, замерь количество батч-вызовов")
}
