package applied.ratelimiter;

/**
 * ЗАДАЧА: Rate Limiter (Token Bucket)
 * Время: 35-40 минут
 * Тема: Concurrency, Algorithms
 *
 * ТЗ:
 * Реализуй Rate Limiter на основе алгоритма Token Bucket.
 *
 * Требования:
 * - Каждый клиент (clientId) имеет свой независимый bucket
 * - Bucket имеет максимальную ёмкость (capacity) токенов
 * - Токены пополняются с фиксированной скоростью (refillRate токенов в секунду)
 * - tryAcquire() потребляет 1 токен и возвращает true, если токен доступен
 * - Если токенов нет — возвращает false (не блокирует поток)
 * - Реализация должна быть thread-safe: несколько потоков могут вызывать
 *   tryAcquire() для одного и того же clientId одновременно
 *
 * Вопросы для обсуждения после реализации:
 * - Как работает алгоритм Sliding Window и чем отличается от Token Bucket?
 * - Как реализовать distributed rate limiter (Redis + SETNX / Lua-скрипт)?
 * - Как избежать thundering herd при одновременном рефилле?
 * - Какие concurrent-классы ты использовал и почему?
 */
public interface RateLimiter {

    /**
     * Попытка получить 1 токен для указанного клиента.
     *
     * @param clientId идентификатор клиента (например, userId или IP)
     * @return true — токен выдан, запрос разрешён; false — лимит исчерпан
     */
    boolean tryAcquire(String clientId);

    /**
     * Попытка получить указанное количество токенов.
     *
     * @param clientId идентификатор клиента
     * @param tokens   количество токенов (например, для взвешенных запросов)
     * @return true — токены выданы; false — недостаточно токенов
     */
    boolean tryAcquire(String clientId, int tokens);

    /**
     * Возвращает текущее количество доступных токенов для клиента.
     * Пересчитывает токены с учётом прошедшего времени.
     */
    double getAvailableTokens(String clientId);
}
