# Infrastructure-Learn — Interview Prep

Площадка для практики инфраструктурных технологий перед техническими собеседованиями.
Покрывает Docker, Kubernetes, Helm, Observability, Logs и Metrics — на уровне backend-разработчика.

## Структура проекта

```
├── ROADMAP.md                           # 6 модулей с чеклистами и ссылками на теорию
├── PROGRESS.md                          # Трекер прогресса
├── INTERVIEW_QUESTIONS.md               # 36 вопросов с ответами
│
├── theory/                              # Теория по каждому модулю
│   ├── DOCKER.md                        # Образы, слои, Dockerfile, compose, networking
│   ├── KUBERNETES.md                    # Pod, Deployment, Service, Probes, HPA
│   ├── HELM.md                          # Charts, templates, values, hooks
│   ├── OBSERVABILITY.md                 # 3 столпа, SLI/SLO/SLA, трейсинг
│   ├── LOGGING.md                       # Структурированные логи, MDC, Loki
│   └── METRICS.md                       # Типы метрик, Prometheus, PromQL, Grafana
│
├── exercises/
│   ├── docker/          Ex01–Ex07        # Dockerfile, compose, networking, security
│   ├── kubernetes/      Ex08–Ex14        # Deployments, probes, HPA, services
│   ├── helm/            Ex15–Ex18        # Charts, templates, hooks, conditionals
│   ├── logging/         Ex19–Ex24        # Logback JSON, MDC, correlation ID, Loki
│   └── metrics/         Ex25–Ex30        # Micrometer, Prometheus, Grafana, PromQL
│
└── src/main/java/by/pavel/
    └── InfraLearnApplication.java        # Spring Boot app для упражнений logging/metrics
```

## Темы

| Тема | Инструменты | Упражнения | Теория |
|------|------------|-----------|--------|
| Containerization | Docker, docker-compose | Ex01–Ex07 | [DOCKER](theory/DOCKER.md) |
| Orchestration | Kubernetes, kubectl | Ex08–Ex14 | [KUBERNETES](theory/KUBERNETES.md) |
| Package Management | Helm 3 | Ex15–Ex18 | [HELM](theory/HELM.md) |
| Observability | OpenTelemetry, Jaeger | — | [OBSERVABILITY](theory/OBSERVABILITY.md) |
| Logs | Logback, Loki, Promtail, Grafana | Ex19–Ex24 | [LOGGING](theory/LOGGING.md) |
| Metrics | Micrometer, Prometheus, Grafana | Ex25–Ex30 | [METRICS](theory/METRICS.md) |

## Как работать

Каждая директория упражнения содержит `TASK.md` с описанием задачи. Реализуй решение, затем попроси Claude проверить:

```
"проверь Ex01"     — проверка реализации + code review
"следующий"        — следующий незавершённый модуль
"квиз"             — 5 случайных вопросов из INTERVIEW_QUESTIONS.md
```

## Стек

- Java 21 / Spring Boot 3.3
- Maven 3.9
- Docker + docker-compose
- Kubernetes (kubectl, minikube или kind)
- Helm 3
- Prometheus + Grafana
- Loki + Promtail
- Micrometer + logstash-logback-encoder

## Быстрый старт — весь стек за одну команду

```bash
# Поднять backend (Spring Boot) + frontend (nginx) через Docker Compose
docker compose up --build

# Frontend: http://localhost:3000  (UI для работы с Orders API)
# Backend:  http://localhost:8080  (REST API + Actuator)
```

## API приложения

Backend предоставляет простой Orders API для использования в упражнениях:

```bash
# Список заказов
curl http://localhost:8080/api/orders

# Создать заказ
curl -X POST http://localhost:8080/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"product": "Widget", "quantity": 5}'

# Удалить заказ
curl -X DELETE http://localhost:8080/api/orders/{id}

# Информация о приложении (окружение, версия)
curl http://localhost:8080/api/info

# Метрики для Prometheus
curl http://localhost:8080/actuator/prometheus

# Health check
curl http://localhost:8080/actuator/health
```

## Структура приложения

```
Dockerfile              ← multi-stage build для backend
frontend/
├── Dockerfile          ← nginx с proxy на backend
├── index.html          ← Orders UI
└── nginx.conf          ← конфиг с envsubst (BACKEND_HOST, BACKEND_PORT)
src/main/java/by/pavel/
├── InfraLearnApplication.java
├── InfoController.java          ← GET /api/info
└── order/
    ├── Order.java
    └── OrderController.java     ← /api/orders CRUD (in-memory)
```

## Как выполнять упражнения

**Docker (Ex01-Ex07):** Упражнения в `exercises/docker/ExXX/` содержат пустые `Dockerfile`
или `docker-compose.yml`. Заполни их. Для Docker упражнений используй образы из корневого
`Dockerfile` (backend) и `frontend/Dockerfile` — это реальные приложения.

**Kubernetes (Ex08-Ex14):** Все манифесты в `exercises/kubernetes/ExXX/`. Нужен
`minikube start` или `kind create cluster`. Используй образ `infra-learn-backend:latest`
(собери из корневого Dockerfile: `docker build -t infra-learn-backend .`).

**Helm (Ex15-Ex18):** `helm lint` и `helm template` работают без кластера. Для install
нужен кластер.

**Logging/Metrics (Ex19-Ex30):** Файлы из `exercises/logging/` и `exercises/metrics/`
компилируются как часть основного Spring Boot приложения — просто скопируй реализацию
в `src/main/java/by/pavel/`.

## Сборка и запуск (без Docker)

```bash
cd modules/infrastructure
mvn spring-boot:run        # backend на :8080 (для упражнений logging/metrics)
```

## Code review — на что смотреть

Корректность конфигурации (как проверять — см. «Как выполнять упражнения» выше): Dockerfile / `docker-compose.yml`, K8s-манифесты (`kubectl apply --dry-run=client`), Helm (`helm lint`, `helm template`), Logback JSON / PromQL. Смотри безопасность (non-root, secrets), resources/limits, probes, корректность лейблов/селекторов.

## Источники

- *Docker Deep Dive* — Nigel Poulton
- *Kubernetes in Action* — Marko Luksa
- *Prometheus: Up & Running* — Brian Brazil
- Официальная документация: kubernetes.io, helm.sh, prometheus.io
- Spring Boot Actuator docs
