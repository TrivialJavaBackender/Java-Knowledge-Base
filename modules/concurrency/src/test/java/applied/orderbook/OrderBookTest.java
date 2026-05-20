package applied.orderbook;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

public class OrderBookTest {

    private static OrderBook newInstance() {
        return new OrderBookService();
    }

    @Test
    public void testBuyMatchesSell_fullFill() {
        OrderBook book = newInstance();

        // Sell: 10 акций по 100
        Order sell = new Order(Side.SELL, new BigDecimal("100"), 10);
        List<Trade> trades1 = book.placeOrder(sell);
        assertTrue(trades1.isEmpty(), "No match yet — no bids in book");

        // Buy: 10 акций по 100 — должно совпасть
        Order buy = new Order(Side.BUY, new BigDecimal("100"), 10);
        List<Trade> trades2 = book.placeOrder(buy);

        assertEquals(1, trades2.size(), "Should produce exactly one trade");
        Trade trade = trades2.get(0);
        assertEquals(new BigDecimal("100"), trade.getPrice());
        assertEquals(10, trade.getQuantity());
        assertEquals(buy.getId(), trade.getBuyOrderId());
        assertEquals(sell.getId(), trade.getSellOrderId());

        // Стакан должен быть пустым
        assertTrue(book.getBestBid().isEmpty(), "No bids should remain");
        assertTrue(book.getBestAsk().isEmpty(), "No asks should remain");
    }

    @Test
    public void testBuyDoesNotMatchIfPriceTooLow() {
        OrderBook book = newInstance();

        book.placeOrder(new Order(Side.SELL, new BigDecimal("110"), 10));
        List<Trade> trades = book.placeOrder(new Order(Side.BUY, new BigDecimal("100"), 10));

        assertTrue(trades.isEmpty(), "No match: bid < ask");
        assertEquals(Optional.of(new BigDecimal("100")), book.getBestBid());
        assertEquals(Optional.of(new BigDecimal("110")), book.getBestAsk());
    }

    @Test
    public void testPartialFill() {
        OrderBook book = newInstance();

        // Sell 10, Buy 3 — частичное исполнение
        book.placeOrder(new Order(Side.SELL, new BigDecimal("100"), 10));
        Order buy = new Order(Side.BUY, new BigDecimal("100"), 3);
        List<Trade> trades = book.placeOrder(buy);

        assertEquals(1, trades.size());
        assertEquals(3, trades.get(0).getQuantity(), "Trade qty should be min(buy, sell)");

        // Остаток sell (7 акций) должен остаться в стакане
        assertEquals(Optional.of(new BigDecimal("100")), book.getBestAsk());
        assertTrue(book.getBestBid().isEmpty(), "Buy was fully filled, no bids remain");
    }

    @Test
    public void testPriceTimePriority() {
        OrderBook book = newInstance();

        // Два sell по одной цене — первый должен исполниться первым
        Order sell1 = new Order(Side.SELL, new BigDecimal("100"), 5);
        Order sell2 = new Order(Side.SELL, new BigDecimal("100"), 5);
        book.placeOrder(sell1);
        book.placeOrder(sell2);

        // Buy, который покрывает только один sell
        List<Trade> trades = book.placeOrder(new Order(Side.BUY, new BigDecimal("100"), 5));

        assertEquals(1, trades.size());
        assertEquals(sell1.getId(), trades.get(0).getSellOrderId(),
            "First sell in queue should be matched first (FIFO)");
    }

    @Test
    public void testBestBidIsHighestPrice() {
        OrderBook book = newInstance();

        book.placeOrder(new Order(Side.BUY, new BigDecimal("95"), 5));
        book.placeOrder(new Order(Side.BUY, new BigDecimal("100"), 5));
        book.placeOrder(new Order(Side.BUY, new BigDecimal("98"), 5));

        assertEquals(Optional.of(new BigDecimal("100")), book.getBestBid(),
            "Best bid should be the highest price");
    }

    @Test
    public void testBestAskIsLowestPrice() {
        OrderBook book = newInstance();

        book.placeOrder(new Order(Side.SELL, new BigDecimal("105"), 5));
        book.placeOrder(new Order(Side.SELL, new BigDecimal("100"), 5));
        book.placeOrder(new Order(Side.SELL, new BigDecimal("103"), 5));

        assertEquals(Optional.of(new BigDecimal("100")), book.getBestAsk(),
            "Best ask should be the lowest price");
    }

    @Test
    public void testSpread() {
        OrderBook book = newInstance();

        book.placeOrder(new Order(Side.BUY, new BigDecimal("98"), 5));
        book.placeOrder(new Order(Side.SELL, new BigDecimal("102"), 5));

        assertEquals(Optional.of(new BigDecimal("4")), book.getSpread(),
            "Spread = bestAsk - bestBid = 102 - 98 = 4");
    }

    @Test
    public void testCancelOrder() {
        OrderBook book = newInstance();

        Order sell = new Order(Side.SELL, new BigDecimal("100"), 10);
        book.placeOrder(sell);
        assertEquals(Optional.of(new BigDecimal("100")), book.getBestAsk());

        assertTrue(book.cancelOrder(sell.getId()), "Cancel should return true");
        assertTrue(book.getBestAsk().isEmpty(), "Ask should be gone after cancel");

        assertFalse(book.cancelOrder(sell.getId()), "Second cancel should return false");
    }

    @Test
    public void testMultiLevelMatchingProducesMultipleTrades() {
        OrderBook book = newInstance();

        // Два sell на разных ценовых уровнях
        book.placeOrder(new Order(Side.SELL, new BigDecimal("100"), 3));
        book.placeOrder(new Order(Side.SELL, new BigDecimal("101"), 3));

        // Большой buy, покрывающий оба уровня
        List<Trade> trades = book.placeOrder(new Order(Side.BUY, new BigDecimal("105"), 6));

        assertEquals(2, trades.size(), "Should match against both price levels");
        assertEquals(new BigDecimal("100"), trades.get(0).getPrice(), "First trade at best ask");
        assertEquals(new BigDecimal("101"), trades.get(1).getPrice(), "Second trade at next ask");
    }

    @Test
    public void testSnapshotDepth() {
        OrderBook book = newInstance();

        book.placeOrder(new Order(Side.BUY, new BigDecimal("99"), 5));
        book.placeOrder(new Order(Side.BUY, new BigDecimal("98"), 3));
        book.placeOrder(new Order(Side.SELL, new BigDecimal("101"), 4));
        book.placeOrder(new Order(Side.SELL, new BigDecimal("102"), 6));

        OrderBookSnapshot snapshot = book.getSnapshot(2);

        assertEquals(2, snapshot.getBids().size());
        assertEquals(2, snapshot.getAsks().size());
        assertEquals(new BigDecimal("99"), snapshot.getBids().get(0).price());
        assertEquals(new BigDecimal("101"), snapshot.getAsks().get(0).price());
    }
}
