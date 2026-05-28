# System Design Interview — методология

Структурированный подход к SD-собеседованию. Время — обычно 45–60 минут. Цель — продемонстрировать системное мышление, не «правильный ответ» (его не существует).

---

## Алгоритм (45-минутный таймсчёт)

```
0-5 мин:    Clarify requirements (functional + non-functional)
5-10 мин:   Back-of-envelope estimation
10-15 мин:  API design (REST/gRPC endpoints)
15-25 мин:  High-level architecture (boxes + arrows)
25-40 мин:  Deep dive (2-3 интересных компонента, по запросу интервьюера)
40-45 мин:  Bottlenecks + scaling + trade-offs обсуждение
```

**Главные правила:**
1. **Думай вслух** — собеседующий оценивает мышление, не молчание
2. **Спрашивай прежде чем строить** — дизайн зависит от требований
3. **Компромисс, не «правильное решение»** — обосновывай выбор
4. **Простое сначала** — не лезь в multi-region если single region хватает

---

## Фаза 1 — уточнение требований

**Цель:** ограничить охват, разобраться, что строим.

### Функциональные требования

Что система **делает**? Какие эндпоинты / сценарии использования?

Примеры вопросов:
- «Дизайним Twitter — пользователь постит tweet и читает feed?»
- «Нужны DM (личные сообщения)?»
- «Поиск по tweets?»
- «Edit / delete tweet?»
- «Media (фото/видео) или только текст?»

**Сократить охват** — выбрать 3–5 ключевых функций, остальное явно вынести за рамки. Интервьюер часто хочет, чтобы ты сосредоточился, а не охватывал всё сразу.

### Нефункциональные требования

Как система должна работать?

- **Масштаб** — DAU, total users, размер dataset
- **Задержка** — какие p99 ожидания по эндпоинтам? (10ms / 100ms / 1s — разные архитектуры)
- **Доступность** — 99.9% (8h downtime / year) vs 99.99% (52 min) vs 99.999% (5 min)
- **Согласованность** — строгая vs итоговая? Где какая допустима?
- **Долговечность** — потеря данных допустима? (logs vs financial transactions)
- **Соотношение чтений/записей** — read-heavy vs write-heavy?
- **Паттерны чтения** — random access? Range queries? Aggregations?
- **География** — single region? Global? Data residency требования?
- **Стоимость** — есть бюджетные ограничения? (обычно не критично на интервью)

### За рамками (явно сказать)

«Я не буду фокусироваться на: детальный UI, детали обработки платежей, ML рекомендации, полный аудит безопасности» — освобождает время на архитектурные вопросы.

---

## Фаза 2 — прикидочная оценка

5 минут. Применяй [CAPACITY_ESTIMATION.md](CAPACITY_ESTIMATION.md) шаблон.

```
DAU × actions/day = total daily ops
QPS = total / 86400, peak = 2-3×
Storage = records × size × retention × replication
Bandwidth = QPS × payload size
RAM (cache) = hot_set × per_record_size
```

**Зачем нужно:** результат оценки определяет архитектуру.
- 100 QPS → один сервер вполне.
- 10K QPS → несколько инстансов, LB.
- 1M QPS → шардирование, распределённый кэш.
- 100M QPS → multi-region, граничные вычисления.

Конкретные числа — это **ваши входные данные** для дизайна. Не пропускайте.

---

## Фаза 3 — дизайн API

Определи 5-10 ключевых эндпоинтов:

```
POST /api/v1/tweets
  body: { text, media_url?, reply_to?, quote_of? }
  → 201 Created { tweet_id, created_at }

GET /api/v1/tweets/:id
  → 200 { id, text, author, created_at, like_count, ... }

GET /api/v1/users/:id/feed
  query: { cursor?, limit? = 50 }
  → 200 { tweets: [...], next_cursor }

POST /api/v1/tweets/:id/like
  → 204 No Content

DELETE /api/v1/tweets/:id
  → 204 No Content
```

**Подрешения:**
- **REST vs gRPC vs GraphQL** — public API → REST (кэшируемый, простой); internal microservice → gRPC; client-driven → GraphQL
- **Пагинация** — cursor-based (lexicographic) для потоков; offset-based — антипаттерн при масштабировании (медленный OFFSET в БД)
- **Аутентификация** — JWT (Bearer token), API key для server-to-server
- **Версионирование** — `/v1/` в path, или Accept header

---

## Фаза 4 — высокоуровневая архитектура

15-25 мин. Рисуй boxes + arrows. Стандартные компоненты:

```
[Mobile/Web] → [CDN (static)]
            → [DNS]
            → [Load Balancer (L7)]
              ↓
            [API Gateway / Edge service]
              ↓ ↓ ↓
            [Service A] [Service B] [Service C]
              ↓             ↓             ↓
            [Cache (Redis)]
              ↓             ↓             ↓
            [DB (sharded)] [DB] [Message Queue (Kafka)]
                                  ↓
                                [Worker pool] → [Email/Push]
```

**Что обсудить:**
1. **Без состояния** — сервисы без состояния, состояние в БД/Redis
2. **Модель данных** — какие таблицы, какие индексы, стратегия шардирования
3. **Стратегия кэширования** — что кэшируем, на каком уровне, TTL
4. **Async vs Sync** — что в цикле ответа на запрос, что в очередь
5. **Сценарии сбоев** — что если DB down? Cache down? LB down?

---

## Фаза 5 — глубокое погружение

Интервьюер выберет 2-3 темы для углубления. Готов к любой:

### Детальный разбор модели данных

- Конкретные таблицы / схемы
- Первичные / вторичные индексы
- Sharding key — обоснование
- Требования к согласованности

### Детальный разбор кэша

- Паттерн кэширования (cache-aside / read-through)
- Вытеснение (LRU / LFU / W-TinyLFU)
- Стратегия TTL, refresh-ahead
- Защита от захлёста кэша (single-flight)
- Проблема горячего ключа

### Веерное распределение (fan-out): лента новостей, уведомления

- Веерное распределение при записи vs при чтении
- Проблема «звезды» (celebrity problem)
- Push vs pull
- Материализованная лента

### Детальный разбор хранилища

- LSM vs B-tree выбор
- Фактор репликации, уровень согласованности
- Стратегия резервного копирования и восстановления

### Поиск / индексирование

- Inverted index
- Trie для автодополнения
- Синхронизация поискового движка (Elasticsearch) через CDC

### Ограничение частоты запросов (rate limiting)

- Token bucket / leaky bucket / sliding window
- Распределённое (Redis + Lua)
- Для пользователя / для API-ключа / глобальное

### Обработка сбоев

- Семантика circuit breaker
- Повторные попытки с jitter
- Очередь недоставленных сообщений (DLQ)
- Плавная деградация

---

## Фаза 6 — узкие места и масштабирование

«Если завтра 10× пользователей — что сломается?»

Проанализируй каждый компонент:

| Компонент | Узкое место | Способ защиты |
|-----------|-----------|------------|
| LB | Пропускная способность NIC | Anycast IP, multi-LB |
| App servers | CPU | Auto-scaling, больше реплик |
| DB primary writes | IOPS | Шардирование |
| DB reads | Connection pool | Реплики для чтения, кэширование |
| Cache | RAM, горячий ключ | Кластер, репликация для горячих ключей |
| Message broker | Партиции | Repartition, больше брокеров |
| External API | Лимит их запросов | Кэширование, батчинг |
| Network egress | Стоимость трафика | CDN |

Обсуди мониторинг:
- **Golden signals**: задержка, трафик, ошибки, насыщение (RED + S)
- **SLO**: 99.9% availability, p99 < 500ms
- **Alerting**: burn rate alerts, anomaly detection
- **Tracing**: распределённые трассы для отладки

---

## Методология компромиссов

Каждое решение — компромисс. Обсуди:

- **Согласованность vs Доступность** (CAP)
- **Согласованность vs Задержка** (PACELC — EC vs EL)
- **Задержка чтения vs Задержка записи** (денормализация, материализованные представления)
- **Стоимость хранения vs Стоимость вычислений** (компромисс кэширования)
- **Операционная простота vs Оптимальная производительность** (монолит vs микросервисы)
- **Скорость разработки vs Надёжность** (move fast vs strict review)

---

## Антипаттерны на интервью

### Переход к реализации без анализа требований

«Используем Cassandra, потому что NoSQL» — без обсуждения требований. Сначала **зачем**, потом **что**.

### Игнорирование масштаба

Рисуешь single DB вне зависимости от оценки масштаба. Если 1M QPS — single DB не справится.

### Излишнее усложнение (over-engineering)

Дизайн URL shortener на 10 микросервисов с Kafka и Spark. Простой — лучше. Простой + готовый к масштабированию — отлично.

### Мышление в масштабе одного региона

Не учитываешь географическое распределение для глобального сервиса.

### Избегание компромиссов

«Решение Х — лучшее». Покажи **почему**: сравни с альтернативой, объясни компромисс.

### Набор модных слов без смысла (buzzword soup)

«Будем использовать Kubernetes, Istio, Kafka, Spark, Flink, Cassandra, Redis» — без понимания, зачем каждое.

### Молчаливое обдумывание

Молчание 5 минут — собеседующий не знает, что ты думаешь. Думай вслух.

---

## Готовый шаблон ответа

Сохрани в голове как ментальный чанк:

```markdown
1. Understanding the problem (functional + non-functional requirements)
2. Estimating the scale (DAU, QPS, storage, bandwidth, RAM)
3. Defining the API
4. High-level design (rough architecture diagram)
5. Detailed design (data model, deep dives на запрос)
6. Identifying and resolving bottlenecks
7. Discussing trade-offs and alternatives
```

---

## Готовность к деталям (что часто спрашивают)

Помимо самой архитектуры — будь готов к **глубоким** вопросам:

- **БД**: какой индекс? как пагинация? Sharding key выбран как?
- **Кэш**: паттерны кэширования, вытеснение, TTL, захлёст кэша, горячий ключ
- **Очереди**: at-least vs exactly-once, идемпотентность потребителя, DLQ
- **Auth**: жизненный цикл JWT, refresh rotation, revocation
- **Сбои**: что если DB down? Cache lost?
- **Мониторинг**: SLI/SLO, golden signals
- **Стоимость**: где деньги тратятся, как сократить (CDN снижает исходящий трафик)

---

## Источники

- *System Design Interview Vol. 1, 2* (Alex Xu, ByteByteGo) — канонический шаблон + 30+ design problems
- [Hello Interview — Delivery (Interview Frame)](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery)
- [donnemartin/system-design-primer — How to approach](https://github.com/donnemartin/system-design-primer#how-to-approach-a-system-design-interview-question)
- *Cracking the System Design Interview* (Hewlin) — старая, но фундаменты те же
- [Reddit r/systemsdesign](https://www.reddit.com/r/systemsdesign/) — discussions реальных интервью
- [Pramp / Exponent / interviewing.io](https://interviewing.io/) — мок-интервью для практики
