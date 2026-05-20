package applied.bank;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * ЗАДАЧА: Bank Transfer (Банковский перевод)
 * Время: 35-40 минут
 * Тема: Concurrency, ACID, Idempotency
 *
 * ТЗ:
 * Реализуй сервис банковских переводов между счетами.
 *
 * Требования:
 * - transfer() списывает amount со счёта fromId и зачисляет на toId атомарно
 * - Если на счёте недостаточно средств — бросить InsufficientFundsException
 * - Перевод идемпотентен по idempotencyKey: повторный вызов с тем же ключом
 *   возвращает результат первого вызова без повторного списания
 * - Реализация должна быть thread-safe: несколько потоков могут переводить
 *   между теми же счетами одновременно
 * - Не допускать deadlock при конкурентных переводах между одними счетами
 *
 * Ключевая проблема — deadlock:
 *   T1: lock(A) → ждёт lock(B)
 *   T2: lock(B) → ждёт lock(A)
 *
 * Решение: всегда захватывать блокировки в одном порядке (по UUID-компаратору):
 *   UUID first  = min(fromId, toId)
 *   UUID second = max(fromId, toId)
 *   synchronized(lockFor(first))  {
 *       synchronized(lockFor(second)) { ... }
 *   }
 *
 * Вопросы для обсуждения после реализации:
 * - Чем optimistic locking отличается от pessimistic? Когда что лучше?
 * - Как реализовать idempotency в реальной БД (UNIQUE constraint + upsert)?
 * - Как перевод работает в распределённой системе (SAGA pattern)?
 * - Что такое Two-Phase Commit и почему его избегают в микросервисах?
 * - Как гарантировать атомарность в БД: SERIALIZABLE vs SELECT FOR UPDATE?
 */
public interface BankService {

    /**
     * Выполнить перевод средств.
     * Идемпотентен: повторный вызов с тем же idempotencyKey возвращает
     * существующую транзакцию без повторного списания.
     *
     * @param idempotencyKey уникальный ключ от клиента для защиты от дублей
     * @param fromId         счёт списания
     * @param toId           счёт зачисления
     * @param amount         сумма (должна быть > 0)
     * @return запись о транзакции
     * @throws InsufficientFundsException если на счёте fromId недостаточно средств
     * @throws IllegalArgumentException   если amount <= 0 или счёт не найден
     */
    Transaction transfer(UUID idempotencyKey, UUID fromId, UUID toId, BigDecimal amount);

    /**
     * Получить текущий баланс счёта.
     *
     * @throws IllegalArgumentException если счёт не найден
     */
    BigDecimal getBalance(UUID accountId);

    /**
     * Создать новый счёт с начальным балансом.
     */
    Account createAccount(String owner, BigDecimal initialBalance);
}
