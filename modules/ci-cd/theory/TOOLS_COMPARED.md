# Три инструмента на одной задаче: GitHub Actions, GitLab CI, Jenkins

> **Какую проблему решает.** «Чем Actions отличается от GitLab CI и от Jenkins» проваливают перечислением синтаксиса, хотя модель у всех троих одна — граф заданий, а различаются они тем, из чего конвейер собирают: из чужих компонентов, из возможностей платформы или из плагинов и своего кода.
> **Кому это надо.** Тому, кто переносит конвейер и обнаруживает, что переносится не текст, а решения, и тому, кто выбирает инструмент для новой команды.
> **Когда НЕ надо.** Сравнение инструментов не отвечает на вопрос «почему мой конвейер идёт 12 минут».

**Границы.** Граф заданий — [`PIPELINE_MODEL.md` §3](PIPELINE_MODEL.md); исполнители, кэш и артефакты — [`RUNNERS.md`](RUNNERS.md), [`PIPELINE_CACHE_AND_CONCURRENCY.md`](PIPELINE_CACHE_AND_CONCURRENCY.md). Jenkins целиком — [`JENKINS_IN_DEPTH.md`](JENKINS_IN_DEPTH.md), файл-близнец. Токен и версии сторонних компонентов — [`PIPELINE_CREDENTIALS.md` §4](PIPELINE_CREDENTIALS.md), [`SUPPLY_CHAIN_ATTACKS.md` §2](SUPPLY_CHAIN_ATTACKS.md).

---

## 1. Один и тот же конвейер `payments` на трёх языках

Путь: клонировать → собрать и прогнать модульные тесты → интеграционные → собрать образ и отправить в реестр → раскатать на dev → одобрение человека → раскатать на qa. Команды переносятся один в один (`mvn clean package`, `docker buildx build --push`, `helm upgrade`); не переносятся три решения о композиции.

*Ручное одобрение живёт в разных местах модели.* В Actions — свойство окружения (`environment: qa` + required reviewers); в GitLab — свойство задания (`rules: [{ when: manual }]`); в Jenkins — обычный шаг внутри стадии:

```groovy
stage('deploy-qa') {
  steps {
    timeout(time: 30, unit: 'MINUTES') { input message: 'Катим на qa?' }
    sh 'helm upgrade payments ./chart --set image.digest=$DIGEST'
  }
}
```

| | Где живёт одобрение | Следствие |
|---|---|---|
| Actions | свойство **окружения** | секреты qa недоступны, пока не одобрено |
| GitLab | свойство **задания** | задание стоит и ждёт нажатия |
| Jenkins | обычный **шаг** (`input`) | ожидание занимает место в конвейере, нужен таймаут |

*Java и Docker.* Actions — компонент `actions/setup-java@v4`; GitLab — образ `image: maven:3.9-eclipse-temurin-21`; Jenkins — `label 'linux && docker'`, версия зависит от того, кто настраивал агент. Файл между заданиями — `upload-artifact`, `artifacts:`, `stash`/`unstash`: три ответа на одно, задания не делят диск ([`PIPELINE_CACHE_AND_CONCURRENCY.md` §2](PIPELINE_CACHE_AND_CONCURRENCY.md)); значение — `artifacts:reports:dotenv`, `outputs`, блок `script`.

**Правило.** Переносится **работа**, не переносится **композиция**: откуда берётся переиспользуемый кусок, кто даёт окружение, чем выражено ожидание человека, что переживает границу задания.

## 2. Три модели композиции

Общая для тридцати сервисов логика — собрать образ, дайджест, SBOM, отправить в реестр; копирование в тридцать файлов работает до первой правки. У каждого инструмента свой ответ, где живёт переиспользуемый кусок конвейера.

**Actions — чужой пакет кода.** «An **action** is a pre-defined, reusable set of jobs or code… you can find actions to use in your workflows in the GitHub Marketplace.» Слово «find» задаёт модель: нужный кусок уже написан посторонним и подключается по имени и версии — так делается даже клонирование (`actions/checkout@v4`). Сила — нужное почти всегда уже есть; слабость (§4) — версия чужого кода указана строкой.

**GitLab — возможность платформы.** Отчёт о тестах, история развёртываний, одобрение, реестр — поля конфигурации, не компоненты: «A GitLab environment represents a specific deployment target… If they find a problematic deployment, they can roll back to a previous stable version.» Логику там выносят `include` — переиспользуют **конфигурацию**, а не код.

**Jenkins — плагин или ваш Groovy-код.** «Jenkins Pipeline… is a suite of plugins… extensible both by users with Pipeline Shared Libraries and by plugin developers.» Отчёт о тестах, доступ к учётным данным, реестр — всё плагин; какие установлены, решает администратор сервера, а не файл в репозитории. Общая логика — в shared library, вашем коде ([`JENKINS_IN_DEPTH.md` §2](JENKINS_IN_DEPTH.md)).

| | Автор куска | Контролируете | Платите |
|---|---|---|---|
| Actions | посторонний (маркетплейс) | строку с версией | исполнением чужого кода |
| GitLab CI | вендор платформы | конфигурацию | тем, что платформа умеет |
| Jenkins | вы и администратор сервера | всё | всё сами и поддерживаете |

**Правило.** «Какой инструмент лучше» бессодержательно — все трое исполняют одну модель графа; содержателен вопрос «чей код я хочу исполнять в своём конвейере» ([`PIPELINE_CACHE_AND_CONCURRENCY.md` §5](PIPELINE_CACHE_AND_CONCURRENCY.md)).

## 3. `rules`/`needs` против `stage`: как каждый выражает граф зависимостей

Статический анализ `payments` не зависит от сборки образа; по графу оба могут идти параллельно интеграционным тестам ([`PIPELINE_MODEL.md` §3](PIPELINE_MODEL.md)). Раз в Jenkins `stage` идёт сверху вниз, легко решить, что графа нет, — но он есть у всех троих, разное — **что считается умолчанием**.

*GitLab: умолчание — барьер, `needs` его снимает.* «Jobs in the same stage run in parallel. Jobs in the next stage run after the jobs from the previous stage complete successfully.» Без `needs` `integration-test` ждал бы **всех** заданий `build`, даже ненужных ему.

*Actions: барьера нет вовсе* — есть только задания и рёбра; несвязанное `needs` стартует одновременно.

*Jenkins: умолчание — последовательность, параллельность объявляется.* «Stages in Declarative Pipeline may have a `parallel` section containing a list of nested stages to be run in parallel.» Это вложенные стадии внутри одной, а не ребро, поэтому параллельная группа всегда сходится в одну точку.

| | Умолчание | Чем меняется | Какой граф выражается |
|---|---|---|---|
| Actions | параллельно | `needs` добавляет ребро | любой ациклический |
| GitLab CI | барьер этапа | `needs` снимает барьер | любой ациклический |
| Jenkins Declarative | последовательно | `parallel` внутри стадии | последовательность параллельных групп |

**Правило.** Умолчание — то, что вы получите, не подумав: в Actions недодуманный конвейер параллелен и падает на гонках за ресурс, в GitLab последователен и медленный, в Jenkins последователен всегда.

## 4. Где у каждого болит

Через полгода у каждого ломается то место, где он берёт работу за вас — следствие модели композиции (§2).

*Actions: чужой код, подключённый строкой.* `actions/checkout@v4` — подвижная метка, как тег образа: тот же тег после пересборки указывает на другой дайджест, без единой ошибки ([`PIPELINE_MODEL.md` §1](PIPELINE_MODEL.md)). «Pinning an action to a full-length commit SHA is currently the only way to use an action as an immutable release… a compromise of a single action within a workflow can be very significant.» Конвейер краснеет в понедельник без единой правки — сместилась метка; опаснее — доступ ко всем секретам репозитория ([`SUPPLY_CHAIN_ATTACKS.md` §2](SUPPLY_CHAIN_ATTACKS.md)).

*GitLab: токен задания, о котором забывают.* «GitLab generates a unique token and makes it available to the job as the CI_JOB_TOKEN predefined variable… It is a security risk to disable the token access limit and allowlist.» Токен приезжает сам и им удобно ходить в соседние репозитории; чтобы забрать общую библиотеку, кто-то ослабляет ограничение — и оно остаётся ослабленным навсегда ([`PIPELINE_CREDENTIALS.md` §4](PIPELINE_CREDENTIALS.md)).

*Jenkins: состояние агента и плагины.* Первое — [`JENKINS_IN_DEPTH.md` §3](JENKINS_IN_DEPTH.md). Второе: плагины живут в сервере, а не в репозитории, поэтому `Jenkinsfile` в Git **не описывает конвейер полностью** — один файл на двух установках ведёт себя по-разному, а обновление плагина меняет поведение всех конвейеров сразу без строки в истории репозитория.

**Правило.** Actions болит версионированием чужого кода, GitLab — интеграцией, включённой по умолчанию и шире, чем нужно, Jenkins — тем, что часть среды исполнения не помещается в репозиторий.

## 5. Одной строкой: TeamCity, CircleCI, Tekton, Argo Workflows

Держать в голове четвёртый и пятый синтаксис бессмысленно — важен водораздел. «Ещё одна CI-система, просто другая» верно для TeamCity и CircleCI и неверно для Tekton и Argo.

*TeamCity, CircleCI — та же ось, что в §2:* конфигурация в репозитории, задания, шаги, исполнители, компоненты; перенос `payments` — работа на день без новых понятий.

*Tekton и Argo — язык конвейера не свой, а API Kubernetes.* «Tekton Pipelines is a Kubernetes extension… It defines a set of Kubernetes Custom Resources that act as building blocks from which you can assemble CI/CD pipelines.» «Argo Workflows is implemented as a Kubernetes CRD… each step is a container.» Задание — объект кластера, «A `Task` executes as a Pod»: исполнителя как сущности нет (планирует Kubernetes, ресурсы — как ресурсы пода), конвейер — обычный ресурс, создаётся и правится теми же средствами, что развёртывания ([`KUBERNETES.md`](../../infrastructure/theory/KUBERNETES.md)), а цена входа — кластер: без него оба продукта не существуют.

**Граница применимости.** Оправдано, когда кластер уже есть, платформенная команда им занимается, конвейеров много и они разнородные. Кластер с тремя сервисами — Tekton добавляет слой понятий, не убирая ни одного.

## 6. Критерий выбора: что должно быть правдой

Сравнить возможности нельзя: все трое покрывают путь `payments` целиком, различаются тем, кто пишет переиспользуемые куски (§2) и что не помещается в репозиторий (§4). «Actions современнее», «Jenkins проверен временем» — тоже не ответы. Работают три вопроса: где уже живёт код, что из среды исполнения не помещается в репозиторий, кто это поддерживает.

Совместное расположение кода и конвейера — недооценённый фактор: пулл-реквест видит статус проверок, токен на клонирование уже есть, права наследуются от репозитория. Вопрос о среде исполнения — это §4, заданный заранее: «ничего, кроме секретов» — здоровая ситуация, «плагины сервера и то, что дежурный поставил на агент» — обещание расследований ([`JENKINS_IN_DEPTH.md` §3](JENKINS_IN_DEPTH.md)). У self-hosted Jenkins обязателен названный человек, отвечающий за сервер, агенты, плагины и восстановление после сбоя, а не «в команде кто-нибудь разберётся» — нет такого человека, выбор уже сделан: управляемый инструмент.

| Что должно быть правдой | Что из этого следует |
|---|---|
| Код в GitHub, команда небольшая | Actions; закреплять компоненты по SHA с первого дня (§4) |
| Код в GitLab, нужны окружения и реестр из коробки | GitLab CI; сузить права токена задания сразу |
| Есть роль сопровождения, много legacy, логика не выражается конфигурацией | Jenkins; shared library, агенты из описания ([`JENKINS_IN_DEPTH.md` §2, §3](JENKINS_IN_DEPTH.md)) |
| Кластер уже есть, конвейеров много и они разнородные | Tekton или Argo Workflows (§5) |
| Нужны специфические машины: macOS, GPU, прогретый кэш | любой из троих + свои исполнители ([`RUNNERS.md` §1](RUNNERS.md)) |

**Чего это не решает.** 12 минут складываются из графа и содержания заданий, а не из названия продукта ([`PIPELINE_DURATION.md` §1](PIPELINE_DURATION.md)); состав гейта — вопрос процесса ([`BRANCHING_AND_CODE_FLOW.md` §7](../../engineering-process/theory/BRANCHING_AND_CODE_FLOW.md)).

## 7. Шпаргалка

| Что спрашивают | Одна фраза |
|---|---|
| Чем отличаются три инструмента | моделью композиции: чужой код — платформа — свои плагины и Groovy |
| Где живёт общая логика | Actions: действие · GitLab: `include` · Jenkins: shared library |
| Умолчание графа | Actions: параллельно · GitLab: барьер · Jenkins: последовательно |
| Ручное одобрение | Actions: окружение · GitLab: задание · Jenkins: шаг `input` |
| Что болит через полгода | версии действий · права токена · состояние агента и плагины |
| Критерий выбора | где код · что не в репозитории · кто поддерживает |

### Формулировки для собеседования

- «Модель у всех троих одна — граф заданий; различаются не языки, а то, из чего конвейер собирают.»
- «Ручное одобрение — лакмусовая бумажка: в Actions это окружение, в GitLab — задание, в Jenkins — шаг.»
- «В Jenkins `parallel` — вложенные стадии внутри одной, а не ребро, поэтому параллельная группа сходится в одну точку.»

## Источники

- [Workflows and actions — GitHub Actions](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows) — action как пакет кода.
- [Manage environments — GitHub Actions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) — required reviewers на окружении.
- [Secure use reference — GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use) — закрепление действия по SHA.
- [GitLab CI/CD YAML syntax reference](https://docs.gitlab.com/ci/yaml/) — `stages`, `needs`, `rules`, `include`.
- [Environments — GitLab](https://docs.gitlab.com/ci/environments/) — окружение как объект платформы, откат.
- [GitLab CI/CD job token](https://docs.gitlab.com/ci/jobs/ci_job_token/) — `CI_JOB_TOKEN` и риск ослабления доступа.
- [Jenkins Pipeline](https://www.jenkins.io/doc/book/pipeline/) — Pipeline как набор плагинов.
- [Tekton Pipelines](https://tekton.dev/docs/pipelines/) — расширение Kubernetes через CRD.
- [Tekton Tasks](https://tekton.dev/docs/pipelines/tasks/) — `Task` — под, `Step` — контейнер.
- [Argo Workflows](https://argo-workflows.readthedocs.io/en/latest/) — конвейер как CRD.
