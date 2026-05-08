package exercises

import com.expediagroup.graphql.generator.SchemaGeneratorConfig
import com.expediagroup.graphql.generator.TopLevelObject
import com.expediagroup.graphql.generator.toSchema
import com.expediagroup.graphql.server.operations.Query
import graphql.schema.idl.SchemaPrinter

/**
 * УПРАЖНЕНИЕ 1: Schema basics — генерация схемы из Kotlin-типов.
 *
 * Задание 1: Описать домен — две data class’а `Author` и `Book`.
 *            `Author { id, name, country }`, `Book { id, title, year, authorId }`.
 *            Поля nullable/non-null расставь сам, учитывая что non-null Kotlin = `T!` в SDL.
 *
 * Задание 2: Реализовать класс `LibraryQueries : Query` с публичными функциями:
 *            - `book(id: Long): Book?` — найти книгу по id.
 *            - `books(limit: Int = 10, offset: Int = 0): List<Book>` — выборку с дефолтами.
 *            - `author(id: Long): Author?` — найти автора по id.
 *            Внутри — данные из in-memory списков (без БД).
 *            Аннотируй важные поля `@GraphQLDescription("...")`.
 *
 * Задание 3: В `main` сгенерируй схему через `toSchema(config, queries)` где:
 *            - `config = SchemaGeneratorConfig(supportedPackages = listOf("exercises"))`
 *            - `queries = listOf(TopLevelObject(LibraryQueries(...)))`
 *            Распечатай SDL через `SchemaPrinter().print(schema)`.
 *
 * Задание 4: Проверь, что в выводе:
 *            - есть тип `Query` с тремя полями;
 *            - типы `Book` и `Author` имеют корректную nullability (`!` для не-nullable);
 *            - дефолты аргументов отрендерены (`limit: Int = 10`).
 *
 * Подумай: какие поля стоит сделать non-null? `Author.country` может быть неизвестен — а `id`?
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex01_SchemaBasicsKt"
 */

// TODO Задание 1: data class Author(...)
// TODO Задание 1: data class Book(...)

// TODO Задание 2: класс LibraryQueries : Query с тремя функциями

fun main() {
    // TODO Задание 3: создать SchemaGeneratorConfig
    // TODO Задание 3: собрать список queries (TopLevelObject)
    // TODO Задание 3: сгенерировать схему через toSchema(...)
    // TODO Задание 3: распечатать SDL
    TODO("Сгенерируй и распечатай SDL")
}
