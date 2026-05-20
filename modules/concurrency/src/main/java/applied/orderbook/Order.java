package applied.orderbook;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Заявка в биржевом стакане.
 *
 * Приоритет исполнения — price-time priority:
 * 1. Лучшая цена (BUY: максимальная; SELL: минимальная)
 * 2. При равной цене — более ранняя заявка (по timestamp)
 */
public class Order {

    private final UUID id;
    private final Side side;
    private final BigDecimal price;
    private int quantity; // мутабельно: уменьшается при частичном исполнении
    private final Instant timestamp;

    public Order(Side side, BigDecimal price, int quantity) {
        this.id = UUID.randomUUID();
        this.side = side;
        this.price = price;
        this.quantity = quantity;
        this.timestamp = Instant.now();
    }

    public UUID getId() { return id; }
    public Side getSide() { return side; }
    public BigDecimal getPrice() { return price; }
    public int getQuantity() { return quantity; }
    public Instant getTimestamp() { return timestamp; }

    public void reduceQuantity(int amount) {
        this.quantity -= amount;
    }

    @Override
    public String toString() {
        return "Order{id=" + id + ", side=" + side + ", price=" + price + ", qty=" + quantity + "}";
    }
}
