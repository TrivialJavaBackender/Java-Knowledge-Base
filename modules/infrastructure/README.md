# Infrastructure — Interview Prep

Модуль о том, что происходит с приложением после того, как оно скомпилировалось: как его
запаковать так, чтобы окружение перестало быть переменной, кто перезапускает его в три часа ночи,
как выкатить новую версию без простоя, откуда узнать, что оно сломалось, — и во что всё это
обходится в облачном счёте.

Модуль отвечает на вопросы, где интервьюер проверяет не знание команд `kubectl`, а понимание
механики: «чем контейнер отличается от виртуальной машины на уровне ядра», «почему кэш слоёв
сломался от одной строки Dockerfile», «зачем нужен readiness, если есть liveness», «почему
`histogram_quantile` по нескольким экземплярам считается именно так», «где лежит первый секрет».

> Терминология зафиксирована в [`knowledge/GLOSSARY.md`](../../knowledge/GLOSSARY.md) и
> [`knowledge/CANONICAL_TERMS.md`](../../knowledge/CANONICAL_TERMS.md). Карта «концепт → файл» —
> [`knowledge/GLOBAL_INDEX.md`](../../knowledge/GLOBAL_INDEX.md).

## Структура проекта

```
├── ROADMAP.md                          # 8 тем в порядке прохождения + чеклисты
├── INTERVIEW_QUESTIONS.md              # вопросы с ответами (формат qa-bold)
├── _SUMMARY.md                         # семантическое сжатие модуля
│
├── theory/
│   ├── DOCKER.md                       # namespaces и cgroups, слои образа, кэш сборки, реестр
│   ├── KUBERNETES.md                   # цикл согласования, под, контроллеры, пробы, ресурсы
│   ├── HELM.md                         # чарт, шаблон, релиз как конечный автомат, откат
│   ├── OBSERVABILITY.md                # три столпа, SLI/SLO/бюджет ошибок, трассировка
│   ├── LOGGING.md                      # структурированный журнал, MDC, сквозной идентификатор
│   ├── METRICS.md                      # типы метрик, модель опроса, PromQL, взрыв кардинальности
│   ├── SECRETS.md                      # конвертное шифрование, задача первого секрета, Vault, mTLS
│   └── CLOUD.md                        # регион и зона, модели услуг, HA против DR, IaC, счёт
│
├── exercises/
│   ├── docker/          Ex01–Ex07      # Dockerfile, compose, сеть, тома, безопасность
│   ├── kubernetes/      Ex08–Ex14      # Deployment, пробы, HPA, ресурсы, Service
│   ├── helm/            Ex15–Ex18      # чарт, значения, hooks, условная шаблонизация
│   ├── logging/         Ex19–Ex24      # Logback JSON, MDC, сквозной идентификатор, Loki
│   └── metrics/         Ex25–Ex30      # Micrometer, Prometheus, Grafana, PromQL
│
├── Dockerfile / frontend/              # реальные образы, на которых делаются упражнения
└── src/main/java/by/pavel/             # Spring Boot приложение Orders API
```

## Темы

| Раздел | Содержание | Теория |
|--------|------------|--------|
| Упаковка | Контейнер против виртуальной машины, слои и кэш, реестр, безопасность образа | [DOCKER](theory/DOCKER.md) |
| Оркестрация | Цикл согласования, под и контроллеры, Service, пробы, ресурсы и QoS, планировщик | [KUBERNETES](theory/KUBERNETES.md) |
| Упаковка релиза | Чарт и значения, шаблонизация, релиз как конечный автомат, откат, зависимости | [HELM](theory/HELM.md) |
| Наблюдаемость | Три столпа и их цена, SLI/SLO/SLA, бюджет ошибок, распределённая трассировка, выборка | [OBSERVABILITY](theory/OBSERVABILITY.md) |
| Журналирование | Структурированный журнал, уровни, MDC и его потеря в асинхронности, ELK против Loki | [LOGGING](theory/LOGGING.md) |
| Метрики | Опрос против отправки, четыре типа, PromQL, взрыв кардинальности, RED/USE | [METRICS](theory/METRICS.md) |
| Секреты | Конвертное шифрование, задача первого секрета, Vault, состояние Terraform, mTLS | [SECRETS](theory/SECRETS.md) |
| Облако | Регион и зона доступности, IaaS/PaaS/SaaS/FaaS, HA против DR, RPO/RTO, IaC, скрытая цена | [CLOUD](theory/CLOUD.md) |

## Сквозной пример

Вся теория разбирается на одной системе — той самой, что лежит в этом репозитории.

> **Orders API в эксплуатации.** Spring Boot backend (`/api/orders`, Actuator) и nginx-frontend.
> Три экземпляра, 200 запросов в секунду, требование к задержке — p99 не хуже 300 мс.
> Приложение упаковано в образ, выкатывается в Kubernetes, ставится Helm-чартом, пишет
> структурированный журнал в stdout и отдаёт метрики Prometheus. База — управляемый PostgreSQL
> в облаке, пароль к ней лежит в Vault.

Из этого одного набора выводятся все решения модуля: почему `COPY . .` перед `mvn package` ломает
кэш сборки и удлиняет выкатку, почему под с одним эндпоинтом на liveness и readiness уходит в
цикл перезапусков под нагрузкой, почему `histogram_quantile` по трём экземплярам даёт не то, что
среднее их p99, почему `kubectl get secret` показывает пароль в открытом виде и что с этим делать,
и во сколько обходится трафик между зонами доступности.

## Границы модуля

Модуль отвечает на вопрос **«как приложение живёт в эксплуатации и чем за это платят»**. Смежные
темы принадлежат другим модулям и здесь только упоминаются со ссылкой:

- Взаимодействие сервисов, шлюз, service mesh, SPIFFE, сага и Outbox —
  [`microservices/EDGE_AND_MESH.md`](../microservices/theory/EDGE_AND_MESH.md),
  [`microservices/SERVICE_IDENTITY.md`](../microservices/theory/SERVICE_IDENTITY.md).
  Здесь — только mTLS как транспортный механизм и TLS termination.
- OAuth2/OIDC/JWT как протоколы — [`system-design/identity_providers.md`](../system-design/theory/identity_providers.md);
  их реализация в Spring — [`spring-frameworks/SPRING_SECURITY.md`](../spring-frameworks/theory/SPRING_SECURITY.md).
- Репликация, шардирование, выбор движка хранения — [`databases/`](../databases/).
  Здесь — только эксплуатационная сторона: управляемая база против самостоятельной.
- Кэш на всех уровнях, включая CDN — [`caching-deep-dive/`](../caching-deep-dive/).
- Паттерны надёжности (повторы, backoff, load shedding) —
  [`system-design/RELIABILITY_PATTERNS.md`](../system-design/theory/RELIABILITY_PATTERNS.md).

## Как работать

Каждая директория упражнения содержит `TASK.md` с описанием задачи. Реализуй решение, затем
попроси проверить:

```
"проверь Ex01"     — проверка реализации + код-ревью
"следующий"        — следующая тема по ROADMAP.md
"квиз"             — 5 случайных вопросов из INTERVIEW_QUESTIONS.md
```

## Стек

Java 21 / Spring Boot 3.3, Maven 3.9, Docker + docker compose, Kubernetes (minikube или kind),
Helm 3, Prometheus + Grafana, Loki + Promtail, Micrometer + logstash-logback-encoder.

## Сборка и запуск

```bash
# весь стек: backend (Spring Boot) + frontend (nginx)
docker compose up --build
#   frontend → http://localhost:3000
#   backend  → http://localhost:8080

# только backend, без Docker — для упражнений logging/metrics
cd modules/infrastructure && mvn spring-boot:run
```

Orders API, на котором делаются упражнения:

```bash
curl http://localhost:8080/api/orders                       # список заказов
curl -X POST http://localhost:8080/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"product": "Widget", "quantity": 5}'                 # создать заказ
curl -X DELETE http://localhost:8080/api/orders/{id}        # удалить заказ
curl http://localhost:8080/api/info                         # окружение и версия
curl http://localhost:8080/actuator/prometheus              # метрики
curl http://localhost:8080/actuator/health                  # состояние
```

## Как выполнять упражнения

- **Docker (Ex01–Ex07).** В `exercises/docker/ExXX/` лежат пустые `Dockerfile` или
  `docker-compose.yml` — заполни. Собирай реальные приложения: корневой `Dockerfile` (backend) и
  `frontend/Dockerfile`.
- **Kubernetes (Ex08–Ex14).** Манифесты в `exercises/kubernetes/ExXX/`. Нужен `minikube start`
  или `kind create cluster`; образ собери командой `docker build -t infra-learn-backend .`.
- **Helm (Ex15–Ex18).** `helm lint` и `helm template` работают без кластера; для установки нужен
  кластер.
- **Logging / Metrics (Ex19–Ex30).** Файлы из `exercises/logging/` и `exercises/metrics/`
  компилируются как часть основного приложения — скопируй реализацию в `src/main/java/by/pavel/`.

## Код-ревью — на что смотреть

Корректность конфигурации и способ её проверить: Dockerfile и `docker-compose.yml` (сборка
проходит, образ запускается), манифесты Kubernetes (`kubectl apply --dry-run=client`), чарты
(`helm lint`, `helm template`), Logback JSON и PromQL (реальный вывод, а не правдоподобный).
Отдельно: запуск не от root и отсутствие секретов в образе, заданные requests/limits, разделённые
liveness и readiness, согласованность лейблов и селекторов, отсутствие меток высокой
кардинальности в метриках.

## Источники

- Nigel Poulton, *Docker Deep Dive*
- Marko Luksa, *Kubernetes in Action*
- Brian Brazil, *Prometheus: Up & Running*
- Betsy Beyer et al., *Site Reliability Engineering* (Google)
- Официальная документация: kubernetes.io, helm.sh, prometheus.io, developer.hashicorp.com/vault
