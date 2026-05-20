# Progress Tracker

## Статус модулей

| Модуль | Статус | Дата начала | Дата завершения |
|--------|--------|-------------|-----------------|
| 1. Docker          | ⬜ не начат | — | — |
| 2. Kubernetes      | ⬜ не начат | — | — |
| 3. Helm            | ⬜ не начат | — | — |
| 4. Observability   | ⬜ не начат | — | — |
| 5. Logging         | ⬜ не начат | — | — |
| 6. Metrics         | ⬜ не начат | — | — |
| 7. Secrets         | ⬜ не начат | — | — |

## Упражнения

| # | Директория | Тема | Статус |
|---|-----------|------|--------|
| 01 | docker/Ex01_SimpleDockerfile       | Базовый Dockerfile, non-root, HEALTHCHECK | ⬜ |
| 02 | docker/Ex02_MultiStageDockerfile   | Multi-stage build, минимальный образ     | ⬜ |
| 03 | docker/Ex03_DockerCompose          | Compose: app + postgres + redis           | ⬜ |
| 04 | docker/Ex04_DockerNetworking       | Networks, DNS, изоляция                   | ⬜ |
| 05 | docker/Ex05_DockerVolumes          | Named volumes, персистентность            | ⬜ |
| 06 | docker/Ex06_DockerOptimization     | Layer order, кэширование, размер          | ⬜ |
| 07 | docker/Ex07_DockerSecurity         | Security: capabilities, read-only FS      | ⬜ |
| 08 | kubernetes/Ex08_PodAndDeployment   | Deployment, ReplicaSet, RollingUpdate     | ⬜ |
| 09 | kubernetes/Ex09_ConfigMapsSecrets  | ConfigMap, Secret, монтирование           | ⬜ |
| 10 | kubernetes/Ex10_Probes             | Liveness, Readiness, Startup probes       | ⬜ |
| 11 | kubernetes/Ex11_HPA                | HPA, CPU autoscaling, resource requests   | ⬜ |
| 12 | kubernetes/Ex12_Namespaces         | Namespaces, ResourceQuota                 | ⬜ |
| 13 | kubernetes/Ex13_ResourceLimits     | Requests/Limits, QoS классы               | ⬜ |
| 14 | kubernetes/Ex14_Services           | ClusterIP, NodePort, DNS имена            | ⬜ |
| 15 | helm/Ex15_BasicChart               | Chart структура, Chart.yaml               | ⬜ |
| 16 | helm/Ex16_ValuesAndTemplates       | values.yaml, шаблонизация, --set          | ⬜ |
| 17 | helm/Ex17_HelmHooks                | pre-install job, post-upgrade hook        | ⬜ |
| 18 | helm/Ex18_HelmConditionals         | if/range, _helpers.tpl, named templates   | ⬜ |
| 19 | logging/Ex19_LogbackJson           | logback-spring.xml, JSON encoder          | ⬜ |
| 20 | logging/Ex20_CorrelationId         | X-Request-ID, MDC filter                  | ⬜ |
| 21 | logging/Ex21_StructuredLogging     | MDC с бизнес-контекстом                   | ⬜ |
| 22 | logging/Ex22_MDCContext            | MDC propagation в async TaskExecutor      | ⬜ |
| 23 | logging/Ex23_LogLevels             | Профили, динамическое изменение уровней   | ⬜ |
| 24 | logging/Ex24_LokiIntegration       | Loki + Promtail + Grafana compose stack   | ⬜ |
| 25 | metrics/Ex25_MicrometerCounterGauge | Counter + Gauge, теги                    | ⬜ |
| 26 | metrics/Ex26_Histogram             | Timer/Histogram, p95/p99 PromQL           | ⬜ |
| 27 | metrics/Ex27_CustomEndpoint        | HealthIndicator, кастомные детали         | ⬜ |
| 28 | metrics/Ex28_PrometheusConfig      | prometheus.yml, alerting rules            | ⬜ |
| 29 | metrics/Ex29_GrafanaDashboard      | Dashboard JSON: RPS, errors, latency, JVM | ⬜ |
| 30 | metrics/Ex30_PromQL                | 10 PromQL запросов, recording rules       | ⬜ |

---
Легенда: ⬜ не начато | 🔄 в процессе | ✅ завершено
