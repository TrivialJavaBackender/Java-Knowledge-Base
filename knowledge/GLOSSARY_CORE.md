# Глоссарий — рабочая выжимка

Покрывает подавляющее большинство случаев при написании теории. Полный
[`GLOSSARY.md`](GLOSSARY.md) (477 строк) читать **только при сомнении**: когда термина здесь нет
или когда неясно, попадает ли он под правило.

Цель — грамотный русский без латиничных вставок в теле предложения.

---

## Правило в одну строку

**Латиницей — только имена собственные** (аббревиатуры протоколов, продукты, алгоритмы, паттерны)
**и содержимое code-блоков.** Всё остальное — по-русски.

---

## 1. Остаётся латиницей

Не по списку, а по признаку: это **имя**, а не описание. Перевод сделал бы его неузнаваемым в
поиске и в чужом коде.

| Категория | Примеры |
|---|---|
| Протоколы и сети | TCP, UDP, IP, DNS, HTTP, HTTP/2, HTTP/3, QUIC, BGP, NAT |
| Безопасность | TLS, mTLS, JWT, OAuth2, OIDC, SAML, CSRF, XSS, WAF, DDoS, CORS, HMAC, RSA, AES, SSO, IdP |
| Архитектура | REST, gRPC, GraphQL, WebSocket, SSE, CDN, S3, IAM, RPC, API, SDK |
| Базы и распределённые | ACID, BASE, CAP, PACELC, MVCC, OLTP, OLAP, WAL, B-tree, LSM-tree, CRDT |
| Продукты | Kafka, Redis, PostgreSQL, Cassandra, MongoDB, Elasticsearch, ZooKeeper, etcd, Consul, Envoy, Nginx, HAProxy, RabbitMQ, Istio, Linkerd |
| Алгоритмы | Raft, Paxos, ZAB, SWIM, Gossip, Merkle tree, Bloom filter, HyperLogLog, Trie |
| Метрики | QPS, RPS, SLA, SLO, SLI, p50/p95/p99, TTL, TTFB, RTO, RPO, MTTR |
| Узкоспециальные | CQRS, Saga, Outbox, DDD, CDC, 2PC, RBAC, ABAC, SPIFFE, SVID |
| Имена паттернов надёжности | circuit breaker, bulkhead, backoff, jitter, single-flight, cache stampede, dead-letter, token bucket, leaky bucket, confused deputy |
| Имена микросервисных паттернов | Saga, Outbox, CQRS, Event Sourcing, API Gateway, BFF, Service Discovery, service mesh, sidecar, ambient, Strangler Fig, tolerant reader, event-carried state transfer, SPIFFE, SVID, deadline propagation, xDS |
| Механизмы JVM | happens-before, deadlock, livelock, lock-free, pinning, barging, false sharing |
| Практики процесса | Scrum, Kanban, trunk-based development, GitFlow, blue-green, canary, semver, DORA, WSJF, error budget, cost of delay |

Склонение — через дефис: «Kafka-кластер», «JWT-токен». Русское пояснение при первом упоминании
уместно: «повторы с экспоненциальной паузой (backoff)».

## 2. Обязательный перевод — ходовые пары

| Английский | Русский | | Английский | Русский |
|---|---|---|---|---|
| request | запрос | | node | узел |
| response | ответ | | leader | лидер |
| header | заголовок | | follower | реплика-читатель / вторичный |
| payload | полезная нагрузка | | replica | реплика |
| connection | соединение | | shard | шард |
| latency | задержка | | partition | партиция / раздел |
| throughput | пропускная способность | | broker | брокер |
| bandwidth | полоса / пропускная способность канала | | consumer | потребитель |
| timeout | таймаут | | producer | производитель / отправитель |
| event | событие | | client / server / service | клиент / сервер / сервис |
| retry / retries | повторная попытка / повторы | | stateless / stateful | без состояния / с состоянием |
| failure | сбой / отказ | | observability | наблюдаемость |
| outage | сбой / отказ региона | | trade-off | компромисс / размен |
| load shedding | сброс нагрузки | | storage | хранилище |
| graceful degradation | плавная деградация | | query | запрос (в контексте БД) |
| graceful shutdown | плавное завершение | | index / cache | индекс / кэш |
| deployment | развёртывание | | invalidation | инвалидация |
| rollout | раскатка | | eviction | вытеснение |
| rollback | откат | | materialized view | материализованное представление |
| release | релиз | | backend / frontend | бэкенд / фронтенд |
| incident | инцидент | | poll / polling | опрос |
| bottleneck | узкое место | | prefetch | предзагрузка |
| utilization | загрузка (не «утилизация») | | stream / streaming | поток / потоковая передача |
| root cause | первопричина | | real-time | в реальном времени |
| attacker | злоумышленник | | bidirectional | двунаправленный |
| signature | подпись | | chain of trust | цепочка доверия |
| compromise | компрометация | | replay | повтор / воспроизведение |

**В скобках при первом упоминании в каждом файле, дальше — русский вариант:**
backpressure → обратное давление, split-brain → расщепление кластера, failover → переключение на
резерв, fan-out → веерное распределение, handshake → рукопожатие, watermark → водяной знак,
cache stampede → захлёст кэша, feature flag → флаг функциональности,
DLQ → очередь недоставленных сообщений.

**Оставляем латиницей вопреки ожиданию:** heartbeat, service mesh, feature store, webhook,
push-уведомления, fencing token (с пояснением «токен ограждения»).

## 3. Запрещено — проверяй себя по этому разделу

### Переводы имён паттернов — так не говорят

| ❌ | ✅ |
|---|---|
| предохранитель | circuit breaker |
| переборка | bulkhead |
| смущённый заместитель | confused deputy |
| сага (как имя паттерна) | Saga |
| душитель / удушающий фасад | Strangler Fig |
| терпимый читатель | tolerant reader |

Термины не склоняются: «состояния circuit breaker», «поставить bulkhead», «два circuit breaker».
Согласование по мужскому роду: «circuit breaker сработал», «bulkhead не дал».

### Транслит-глаголы

| ❌ | ✅ |
|---|---|
| стримит | передаёт потоком |
| фетчит | загружает, получает |
| роутят | маршрутизируют |
| реплеит, реплейит | воспроизводит, повторяет |
| буферизируют | буферизуют |
| апдейтит | обновляет |
| бутстрапит | инициализирует, запускает |
| фолбэк | запасной вариант, откат |
| ретраить, ретраи, ретрай | повторять, повторы |
| зарелизить | выпустить релиз |
| отревьюить | провести код-ревью |

### Латиница в теле русского предложения

| ❌ | ✅ |
|---|---|
| делает reconnect | переподключается |
| ломают streaming | ломают потоковую передачу |
| такие requests | такие запросы |
| sender отправляет request | отправитель отправляет запрос |
| real-time prices | цены в реальном времени |

### Апостроф-формы

`pod'ы` → поды · `node'ы` → узлы · `backend'ом` → бэкендом · `lookup'ов` → поисков ·
`followers'ам` → подписчикам

### Английские заголовки и столбцы таблиц

`## Anatomy` → `## Устройство` · `## Retry policy` → `## Политика повторов` ·
`## Delivery guarantees` → `## Гарантии доставки` · столбец `Latency` → `Задержка`

## 4. Разрешённые транслит-формы

Закрепились в индустрии, использовать можно: дашборд, фаервол, оверхед, снапшот, дебажить,
кастомный, алерт, коммитить, мёрджить, деплоить, пушить, стектрейс, бэклог, спринт, стейкхолдер,
хотфикс, постмортем, код-ревью, пулл-реквест, релиз, чанк, стики-сессия, эмбеддинг, инференс.

**Только в разговорных формулировках, кейсах и цитатах** (в теоретическом тексте — полная форма):
фича → функциональность, дедлайн → срок, техдолг → технический долг, дейли → ежедневный Scrum.

## 5. Что не трогаем совсем

Код внутри блоков, URL и пути файлов, ключи JSON, имена HTTP-заголовков (`Cache-Control`, `ETag`,
`X-Request-Id`), имена веток и команд (`git push origin main`).

---

Спорные случаи, полные списки и обоснования решений — [`GLOSSARY.md`](GLOSSARY.md) §3 и §5.
Терминология конкретных концептов — [`CANONICAL_TERMS.md`](CANONICAL_TERMS.md).
