package applied.scheduler;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * ЗАДАЧА: Task Scheduler
 * Время: 35-40 минут
 * Тема: Concurrency, Thread Pools
 *
 * ТЗ:
 * Реализуй планировщик задач с поддержкой одноразовых и периодических задач.
 *
 * Требования:
 * - schedule() — запускает задачу один раз через заданную задержку
 * - scheduleAtFixedRate() — запускает задачу периодически с фиксированным интервалом
 *   между стартами (если выполнение длиннее периода — следующий запуск не откладывается)
 * - scheduleWithFixedDelay() — фиксированный интервал между концом предыдущего
 *   и началом следующего выполнения
 * - cancel() — отменяет задачу; уже запущенное выполнение не прерывается
 * - shutdown() — останавливает планировщик, ждёт завершения текущих задач
 * - Несколько задач могут выполняться параллельно (thread pool для исполнения)
 * - Единственный dispatcher-поток выбирает задачи из очереди
 *
 * Подсказка по структуре:
 * DelayQueue<ScheduledTask> — диспетчер блокируется на poll() до момента
 * когда delay истёк. ExecutorService выполняет задачи параллельно.
 *
 * Вопросы для обсуждения после реализации:
 * - Как устроен ScheduledThreadPoolExecutor внутри (DelayedWorkQueue)?
 * - scheduleAtFixedRate vs scheduleWithFixedDelay — в чём разница на практике?
 * - Что произойдёт если задача бросит исключение в периодическом режиме?
 * - Как реализовать distributed scheduler (Quartz, сравнение с Redis-based)?
 * - Как гарантировать exactly-once выполнение в distributed setup?
 */
public interface TaskScheduler {

    /**
     * Запускает задачу один раз через заданную задержку.
     *
     * @return UUID задачи для последующей отмены
     */
    UUID schedule(Runnable task, long delay, TimeUnit unit);

    /**
     * Запускает задачу периодически. Следующий запуск планируется
     * от времени старта предыдущего (независимо от длительности выполнения).
     *
     * @return UUID задачи для последующей отмены
     */
    UUID scheduleAtFixedRate(Runnable task, long initialDelay, long period, TimeUnit unit);

    /**
     * Запускает задачу периодически. Следующий запуск планируется
     * через delay после завершения предыдущего.
     *
     * @return UUID задачи для последующей отмены
     */
    UUID scheduleWithFixedDelay(Runnable task, long initialDelay, long delay, TimeUnit unit);

    /**
     * Отменяет задачу. Если задача уже выполняется — не прерывает её.
     *
     * @return true если задача была найдена и отменена
     */
    boolean cancel(UUID taskId);

    /**
     * Останавливает планировщик. Новые задачи не принимаются.
     * Ожидает завершения уже запущенных задач.
     */
    void shutdown();
}
