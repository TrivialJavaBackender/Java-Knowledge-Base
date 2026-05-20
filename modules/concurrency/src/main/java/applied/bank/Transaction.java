package applied.bank;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Запись о переводе средств между счетами.
 *
 * idempotencyKey — уникальный ключ, предоставляемый клиентом.
 * Если клиент повторно отправляет запрос с тем же ключом
 * (например, после network timeout), сервис должен вернуть
 * результат первого запроса, не выполняя перевод повторно.
 *
 * В реальной БД: UNIQUE constraint на idempotencyKey.
 * При дублирующем INSERT — поймать ConstraintViolationException
 * и вернуть существующую транзакцию.
 */
public class Transaction {

    private final UUID id;
    private final UUID idempotencyKey;
    private final UUID fromAccountId;
    private final UUID toAccountId;
    private final BigDecimal amount;
    private TransactionStatus status;
    private final Instant createdAt;
    private String failureReason;

    public Transaction(UUID idempotencyKey, UUID fromAccountId, UUID toAccountId, BigDecimal amount) {
        this.id = UUID.randomUUID();
        this.idempotencyKey = idempotencyKey;
        this.fromAccountId = fromAccountId;
        this.toAccountId = toAccountId;
        this.amount = amount;
        this.status = TransactionStatus.PENDING;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getIdempotencyKey() { return idempotencyKey; }
    public UUID getFromAccountId() { return fromAccountId; }
    public UUID getToAccountId() { return toAccountId; }
    public BigDecimal getAmount() { return amount; }
    public TransactionStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public String getFailureReason() { return failureReason; }

    public void complete() { this.status = TransactionStatus.COMPLETED; }
    public void fail(String reason) {
        this.status = TransactionStatus.FAILED;
        this.failureReason = reason;
    }
}
