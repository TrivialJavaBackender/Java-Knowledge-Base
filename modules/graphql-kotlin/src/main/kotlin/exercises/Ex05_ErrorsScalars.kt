package exercises

import com.expediagroup.graphql.generator.SchemaGeneratorConfig
import com.expediagroup.graphql.generator.TopLevelObject
import com.expediagroup.graphql.generator.hooks.SchemaGeneratorHooks
import com.expediagroup.graphql.generator.toSchema
import com.expediagroup.graphql.server.operations.Query
import graphql.GraphQLError
import graphql.execution.DataFetcherExceptionHandler
import graphql.schema.GraphQLScalarType
import graphql.schema.GraphQLType
import java.time.OffsetDateTime
import kotlin.reflect.KType

/**
 * УПРАЖНЕНИЕ 5: Custom scalar (DateTime) + Error model.
 *
 * Часть A: DateTime-scalar.
 *
 * Задание 1: Реализовать `dateTimeScalar: GraphQLScalarType`:
 *            - имя `DateTime`;
 *            - serialize: `OffsetDateTime` → ISO-8601 String;
 *            - parseValue / parseLiteral: ISO-8601 String → `OffsetDateTime`,
 *              кидать `CoercingParseValueException` / `CoercingParseLiteralException`
 *              на невалидный вход.
 *
 * Задание 2: Реализовать `class CustomHooks : SchemaGeneratorHooks` с переопределённым
 *            `willGenerateGraphQLType`, чтобы тип `OffsetDateTime` маппился на `dateTimeScalar`.
 *
 * Часть B: Errors.
 *
 * Задание 3: `data class Order(id: Long, total: Double, createdAt: OffsetDateTime)`.
 *            `class OrderQueries : Query`:
 *              - `order(id: Long): Order?` — для id ≤ 0 кидает
 *                `IllegalArgumentException("id must be positive")`;
 *              - `orders(): List<Order>` — простая выборка.
 *
 * Задание 4: Реализовать `class OrderExceptionHandler : DataFetcherExceptionHandler` —
 *            переводит `IllegalArgumentException` в `GraphQLError` с extensions
 *            `{"code": "BAD_REQUEST", "field": "id"}`. Любые другие — в `INTERNAL_ERROR`.
 *            (Документацию по `DataFetcherExceptionHandlerParameters` смотри в graphql-java.)
 *
 * Задание 5: В `main`:
 *            - сгенерировать схему с `CustomHooks` (`SchemaGeneratorConfig(..., hooks = CustomHooks())`);
 *            - напечатать SDL — убедиться, что в типе `Order` поле `createdAt` имеет тип `DateTime!`,
 *              а не `String!` или сгенерированную обёртку;
 *            - симулировать `order(id = -1)` локально и проверить, что
 *              `OrderExceptionHandler` оборачивает исключение в желаемый формат.
 *
 * Подумай:
 *  - Когда поле возвращает `null`, а схема non-null, какой будет `path` в `errors`?
 *  - Почему `InternalError` нельзя выдавать клиенту as-is (security perspective)?
 *  - Нужен ли отдельный scalar для `UUID`, или хватает `String`?
 *
 * Запуск: mvn exec:java -Dexec.mainClass="exercises.Ex05_ErrorsScalarsKt"
 */

// TODO Задание 1: val dateTimeScalar: GraphQLScalarType

// TODO Задание 2: class CustomHooks : SchemaGeneratorHooks

// TODO Задание 3: Order + OrderQueries

// TODO Задание 4: OrderExceptionHandler

fun main() {
    // TODO Задание 5: schema gen + SDL + симуляция исключения
    TODO("Сгенерируй схему с DateTime scalar и проверь маппинг исключений")
}
