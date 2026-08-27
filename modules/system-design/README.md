# system-design

Полноценный курс **System Design Interview Prep** для senior backend (продуктовый / финтех). Покрывает scaling fundamentals, distributed primitives, reliability patterns, algorithms для SD, и 14 классических design problems.

## Структура

```
modules/system-design/
├── theory/                                # 40+ файлов теории + 14 design problems
│   ├── (Fundamentals)
│   │   ├── SCALING.md, DNS.md, CDN.md, LOAD_BALANCER.md, REVERSE_PROXY.md
│   │   ├── LATENCY_NUMBERS.md, CAPACITY_ESTIMATION.md
│   ├── (Interview)
│   │   └── INTERVIEW_FRAMEWORK.md
│   ├── (Distributed primitives)
│   │   ├── distributed_systems.md (CAP/PACELC/Lamport/quorum)
│   │   ├── CONSENSUS.md, LEADER_ELECTION.md, GOSSIP_PROTOCOL.md, CRDT.md, MULTI_REGION.md
│   ├── (Microservice patterns)
│   │   ├── ../microservices/theory/DISTRIBUTED_TRANSACTIONS.md (Saga, Outbox, Circuit Breaker, CQRS, Event Sourcing)
│   │   ├── kafka.md (Kafka deep)
│   │   └── RELIABILITY_PATTERNS.md (retry/jitter/DLQ/hedged/load shedding)
│   ├── (Algorithms для SD)
│   │   ├── PROBABILISTIC_STRUCTURES.md (Bloom/CMS/HLL)
│   │   ├── GEOSPATIAL.md (Geohash/S2/H3/Quadtree)
│   │   ├── TRIE.md, INVERTED_INDEX.md, MERKLE_TREE.md
│   ├── (Communication)
│   │   ├── http_networking.md, COMMUNICATION_PATTERNS.md, WEBHOOKS.md
│   ├── (Streaming / Modern)
│   │   ├── STREAM_PROCESSING.md (MapReduce/Spark/Flink/Lambda-Kappa)
│   │   ├── ML_SERVING.md, VECTOR_DBS_RAG.md
│   ├── (Security)
│   │   ├── identity_providers.md (JWT/OAuth/OIDC/SAML/Keycloak)
│   │   └── DDOS_WAF.md
│   ├── (Design Problems — формат Alex Xu)
│   │   ├── DESIGN_01_URL_SHORTENER.md
│   │   ├── DESIGN_02_NEWS_FEED.md
│   │   ├── DESIGN_03_CHAT_MESSENGER.md
│   │   ├── DESIGN_04_RIDE_SHARING.md
│   │   ├── DESIGN_05_VIDEO_STREAMING.md
│   │   ├── DESIGN_06_FILE_STORAGE.md
│   │   ├── DESIGN_07_RATE_LIMITER.md
│   │   ├── DESIGN_08_DISTRIBUTED_CACHE.md
│   │   ├── DESIGN_09_NOTIFICATION_SYSTEM.md
│   │   ├── DESIGN_10_SEARCH_AUTOCOMPLETE.md
│   │   ├── DESIGN_11_WEB_CRAWLER.md
│   │   ├── DESIGN_12_KV_STORE.md
│   │   ├── DESIGN_13_PAYMENT_LEDGER.md
│   │   └── DESIGN_14_LEADERBOARD.md
├── README.md, ROADMAP.md, _SUMMARY.md
└── INTERVIEW_QUESTIONS.md
```

> **Чисто теоретический модуль** — нет `pom.xml`, нет упражнений. Applied concurrency-задачи (Reservation/Bank/OrderBook/Scheduler/RateLimiter) перенесены в [`modules/concurrency/`](../concurrency/) как `applied/`.

## Темы (NO OVERLAP)

В этом модуле — **System Design Interview Prep**: фундамент + design problems + современные темы. Перекрывающиеся темы canonical в других модулях:

- **Транзакции/индексы/storage engines/replication/sharding** → [`modules/databases/`](../databases/)
- **Кэширование (cache patterns/eviction/Redis/CDN cache headers)** → [`modules/caching-deep-dive/`](../caching-deep-dive/)
- **Secrets / Vault / mTLS** → [`modules/infrastructure/`](../infrastructure/)
- **SOLID / Stream API / FP / testing** → [`modules/software-engineering/`](../software-engineering/)
- **Spring Security / Spring Cloud impl** → [`modules/spring-frameworks/`](../spring-frameworks/)
- **Observability / K8s / Helm** → [`modules/infrastructure/`](../infrastructure/)
- **JVM internals** → [`modules/java-core/`](../java-core/)

## Интервью-вопросы

См. [INTERVIEW_QUESTIONS.md](INTERVIEW_QUESTIONS.md) — формат `qa-bold`.

## Semantic Summary

См. [_SUMMARY.md](_SUMMARY.md).

## Источники

- *System Design Interview Vol. 1 + 2* (Alex Xu, ByteByteGo)
- [donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer)
- [Hello Interview](https://www.hellointerview.com/)
- [Karan Pratap Singh — System Design](https://github.com/karanpratapsingh/system-design)
- *Designing Data-Intensive Applications* (Martin Kleppmann, 2017)
- *Site Reliability Engineering* (Beyer et al., Google, 2016)
