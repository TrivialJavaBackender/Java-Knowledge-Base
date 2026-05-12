# Infrastructure — Semantic Summary

## Core Model
- Containers (Docker) → orchestration (Kubernetes) → packaging (Helm) → observability (metrics/logs/traces)
- K8s is declarative: declare desired state, controller reconciles actual state to match
- Observability = ability to infer internal state from external outputs (the three pillars)

## Key Concepts
- **Docker**: image = layered filesystem (UnionFS); container = image + writable layer + process namespace; registry (Docker Hub, ECR); Dockerfile layer caching
- **Kubernetes**: control plane (API server, etcd, scheduler, controller-manager); worker node (kubelet, kube-proxy, container runtime); Pod (smallest schedulable unit), Deployment (replica management), Service (stable DNS + LB), Ingress (L7 routing), ConfigMap/Secret
- **Helm**: chart = templates + values.yaml + Chart.yaml; `helm install/upgrade/rollback`; release = named instance; hooks (pre-install, post-upgrade)
- **Observability**: three pillars — metrics (aggregated numbers), logs (discrete events), traces (causally linked spans)
- **Distributed tracing**: trace = tree of spans; trace context propagated via headers (W3C TraceContext / B3); Jaeger/Zipkin as backends
- **Metrics**: Counter (monotonic, rate), Gauge (current value), Histogram (distribution, percentiles); Prometheus scrape model; PromQL for queries
- **Logging**: structured JSON logging; trace ID in every log line for correlation; log aggregation (ELK/Loki); log levels (DEBUG/INFO/WARN/ERROR)
- **Cloud**: regions (geographic), availability zones (isolated failure domains); multi-region for DR; multi-AZ for HA

## Important Invariants
- Containers share the host OS kernel (not hypervisor isolation like VMs)
- K8s declares desired state; kubelet on each node ensures Pods match spec
- Helm upgrade is idempotent for the same values; `--atomic` rolls back on failure
- Trace IDs must propagate through all service calls (HTTP headers, Kafka headers, gRPC metadata)
- Histogram is pre-aggregated client-side; Prometheus cannot compute exact percentiles after the fact
- K8s Secrets are base64-encoded, not encrypted by default — requires etcd encryption at rest or external Vault

## Common Pitfalls
- Running container as root → privilege escalation risk; use `runAsNonRoot: true`
- Missing resource limits (CPU/memory) → OOM kill of other Pods on same node
- Missing liveness/readiness probes → traffic sent to unready Pod; stuck Pod not restarted
- Log without trace ID → cannot correlate logs across services for a single request
- `latest` tag in Deployment → non-deterministic rollout (different images on different nodes)
- Helm values secrets in plain YAML → use Vault or SOPS for secret management

## Related Modules
- `system-design` — architecture patterns that infrastructure implements; K8s Secrets vs Vault
- `spring-frameworks` — Spring Boot Actuator exposes /health and /metrics consumed by Prometheus/K8s
