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
├── ROADMAP.md                          # 12 тем в порядке прохождения + чеклисты
├── INTERVIEW_QUESTIONS.md              # вопросы с ответами (формат qa-bold)
├── _SUMMARY.md                         # семантическое сжатие модуля
│
├── pom.xml                             # сервис payments: Spring Boot 3.3.4, Java 21
├── Dockerfile                          # multi-stage, layered jar, непривилегированный пользователь
├── src/main/java/by/pavel/payments/    # исходники сервиса
│
├── pipelines/                          # учебные артефакты: один конвейер на разных языках
│   ├── github/    gitlab/    jenkins/
│   ├── helm/payments/                  # чарт + values для dev/qa/staging
│   ├── kustomize/                      # base + overlays окружений
│   ├── argocd/                         # Application-манифесты
│   ├── swarm/                          # стек Docker Swarm
│   └── terraform/                      # минимальный модуль инфраструктуры
│
└── theory/
    ├── PIPELINE_MODEL.md               # от git push до прода; событие, задание, шаг; граф
    ├── RUNNERS_AND_EXECUTION.md        # исполнители, эфемерность, кэш против артефактов
    ├── TOOLS_COMPARED.md               # Actions, GitLab CI, Jenkins на одной задаче
    ├── JAVA_BUILD_IN_CI.md             # кэш ~/.m2, версии, тесты, воспроизводимость
    ├── IMAGE_BUILD_AND_REGISTRY.md     # DinD/Kaniko/BuildKit, кэш слоёв, теги и дайджест
    ├── SUPPLY_CHAIN_SECURITY.md        # OIDC, права токена, инъекция, подпись, SBOM
    ├── ENVIRONMENTS_AND_PROMOTION.md   # продвижение одного артефакта по dev → qa → staging
    ├── DELIVERY_PUSH_VS_PULL.md        # GitOps: кто применяет изменение и почему
    ├── DEPLOY_K8S_AND_SWARM.md         # kubectl / helm / Argo; стек Swarm; ожидание готовности
    ├── DEPLOY_CLOUD_PLATFORMS.md       # ECS, EKS, Cloud Run, GKE, голая VM: критерий выбора
    ├── IAC_IN_PIPELINE.md              # plan как артефакт ревью, кто владеет apply
    └── PIPELINE_ECONOMICS.md           # длительность, кэш, ненадёжные тесты, монорепо
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
