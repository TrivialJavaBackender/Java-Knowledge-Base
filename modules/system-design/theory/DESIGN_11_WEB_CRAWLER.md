# Design Problem: Web Crawler

Периодически качает веб-страницы для индексации (search engine), мониторинга (price tracking), архивации (Wayback Machine). Главные challenges: масштаб, politeness (не «дудосить» сайты), дедупликация, извлечение контента.

---

## 1. Requirements

### Functional
- Старт с seed URLs
- Crawl страниц, извлечение текста + исходящих ссылок
- Переход по ссылкам (BFS / DFS)
- Периодический re-crawl (свежесть)
- Уважать robots.txt
- Хранить скачанный контент для дальнейшей обработки

### Non-functional
- **Politeness** — не перегружать target-серверы (rate-limit per domain)
- **Масштаб** — миллиарды страниц
- **Свежесть** — популярные страницы переcrawl'иваются за дни
- **Robust** — обработка ошибок, динамический контент, redirects

---

## 2. Estimation

```
Web: ~50B уникальных страниц (грубо)
Re-crawl: top 1B ежедневно, остальные раз в неделю/месяц
  → ~10K–100K скачиваний в секунду в среднем

Storage на страницу (HTML + извлечённый текст):
  В среднем 100 КБ raw, 20 КБ extracted
  10B страниц × 100 КБ = 1 ПБ raw + 200 ТБ extracted

Bandwidth: 10K req/sec × 100 КБ = 1 ГБ/сек ingress
```

---

## 3. Архитектура

```
Seed URLs →
URL Frontier (priority queue per domain)
  ↓
URL Selector (политика, robots.txt) →
DNS Resolver (cached) →
HTTP Fetcher (пул crawler'ов, async I/O)
  ↓
Response →
Content Parser (извлечение текста + ссылок)
  ↓
  ├── Новые URL → URL Frontier (обратно в очередь)
  ├── Извлечённый контент → Content Store (S3 / HDFS)
  ├── Dedup-проверка → Bloom Filter / Content Hash DB
  └── Metadata DB (PostgreSQL / Cassandra)

Дальше:
  - Indexer → Inverted Index (Elasticsearch)
  - Аналитика
```

---

## 4. URL Frontier

Priority queue для предстоящих URL.

### Politeness — главное ограничение

Не более 1–2 соединений / запросов на домен в секунду.

```
Frontier:
  Per-domain queue: URL example.com все в одной подочереди
  Politeness-планировщик: максимум N одновременных crawler'ов на домен
  Между доменами: параллельно
```

Реализация:
- Redis sorted set на домен: `domain:example.com` со score=enqueue_time
- N crawler-worker'ов, каждый берёт URL из разных доменов (round-robin)
- Sleep / задержки по политике (например, минимум 1 сек между запросами к одному домену)

### Приоритеты

Не все URL равны:
- Популярные сайты — высокий приоритет (refresh чаще)
- Новые обнаруженные URL — средний
- Длинный хвост / низкий PR — низкий

Многоуровневая priority queue: тиры по приоритетам. Верхние тиры crawl'им чаще.

### Dedup очереди

URL уже crawl'ился / в очереди? Bloom Filter (быстрая проверка «вероятно да») + DB lookup для подтверждения.

```python
if not bloom.contains(url):
    bloom.add(url)
    enqueue(url)
elif not db.exists(url):  # проверка bloom false positive
    bloom.add(url)
    enqueue(url)
# иначе: пропускаем дубль
```

---

## 5. DNS Resolver

DNS на каждый URL добавляет latency. Кэшируем:

```
DNS-кэш:
  domain → (ip, ttl)
  Hit: пропускаем DNS-запрос
  Miss: резолвим, кэшируем на TTL

Локальный DNS-сервер (bind, unbound) делает рекурсию + кэширование.
```

Без кэша: каждый crawl = DNS-запрос = 10–100 мс overhead.

---

## 6. HTTP Fetcher

Async I/O (Java NIO, Go goroutines, Python asyncio) для массовой concurrency на одной машине.

```python
# Псевдо-асинхронно
async def crawl(url):
    response = await http.get(url, timeout=10, follow_redirects=True)
    if response.status == 200:
        return response.text
    elif response.status in (301, 302):
        new_url = response.headers['Location']
        return await crawl(new_url)
    elif response.status == 429:  # Rate limited
        sleep_and_retry(url)
    elif response.status >= 500:
        retry_with_backoff(url)
    else:
        log_failure(url, response.status)
```

**Connection pool** — переиспользуем TCP/TLS-соединения.

**Per-host concurrency limit** — максимум 5 соединений на host.

---

## 7. Robots.txt

Сайт может задать правила для crawler'ов:

```
example.com/robots.txt:
User-agent: *
Disallow: /admin/
Disallow: /private/
Crawl-delay: 10
```

```python
robots = fetch(f"{domain}/robots.txt")
for url in domain_urls:
    if not robots.allowed(crawler_user_agent, url.path):
        skip(url)
    sleep(robots.crawl_delay or 1)
```

Кэшируем robots.txt на домен (TTL 24 часа).

---

## 8. Извлечение контента

### Парсинг HTML

Извлекаем:
- Title, meta-теги
- Body-текст (без HTML)
- Исходящие ссылки (`<a href>`)
- Canonical URL (`<link rel="canonical">`)

Библиотеки: BeautifulSoup, jsoup (Java), readability.js.

### Определение языка

Для мультиязычной индексации — детект языка (cld3, langdetect).

### Поиск дубликатов

Один и тот же контент на разных URL:
- Content hash (SHA-256) — точное совпадение
- SimHash / MinHash — near-duplicate detection (небольшие отличия)

```
content_hash = SHA256(extracted_text)
если есть в Bloom + DB → помечаем как дубль canonical URL
иначе → сохраняем
```

### Извлечение структурированных данных

- JSON-LD, microdata, Open Graph
- Данные о товарах, цены, отзывы (семантика)

---

## 9. Хранилище

### Сырой HTML

S3 / HDFS, партиционирование по дате/домену.

```
s3://crawler-raw/2024/01/15/example.com/<url-hash>.html.gz
```

Сжатие gzip — текст ужимается в 5–10 раз.

### Извлечённый текст

Меньше, запрашивается чаще. Cassandra или Parquet на S3.

### Metadata

PostgreSQL — URL, status, crawl_at, content_hash, refs.

```sql
CREATE TABLE pages (
    url TEXT PRIMARY KEY,
    domain TEXT,
    last_crawled_at TIMESTAMPTZ,
    status INT,
    content_hash CHAR(64),
    raw_storage_path TEXT
);
CREATE INDEX idx_domain ON pages(domain);
CREATE INDEX idx_last_crawled ON pages(last_crawled_at);
```

---

## 10. Стратегия re-crawl

URL переcrawl'иваются с разной частотой на основе:
- **Частоты обновлений** (новостной сайт — ежечасно vs статический блог — раз в месяц)
- **PageRank / важности** — популярные страницы чаще
- **Last-modified header** — подсказка сайта

```
re_crawl_interval = base_interval × importance_factor × update_frequency_factor

Top 1M страниц → ежедневно
Следующие 100M → еженедельно
Остальные → ежемесячно
```

Планирование: каждая crawl'нутая страница ставится обратно в очередь с future timestamp.

---

## 11. Distributed crawlers

Одна машина — 10K–100K req/sec максимум (упирается в сеть). Для 1B+ страниц в день — несколько машин.

### Стратегия шардирования

Партиционирование по **хэшу домена** — все URL одного домена обрабатываются одним worker'ом (сохраняем politeness).

```
crawler_id = hash(domain) % N_crawlers
```

Сам URL Frontier тоже распределён — Redis Cluster шардирует по домену.

### Координация

- Новые URL найдены crawler'ом A → публикация в очередь (Kafka)
- Другие crawler'ы читают свои партиции

---

## 12. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| Crawler упал | URL остались в очереди, другой worker подхватывает |
| Сайт отвечает 503 | Backoff, retry позже (не долбим) |
| Бесконечный цикл (календарь-spider trap) | Лимит глубины на домен, дедупликация URL |
| Битые SSL-сертификаты | Skip или принимаем по политике |
| Медленный сайт | Timeout (10 сек), retry с backoff |
| Robots.txt недоступен | Default = «всё разрешено»? Или «default deny»? (выбор политики) |

---

## 13. Antipatterns / anti-detection

Часть сайтов активно блокирует crawler'ов:
- **Идентификация User-Agent** — представляться (Googlebot/2.1; и т. д.)
- **Rate limiting** — уважать 429
- **JavaScript rendering** — современные SPA требуют headless-браузер (Puppeteer, Playwright)
- **CAPTCHA** — обычно такие страницы пропускаем
- **Honeypot-ссылки** — скрытые ссылки, переход по которым → пометка «бот»

---

## 14. Trade-offs

### BFS vs DFS

- **BFS** (по умолчанию) — обходит по расстоянию от seed, сбалансированно
- **DFS** — глубоко в одну ветку, может застрять на большом сайте

Большинство crawler'ов — BFS-подобные (priority queue перетягивает порядок).

### Politeness vs throughput

Строгая politeness (1 req/sec/domain) — медленно на множестве маленьких сайтов, узкое место на больших.
Агрессивный crawler — риск IP-банов, вред сайтам.

Тюнить per domain по response time и `Crawl-delay`.

### Real-time vs batch

Search-движки: real-time (непрерывно).
Архивы (Wayback): batch (полный crawl периодически).

---

## 15. Real-world

- **Googlebot** — самый продвинутый crawler, миллиарды страниц проиндексированы
- **Bingbot, Yandex, Baidu** — аналогично
- **Internet Archive (Wayback Machine)** — архивный
- **Common Crawl** — открытые crawl-дампы ежемесячно, бесплатный датасет

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 9 «Design a Web Crawler»
- [donnemartin/system-design-primer — Web Crawler](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/web_crawler/README.md)
- [Common Crawl Documentation](https://commoncrawl.org/the-data/)
- [Apache Nutch Documentation](https://nutch.apache.org/) — open-source crawler
- [Heritrix (Internet Archive crawler)](https://github.com/internetarchive/heritrix3)
- *Web Crawler / Search Engine* (исторические работы Bing/Yahoo)
