package by.pavel.payments;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Один эндпоинт, который отвечает на главный вопрос эксплуатации:
 * «какая версия сейчас крутится и в каком окружении».
 *
 * <p>Значения приходят снаружи — из переменных окружения, а не из образа.
 * Это и есть механическое воплощение правила «конфигурация отдельно от артефакта»
 * (theory/ENVIRONMENTS_AND_PROMOTION.md): один и тот же образ отвечает
 * {@code env=dev} и {@code env=staging} в зависимости от того, чем его запустили.
 */
@RestController
public class PaymentsController {

    private final String environment;
    private final String buildDigest;

    public PaymentsController(
            @Value("${payments.environment:local}") String environment,
            @Value("${payments.build-digest:unknown}") String buildDigest) {
        this.environment = environment;
        this.buildDigest = buildDigest;
    }

    @GetMapping("/version")
    public Map<String, String> version() {
        return Map.of("environment", environment, "digest", buildDigest);
    }
}
