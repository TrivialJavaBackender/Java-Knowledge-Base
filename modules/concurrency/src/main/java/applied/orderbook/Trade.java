package applied.orderbook;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Сделка, возникающая при совпадении BUY и SELL заявок.
 *
 * Цена сделки = цена заявки, которая уже стояла в стакане (maker).
 * Новая заявка, которая инициировала сделку, называется taker.
 *
 * Частичное исполнение:
 * Если quantity у BUY и SELL заявок не совпадают — создаётся сделка
 * на min(buyQty, sellQty). Остаток меньшей заявки остаётся в стакане
 * с уменьшенным quantity.
 */
public class Trade {

    private final UUID id;
    private final UUID buyOrderId;
    private final UUID sellOrderId;
    private final BigDecimal price;
    private final int quantity;

    public Trade(UUID buyOrderId, UUID sellOrderId, BigDecimal price, int quantity) {
        this.id = UUID.randomUUID();
        this.buyOrderId = buyOrderId;
        this.sellOrderId = sellOrderId;
        this.price = price;
        this.quantity = quantity;
    }

    public UUID getId() { return id; }
    public UUID getBuyOrderId() { return buyOrderId; }
    public UUID getSellOrderId() { return sellOrderId; }
    public BigDecimal getPrice() { return price; }
    public int getQuantity() { return quantity; }

    @Override
    public String toString() {
        return "Trade{price=" + price + ", qty=" + quantity +
               ", buy=" + buyOrderId + ", sell=" + sellOrderId + "}";
    }
}
