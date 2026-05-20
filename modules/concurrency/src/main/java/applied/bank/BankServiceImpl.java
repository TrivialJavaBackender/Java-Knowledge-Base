package applied.bank;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Реализация BankService.
 *
 * Структура хранилища:
 *   ConcurrentHashMap<UUID, Account> accounts
 *   ConcurrentHashMap<UUID, Transaction> idempotencyStore  — ключ: idempotencyKey
 *   ConcurrentHashMap<UUID, Object> accountLocks           — ключ: accountId
 *
 * Алгоритм transfer():
 *   1. Проверить idempotencyStore: если ключ уже есть → вернуть существующую транзакцию
 *   2. Определить порядок блокировок: first=min(fromId,toId), second=max(fromId,toId)
 *   3. synchronized(lockFor(first)) { synchronized(lockFor(second)) {
 *       4. Повторно проверить idempotencyStore (double-checked locking)
 *       5. Проверить баланс fromAccount
 *       6. Списать с fromAccount, зачислить на toAccount
 *       7. Создать Transaction(COMPLETED), сохранить в idempotencyStore
 *       8. Вернуть транзакцию
 *   }}
 *
 * Double-checked locking на шаге 4 нужен потому, что между шагом 1 и 3
 * другой поток мог уже выполнить перевод с тем же idempotencyKey.
 */
public class BankServiceImpl implements BankService {

    private final AccountRepository accountRepository;

    public BankServiceImpl(AccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    @Override
    public Transaction transfer(UUID idempotencyKey, UUID fromId, UUID toId, BigDecimal amount) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public BigDecimal getBalance(UUID accountId) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public Account createAccount(String owner, BigDecimal initialBalance) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }
}
