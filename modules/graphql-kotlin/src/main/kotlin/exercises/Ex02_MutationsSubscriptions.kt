package exercises

import com.expediagroup.graphql.server.operations.Mutation
import com.expediagroup.graphql.server.operations.Query
import com.expediagroup.graphql.server.operations.Subscription
import kotlinx.coroutines.flow.Flow

/**
 * УПРАЖНЕНИЕ 2: Mutation + Subscription через Flow.
 *
 * Контекст: имитируем простой чат — отправка сообщений (mutation) и стрим новых
 *           сообщений всем подписчикам (subscription).
 *
 * Задание 1: Доменные типы:
 *            - `data class Message(id: Long, room: String, author: String, text: String, sentAt: Instant)`.
 *            - `class CreateMessageInput(room: String, author: String, text: String)` — input-тип.
 *
 * Задание 2: `MessageStore` — потокобезопасный in-memory store с двумя API:
 *            - `add(input): Message` — присвоить id, время, эмитнуть в горячий поток.
 *            - `stream(room: String): Flow<Message>` — горячий поток сообщений данной комнаты.
 *            Подсказка: подходит `MutableSharedFlow` (replay по вкусу: 0 для realtime,
 *            небольшой для late subscribers — реши обоснованно).
 *
 * Задание 3: `ChatQueries : Query` — функция `messages(room: String, limit: Int = 50): List<Message>`.
 *
 * Задание 4: `ChatMutations : Mutation` — функция `sendMessage(input: CreateMessageInput): Message`,
 *            делегирует в `MessageStore.add`.
 *
 * Задание 5: `ChatSubscriptions : Subscription` — функция `messageAdded(room: String): Flow<Message>`,
 *            возвращает фильтрованный поток (только сообщения нужной комнаты).
 *
 * Задание 6: В `main` без поднятия Spring:
 *            - вручную создай `MessageStore`, `ChatMutations`, `ChatSubscriptions`,
 *            - подпишись на `messageAdded("general")` через `launchIn`,
 *            - вызови `sendMessage` 3 раза в `general` и 1 раз в `random`,
 *            - убедись, что поток выдал ровно 3 сообщения.
 *
 * Подумай:
 *  - Почему `Subscription`-функция должна возвращать Flow, а не быть `suspend`?
 *  - Что произойдёт, если буфер `MutableSharedFlow` переполнится? (см. `BufferOverflow`).
 *  - Чем `replay = 1` отличается от `replay = 0` для late subscribers?
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex02_MutationsSubscriptionsKt"
 */

// TODO Задание 1: data class Message и class CreateMessageInput

// TODO Задание 2: class MessageStore с потокобезопасным состоянием и Flow-выдачей

// TODO Задание 3: class ChatQueries : Query

// TODO Задание 4: class ChatMutations : Mutation

// TODO Задание 5: class ChatSubscriptions : Subscription

fun main() {
    // TODO Задание 6: эмитировать запросы и проверить поток через runBlocking
    TODO("Реализуй сценарий и распечатай полученные сообщения")
}
