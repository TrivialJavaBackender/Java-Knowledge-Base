package applied.bank;

import java.util.UUID;

public class OptimisticLockException extends RuntimeException {

    public OptimisticLockException(UUID accountId, int expectedVersion) {
        super("Optimistic lock conflict on account " + accountId +
              ": expected version " + expectedVersion + " but was already updated");
    }
}
