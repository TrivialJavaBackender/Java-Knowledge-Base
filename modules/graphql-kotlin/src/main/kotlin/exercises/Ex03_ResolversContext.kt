package exercises

import com.expediagroup.graphql.generator.annotations.GraphQLDescription
import com.expediagroup.graphql.server.operations.Query
import graphql.schema.DataFetchingEnvironment

/**
 * УПРАЖНЕНИЕ 3: Резолверы + GraphQLContext.
 *
 * Контекст: сервис заметок (`Note`). Часть полей публичные, часть видны только
 *           автору. Authorization-данные приходят в `GraphQLContext`.
 *
 * Задание 1: Доменные типы:
 *            - `data class UserPrincipal(userId: Long, role: String)`.
 *            - `data class Note(id: Long, ownerId: Long, title: String, body: String, private: Boolean)`.
 *
 * Задание 2: `NoteQueries : Query`:
 *            - `note(id: Long, env: DataFetchingEnvironment): Note?` — достаёт
 *              из in-memory store; если `note.private == true` и текущий принципал
 *              не владелец — должен вернуть `null` (а **не** утечку).
 *            - `myNotes(env: DataFetchingEnvironment): List<Note>` — заметки
 *              текущего пользователя (если контекст пустой — пустой список).
 *
 *            Принципал достаётся через `env.graphQlContext.get<UserPrincipal>("user")`.
 *
 * Задание 3: `NoteResolvers` (классические per-type резолверы) — для типа `Note`:
 *            - `body(note: Note, env: DataFetchingEnvironment): String?` —
 *              если заметка приватная и принципал не владелец, вернуть `null`,
 *              **но** оставить остальные поля. Это поведение должно работать,
 *              даже если клиент запросил `note(id) { body }`. Проверь, как это
 *              соотносится с правилом из задания 2.
 *
 *            Подсказка: per-type-резолверы в graphql-kotlin регистрируются через
 *            функции, принимающие `parent` первым параметром. Подумай, нужно ли
 *            здесь, или можно решить только в `NoteQueries`.
 *
 * Задание 4: `suspend fun summary(note: Note): String` — суспенд-резолвер, имитирует
 *            долгий вызов внешнего сервиса (`delay(50)`), возвращает первые 30 символов
 *            `body`. Убедись, что graphql-kotlin корректно обрабатывает `suspend`-возврат.
 *
 * Задание 5: В `main` (без Spring):
 *            - сгенерируй схему `toSchema(...)` с `NoteQueries`,
 *            - распечатай SDL и убедись, что `summary` не возвращается как
 *              `Promise`/`CompletableFuture`, а просто как `String!`.
 *
 * Подумай:
 *  - Где правильнее жить authz-логика — в Query-функции или в per-type резолвере?
 *  - Чем `env.graphQlContext` отличается от `env.localContext`?
 *  - Что вернётся, если `note.body` non-null в Kotlin, а резолвер вернёт `null`?
 *    (Подсказка: error propagation — см. BASICS.md §5.)
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex03_ResolversContextKt"
 */

// TODO Задание 1: типы UserPrincipal, Note

// TODO Задание 2: class NoteQueries : Query (с двумя функциями + in-memory store)

// TODO Задание 3: per-type резолвер для Note.body, если решишь его делать

// TODO Задание 4: suspend fun summary(note: Note): String

@GraphQLDescription("Notes service")
class NoteQueriesPlaceholder : Query   // удали этот placeholder, когда реализуешь Задание 2

fun main() {
    // TODO Задание 5: schema generator + SDL print
    TODO("Собери схему и распечатай SDL; запусти простую проверку authz")
}
