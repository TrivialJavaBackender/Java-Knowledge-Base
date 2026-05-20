package applied.orderbook;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * ЗАДАЧА: Stock Order Book (Биржевой стакан)
 * Время: 35-40 минут
 * Тема: System Design, Data Structures, Concurrency
 *
 * ТЗ:
 * Реализуй биржевой стакан (Order Book) с механизмом сопоставления заявок (matching engine).
 *
 * Требования:
 * - Стакан хранит BUY-заявки (bids) и SELL-заявки (asks) раздельно
 * - Приоритет исполнения — price-time priority:
 *     BUY:  максимальная цена первой (лучший покупатель платит больше)
 *     SELL: минимальная цена первой (лучший продавец просит меньше)
 *     При равной цене — более ранняя заявка (FIFO по timestamp)
 * - placeOrder() пытается немедленно сопоставить новую заявку с противоположной стороной
 *   Если полного совпадения нет — остаток добавляется в стакан
 * - Частичное исполнение: если заявки не совпадают по quantity — исполняется min(buyQty, sellQty)
 * - cancelOrder() удаляет незаполненную заявку из стакана
 * - Реализация должна быть thread-safe
 *
 * Подсказка по структуре данных:
 *   TreeMap<BigDecimal, Queue<Order>> bids  — reverseOrder (max цена первая)
 *   TreeMap<BigDecimal, Queue<Order>> asks  — naturalOrder (min цена первая)
 *   Queue<Order> на одном ценовом уровне — FIFO (price-time priority)
 *
 * Условие сопоставления:
 *   bestBid.price >= bestAsk.price → сделка возможна
 *
 * Вопросы для обсуждения после реализации:
 * - Какова сложность placeOrder() в худшем случае?
 * - Как реализовать market order (без указания цены)?
 * - ReentrantReadWriteLock vs synchronized — что выбрать и почему?
 * - Как масштабировать: sharding по ticker, отдельный стакан на инстанс?
 * - Как гарантировать порядок заявок в distributed setup (Kafka + single partition)?
 */
public interface OrderBook {

    /**
     * Разместить заявку. Немедленно выполнить matching с противоположной стороной.
     * Возвращает список сделок, совершённых при размещении этой заявки.
     * Остаток незаполненной заявки остаётся в стакане.
     */
    List<Trade> placeOrder(Order order);

    /**
     * Отменить заявку по ID.
     * @return true если заявка была найдена и отменена
     */
    boolean cancelOrder(UUID orderId);

    /**
     * Лучшая цена покупки (максимальный bid). Empty если стакан пуст.
     */
    Optional<BigDecimal> getBestBid();

    /**
     * Лучшая цена продажи (минимальный ask). Empty если стакан пуст.
     */
    Optional<BigDecimal> getBestAsk();

    /**
     * Спред между лучшим ask и лучшим bid.
     * Empty если одна из сторон пуста.
     */
    Optional<BigDecimal> getSpread();

    /**
     * Топ N уровней стакана с обеих сторон для отображения.
     */
    OrderBookSnapshot getSnapshot(int depth);
}
