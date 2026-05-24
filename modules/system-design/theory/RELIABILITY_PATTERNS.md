# Reliability Patterns

Паттерны устойчивости к сбоям: retry, backoff, circuit breaker, bulkhead, hedged requests, load shedding, graceful degradation. Каждый — про **управление failure modes**, а не их предотвращение.

> **Scope:** паттерны. Базовое описание Circuit Breaker и Bulkhead — в [`microservice_patterns.md`](microservice_patterns.md), здесь — углубление и связанные подходы. Chaos engineering — в [`software-engineering/TESTING.md`](../../software-engineering/theory/TESTING.md).

---

## Retry с exponential backoff + jitter

Базовый паттерн: повторять упавший запрос с увеличивающейся задержкой.

```python
def retry_with_backoff(f, max_attempts=5):
    for attempt in range(max_attempts):
        try:
            return f()
        except TransientError:
            if attempt == max_attempts - 1:
                raise
            delay = min(base_delay * (2 ** attempt), max_delay)
            sleep(delay)
```

**Проблема naive backoff (без jitter):** все клиенты падают одновременно → одновременно идут на retry → retry storm на downstream → повторный сбой. В кэш-контексте этот же класс проблем называется **cache stampede** (см. [`caching-deep-dive/ANTI_PATTERNS.md`](../../caching-deep-dive/theory/ANTI_PATTERNS.md)).

### Jitter — must have

Случайная компонента задержки, размазывающая retry во времени.

```python
# Full jitter (рекомендация AWS)
delay = random.uniform(0, min(cap, base * 2 ** attempt))

# Equal jitter
half = min(cap, base * 2 ** attempt) / 2
delay = half + random.uniform(0, half)

# Decorrelated jitter
delay = random.uniform(base, prev_delay * 3)  # capped
```

**Рекомендация AWS (Architecture Blog):** **full jitter** даёт лучший результат — равномерное распределение retry, минимум pile-up.

### Когда не нужно делать retry

- **4xx ошибки** (кроме 408 и 429) — клиентская проблема, retry не поможет
- **Non-idempotent операции** без idempotency key — повторный charge на retry
- **Слишком долгие попытки** — после ~5 попыток смысла продолжать почти нет, лучше вернуть ошибку
- **Cascade prevention** — если retry'ев уже слишком много → downstream, видимо, сломан, нужно остановиться

### Retry budget

Чтобы предотвратить retry storm на downstream:

```
У каждого сервиса retry budget = 10% от исходных запросов
Если retry превышают budget → отбрасываем retry, сразу возвращаем ошибку
```

→ Linkerd и Envoy реализуют retry budget нативно.

---

## Circuit Breaker (углубление)

Базовое описание — в [`microservice_patterns.md`](microservice_patterns.md#circuit-breaker).

### Состояния

```
CLOSED → OPEN: при >K подряд failure (или >K% за окно)
OPEN → HALF-OPEN: после cooldown period (например, 30 сек)
HALF-OPEN → CLOSED: K успешных probe-запросов
HALF-OPEN → OPEN: любой failure во время probe
```

### Concurrency-Limited Circuit Breaker (CCB)

Помимо failure count, учитывает **число активных in-flight вызовов**. Если concurrency > limit (downstream медленный → много pending запросов) → переход в OPEN.

→ Защищает от медленного downstream (thread pool exhaustion).

### Adaptive Circuit Breaker

Библиотека Netflix `concurrency-limits` автоматически подстраивает лимит на основе наблюдаемой latency (AIMD, по аналогии с TCP).

### Реализации

- **Resilience4j** (Java) — современная замена Hystrix
- **Hystrix** (Netflix, deprecated в 2018)
- **Polly** (.NET)
- **Envoy** — встроенный circuit breaking (настраивается per upstream cluster)
- **Istio** — поверх Envoy
- **Linkerd** — встроено

---

## Bulkhead (углубление)

**Идея:** изолировать ресурсы по типу операции, как водонепроницаемые отсеки на корабле. Один отсек залило — остальные не пострадали.

### Thread pool isolation

```
Thread pool A (10 потоков) — DB-запросы
Thread pool B (5 потоков)  — внешние API
Thread pool C (3 потока)   — обработка картинок

→ Если внешний API тормозит (pool B исчерпан), DB-запросы (pool A) продолжают работать
```

vs **общий thread pool**: медленный внешний API забирает все потоки, DB-запросы тоже встают.

**Resilience4j Bulkhead:** `SemaphoreBulkhead` (лёгкая изоляция) или `ThreadPoolBulkhead` (полноценная).

### Connection pool isolation

У каждого downstream — свой connection pool. Не один общий на DB + внешний API + cache.

```
HikariCP pool для primary DB: 20 соединений
HikariCP pool для replica DB: 50 соединений
HTTP-клиент к внешнему API: 10 соединений
```

### Process isolation

Микросервисы по сути — bulkhead на уровне процесса. Один сервис упал — другие изолированы.

---

## Hedged Requests (Tail at Scale)

**Проблема:** высокий p99 latency из-за tail — одна медленная реплика делает медленным весь запрос.

**Идея:** через `t = p95(latency)` после отправки запроса послать **дубликат** на другую реплику. Берём первый пришедший ответ, второй отменяем.

```
T=0:    отправляем на реплику A
T=p95:  если от A ответа нет → шлём на реплику B
T=A_resp или T=B_resp: берём первый, второй cancel'им
```

**Эффект:** средняя latency немного растёт, но **p99 / p999 падают в 5–10 раз**.

**Стоимость:** ~5% дополнительных запросов (только tail дублируется).

**Реализация:** клиент Google Bigtable, gRPC `hedging_policy`, исследовательские работы MIT и Cornell.

---

## Load Shedding

**Идея:** когда нагрузка превышает capacity → **намеренно отказывать** части запросов, чтобы остальные обрабатывались нормально.

### Статический threshold

```
Если active_requests > 1000 → reject новых запросов с 503 Service Unavailable
```

- ✓ Просто
- ✗ Threshold нужно подобрать; со временем меняется

### Adaptive (Netflix concurrency-limits)

Автоподстройка `max_concurrency` по latency:
- Latency растёт → уменьшаем limit
- Latency стабильна → увеличиваем limit

→ Лучше статики, адаптируется к реальной capacity.

### Prioritization

Не вся нагрузка одинакова. Сначала отбрасывать низкоприоритетную:
- Дропать некритичную аналитику
- Откладывать запланированные задачи
- Сохранять обслуживание платных пользователей, дропать free
- Держать `/login` работающим, когда `/recommendations` дропается

### Реализация

- **Envoy** — global rate limit с tagging
- **Application-level** — middleware-проверка на каждом запросе
- **Kubernetes** — Pod admission webhook + QoS-классы

---

## Adaptive Concurrency

Автоматическая подстройка числа одновременных запросов, которое downstream выдерживает.

Библиотека Netflix `concurrency-limits` использует **AIMD** (Additive Increase, Multiplicative Decrease, как в TCP):
- Успешный ответ → limit += 1
- Спайк latency или ошибка → limit /= 2

→ Сходится в «sweet spot», где downstream работает комфортно.

```
limit = 10
Каждый success: limit += 1   (additive grow)
Каждый failure: limit /= 2   (multiplicative reduce)
Floor: limit = 1
Ceiling: limit = 1000
```

---

## Graceful Degradation

Когда downstream сломан → не падать целиком, а **работать в degraded mode**.

**Примеры:**

### Newsfeed

- Персональный feed недоступен (ML-сервис down) → fallback на popular posts (cached top-100)

### Search

- ML ranking недоступен → простой TF-IDF
- Faceted-фильтры недоступны → UI без фильтров, базовый поиск

### E-commerce

- Recommendations API down → показываем «featured»-статику
- Reviews-сервис down → скрываем секцию reviews
- Live-инвентарь недоступен → показываем «in stock» без точного количества

### Patterns

- **Stale cache** — отдаём последний известный закэшированный результат с пометкой «возможно устарело»
- **Default values** — заранее посчитанный fallback (top-10 cached)
- **Feature flag killswitch** — отключение фичи глобально без деплоя
- **Read-only mode** — блокируем writes, разрешаем reads (primary DB down, реплики живы)

---

## Dead Letter Queue (DLQ)

В асинхронных (queue-based) системах: что делать с сообщениями, которые consumer не смог обработать?

**Без DLQ:** infinite retry → блокирует очередь, либо drop → потеря данных.

**С DLQ:** после N попыток сообщение уходит в DLQ для разбора.

```
Producer → Queue → Consumer (retry 5×)
                       ↓ fail
                       DLQ
                       ↓
                   Ручной или scheduled-разбор
```

**Реализации:**
- **AWS SQS** — встроенный DLQ (redrive policy после N receives)
- **RabbitMQ** — Dead Letter Exchange
- **Kafka** — вручную: писать в отдельный топик `__failed` после исчерпания попыток

**Operational pattern:**
1. Мониторинг depth DLQ (алёрт если растёт)
2. Периодический разбор сообщений (часто: баг в consumer'е, schema change)
3. Re-drive после фикса (переложить сообщения обратно в основную очередь)

---

## Idempotency keys

См. [`distributed_systems.md`](distributed_systems.md#idempotency-key) для базы. Здесь — production-практика.

**Client-generated key:** `idempotency_key = UUID().toString()` для каждой операции.

**Server-side dedup:**

```python
def process_payment(idempotency_key, amount, account):
    with redis.lock(f"idempotency:{idempotency_key}", timeout=10):
        cached = redis.get(f"result:{idempotency_key}")
        if cached:
            return cached  # уже обработано, возвращаем кэш
        
        result = actually_charge(amount, account)
        redis.setex(f"result:{idempotency_key}", ttl=24h, value=result)
        return result
```

**TTL для idempotency keys:** обычно 24 часа (баланс между storage cost и окном retry).

**Подход Stripe:** все mutating endpoints поддерживают заголовок `Idempotency-Key`. Документированные best practices.

---

## Retry Storm Prevention (multi-layer)

Cascading retry — один из самых опасных failure-режимов. Меры предосторожности:

1. **Jitter** — первая линия защиты
2. **Retry budget** — лимит общего числа retry
3. **Circuit breaker** — перестать долбить мёртвый downstream
4. **Adaptive concurrency** — чувствовать capacity и снижать давление
5. **Bulkhead** — изоляция отказа
6. **Backpressure** — прокидывать «медленно / перегружено» вверх по цепочке

→ Defense in depth: ни одна мера не достаточна, но их совокупность закрывает большинство failure-сценариев.

---

## SLO-driven design

Reliability — не «100% uptime», а **«приемлемый error budget»** (Google SRE).

```
SLO: 99.9% availability (разрешено 43 мин downtime в месяц)
Error budget: 0.1%
Если burn rate > threshold → freeze деплоев, фокус на reliability
```

**Мониторинг:** алёрты по burn rate (multi-window) — отличаются от простых threshold-алёртов.

См. [`infrastructure/OBSERVABILITY.md`](../../infrastructure/theory/OBSERVABILITY.md#sli--slo--sla).

---

## Источники

- [«The Tail at Scale» (Dean, Barroso, 2013, ACM Comm)](https://research.google/pubs/pub40801/) — hedged requests, 1% rule
- [AWS Architecture Blog — Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Netflix concurrency-limits library](https://github.com/Netflix/concurrency-limits) — adaptive concurrency
- *Release It!* (Michael Nygard, 2nd ed., 2018) — оригинал паттернов (CB, Bulkhead, Timeout, Steady State)
- *Site Reliability Engineering* (Beyer et al., Google, 2016) — SLI/SLO, error budgets
- [Stripe — Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency)
- [Cindy Sridharan — Distributed Systems Reliability](https://medium.com/@copyconstruct)
- [Resilience4j Documentation](https://resilience4j.readme.io/)
