package applied.bank;

import java.math.BigDecimal;
import java.util.UUID;

public class InsufficientFundsException extends RuntimeException {

    public InsufficientFundsException(UUID accountId, BigDecimal required, BigDecimal available) {
        super("Insufficient funds on account " + accountId +
              ": required " + required + ", available " + available);
    }
}
