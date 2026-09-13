# ci-cd — Roadmap

## Порядок прохождения

| № | Тема | Файл | Частота на собеседованиях |
|---|------|------|---------------------------|
| 1 | Что происходит от `git push` до прода | `PIPELINE_MODEL.md` | ★★★★★ |
| 2 | Что конвейер обещает и чем платит | `PIPELINE_GUARANTEES.md` | ★★★★ |
| 3 | Кто исполняет задание | `RUNNERS.md` | ★★★★ |
| 4 | Кэш, артефакты, параллелизм, очередь | `PIPELINE_CACHE_AND_CONCURRENCY.md` | ★★★★ |
| 5 | Actions, GitLab CI, Jenkins на одной задаче | `TOOLS_COMPARED.md` | ★★★★ |
| 6 | Jenkins изнутри | `JENKINS_IN_DEPTH.md` | ★★★ |
| 7 | Сборка Java в конвейере | `JAVA_BUILD_IN_CI.md` | ★★★★★ |
| 8 | Образ в эфемерном исполнителе | `IMAGE_BUILD_IN_CI.md` | ★★★★★ |
| 9 | Реестр, теги и дайджест | `IMAGE_REGISTRY_AND_TAGS.md` | ★★★★★ |
| 10 | Чем конвейер доказывает, что он это он | `PIPELINE_CREDENTIALS.md` | ★★★★ |
| 11 | Атака через конвейер и доказательства об артефакте | `SUPPLY_CHAIN_ATTACKS.md` | ★★★★ |
| 12 | Продвижение одного артефакта по окружениям | `ENVIRONMENTS_AND_PROMOTION.md` | ★★★★★ |
| 13 | Из чего состоит окружение | `ENVIRONMENT_ANATOMY.md` | ★★★★ |
| 14 | Доставка толчком против вытягивания | `DELIVERY_PUSH_VS_PULL.md` | ★★★★ |
| 15 | Репозиторий конфигурации и откат коммитом | `GITOPS_REPOSITORIES.md` | ★★★★ |
| 16 | Раскатка в Kubernetes | `DEPLOY_TO_K8S.md` | ★★★★★ |
| 17 | Канареечный, blue-green и A/B релиз | `PROGRESSIVE_DELIVERY_K8S.md` | ★★★★★ |
| 18 | Сквозные конвейеры релиза | `RELEASE_PIPELINE_RECIPES.md` | ★★★★★ |
| 19 | Docker Swarm как цель раскатки | `DEPLOY_SWARM.md` | ★★ |
| 20 | Управляемые платформы: ECS, Cloud Run, голая VM | `DEPLOY_CLOUD_PLATFORMS.md` | ★★★ |
| 21 | Terraform внутри конвейера | `TERRAFORM_IN_PIPELINE.md` | ★★★ |
| 22 | Кто владеет инфраструктурой | `IAC_OWNERSHIP.md` | ★★★ |
| 23 | Куда уходит время прогона | `PIPELINE_DURATION.md` | ★★★★ |
| 24 | Пропускная способность и доверие к конвейеру | `PIPELINE_THROUGHPUT.md` | ★★★★ |

**Объём файла — 11 000–13 000 знаков, то есть 10–15 минут чтения.** Тема, которая в это не влезает,
разрезана на два файла, а не ужата до конспекта: правило и его причины — в
[`knowledge/THEORY_CONTRACT.md`](../../knowledge/THEORY_CONTRACT.md) §1.

---

## Сквозной пример модуля

> Сервис **`payments`**: Spring Boot 3, Java 21, Maven, PostgreSQL. Пик — **40 запросов в секунду**
> (то же число, что в [`RELEASE_STRATEGIES.md` §8](../engineering-process/theory/RELEASE_STRATEGIES.md)
> модуля engineering-process). Один `git push` в `main` → сборка → тесты → образ → реестр →
> dev → qa → staging. Базовая сборка занимает 12 минут; по ходу модуля разбирается, из чего
> они складываются и что с этим делать.

---

## Блок 1: Модель конвейера

📖 [theory/PIPELINE_MODEL.md](theory/PIPELINE_MODEL.md) · [theory/PIPELINE_GUARANTEES.md](theory/PIPELINE_GUARANTEES.md)

- [ ] Что физически происходит между `git push` и запущенным сервисом — по шагам
- [ ] Событие → задание → шаг: из чего конвейер собран и что чем управляет
- [ ] Почему конвейер — граф зависимостей, а не список этапов
- [ ] Один узел упал: пропущено против упало
- [ ] Эфемерность исполнителя и всё, что из неё следует
- [ ] CI, continuous delivery и непрерывное развёртывание — три разных обещания
- [ ] Длина цикла обратной связи как главная метрика конвейера

---

## Блок 2: Исполнители и цена выполнения

📖 [theory/RUNNERS.md](theory/RUNNERS.md) · [theory/PIPELINE_CACHE_AND_CONCURRENCY.md](theory/PIPELINE_CACHE_AND_CONCURRENCY.md)

- [ ] Управляемые исполнители против собственных: что покупаете и чем платите
- [ ] Тип исполнителя — контейнер, виртуальная машина, shell: чем отличаются
- [ ] «Локально собирается, в CI нет»: полный список причин
- [ ] Почему собственный исполнитель на публичном репозитории — дыра
- [ ] Кэш: ключ как утверждение, промах, отравление
- [ ] Артефакты между заданиями против кэша — разные механизмы для разных задач
- [ ] Параллелизм, матрица сборок, очередь и ограничение конкурентности
- [ ] Экономика минут и собственный парк на прерываемых машинах

---

## Блок 3: Инструменты

📖 [theory/TOOLS_COMPARED.md](theory/TOOLS_COMPARED.md) · [theory/JENKINS_IN_DEPTH.md](theory/JENKINS_IN_DEPTH.md)

- [ ] Один и тот же конвейер `payments` на трёх языках: Actions, GitLab CI, Jenkins
- [ ] Три модели композиции: чужие действия · встроенные этапы · агент с плагинами
- [ ] `rules`/`needs` против `stage`: как каждый выражает граф зависимостей
- [ ] Где у каждого болит: версии действий, права токена, состояние агента
- [ ] Одной строкой: TeamCity, CircleCI, Tekton, Argo Workflows
- [ ] Критерий выбора: что должно быть правдой, чтобы взять именно этот
- [ ] Jenkins: Declarative против Scripted, общая библиотека, цена долгоживущего агента

---

## Блок 4: Сборка артефакта

📖 [theory/JAVA_BUILD_IN_CI.md](theory/JAVA_BUILD_IN_CI.md) · [theory/IMAGE_BUILD_IN_CI.md](theory/IMAGE_BUILD_IN_CI.md) · [theory/IMAGE_REGISTRY_AND_TAGS.md](theory/IMAGE_REGISTRY_AND_TAGS.md)

- [ ] `mvn -B -ntp` и почему интерактивные флаги ломают лог конвейера
- [ ] Кэш `~/.m2`: сколько экономит и когда травит сборку
- [ ] SNAPSHOT против неизменяемой версии; surefire против failsafe
- [ ] Testcontainers в конвейере: сокет, DinD, ryuk
- [ ] Воспроизводимая сборка: два прогона одного коммита и один `sha256`
- [ ] Почему `docker build` внутри контейнера — проблема: DinD, привилегии, сокет хоста
- [ ] Kaniko, Buildah, BuildKit как три разных ответа на неё
- [ ] Кэш слоёв через реестр; layered jar, Jib, buildpacks
- [ ] Теги против дайджеста: почему `latest` и `dev` ломают продвижение
- [ ] Аутентификация в реестре, сборка мусора, образы под несколько архитектур

---

## Блок 5: Безопасность цепочки поставки

📖 [theory/PIPELINE_CREDENTIALS.md](theory/PIPELINE_CREDENTIALS.md) · [theory/SUPPLY_CHAIN_ATTACKS.md](theory/SUPPLY_CHAIN_ATTACKS.md)

- [ ] Долгоживущий ключ в переменных конвейера — это инцидент, а не настройка
- [ ] OIDC-федерация: доступ в облако без хранимого секрета
- [ ] Маскирование секретов и как его обходят случайно
- [ ] Права токена конвейера по умолчанию; защищённые окружения и одобрение
- [ ] `pull_request_target` и инъекция через контекст события
- [ ] Закрепление действия по SHA
- [ ] Сканирование образа: что оно принципиально не ловит
- [ ] Подпись образа, SBOM, SLSA; dependency confusion

---

## Блок 6: Окружения и продвижение

📖 [theory/ENVIRONMENTS_AND_PROMOTION.md](theory/ENVIRONMENTS_AND_PROMOTION.md) · [theory/ENVIRONMENT_ANATOMY.md](theory/ENVIRONMENT_ANATOMY.md)

- [ ] Главное правило: собрать один раз, продвигать тот же артефакт
- [ ] Почему пересборка на каждое окружение — потеря гарантии
- [ ] Ворота против согласования: кто инициирует переход
- [ ] Сколько окружений реально нужно
- [ ] Конфигурация отдельно от образа: где живёт и кто подставляет
- [ ] Что делает окружение окружением; окружения по требованию на пулл-реквест
- [ ] Куда встаёт миграция схемы

---

## Блок 7: Как изменение попадает в кластер

📖 [theory/DELIVERY_PUSH_VS_PULL.md](theory/DELIVERY_PUSH_VS_PULL.md) · [theory/GITOPS_REPOSITORIES.md](theory/GITOPS_REPOSITORIES.md)

- [ ] Конвейер с креденшелами кластера против агента внутри кластера
- [ ] Согласование и расхождение: почему «истина в Git» — про восстановимость
- [ ] Argo CD против Flux; чего GitOps не решает
- [ ] Репозиторий приложения против репозитория конфигурации
- [ ] Продвижение как пулл-реквест между overlay окружений
- [ ] Откат как `git revert` и когда это не работает

---

## Блок 8: Раскатка и релиз

📖 [theory/DEPLOY_TO_K8S.md](theory/DEPLOY_TO_K8S.md) · [theory/PROGRESSIVE_DELIVERY_K8S.md](theory/PROGRESSIVE_DELIVERY_K8S.md) · [theory/RELEASE_PIPELINE_RECIPES.md](theory/RELEASE_PIPELINE_RECIPES.md) · [theory/DEPLOY_SWARM.md](theory/DEPLOY_SWARM.md)

- [ ] `kubectl apply` против `helm upgrade --atomic` против синхронизации Argo CD
- [ ] Ожидание готовности: почему без него конвейер зелёный, а под падает
- [ ] Что технически «откатывается» в kubectl, Helm и Argo CD
- [ ] Почему `RollingUpdate` не даёт канарейку, а доля на репликах равна `1/N`
- [ ] `weight` в `HTTPRoute`: доли, а не проценты; A/B по заголовку
- [ ] Blue-green: `autoPromotionEnabled`, переключение селектора, задержка остановки
- [ ] Argo Rollouts: шаги, паузы, промоут и прерывание; `AnalysisTemplate` как гейт
- [ ] Flagger против Argo Rollouts: кто владеет Deployment
- [ ] Четыре шага любого релизного конвейера и тот, который забывают
- [ ] Рецепты: толчком с гейтом в конвейере, через GitOps, blue-green с превью-адресом
- [ ] Docker Swarm: `stack deploy`, `update_config`, `rollback_config` на живом прогоне

---

## Блок 9: Платформы и инфраструктура

📖 [theory/DEPLOY_CLOUD_PLATFORMS.md](theory/DEPLOY_CLOUD_PLATFORMS.md) · [theory/TERRAFORM_IN_PIPELINE.md](theory/TERRAFORM_IN_PIPELINE.md) · [theory/IAC_OWNERSHIP.md](theory/IAC_OWNERSHIP.md)

- [ ] AWS: ECS/Fargate, EKS, App Runner — чем отличаются; GCP: Cloud Run и GKE
- [ ] Голая виртуальная машина с systemd как нижняя граница
- [ ] Критерий выбора: ревизии и откат, холодный старт, цена простоя, привязка
- [ ] Почему `apply` из конвейера страшнее раскатки приложения
- [ ] `plan` как артефакт ревью; блокировка состояния
- [ ] Окружения: workspaces против отдельных директорий
- [ ] Задание обнаружения расхождения; кто владеет `apply`
- [ ] Ansible: настройка машины против выделения ресурсов

---

## Блок 10: Экономика конвейера

📖 [theory/PIPELINE_DURATION.md](theory/PIPELINE_DURATION.md) · [theory/PIPELINE_THROUGHPUT.md](theory/PIPELINE_THROUGHPUT.md)

- [ ] Бюджет длительности: откуда берутся двенадцать минут
- [ ] Окупаемость кэша; порядок этапов и раннее падение
- [ ] Отладка конвейера, когда «локально работает»
- [ ] Ненадёжные тесты: карантин и чем повтор отличается от лечения
- [ ] Очередь слияния: зачем она и что стоит
- [ ] Монорепозиторий: выборочная сборка по путям
- [ ] Метрики самого конвейера и их связь с метриками доставки

---

## Материалы модуля

| Что | Где |
|---|---|
| Сервис `payments` | `src/main/java/by/pavel/payments/` |
| Образ | `Dockerfile` |
| Конвейеры на трёх языках | `pipelines/github/`, `pipelines/gitlab/`, `pipelines/jenkins/` |
| Сквозные релизные конвейеры | `pipelines/github/release-canary.yml`, `release-gitops.yml` |
| Манифесты Argo Rollouts | `pipelines/rollouts/` (канарейка, blue-green, анализ, `HTTPRoute`) |
| Чарт Helm с окружениями | `pipelines/helm/payments/` |
| Kustomize base + overlays | `pipelines/kustomize/` |
| Манифесты Argo CD | `pipelines/argocd/` |
| Стек Docker Swarm | `pipelines/swarm/` |
| Модуль Terraform | `pipelines/terraform/` |

> Файлы в `pipelines/` — учебные артефакты для чтения. Они намеренно лежат внутри модуля,
> а не в корне репозитория: `.github/workflows/` в корне GitHub исполнил бы по-настоящему.
> В самой теории на них не ссылаются: её читают с телефона, где репозитория нет, поэтому
> все нужные фрагменты показаны прямо в тексте.
