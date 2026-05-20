# Roadmap

## Модуль 1 — Docker

**Теория:** [theory/DOCKER.md](theory/DOCKER.md)

- [ ] Прочитать теорию
- [ ] Ex01: Базовый Dockerfile (non-root, HEALTHCHECK)
- [ ] Ex02: Multi-stage build
- [ ] Ex03: docker-compose (app + postgres + redis)
- [ ] Ex04: Docker networking
- [ ] Ex05: Docker volumes
- [ ] Ex06: Оптимизация Dockerfile (слои, кэш)
- [ ] Ex07: Docker security (capabilities, read-only FS)

---

## Модуль 2 — Kubernetes

**Теория:** [theory/KUBERNETES.md](theory/KUBERNETES.md)

- [ ] Прочитать теорию
- [ ] Ex08: Pod и Deployment (RollingUpdate)
- [ ] Ex09: ConfigMap и Secret
- [ ] Ex10: Liveness, Readiness, Startup probes
- [ ] Ex11: HPA (Horizontal Pod Autoscaler)
- [ ] Ex12: Namespaces и ResourceQuota
- [ ] Ex13: Resource requests и limits
- [ ] Ex14: Services (ClusterIP, NodePort)

---

## Модуль 3 — Helm

**Теория:** [theory/HELM.md](theory/HELM.md)

- [ ] Прочитать теорию
- [ ] Ex15: Базовый Helm chart
- [ ] Ex16: Values и шаблоны
- [ ] Ex17: Helm hooks (pre-install, post-upgrade)
- [ ] Ex18: Условная шаблонизация (_helpers.tpl, if/range)

---

## Модуль 4 — Observability

**Теория:** [theory/OBSERVABILITY.md](theory/OBSERVABILITY.md)

- [ ] Прочитать теорию
- [ ] Пройти квиз по теме

*(Практика — через модули Logging и Metrics)*

---

## Модуль 5 — Logging

**Теория:** [theory/LOGGING.md](theory/LOGGING.md)

- [ ] Прочитать теорию
- [ ] Ex19: Logback JSON (logback-spring.xml)
- [ ] Ex20: Correlation ID (X-Request-ID, MDC filter)
- [ ] Ex21: Структурированное логирование (MDC + бизнес-контекст)
- [ ] Ex22: MDC propagation в async (TaskDecorator)
- [ ] Ex23: Log levels по профилям (prod/dev)
- [ ] Ex24: Loki + Promtail + Grafana (docker-compose стек)

---

## Модуль 6 — Metrics

**Теория:** [theory/METRICS.md](theory/METRICS.md)

- [ ] Прочитать теорию
- [ ] Ex25: Counter и Gauge (Micrometer)
- [ ] Ex26: Histogram и Timer (p95/p99)
- [ ] Ex27: Custom HealthIndicator
- [ ] Ex28: Prometheus config (scrape + alerting rules)
- [ ] Ex29: Grafana dashboard (JSON)
- [ ] Ex30: PromQL запросы (10 штук)

---

## Модуль 7 — Secrets & Encryption (ops side)

**Теория:** [theory/SECRETS.md](theory/SECRETS.md)

- [ ] Прочитать теорию
- [ ] Понять envelope encryption (KEK + DEK) и почему KMS делает только небольшие операции
- [ ] Bootstrap problem: где лежит первый секрет (IAM role, K8s SA token, AppRole)
- [ ] Vault: Seal/Unseal Shamir, auth methods, dynamic secrets, leases
- [ ] Terraform state: encryption at rest, sensitive variables, never plain secret in state
- [ ] K8s Secrets vs External Secrets Operator vs Sealed Secrets vs Vault Agent
- [ ] SOPS — зашифрованные секреты в git с KMS
- [ ] mTLS — service-to-service identity, service mesh integration

> Application-level auth (JWT/OAuth2/OIDC/SAML) — в [`modules/system-design/theory/identity_providers.md`](../system-design/theory/identity_providers.md). Spring Security implementation — в [`modules/spring-frameworks/theory/SPRING_SECURITY.md`](../spring-frameworks/theory/SPRING_SECURITY.md).
