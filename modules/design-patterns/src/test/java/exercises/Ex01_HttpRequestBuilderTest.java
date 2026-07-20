package exercises;

import exercises.Ex01_HttpRequestBuilder.HttpRequest;
import exercises.Ex01_HttpRequestBuilder.Method;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Ex01_HttpRequestBuilderTest {

    @Test
    void buildsValidGetRequestWithDefaults() {
        HttpRequest req = HttpRequest.builder()
                .method(Method.GET)
                .url("https://example.com")
                .build();

        assertEquals(Method.GET, req.method());
        assertEquals("https://example.com", req.url());
        assertTrue(req.headers().isEmpty());
        assertNull(req.body());
        assertEquals(30_000, req.timeoutMillis());
    }

    @Test
    void buildsPostWithBodyAndHeaders() {
        HttpRequest req = HttpRequest.builder()
                .method(Method.POST)
                .url("https://example.com/api")
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .body("{\"a\":1}")
                .timeoutMillis(5_000)
                .build();

        assertEquals("{\"a\":1}", req.body());
        assertEquals(2, req.headers().size());
        assertEquals("application/json", req.headers().get("Content-Type"));
        assertEquals(5_000, req.timeoutMillis());
    }

    @Test
    void headersAreUnmodifiable() {
        HttpRequest req = HttpRequest.builder()
                .method(Method.GET)
                .url("https://example.com")
                .header("X-Trace", "1")
                .build();

        assertThrows(UnsupportedOperationException.class,
                () -> req.headers().put("X-Evil", "1"));
    }

    @Test
    void missingUrlIsRejected() {
        assertThrows(IllegalStateException.class,
                () -> HttpRequest.builder().method(Method.GET).build());
    }

    @Test
    void missingMethodIsRejected() {
        assertThrows(IllegalStateException.class,
                () -> HttpRequest.builder().url("https://example.com").build());
    }

    @Test
    void blankUrlIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> HttpRequest.builder().method(Method.GET).url("   ").build());
    }

    @Test
    void bodyOnGetIsRejected() {
        assertThrows(IllegalStateException.class,
                () -> HttpRequest.builder()
                        .method(Method.GET)
                        .url("https://example.com")
                        .body("nope")
                        .build());
    }

    @Test
    void nonPositiveTimeoutIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> HttpRequest.builder()
                        .method(Method.GET)
                        .url("https://example.com")
                        .timeoutMillis(0)
                        .build());
    }
}
