# Design Problem: Distributed Rate Limiter

Контролировать количество запросов на пользователя / API key. Используется в API Gateway, для защиты от abuse / DDoS, для enforcement billing tier'ов.

> **Scope:** уровень дизайна. Concurrent-реализация в коде (Token Bucket в Java) — в [`concurrency/applied/ratelimiter`](../../../concurrency/src/main/java/applied/ratelimiter).

---

## 1. Requirements

### Functional
- Лимит на запросы per user / IP / API key / endpoint
- Лимиты на разных окнах (per second / minute / hour / day)
- Конфигурируется per tier (free / pro / enterprise)
- Ответ 429 Too Many Requests + заголовок `Retry-After`

### Non-functional
- **Низкая latency** — < 1 мс на принятие решения (через rate limiter проходит каждый запрос)
- **High availability** — отказ не должен блокировать легитимный трафик
- **Точность** — близко к настроенному лимиту, без излишней строгости
- **Distributed** — работает поверх N инстансов

---

## 2. Estimation

```
API-сервис: пик 100K RPS на кластере
N инстансов приложения: 50

Per-instance rate limiter должен:
  - Принять решение allow/deny < 1 мс
  - Координировать состояние между инстансами
  - Переживать временный сбой Redis
```

---

## 3. Алгоритмы

### Token Bucket

Размер bucket'а = burst. Скорость пополнения = sustainable rate.

```
bucket.tokens = capacity
на запросе:
  refill: tokens = min(capacity, tokens + (now - last_refill) × rate)
  если tokens >= 1: tokens--, allow
  иначе: deny
```

- ✓ Разрешает burst до capacity
- ✓ Сглаженная средняя скорость
- Используют: AWS API Gateway, Stripe API

### Leaky Bucket

Запросы попадают в очередь, обрабатываются с фиксированной скоростью. Переполнение → drop.

- ✓ Сглаженный output
- ✗ Добавляет latency (очередь)
- Используется: traffic shaping на сетевом железе

### Fixed Window Counter

```
key = (user_id, window_start)
counter = INCR key
если counter > limit: deny
EXPIRE key (window_size)
```

- ✓ Просто, O(1) памяти на ключ
- ✗ **Проблема границ окон:** 2× burst на границе (например, 100 запросов в 11:59:59 + 100 в 12:00:01)

### Sliding Window Log

Храним timestamps всех недавних запросов.

```
ZADD requests:user_123 (timestamp) (request_id)
ZREMRANGEBYSCORE requests:user_123 0 (now - window_size)
count = ZCARD requests:user_123
если count > limit: deny
```

- ✓ Точно, нет проблемы границ
- ✗ Память O(N) на пользователя — нюанс масштаба

### Sliding Window Counter (рекомендуется)

Комбинация fixed window + взвешенный предыдущий.

```
current_count = count_current_window + (count_previous_window × overlap_ratio)
overlap_ratio = (window_size - time_in_current_window) / window_size

Если current_count > limit: deny
```

- ✓ Приближённое sliding window, O(2) записей на ключ
- ✓ Нет проблемы границ
- ✓ Экономно по памяти

---

## 4. Distributed-реализация (Redis + Lua)

Атомарный check-and-update через Lua-скрипт — устраняет гонку между INCR и EXPIRE.

```lua
-- Sliding window log
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count < limit then
    redis.call('ZADD', key, now, now)  -- score и member оба = now
    redis.call('EXPIRE', key, window)
    return 1  -- allowed
else
    return 0  -- denied
end
```

Из приложения:
```python
allowed = redis.eval(script, keys=[f"rl:{user_id}"], args=[60, 100, time.time()])
if not allowed:
    return 429
```

---

## 5. Архитектура

```
Client → API Gateway → инстансы приложения
                        ↓
                   Redis Cluster (состояние rate limit'а)

ИЛИ (современный вариант):
                   Envoy / Istio sidecar
                        ↓ (out-of-band)
                   Ratelimit Service (gRPC)
                        ↓
                   Redis
```

---

## 6. Несколько уровней лимитов

У пользователя несколько лимитов одновременно:
- 100/сек
- 5000/мин
- 100000/час
- 1M/день

Проверяем ВСЕ — deny при превышении любого. Несколько ключей (например, `rl:second:user123`, `rl:minute:user123`).

---

## 7. Tier-based лимиты

У разных пользователей разные лимиты в зависимости от подписки:

```yaml
free:
  per_sec: 10
  per_day: 1000
pro:
  per_sec: 100
  per_day: 100000
enterprise:
  per_sec: 1000
  per_day: unlimited
```

Tier берём из user DB / кэша, применяем соответствующий лимит.

---

## 8. Multi-region

В каждом регионе — свой Redis-кластер. Состояние между регионами не реплицируется (добавило бы latency и сложности).

```
US-пользователь в US-регионе → US Redis
EU-пользователь в EU-регионе → EU Redis
Каждый регион ставит свои лимиты
```

Нюанс: пользователь, бьющий по нескольким регионам, не оценивается глобально. Приемлемый trade-off ради низкой latency.

Для глобальных лимитов (редко) — центральный Redis-кластер или агрегирующий сервис (за счёт дополнительной latency).

---

## 9. Graceful degradation

**Redis down** → rate limiter не может принять решение. Варианты:
1. **Fail open** (allow all) — лучше UX, но уязвимость к burst-атакам
2. **Fail closed** (deny all) — безопасно, но ломает легитимных пользователей
3. **Локальный кэш-fallback** — у каждого инстанса свой приближённый счётчик

**Best practice:** fail open для публичного API (UX), fail closed для внутренних чувствительных endpoint'ов (например, login).

---

## 10. Ответные заголовки

Best practice: сообщать клиенту о лимите и остатке.

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 73
X-RateLimit-Reset: 1700000000   # Unix-timestamp сброса

ИЛИ (при deny):
HTTP/1.1 429 Too Many Requests
Retry-After: 17                  # секунды
```

Так делают Stripe и многие современные API.

---

## 11. Trade-offs

### Точность vs стоимость

- Sliding window log — точно, O(N) памяти
- Sliding window counter — приближённо, O(2)
- Fixed window — быстрее всего, но проблема границ

Выбор — по терпимости к неточности и доступной памяти.

### Per-instance vs distributed

- **Per-instance** — быстро (in-memory), но каждый инстанс enforce'ит независимо → эффективный лимит = N × instance_limit
- **Distributed (Redis)** — точный глобальный лимит, но каждый запрос — это +1 вызов Redis

Гибрид: in-memory token bucket, периодически синхронизируется с Redis.

### Клиентское кэширование

При известных лимитах клиент может сам себя регулировать. Но недоверенным клиентам верить нельзя — финальный enforcement на сервере.

---

## 12. Anti-abuse

- Лимит по IP + по user — IP может быть общим (corporate NAT)
- Adaptive лимиты — детектим аномалию, ужесточаем
- Гео-лимиты — block / throttle по стране
- Интеграция с WAF — правила rate limit в Cloudflare / AWS WAF

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 4 «Design a Rate Limiter»
- [Stripe — Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters)
- [Cloudflare — How to build a rate limiter](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)
- [Hello Interview — Distributed Rate Limiter](https://www.hellointerview.com/learn/system-design/problem-breakdowns/rate-limiter)
- [Envoy Rate Limit Service](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/rate_limit_filter)
- [GitHub — RateLimitJ implementation patterns](https://github.com/mokies/ratelimitj)
