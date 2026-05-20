package applied.bank;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

public class BankServiceTest {

    private static BankService newInstance() {
        return new BankServiceImpl(new AccountRepository());
    }

    @Test
    public void testSuccessfulTransfer() {
        BankService bank = newInstance();
        Account alice = bank.createAccount("Alice", new BigDecimal("1000"));
        Account bob = bank.createAccount("Bob", new BigDecimal("500"));

        Transaction tx = bank.transfer(UUID.randomUUID(), alice.getId(), bob.getId(), new BigDecimal("300"));

        assertEquals(TransactionStatus.COMPLETED, tx.getStatus());
        assertEquals(new BigDecimal("700"), bank.getBalance(alice.getId()));
        assertEquals(new BigDecimal("800"), bank.getBalance(bob.getId()));
    }

    @Test
    public void testInsufficientFunds_throwsException() {
        BankService bank = newInstance();
        Account alice = bank.createAccount("Alice", new BigDecimal("100"));
        Account bob = bank.createAccount("Bob", new BigDecimal("0"));

        assertThrows(InsufficientFundsException.class, () ->
            bank.transfer(UUID.randomUUID(), alice.getId(), bob.getId(), new BigDecimal("200"))
        );

        // Баланс не должен измениться
        assertEquals(new BigDecimal("100"), bank.getBalance(alice.getId()));
        assertEquals(new BigDecimal("0"), bank.getBalance(bob.getId()));
    }

    @Test
    public void testIdempotency_sameKeyExecutesOnce() {
        BankService bank = newInstance();
        Account alice = bank.createAccount("Alice", new BigDecimal("1000"));
        Account bob = bank.createAccount("Bob", new BigDecimal("0"));

        UUID idempotencyKey = UUID.randomUUID();

        Transaction tx1 = bank.transfer(idempotencyKey, alice.getId(), bob.getId(), new BigDecimal("300"));
        Transaction tx2 = bank.transfer(idempotencyKey, alice.getId(), bob.getId(), new BigDecimal("300"));

        // Оба вызова вернули одну и ту же транзакцию
        assertEquals(tx1.getId(), tx2.getId(), "Same idempotency key should return same transaction");

        // Деньги списались только один раз
        assertEquals(new BigDecimal("700"), bank.getBalance(alice.getId()),
            "Money should be deducted only once");
        assertEquals(new BigDecimal("300"), bank.getBalance(bob.getId()));
    }

    @Test
    public void testDifferentIdempotencyKeys_executeIndependently() {
        BankService bank = newInstance();
        Account alice = bank.createAccount("Alice", new BigDecimal("1000"));
        Account bob = bank.createAccount("Bob", new BigDecimal("0"));

        bank.transfer(UUID.randomUUID(), alice.getId(), bob.getId(), new BigDecimal("100"));
        bank.transfer(UUID.randomUUID(), alice.getId(), bob.getId(), new BigDecimal("100"));

        assertEquals(new BigDecimal("800"), bank.getBalance(alice.getId()));
        assertEquals(new BigDecimal("200"), bank.getBalance(bob.getId()));
    }

    @Test
    public void testNegativeAmount_throwsException() {
        BankService bank = newInstance();
        Account alice = bank.createAccount("Alice", new BigDecimal("1000"));
        Account bob = bank.createAccount("Bob", new BigDecimal("0"));

        assertThrows(IllegalArgumentException.class, () ->
            bank.transfer(UUID.randomUUID(), alice.getId(), bob.getId(), new BigDecimal("-100"))
        );
    }

    @Test
    public void testConcurrentTransfers_noDeadlock_noRaceCondition() throws InterruptedException {
        BankService bank = newInstance();
        Account alice = bank.createAccount("Alice", new BigDecimal("10000"));
        Account bob = bank.createAccount("Bob", new BigDecimal("10000"));

        int threads = 20;
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);
        AtomicInteger errors = new AtomicInteger();

        // Половина потоков: Alice → Bob, вторая половина: Bob → Alice
        // Классический сценарий дедлока при неправильном порядке блокировок
        for (int i = 0; i < threads; i++) {
            boolean aliceToBob = i % 2 == 0;
            new Thread(() -> {
                try {
                    start.await();
                    if (aliceToBob) {
                        bank.transfer(UUID.randomUUID(), alice.getId(), bob.getId(), new BigDecimal("100"));
                    } else {
                        bank.transfer(UUID.randomUUID(), bob.getId(), alice.getId(), new BigDecimal("100"));
                    }
                } catch (InsufficientFundsException e) {
                    // допустимо при конкурентных переводах
                } catch (Exception e) {
                    errors.incrementAndGet();
                } finally {
                    done.countDown();
                }
            }).start();
        }

        start.countDown();
        // Тест зависнет если есть дедлок
        assertTrue(done.await(5, TimeUnit.SECONDS), "Deadlock detected: not all threads completed");
        assertEquals(0, errors.get(), "No unexpected exceptions");

        // Суммарный баланс должен сохраниться
        BigDecimal totalBalance = bank.getBalance(alice.getId()).add(bank.getBalance(bob.getId()));
        assertEquals(new BigDecimal("20000"), totalBalance,
            "Total balance must be conserved (no money created or lost)");
    }

    @Test
    public void testConcurrentTransfers_balanceIsConsistent() throws InterruptedException {
        BankService bank = newInstance();
        Account alice = bank.createAccount("Alice", new BigDecimal("10000"));
        Account bob = bank.createAccount("Bob", new BigDecimal("0"));

        int threads = 50;
        CountDownLatch done = new CountDownLatch(threads);
        List<Thread> threadList = new ArrayList<>();

        for (int i = 0; i < threads; i++) {
            threadList.add(new Thread(() -> {
                try {
                    bank.transfer(UUID.randomUUID(), alice.getId(), bob.getId(), new BigDecimal("100"));
                } catch (InsufficientFundsException ignored) {
                } finally {
                    done.countDown();
                }
            }));
        }

        threadList.forEach(Thread::start);
        done.await(5, TimeUnit.SECONDS);

        BigDecimal total = bank.getBalance(alice.getId()).add(bank.getBalance(bob.getId()));
        assertEquals(new BigDecimal("10000"), total,
            "Money must be conserved: no double-spend or loss");
    }
}
