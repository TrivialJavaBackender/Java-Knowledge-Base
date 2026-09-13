# CI/CD — Interview Prep

Модуль о том, что физически происходит между `git push` и работающим сервисом на staging.
Ветвление и решение «когда катим» уже разобраны в
[engineering-process](../engineering-process/README.md); здесь — всё, что происходит **после**:
кто и на какой машине собирает, откуда берётся кэш, как jar превращается в образ, чем тег
отличается от дайджеста, почему один и тот же артефакт обязан доехать до всех окружений
и кто применяет изменение в кластере.

Модуль отвечает на вопросы, где интервьюер проверяет не знание YAML, а понимание механизма:
«расскажите, что происходит от коммита до прода», «почему нельзя пересобирать образ для
staging», «чем `latest` плох», «как конвейер получает доступ в AWS без хранимого ключа»,
«кто делает `kubectl apply` в вашей схеме и почему», «конвейер идёт 40 минут — ваши действия».

> Терминология зафиксирована в [`knowledge/GLOSSARY.md`](../../knowledge/GLOSSARY.md) и
> [`knowledge/CANONICAL_TERMS.md`](../../knowledge/CANONICAL_TERMS.md). Карта «концепт → файл» —
> [`knowledge/GLOBAL_INDEX.md`](../../knowledge/GLOBAL_INDEX.md).

## Сквозной пример

Сервис **`payments`**: Spring Boot 3, Java 21, Maven, PostgreSQL, пик 40 запросов в секунду.
Один `git push` в `main` должен привести к работающей версии на dev, qa и staging. Все двенадцать
файлов теории разбирают один и тот же путь с разных сторон, поэтому подходы сравниваются на одной
задаче, а не на абстрактных примерах.

## Структура проекта

```
├── ROADMAP.md                          # 24 темы в порядке прохождения + чеклисты
├── INTERVIEW_QUESTIONS.md              # вопросы с ответами (формат qa-bold)
├── _SUMMARY.md                         # семантическое сжатие модуля
│
├── pom.xml                             # сервис payments: Spring Boot 3.3.4, Java 21
├── Dockerfile                          # multi-stage, layered jar, непривилегированный пользователь
├── src/main/java/by/pavel/payments/    # исходники сервиса
│
├── pipelines/                          # учебные артефакты: один конвейер на разных языках
│   ├── github/    gitlab/    jenkins/  # ci.yml + release-canary.yml + release-gitops.yml
│   ├── rollouts/                       # Argo Rollouts: канарейка, blue-green, анализ, HTTPRoute
│   ├── helm/payments/                  # чарт + values для dev/qa/staging
│   ├── kustomize/                      # base + overlays окружений
│   ├── argocd/                         # Application-манифесты
│   ├── swarm/                          # стек Docker Swarm
│   └── terraform/                      # минимальный модуль инфраструктуры
│
└── theory/                          # 24 файла, каждый 11–13 тыс. знаков (10–15 минут чтения)
    ├── PIPELINE_MODEL.md               # от git push до прода; событие, задание, шаг; граф
    ├── PIPELINE_GUARANTEES.md          # эфемерность; CI / delivery / deployment; обратная связь
    ├── RUNNERS.md                      # исполнители: управляемый против собственного
    ├── PIPELINE_CACHE_AND_CONCURRENCY.md # кэш, артефакты, матрица, очередь, экономика минут
    ├── TOOLS_COMPARED.md               # Actions, GitLab CI, Jenkins на одной задаче
    ├── JENKINS_IN_DEPTH.md             # Declarative/Scripted, shared library, агент
    ├── JAVA_BUILD_IN_CI.md             # кэш ~/.m2, версии, тесты, воспроизводимость
    ├── IMAGE_BUILD_IN_CI.md            # DinD/Kaniko/BuildKit, кэш слоёв, layered jar
    ├── IMAGE_REGISTRY_AND_TAGS.md      # тег против дайджеста, реестр, мультиарх
    ├── PIPELINE_CREDENTIALS.md         # OIDC, права токена, маскирование, окружения
    ├── SUPPLY_CHAIN_ATTACKS.md         # инъекция, SHA-пиннинг, сканер, подпись, SBOM, SLSA
    ├── ENVIRONMENTS_AND_PROMOTION.md   # собрать один раз, продвигать тот же артефакт
    ├── ENVIRONMENT_ANATOMY.md          # конфигурация, окружения по требованию, миграции
    ├── DELIVERY_PUSH_VS_PULL.md        # GitOps: кто применяет изменение и почему
    ├── GITOPS_REPOSITORIES.md          # репозиторий конфигурации, продвижение, откат коммитом
    ├── DEPLOY_TO_K8S.md                # kubectl / helm / Argo; ожидание готовности; откат
    ├── PROGRESSIVE_DELIVERY_K8S.md     # канарейка, blue-green, A/B: трафик, Rollouts, анализ
    ├── RELEASE_PIPELINE_RECIPES.md     # сквозные конвейеры релиза: толчком, GitOps, blue-green
    ├── DEPLOY_SWARM.md                 # стек Swarm, update_config, откат
    ├── DEPLOY_CLOUD_PLATFORMS.md       # ECS, EKS, Cloud Run, GKE, голая VM
    ├── TERRAFORM_IN_PIPELINE.md        # plan как артефакт ревью, блокировка состояния
    ├── IAC_OWNERSHIP.md                # расхождение, кто владеет apply, Ansible
    ├── PIPELINE_DURATION.md            # бюджет прогона, кэш, порядок этапов, отладка
    └── PIPELINE_THROUGHPUT.md          # ненадёжные тесты, очередь слияния, монорепо, метрики
```

## Как работать

Порядок прохождения — [ROADMAP.md](ROADMAP.md). Файлы идут от мотивации к механизму: первый
отвечает «что вообще происходит», последний — «почему это идёт 40 минут и что делать».

### Сборка и запуск сервиса

```bash
cd modules/ci-cd

mvn -B -ntp test                  # быстрые модульные тесты
mvn -B -ntp package -DskipTests   # jar в target/
mvn -B -ntp verify                # + интеграционные тесты (failsafe)

java -jar target/ci-cd-payments-1.0-SNAPSHOT.jar
curl localhost:8080/version       # {"environment":"local","digest":"unknown"}
```

### Прогоны, на которых стоит теория

Утверждения модуля подпёрты этими командами — их можно повторить:

```bash
# слои layered jar (Spring Boot 3.3+; layertools объявлен устаревшим)
java -Djarmode=tools -jar target/ci-cd-payments-1.0-SNAPSHOT.jar list-layers

# образ и дайджест
docker build -t payments:local .
docker buildx imagetools inspect payments:local

# один чарт, три окружения
helm template payments pipelines/helm/payments -f pipelines/helm/payments/values-qa.yaml

# постепенная замена и откат без Kubernetes
docker swarm init && docker stack deploy -c pipelines/swarm/stack.yml payments
docker service update --image payments:v2 payments_api
docker service rollback payments_api
```

Версии, на которых снято: Docker 29.4.3, buildx v0.33.0, OpenJDK 21.0.9, Maven 3.9.14,
Helm v4.2.4, Terraform v1.16.0, macOS на Apple Silicon.

## Что этот модуль сознательно не покрывает

| Тема | Где она живёт |
|---|---|
| Стратегия ветвления, состав CI-гейта, ненадёжные тесты как отказ гейта | [engineering-process/BRANCHING_AND_CODE_FLOW.md](../engineering-process/theory/BRANCHING_AND_CODE_FLOW.md) |
| deploy ≠ release, выбор схемы раскатки, откат против наката, expand/contract | [engineering-process/RELEASE_STRATEGIES.md](../engineering-process/theory/RELEASE_STRATEGIES.md) |
| Метрики доставки DORA | [engineering-process/DELIVERY_METRICS.md](../engineering-process/theory/DELIVERY_METRICS.md) |
| Слои образа, OCI, реестр как хранилище | [infrastructure/DOCKER.md](../infrastructure/theory/DOCKER.md) |
| Объекты Kubernetes, механика `RollingUpdate`, пробы | [infrastructure/KUBERNETES.md](../infrastructure/theory/KUBERNETES.md) |
| Устройство чарта, шаблонизация, хуки | [infrastructure/HELM.md](../infrastructure/theory/HELM.md) |
| Terraform state, backend, обнаружение расхождения, альтернативы | [infrastructure/CLOUD.md](../infrastructure/theory/CLOUD.md) |
| Vault, динамические секреты, mTLS | [infrastructure/SECRETS.md](../infrastructure/theory/SECRETS.md) |
| Пирамида тестирования, что мокать | [software-engineering/TESTING.md](../software-engineering/theory/TESTING.md) |
| Контрактные тесты, стратегия тестовых окружений | [microservices/CONTRACTS_AND_TESTING.md](../microservices/theory/CONTRACTS_AND_TESTING.md) |

Правило NO OVERLAP: перечисленное здесь не переопределяется — теория ссылается на владельца.
