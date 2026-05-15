# System Design — Semantic Summary

## Core Model
- Distributed systems trade consistency for availability (CAP); design decisions flow from that trade-off
- ACID is a local (single-node) guarantee; distributed transactions require Saga, 2PC, or eventual consistency
- Security = authentication (identity) + authorization (permissions) + secret management (credentials)

## Key Concepts
- **Transactions**: ACID; isolation levels (READ COMMITTED → SERIALIZABLE); MVCC (non-blocking reads via snapshot); 2PC for distributed
- **Indexes**: B-tree (range queries, ordered), hash index (point lookup); MVCC versions; index-only scan avoids heap fetch
- **Distributed systems** (теория/примитивы): CAP / PACELC; quorum (R + W > N); Lamport / vector clocks для causal order; eventual vs strong consistency (read-your-writes, monotonic reads, causal, bounded staleness); distributed locks (Redis Redisson); idempotency key; clock skew (часы не доверять)
- **Microservice patterns** (архитектурные паттерны): Saga (choreography/orchestration); Outbox (at-least-once delivery, transactional); 2PC vs Saga trade-off; CQRS (write/read разделение); Event Sourcing; API Gateway; Service Discovery; Circuit Breaker (fail-fast); Bulkhead; Strangler Fig; deployment strategies (Blue/Green, Canary, Rolling, A/B)
- **Kafka**: topics/partitions/offsets; consumer groups (each partition → one consumer); replication factor + ISR; producer acks
- **Auth & Identity**: JWT (header.payload.signature, stateless, JWKS verification, revocation via blocklist/short-TTL/introspection); OAuth2 flows (Authorization Code + PKCE, Client Credentials, Refresh rotation); OIDC adds id_token + Discovery; SAML 2.0 (XML, enterprise SSO via POST-binding); Keycloak (realms, clients, identity brokering, user federation); password storage (bcrypt/Argon2id, salt, DelegatingPasswordEncoder)
- **Secrets (ops)**: Vault (Seal/Unseal Shamir, auth methods, dynamic secrets with lease/renew/revoke); envelope encryption (KEK + DEK); Terraform state encryption; K8s Secrets (base64 ≠ encryption, ESO/Vault sidecar); SOPS for encrypted-secrets-in-git; mTLS for service-to-service identity
- **Event sourcing**: append-only event log; replay → current state; snapshots для скорости восстановления; schema evolution через upcasting / Avro Schema Registry / versioned event types
- **Design**: SOLID principles; stream API patterns (map/filter/reduce/collect); functional principles (HOF, referential transparency, immutability); JVM не оптимизирует TCO; default methods (Java 8) — multiple inheritance of behaviour; testing pyramid (unit fast, integration slower, E2E slowest)

## Important Invariants
- MVCC: readers never block writers; each transaction sees a snapshot at its start time
- Outbox pattern guarantees at-least-once (idempotent consumers required)
- Circuit Breaker states: closed → open (on failures) → half-open (probe) → closed (on success)
- JWT is stateless: server holds no session; revocation requires token blacklist or short TTL
- bcrypt/Argon2 are intentionally slow (KDF); use for passwords, not general data encryption
- Kafka partition count limits consumer group parallelism (max 1 consumer per partition)
- Event Sourcing schema evolution требует backward+forward compat; новые поля только optional с default, переименовывать/удалять required нельзя
- PACELC: при отсутствии partition система всё равно делает trade-off latency vs consistency — eventual consistency платится всегда, не только при partition
- Quorum R + W > N → strong consistency; R + W ≤ N → eventual

## Common Pitfalls
- Distributed lock without TTL → deadlock if lock holder crashes
- Saga without idempotency → duplicate compensating transactions
- Fan-out on write (push to all followers) is expensive for high-follower accounts → fan-out on read
- OAuth2 access token in URL query param → logged in proxy/server logs
- B-tree index on low-cardinality column (e.g., boolean) → full table scan still preferred
- Event Sourcing без snapshots → linear replay time, медленный startup при росте лога
- Default methods коллизия в двух интерфейсах с одинаковой сигнатурой → compile error, надо явно override

## Related Modules
- `spring-frameworks` — Spring Security (OAuth2/JWT implementation), Spring Cloud (Circuit Breaker, Feign)
- `infrastructure` — Kubernetes Secrets, Vault sidecar injection, deployment strategies
- `caching-deep-dive` — consistency models, CDC (event-driven invalidation)
