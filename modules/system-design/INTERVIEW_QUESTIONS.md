# Interview Questions — System Design

~90 вопросов под полную карту модуля (см. [ROADMAP.md](ROADMAP.md)): Foundations → Interview Framework → Distributed Primitives → Microservices → Reliability → Algorithms → Communication → Security → Streaming/Modern → Design Problems.

Источники: «Designing Data-Intensive Applications» (DDIA) — Kleppmann; «System Design Interview» — Alex Xu; канонические papers (Raft/Paxos, Spanner, Dynamo, Tail at Scale).

---

## 1. Foundations (Q1–Q15)

### Q1: В чём разница между vertical и horizontal scaling и где потолок vertical?
**A:** Vertical scaling (scale-up) — наращивать ресурсы одной машины (CPU, RAM, диск). Простота: код не меняется, нет распределённой сложности. Потолок: физические лимиты железа, нелинейный рост цены (топовые сервера в 10× дороже без 10× производительности), single point of failure. Horizontal scaling (scale-out) — добавлять машины; почти линейный рост ёмкости (с учётом USL — см. Q5), но требует stateless-сервисов, load balancer, sharding для stateful-слоя. На практике связка: вертикально до разумного предела (8–32 cores), затем горизонтально.

### Q2: Опиши типичный путь масштабирования веб-приложения с нуля до миллионов пользователей.
**A:** (1) Single server: app + БД на одной машине. (2) Разделить БД и app server. (3) Поставить load balancer + несколько app-instance (stateless). (4) Добавить read replicas БД (90% нагрузки — чтение). (5) Кэш (Redis/Memcached) перед БД. (6) CDN для статики. (7) Шардирование БД когда write-нагрузка не помещается на один primary. (8) Разделить монолит на сервисы по domain boundaries (микросервисы). (9) Multi-region для глобальной latency и DR. Каждый шаг — реакция на конкретное bottleneck, а не «делаем потому что модно».

### Q3: Capacity estimation framework — как считать на интервью?
**A:** Шаги: (1) **DAU** (daily active users); (2) **actions per user per day** для каждой операции; (3) **read:write ratio** (часто 100:1); (4) **peak factor** = 2–10× от average (учёт суточного пика); (5) **storage** = DAU × actions × payload × retention × replication factor; (6) **bandwidth** = QPS × payload size. Используй степени двойки: 1M ≈ 2²⁰, 1B ≈ 2³⁰. Latency budget сравни с Jeff Dean numbers — если требуется <10 ms, а только сетевой round-trip 1 ms внутри DC, остальное распределяй между БД и cache.

### Q4: Назови ключевые latency numbers (Jeff Dean) и зачем их помнить.
**A:** Опорный набор: L1 cache 1 ns, L2 ~4 ns, branch misprediction 5 ns, mutex lock/unlock 25 ns, main memory 100 ns, compress 1KB ~10 µs, SSD random 4 KB ~10 µs (раньше было 150 µs для HDD), datacenter round-trip 500 µs, network 1 Gbit/s — 10 ms на MB, disk seek HDD 10 ms, cross-region 50–150 ms. Полезны на интервью для прикидки: «если read latency должна быть p95 < 20 ms, две сетевые операции уже съели 1 ms — оставшиеся 19 ms на disk/CPU». Шкала разрядов важнее точных цифр.
> Jeff Dean — «Numbers Every Programmer Should Know»

### Q5: Что такое Universal Scalability Law (USL) и почему линейный scale-out — миф?
**A:** USL — модель Neil Gunther: throughput при N узлах = `N / (1 + α(N-1) + βN(N-1))`, где α — contention (сериализация), β — coherence (синхронизация между узлами). При α=0, β=0 — идеальный линейный рост; на практике с ростом N сначала рост сублинейный, затем плато, затем спад (negative scalability при β>0). Практический вывод: не верить «удвоим узлы — удвоим RPS», измерять реальный коэффициент масштабирования; чаще всего узкое место — общий ресурс (БД, lock-сервис) с большим α.
> Neil Gunther — «Guerrilla Capacity Planning»

### Q6: DNS record types и зачем нужен TTL trade-off.
**A:** Основные записи: **A** (IPv4), **AAAA** (IPv6), **CNAME** (alias на другой DNS-имя — нельзя на корне домена), **MX** (mail server), **NS** (delegation), **TXT** (произвольный текст: SPF/DKIM/verification), **SOA** (zone authority). TTL — сколько resolvers кэшируют запись. Низкий TTL (30–60 s) даёт быстрый failover, но повышает QPS на authoritative DNS и латентность для пользователей (cache miss каждые 60 s). Высокий TTL (часы) — наоборот: дешевле и быстрее, но при инциденте смена IP займёт часы. Production: 60–300 s для динамических сервисов, 1 h для статики.

### Q7: GeoDNS / latency-based routing vs anycast — в чём разница?
**A:** **GeoDNS** возвращает разные IP в зависимости от географии запросителя (расположение DNS resolver, не реального клиента — отсюда и часть неточности). **Latency-based** routing (AWS Route 53, Cloudflare) — измеряет реальную latency и направляет к ближайшему по сети регионe. **Anycast** — один и тот же IP анонсируется из множества POP через BGP, и пакет приходит на ближайший по сети узел; работает на L3 без участия DNS. Anycast мгновенный (TCP-соединение к ближайшему POP), GeoDNS даёт более гибкую логику маршрутизации (например, по compliance — данные ЕС → только франкфуртский регион).

### Q8: CDN: push vs pull, и почему versioned URLs обычно лучше purge?
**A:** **Pull CDN** (Cloudflare, Fastly) — клиент запрашивает у edge; если cache miss — edge тянет с origin и кэширует. **Push CDN** — публикатор сам загружает контент на edge (Amazon CloudFront для S3 — гибрид). Pull проще: не надо думать о синхронизации; push даёт предсказуемое наполнение для редких ресурсов. **Purge** требует прохода по всем POP-ам (минуты, иногда часы у крупных CDN), а **versioned URLs** (`/static/app.v42.js` или хэш в пути) — мгновенная инвалидация на стороне клиента: новая ссылка автоматически — cache miss. Production: статика — всегда versioned URLs (immutable + `Cache-Control: max-age=31536000`), purge — только для редких аварийных случаев.

### Q9: Cache-Control, ETag, Vary — что делает каждый в контексте CDN?
**A:** **`Cache-Control`** — главный директор кэширования: `public`/`private`, `max-age`, `s-maxage` (только для shared cache), `no-store`, `stale-while-revalidate`, `must-revalidate`. **`ETag`** — версионный отпечаток ресурса; при `If-None-Match` сервер возвращает 304 без тела если ETag совпал. **`Vary`** — указывает CDN, по каким request headers разделять кэш-ключ (`Vary: Accept-Encoding` — отдельные cached entries для gzip/br). Подводный камень: `Vary: Cookie` или `User-Agent` фрагментирует кэш до бесполезности — каждый юзер получает свою копию. Подробнее — `caching-deep-dive/theory/HTTP_CDN_CACHE.md`.

### Q10: L4 vs L7 load balancer — когда какой нужен?
**A:** **L4** (TCP/UDP, IP+port) — балансирует на уровне сокетов: NAT/DSR, низкая latency (~µs), не видит контент, поэтому не может маршрутизировать по path/header. Подходит для произвольных протоколов (gRPC, postgres) и максимального RPS. **L7** (HTTP/HTTPS) — terminate TLS, парсит запрос, маршрутизирует по path/host/header, поддерживает rewrite, retry, A/B, WAF. Дороже по CPU, но необходим для HTTP-маршрутизации. Production: часто связка — L4 (anycast/ELB) на входе, за ним L7 (Envoy/Nginx/HAProxy) для роутинга к сервисам.

### Q11: Алгоритмы балансировки нагрузки и где какой использовать.
**A:**
- **Round-robin** — простой, fair при одинаковых backend'ах; плох при неравных машинах или длинных запросах.
- **Least connections** — выбирает backend с минимумом активных соединений; хорошо для долгих сессий (WebSocket, БД).
- **IP-hash / consistent hash** — фиксирует клиента/ключ за backend'ом; нужен для sticky behaviour без cookies или для кэш-нод.
- **Weighted round-robin / least conn** — учитывает разные мощности машин.
- **Power-of-two-choices** — выбираем 2 случайных, шлём на менее загруженный; почти как least-conn без глобального состояния, масштабируется.
- **EWMA / response-time** (Envoy) — учитывает реальную latency, естественно отжимает слабые pod'ы.

### Q12: Sticky sessions vs stateless: trade-offs.
**A:** **Sticky** (через cookie или IP hash) — простой путь сделать stateful-приложение горизонтально масштабируемым: каждый юзер всегда попадает на тот же сервер, который хранит session-state в памяти. Минусы: при выпадении этого сервера юзер теряет сессию; неравномерная нагрузка; rolling deploy сложен. **Stateless** — состояние в Redis / БД / JWT; любой instance обслужит любого юзера; horizontal scaling и rolling deploy без потерь. Production: почти всегда stateless для веб-серверов; sticky только для специфичных кейсов (WebSocket с локальным in-memory pub/sub, GPU-сессии для ML inference).

### Q13: Что такое anycast и как один IP может обслуживаться разными POP?
**A:** Anycast — один и тот же IP-префикс анонсируется из множества физических локаций через BGP. Маршрутизаторы интернета сами выбирают «ближайший» по BGP-метрикам путь к этому IP, поэтому пакет от пользователя приходит на ближайший POP без участия DNS или приложения. Используется для: corporate DNS (8.8.8.8, 1.1.1.1), DDoS absorption (атака размывается по сотням POP), CDN на L3. Подводный камень: anycast подходит для stateless UDP (DNS, QUIC) и коротких TCP-сессий; для длинных TCP-сессий route flap может перебросить трафик на другой POP, и соединение разорвётся (поэтому крупные CDN держат stateful сессии на edge и тянут к origin внутренне).

### Q14: Reverse proxy vs load balancer — где граница?
**A:** Граница размытая; на практике это часто **один и тот же продукт** (Nginx, HAProxy, Envoy) в разных режимах. **Reverse proxy** — единая точка входа, terminate TLS, кэширует ответы, добавляет headers, проксирует на 1+ backend; даже на одном backend имеет смысл (TLS offload, edge security). **Load balancer** — конкретно функция распределения нагрузки между несколькими backend'ами по алгоритму. Любой современный reverse proxy умеет balance, любой L7 LB умеет proxy. Различение полезно концептуально: reverse proxy — «фасад», LB — «диспетчер»; коммерческие appliance вроде F5 BIG-IP делают акцент на LB, а Cloudflare — на edge proxy.

### Q15: HTTP/1.1 vs HTTP/2 vs HTTP/3+QUIC — ключевые различия.
**A:** **HTTP/1.1** — текстовый, одно request/response на TCP-соединение (keep-alive переиспользует, но без multiplexing → head-of-line blocking, костыли вроде domain sharding и concatenation). **HTTP/2** — бинарный, multiplexing множества streams в одном TCP, HPACK сжатие заголовков, server push (мёртв на практике). HOL blocking устранён на уровне HTTP, но остаётся на уровне TCP: потеря одного пакета блокирует все streams. **HTTP/3** — поверх QUIC (UDP-based), TLS 1.3 встроен, multiplexing на уровне транспорта (каждый stream независим — нет TCP HOL), connection migration (смена сети без потери соединения). TLS 1.3 0-RTT — повторные подключения без round-trip handshake. Production: HTTP/3 заметно ускоряет мобильные клиенты в плохих сетях.

---

## 2. Interview Framework (Q16–Q18)

### Q16: Как структурировать первые 5 минут SD-интервью (requirements clarification)?
**A:** Цель — превратить размытую тему в конкретный scope. (1) **Functional**: какие use cases в scope, какие out (например, «Twitter: feed + post + follow; messaging — out»). (2) **Non-functional**: latency p95/p99 цели, availability (99.9% vs 99.99%), consistency (strong / read-your-writes / eventual), durability. (3) **Scale**: DAU, peak QPS, размер payload, geo-распределение. (4) **Constraints**: бюджет, регуляторика (GDPR/HIPAA), существующий tech stack. Завершить кратким суммированием: «итого: 100M DAU, 100K QPS read / 5K write, p95 < 200 ms, eventual consistency, multi-region, GDPR». Это рамка остальной дискуссии.

### Q17: Capacity estimation на интервью — 5-минутный template.
**A:** На доске последовательно: (1) DAU → MAU/30 или из контекста; (2) actions/user/day × DAU = total ops/day; (3) ops/day / 86400 ≈ avg QPS; (4) peak = 2–10× avg; (5) storage = ops × payload × retention × replication factor; (6) bandwidth = QPS × payload × multiplier. Округлять степенями двойки: 1M ≈ 10⁶ ≈ 2²⁰. Делать sanity check: «100 PB storage — это ~10K серверов с 10 TB каждый» — соответствует ли это размеру компании? Главное — продемонстрировать процесс рассуждения, точные цифры не критичны.

### Q18: Как защищать выбор архитектуры на trade-off вопросах?
**A:** Структура: **«я выбрал X, потому что A, B, C; альтернатива Y хороша когда Z, но не подходит здесь потому что W»**. Опорные оси: latency vs consistency (PACELC), durability vs cost, simplicity vs flexibility, dev velocity vs operational complexity. Не давать «лучшее решение» — давать **обоснованный выбор с явными trade-offs**. Конкретно: на вопрос «PostgreSQL или Cassandra» — не «Cassandra, она быстрее», а «Cassandra если нужна leaderless multi-region запись и устроит eventual consistency; PostgreSQL если нужны транзакции и сложные джоины. Для нашего use case с financial ledger — PostgreSQL, потому что ACID критичен». Интервьюеру важна именно логика выбора.

---

## 3. Distributed Primitives (Q19–Q34)

### Q19: Что такое CAP теорема и её ограничения?
**A:** При сетевом разделении (Partition) распределённая система вынуждена выбирать между **Consistency** (все узлы видят одинаковые данные) и **Availability** (система отвечает на все запросы). CP-системы (ZooKeeper, etcd, Spanner) — при разделе становятся недоступными в minority partition. AP-системы (Cassandra, DynamoDB при `R=W=1`) — отвечают данными, которые могут быть stale. Ограничения: «consistency» в CAP = **linearizability** (узкий смысл), не обычная ACID-консистентность; в нормальной работе доступны оба свойства. Поэтому в обиходе используют PACELC — см. Q20.
> Eric Brewer — «CAP Twelve Years Later»

### Q20: PACELC — почему «честнее» CAP?
**A:** **PACELC** (Daniel Abadi): if **P**artition then choose **A** or **C**; **E**lse (нормальный режим) — choose **L**atency or **C**onsistency. CAP описывает только редкий случай раздела; PACELC отражает постоянный trade-off: синхронная репликация даёт consistency но платит latency на каждом запросе. Классификация: **PostgreSQL = PC/EC** (single primary, strong consistency, latency-неоптимально); **Cassandra = PA/EL** (под нагрузкой можно стрейтить eventual consistency); **DynamoDB = PA/EL** (с опциональным strong-consistent read); **Spanner = PC/EC** (CP даже под нагрузкой, но компенсирует TrueTime).
> Daniel Abadi — «Consistency Tradeoffs in Modern Distributed Database System Design»

### Q21: Quorum (R+W>N) — что это даёт и где подводные камни?
**A:** В leaderless системах с N репликами: записываем на W узлов, читаем с R узлов; если **R+W > N** — read и write quorums пересекаются хотя бы в одном узле, значит read увидит последнюю запись. Конкретно `N=3, W=2, R=2` — стандарт; `W=N=3, R=1` — fast read, slow write; `W=1, R=1` — best effort, eventual consistency. Подводный камень: quorum гарантирует пересечение, но не порядок — нужен **vector clock** или **last-write-wins с синхронизированными часами** для разрешения конфликтов. Sloppy quorum + hinted handoff (Dynamo) допускает write при отсутствии primary узлов, что нарушает строгую quorum-гарантию.
> Dynamo paper (Amazon, 2007)

### Q22: Linearizability vs sequential vs causal vs eventual consistency.
**A:** Спектр от сильной к слабой:
- **Linearizable** (strong): операции выполняются в некотором глобальном порядке, согласующемся с реальным временем; «как один сервер». Дорого: требует консенсуса или single leader.
- **Sequential**: глобальный порядок есть, но не обязан совпадать с wall-clock временем; операции одного клиента — в program order.
- **Causal**: если A causally precedes B (через `happens-before`), все наблюдатели видят A раньше B; независимые операции могут разойтись (vector clocks).
- **Read-your-writes / monotonic reads / writes-follow-reads**: session guarantees — слабее causal, но достаточно для UX (юзер видит свой только что отправленный post).
- **Eventual**: «когда-нибудь сходимся»; конкретики о времени и порядке нет.

### Q23: Lamport clock vs vector clock — какие конфликты ловят?
**A:** **Lamport timestamp** — счётчик, который монотонно увеличивается при send/receive. Даёт total order (с tiebreaker по node id), но **не отличает causal от concurrent**: для двух событий A и B с разными timestamps мы не знаем, было ли A→B или они конкурентны. **Vector clock** — массив `[c1, c2, ..., cN]` по одному счётчику на узел; событие A→B iff `VC(A) ≤ VC(B)` поэлементно и не равны. Если ни `VC(A) ≤ VC(B)`, ни `VC(B) ≤ VC(A)` — они конкурентны (parallel). Vector clock дороже (O(N) overhead) и нужен для systems where causal order matters (Riak, conflict detection в Dynamo).
> Lamport — «Time, Clocks, and the Ordering of Events»

### Q24: Idempotency keys — почему обязательны для retry safety?
**A:** При retry над не-идемпотентной операцией (создание заказа, charge кредитной карты) есть риск выполнить её дважды, если первый запрос всё-таки дошёл, но ответ потерялся. Idempotency key — UUID, генерируемый клиентом до первого запроса; сервер хранит `(key → response)` на TTL (например, 24 h) и при повторе с тем же ключом возвращает тот же кэшированный ответ. Реализация: dedicated таблица в БД с уникальным индексом на key + транзакционная запись результата. Без idempotency key любая retry-логика становится unsafe для side-effect операций.
> Stripe API — Idempotency Keys

### Q25: Raft — основные идеи и safety properties.
**A:** Raft — алгоритм консенсуса для replicated state machine. Состояния узла: **Follower** / **Candidate** / **Leader**. Time разбит на **terms** (монотонная нумерация); в каждом term избран не более одного лидера. **Leader election**: при таймауте Follower становится Candidate, request votes; кто соберёт majority — Leader. **Log replication**: client → leader → AppendEntries к Followers; запись committed после реплики на majority. Safety: (1) Election safety — один leader per term; (2) Leader Append-Only — лидер не перезаписывает свой log; (3) Log Matching — если две записи имеют одинаковые `(term, index)`, всё предыдущее тоже совпадает; (4) Leader Completion — commited записи присутствуют у всех будущих лидеров; (5) State Machine Safety — две команды применяются в одинаковом порядке всеми state machines.
> Diego Ongaro & John Ousterhout — «In Search of an Understandable Consensus Algorithm»

### Q26: Paxos vs Raft — почему Raft победил в индустрии?
**A:** Корректность одинаковая (Paxos формально доказан старше), но Raft проще для понимания и реализации. Различия: (1) **Single-decree Paxos** решает один консенсус; для replicated log нужен Multi-Paxos с нетривиальной оптимизацией. Raft — log-centric с самого начала. (2) Раздел проблемы: Raft чётко разделяет leader election, log replication, safety; в Paxos они переплетены. (3) Raft требует **strong leader** (вся запись через лидера) — это упрощает рассуждения, но снижает write availability при failover. (4) Membership changes: Raft предлагает joint consensus как стандартный механизм. Этiология: после Ongaro paper (2014) Raft взяли etcd, Consul, CockroachDB, TiKV, KRaft; Paxos остался в Google (Chubby, Spanner) и ZooKeeper (ZAB — вариация Paxos).

### Q27: ZAB (ZooKeeper Atomic Broadcast) — чем отличается от Raft?
**A:** ZAB предшествует Raft, тоже основан на single leader + log replication, но: (1) фокусируется на **atomic broadcast** (порядок сообщений), не на state machine replication явно; (2) использует **two-phase recovery** при election (sync leader's log с majority перед началом работы) — это даёт более строгие гарантии при разделе, но усложняет код; (3) zxid — 64-битный идентификатор (epoch + counter) вместо отдельных term и index. На практике ZAB и Raft эквивалентны по гарантиям. ZAB остался специфичным для ZooKeeper; индустрия пошла по пути Raft из-за читабельности спецификации.

### Q28: Leader election — Bully vs Raft vs ZK ephemeral znodes vs lease-based.
**A:**
- **Bully**: узел с самым большим ID побеждает. Узел заметил, что leader умер → отправляет ELECTION выше-нумерованным; если никто не ответил — он leader; иначе ждёт от победителя. Прост, но генерирует O(N²) сообщений и требует знания всех узлов.
- **Raft-based**: см. Q25; голосование majority с randomized timeout для предотвращения split votes.
- **ZK ephemeral znode**: каждый кандидат создаёт `/leader-XXX` (sequential ephemeral); владелец znode с минимальным номером — leader. При смерти узла znode исчезает (по timeout сессии), следующий по списку забирает лидерство.
- **Lease-based + fencing token**: leader получает lease на T секунд от lock-сервиса; каждое действие сопровождается монотонно растущим fencing token. Если старый leader «воскрес» с протухшим lease и пытается записать — downstream отказывает (token старее last seen). Защищает от split-brain без consensus.

### Q29: Split-brain — причина и митигации.
**A:** Split-brain возникает когда при сетевом разделении обе половины кластера считают себя primary и принимают записи → конфликтующие данные на сторонах раздела. Митигации: (1) **Quorum** — записи только при majority узлов в живых; minority partition отказывает в write (CP); (2) **Fencing token** — каждое действие нумеруется; downstream отвергает действия с устаревшим token (Martin Kleppmann: «How to do distributed locking»); (3) **STONITH** (Shoot The Other Node In The Head) — изолированный watchdog физически отключает «зомби»-узлы; (4) **Witness / arbiter node** для разрешения тай (2+1 топология). Без fencing distributed lock сам по себе не защищает от split-brain.

### Q30: Gossip protocol — push vs pull vs push-pull, и что такое SWIM?
**A:** Gossip — децентрализованное распространение информации: каждый узел периодически выбирает случайных N peers и обменивается состоянием. **Push**: я отдаю своё состояние peer'у. **Pull**: я прошу состояние у peer'а. **Push-pull**: обмен в обе стороны (быстрее сходится). Распространение информации — O(log N) раундов. **SWIM** (Scalable Weakly-consistent Infection-style Membership) — конкретный gossip для failure detection: периодический ping + indirect ping через k случайных свидетелей перед объявлением узла мёртвым (уменьшает false positives). Используется в Consul, Memberlist (Serf), Cassandra.
> SWIM paper — Das, Gupta, Motivala (2002)

### Q31: CRDT — основные типы и где применять.
**A:** **CRDT** (Conflict-free Replicated Data Types) — структуры, для которых merge двух реплик математически коммутативный, ассоциативный, идемпотентный, поэтому конфликты разрешаются без координации. Базовые типы:
- **G-Counter** — grow-only counter (массив счётчиков по узлам, merge = поэлементный max).
- **PN-Counter** — пара G-Counter (positive и negative).
- **G-Set / 2P-Set / OR-Set** — Set с разной семантикой удалений; OR-Set различает повторные add/remove через unique tags.
- **LWW-Register** — Last-Write-Wins по timestamp; теряет конкурентные записи.
Применение: collaborative editing (Yjs, Automerge), shopping cart в Dynamo, edge-replicated counters (Riak).
> Marc Shapiro et al. — «Conflict-free Replicated Data Types»

### Q32: Op-based vs state-based CRDT — trade-offs.
**A:** **State-based** (CvRDT) — каждый узел шлёт полное состояние, merge — join semilattice. Просто: можно использовать обычный gossip; merge идемпотентен, дубликаты неопасны. Минус: размер сообщений растёт со временем (хоть delta-state CRDT уменьшает). **Op-based** (CmRDT) — узлы шлют только операции; требует надёжной доставки **exactly-once в causal order** (через vector clock). Сообщения маленькие, но транспорт сложнее. На практике обычно используют delta-state или гибрид: реплика хранит state, шлёт компактные deltas.

### Q33: Multi-region active-active vs active-passive — RTO/RPO trade-off.
**A:** **Active-passive** — primary регион принимает writes, secondary — асинхронная реплика. RTO (recovery time) — минуты-десятки минут (failover script + DNS switch); RPO (recovery point) — секунды-минуты (lag репликации). Проще оперативно. **Active-active** — оба региона принимают writes; нужно решать conflict resolution (LWW, CRDT, application-level merge) или использовать leader-per-key (Cosmos DB, partition ownership). RTO ~0, RPO ~0 (если синхронная реплика; иначе ~seconds), но дороже в инфраструктуре и сложнее в коде. Выбор: банкинг с ACID — active-passive в одной зоне + cross-region cold standby; глобальный соцпродукт — active-active с eventually-consistent данными.

### Q34: Как Spanner достигает global strong consistency через TrueTime?
**A:** Spanner предоставляет **externally consistent** транзакции globally — невозможно в general, но Google использует **TrueTime API**: GPS+atomic clocks дают bounded uncertainty `[earliest, latest]` (типично ±7 ms). Алгоритм для read-write транзакций: (1) выбрать `commit_timestamp = TT.now().latest`; (2) **commit wait** — ждать пока `TT.now().earliest > commit_timestamp` (т.е. реальное время точно прошло этот момент); (3) только потом сделать запись видимой. Это гарантирует: если T1 commits before T2 starts (по wall-clock), то T2 видит T1. Cost: каждый write платит ~7 ms commit-wait latency. Доступно как Cloud Spanner.
> Spanner paper — Corbett et al. (OSDI 2012)

---

## 4. Microservice Patterns & Kafka (Q35–Q47)

### Q35: Когда оправдан переход от монолита к микросервисам?
**A:** Не из-за scale (вертикально и в монолите можно), а из-за **organizational scalability**: когда команд > 5–8 и они блокируют друг друга на одном репо/деплое. Признаки готовности: (1) разные части системы имеют разный non-functional профиль (одни — strict latency, другие — batch); (2) deploy frequency страдает из-за coupling; (3) разные команды хотят разный tech stack; (4) есть зрелая платформа (CI/CD, observability, secrets, service mesh) — иначе ops complexity убьёт продуктивность. Anti-pattern: «модульный монолит → микросервисы потому что модно». Если границы доменов нечёткие — splitting только закрепит хаос в виде distributed monolith.

### Q36: Saga pattern — choreography vs orchestration.
**A:** Saga разбивает длинную транзакцию на цепочку локальных транзакций, каждая публикует событие или вызывает следующий шаг; при сбое — **compensating transactions** в обратном порядке. **Choreography**: сервисы реагируют на события друг друга (event-driven, слабая связность). Минусы: нет центрального view, дебаг сложен — нужно tracing-у склеивать поток; легко создать циклы. **Orchestration**: центральный coordinator (Camunda, Temporal, AWS Step Functions) хранит состояние saga и явно вызывает шаги. Плюсы: видимость, легче изменить порядок, тесты проще. Минусы: coordinator — единая точка эволюции/отказа. Production: orchestration для критичных бизнес-процессов (платежи, заказы), choreography — для слабо-связанных интеграций.
> Chris Richardson — «Microservices Patterns»

### Q37: Outbox pattern — зачем нужен и как реализовать с CDC.
**A:** Проблема: нельзя атомарно записать в БД (например, создать заказ) и опубликовать событие в Kafka — две разных системы, distributed transaction (XA) дорого и хрупко. **Outbox**: в одной транзакции пишем в бизнес-таблицу И в таблицу `outbox` (в той же БД). Отдельный publisher читает outbox и шлёт в Kafka, помечая записи как sent. Гарантирует at-least-once delivery без 2PC. **Polling**: publisher делает `SELECT FROM outbox WHERE NOT sent LIMIT 100` — просто, но даёт latency и нагрузку на БД. **CDC** (Debezium → WAL/binlog → Kafka Connect) — публикация в real-time на основе репликационного потока БД, без polling. Подводные камни: schema evolution в outbox-таблице, удаление обработанных записей (TTL или мягкое удаление).

### Q38: CQRS — когда оправдан и когда overkill?
**A:** CQRS (Command Query Responsibility Segregation) — разделение модели на write-side (commands, нормализованная) и read-side (queries, денормализованная) с отдельными storage. Оправдан когда: (1) read и write имеют радикально разную нагрузку или паттерны (read 1000:1 write, сложные joins на больших данных); (2) разные read-моделей для разных UI; (3) read должен быть глобально доступен (eventually consistent search index, кэш). Overkill для CRUD приложений с простой моделью — добавляет complexity (event projection, eventual consistency, разные модели данных) ради абстрактных преимуществ. Часто путают с Event Sourcing — это разные паттерны, CQRS не требует ES (и наоборот).

### Q39: Event Sourcing — append-only лог как source of truth.
**A:** Вместо хранения текущего состояния в таблицах храним последовательность событий: `OrderPlaced`, `ItemAdded`, `OrderShipped`. Текущее состояние = fold по событиям. Преимущества: (1) **полный audit log** бесплатно; (2) **time travel** — состояние на любой момент; (3) **projections** — несколько read-моделей из одного потока; (4) **event-driven архитектура** естественна. Сложности: event versioning (см. Q40), идемпотентность projections (применять offset для exactly-once-effect), snapshots для производительности (Q41), GDPR (удаление события из append-only лога — нетривиально, обычно crypto-erasure ключа).

### Q40: Backward / forward compatibility и upcasting в Event Sourcing.
**A:** **Backward compatibility**: новый код читает старые события — поля добавлять только optional с дефолтом, не удалять required, не переименовывать. **Forward**: старый код читает новые события — игнорировать неизвестные поля (Jackson: `@JsonIgnoreProperties(ignoreUnknown = true)`). **Full** = пересечение. **Upcasting** — преобразование raw старого события до десериализации: заполнить новое поле дефолтом, разбить, склеить. Применяется когда strong-typed events и Avro/Protobuf schema resolution недостаточна. Альтернативы: event versioning (`OrderCreatedV1`, `OrderCreatedV2` как отдельные классы), параллельные поля с `@Deprecated`. Confluent Schema Registry поддерживает `BACKWARD`, `FORWARD`, `FULL` и `_TRANSITIVE` режимы.
> Greg Young — «Versioning in an Event Sourced System»

### Q41: Snapshots в Event Sourcing — зачем и как организовать.
**A:** Restore состояния агрегата = replay всех его событий с начала. При тысячах событий на агрегат replay становится медленным (linear scan). **Snapshot** — материализованное состояние агрегата после N-ного события, хранится в отдельном store (отдельная таблица или KV). Restore = load последний snapshot + replay tail после snapshot. Trade-off: дополнительное место + invalidation snapshots при изменении структуры события vs скорость восстановления. Стратегия: snapshot каждые 100–1000 событий или по weighted-replay-time (если replay > 100 ms — взять snapshot). Snapshot versioning важен: при schema change либо мигрировать снимки, либо инвалидировать и пересчитать.

### Q42: Deployment strategies: Blue/Green, Rolling, Canary, A/B.
**A:**
- **Rolling**: постепенная замена instances по N штук; простое (k8s default), no downtime, но смешан старый/новый код во время раскатки.
- **Blue/Green**: параллельные environments (blue — current, green — new); переключение трафика мгновенно (LB switch). Лёгкий rollback (откатить трафик обратно). Дорого по инфраструктуре (2× мощности на время раскатки), сложно для stateful systems (БД миграции).
- **Canary**: новый код на маленькой доле трафика (1% → 10% → 100%), мониторинг ошибок и latency. Самый безопасный для рискованных изменений; нужен надёжный observability и feature flags для срочного отката.
- **A/B testing**: не deployment стратегия, а способ проверки бизнес-метрик на сегменте пользователей. Часто реализуется через feature flags поверх любого deployment стратегии.

### Q43: Kafka partitioning и ordering guarantees.
**A:** Kafka даёт **per-partition ordering**: внутри одной partition сообщения упорядочены по offset; между partition'ами порядка нет. Partitioning key (хэш) определяет, в какой partition попадёт сообщение — `hash(key) % num_partitions`. Поэтому: чтобы события одной сущности (user_id, order_id) обрабатывались по порядку — использовать её ID как partition key. Подводный камень: **изменение `num_partitions` ломает hash routing** — старые ключи разъедутся по новым partition'ам, и порядок для них нарушится; в production num_partitions фиксируют заранее с запасом. Custom partitioner — для сложной логики (например, weighted by tenant size).

### Q44: At-most / at-least / exactly-once в Kafka — что реально гарантируется?
**A:** Семантики:
- **At-most-once**: `acks=0`, no retry — простой, потери возможны.
- **At-least-once**: `acks=all` + retry — стандарт; consumer должен быть idempotent, дубликаты возможны при retry.
- **Exactly-once**: producer idempotence (`enable.idempotence=true` — producer id + sequence, broker дедуплицирует) + transactions (`transactional.id` + `initTransactions` + `beginTransaction/commitTransaction`). Consumer читает с `isolation.level=read_committed`. Reality check: Kafka exactly-once работает только внутри Kafka-ecosystem (consume → process → produce); если внутри transaction вызывается внешний HTTP API — exactly-once **не** распространяется на этот вызов. Side effects вне Kafka требуют idempotency keys.

### Q45: Consumer group rebalance — что происходит и как минимизировать pause.
**A:** Когда consumer присоединяется/уходит из группы, group coordinator (один из brokers) запускает **rebalance**: вычисляет новое распределение partition → consumer и шлёт каждому. Старый алгоритм (eager) — **stop-the-world**: все consumers отдают partitions, ждут нового assignment, затем стартуют. Это паузы 1–10 s. **Cooperative rebalancing** (KIP-429, Kafka 2.4+) — incremental: только меняющиеся assignments revoke, остальные продолжают работать; паузы намного короче. **Static membership** (`group.instance.id`) — consumer переподключается с тем же ID после рестарта без rebalance, если успел до session timeout. Sticky assignor минимизирует движение partitions при rebalance.

### Q46: ISR, acks=all, min.insync.replicas — что реально означает «durability»?
**A:** **ISR** (In-Sync Replicas) — реплики, которые в данный момент не отстают от leader больше `replica.lag.time.max.ms`. **`acks=all`** заставляет producer ждать подтверждения от **всех ISR** (не от всех реплик). Если `min.insync.replicas=2` и реплик 3 — production требует чтобы хотя бы 2 (включая leader) были в ISR; иначе producer получает `NotEnoughReplicasException` и запись не примется. Тонкость: `acks=all` без `min.insync.replicas` не даёт durability — если ISR сжалась до одного leader, и он умирает, данные потеряны. Boilerplate настройка для durable producer: `acks=all`, `min.insync.replicas=2` (при `replication.factor=3`), `enable.idempotence=true`.

### Q47: KRaft vs ZooKeeper — почему Kafka отказалась от ZK?
**A:** ZooKeeper был отдельным кластером с операционным overhead'ом (отдельный deployment, отдельная authz-модель, лимит ~200K partitions из-за хранения metadata в ZK heap). **KRaft** (KIP-500) выносит metadata в встроенный Raft-журнал внутри Kafka brokers — single deployment, единая security model, миллионы partitions. Controller всегда один (leader Raft-кворума метаданных), при failover новый избирается за ~10 s. Production-ready с Kafka 3.3 (2022), ZK поддержка удалена в Kafka 4.0.
> KIP-500: Replace ZooKeeper with a Self-Managed Metadata Quorum

---

## 5. Reliability Patterns (Q48–Q53)

### Q48: Retry с exponential backoff + jitter — почему именно full jitter?
**A:** Базовый exponential backoff: `delay = base * 2^attempt` (cap'нутый сверху). Без jitter все клиенты падают одновременно → retry одновременно → новая волна нагрузки → каскад. **Full jitter** (AWS): `delay = random(0, base * 2^attempt)` — равномерно распределяет retry во времени, минимизирует pile-up. **Equal jitter**: `delay = half + random(0, half)` — гарантирует минимальную задержку, чуть лучше для очень коротких retry. **Decorrelated jitter** (`delay = random(base, prev_delay * 3)`) — хорош для long-tail scenarios. AWS Architecture Blog статистически показал: full jitter даёт минимальный completion time и минимальную нагрузку на downstream.
> AWS Architecture Blog — «Exponential Backoff and Jitter» (Marc Brooker)

### Q49: Circuit Breaker — зачем, состояния, когда открывается, что такое CCB и adaptive concurrency.
**A:** Защищает от каскадных сбоев: при недоступности downstream быстро возвращаем ошибку вместо ожидания timeout. Состояния: **CLOSED** → **OPEN** (при >K failures или >K% за окно) → **HALF-OPEN** (после cooldown, пробный запрос) → CLOSED или снова OPEN. **CCB** (Concurrency-Limited Circuit Breaker) считает не только failures, но и активные in-flight calls; при concurrency > limit (downstream медленный — pending requests накапливаются) — OPEN. **Adaptive concurrency-limits** (Netflix concurrency-limits, Envoy adaptive): динамически вычисляет оптимальный concurrency через TCP Vegas-like алгоритм (latency rising → reduce concurrency), не требует ручного тюнинга. Resilience4j, Hystrix (deprecated), Polly.

### Q50: Bulkhead — что это и где границы изоляции.
**A:** Bulkhead — изоляция ресурсов между downstream'ами, чтобы сбой одного не утопил все. Уровни изоляции: (1) **Thread pool isolation** — отдельный пул потоков на каждый downstream; medium downstream pool насыщается, но critical downstream остаётся отзывчивым; (2) **Connection pool isolation** — отдельный JDBC/HTTP пул per dependency; (3) **Process / container isolation** — отдельный sidecar или сервис; самая дорогая, но самая надёжная. Trade-off: больше изоляция = больше resources. Hystrix исторически использовал thread pool per command; современные подходы (Resilience4j) предпочитают semaphore (легче) + adaptive concurrency-limit.

### Q51: Hedged requests — как уменьшить tail latency.
**A:** Идея: дублировать запрос после `p95` оригинала; ответ берём от того, кто ответил первым. Tail latency p99 уменьшается в 5–10 раз. Жмёт: extra load ~5% (только запросы превышающие p95 дублируются), плюс side-effect: hedged запросы должны быть idempotent или cancellable (Google использует `read-after-write` cancellation). Развитие: **tied requests** — duplicate шлётся одновременно на нескольких backend'ов, но с tied protocol — кто первый принимает в обработку, другие cancel'я. Применяется в Google Bigtable, Spanner; экспериментально в gRPC.
> Dean & Barroso — «The Tail at Scale» (CACM 2013)

### Q52: Load shedding и graceful degradation — как survive под перегрузкой.
**A:** **Load shedding**: при перегрузке (latency p99 растёт, queue растёт) отбрасывать часть запросов осознанно — лучше отказать 10% сразу, чем медленно отвечать всем (latency-amplification, deadline cascading). Реализация: queue с bounded size + 429/503 при переполнении; adaptive shedding по utilisation (Google CoDel). **Graceful degradation**: вернуть **меньше**, но что-то полезное. Примеры: (1) **stale cache** — отдать просроченные данные если БД медленная; (2) **default values** — рекомендации = top-trending вместо персонализированных; (3) **read-only mode** — отключить writes под нагрузкой, чтения работают; (4) **feature flags** — выключить тяжёлые фичи (full search → keyword search). Принцип: «не уронить весь продукт ради одной фичи».

### Q53: Dead Letter Queue — когда сообщение туда попадает и как восстанавливать.
**A:** **DLQ** — отдельная queue, куда отправляются сообщения, которые consumer не смог обработать после N попыток. Триггеры: (1) parsing failure (schema mismatch); (2) business rule violation (некорректные данные); (3) downstream permanently broken; (4) превышен `max_retries`. Что хранить вместе с сообщением: исходный payload, последняя exception, attempt count, timestamps, причина. Восстановление: (1) **replay tool** — после фикса бага консьюмера переложить из DLQ обратно в main; (2) **manual review** для бизнес-проблем; (3) **alerting** — DLQ size > threshold → page. DLQ без процесса дренажа становится «cemetery»; должен быть owner и SLO на разгребание (например, < 100 сообщений за 24 h).

---

## 6. Algorithms для SD (Q54–Q62)

### Q54: Bloom filter — математика, гарантии, use cases.
**A:** Bit-array размера `m` + `k` независимых хэш-функций. Insert: установить `k` бит. Membership query: проверить `k` бит — если все 1, элемент возможно в множестве; если хоть один 0, точно нет. **No false negatives**; false positive rate `p ≈ (1 - e^(-kn/m))^k`. Оптимальный `k = (m/n) * ln(2)`. На практике: **~10 бит на ключ даёт ~1% FP**, ~14 бит → 0.1%. Use cases: cache penetration (проверить «может ли быть в БД» до запроса), per-SSTable filter в LSM-trees (LevelDB/RocksDB) для пропуска SSTable без disk read, web crawler dedup, distributed join (Bloom join — узлы шлют Bloom вместо полных ключей).

### Q55: Count-Min Sketch vs HyperLogLog — разные задачи.
**A:** **Count-Min Sketch (CMS)** — приближённый frequency estimation: «сколько раз встречался ключ X». Матрица `d × w` счётчиков с `d` независимых хэш-функций; increment — увеличить `d` ячеек; query — взять min. **Overestimates** (никогда underestimates). Применение: top-K на потоке (heavy hitters), rate-limit без точных счётчиков. **HyperLogLog (HLL)** — приближённый count-distinct: «сколько уникальных значений в потоке». Использует max leading zeros в hash как индикатор cardinality + harmonic mean по бакетам. ~12 KB даёт ошибку ~2% на billions of distinct. Применение: уникальные visitors на сайте, distinct IP, BigQuery `APPROX_COUNT_DISTINCT`. CMS отвечает «сколько раз», HLL — «сколько разных»; путают часто.

### Q56: HyperLogLog — почему harmonic mean и какая память.
**A:** HLL делит hash на (бакет, leading-zeros): первые `b` бит — индекс бакета (`m = 2^b` бакетов), остальные — счётчик leading zeros. Estimator: `E = α_m * m² / Σ(1 / 2^M[i])` — harmonic mean чувствителен к малым значениям, что снижает влияние outlier-бакетов. Standard error ≈ `1.04 / √m`. При `m = 16384` (b=14) — ~12 KB и ошибка ~0.81%. Дополнительно для малых cardinalities используется linear counting (Sparse representation в Redis HLL). Главное: память **константная**, не зависит от cardinality — это бьёт `HashSet` который растёт линейно.
> Flajolet et al. — «HyperLogLog: the analysis of a near-optimal cardinality estimation algorithm»

### Q57: Geohash vs S2 vs H3 vs Quadtree vs R-tree — когда что выбрать.
**A:**
- **Geohash**: 2D → 1D через Z-order curve (interleaved bits lat/lng); префикс = большая ячейка, длиннее = меньше. Простой, есть в Redis (`GEOADD`). Минус: соседние ячейки могут иметь сильно разные префиксы (jump на границах) → нужно проверять 8 соседей.
- **S2** (Google): 2D на сферу Земли → cells через Hilbert curve. 30 уровней, точность от глобуса до 1 cm². Лучше учитывает кривизну; используется в Google Maps, Foursquare.
- **H3** (Uber): hexagonal grid, 16 уровней. Преимущество гексов: одинаковое расстояние до всех 6 соседей (у квадратов 4 + 4 диагональных разной длины) → точнее для proximity/clustering. Используется Uber, Hexagon.
- **Quadtree**: рекурсивное деление 2D пространства на 4. Хорош для адаптивной плотности (мегаполис делится мельче), in-memory структура; ElasticSearch GeoPoint.
- **R-tree**: индекс для bounding boxes произвольных объектов (не точки); PostGIS `GIST`, MongoDB 2dsphere. Универсален для геометрии.

### Q58: Почему Uber выбрал H3 (hexagonal grid)?
**A:** Гексы дают равноудалённость 6 соседей (у квадратов диагональные дальше прямых на √2); это критично для **proximity-based** запросов: surge pricing, driver-rider matching, ETA. На квадратной сетке артефакты — driver чуть за углом квадрата выглядит «далеко» из-за смены ячейки. Гексы также дают более плавные «контуры» зон. H3 — иерархическая (parent/child cells), 16 уровней (от ~1 100 km до ~1 m²), быстрый geometry: `latLngToCell`, `cellToBoundary`, `gridDisk(k)` для соседей в радиусе. Open source (Uber, 2018).

### Q59: Trie для autocomplete с pre-computed top-K.
**A:** Trie — префиксное дерево, каждая нода — символ; путь от корня — префикс. Поиск всех слов с префиксом — O(prefix length). Для autocomplete нужны **top-K** suggestions, а не все — наивно: на каждый запрос обходить subtree (дорого при популярных префиксах). Оптимизация: в каждой ноде хранить **pre-computed top-K** (полный список + frequencies, обновляемый offline). Запрос: O(prefix) + копия top-K. При insertion / frequency update — bubble up изменения вверх по цепочке. Для огромных словарей (web search, miles+) — компактнее Aho-Corasick для multi-pattern, FST (Lucene's term dictionary) или DAWG (directed acyclic word graph). Дополнительные фичи autocomplete: ranking by user history, fuzzy match (edit distance), trending boost.

### Q60: Inverted index — структура и TF-IDF vs BM25 ranking.
**A:** **Inverted index** — `term → posting list` (список doc_id, где встречается term, плюс позиции и frequencies). Запрос «red car» → пересечение posting lists `red` и `car`. **TF-IDF**: `score = TF(t,d) * IDF(t)`; TF — частота term'а в документе (часто `log(1 + tf)` чтобы избежать линейного скейла), IDF — `log(N / df)` (редкие термы важнее). **BM25** — модернизация TF-IDF: term saturation (`TF / (TF + k1)` — добавление 10-го вхождения дает меньше, чем 2-го) и document length normalization (короткий документ с термой релевантнее длинного с тем же TF). `k1 = 1.2..2`, `b = 0.75` — стандартные параметры. BM25 — default ranking в Elasticsearch / OpenSearch / Lucene с 2016.
> Robertson & Zaragoza — «The Probabilistic Relevance Framework: BM25 and Beyond»

### Q61: Merkle tree для anti-entropy между репликами.
**A:** Merkle tree — бинарное дерево хэшей: листья = хэши блоков данных, внутренние ноды = хэш конкатенации детей. Корневой хэш суммирует всё содержимое. Для anti-entropy между репликами: (1) каждая реплика строит Merkle tree своих данных по диапазонам ключей; (2) реплики обмениваются root hash; (3) если совпало — данные идентичны, sync не нужен; (4) если различаются — рекурсивно сравнивают детей, доходят до конкретных diff-блоков, синхронизируют **только их**. Стоимость передачи — O(log N) вместо O(N) full sync. Используется в Dynamo, Cassandra, Riak; также в Git (хранение объектов), Bitcoin (SPV proofs), file sync (rsync — частично похожая идея).

### Q62: Bloom filter в LSM-tree — зачем per-SSTable и как ускоряет?
**A:** LSM-tree: writes → MemTable → flush → SSTables на диске. На read нужно проверить MemTable и **все** SSTables от newest к oldest до hit'а. Если ключа в БД нет — пришлось бы прочитать все SSTables (несколько disk seek's). **Bloom filter per SSTable**: при чтении сначала спросить BF — «есть ли ключ?»; если BF говорит «нет» — пропускаем SSTable без disk read. Маленький FP (1%) — иногда зря читаем SSTable, но в среднем 99% read'ов получают точный ответ без I/O. Размер: ~10 бит/ключ → ~12 MB на миллиард ключей. Применяется в LevelDB, RocksDB, Cassandra, ScyllaDB. Аналогично — partition summary file для range queries.

---

## 7. Communication (Q63–Q67)

### Q63: Short polling / long polling / SSE / WebSocket / gRPC streaming — матрица выбора.
**A:**
| Pattern | Направление | Persistent | Latency | Use case |
|---|---|---|---|---|
| Short polling | Client → Server | Нет | Интервал опроса | Простые обновления, RSS, dashboard |
| Long polling | Client ↔ Server (отложенный ответ) | Во время ожидания | ~миллисекунды | Real-time без WebSocket-инфраструктуры |
| **SSE** | Server → Client (one-way) | Да (HTTP) | Real-time | Notifications, feeds, server-pushed logs |
| **WebSocket** | Bidirectional | Да | Real-time | Chat, games, collaborative editing |
| **gRPC streaming** | Bidirectional (HTTP/2 streams) | Да | Real-time | Internal services с типизированными контрактами |

Эволюция: short polling → long polling → SSE → WebSocket → gRPC streaming (по мере роста требований к latency, throughput и tooling).

### Q64: SSE vs WebSocket — почему SSE проще для one-way?
**A:** **SSE** (Server-Sent Events) — обычный HTTP-ответ с `Content-Type: text/event-stream`, который сервер держит открытым и шлёт сообщения построчно. Преимущества: (1) работает через любой HTTP-прокси и firewall (это просто долгий HTTP-ответ); (2) автоматический reconnect и cursor (`Last-Event-ID`) встроены в браузер; (3) text-only, проще debug. **WebSocket** требует upgrade handshake, бинарный framing, отдельный код для reconnect; зато bidirectional и binary. Для one-way push (notifications, real-time прайсы, log streaming) SSE достаточен и проще. WebSocket нужен когда требуется client → server по тому же каналу (chat, games). Подводный камень SSE: некоторые old proxy буферизуют responses и ломают streaming (надо `X-Accel-Buffering: no` для Nginx).

### Q65: Backpressure — как защитить downstream от overload.
**A:** **Backpressure** — механизм, при котором consumer контролирует темп получения данных от producer; producer тормозит или буферизует, не утопит consumer'а. Реализации: (1) **Reactive Streams** (Project Reactor, RxJava, gRPC streaming) — request(n) явно запрашивает n элементов; producer не шлёт больше; (2) **bounded queues** — если очередь переполнена, producer блокируется или дропает; (3) **TCP flow control** — встроен в transport (sliding window). Anti-pattern: unbounded queue в middleware (Kafka может казаться bottomless, но память producer'а ограничена). На уровне сервисов backpressure часто заменяется **load shedding** (см. Q52) — отказать вместо тормозить.

### Q66: Webhooks — HMAC signing, idempotency, retry policy.
**A:** Webhook — provider шлёт HTTP POST на client'овский URL при событии. Безопасность: (1) **HMAC signature** — provider шлёт `X-Signature: sha256=...` с подписью payload секретом; receiver проверяет до обработки (защита от forgery); (2) **timestamp** + tolerance window (5 min) — защита от **replay attack** (Q67); (3) HTTPS обязателен. **Idempotency** на receiver: provider гарантирует at-least-once delivery (см. Stripe — retry 3 дня с exponential backoff), receiver должен дедуплицировать по `idempotency_key` или `event_id`. **Retry policy**: client отвечает 2xx — успех; 4xx — permanent fail, не retry; 5xx или timeout — retry с exp backoff; после N попыток — DLQ + alert.
> Stripe Webhooks docs

### Q67: Replay attack на webhook — как защититься.
**A:** Атака: злоумышленник перехватывает legitimate webhook request (HMAC валидный!) и replays его позже — receiver принимает за свежий, дублирует side-effect. Защита: (1) **timestamp в payload** + provider включает его в HMAC; receiver проверяет `|now - timestamp| < tolerance` (например, 5 min); устаревшие отбрасывает. (2) **nonce / event_id** — receiver хранит seen event IDs на 24 h (Redis), отвергает дубликаты. (3) Combined: timestamp + nonce. Stripe использует обе: `Stripe-Signature: t=timestamp,v1=signature`. HTTPS обязателен — без него replay тривиален, и MITM подменит payload (HMAC валидный, потому что atacker знает секрет если он утек).

---

## 8. Security & Identity (Q68–Q72)

### Q68: JWT — структура, почему signature не encryption, JWKS rotation.
**A:** JWT = `header.payload.signature` (base64url). **Header**: алгоритм (`alg: RS256`) и `kid` (key id). **Payload**: claims (`sub`, `iss`, `aud`, `exp`, `iat`, custom). **Signature**: `HMAC` (HS256) или asymmetric (`RS256`/`ES256`). **Подписан, не зашифрован** — payload читается всеми (base64 не шифр); для encryption — JWE (редко). **JWKS** (JSON Web Key Set): IdP публикует `https://issuer/.well-known/jwks.json` с public keys; consumer кэширует ключи и проверяет signature по `kid` из header. **Rotation**: IdP добавляет новый key с новым `kid`, шлёт новые токены подписанными новым ключом; старый ключ остаётся в JWKS пока live токены не истекли. Подводный камень: `alg: none` — известный exploit (если consumer не проверяет alg whitelist, attacker шлёт unsigned JWT и принимается за валидный).

### Q69: JWT revocation — стратегии и trade-offs.
**A:** JWT по дизайну stateless → revoke сложно. Стратегии:
- **Short TTL + refresh tokens**: access token 5–15 min, refresh token живёт долго, проверяется на сервере (в БД). Revoke = удалить refresh token. Простой, default в OIDC.
- **Deny-list**: хранить отозванные `jti` (JWT ID) в Redis с TTL = remaining lifetime. Каждый запрос проверяет deny-list. Compromise stateless природы, но контроль точный.
- **Allow-list / session ID inside JWT**: JWT содержит session_id, который проверяется в Redis (фактически — обычная session, JWT просто как контейнер). Stateless преимуществ ноль.
- **Key rotation**: revoke массово через смену signing key (все токены становятся невалидны). Грубо, но эффективно при крупном инциденте.

Production: short TTL + refresh rotation как база, deny-list для срочных revoke (выход с устройства, force logout).

### Q70: OAuth2 flows — Authorization Code+PKCE, Client Credentials, Refresh rotation.
**A:**
- **Authorization Code + PKCE**: для пользовательских flows (web, mobile, SPA). Client делает `code_challenge = SHA256(code_verifier)`, шлёт IdP. После consent IdP редиректит с `code`. Client обменивает `code` + `code_verifier` на access/refresh token. PKCE защищает от code interception attack (для SPA — обязателен, client secret хранить негде).
- **Client Credentials**: для machine-to-machine. Client шлёт `client_id` + `client_secret` → access token. Нет user context.
- **Refresh token rotation**: каждый refresh выпускает новый refresh token и инвалидирует старый. Если attacker украл refresh и использовал — следующий refresh легитимного пользователя свалится, можно автоматически revoke. OAuth 2.1 предписывает rotation для public clients.
- Deprecated: **Implicit flow** (выдавал token прямо в URL, легко утекал в logs/history), **Resource Owner Password Credentials** (юзер даёт пароль клиенту — антипаттерн).

### Q71: OIDC и SAML — где разница и где какой использовать.
**A:** **OIDC** (OpenID Connect) — identity layer поверх OAuth2: добавляет `id_token` (JWT с claims о пользователе: `sub`, `email`, `name`, `picture`). Modern, JSON, lightweight, удобен для web/mobile/API. Все consumer-grade IdP (Google, Auth0, Okta) → OIDC. **SAML 2.0** — XML-based, enterprise SSO standard. IdP → SP через browser POST с подписанным SAML Assertion (XML). Sluggish, complex (XML signatures, namespaces), но **обязателен** в enterprise (Active Directory Federation Services, Workday, Salesforce). Production: OIDC для consumer-facing apps; SAML — для enterprise B2B SSO. Many IdP (Keycloak, Okta) поддерживают оба; Keycloak умеет identity brokering: SAML → внутренний OIDC, чтобы app только OIDC говорил.

### Q72: DDoS mitigation — слои защиты.
**A:** Защита от DDoS — стек, ни один уровень не закрывает всё.
1. **Anycast + CDN absorption** (Cloudflare, CloudFront): атака размывается по сотням POP; CDN отбрасывает мусор до origin.
2. **L3/L4 filtering**: SYN cookies против SYN flood; rate limiting per IP / ASN; uRPF против spoofed sources.
3. **L7 rate limiting**: token bucket per user/IP/API key; tiered limits.
4. **WAF** (Web Application Firewall) с OWASP CRS: блок SQLi, XSS, path traversal, известных bot signatures.
5. **Bot management** (Cloudflare Bot Fight Mode, Akamai Bot Manager): challenge JS, behavioural analysis, ML-based scoring.
6. **Application-layer adaptive throttling**: при росте latency p99 включается load shedding (Q52).
7. **Captcha / proof-of-work** как last resort для подозрительного трафика.

Дополнительно: **Zero Trust / BeyondCorp** — внутренние сервисы не доступны из сети без mTLS + identity; убирает «защищённый периметр» как концепцию.

---

## 9. Streaming & Modern (Q73–Q80)

### Q73: MapReduce → Spark → Flink — эволюция и где какая система.
**A:** **MapReduce** (Google 2004, Hadoop): batch, map → shuffle → reduce, всё через HDFS между стадиями (медленно, но restart-friendly). **Spark** (2009): RDD (Resilient Distributed Dataset) + lazy DAG-execution; данные в памяти между стадиями → 10–100× быстрее MR на iterative workloads (ML, graph). Поддерживает streaming через **micro-batches** (Spark Streaming) — latency seconds. **Flink** (2014): true streaming с event-time semantics, **watermarks**, **exactly-once** через distributed snapshots (Chandy-Lamport), latency milliseconds; batch — частный случай streaming. Production: Spark для analytics/ML batch и near-real-time; Flink для true streaming (fraud detection, real-time pricing); MapReduce — legacy.

### Q74: Lambda vs Kappa architecture.
**A:** **Lambda** (Nathan Marz, 2011): два параллельных пайплайна — **batch layer** (Hadoop, точные результаты, латентность часы) и **speed layer** (Storm/Spark Streaming, приблизительные, латентность секунды); serving layer объединяет. Минус: два codebase, две логики — дублирование и сложность поддержки. **Kappa** (Jay Kreps, 2014): только streaming layer; reprocessing = replay от начала Kafka log с новой версией кода. Возможен благодаря Kafka retention (могут быть дни/недели) и быстрому Flink/Spark. Production: индустрия сместилась к Kappa-like (один пайплайн на Flink), где batch — это replay-сценарий, не отдельная система.

### Q75: Event-time vs processing-time и watermarks — что они дают.
**A:** **Processing time**: время обработки события в системе (wall clock машины). Простое, но недетерминировано: тот же стрим разные результаты при replay. **Event time**: время реального события (timestamp в payload). Детерминировано, но требует обработки **out-of-order** событий (лагающие мобильные клиенты могут приходить с опозданием на минуты). **Watermark** — нижняя граница event-time, гарантирующая «события старше этого времени уже не придут (с высокой вероятностью)». Когда watermark пересекает конец window — окно closes, результат emit. Late events (после watermark) либо игнорируются, либо обновляют результат (allowed lateness). Flink даёт первоклассную поддержку watermarks; Kafka Streams тоже; Spark Structured Streaming — позже.

### Q76: ML serving — online vs batch inference и роль feature store.
**A:** **Batch inference**: предсказания для всех (или большой когорты) пользователей offline, результат пишется в KV/БД, web сервит просто lookup. Дёшево, подходит для медленно меняющихся предсказаний (next-day recommendations, churn risk). **Online inference**: модель live, predict per request (real-time fraud detection, dynamic pricing, search ranking). Требует low-latency сервинга (<50 ms p99), feature lookup в hot store (Redis, DynamoDB), часто GPU. **Feature store** (Feast, Tecton): central registry features с дуальным storage — offline (BigQuery/S3 для training) и online (Redis для inference). Решает train/serve skew: одна логика расчёта фичей. **Model registry** (MLflow, Weights & Biases) — versioning моделей: какая версия в production, lineage от training data.

### Q77: Shadow deployment / canary для ML моделей.
**A:** ML модели требуют доп. осторожности: «production-ready» по тестам не гарантирует качество на real traffic. Подходы:
- **Shadow deployment**: новая модель получает копию production трафика, но её предсказания **не возвращаются** пользователю — только логируются и сравниваются с прод-моделью offline. Latency и data quality оцениваются без риска для бизнес-метрик.
- **Canary** (как обычно): 1% → 10% → 100% реального трафика; мониторинг бизнес-метрик (CTR, conversion, не только latency и error rate).
- **A/B testing**: статистически значимое сравнение моделей на сегментах, бизнес-метрики решают.
- **Champion-Challenger**: production модель = champion, новые предлагаются как challenger; auto-promote если challenger лучше N дней подряд.

Подводный камень: model drift — модель деградирует со временем (input distribution shift); нужен continuous evaluation и retraining pipeline, не только при deploy.

### Q78: Vector DB — HNSW vs IVF vs PQ trade-offs.
**A:** Approximate Nearest Neighbor (ANN) индексы:
- **HNSW** (Hierarchical Navigable Small World): multi-layer граф; на верхних слоях редкие узлы дают быстрый «прыжок» близко к target, нижние — точная навигация. Recall 95–99% при sub-10 ms на миллионы векторов. Memory-heavy (граф в RAM), быстрая insertion, не очень сжимается. Default в Pinecone, Weaviate, pgvector с 0.6+.
- **IVF** (Inverted File): clustering векторов на K центроидов; query сравнивается только с N ближайших центроидов и их членами. Меньше памяти, хуже recall (~80–90%), нужен rebuild при больших изменениях.
- **PQ** (Product Quantization): разбить вектор на subvectors, каждый кодировать индексом в codebook (e.g., 8 byte вместо 1024 float). Радикально снижает память (10–50×), теряет точность. Часто IVF + PQ комбинация (FAISS).

Production: HNSW по дефолту; IVF/PQ если миллиарды векторов и память дорогая.
> Malkov & Yashunin — HNSW paper (2016)

### Q79: RAG — chunking, re-ranking, hallucination mitigation.
**A:** RAG (Retrieval-Augmented Generation): user query → embed → ANN search → top-K документов → передать LLM как контекст → generate answer. Качество зависит от:
- **Chunking**: разбиение документов на куски. Слишком крупные (5K tokens) — теряется precision retrieval; слишком мелкие (100 tokens) — теряется контекст. Sweet spot ~500–1500 tokens с overlap 10–20%.
- **Hybrid retrieval**: vector search + BM25 (keyword) комбинированный через reciprocal rank fusion. Ловит exact match терминов, которые embedding теряет.
- **Re-ranking**: после retrieval top-100 — пропускать через cross-encoder (более точная, но дорогая модель) для precise top-K. Cohere Rerank, BGE-reranker.
- **Hallucination mitigation**: (1) явный prompt «answer only from context; if not present — say I don't know»; (2) cite sources в ответе с возможностью проверки; (3) confidence scoring через retrieval similarity threshold; (4) guardrails (Nemo Guardrails) для filter outputs.

### Q80: pgvector vs Pinecone vs Weaviate — когда какой?
**A:**
- **pgvector** (PostgreSQL extension): vector index в обычном Postgres; идеален когда у вас уже PG, ANN — побочная фича. JOINs с relational данными, transactions, не нужен отдельный сервис. Limit: миллионы векторов (десятки миллионов — borderline); HNSW добавлен в pgvector 0.5.
- **Pinecone**: managed vector DB, fully serverless; высокий QPS, авто-scaling; closed source, vendor lock-in. Для прода когда не хотите ops.
- **Weaviate / Qdrant / Milvus**: self-hosted open source; больше гибкости, hybrid search встроен (Weaviate), фильтрация по metadata. Operational overhead — есть.
- **Elasticsearch / OpenSearch с dense_vector**: если у вас уже ES для full-text, vector добавляется естественно; hybrid (BM25 + vector) из коробки.

Решение по scale + maturity vs operational cost: <10M векторов — pgvector почти всегда хватит; 100M+ или strict latency SLA — dedicated vector DB.

---

## 10. Design Problems insights (Q81–Q90)

### Q81: URL shortener — base62 vs UUID vs key generation service?
**A:** Цель — короткий, уникальный, ненумеруемый по порядку (privacy). **Counter + base62**: simple, 7 символов покрывают `62^7 ≈ 3.5 * 10^12`, но требует single counter (lock contention) или partitioned counters (Twitter Snowflake). **UUID**: легко генерируется, но 128 бит → 22+ символов после base62 — слишком длинно для URL shortener. **Hash(URL)**: предсказуемо, легко dedupe одинаковые URL, но коллизии нужно ловить. **Key Generation Service (KGS)**: отдельный сервис пакетно генерит ID и раздаёт батчами; каждый app server резервирует block из 1000, выдаёт локально, забирает следующий при истощении. Защита от 2× выдачи: KGS помечает блок как used при выдаче. Production: KGS + base62 — стандарт.

### Q82: News feed — fan-out on write vs read и celebrity problem.
**A:** **Fan-out on write** (push model): при post автор пишет в feed-table каждого follower'а. Read — простой `SELECT FROM feed WHERE user=X ORDER BY time` (fast). Минус: для celebrities (100M followers) каждый post = 100M записей; **celebrity problem**. **Fan-out on read** (pull): feed формируется при запросе: `SELECT FROM posts WHERE author IN (followees) ORDER BY time`. Read дорого, write дёшево. Минус: для активных юзеров с 1K followees — поиск по большому набору. **Hybrid push-pull**: обычные авторы → push (fan-out on write); celebrities → pull (читатель сам подмешивает их посты в свой feed). Threshold: автор с >10K followers переключается на pull-mode. Twitter, Instagram используют гибрид.

### Q83: Chat messenger — at-least-once delivery + idempotency + presence.
**A:** **Delivery**: client → broker (Kafka) → recipient. At-least-once с retry; receiver дедуплицирует по `message_id` (client-generated UUID). Persistent storage: хранить сообщения в БД (Cassandra, HBase) с partition key = conversation_id, sort key = timestamp. **Presence**: heartbeat от client'а каждые 30 s в Redis с TTL 60 s; service подписан на Redis keyspace notifications для presence updates. Альтернатива: ZooKeeper ephemeral nodes (как WhatsApp historically). **WebSocket** для real-time push, fallback на long polling / push notifications (APNS, FCM) для offline клиентов. **E2E encryption** (Signal Protocol): X3DH + Double Ratchet, ключи на устройстве, сервер только перешлёт ciphertext. Подводный камень: групповые чаты с E2E — каждое сообщение шифруется N раз для N участников (или sender keys).

### Q84: Ride sharing — почему H3 hex и как работает surge pricing.
**A:** H3 (см. Q58) даёт равноудалённость 6 соседей — критично для proximity. Dispatch: новый ride → найти drivers в радиусе через `gridDisk(rider_cell, k)` (например, k=2 → 19 hexes); сортировка по ETA, не по евклиду (real road distance). **Surge pricing**: для каждой hex-cell считаем `demand/supply` ratio в real-time (Kafka events: ride_requested, driver_available); при `ratio > threshold` поднимаем коэффициент. Surge динамичен (refresh каждые 30–60 s), но плавный (smoothing, иначе пользователи видят прыжки $5 → $25). Алгоритм должен бороться с feedback loops (повысили surge → drivers съезжаются → ratio падает → дроп surge → drivers уезжают → resurge). Решения: hysteresis, time-windowed averaging, минимальное время в surge.

### Q85: Video streaming — adaptive bitrate и CDN strategy.
**A:** **Adaptive bitrate** (HLS / DASH): видео encoded в 5–7 качествах (240p–4K), нарезано на сегменты по 2–10 s. Manifest (m3u8 для HLS, mpd для DASH) — список сегментов на каждом качестве. Player оценивает bandwidth (по download speed предыдущих сегментов), выбирает оптимальный quality для следующего; перестраивается каждый сегмент. **CDN strategy**: hot videos pre-loaded на edge (push); long-tail контент по pull cache. Latency-sensitive (live streaming): low-latency HLS (LL-HLS) с 1-секундными segments. Cost optimization: tiered storage (hot — SSD edge, warm — origin, cold — S3 Glacier для legacy). Encoding pipeline (Q85 of DESIGN_05): upload → S3 → Kafka event → encoding workers (Spark / dedicated) → transcoded versions → CDN.

### Q86: Distributed cache — consistent hashing + virtual nodes + hot key.
**A:** **Consistent hashing**: hash ring, ключи и nodes на нём; key → ближайший по часовой стрелке node. Добавление/удаление node двигает только `1/N` ключей (vs `(N-1)/N` для naive `hash % N`). **Virtual nodes**: каждая physical node представлена 100–500 точек на ring → равномерное распределение, плавная rebalance при добавлении. **Rendezvous hashing** (HRW) — альтернатива: для ключа выбрать node с max `hash(key + node)`; не нужен ring, но O(N) на ключ (на практике быстро для N до тысяч). **Hot key**: один ключ overwhelm'ит один node. Митигации: (1) **replicate hot keys** на K nodes, client читает случайную (write — все); (2) **client-side cache** для hottest keys; (3) **shard hot key** через suffix (Redis Cluster `{key}:1, {key}:2`); (4) detect через top-K monitoring на cache server.

### Q87: Notification system — multi-channel routing, retry с DLQ, scheduling.
**A:** Архитектура: producer публикует `Notification(user_id, type, payload)` → preference service выбирает каналы (push / email / SMS) на основе user settings → fan-out в Kafka topic per channel → channel-specific worker (FCM/APNS для push, SendGrid/SES для email, Twilio для SMS). Каждый worker имеет retry policy: push 3× за 1 час, email — 5× за 24 часа, SMS — 2× за 30 мин (SMS дорогой, не молотим). **DLQ** per channel — сообщения после retry exhaustion для manual review / replay. **Scheduling**: delayed notifications через time-bucketed queues (TimerWheel) или Kafka с producer-set timestamp (consumer спит до часа N). **Throttling per user**: nobody likes 50 push notifications/day — rate-limit per user via Redis sliding window. **Deduplication**: idempotency key для предотвращения дублей при retry producer'а.

### Q88: Web crawler — politeness, URL frontier, dedup via Bloom.
**A:** **URL frontier**: priority queue URL'ов к crawlу; разделена per domain для **politeness** (max 1 request per domain per N сек, иначе DDoS-ish). Реализация — distributed Redis queues, partitioned by domain hash. **robots.txt**: парсится, кэшируется (per domain TTL 24 h); запрещённые paths не crawl'ятся. **Deduplication**: уже посещённые URL'ы в Bloom filter (~миллиарды URL × 10 бит/key ≈ TBs RAM кластерно). FP до 1% — несколько повторных crawls, не критично. **Content dedup**: hash(content) для определения дубликатов страниц с разных URL (mirrors, query string variations). **Crawl budget**: prioritisation по PageRank-like score + recency (freshness vs coverage). Distributed crawlers через consistent hashing по domain'у — каждый worker отвечает за свой набор доменов.

### Q89: KV store Dynamo-style — vnodes, quorum, sloppy quorum + hinted handoff, Merkle anti-entropy.
**A:** Архитектура Dynamo (и потомков — Cassandra, Riak): (1) **Consistent hashing + vnodes** — equal distribution и плавный rebalance; (2) **N replicas** (typically 3); (3) **Quorum read/write** R+W>N для strong; R=W=1 — eventual; (4) **Sloppy quorum + hinted handoff**: если один из N replicas недоступен, write идёт на следующую available node с `hint` — кому передать когда оригинал восстановится. Даёт высокую write availability в раздел, ценой временной violation R+W>N инварианта; (5) **Anti-entropy**: периодический Merkle tree exchange между репликами для catch-up на missed writes (см. Q61); (6) **Read repair**: при quorum read обнаружены расходящиеся версии → последняя записывается всем репликам в фоне; (7) **Vector clocks** для conflict detection между concurrent writes; разрешение — application logic (Riak) или LWW (Cassandra).
> Dynamo paper — DeCandia et al. (SOSP 2007)

### Q90: Payment ledger — double-entry, idempotency, Saga, compliance retention.
**A:** **Double-entry accounting**: каждая транзакция — 2+ записи (debit one account, credit another), сумма по всем accounts всегда 0. Невозможность «потерять» деньги: периодический `SUM(balance)` должен сходиться. **Idempotency** обязательна: client посылает `idempotency_key` для каждого charge; повтор с тем же key возвращает закэшированный результат (см. Q24). **Saga** для multi-leg transfers (USD → EUR через intermediate): шаги hold_source → debit_source → credit_dest → release_hold; compensation в обратном порядке при сбое. **Eventual consistency** недопустим — финальный баланс должен быть точным; используется PostgreSQL/MySQL с serializable isolation для critical writes, append-only ledger для audit (часто event sourcing). **Compliance retention**: PCI DSS — не хранить full card в БД (tokenisation через Stripe/Adyen); SOX — храним audit trail минимум 7 лет; GDPR — конфликт между «right to erasure» и audit retention решается через crypto-erasure (удалить ключ → данные нечитаемы) или анонимизацию.

---

## Литература

- Designing Data-Intensive Applications — Martin Kleppmann (must-read)
- System Design Interview Vol 1 & 2 — Alex Xu
- Site Reliability Engineering — Google SRE Book
- The Architecture of Open Source Applications — `aosabook.org`
- Papers We Love — `paperswelove.org`
- High Scalability blog — `highscalability.com`
- AWS / Google Cloud / Azure architecture centers
