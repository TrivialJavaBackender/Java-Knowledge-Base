# Раскатка в Kubernetes: применение, ожидание готовности и откат

> **Какую проблему решает.** Шаг `deploy-qa` отработал за восемь секунд, конвейер зелёный — а сервис лежит: новые поды в `CrashLoopBackOff`, старых уже нет. Вторая половина той же проблемы — слово «откат»: под ним прячутся три операции с тремя разными хранилищами предыдущей версии.
> **Кому это надо.** Тому, кто пишет шаг раскатки и должен ответить, почему выбрал `helm upgrade`, а не `kubectl apply`.
> **Когда НЕ надо.** Ничего из этого файла не поможет без пробы готовности: все три способа ожидания спрашивают кластер «готово?», а без проб ожидание вырождается в «контейнер запустился».

**Границы.** Кто применяет изменение — [`DELIVERY_PUSH_VS_PULL.md` §1](DELIVERY_PUSH_VS_PULL.md), откат репозитория конфигурации — [`GITOPS_REPOSITORIES.md` §3](GITOPS_REPOSITORIES.md). Та же цель на Docker Swarm — [`DEPLOY_SWARM.md`](DEPLOY_SWARM.md); канарейка, blue-green и A/B поверх этой раскатки — [`PROGRESSIVE_DELIVERY_K8S.md`](PROGRESSIVE_DELIVERY_K8S.md). Объекты Kubernetes и пробы готовности — [`KUBERNETES.md` §5, §10](../../infrastructure/theory/KUBERNETES.md); устройство чарта и хуки — [`HELM.md` §2, §4, §5](../../infrastructure/theory/HELM.md).

Пример — сервис `payments` (Spring Boot 3.3.4, Java 21, PostgreSQL, три реплики); раскатка на этом стенде не прогонялась, всё ниже подпёрто документацией (Helm v4.2.4).

---

## 1. `kubectl apply`, `helm upgrade` и синхронизация Argo CD: чем платит каждый

Вариантов, чем написать шаг раскатки, три, и отличаются они не синтаксисом, а тем, **где хранится предыдущее состояние всего набора ресурсов**.

*`kubectl apply -f k8s/`: нигде.* На одном Deployment это лучший ответ, но `payments` — не один объект: Deployment, Service, ConfigMap, Secret, Ingress, HPA, PodDisruptionBudget. `apply` обрабатывает объекты **по одному** — «sets fields that appear in the configuration file in the live configuration». Если пятый манифест не прошёл валидацию, первые четыре уже применены, и кластер остаётся в состоянии, которого нет ни в одном файле. Предыдущая конфигурация живёт в аннотации `last-applied-configuration` каждого объекта отдельно; набор как целое не отслеживает никто.

*`helm upgrade`: в самом Helm.* Helm хранит **релиз** — набор ресурсов чарта плюс номер ревизии ([`HELM.md` §4](../../infrastructure/theory/HELM.md)), и обновление становится транзакцией:

> «`--rollback-on-failure` — if set, Helm will rollback the upgrade to previous success release upon failure. The `--wait` flag will be defaulted to "watcher" if `--rollback-on-failure` is set»
>
> — Helm docs, `helm upgrade`

**Осторожно с названием на собеседовании.** До Helm 4 флаг назывался `--atomic`; теперь «`--atomic → --rollback-on-failure`», старая форма ещё принимается, но deprecated:

```
$ helm upgrade --help | grep -c atomic
0
$ helm upgrade payments ./payments --atomic --dry-run …
Flag --atomic has been deprecated, use --rollback-on-failure instead
```

В справке флага уже нет, а аргументы он ещё принимает — скрипт 2022 года работает, предупреждение теряется в логе.

*Синхронизация Argo CD: в Git, и применяет её не конвейер.* Шага раскатки в конвейере нет вовсе: конвейер коммитит дайджест в репозиторий конфигурации, агент замечает расхождение и устраняет его ([`DELIVERY_PUSH_VS_PULL.md` §1](DELIVERY_PUSH_VS_PULL.md)). Цикл согласования не мгновенный:

> «The automatic sync interval is determined by the `timeout.reconciliation` value in the `argocd-cm` ConfigMap, which defaults to `120s` with added jitter of `60s` for a maximum period of 3 minutes.»
>
> — Argo CD docs, «Automated Sync Policy»

| Способ | Что значит «шаг успешен» | Где предыдущее состояние набора | Кто откатывает | Чем платите |
|---|---|---|---|---|
| `kubectl apply -f` | API-сервер принял манифесты | нигде: только в Git ваших манифестов | вы, руками | частичное применение при ошибке в середине |
| `helm upgrade --rollback-on-failure` | Helm дождался готовности и зафиксировал ревизию | в истории релиза Helm | Helm сам | неудачный прогон удлиняется на ожидание + откат |
| синхронизация Argo CD | коммит записан в репозиторий конфигурации | в истории Git | согласование, после `git revert` | конвейер теряет обратную связь о раскатке |

Третья строка недооценена: вытягивание **не убирает** проблему, а переносит её — «зелёный конвейер» теперь значит лишь «коммит записан», узнать из него, поднялся ли сервис, нельзя в принципе; связь возвращают отдельным шагом (`argocd app wait`, §2). Вторая строка платит временем именно тогда, когда болит: при неудаче шаг ждёт готовности до таймаута, потом откатывает и ждёт снова — самый быстрый сигнал «сломано» становится самым медленным шагом. Размен осознанный: кластер остаётся рабочим без участия человека.

**Правило.** Выбирайте не команду, а ответ на вопрос: где хранится предыдущее состояние всего набора ресурсов и кто обязан вернуть его без человека.

## 2. Ожидание готовности: почему конвейер зелёный, а под падает

Задание `deploy-qa` завершилось успешно. Доказано этим одно: API-сервер принял YAML. Типичный шаг раскатки не содержит ни `--wait`, ни `--rollback-on-failure`. По документации Helm 4 это означает:

> «`--wait WaitStrategy[=watcher]` — wait until resources are ready (up to `--timeout`)… **Default when flag is omitted: 'hookOnly'.**»
>
> — Helm docs, `helm upgrade`

Без флага Helm дожидается только хуков ([`HELM.md` §5](../../infrastructure/theory/HELM.md)), а готовности подов — нет: шаг зеленеет в момент записи ревизии, за секунды. Что случится с подами дальше — образ не скачается, проба не пройдёт, — конвейер уже не увидит; с `kubectl apply -f` то же самое и ещё нагляднее.

Это следствие модели: запись желаемого состояния и приведение фактического — **два разных события во времени**, разнесённые циклом согласования ([`KUBERNETES.md` §2](../../infrastructure/theory/KUBERNETES.md)). Команда записи не может сообщить исход согласования: в момент её возврата согласование ещё не началось. У кластера нужно спросить **второй раз** и другим вопросом — «готово?».

| Чем применили | Чем дожидаетесь |
|---|---|
| `kubectl apply -f` | `kubectl rollout status deployment/payments --timeout=5m` |
| `helm upgrade` | `--wait` (или `--rollback-on-failure`, который включает его сам) |
| коммит в репозиторий конфигурации | `argocd app wait payments-qa --health --sync --timeout 300` |

**Как ожидание кончается неудачей — и чего Kubernetes при этом не делает.** У Deployment есть `progressDeadlineSeconds` — «the maximum time… before it is considered to be failed… **Defaults to 600s.**» И далее:

> «Kubernetes takes no action on a stalled Deployment other than to report a status condition with `reason: ProgressDeadlineExceeded`.»
>
> — Kubernetes docs, «Deployment», «Failed Deployment»

Kubernetes **не откатывает** застрявшую раскатку: старые поды при `RollingUpdate` остаются живы, новые крутятся в отказе. Красным конвейер делает `kubectl rollout status`, а не кластер. Уберите ожидание — и единственный, кто замечает провал, исчезает из картины.

**Чего ожидание готовности не делает.** Оно проверяет ровно то, что проверяет проба готовности: `httpGet` на `/actuator/health/readiness` означает «Spring поднял контекст», а не «сервис умеет обрабатывать платежи» ([`KUBERNETES.md` §10](../../infrastructure/theory/KUBERNETES.md)). Смоук-проверка — отдельный шаг конвейера.

**Правило.** Шаг раскатки состоит из **двух** команд, а не из одной: «примени» и «дождись». Уберите у сервиса пробу готовности — и все три способа ожидания продолжат отчитываться об успехе, потому что спрашивать им станет не о чем.

## 3. Декларативный `apply` против императивных команд в конвейере

Конвейер знает дайджест, и поменять надо одно поле — велик соблазн одной строкой без манифеста:

```bash
kubectl set image deployment/payments payments="registry.example.com/payments@$DIGEST"
```

Через две недели кто-то запускает `kubectl apply -f k8s/`, чтобы добавить переменную окружения, — и образ откатывается на записанный в файле: поле `image` там есть, значит `apply` его выставит. Императивная команда изменила живой объект, но не файл и не аннотацию `last-applied-configuration` — для декларативного управления изменения просто не было.

> «A Kubernetes object should be managed using only one technique. Mixing and matching techniques for the same object results in undefined behavior.» «Commands do not integrate with change review processes.» «Commands do not provide an audit trail associated with changes.» «Commands do not provide a source of records except for what is live.»
>
> — Kubernetes docs, «Kubernetes Object Management»

Корень — в последней фразе: **единственная запись о том, что развёрнуто, — сам кластер.** «Что сейчас на qa» не имеет ответа нигде, кроме `kubectl get`, а с ним исчезает и сравнение желаемого с фактическим, на котором держится модель вытягивания ([`DELIVERY_PUSH_VS_PULL.md` §2](DELIVERY_PUSH_VS_PULL.md)).

**Тот же механизм даёт следствие про `replicas`.** Включённый HorizontalPodAutoscaler меняет `replicas` живого объекта, выступая той же императивной командой. Держите `replicas: 3` в манифесте — и каждый `apply` будет возвращать три, отменяя автомасштабирование до его следующего срабатывания. Правило: **поле, которым управляет другой контроллер, не должно присутствовать в манифесте** — у каждого поля один владелец.

**Когда императивная команда — правильный ответ.** Когда она сознательно одноразова: `kubectl scale` под всплеск нагрузки, `kubectl delete pod` для проверки восстановления, `kubectl rollout undo` в инциденте (§4).

**Правило.** В конвейере — только декларативное применение: каждый прогон обязан приводить кластер к состоянию, записанному **в репозитории**, а не складываться с предыдущими. После императивной команды то же изменение вносится в файл, иначе оно исчезнет при первом же `apply`.

## 4. Что технически «откатывается» в kubectl, Helm и Argo CD

«Мы откатили раскатку» — не ответ, пока не сказано, что именно: под одним словом живут три операции с разным охватом и тремя разными хранилищами предыдущей версии.

*`kubectl rollout undo` — переключение на старый ReplicaSet.* Хранилище — сам Kubernetes: `revisionHistoryLimit` — «the number of old ReplicaSets to retain to allow rollback… **Defaults to 10**»; `--to-revision` по умолчанию 0, то есть предыдущая. Охват точный: откатывается **только этот Deployment и только шаблон пода**. ConfigMap, Secret, Ingress, HPA в ревизию не входят — если новая версия приехала с новым ConfigMap, `rollout undo` соберёт старые поды с новой конфигурацией, сочетание, которое никогда не тестировалось. Ловушка: `revisionHistoryLimit: 0` часто ставят «чтобы не мусорить» — после него откатывать нечем.

*`helm rollback` — возврат сохранённой ревизии релиза.* «If [the revision] argument is omitted or set to 0, it will roll back to the previous release.» Охват шире: назад едет **весь набор ресурсов чарта**, включая ConfigMap и Ingress, — единица истории здесь релиз. Граница тоже есть: Helm не знает об объектах, созданных не им, и не отменяет **последствия** хуков — отработавшее перед обновлением задание миграции откатом релиза не отменяется никак ([`HELM.md` §5](../../infrastructure/theory/HELM.md)).

*`git revert` — возврат желаемого состояния.* Хранилище — Git, исполнитель — цикл согласования; разбор целиком — [`GITOPS_REPOSITORIES.md` §3](GITOPS_REPOSITORIES.md). Важен запрет, делающий модель непротиворечивой: «Rollback cannot be performed against an application with automated sync enabled».

| Операция | Где предыдущая версия | Что откатывается | Что НЕ откатывается |
|---|---|---|---|
| `kubectl rollout undo` | старые ReplicaSet, по умолчанию 10 | шаблон пода одного Deployment | ConfigMap, Secret, Ingress, всё остальное |
| `helm rollback` | история ревизий релиза Helm | все ресурсы чарта | объекты вне чарта, последствия хуков |
| `git revert` | история Git | всё, что описано в репозитории конфигурации | всё, что вышло за пределы кластера |

Правая колонка ценнее всего: в ней есть строка, общая для всех трёх — **база данных не откатывается ни одним из механизмов**, схема миграции лежит вне охвата всех трёх историй ([`RELEASE_STRATEGIES.md` §7](../../engineering-process/theory/RELEASE_STRATEGIES.md)).

**Отдельная ошибка: откатывать не тем механизмом, которым раскатывали.** Раскатка шла через `helm upgrade`, откат сделали `kubectl rollout undo` — живой Deployment вернулся к старым подам, но Helm по-прежнему считает текущей записанную им ревизию со сломанным образом. Что случится при следующем `helm upgrade`, зависит от того, как Helm сольёт файл, свою запись и живой объект, — тот самый undefined behavior (§3). Надёжен один вывод: две истории разошлись, и сводить их придётся руками, посреди инцидента.

**Правило.** Откатывайте **тем же инструментом, которым раскатывали**: `helm upgrade` → `helm rollback`, коммит в конфигурацию → `git revert`, `kubectl apply` → манифесты предыдущего коммита. И до инцидента ответьте на вопрос, который в инциденте задавать поздно: сколько версий сохранено и где.

## 5. Шпаргалка

| Что | По умолчанию | Последствие |
|---|---|---|
| `helm upgrade` без `--wait` | стратегия `hookOnly` | шаг зелёный до готовности подов |
| `--rollback-on-failure` | выключен; включает `--wait=watcher` | без него Helm ничего не откатывает |
| `.spec.progressDeadlineSeconds` | 600 с | после — только условие, отката не делается |
| `.spec.revisionHistoryLimit` | 10 | при `0` откатывать нечем |
| согласование Argo CD | 120 с + джиттер 60 с | коммит ≠ мгновенная раскатка |

### Формулировки для собеседования

- «Зелёный шаг раскатки доказывает, что API-сервер принял манифест, и больше ничего: ждать готовности надо отдельной командой, и ждёт она ровно то, что описывает проба готовности.»
- «Kubernetes не откатывает застрявшую раскатку — он выставляет `ProgressDeadlineExceeded` и продолжает пытаться; красным конвейер делает `kubectl rollout status`, а не кластер.»
- «Три разных отката: ReplicaSet помнит поды, Helm помнит релиз, Git помнит всё описанное; базу не помнит никто.»

## Источники

- [Deployment — Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) — `RollingUpdate`, `progressDeadlineSeconds`, `revisionHistoryLimit` и «Kubernetes takes no action on a stalled Deployment».
- [Kubernetes Object Management](https://kubernetes.io/docs/concepts/overview/working-with-objects/object-management/) и [Declarative Management Using Configuration Files](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/) — «managed using only one technique… results in undefined behavior», поведение `apply` и аннотация `last-applied-configuration`.
- [helm upgrade](https://helm.sh/docs/helm/helm_upgrade/) и [helm rollback](https://helm.sh/docs/helm/helm_rollback/) — `--wait` со значением по умолчанию `hookOnly`, `--rollback-on-failure` (бывший `--atomic`), возврат ревизии релиза.
- [Automated Sync Policy — Argo CD](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/) — интервал согласования 120 с + джиттер 60 с; запрет отката при включённой автосинхронизации.
