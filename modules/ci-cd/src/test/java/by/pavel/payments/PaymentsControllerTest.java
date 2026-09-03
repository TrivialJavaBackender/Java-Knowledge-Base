package by.pavel.payments;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Быстрый модульный тест — этап, который обязан падать за секунды.
 * Медленные интеграционные тесты живут в *IT и запускаются failsafe отдельным этапом.
 */
class PaymentsControllerTest {

    @Test
    void versionReportsInjectedEnvironment() {
        var controller = new PaymentsController("qa", "sha256:abc");
        assertEquals("qa", controller.version().get("environment"));
        assertEquals("sha256:abc", controller.version().get("digest"));
    }
}
