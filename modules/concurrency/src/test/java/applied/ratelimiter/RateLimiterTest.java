package applied.ratelimiter;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

public class RateLimiterTest {

    private static RateLimiter newInstance(double capacity, double refillRate) {
        return new TokenBucketRateLimiter(capacity, refillRate);
    }

    @Test
    public void testSingleClientAllowedWithinLimit() {
        RateLimiter limiter = newInstance(5, 1.0);

        // Первые 5 запросов должны пройти (bucket заполнен)
        for (int i = 0; i < 5; i++) {
            assertTrue(limiter.tryAcquire("client1"), "Request " + i + " should be allowed");
        }
    }

    @Test
    public void testRequestDeniedWhenBucketEmpty() {
        RateLimiter limiter = newInstance(3, 1.0);

        limiter.tryAcquire("client1");
        limiter.tryAcquire("client1");
        limiter.tryAcquire("client1");

        // Bucket исчерпан — следующий запрос должен быть отклонён
        assertFalse(limiter.tryAcquire("client1"), "Request should be denied when bucket is empty");
    }

    @Test
    public void testBurstAllowedUpToCapacity() {
        RateLimiter limiter = newInstance(10, 1.0); // capacity=10, refill=1/sec

        // Burst: все 10 токенов доступны сразу
        int allowed = 0;
        for (int i = 0; i < 15; i++) {
            if (limiter.tryAcquire("burst-client")) allowed++;
        }
        assertEquals(10, allowed, "Should allow exactly capacity requests in burst");
    }

    @Test
    public void testTokensRefillOverTime() throws InterruptedException {
        RateLimiter limiter = newInstance(2, 10.0); // 10 токенов в секунду

        // Опустошить bucket
        limiter.tryAcquire("client1");
        limiter.tryAcquire("client1");
        assertFalse(limiter.tryAcquire("client1"), "Should be empty");

        // Подождать 300мс — должно добавиться ~3 токена, но capacity=2, значит 2
        Thread.sleep(300);

        assertTrue(limiter.tryAcquire("client1"), "Should be refilled after waiting");
    }

    @Test
    public void testDifferentClientsAreIsolated() {
        RateLimiter limiter = newInstance(2, 1.0);

        // Опустошить bucket client1
        limiter.tryAcquire("client1");
        limiter.tryAcquire("client1");

        // client2 не должен быть затронут
        assertTrue(limiter.tryAcquire("client2"), "client2 should have its own independent bucket");
        assertTrue(limiter.tryAcquire("client2"), "client2 should still have tokens");
        assertFalse(limiter.tryAcquire("client1"), "client1 should still be empty");
    }

    @Test
    public void testTryAcquireMultipleTokens() {
        RateLimiter limiter = newInstance(10, 1.0);

        assertTrue(limiter.tryAcquire("client1", 5));
        assertTrue(limiter.tryAcquire("client1", 5));
        assertFalse(limiter.tryAcquire("client1", 1), "No tokens left");
    }

    @Test
    public void testConcurrentAccessIsThreadSafe() throws InterruptedException {
        RateLimiter limiter = newInstance(100, 0); // refillRate=0 — без рефила
        int threads = 20;
        int requestsPerThread = 10;
        AtomicInteger allowed = new AtomicInteger();
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);

        for (int i = 0; i < threads; i++) {
            new Thread(() -> {
                try {
                    start.await();
                    for (int j = 0; j < requestsPerThread; j++) {
                        if (limiter.tryAcquire("shared-client")) allowed.incrementAndGet();
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown();
                }
            }).start();
        }

        start.countDown();
        done.await(5, TimeUnit.SECONDS);

        // Ровно 100 запросов должны пройти — не больше (нет гонки) и не меньше
        assertEquals(100, allowed.get(),
            "Exactly capacity requests should be allowed under concurrent load");
    }
}
