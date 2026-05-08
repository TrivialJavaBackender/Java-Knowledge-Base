package exercises

import com.expediagroup.graphql.generator.federation.FederatedSchemaGeneratorConfig
import com.expediagroup.graphql.generator.federation.FederatedSchemaGeneratorHooks
import com.expediagroup.graphql.generator.federation.directives.ExtendsDirective
import com.expediagroup.graphql.generator.federation.directives.ExternalDirective
import com.expediagroup.graphql.generator.federation.directives.FieldSet
import com.expediagroup.graphql.generator.federation.directives.KeyDirective
import com.expediagroup.graphql.generator.federation.execution.FederatedTypeResolver
import com.expediagroup.graphql.generator.federation.toFederatedSchema
import com.expediagroup.graphql.server.operations.Query
import graphql.schema.DataFetchingEnvironment

/**
 * УПРАЖНЕНИЕ 6: Federation subgraph — расширение `User` из другого сервиса.
 *
 * Контекст: представь, что есть `users-service` (владелец `User { id name }`)
 *           и **наш** `reviews-service` — он расширяет `User` полем `reviews`.
 *           Здесь реализуем subgraph для reviews.
 *
 * Задание 1: Реализовать тип `Review`:
 *            ```
 *            @KeyDirective(fields = FieldSet("id"))
 *            data class Review(val id: String, val rating: Int, val text: String, val authorId: String)
 *            ```
 *            (id — String, потому что federation ключи обычно ID/String.)
 *
 * Задание 2: Расширить `User`. В Federation v1 нужна была `@ExtendsDirective`,
 *            в v2 она опциональна (но можно оставить — компилятор просто варнингом ругнётся):
 *            ```
 *            @KeyDirective(fields = FieldSet("id"))
 *            data class User(@ExternalDirective val id: String) {
 *                fun reviews(): List<Review> = ReviewStore.byAuthor(id)
 *            }
 *            ```
 *            `ReviewStore` — простой in-memory объект-singleton с `byAuthor(userId): List<Review>`.
 *
 * Задание 3: Реализовать entity-резолвер `class UserEntityResolver : FederatedTypeResolver<User>`:
 *            - `typeName = "User"`;
 *            - `resolve(env, representations: List<Map<String, Any>>): List<User?>`:
 *              из каждой representation возьми `id` и сконструируй `User(id)`.
 *              Сохраняй порядок — router ожидает список той же длины.
 *
 * Задание 4: `class ReviewQueries : Query` с функцией `reviews(): List<Review>`.
 *
 * Задание 5: В `main`:
 *            - построить `FederatedSchemaGeneratorConfig` с `FederatedSchemaGeneratorHooks(listOf(UserEntityResolver()))`;
 *            - сгенерировать схему через `toFederatedSchema(config, queries = listOf(TopLevelObject(ReviewQueries())))`;
 *            - распечатать SDL и убедиться, что в нём есть:
 *              * `directive @key on OBJECT | INTERFACE`,
 *              * `extend type User @key(fields: "id") { ... reviews: [Review!]! }`,
 *              * автогенерированный union `_Entity` со значениями `Review` и `User`.
 *
 * Подумай:
 *  - Что произойдёт, если убрать `@external` с поля `id` в расширении `User`?
 *  - Зачем router отправляет `_entities(representations: ...)` вместо обычного query?
 *  - Чем `@requires` отличается от `@external` в семантике query plan’а?
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex06_FederationSubgraphKt"
 */

// TODO Задание 1: data class Review с @KeyDirective

// TODO Задание 2: data class User с @KeyDirective + @ExtendsDirective и in-memory ReviewStore

// TODO Задание 3: class UserEntityResolver : FederatedTypeResolver<User>

// TODO Задание 4: class ReviewQueries : Query

fun main() {
    // TODO Задание 5: построить federated config, сгенерировать и распечатать SDL
    TODO("Сгенерируй federated schema и проверь её на наличие @key/@extends/_Entity")
}
