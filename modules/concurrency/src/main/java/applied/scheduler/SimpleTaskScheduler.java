package applied.scheduler;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Реализация TaskScheduler на основе DelayQueue.
 *
 * Архитектура:
 *
 *   DelayQueue<ScheduledTask>
 *       ↑                  ↓
 *   schedule()        dispatcher thread (1 поток)
 *   (добавляет)           ↓
 *                   executor (thread pool)
 *                   (выполняет task.run())
 *
 * Dispatcher thread (один поток):
 *   while (!shutdown) {
 *       task = delayQueue.take();  // блокируется до истечения delay
 *       if (task.isCancelled()) continue;
 *       executor.submit(task.getTask());
 *       if (task.isRecurring()) {
 *           task.reschedule(System.nanoTime()); // для fixedDelay
 *           delayQueue.put(task);               // вернуть в очередь
 *       }
 *   }
 *
 * Важные нюансы:
 * - cancel() только помечает задачу как отменённую (volatile boolean).
 *   Удалить из DelayQueue сложно (O(n)), поэтому проще пропускать при poll.
 * - shutdown() должен дождаться завершения уже запущенных задач (executor.awaitTermination)
 * - fixedRate: reschedule от предыдущего nextFireTime (может накапливать отставание)
 * - fixedDelay: reschedule от System.nanoTime() после окончания выполнения
 */
public class SimpleTaskScheduler implements TaskScheduler {

    private final int threadPoolSize;

    public SimpleTaskScheduler(int threadPoolSize) {
        this.threadPoolSize = threadPoolSize;
    }

    @Override
    public UUID schedule(Runnable task, long delay, TimeUnit unit) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public UUID scheduleAtFixedRate(Runnable task, long initialDelay, long period, TimeUnit unit) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public UUID scheduleWithFixedDelay(Runnable task, long initialDelay, long delay, TimeUnit unit) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public boolean cancel(UUID taskId) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public void shutdown() {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }
}
