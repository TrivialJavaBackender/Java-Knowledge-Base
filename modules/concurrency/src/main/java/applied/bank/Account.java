package applied.bank;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Банковский счёт.
 *
 * Поле version используется для оптимистичной блокировки:
 * при обновлении баланса проверяется, что version не изменился
 * с момента чтения. Если изменился — другая транзакция успела
 * обновить счёт → нужно повторить операцию.
 *
 * В реальной БД: UPDATE accounts SET balance=?, version=version+1
 *                WHERE id=? AND version=?
 * Если affected rows = 0 → optimistic lock conflict.
 */
public class Account {

    private final UUID id;
    private final String owner;
    private BigDecimal balance;
    private int version;

    public Account(String owner, BigDecimal initialBalance) {
        this.id = UUID.randomUUID();
        this.owner = owner;
        this.balance = initialBalance;
        this.version = 0;
    }

    public UUID getId() { return id; }
    public String getOwner() { return owner; }
    public BigDecimal getBalance() { return balance; }
    public int getVersion() { return version; }

    /** Вызывается репозиторием при успешном сохранении. */
    public void setBalance(BigDecimal balance) { this.balance = balance; }
    public void incrementVersion() { this.version++; }

    @Override
    public String toString() {
        return "Account{id=" + id + ", owner=" + owner + ", balance=" + balance + ", v=" + version + "}";
    }
}
