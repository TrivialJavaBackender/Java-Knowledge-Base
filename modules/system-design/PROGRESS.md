# Progress Tracker — System Design

## Статус модулей

| Модуль | Статус | Дата начала | Дата завершения |
|--------|--------|-------------|-----------------|
| 1. Foundations (Scaling/DNS/CDN/LB/Latency)     | ⬜ не начат | — | — |
| 2. Interview Framework                          | ⬜ не начат | — | — |
| 3. Distributed Primitives                       | ⬜ не начат | — | — |
| 4. Microservice Patterns                        | ⬜ не начат | — | — |
| 5. Algorithms для SD                            | ⬜ не начат | — | — |
| 6. Communication                                | ⬜ не начат | — | — |
| 7. Security                                     | ⬜ не начат | — | — |
| 8. Streaming & Modern                           | ⬜ не начат | — | — |
| 9. Design Problems (14 classical)               | ⬜ не начат | — | — |

## Теория

| Файл | Тема | Изучено |
|------|------|---------|
| [SCALING.md](theory/SCALING.md) | Vertical/horizontal scaling, шаги масштабирования | ⬜ |
| [DNS.md](theory/DNS.md) | DNS hierarchy, record types, routing methods | ⬜ |
| [CDN.md](theory/CDN.md) | CDN providers, pull/push, signed URLs | ⬜ |
| [LOAD_BALANCER.md](theory/LOAD_BALANCER.md) | L4/L7, алгоритмы, anycast | ⬜ |
| [REVERSE_PROXY.md](theory/REVERSE_PROXY.md) | Nginx/HAProxy/Envoy сравнение | ⬜ |
| [LATENCY_NUMBERS.md](theory/LATENCY_NUMBERS.md) | Jeff Dean's table, USL | ⬜ |
| [CAPACITY_ESTIMATION.md](theory/CAPACITY_ESTIMATION.md) | Back-of-envelope методология | ⬜ |
| [INTERVIEW_FRAMEWORK.md](theory/INTERVIEW_FRAMEWORK.md) | Пошаговый алгоритм для SD-интервью | ⬜ |
| [distributed_systems.md](theory/distributed_systems.md) | CAP, PACELC, Lamport, quorum | ⬜ |
| [CONSENSUS.md](theory/CONSENSUS.md) | Raft, Paxos, ZAB | ⬜ |
| [LEADER_ELECTION.md](theory/LEADER_ELECTION.md) | Bully, Raft, ZK, lease-based | ⬜ |
| [GOSSIP_PROTOCOL.md](theory/GOSSIP_PROTOCOL.md) | SWIM, anti-entropy | ⬜ |
| [CRDT.md](theory/CRDT.md) | G-Counter, OR-Set, LWW, RGA для collab | ⬜ |
| [MULTI_REGION.md](theory/MULTI_REGION.md) | Active-active/passive, Spanner-like | ⬜ |
| [microservice_patterns.md](theory/microservice_patterns.md) | Saga, Outbox, CB, CQRS, Event Sourcing | ⬜ |
| [kafka.md](theory/kafka.md) | Kafka deep (partitions, exactly-once, KRaft) | ⬜ |
| [RELIABILITY_PATTERNS.md](theory/RELIABILITY_PATTERNS.md) | Retry/jitter, DLQ, hedged, load shedding | ⬜ |
| [PROBABILISTIC_STRUCTURES.md](theory/PROBABILISTIC_STRUCTURES.md) | Bloom, CMS, HyperLogLog | ⬜ |
| [GEOSPATIAL.md](theory/GEOSPATIAL.md) | Geohash, S2, H3, Quadtree, R-tree | ⬜ |
| [TRIE.md](theory/TRIE.md) | Prefix tree для autocomplete | ⬜ |
| [INVERTED_INDEX.md](theory/INVERTED_INDEX.md) | Full-text search internals | ⬜ |
| [MERKLE_TREE.md](theory/MERKLE_TREE.md) | Anti-entropy, SPV proofs | ⬜ |
| [http_networking.md](theory/http_networking.md) | HTTP/2/3, TLS, WebSocket | ⬜ |
| [COMMUNICATION_PATTERNS.md](theory/COMMUNICATION_PATTERNS.md) | Long polling/SSE/WS/gRPC streaming | ⬜ |
| [WEBHOOKS.md](theory/WEBHOOKS.md) | HMAC signing, idempotency, retry | ⬜ |
| [identity_providers.md](theory/identity_providers.md) | JWT, OAuth2, OIDC, SAML, Keycloak | ⬜ |
| [DDOS_WAF.md](theory/DDOS_WAF.md) | DDoS mitigation, WAF, Zero Trust | ⬜ |
| [STREAM_PROCESSING.md](theory/STREAM_PROCESSING.md) | MapReduce/Spark/Flink, Lambda/Kappa | ⬜ |
| [ML_SERVING.md](theory/ML_SERVING.md) | Online/batch inference, feature stores | ⬜ |
| [VECTOR_DBS_RAG.md](theory/VECTOR_DBS_RAG.md) | Vector DBs, ANN, RAG architecture | ⬜ |

## Design Problems

| # | Файл | Статус |
|---|------|--------|
| 01 | [URL Shortener](theory/DESIGN_01_URL_SHORTENER.md) | ⬜ |
| 02 | [News Feed](theory/DESIGN_02_NEWS_FEED.md) | ⬜ |
| 03 | [Chat Messenger](theory/DESIGN_03_CHAT_MESSENGER.md) | ⬜ |
| 04 | [Ride Sharing](theory/DESIGN_04_RIDE_SHARING.md) | ⬜ |
| 05 | [Video Streaming](theory/DESIGN_05_VIDEO_STREAMING.md) | ⬜ |
| 06 | [File Storage](theory/DESIGN_06_FILE_STORAGE.md) | ⬜ |
| 07 | [Distributed Rate Limiter](theory/DESIGN_07_RATE_LIMITER.md) | ⬜ |
| 08 | [Distributed Cache](theory/DESIGN_08_DISTRIBUTED_CACHE.md) | ⬜ |
| 09 | [Notification System](theory/DESIGN_09_NOTIFICATION_SYSTEM.md) | ⬜ |
| 10 | [Search Autocomplete](theory/DESIGN_10_SEARCH_AUTOCOMPLETE.md) | ⬜ |
| 11 | [Web Crawler](theory/DESIGN_11_WEB_CRAWLER.md) | ⬜ |
| 12 | [KV Store (Dynamo-style)](theory/DESIGN_12_KV_STORE.md) | ⬜ |
| 13 | [Payment Ledger](theory/DESIGN_13_PAYMENT_LEDGER.md) | ⬜ |
| 14 | [Leaderboard](theory/DESIGN_14_LEADERBOARD.md) | ⬜ |

---
Легенда: ⬜ не начато | 🔄 в процессе | ✅ завершено
