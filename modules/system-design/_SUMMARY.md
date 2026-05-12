# System Design — Semantic Summary

## Core Model
- Distributed systems trade consistency for availability (CAP); design decisions flow from that trade-off
- ACID is a local (single-node) guarantee; distributed transactions require Saga, 2PC, or eventual consistency
- Security = authentication (identity) + authorization (permissions) + secret management (credentials)

## Key Concepts
- **Transactions**: ACID; isolation levels (READ COMMITTED → SERIALIZABLE); MVCC (non-blocking reads via snapshot); 2PC for distributed
- **Indexes**: B-tree (range queries, ordered), hash index (point lookup); MVCC versions; index-only scan avoids heap fetch
- **Distributed systems**: CAP theorem; distributed locks (Redis Redisson, DB-based); consensus (Raft/Paxos concept)
- **Microservice patterns**: Saga (choreography/orchestration), Outbox (at-least-once delivery), Circuit Breaker (fail-fast), Strangler Fig (migration)
- **Kafka**: topics/partitions/offsets; consumer groups (each partition → one consumer); replication factor + ISR; producer acks
- **Auth**: JWT (header.payload.signature, stateless); OAuth2 flows (code, client credentials, device); OIDC adds ID token + UserInfo
- **Identity**: SAML 2.0 (XML, enterprise SSO); OIDC (JSON, modern federated); Keycloak as IdP; federation protocols
- **Secrets**: Vault (dynamic secrets, lease/renew/revoke); bcrypt/Argon2 (password hashing, not encryption); envelope encryption; K8s Secrets (base64, not encrypted by default)
- **Design**: SOLID principles; stream API patterns (map/filter/reduce/collect); testing pyramid (unit fast, integration slower, E2E slowest)

## Important Invariants
- MVCC: readers never block writers; each transaction sees a snapshot at its start time
- Outbox pattern guarantees at-least-once (idempotent consumers required)
- Circuit Breaker states: closed → open (on failures) → half-open (probe) → closed (on success)
- JWT is stateless: server holds no session; revocation requires token blacklist or short TTL
- bcrypt/Argon2 are intentionally slow (KDF); use for passwords, not general data encryption
- Kafka partition count limits consumer group parallelism (max 1 consumer per partition)

## Common Pitfalls
- Distributed lock without TTL → deadlock if lock holder crashes
- Saga without idempotency → duplicate compensating transactions
- Fan-out on write (push to all followers) is expensive for high-follower accounts → fan-out on read
- OAuth2 access token in URL query param → logged in proxy/server logs
- B-tree index on low-cardinality column (e.g., boolean) → full table scan still preferred

## Related Modules
- `spring-frameworks` — Spring Security (OAuth2/JWT implementation), Spring Cloud (Circuit Breaker, Feign)
- `infrastructure` — Kubernetes Secrets, Vault sidecar injection, deployment strategies
- `caching-deep-dive` — consistency models, CDC (event-driven invalidation)
