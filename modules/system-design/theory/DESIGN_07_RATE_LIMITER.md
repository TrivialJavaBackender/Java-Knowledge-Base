# Проектная задача: распределённый ограничитель скорости

Контролировать количество запросов на пользователя / API key. Используется в API Gateway, для защиты от злоупотреблений / DDoS, для применения тарифных уровней.

> **Область:** уровень дизайна. Реализация на конкурентном коде (Token Bucket на Java) — в [`concurrency/applied/ratelimiter`](../../../concurrency/src/main/java/applied/ratelimiter).

---

## 1. Требования

### Функциональные
- лимит на запросы на пользователя / IP / API key / endpoint;
- лимиты на разных окнах (в секунду / минуту / час / день);
- настраивается на тарифный уровень (free / pro / enterprise);
- ответ 429 Too Many Requests + заголовок `Retry-After`.

### Нефункциональные
- **Низкая задержка** — < 1 мс на принятие решения (через ограничитель скорости проходит каждый запрос);
- **Высокая доступность** — отказ не должен блокировать легитимный трафик;
- **Точность** — близко к настроенному лимиту, без излишней строгости;
- **Распределённый** — работает поверх N экземпляров.

---

## 2. Оценка

```
API-сервис: пик 100K RPS на кластере
N экземпляров приложения: 50

Ограничитель скорости на экземпляр должен:
  - Принять решение разрешить/отказать < 1 мс
  - Координировать состояние между экземплярами
  - Переживать временный сбой Redis
```

---

## 3. Алгоритмы

### Token Bucket

Размер корзины = всплеск. Скорость пополнения = устойчивая скорость (sustainable rate).

```
bucket.tokens = capacity
на запросе:
  refill: tokens = min(capacity, tokens + (now - last_refill) × rate)
  если tokens >= 1: tokens--, allow
  иначе: deny
```

- ✓ Разрешает всплеск до capacity
- ✓ Сглаженная средняя скорость
- Используют: AWS API Gateway, Stripe API

### Leaky Bucket

Запросы попадают в очередь, обрабатываются с фиксированной скоростью. Переполнение → сброс.

- ✓ Сглаженный исходящий поток
- ✗ Добавляет задержку (очередь)
- Используется: формирование трафика на сетевом железе

### Fixed Window Counter

```
key = (user_id, window_start)
counter = INCR key
если counter > limit: deny
EXPIRE key (window_size)
```

- ✓ Просто, O(1) памяти на ключ
- ✗ **Проблема границ окон:** двойной всплеск на границе (например, 100 запросов в 11:59:59 + 100 в 12:00:01)

### Sliding Window Log

Храним метки времени всех недавних запросов.

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

## 4. Распределённая реализация (Redis + Lua)

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
                   Redis Cluster (состояние ограничения скорости)

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

## 7. Лимиты по тарифному уровню

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

Тарифный уровень берём из user DB / кэша, применяем соответствующий лимит.

---

## 8. Multi-region

В каждом регионе — свой Redis-кластер. Состояние между регионами не реплицируется (добавило бы задержку и сложности).

```
US-пользователь в US-регионе → US Redis
EU-пользователь в EU-регионе → EU Redis
Каждый регион ставит свои лимиты
```

Нюанс: пользователь, бьющий по нескольким регионам, не оценивается глобально. Приемлемый компромисс ради низкой задержки.

Для глобальных лимитов (редко) — центральный Redis-кластер или агрегирующий сервис (за счёт дополнительной задержки).

---

## 9. Плавная деградация

**Redis недоступен** → ограничитель скорости не может принять решение. Варианты:
1. **Fail open** (разрешить всё) — лучше UX, но уязвимость к атакам со всплесками;
2. **Fail closed** (запретить всё) — безопасно, но ломает легитимных пользователей;
3. **Запасной локальный кэш** — у каждого экземпляра свой приближённый счётчик.

**Лучшая практика:** fail open для публичного API (UX), fail closed для внутренних чувствительных эндпоинтов (например, login).

---

## 10. Ответные заголовки

Лучшая практика: сообщать клиенту о лимите и остатке.

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

## 11. Компромиссы

### Точность против стоимости

- Sliding window log — точно, O(N) памяти;
- sliding window counter — приближённо, O(2);
- fixed window — быстрее всего, но проблема границ.

Выбор — по терпимости к неточности и доступной памяти.

### Лимит на экземпляр против распределённого лимита

- **На экземпляр** — счётчик хранится в памяти каждого экземпляра приложения отдельно. Быстро (без Redis), но каждый экземпляр считает самостоятельно → эффективный глобальный лимит = N × instance_limit (при 50 экземплярах лимит 100/с на пользователя превращается в 5000/с).
- **Распределённый (Redis)** — счётчик хранится централизованно в Redis, все экземпляры видят один и тот же счётчик. Точный глобальный лимит, но каждый запрос = +1 вызов Redis (1–3 мс).

Гибрид: in-memory token bucket, периодически синхронизируется с Redis для глобальной согласованности.

### Кэширование на клиенте

При известных лимитах клиент может сам себя регулировать. Но недоверенным клиентам верить нельзя — финальное применение на сервере.

---

## 12. Защита от злоупотреблений

- лимит по IP + по пользователю — IP может быть общим (корпоративный NAT);
- адаптивные лимиты — детектируем аномалию, ужесточаем;
- гео-лимиты — блокировка / троттлинг по стране;
- интеграция с WAF — правила ограничения скорости в Cloudflare / AWS WAF.

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 4 «Design a Rate Limiter»
- [Stripe — Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters)
- [Cloudflare — How to build a rate limiter](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)
- [Hello Interview — Distributed Rate Limiter](https://www.hellointerview.com/learn/system-design/problem-breakdowns/rate-limiter)
- [Envoy Rate Limit Service](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/rate_limit_filter)
- [GitHub — RateLimitJ implementation patterns](https://github.com/mokies/ratelimitj)
