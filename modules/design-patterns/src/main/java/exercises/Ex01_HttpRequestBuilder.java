package exercises;

import java.util.Map;

/**
 * Ex01 — Builder (порождающий паттерн). Уровень: разминка.
 *
 * <h2>Задача</h2>
 * Реализуй иммутабельный класс {@link HttpRequest}, который можно создать ТОЛЬКО через
 * текучий (fluent) {@link Builder}. У {@code HttpRequest} не должно быть сеттеров и
 * публичных конструкторов.
 *
 * <h2>Требования</h2>
 * <ol>
 *   <li>Обязательные поля — {@code method} и {@code url}. Если при {@code build()} любое из
 *       них не задано — бросить {@link IllegalStateException}.</li>
 *   <li>{@code url} не может быть пустым или состоять из одних пробелов —
 *       {@link IllegalArgumentException}.</li>
 *   <li>Заголовки накапливаются повторными вызовами {@code header(name, value)}.
 *       {@code headers()} возвращает НЕмодифицируемую карту (попытка {@code put} →
 *       {@link UnsupportedOperationException}).</li>
 *   <li>{@code body} опционально и допустимо ТОЛЬКО для {@code POST}/{@code PUT}/{@code PATCH}.
 *       Тело у {@code GET}/{@code DELETE} при {@code build()} → {@link IllegalStateException}.</li>
 *   <li>{@code timeoutMillis} по умолчанию {@code 30000}. Значение {@code <= 0} недопустимо →
 *       {@link IllegalArgumentException}.</li>
 *   <li>{@code HttpRequest} обязан быть иммутабельным (в том числе защитная копия заголовков).</li>
 * </ol>
 *
 * Замени все {@code TODO}. Проверка: {@code src/test/java/exercises/Ex01_HttpRequestBuilderTest.java}.
 * Подсказок по реализации здесь намеренно нет.
 */
public final class Ex01_HttpRequestBuilder {

    private Ex01_HttpRequestBuilder() {
    }

    public enum Method {
        GET, POST, PUT, PATCH, DELETE
    }

    /** Иммутабельный HTTP-запрос. Создаётся только через {@link #builder()}. */
    public static final class HttpRequest {

        private HttpRequest(Builder builder) {
            throw new UnsupportedOperationException("TODO: собрать иммутабельный запрос из Builder");
        }

        public static Builder builder() {
            throw new UnsupportedOperationException("TODO");
        }

        public Method method() {
            throw new UnsupportedOperationException("TODO");
        }

        public String url() {
            throw new UnsupportedOperationException("TODO");
        }

        /** Немодифицируемая карта заголовков. */
        public Map<String, String> headers() {
            throw new UnsupportedOperationException("TODO");
        }

        /** Тело запроса или {@code null}, если не задано. */
        public String body() {
            throw new UnsupportedOperationException("TODO");
        }

        public int timeoutMillis() {
            throw new UnsupportedOperationException("TODO");
        }
    }

    public static final class Builder {

        public Builder method(Method method) {
            throw new UnsupportedOperationException("TODO");
        }

        public Builder url(String url) {
            throw new UnsupportedOperationException("TODO");
        }

        public Builder header(String name, String value) {
            throw new UnsupportedOperationException("TODO");
        }

        public Builder body(String body) {
            throw new UnsupportedOperationException("TODO");
        }

        public Builder timeoutMillis(int millis) {
            throw new UnsupportedOperationException("TODO");
        }

        public HttpRequest build() {
            throw new UnsupportedOperationException("TODO: валидация обязательных полей + сборка");
        }
    }
}
