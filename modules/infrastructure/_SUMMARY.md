# Infrastructure — Semantic Summary

## Core Model
- Containers (Docker) → orchestration (Kubernetes) → packaging (Helm) → observability (metrics/logs/traces) → cloud-native operational model
- Kubernetes is declarative: declare desired state, controllers continually reconcile actual state to match (**reconciliation loop**)
- Observability = ability to infer internal state from external outputs (the **three pillars** + correlation)
- Cloud-native = stateless services + immutable infrastructure + externalised state + measured services

## Key Concepts

- **Containers**: Linux primitives — namespaces (PID/mount/network/IPC/UTS/user/cgroup) + cgroups (resource limits); image = layered filesystem (OverlayFS, copy-on-write); registry (Docker Hub, ECR); Dockerfile layer caching; BuildKit; multi-arch images; OCI Image/Runtime spec; containerd / CRI-O / runc; distroless; rootless containers (Podman); PID 1 problem
- **Kubernetes architecture**: control plane (kube-apiserver, etcd, kube-scheduler, kube-controller-manager); data plane (kubelet, kube-proxy via iptables/IPVS/eBPF, container runtime); CRI; CoreDNS
- **Kubernetes workloads**: Pod (smallest unit, pause container, init containers, sidecars), Deployment + ReplicaSet, StatefulSet (stable identity for DBs), DaemonSet (per-node), Job/CronJob (batch); Service (ClusterIP/NodePort/LoadBalancer/Headless), EndpointSlices, Ingress / Gateway API, ConfigMap/Secret
- **Kubernetes operational concerns**: liveness/readiness/startup probes (Henning Jacobs caveat); resources requests/limits, QoS classes (Guaranteed/Burstable/BestEffort), OOMKilled; HPA / VPA / Cluster Autoscaler; Namespaces / RBAC / NetworkPolicy; PV / PVC / StorageClass / CSI; Taints/Tolerations, Affinity, TopologySpreadConstraints
- **Helm**: chart = templates + values.yaml + Chart.yaml; release = named instance with revision history (stored in Secrets); `helm install/upgrade/rollback`; hooks (pre-install/upgrade); sub-charts, library charts, umbrella charts; alternatives — Kustomize (overlay-based), Argo CD (GitOps); `--atomic --wait` in CI
- **Observability — three pillars**: metrics (aggregated numbers, low cardinality), logs (events, high cardinality), traces (causally linked spans, medium); monitoring (known unknowns) vs observability (unknown unknowns)
- **Reliability metrics**: SLI (measurable indicator) / SLO (internal target) / SLA (legal contract); error budget = 1 − SLO; burn rate alerts (multi-window multi-burn-rate)
- **Distributed tracing**: trace = DAG of spans; trace context propagated via W3C TraceContext header (`traceparent`); head-based vs tail-based sampling; OpenTracing + OpenCensus → OpenTelemetry (merged 2019); Micrometer Tracing bridge; exemplars to link metrics ↔ traces; wide events (Honeycomb)
- **Metrics**: Counter (monotonic, rate), Gauge (snapshot), Histogram (distribution, percentiles via `histogram_quantile`), Summary (client-side quantile, doesn't aggregate); Prometheus pull model; PromQL (`rate` vs `irate`, vector matching); Micrometer facade; cardinality bomb; recording/alerting rules + Alertmanager; methodology — RED (request services) / USE (resources) / Four Golden Signals; long-term storage via Thanos/Cortex/Mimir/VictoriaMetrics
- **Logging**: structured JSON > plain text; MDC (thread-local context, auto-injected); correlation ID propagation through services; 12-factor stdout (containers); ELK (full index, fast/expensive) vs Loki (label-only, cheap/slower); what NEVER to log — PII (GDPR), credentials, card data (PCI-DSS), PHI (HIPAA); async appender (LMAX Disruptor); lazy formatting `{}`
- **Cloud**: regions (geographic), availability zones (isolated failure domains, ~1–2ms latency); edge / PoP; IaaS vs PaaS vs SaaS vs FaaS (pizza-as-a-service); HA (no downtime) vs DR (recovery from disaster); RPO (data loss tolerance) / RTO (downtime tolerance); managed DB trade-offs; cloud-native patterns; IaC (Terraform state, drift, locking); vendor lock-in; hidden costs (egress, NAT Gateway, cross-AZ)

## Important Invariants

- Containers share the host OS kernel (not hypervisor isolation like VMs) — kernel CVE = compromise of all containers
- Image layers are immutable; writable layer is per-container and lost on `docker rm`
- Persistent state in containers → volumes, never writable layer (especially for DBs)
- Kubernetes declares desired state; controllers ensure actual state converges; reconciliation = continuous, eventually consistent
- `:latest` tag is mutable → non-deterministic rollouts; pin to digest or version for production
- Helm upgrade is idempotent for the same values; `--atomic` rolls back on failure
- Pod IP and writable layer are ephemeral — application must be stateless or use Persistent Volumes
- Trace IDs must propagate through all service calls (HTTP headers, Kafka headers, gRPC metadata)
- Histogram is pre-aggregated client-side; quantile computed via PromQL `histogram_quantile` (linear interpolation in bucket)
- Summary computes quantile client-side — cannot aggregate across instances
- Kubernetes Secrets are base64-encoded, NOT encrypted by default — requires etcd encryption at rest or external Vault
- MDC requires `finally { clear() }` to prevent leak across thread pool reuse
- `liveness` probe should test process aliveness only, not dependencies (cascading-restart anti-pattern)
- `rate()` works for Counter only; for Gauge use direct value, `delta()`, or `deriv()`
- High-cardinality labels are forbidden in Prometheus (cardinality bomb → OOM)
- us-east-1 AWS has global hidden dependencies (IAM, CloudFront control plane) — outage affects "other" regions

## Common Pitfalls

- Running container as root → privilege escalation risk (CVE-2019-5736 runc breakout); always `runAsNonRoot: true` + drop capabilities
- Missing resource limits (CPU/memory) → OOM kill of other Pods on same node; BestEffort QoS is first to evict
- Single endpoint for both liveness and readiness probes → cascading restarts under load (Henning Jacobs warning)
- `latest` tag in Deployment → non-deterministic rollout (different images on different nodes)
- Log without trace ID → cannot correlate logs across services for a single request
- Helm values secrets in plain YAML → use Vault, Sealed Secrets, or External Secrets Operator ([system-design/secrets_management.md](../system-design/theory/secrets_management.md))
- High-cardinality Prometheus labels (`user_id`, full URL) → Prometheus OOM
- Logging PII/credentials → GDPR/PCI/HIPAA violation (Cloudbleed 2017 example)
- Sticky sessions → broken statelessness; use external session store (Redis)
- Single-AZ production deployment → outage when that AZ dies
- CPU limits in production → throttling on burst workloads (controversial; many recommend memory limits only)
- Bitnami chart version not pinned → breaking changes silently broken on upgrade
- `helm upgrade` without `--atomic --wait` → cluster in half-broken state on failed deploy
- log-and-throw anti-pattern → duplicate stacktraces in logs at every call level
- `irate()` for long windows → meaningless (it only uses last two points)
- Docker socket mounted in container → root-on-host equivalent

## Related Modules

- `system-design` — Vault, JWT/OAuth2, Circuit Breaker pattern, microservice patterns (Saga, Outbox, Strangler), Kafka, distributed transactions
- `spring-frameworks` — Spring Boot Actuator (exposes `/health` and `/metrics` consumed by Prometheus/K8s probes), Spring Cloud (Eureka, Resilience4j, OpenFeign), Hibernate L1/L2/Query cache
- `caching-deep-dive` — distributed caching topologies, eviction policies, Redis, cache stampede / penetration / breakdown / avalanche
- `concurrency` — Java threading, virtual threads (relevant to MDC behaviour), structured concurrency
- `kotlin-coroutines` — coroutine context propagation (MDCContext for Logback integration)
