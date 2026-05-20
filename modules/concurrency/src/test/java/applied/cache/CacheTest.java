package applied.cache;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

public class CacheTest {

    private static Cache<String, String> newInstance(int capacity, Duration ttl) {
        return new LRUCache<>(capacity, ttl);
    }

    @Test
    public void testPutAndGet() {
        Cache<String, String> cache = newInstance(10, Duration.ofMinutes(5));
        cache.put("key1", "value1");

        assertEquals(Optional.of("value1"), cache.get("key1"));
    }

    @Test
    public void testGetMissingKeyReturnsEmpty() {
        Cache<String, String> cache = newInstance(10, Duration.ofMinutes(5));
        assertEquals(Optional.empty(), cache.get("nonexistent"));
    }

    @Test
    public void testLRUEvictionOnCapacityExceeded() {
        Cache<String, String> cache = newInstance(3, Duration.ofMinutes(5));

        cache.put("a", "1");
        cache.put("b", "2");
        cache.put("c", "3");
        // Стакан полный. "a" — самый старый (LRU)

        cache.put("d", "4"); // должен вытеснить "a"

        assertEquals(Optional.empty(), cache.get("a"), "LRU entry 'a' should be evicted");
        assertEquals(Optional.of("2"), cache.get("b"));
        assertEquals(Optional.of("3"), cache.get("c"));
        assertEquals(Optional.of("4"), cache.get("d"));
        assertEquals(3, cache.size());
    }

    @Test
    public void testGetUpdatesLRUOrder() {
        Cache<String, String> cache = newInstance(3, Duration.ofMinutes(5));

        cache.put("a", "1");
        cache.put("b", "2");
        cache.put("c", "3");

        cache.get("a"); // "a" становится самым свежим, LRU теперь "b"

        cache.put("d", "4"); // должен вытеснить "b", не "a"

        assertEquals(Optional.empty(), cache.get("b"), "'b' should be evicted as LRU");
        assertEquals(Optional.of("1"), cache.get("a"), "'a' should survive after get() refreshed it");
    }

    @Test
    public void testTTLExpiry() throws InterruptedException {
        Cache<String, String> cache = newInstance(10, Duration.ofMillis(200));

        cache.put("key", "value");
        assertEquals(Optional.of("value"), cache.get("key"), "Should be present before TTL");

        Thread.sleep(300); // ждём истечения TTL

        assertEquals(Optional.empty(), cache.get("key"), "Should be absent after TTL expired");
    }

    @Test
    public void testPutOverwriteResetsTTL() throws InterruptedException {
        Cache<String, String> cache = newInstance(10, Duration.ofMillis(300));

        cache.put("key", "v1");
        Thread.sleep(200); // TTL ещё не истёк

        cache.put("key", "v2"); // перезаписываем — TTL сбрасывается
        Thread.sleep(200); // если бы TTL не сбросился, элемент был бы мёртв

        assertEquals(Optional.of("v2"), cache.get("key"), "TTL should be reset on put()");
    }

    @Test
    public void testSizeCountsOnlyLiveEntries() throws InterruptedException {
        Cache<String, String> cache = newInstance(10, Duration.ofMillis(200));

        cache.put("a", "1");
        cache.put("b", "2");
        assertEquals(2, cache.size());

        Thread.sleep(300);

        // После истечения TTL size() должен не считать мёртвые записи
        // (при lazy eviction — только после обращения, или size может возвращать 0)
        cache.get("a"); // триггерит lazy eviction для "a"
        cache.get("b"); // триггерит lazy eviction для "b"
        assertEquals(0, cache.size());
    }

    @Test
    public void testRemove() {
        Cache<String, String> cache = newInstance(10, Duration.ofMinutes(5));
        cache.put("key", "value");

        assertTrue(cache.remove("key"));
        assertEquals(Optional.empty(), cache.get("key"));
        assertFalse(cache.remove("key"), "Removing already-removed key should return false");
    }

    @Test
    public void testConcurrentReadsAreThreadSafe() throws InterruptedException {
        LRUCache<String, Integer> cache = new LRUCache<>(100, Duration.ofMinutes(5));
        for (int i = 0; i < 100; i++) {
            cache.put("key" + i, i);
        }

        int threads = 10;
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);
        AtomicInteger errors = new AtomicInteger();

        for (int t = 0; t < threads; t++) {
            new Thread(() -> {
                try {
                    start.await();
                    for (int i = 0; i < 100; i++) {
                        Optional<Integer> val = cache.get("key" + i);
                        if (val.isEmpty()) errors.incrementAndGet();
                    }
                } catch (Exception e) {
                    errors.incrementAndGet();
                } finally {
                    done.countDown();
                }
            }).start();
        }

        start.countDown();
        done.await(5, TimeUnit.SECONDS);
        assertEquals(0, errors.get(), "No errors expected under concurrent reads");
    }
}
