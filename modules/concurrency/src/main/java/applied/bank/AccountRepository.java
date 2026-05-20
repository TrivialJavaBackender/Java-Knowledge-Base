package applied.bank;

import java.util.Optional;
import java.util.UUID;

/**
 * In-memory хранилище счетов.
 *
 * В реальной БД методы update() включали бы проверку оптимистичной блокировки:
 *   UPDATE accounts SET balance=?, version=version+1
 *   WHERE id=? AND version=?
 * Если affected rows = 0 → бросать OptimisticLockException.
 */
public class AccountRepository {

    public Optional<Account> findById(UUID id) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    public Account save(Account account) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    /**
     * Обновить счёт с проверкой версии (optimistic locking).
     * @throws OptimisticLockException если version не совпала (конкурентное обновление)
     */
    public Account updateWithVersionCheck(Account account) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }
}
