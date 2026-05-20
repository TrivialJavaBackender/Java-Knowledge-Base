# System Design — Semantic Summary

## Core Model
System Design Interview Prep = **scaling fundamentals** (как растёт архитектура с пользователями) + **distributed primitives** (CAP/quorum/consensus как договариваются узлы) + **reliability patterns** (как переживать сбои) + **algorithms для SD** (Bloom/Geohash/Trie) + **design templates** (URL shortener, Twitter feed, Uber и т.д.). Главный навык — обосновывать **trade-off**, не «лучшее решение».

## Key Concepts

### Fundamentals
- **Scaling progression**: single server → DB tier → multi-instance + LB → read replicas → caching → sharding → microservices → multi-region
- **DNS**: иерархия (root → TLD → authoritative), record types (A/AAAA/CNAME/MX/NS), TTL trade-off, GeoDNS routing
- **CDN**: pull vs push, edge cache hierarchy, signed URLs, versioned URLs vs purge, multi-CDN strategy
- **Load Balancer**: L4 vs L7, алгоритмы (round-robin/least-conn/IP-hash/consistent-hash), health checks, sticky sessions, anycast
- **Latency Numbers** (Jeff Dean): L1 cache 1ns → RAM 100ns → SSD random 10µs → DC RT 500µs → cross-region 150ms
- **Capacity estimation**: DAU × actions = total ops; peak = 2-10× avg; powers of two; storage × replication factor

### Distributed primitives
- **CAP / PACELC**: при partition — A vs C; иначе latency vs consistency. PostgreSQL=PC/EC, Cassandra=PA/EL, Spanner=PC/EC.
- **Quorum** R+W>N → strong consistency; Lamport/vector clocks для causal order
- **Consensus**: Raft (modern), Paxos (legacy), ZAB. Use cases: etcd, KRaft, Consul, CockroachDB
- **Leader election**: Bully (simple), Raft-based, ZK ephemeral znodes, lease-based с fencing token
- **Gossip**: SWIM в Memberlist (Consul, Serf); decentralized cluster state propagation O(log N)
- **CRDT**: G-Counter, PN-Counter, OR-Set, LWW-Register; math-guaranteed merge для multi-leader replication
- **Multi-region**: active-passive (simple, RTO minutes), active-active (low latency, conflict resolution), Spanner-like (TrueTime для global strong consistency)

### Reliability
- **Retry с exponential backoff + full jitter** (AWS recipe) — defeats retry storm
- **Circuit breaker** (CLOSED → OPEN → HALF-OPEN); CCB (concurrency-limited); adaptive (Netflix concurrency-limits)
- **Bulkhead** — thread pool / connection pool isolation per downstream
- **Hedged requests** (Dean & Barroso «Tail at Scale») — duplicate request after p95, reduce p99 5-10×
- **Load shedding**, **DLQ**, **graceful degradation** (stale cache / default values / read-only mode)
- **Idempotency keys** — обязательны для retry safety, Stripe-style

### Algorithms для SD
- **Bloom filter** — membership query, no false negatives, 10 bits/key @ 1% FP; для cache penetration
- **Count-Min Sketch** — frequency estimation, overestimates
- **HyperLogLog** — count distinct в ~12 KB для billions
- **Geohash / S2 / H3 / Quadtree / R-tree** — geospatial indexing для Uber-like
- **Trie** — autocomplete (с pre-computed top-K в каждом node)
- **Inverted index** — full-text search (Lucene/ES); TF-IDF / BM25 ranking
- **Merkle tree** — anti-entropy для replica sync; SPV proofs

### Communication
- **HTTP/1.1/2/3/QUIC** — HOL blocking solved in HTTP/3
- **WebSocket** для bidirectional real-time; **SSE** для one-way push; **gRPC streaming** для typed internal
- **Webhooks** — HMAC signing, idempotency на receiver, retry с exponential backoff (Stripe 3 days)
- **Backpressure** — Reactive Streams, bounded queues; protect downstream

### Modern
- **Stream processing**: MapReduce → Spark (RDD + lazy DAG) → Flink (event-time + watermarks + exactly-once); Lambda vs Kappa
- **ML serving**: online vs batch inference, feature stores (Feast), model registry (MLflow), shadow deployment
- **Vector DBs + RAG**: HNSW/IVF/PQ ANN algorithms; pgvector/Pinecone/Weaviate; chunking, re-ranking, hallucination mitigation

### Microservices
- **Saga** (choreography vs orchestration), **Outbox** (atomic publish), **CQRS**, **Event Sourcing** + snapshots
- **API Gateway**, **Service Discovery**, **Service Mesh** (Istio/Linkerd)
- **gRPC vs REST vs GraphQL**, **sync vs async (Kafka/RabbitMQ)** trade-offs
- **Deployment**: Blue/Green, Rolling, Canary, A/B

### Security
- **JWT** (header.payload.signature, JWKS, revocation strategies)
- **OAuth2 flows**: Authorization Code + PKCE, Client Credentials, Refresh rotation
- **OIDC**: id_token поверх OAuth2
- **SAML 2.0**: enterprise SSO через XML POST-binding
- **Keycloak**: realms, identity brokering, user federation
- **bcrypt / Argon2id** для password storage (NOT SHA-256 alone)
- **DDoS protection**: CDN absorption, SYN cookies, rate limit, WAF (OWASP CRS)
- **Zero Trust / BeyondCorp**: no trusted network

### Design Problems (14)
URL shortener, news feed, chat messenger, ride sharing, video streaming, file storage, distributed rate limiter, distributed cache, notification system, search autocomplete, web crawler, KV store (Dynamo-style), payment ledger, leaderboard.

## Important Invariants
- **CAP**: при partition — выбирай 2 из 3 (P отказаться нельзя)
- **PACELC**: в нормальном режиме — latency vs consistency trade-off платится постоянно
- **Quorum** R+W>N — необходимо для strong consistency в leaderless
- **Circuit Breaker states transition**: CLOSED → OPEN (failures) → HALF-OPEN (probe) → CLOSED (success)
- **Outbox**: at-least-once delivery, consumer должен быть idempotent
- **Bloom Filter**: no false negatives — если говорит «нет», точно нет
- **HNSW**: high recall (95-99%) с sub-10ms latency на 1M+ vectors
- **Webhook**: receiver должен быть idempotent (at-least-once delivery от provider)

## Common Pitfalls
- **Distributed lock без TTL** → deadlock if holder crashes
- **Saga без idempotency** → duplicate compensating transactions
- **Fan-out on write для celebrity** (100M followers) — overwhelming. Hybrid push-pull нужен.
- **CDN cache cookies в Vary** → fragmentation; не кэшируется
- **Naive backoff без jitter** → retry storm; full jitter обязателен
- **Cross-region sync replication** → каждый write 100ms+. Async + conflict resolution.
- **WAF without tuning** → false positives → disabled
- **Trie без top-K per node** → expensive search on each query
- **Vector DB для structured queries** → use SQL
- **Single-region ML serving с global users** → unacceptable latency
- **No idempotency key для payment retry** → double charge
- **«PostgreSQL slow → use Cassandra»** без understanding tradeoffs

## Related Modules
- **`databases`** — transactions, indexes, storage engines, replication, sharding
- **`caching-deep-dive`** — cache patterns, eviction, Redis, CDN headers, anti-patterns (stampede, penetration)
- **`infrastructure`** — K8s, Docker, observability, secrets, SLI/SLO
- **`software-engineering`** — SOLID, Stream API, testing (chaos engineering, contract testing)
- **`spring-frameworks`** — Spring Security/Cloud impl, Hibernate
- **`concurrency`** — applied locking exercises (reservations, bank, order book)
- **`java-core`** — JVM internals под Java backend
- **`kotlin-coroutines`** — Kotlin async / Flow patterns
- **`graphql-kotlin`** — GraphQL-specific design (federation, DataLoader)
