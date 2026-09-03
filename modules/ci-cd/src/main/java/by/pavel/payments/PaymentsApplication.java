package by.pavel.payments;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Сквозной пример модуля ci-cd.
 *
 * <p>Сервис специально минимален: он существует не ради своей логики, а ради того,
 * чтобы у конвейера было что собирать, тестировать, упаковывать в образ и катить
 * на dev, qa и staging. Всё, что модуль объясняет, происходит вокруг этого класса,
 * а не внутри него.
 */
@SpringBootApplication
public class PaymentsApplication {

    public static void main(String[] args) {
        SpringApplication.run(PaymentsApplication.class, args);
    }
}
