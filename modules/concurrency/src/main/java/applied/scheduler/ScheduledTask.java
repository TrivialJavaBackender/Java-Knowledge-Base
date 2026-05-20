package applied.scheduler;

import java.util.UUID;
import java.util.concurrent.Delayed;
import java.util.concurrent.TimeUnit;

/**
 * Запланированная задача. Реализует Delayed для использования в DelayQueue.
 *
 * Поля:
 * - id: UUID для идентификации и отмены
 * - task: Runnable — тело задачи
 * - nextFireTime: System.nanoTime() момент следующего запуска
 * - period: интервал повторения в наносекундах (0 = одноразовая задача)
 * - fixedDelay: если true — period отсчитывается от конца выполнения;
 *               если false — от начала (fixedRate)
 * - cancelled: флаг отмены
 */
public class ScheduledTask implements Delayed {

    private final UUID id;
    private final Runnable task;
    private volatile long nextFireTime; // nanos
    private final long period;          // nanos, 0 = one-shot
    private final boolean fixedDelay;
    private volatile boolean cancelled;

    public ScheduledTask(UUID id, Runnable task, long delayNanos, long periodNanos, boolean fixedDelay) {
        this.id = id;
        this.task = task;
        this.nextFireTime = System.nanoTime() + delayNanos;
        this.period = periodNanos;
        this.fixedDelay = fixedDelay;
        this.cancelled = false;
    }

    public UUID getId() { return id; }
    public Runnable getTask() { return task; }
    public long getPeriod() { return period; }
    public boolean isFixedDelay() { return fixedDelay; }
    public boolean isCancelled() { return cancelled; }
    public boolean isRecurring() { return period > 0; }

    public void cancel() { this.cancelled = true; }

    /**
     * Пересчитать следующее время запуска после выполнения.
     * Вызывается диспетчером после каждого выполнения периодической задачи.
     *
     * @param executionEndNanos System.nanoTime() момент окончания выполнения
     */
    public void reschedule(long executionEndNanos) {
        if (fixedDelay) {
            this.nextFireTime = executionEndNanos + period;
        } else {
            this.nextFireTime = this.nextFireTime + period;
        }
    }

    @Override
    public long getDelay(TimeUnit unit) {
        return unit.convert(nextFireTime - System.nanoTime(), TimeUnit.NANOSECONDS);
    }

    @Override
    public int compareTo(Delayed other) {
        return Long.compare(
            this.getDelay(TimeUnit.NANOSECONDS),
            other.getDelay(TimeUnit.NANOSECONDS)
        );
    }
}
