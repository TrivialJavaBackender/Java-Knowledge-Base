package applied.ratelimiter;

/**
 * Token Bucket реализация RateLimiter.
 *
 * Алгоритм Token Bucket:
 * - Каждый клиент имеет bucket с максимальным количеством токенов (capacity)
 * - Токены пополняются непрерывно со скоростью refillRate токенов/сек
 * - Пополнение ленивое (lazy): пересчитывается в момент вызова tryAcquire()
 *   на основе прошедшего времени: newTokens = (now - lastRefillTime) * refillRate
 * - Burst-запросы разрешены до capacity токенов
 *
 * Пример: capacity=10, refillRate=2/сек
 *   - Стартуем с 10 токенами
 *   - 10 запросов подряд — все проходят (burst)
 *   - 11-й запрос — отклонён
 *   - Через 1 секунду — 2 новых токена, можно снова делать запросы
 *
 * Потокобезопасность:
 * - ConcurrentHashMap для хранения bucket'ов per-client
 * - Атомарное обновление состояния bucket'а (подумай: synchronized блок
 *   на объекте bucket'а или AtomicReference с CAS?)
 */
public class TokenBucketRateLimiter implements RateLimiter {

    private final double capacity;
    private final double refillRate; // токенов в секунду

    public TokenBucketRateLimiter(double capacity, double refillRate) {
        this.capacity = capacity;
        this.refillRate = refillRate;
    }

    @Override
    public boolean tryAcquire(String clientId) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public boolean tryAcquire(String clientId, int tokens) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public double getAvailableTokens(String clientId) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }
}
