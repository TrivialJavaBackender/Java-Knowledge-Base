package applied.cache;

import java.time.Duration;
import java.util.Optional;

/**
 * LRU Cache с поддержкой TTL.
 *
 * Подсказка по реализации:
 *
 * LinkedHashMap(capacity, 0.75f, accessOrder=true) поддерживает LRU-порядок:
 * при вызове get() элемент перемещается в конец. Переопределив removeEldestEntry()
 * можно автоматически вытеснять самый старый элемент при превышении capacity.
 *
 *   protected boolean removeEldestEntry(Map.Entry<K, CacheEntry<V>> eldest) {
 *       return size() > capacity;
 *   }
 *
 * TTL: при get() проверять CacheEntry.isExpired(). Если истёк — удалить и вернуть empty.
 * Lazy eviction: просроченные элементы удаляются только при обращении.
 * Это проще, но может приводить к "раздутию" кэша. Альтернатива — фоновый поток.
 *
 * Потокобезопасность:
 * LinkedHashMap не thread-safe. Варианты:
 * 1. synchronized(this) на все методы — просто, но полная блокировка
 * 2. ReadWriteLock — параллельные reads, эксклюзивный write
 * 3. Collections.synchronizedMap() — недостаточно для составных операций
 */
public class LRUCache<K, V> implements Cache<K, V> {

    private final int capacity;
    private final Duration ttl;

    public LRUCache(int capacity, Duration ttl) {
        this.capacity = capacity;
        this.ttl = ttl;
    }

    @Override
    public Optional<V> get(K key) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public void put(K key, V value) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public boolean remove(K key) {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }

    @Override
    public int size() {
        // TODO: реализовать
        throw new UnsupportedOperationException("Not implemented");
    }
}
