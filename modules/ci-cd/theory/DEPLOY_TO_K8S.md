# Раскатка в Kubernetes: применение, ожидание готовности и откат

> **Какую проблему решает.** Шаг `deploy-qa` отработал за восемь секунд, конвейер зелёный, а сервис лежит: новые поды в `CrashLoopBackOff`, старых уже нет — и отдельно слово «откат» прячет три операции с разными хранилищами предыдущей версии.
> **Кому это надо.** Тому, кто пишет шаг раскатки и должен объяснить выбор `helm upgrade`, а не `kubectl apply`.
> **Когда НЕ надо.** Без пробы готовности ничего здесь не поможет: все три способа ожидания спрашивают кластер «готово?», а без проб это вырождается в «контейнер запустился».

**Границы.** Кто применяет изменение — [`DELIVERY_PUSH_VS_PULL.md` §1](DELIVERY_PUSH_VS_PULL.md), откат конфигурации — [`GITOPS_REPOSITORIES.md` §3](GITOPS_REPOSITORIES.md). Та же цель на Docker Swarm — [`DEPLOY_SWARM.md`](DEPLOY_SWARM.md); канарейка, blue-green, A/B поверх раскатки — [`PROGRESSIVE_DELIVERY_K8S.md`](PROGRESSIVE_DELIVERY_K8S.md). Объекты Kubernetes и пробы готовности — [`KUBERNETES.md` §5, §10](../../infrastructure/theory/KUBERNETES.md); чарт и хуки — [`HELM.md` §2, §4, §5](../../infrastructure/theory/HELM.md).

Пример — сервис `payments`, три реплики; раскатка на этом стенде не прогонялась, всё подпёрто документацией (Helm v4.2.4).

---

## 1. `kubectl apply`, `helm upgrade` и синхронизация Argo CD: чем платит каждый

Вариантов, чем написать шаг раскатки, три; отличаются они не синтаксисом, а тем, **где хранится предыдущее состояние всего набора ресурсов**.

*`kubectl apply -f k8s/`: нигде.* На одном Deployment это лучший ответ, но `payments` — не один объект: Deployment, Service, ConfigMap, Secret, Ingress, HPA, PodDisruptionBudget. `apply` обрабатывает объекты **по одному** — «sets fields that appear in the configuration file in the live configuration». Если пятый манифест не прошёл валидацию, первые четыре уже применены — кластер в состоянии, которого нет ни в одном файле. Предыдущая конфигурация живёт в аннотации `last-applied-configuration` каждого объекта отдельно; набор как целое не отслеживает никто.

*`helm upgrade`: в самом Helm.* Helm хранит **релиз** — набор ресурсов чарта плюс номер ревизии ([`HELM.md` §4](../../infrastructure/theory/HELM.md)), и обновление становится транзакцией:

> «`--rollback-on-failure` — if set, Helm will rollback the upgrade to previous success release upon failure. The `--wait` flag will be defaulted to "watcher" if `--rollback-on-failure` is set»
>
> — Helm docs, `helm upgrade`

**Осторожно с названием на собеседовании.** До Helm 4 флаг звался `--atomic`; теперь «`--atomic → --rollback-on-failure`» — старая форма ещё работает, но deprecated: `helm upgrade --help | grep -c atomic` возвращает `0`, а вызов с `--atomic` печатает `Flag --atomic has been deprecated, use --rollback-on-failure instead`. Предупреждение легко теряется в общем логе.

*Синхронизация Argo CD: в Git, применяет её не конвейер.* Шага раскатки нет вовсе: конвейер коммитит дайджест в конфигурацию, агент замечает расхождение и устраняет его ([`DELIVERY_PUSH_VS_PULL.md` §1](DELIVERY_PUSH_VS_PULL.md)); цикл согласования не мгновенный:

> «The automatic sync interval is determined by the `timeout.reconciliation` value in the `argocd-cm` ConfigMap, which defaults to `120s` with added jitter of `60s` for a maximum period of 3 minutes.»
>
> — Argo CD docs, «Automated Sync Policy»

| Способ | Что значит «шаг успешен» | Где предыдущее состояние набора | Кто откатывает | Чем платите |
|---|---|---|---|---|
| `kubectl apply -f` | API-сервер принял манифесты | нигде: только в Git ваших манифестов | вы, руками | частичное применение при ошибке в середине |
| `helm upgrade --rollback-on-failure` | Helm дождался готовности и зафиксировал ревизию | в истории релиза Helm | Helm сам | неудачный прогон удлиняется на ожидание + откат |
| синхронизация Argo CD | коммит записан в репозиторий конфигурации | в истории Git | согласование, после `git revert` | конвейер теряет обратную связь о раскатке |

Третья строка недооценена: вытягивание **не убирает** проблему, а переносит её — «зелёный» значит лишь «коммит записан», поднялся ли сервис, не узнать; связь возвращают отдельным шагом (`argocd app wait`, §2). Вторая строка платит временем именно когда болит: при неудаче шаг ждёт готовности до таймаута, потом откатывает и ждёт снова — быстрый сигнал «сломано» становится самым медленным шагом; кластер остаётся рабочим без человека.

**Правило.** Выбирайте не команду, а ответ: где хранится состояние ресурсов и кто обязан вернуть его без человека.

## 2. Ожидание готовности: почему конвейер зелёный, а под падает

Задание `deploy-qa` завершилось успешно — доказано этим одно: API-сервер принял YAML. Типичный шаг не содержит ни `--wait`, ни `--rollback-on-failure`, а по Helm 4 это означает:

> «`--wait WaitStrategy[=watcher]` — wait until resources are ready (up to `--timeout`)… **Default when flag is omitted: 'hookOnly'.**»
>
> — Helm docs, `helm upgrade`

Без флага Helm дожидается только хуков ([`HELM.md` §5](../../infrastructure/theory/HELM.md)), а готовности подов — нет: шаг зеленеет в момент записи ревизии, за секунды. Что случится с подами дальше — образ не скачается, проба не пройдёт — конвейер уже не увидит; с `kubectl apply -f` то же самое, и ещё нагляднее.

Это следствие модели: запись состояния и приведение фактического — **два разных события во времени**, разнесённые согласованием ([`KUBERNETES.md` §2](../../infrastructure/theory/KUBERNETES.md)). Команда записи не сообщает исход: в момент возврата согласование ещё не началось, и у кластера нужно спросить **второй раз**, другим вопросом — «готово?».

| Чем применили | Чем дожидаетесь |
|---|---|
| `kubectl apply -f` | `kubectl rollout status deployment/payments --timeout=5m` |
| `helm upgrade` | `--wait` (или `--rollback-on-failure`, который включает его сам) |
| коммит в репозиторий конфигурации | `argocd app wait payments-qa --health --sync --timeout 300` |

**Как ожидание кончается неудачей, и чего Kubernetes не делает.** У Deployment есть `progressDeadlineSeconds` — «the maximum time… before it is considered to be failed… **Defaults to 600s.**» И далее:

> «Kubernetes takes no action on a stalled Deployment other than to report a status condition with `reason: ProgressDeadlineExceeded`.»
>
> — Kubernetes docs, «Deployment», «Failed Deployment»

Kubernetes **не откатывает** застрявшую раскатку: старые поды живы, новые крутятся в отказе. Красным конвейер делает `kubectl rollout status`, а не кластер. Уберите ожидание — и единственный, кто замечает провал, исчезает из картины.

**Чего ожидание готовности не делает.** Оно проверяет ровно то, что проверяет проба: `httpGet` на `/actuator/health/readiness` значит «Spring поднял контекст», а не «сервис умеет обрабатывать платежи» ([`KUBERNETES.md` §10](../../infrastructure/theory/KUBERNETES.md)). Смоук-проверка — отдельный шаг.

**Правило.** Шаг раскатки — это **две** команды: «примени» и «дождись». Уберите пробу готовности — и все три способа ожидания продолжат отчитываться об успехе, потому что спрашивать им станет не о чем.

## 3. Декларативный `apply` против императивных команд в конвейере

Конвейер знает дайджест, и поменять надо одно поле — велик соблазн одной строкой без манифеста:

```bash
kubectl set image deployment/payments payments="registry.example.com/payments@$DIGEST"
```

Через две недели кто-то запускает `kubectl apply -f k8s/`, чтобы добавить переменную окружения, — и образ откатывается на записанный в файле: поле `image` там есть, значит `apply` его выставит. Императивная команда изменила живой объект, но не файл и не `last-applied-configuration` — для декларативного управления изменения не было.

> «A Kubernetes object should be managed using only one technique. Mixing and matching techniques for the same object results in undefined behavior.» «Commands do not provide a source of records except for what is live.»
>
> — Kubernetes docs, «Kubernetes Object Management»

Корень: **единственная запись о том, что развёрнуто, — сам кластер.** «Что сейчас на qa» не имеет ответа нигде, кроме `kubectl get`, а с ним исчезает сравнение желаемого с фактическим, на котором держится модель вытягивания ([`DELIVERY_PUSH_VS_PULL.md` §2](DELIVERY_PUSH_VS_PULL.md)).

**Тот же механизм даёт следствие про `replicas`.** Включённый HorizontalPodAutoscaler меняет `replicas` той же императивной командой. Держите `replicas: 3` в манифесте — и каждый `apply` вернёт три, отменяя автомасштабирование до его следующего срабатывания. Правило: **поле, которым управляет другой контроллер, не должно быть в манифесте** — у каждого поля один владелец.

**Когда императивная команда — правильный ответ.** Когда она сознательно одноразова: `kubectl scale` под всплеск, `kubectl delete pod` для проверки восстановления, `kubectl rollout undo` в инциденте (§4).

**Правило.** В конвейере — только декларативное применение: каждый прогон приводит кластер к состоянию из **репозитория**, а не складывается с предыдущими. После императивной команды то же изменение вносится в файл, иначе оно исчезнет при первом же `apply`.

## 4. Что технически «откатывается» в kubectl, Helm и Argo CD

«Мы откатили раскатку» — не ответ, пока не сказано, что именно: под одним словом живут три операции с разным охватом и разными хранилищами предыдущей версии.

*`kubectl rollout undo` — переключение на старый ReplicaSet.* Хранилище — сам Kubernetes: `revisionHistoryLimit` — «the number of old ReplicaSets to retain to allow rollback… **Defaults to 10**»; `--to-revision` по умолчанию 0, т.е. предыдущая. Охват точный: откатывается **только этот Deployment и только шаблон пода**. ConfigMap, Secret, Ingress, HPA в ревизию не входят — приехавший вместе новый ConfigMap не откатится, получится сочетание, которое никогда не тестировалось. Ловушка: `revisionHistoryLimit: 0` ставят «чтобы не мусорить» — после него откатывать нечем.

*`helm rollback` — возврат сохранённой ревизии релиза.* «If [the revision] argument is omitted or set to 0, it will roll back to the previous release.» Охват шире: назад едет **весь набор ресурсов чарта**, включая ConfigMap и Ingress, — единица истории здесь релиз. Граница тоже есть: Helm не знает об объектах, созданных не им, и не отменяет **последствия** хуков — миграция, отработавшая перед обновлением, откатом релиза не отменяется ([`HELM.md` §5](../../infrastructure/theory/HELM.md)).

*`git revert` — возврат желаемого состояния.* Хранилище — Git, исполнитель — согласование; разбор целиком — [`GITOPS_REPOSITORIES.md` §3](GITOPS_REPOSITORIES.md). Запрет, делающий модель непротиворечивой: «Rollback cannot be performed against an application with automated sync enabled».

| Операция | Где предыдущая версия | Что откатывается | Что НЕ откатывается |
|---|---|---|---|
| `kubectl rollout undo` | старые ReplicaSet, по умолчанию 10 | шаблон пода одного Deployment | ConfigMap, Secret, Ingress, всё остальное |
| `helm rollback` | история ревизий релиза Helm | все ресурсы чарта | объекты вне чарта, последствия хуков |
| `git revert` | история Git | всё, что описано в репозитории конфигурации | всё, что вышло за пределы кластера |

Правая колонка ценнее всего: строка, общая для всех трёх, — **база данных не откатывается ни одним механизмом**, схема миграции лежит вне охвата всех трёх историй ([`RELEASE_STRATEGIES.md` §7](../../engineering-process/theory/RELEASE_STRATEGIES.md)).

**Отдельная ошибка: откатывать не тем механизмом, которым раскатывали.** Раскатка через `helm upgrade`, откат — `kubectl rollout undo`: Deployment вернулся к старым подам, но Helm по-прежнему считает текущей свою ревизию со сломанным образом — тот самый undefined behavior для смешанного управления (§3). Две истории разошлись, и сводить их придётся руками, посреди инцидента.

**Правило.** Откатывайте **тем же инструментом, которым раскатывали**: `helm upgrade` → `helm rollback`, коммит в конфигурацию → `git revert`, `kubectl apply` → манифесты предыдущего коммита. Заранее ответьте на вопрос, который в инциденте задавать поздно: сколько версий сохранено и где.

## 5. Шпаргалка

| Что | По умолчанию | Последствие |
|---|---|---|
| `helm upgrade` без `--wait` | стратегия `hookOnly` | шаг зелёный до готовности подов |
| `--rollback-on-failure` | выключен; включает `--wait=watcher` | без него Helm ничего не откатывает |
| `.spec.progressDeadlineSeconds` | 600 с | после — только условие, отката не делается |
| `.spec.revisionHistoryLimit` | 10 | при `0` откатывать нечем |
| согласование Argo CD | 120 с + джиттер 60 с | коммит ≠ мгновенная раскатка |

### Формулировки для собеседования

- «Зелёный шаг раскатки доказывает только, что API-сервер принял манифест: готовности ждут отдельной командой, и ждёт она ровно то, что описывает проба готовности.»
- «Kubernetes не откатывает застрявшую раскатку — выставляет `ProgressDeadlineExceeded` и продолжает пытаться; красным конвейер делает `kubectl rollout status`, а не кластер.»
- «Три разных отката: ReplicaSet помнит поды, Helm помнит релиз, Git помнит всё описанное; базу не помнит никто.»

## Источники

- [Deployment — Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) — `RollingUpdate`, `progressDeadlineSeconds`, `revisionHistoryLimit`, «Kubernetes takes no action on a stalled Deployment».
- [Kubernetes Object Management](https://kubernetes.io/docs/concepts/overview/working-with-objects/object-management/) и [Declarative Management Using Configuration Files](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/) — «undefined behavior» смешанного управления, поведение `apply` и `last-applied-configuration`.
- [helm upgrade](https://helm.sh/docs/helm/helm_upgrade/) и [helm rollback](https://helm.sh/docs/helm/helm_rollback/) — `--wait` со значением по умолчанию `hookOnly`, `--rollback-on-failure` (бывший `--atomic`), возврат ревизии релиза.
- [Automated Sync Policy — Argo CD](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/) — интервал согласования 120 с + джиттер 60 с; запрет отката при автосинхронизации.
