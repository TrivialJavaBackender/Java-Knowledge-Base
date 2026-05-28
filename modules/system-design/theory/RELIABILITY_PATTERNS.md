# Шаблоны надёжности

Шаблоны устойчивости к сбоям: повторы, экспоненциальная задержка, circuit breaker, bulkhead, дублирующие запросы (hedged requests), сброс нагрузки, плавная деградация. Каждый — про **управление сценариями сбоев**, а не их предотвращение.

> **Область:** шаблоны. Базовое описание Circuit Breaker и Bulkhead — в [`microservice_patterns.md`](microservice_patterns.md), здесь — углубление и связанные подходы. Chaos engineering — в [`software-engineering/TESTING.md`](../../software-engineering/theory/TESTING.md).

---

## Повторы с экспоненциальной задержкой и разбросом

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

### Jitter — обязателен

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
- **Non-idempotent операции** без idempotency key — повторное списание при повторе
- **Слишком долгие попытки** — после ~5 попыток смысла продолжать почти нет, лучше вернуть ошибку
- **Cascade prevention** — если повторов уже слишком много → downstream, видимо, сломан, нужно остановиться

### Бюджет повторов

Чтобы предотвратить retry storm на downstream:

```
У каждого сервиса retry budget = 10% от исходных запросов
Если retry превышают budget → отбрасываем retry, сразу возвращаем ошибку
```

→ Linkerd и Envoy реализуют бюджет повторов нативно.

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

Помимо числа сбоев, учитывает **число активных in-flight вызовов**. Если concurrency > limit (downstream медленный → много pending запросов) → переход в OPEN.

→ Защищает от медленного downstream (thread pool exhaustion).

### Adaptive Circuit Breaker

Библиотека Netflix `concurrency-limits` автоматически подстраивает лимит на основе наблюдаемой задержки (AIMD, по аналогии с TCP).

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

## Дублирующие запросы (hedged requests, Tail at Scale)

**Проблема:** высокая задержка p99 из-за хвоста — одна медленная реплика делает медленным весь запрос.

**Идея:** через `t = p95(latency)` после отправки запроса послать **дубликат** на другую реплику. Берём первый пришедший ответ, второй отменяем.

```
T=0:    отправляем на реплику A
T=p95:  если от A ответа нет → шлём на реплику B
T=A_resp или T=B_resp: берём первый, второй отменяем
```

**Эффект:** средняя задержка немного растёт, но **p99 / p999 падают в 5–10 раз**.

**Стоимость:** ~5% дополнительных запросов (только tail дублируется).

**Реализация:** клиент Google Bigtable, gRPC `hedging_policy`, исследовательские работы MIT и Cornell.

---

## Сброс нагрузки (load shedding)

**Идея:** когда нагрузка превышает мощность → **намеренно отказывать** части запросов, чтобы остальные обрабатывались нормально.

### Статический порог

```
Если active_requests > 1000 → reject новых запросов с 503 Service Unavailable
```

- ✓ Просто
- ✗ Порог нужно подобрать; со временем меняется

### Adaptive (Netflix concurrency-limits)

Автоподстройка `max_concurrency` по задержке:
- Задержка растёт → уменьшаем limit
- Задержка стабильна → увеличиваем limit

→ Лучше статики, адаптируется к реальной мощности.

### Приоритизация

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

## Адаптивная конкурентность

Автоматическая подстройка числа одновременных запросов, которое downstream выдерживает.

Библиотека Netflix `concurrency-limits` использует **AIMD** (Additive Increase, Multiplicative Decrease, как в TCP):
- Успешный ответ → limit += 1
- Всплеск задержки или ошибка → limit /= 2

→ Сходится в «sweet spot», где downstream работает комфортно.

```
limit = 10
Каждый success: limit += 1   (additive grow)
Каждый failure: limit /= 2   (multiplicative reduce)
Floor: limit = 1
Ceiling: limit = 1000
```

---

## Плавная деградация

Когда downstream сломан → не падать целиком, а **работать в режиме деградации**.

**Примеры:**

### Newsfeed

- Персональный feed недоступен (ML-сервис down) → запасной вариант: популярные записи (закэшированный top-100)

### Search

- ML ranking недоступен → простой TF-IDF
- Faceted-фильтры недоступны → UI без фильтров, базовый поиск

### E-commerce

- Recommendations API down → показываем «featured»-статику
- Reviews-сервис down → скрываем секцию reviews
- Live-инвентарь недоступен → показываем «in stock» без точного количества

### Шаблоны

- **Устаревший кэш** — отдаём последний известный закэшированный результат с пометкой «возможно устарело»
- **Значения по умолчанию** — заранее посчитанный запасной вариант (top-10 закэшированных)
- **Feature flag killswitch** — отключение фичи глобально без деплоя
- **Режим только для чтения** — блокируем записи, разрешаем чтения (primary DB down, реплики живы)

---

## Очередь недоставленных сообщений (DLQ)

В асинхронных (queue-based) системах: что делать с сообщениями, которые consumer не смог обработать?

**Без DLQ:** бесконечные повторы → блокирует очередь, либо сброс → потеря данных.

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

**Эксплуатационный шаблон:**
1. Мониторинг глубины DLQ (алерт если растёт)
2. Периодический разбор сообщений (часто: баг в потребителе, изменение схемы)
3. Re-drive после фикса (переложить сообщения обратно в основную очередь)

---

## Ключи идемпотентности

Клиент генерирует уникальный ключ (UUIDv4/v7) и передаёт с каждым мутирующим запросом. Сервер запоминает `(key → result)` и при повторном обращении возвращает сохранённый ответ, не выполняя операцию повторно.

### Область ключа (scope)

Ключ **не глобальный** — lookup всегда составной: `(user_id, idempotency_key)`. Это исключает межпользовательские коллизии: даже одинаковые UUID у разных клиентов попадают в разные пространства.

### Валидация запроса (request fingerprint)

При совпадении ключа сервер сравнивает хеш тела запроса (или значимых полей: сумма, получатель, валюта) с сохранённым:

- **Совпал** — настоящий retry → возвращаем закешированный ответ
- **Не совпал** — коллизия или ошибка клиента → **409 Conflict** (`idempotency key already used for a different request`)

Stripe возвращает 400 с кодом `idempotency_key_in_use` в этом случае.

### Хранение: БД vs Redis vs гибрид

**Redis-only:**

```
SET idempotency:{user_id}:{key} {response_json} NX EX 86400
```

- Быстрый lookup, TTL встроен
- **Проблема:** Redis не даёт ACID-гарантий. При падении Redis записи теряются → retry выполнит операцию повторно. Для некритичных операций (лайки, уведомления) — допустимо. Для платежей — нет

**БД-only (в той же транзакции):**

```sql
CREATE TABLE idempotency_keys (
    user_id     BIGINT       NOT NULL,
    key         VARCHAR(64)  NOT NULL,
    request_hash BYTEA,
    status      VARCHAR(16)  DEFAULT 'started',  -- started → completed / failed
    response_code INT,
    response_body JSONB,
    created_at  TIMESTAMPTZ  DEFAULT now(),
    expires_at  TIMESTAMPTZ  DEFAULT now() + INTERVAL '24 hours',
    PRIMARY KEY (user_id, key)
);
```

Ключевое свойство: `INSERT INTO idempotency_keys` и бизнес-операция — **в одной транзакции**. Атомарность гарантирована средствами БД: либо обе записались, либо ни одна. При crash-recovery невозможна ситуация «операция выполнилась, а ключ потерялся».

```python
def process_payment(user_id, idempotency_key, request):
    request_hash = sha256(canonical(request))
    with db.transaction():
        existing = db.query(
            "SELECT * FROM idempotency_keys WHERE user_id=%s AND key=%s",
            user_id, idempotency_key
        )
        if existing:
            if existing.request_hash != request_hash:
                raise Conflict("idempotency key reused for different request")
            if existing.status == 'started':
                raise Conflict("request is being processed, retry later")
            return existing.response_code, existing.response_body

        db.execute(
            "INSERT INTO idempotency_keys (user_id, key, request_hash, status) "
            "VALUES (%s, %s, %s, 'started')",
            user_id, idempotency_key, request_hash
        )
        result = execute_business_logic(request)
        db.execute(
            "UPDATE idempotency_keys SET status='completed', "
            "response_code=%s, response_body=%s WHERE user_id=%s AND key=%s",
            result.code, result.body, user_id, idempotency_key
        )
    return result
```

**Гибрид (Redis + БД) — подход Stripe:**

```
Redis: быстрый кэш (SET NX EX) для hot-path → экономит поход в БД на 99% retry
БД:    source of truth, запись атомарно с бизнес-транзакцией
```

Поток:
1. Проверить Redis → есть ответ → вернуть
2. Redis miss → проверить БД → есть → вернуть (и прогреть Redis)
3. БД miss → выполнить операцию, записать в БД (транзакционно), потом SET в Redis
4. Если Redis недоступен → работаем через БД (медленнее, но корректно)

### Что если Redis упал во время retry

При **Redis-only** схеме — ключ потерян, retry выполнит операцию повторно. Для платежей это двойное списание.

При **гибриде** — Redis это только кэш. Fallback на БД:

```
Retry приходит → Redis down → идём в БД → ключ есть → возвращаем кэшированный ответ
```

Корректность не страдает, только latency растёт (10–50 мс вместо 1 мс).

**Вывод:** для финансовых операций source of truth для ключей идемпотентности — **всегда БД**, а не Redis. Redis — ускорение, не гарантия.

### TTL и очистка

TTL определяет, как долго ключ «жив». После истечения ключ удаляется, и повторный запрос с тем же ключом выполнит операцию заново. Это **ожидаемое поведение**: через 24–72 часа retry с тем же ключом — скорее новая попытка, а не retry сбоя.

**TTL — это про очистку, а не про проверку при каждом запросе.** Lookup идёт по составному ключу `(user_id, key)`. Если ключ найден и не истёк — возвращаем кэш. Если не найден (никогда не было или уже вычищен) — новая операция. Фильтровать по `created_at` при каждом запросе не нужно.

Реализация очистки:

| Хранилище | Механизм TTL |
|-----------|--------------|
| Redis | `EX 86400` — автоматически, встроено |
| PostgreSQL | `expires_at` + pg_cron: `DELETE FROM idempotency_keys WHERE expires_at < now()` |
| PostgreSQL (высокая нагрузка) | партиционирование по дню: `DROP` устаревших партиций целиком — O(1) вместо поштучного DELETE |

### Отдельная таблица или вместе с данными

**Отдельная таблица (рекомендуемый подход):**
- Чистое разделение ответственности — idempotency не загрязняет бизнес-схему
- Единая таблица для всех эндпоинтов
- Простая очистка (партиционирование, cron)
- Легко добавлять метаданные (`request_hash`, `status`, `response_body`)

**Колонка в бизнес-таблице** (e.g., `payments.idempotency_key UNIQUE`):
- Плюс: `UNIQUE`-constraint даёт атомарную защиту «бесплатно»
- Минус: связывает idempotency с конкретной сущностью; у каждого эндпоинта своя таблица; нет единообразной очистки; `NULL`-ы для записей без ключа

На практике большинство систем (Stripe, Adyen) используют **отдельную таблицу** + запись в ней в той же транзакции, что и бизнес-операция.

### Конкурентные retry (in-flight дедупликация)

Два retry прилетают одновременно, пока первый запрос ещё обрабатывается:

```
Retry A → INSERT idempotency_keys ... status='started' → OK → обрабатываем
Retry B → INSERT idempotency_keys ... → CONFLICT (PK) → читаем status='started'
       → знаем, что кто-то уже обрабатывает → 409 / Retry-After: 2
```

В Redis: `SET ... NX` (set-if-not-exists) даёт ту же семантику. Кто первый — тот обрабатывает, остальные ждут или получают 409.

### Итого: уровни защиты от коллизий

| Уровень | Что предотвращает |
|---------|-------------------|
| Scope `(user_id, key)` | Межпользовательские коллизии |
| Request fingerprint (SHA-256 тела) | Внутрипользовательские коллизии и баги клиента |
| UUIDv4/v7 (122 бита энтропии) | Случайные коллизии (вероятность ~10⁻¹⁸) |
| TTL + очистка | Рост хранилища, расширение окна коллизий |
| In-flight дедупликация (`status`) | Гонка параллельных retry |

### Источники

- [Stripe — Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency) — эталонный подход с описанием ACID-phases
- [Brandur Leach — Implementing Stripe-like idempotency keys in Postgres](https://brandur.org/idempotency-keys) — глубокий разбор реализации с рисками Redis-only

---

## Защита от шторма повторов (на нескольких уровнях)

Каскадные повторы — один из самых опасных режимов сбоя. Меры предосторожности:

1. **Jitter** — первая линия защиты
2. **Бюджет повторов** — лимит общего числа повторов
3. **Circuit breaker** — перестать долбить мёртвый downstream
4. **Adaptive concurrency** — чувствовать мощность и снижать давление
5. **Bulkhead** — изоляция отказа
6. **Обратное давление (backpressure)** — прокидывать «медленно / перегружено» вверх по цепочке

→ Глубокая защита: ни одна мера не достаточна, но их совокупность закрывает большинство сценариев сбоя.

---

## Проектирование на основе SLO

Reliability — не «100% uptime», а **«приемлемый error budget»** (Google SRE).

```
SLO: 99.9% availability (разрешено 43 мин downtime в месяц)
Error budget: 0.1%
Если burn rate > threshold → freeze деплоев, фокус на reliability
```

**Мониторинг:** алерты по burn rate (multi-window) — отличаются от простых алертов по порогу.

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
