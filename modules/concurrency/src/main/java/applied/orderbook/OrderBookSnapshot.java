package applied.orderbook;

import java.math.BigDecimal;
import java.util.List;

/**
 * Снимок состояния стакана для отображения.
 * Каждый уровень: цена + суммарный объём всех заявок на этой цене.
 */
public class OrderBookSnapshot {

    public record PriceLevel(BigDecimal price, int totalQuantity) {}

    private final List<PriceLevel> bids; // отсортированы по убыванию цены
    private final List<PriceLevel> asks; // отсортированы по возрастанию цены

    public OrderBookSnapshot(List<PriceLevel> bids, List<PriceLevel> asks) {
        this.bids = bids;
        this.asks = asks;
    }

    public List<PriceLevel> getBids() { return bids; }
    public List<PriceLevel> getAsks() { return asks; }
}
