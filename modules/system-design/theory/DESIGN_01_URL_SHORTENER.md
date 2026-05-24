# Design Problem: URL Shortener (TinyURL / bit.ly)

Сервис принимает длинный URL → возвращает короткий (`bit.ly/abc123`). Клик по короткому → redirect на длинный. Классическая «easy» SD-задача — фокус на ID generation, latency редиректа и аналитике.

---

## 1. Requirements

### Functional
- POST длинного URL → короткий URL (`bit.ly/<6-символьный код>`)
- GET по короткому URL → 301/302 redirect на длинный
- (Опционально) Custom alias (`bit.ly/my-link`)
- (Опционально) Expiration (TTL)
- (Опционально) Аналитика кликов

### Non-functional
- **Read-heavy** (типично 10:1 read/write)
- **Низкая latency редиректа** — p99 < 100 мс
- **High availability** — 99.99% (битый redirect никто не повторит)
- **Непредсказуемый код** — нельзя угадать `abc124`, зная `abc123` (нужен random или hash, не sequential)
- **Уникальность** — каждый длинный URL → один короткий (или допустить дубли — обсудить с интервьюером)

---

## 2. Estimation

```
100M URL создаётся в год, 10:1 read/write

Writes:  100M / год / 31.5M сек = ~3 writes/sec в среднем
         Пик: 30 writes/sec
Reads:   1B reads / год / 31.5M = ~30 reads/sec в среднем
         Пик: 300 reads/sec
→ QPS тривиальный, хватит и одного сервера

Storage: на URL ~500 байт (long_url + short_code + metadata)
         10 лет × 100M × 500 байт = 500 ГБ → влезет в один PostgreSQL

Cache: hot 20% URL × 500 байт = 10 ГБ working set → один Redis-узел

Пространство ID: base62 (a-zA-Z0-9) на 6 символов = 62^6 = 56B URL (хватит на годы)
                7 символов = 3.5T (на «вечность»)
```

---

## 3. API

```http
POST /api/v1/shorten
Body: { url: "https://example.com/very/long/path", expiresIn?: 86400 }
→ 201 { shortCode: "abc123", shortUrl: "https://bit.ly/abc123" }

GET /:shortCode
→ 301 Location: <long_url>
   (или 302 если нужна аналитика — 301 кэшируется браузером, повторный GET до сервера не дойдёт)

GET /api/v1/links/:shortCode/stats
→ { clicks: 12345, byCountry: {...}, byHour: {...} }
```

---

## 4. High-level архитектура

```
Client → CDN (опционально кэширует hot редиректы) →
       → LB → API-серверы →
                ├ Cache (Redis) — code → long_url
                ├ ID generator service
                └ DB (PostgreSQL, шардирована по short_code) — durable-хранилище

       → Аналитика: async (Kafka → batch-обработка)
```

---

## 5. ID generation — главное архитектурное решение

### Вариант A: sequential ID + base62

DB autoincrement → integer → base62-кодирование.

```
id=1 → "1"
id=62 → "10"
id=1000000 → "4c92"
```

- ✓ Просто, монотонно
- ✗ **Sequential предсказуем** — скрейпер может пройти `abc1`, `abc2`, …
- ✗ Единая точка (DB autoincrement) — bottleneck на масштабе

### Вариант B: случайные 6 символов

```python
import secrets
shortCode = secrets.token_urlsafe(4)[:6]  # base64 → 6 символов
```

- ✓ Непредсказуемо
- ✗ **Коллизии** — birthday paradox: 62^6 = 56B; при 10M существующих URL ~1 на 5.6M shortened → изредка коллизия → retry
- Митигация: `INSERT ... ON CONFLICT DO NOTHING`, retry при конфликте

### Вариант C: hash от длинного URL

`shortCode = base62(MD5(long_url))[:6]`

- ✓ Бесплатная дедупликация (один и тот же URL → один и тот же short)
- ✗ Коллизии всё равно возможны; их нужно обрабатывать
- ✗ Пользователь не может иметь несколько short'ов для одного long URL (часто нужно для аналитики)

### Вариант D: Key Generation Service (KGS)

Заранее сгенерировать батч уникальных кодов и хранить в БД. Приложение берёт из пула.

```
KGS pool: 1M предгенерированных неиспользованных кодов
App: GET /kgs/next-code → "abc123" (помечается use'd)
```

- ✓ Нет коллизий в runtime
- ✓ Непредсказуемо
- ✓ Масштабируется: несколько KGS-инстансов, у каждого свой диапазон
- ✗ Дополнительный сервис в эксплуатации

### Вариант E: ID в стиле Snowflake

64-битный ID = `timestamp (41 бит) | machine_id (10 бит) | sequence (12 бит)`. Кодируется в base62.

- ✓ Распределённо, без центрального координатора
- ✓ Сортируется по времени
- ✗ Предсказуемо (внутри лежит timestamp)

**Рекомендация:** KGS для production; random 6–7 символов с retry — для меньших масштабов.

---

## 6. Data model

```sql
CREATE TABLE urls (
    short_code   VARCHAR(8) PRIMARY KEY,
    long_url     TEXT NOT NULL,
    user_id      BIGINT,
    created_at   TIMESTAMPTZ DEFAULT now(),
    expires_at   TIMESTAMPTZ,
    click_count  BIGINT DEFAULT 0  -- денормализовано; или отдельная analytics-таблица
);

CREATE INDEX idx_expires ON urls(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_user ON urls(user_id);
```

**Шардирование:** по хэшу `short_code`. Поскольку чтение и запись — по ключу (short_code), шардирование тривиально.

---

## 7. Redirect path — критичный путь

Hot path: `GET /:shortCode → redirect`. Latency budget < 100 мс.

```
1. Приложение принимает запрос
2. Чтение Redis-кэша (1 мс): hit → 301
3. Miss → запрос в БД (1–5 мс): кладём в кэш, → 301
4. Async: пишем событие аналитики в Kafka
5. Возвращаем 301 с заголовком Location
```

**Cache strategy:**
- LRU-кэш, TTL = 1 час (или дольше для иммутабельных кодов)
- Hot set (20%) → hit ratio 95%+
- Защита от cache stampede: single-flight при cache miss

**CDN-нюанс:** можно кэшировать сами `301`-ответы на edge для viral-ссылок. Trade-off: устаревшие ссылки при обновлении/удалении; обычно ok, потому что короткие коды иммутабельны.

---

## 8. Аналитика

```
На клик: эмитим событие в Kafka topic
  { shortCode, timestamp, ip, userAgent, referer, country }

Async consumer:
  Batch-обработка раз в минуту → агрегаты по (shortCode, hour, country)
  Хранение в analytics DB (ClickHouse, BigQuery) — колоночная для агрегаций
```

Денормализованный счётчик в `urls.click_count` обновляется eventually consistent (раз в N секунд).

---

## 9. Scale considerations

### ×10 (1B URL, 10K read QPS)

- Больше кэш-узлов (Redis Cluster)
- Шардирование БД по `short_code`
- Несколько analytics-consumer'ов

### ×100 (100B URL)

- Гео-реплицированная БД (multi-region)
- Edge-кэш для viral-ссылок (CDN)

### Hot-ссылка / celebrity content

«bit.ly/xyz» виралится → 1M req/sec на один shortCode.

- CDN absorb'ит большую часть
- Реплицировать hot keys на несколько кэш-узлов
- Rate-limit per user (но сам redirect должен работать для всех — лимит ставится только на создание / abuse)

---

## 10. Trade-offs

### 301 vs 302

- **301 Permanent Redirect** — кэшируется браузером, меньше нагрузки на сервер, **аналитика теряется на повторных визитах**
- **302 Temporary Redirect** — каждый визит долетает до нас, **аналитика полная**

Выбрать 302, если аналитика важна (дефолт bit.ly); 301 — если это просто redirect-as-service.

### Custom alias

```
POST /api/v1/shorten
Body: { url: "...", alias: "my-link" }
→ "bit.ly/my-link"

Если alias занят → 409 Conflict
```

В БД — UNIQUE-ограничение на `alias`. Либо предварительная проверка, либо опираться на ошибку insert.

### Expiration / soft delete

Колонка `expires_at`; batch-задача для cleanup. Либо флаг `is_active` (полное удаление редко делают).

---

## 11. Anti-abuse

- **Rate limit на создание** — 100 URL в час на IP
- **Валидация URL** — отвергать malformed, внутренние IP (SSRF), известные плохие домены (phishing list)
- **Spam-ссылки** — периодическая перепроверка destination, блок redirect, если URL стал вредоносным

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 8 «Design a URL Shortener»
- [Hello Interview — URL Shortener](https://www.hellointerview.com/learn/system-design/problem-breakdowns/url-shortener)
- [bit.ly Architecture Blog (legacy)](https://word.bitly.com/post/8662250532/dablooms-an-open-source-scalable-counting-bloom-filter)
