# System Design — Roadmap

Порядок прохождения: **Foundations → Interview Framework → Distributed primitives → Reliability → Algorithms → Communication → Modern → Design Problems**. Перенесённые упражнения по applied concurrency — в [`modules/concurrency/`](../concurrency/).

---

## Модуль 1 — Foundations (обязательно)

📖 Теория:
- [theory/SCALING.md](theory/SCALING.md) — vertical/horizontal scaling, stateless vs stateful
- [theory/DNS.md](theory/DNS.md) — DNS record types, TTL, GeoDNS, DNSSEC
- [theory/CDN.md](theory/CDN.md) — push vs pull, signed URLs, multi-CDN
- [theory/LOAD_BALANCER.md](theory/LOAD_BALANCER.md) — L4 vs L7, алгоритмы, sticky sessions, anycast
- [theory/REVERSE_PROXY.md](theory/REVERSE_PROXY.md) — Nginx/HAProxy/Envoy/Traefik
- [theory/LATENCY_NUMBERS.md](theory/LATENCY_NUMBERS.md) — Jeff Dean's table + USL
- [theory/CAPACITY_ESTIMATION.md](theory/CAPACITY_ESTIMATION.md) — back-of-envelope estimation
- [theory/http_networking.md](theory/http_networking.md) — HTTP/2/3, TLS, WebSocket basics

---

## Модуль 2 — Interview Framework

📖 [theory/INTERVIEW_FRAMEWORK.md](theory/INTERVIEW_FRAMEWORK.md) — пошаговый алгоритм для SD-интервью.

- [ ] Functional vs non-functional requirements
- [ ] Capacity estimation на интервью
- [ ] API design first
- [ ] High-level architecture
- [ ] Trade-off framework

---

## Модуль 3 — Distributed Primitives

📖 Теория:
- [theory/distributed_systems.md](theory/distributed_systems.md) — CAP, PACELC, Lamport, quorum, consistency spectrum
- [theory/CONSENSUS.md](theory/CONSENSUS.md) — Raft, Paxos, ZAB
- [theory/LEADER_ELECTION.md](theory/LEADER_ELECTION.md) — Bully, Raft, ZK, lease-based
- [theory/GOSSIP_PROTOCOL.md](theory/GOSSIP_PROTOCOL.md) — SWIM, anti-entropy
- [theory/CRDT.md](theory/CRDT.md) — G-Counter, PN-Counter, OR-Set, LWW-Register
- [theory/MULTI_REGION.md](theory/MULTI_REGION.md) — active-active, active-passive, Spanner-like

---

## Модуль 4 — Microservice Patterns

📖 Теория:
- [../microservices/theory/DISTRIBUTED_TRANSACTIONS.md](../microservices/theory/DISTRIBUTED_TRANSACTIONS.md) — Saga, Outbox, Circuit Breaker, CQRS, Event Sourcing, deployment strategies
- [theory/kafka.md](theory/kafka.md) — Kafka deep (partitions, exactly-once, ISR, KRaft)
- [theory/RELIABILITY_PATTERNS.md](theory/RELIABILITY_PATTERNS.md) — retry/jitter/DLQ/hedged/load shedding

---

## Модуль 5 — Algorithms для SD

📖 Теория:
- [theory/PROBABILISTIC_STRUCTURES.md](theory/PROBABILISTIC_STRUCTURES.md) — Bloom, CMS, HyperLogLog
- [theory/GEOSPATIAL.md](theory/GEOSPATIAL.md) — Geohash, S2, H3, Quadtree, R-tree
- [theory/TRIE.md](theory/TRIE.md) — prefix tree для autocomplete
- [theory/INVERTED_INDEX.md](theory/INVERTED_INDEX.md) — search engine fundamentals (Lucene/ES)
- [theory/MERKLE_TREE.md](theory/MERKLE_TREE.md) — anti-entropy, SPV proofs

---

## Модуль 6 — Communication

📖 Теория:
- [theory/COMMUNICATION_PATTERNS.md](theory/COMMUNICATION_PATTERNS.md) — long polling vs SSE vs WebSocket vs gRPC streaming
- [theory/WEBHOOKS.md](theory/WEBHOOKS.md) — HMAC signing, idempotency, retry policies

---

## Модуль 7 — Security

📖 Теория:
- [theory/identity_providers.md](theory/identity_providers.md) — JWT, OAuth2, OIDC, SAML, Keycloak
- [theory/DDOS_WAF.md](theory/DDOS_WAF.md) — DDoS mitigation, WAF, Zero Trust

---

## Модуль 8 — Streaming & Modern

📖 Теория:
- [theory/STREAM_PROCESSING.md](theory/STREAM_PROCESSING.md) — MapReduce, Spark, Flink, Lambda vs Kappa
- [theory/ML_SERVING.md](theory/ML_SERVING.md) — online vs batch inference, feature stores
- [theory/VECTOR_DBS_RAG.md](theory/VECTOR_DBS_RAG.md) — vector databases, ANN, RAG

---

## Модуль 9 — Design Problems (14 классических)

📖 Format: Requirements → Estimation → API → Architecture → Deep dive → Trade-offs.

| # | Problem | Главные концепты |
|---|---------|------------------|
| 01 | [URL Shortener](theory/DESIGN_01_URL_SHORTENER.md) | base62, KGS, cache, redirect latency |
| 02 | [News Feed](theory/DESIGN_02_NEWS_FEED.md) | fan-out on write vs read, celebrity problem |
| 03 | [Chat Messenger](theory/DESIGN_03_CHAT_MESSENGER.md) | WebSocket, presence, push, E2E |
| 04 | [Ride Sharing](theory/DESIGN_04_RIDE_SHARING.md) | H3 hexagonal indexing, surge, dispatch |
| 05 | [Video Streaming](theory/DESIGN_05_VIDEO_STREAMING.md) | HLS/DASH, adaptive bitrate, CDN |
| 06 | [File Storage](theory/DESIGN_06_FILE_STORAGE.md) | chunking, dedup, sync, CDC chunking |
| 07 | [Rate Limiter](theory/DESIGN_07_RATE_LIMITER.md) | token bucket, sliding window, Redis Lua |
| 08 | [Distributed Cache](theory/DESIGN_08_DISTRIBUTED_CACHE.md) | consistent hashing, hot key, replication |
| 09 | [Notification System](theory/DESIGN_09_NOTIFICATION_SYSTEM.md) | multi-channel, retry, DLQ, scheduling |
| 10 | [Search Autocomplete](theory/DESIGN_10_SEARCH_AUTOCOMPLETE.md) | Trie с top-K, real-time refresh |
| 11 | [Web Crawler](theory/DESIGN_11_WEB_CRAWLER.md) | URL frontier, politeness, dedup, robots.txt |
| 12 | [KV Store](theory/DESIGN_12_KV_STORE.md) | Dynamo, vnodes, quorum, anti-entropy |
| 13 | [Payment Ledger](theory/DESIGN_13_PAYMENT_LEDGER.md) | double-entry, idempotency, Saga, compliance |
| 14 | [Leaderboard](theory/DESIGN_14_LEADERBOARD.md) | Redis ZSET, tie-breaking, sharding, top-K |
