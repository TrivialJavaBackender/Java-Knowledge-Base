package applied.cache;

import java.time.Instant;

/**
 * Внутренняя запись кэша, хранящая значение и метаданные для TTL.
 */
public class CacheEntry<V> {

    private final V value;
    private final Instant expiresAt;

    public CacheEntry(V value, Instant expiresAt) {
        this.value = value;
        this.expiresAt = expiresAt;
    }

    public V getValue() {
        return value;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    /**
     * @return true если TTL истёк и запись считается мёртвой
     */
    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }
}
