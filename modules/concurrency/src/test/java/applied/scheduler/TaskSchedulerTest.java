package applied.scheduler;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

public class TaskSchedulerTest {

    private TaskScheduler scheduler;

    @BeforeEach
    public void setUp() {
        scheduler = new SimpleTaskScheduler(4);
    }

    @AfterEach
    public void tearDown() {
        scheduler.shutdown();
    }

    @Test
    public void testOneShot_firesOnce() throws InterruptedException {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicInteger count = new AtomicInteger();

        scheduler.schedule(() -> {
            count.incrementAndGet();
            latch.countDown();
        }, 50, TimeUnit.MILLISECONDS);

        assertTrue(latch.await(1, TimeUnit.SECONDS), "Task should fire within 1 second");

        Thread.sleep(200); // подождать: задача не должна повториться
        assertEquals(1, count.get(), "One-shot task should fire exactly once");
    }

    @Test
    public void testOneShot_firesAfterDelay() throws InterruptedException {
        long start = System.currentTimeMillis();
        CountDownLatch latch = new CountDownLatch(1);

        scheduler.schedule(latch::countDown, 200, TimeUnit.MILLISECONDS);

        assertTrue(latch.await(1, TimeUnit.SECONDS));
        long elapsed = System.currentTimeMillis() - start;
        assertTrue(elapsed >= 150, "Task should not fire before delay: elapsed=" + elapsed);
    }

    @Test
    public void testScheduleAtFixedRate_firesMultipleTimes() throws InterruptedException {
        int expectedFires = 5;
        CountDownLatch latch = new CountDownLatch(expectedFires);
        AtomicInteger count = new AtomicInteger();

        scheduler.scheduleAtFixedRate(() -> {
            count.incrementAndGet();
            latch.countDown();
        }, 0, 100, TimeUnit.MILLISECONDS);

        assertTrue(latch.await(2, TimeUnit.SECONDS),
            "Task should fire " + expectedFires + " times; actual: " + count.get());
    }

    @Test
    public void testScheduleWithFixedDelay_firesMultipleTimes() throws InterruptedException {
        CountDownLatch latch = new CountDownLatch(3);

        scheduler.scheduleWithFixedDelay(latch::countDown, 0, 100, TimeUnit.MILLISECONDS);

        assertTrue(latch.await(2, TimeUnit.SECONDS), "Task should fire at least 3 times");
    }

    @Test
    public void testFixedRate_vs_fixedDelay_timingDifference() throws InterruptedException {
        // fixedRate: следующий старт = предыдущий старт + period (не зависит от длительности)
        // fixedDelay: следующий старт = конец предыдущего + delay
        // С задачей длительностью 150мс и периодом 100мс:
        //   fixedRate: задачи могут накапливаться / перекрываться
        //   fixedDelay: эффективный интервал = 150 + 100 = 250мс

        AtomicInteger fixedRateCount = new AtomicInteger();
        AtomicInteger fixedDelayCount = new AtomicInteger();

        TaskScheduler s1 = new SimpleTaskScheduler(2);
        TaskScheduler s2 = new SimpleTaskScheduler(2);

        s1.scheduleAtFixedRate(() -> {
            fixedRateCount.incrementAndGet();
            try { Thread.sleep(150); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }, 0, 100, TimeUnit.MILLISECONDS);

        s2.scheduleWithFixedDelay(() -> {
            fixedDelayCount.incrementAndGet();
            try { Thread.sleep(150); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }, 0, 100, TimeUnit.MILLISECONDS);

        Thread.sleep(1000);
        s1.shutdown();
        s2.shutdown();

        // fixedRate должен сработать больше раз чем fixedDelay при одинаковом времени
        assertTrue(fixedRateCount.get() > fixedDelayCount.get(),
            "fixedRate should fire more often: fixedRate=" + fixedRateCount + ", fixedDelay=" + fixedDelayCount);
    }

    @Test
    public void testCancel_stopsFutureExecution() throws InterruptedException {
        AtomicInteger count = new AtomicInteger();

        UUID taskId = scheduler.scheduleAtFixedRate(
            count::incrementAndGet, 100, 100, TimeUnit.MILLISECONDS);

        Thread.sleep(350); // позволяем сработать ~3 раза
        scheduler.cancel(taskId);
        int countAfterCancel = count.get();

        Thread.sleep(300); // убеждаемся что после cancel задача не выполняется

        assertEquals(countAfterCancel, count.get(),
            "Task should not fire after cancel");
    }

    @Test
    public void testCancelBeforeFire_taskNeverFires() throws InterruptedException {
        AtomicInteger count = new AtomicInteger();

        UUID taskId = scheduler.schedule(count::incrementAndGet, 500, TimeUnit.MILLISECONDS);
        boolean cancelled = scheduler.cancel(taskId);

        assertTrue(cancelled, "Cancel should return true for a pending task");

        Thread.sleep(700);
        assertEquals(0, count.get(), "Task should never fire after being cancelled");
    }

    @Test
    public void testMultipleTasksRunConcurrently() throws InterruptedException {
        int taskCount = 5;
        CountDownLatch allStarted = new CountDownLatch(taskCount);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch allDone = new CountDownLatch(taskCount);

        for (int i = 0; i < taskCount; i++) {
            scheduler.schedule(() -> {
                allStarted.countDown();
                try {
                    release.await(); // все задачи ждут одновременно
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                allDone.countDown();
            }, 0, TimeUnit.MILLISECONDS);
        }

        // Если задачи выполняются параллельно — все 5 начнутся до release
        assertTrue(allStarted.await(1, TimeUnit.SECONDS),
            "All tasks should start concurrently with thread pool");
        release.countDown();
        assertTrue(allDone.await(1, TimeUnit.SECONDS));
    }
}
