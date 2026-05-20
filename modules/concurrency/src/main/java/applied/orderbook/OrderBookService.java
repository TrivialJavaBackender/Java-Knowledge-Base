package applied.orderbook;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Реализация биржевого стакана.
 *
 * Внутренняя структура:
 *   TreeMap<BigDecimal, Queue<Order>> bids = new TreeMap<>(Comparator.reverseOrder())
 *   TreeMap<BigDecimal, Queue<Order>> asks = new TreeMap<>()
 *   Map<UUID, BigDecimal> orderIndex — для быстрого поиска ценового уровня при cancel
 *
 * Алгоритм matching при placeOrder(newOrder):
 *   if (newOrder.side == BUY):
 *       while (bestAsk exists AND bestAsk.price <= newOrder.price AND newOrder.qty > 0):
 *           matchedSell = asks.firstEntry().getValue().peek()
 *           tradeQty = min(newOrder.qty, matchedSell.qty)
 *           создать Trade(newOrder.id, matchedSell.id, matchedSell.price, tradeQty)
 *           уменьшить qty обеих заявок
 *           если matchedSell.qty == 0 → удалить из asks
 *   если newOrder.qty > 0 → добавить остаток в bids
 *
 * Потокобезопасность:
 *   ReentrantReadWriteLock: write lock на placeOrder/cancelOrder, read lock на getSnapshot
 */
public class OrderBookService implements OrderBook {

    @Override
    public List<Trade> placeOrder(Order order) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public boolean cancelOrder(UUID orderId) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public Optional<BigDecimal> getBestBid() {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public Optional<BigDecimal> getBestAsk() {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public Optional<BigDecimal> getSpread() {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public OrderBookSnapshot getSnapshot(int depth) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }
}
