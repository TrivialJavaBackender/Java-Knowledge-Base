# Оркестрация: кто перезапускает ваше приложение в три часа ночи

> **Какую проблему решает.** Три экземпляра Orders API на трёх машинах — это уже вопросы: кто
> заметил, что один умер, и поднял замену; куда шлёт запросы балансировщик, пока новый экземпляр
> прогревается; как выкатить версию, не уронив все три сразу; что произойдёт, если машина кончилась
> по памяти. Kubernetes — ответ на все эти вопросы одним механизмом: вы описываете **желаемое**
> состояние, а контроллеры непрерывно приводят к нему фактическое.
> **Кому это надо.** Тому, чьё приложение живёт в кластере и кто дежурит по нему; тому, кто пишет
> манифесты и должен объяснить, почему под перезапускается по кругу; и тому, кого спросят «зачем
> readiness, если есть liveness».
> **Когда НЕ надо.** Kubernetes — это стоимость: узлы под control plane, человек, который умеет его
> чинить, и слой абстракций между вами и процессом. Одно приложение на одной машине он не сделает
> надёжнее — он добавит способов сломаться. Ему нужно **несколько** взаимозаменяемых экземпляров;
> если приложение не выдерживает потери экземпляра в любой момент, сначала это, потом кластер.
> Kubernetes также не делает приложение отказоустойчивым: он перезапускает контейнер, но не чинит
> ни каскад отказов ([`microservices/FAILURE_ISOLATION.md`](../../microservices/theory/FAILURE_ISOLATION.md)),
> ни потерянные данные (§14).

Сквозной пример модуля: Orders API — три экземпляра, 200 запросов в секунду, p99 не хуже 300 мс,
управляемый PostgreSQL снаружи кластера. В этом файле он существует как `Deployment` с пробами,
ресурсами и `Service` перед ним.

## 1. Откуда Kubernetes взялся

В начале 2010-х все большие платформы (Google, Twitter, Netflix, Airbnb) пришли независимо к одной и той же проблеме: «У нас десятки тысяч контейнеров на тысячах серверов. Кто-то должен это размещать, перезапускать упавшее, балансировать трафик, выкатывать новые версии без downtime, реагировать на нагрузку». Делать это руками — невозможно.

Google к тому моменту уже почти десятилетие гонял в проде систему **Borg** (с 2003): закрытая, проприетарная, ходит про неё знание только в whitepapers и от перешедших инженеров. Параллельно Twitter запустил **Mesos** (open-source, 2010), Docker community собирал **Swarm** (2014), HashiCorp — **Nomad** (2015).

В июне 2014 Google открыл **Kubernetes** — переработанный концепт Borg, открытый код, написанный на Go. Через год — donate в **Cloud Native Computing Foundation** (CNCF, 2015), которая стала «нейтральной территорией» для проекта.

К ~2017 году Kubernetes победил конкурентов. Почему:

1. **API-first design**. Всё в Kubernetes — это объект, доступный через одно и то же REST API. Pod, Service, Deployment, ConfigMap, ваш собственный custom resource — единая модель. Это позволило экосистеме (Helm, Istio, Argo, Prometheus operator) разрастаться без изменения core.
2. **Декларативная модель**. Вы описываете желаемое состояние; контроллеры приводят систему к нему. Не нужно писать скрипты «как именно мигрировать с версии 1.0 на 1.1».
3. **Расширяемость через CRD (Custom Resource Definitions)**. Можно ввести `kind: PostgresCluster` и контроллер, который умеет это поднимать. Operator pattern — целая индустрия.
4. **Платформенная нейтральность**. Работает на AWS, GCP, Azure, on-prem, bare-metal. Этого Mesos / Swarm не дали в той же мере.

Mesos в основном умер; Docker Swarm существует, но в нишевой роли (small-scale); Nomad жив, но в специфических use-cases (mixed-workload — VMs + containers + batch).

---

## 2. Декларативный подход и цикл согласования

Это ядро Kubernetes, без понимания которого всё остальное — мистика.

**Императивный подход**: «сделай X». Команда — действие. Если её не выполнить — ничего не произойдёт. Пример: `docker run`, `systemctl start`.

**Декларативный подход**: «должно стать X». Команда — описание желаемого состояния. Кто-то постоянно сравнивает реальность с описанием и приводит реальность в соответствие. Пример: SQL, Terraform, Kubernetes manifests.

### Аналогия: термостат

У вас в доме термостат, на котором стоит 22 °C. Это **желаемое состояние**. Реальная температура — **актуальное состояние**. Каждую минуту термостат измеряет реальность и:
- Если реальность < желаемого → включить отопление.
- Если реальность > желаемого → выключить отопление / включить кондиционер.
- Если совпадает → ничего не делать.

Этот цикл «измерить — сравнить — действовать» называется **reconciliation loop** (петля примирения). В Kubernetes так работает **всё**:

```
                  ┌─────────────────┐
   desired state  │ etcd            │  actual state
   (ваш yaml)     │ (Pod count = 3) │  (running Pods: 2)
                  └────────┬────────┘
                           │ "diff: -1 Pod"
                           ▼
                  ┌─────────────────┐
                  │ controller      │  ► create Pod (new one)
                  │ (Deployment)    │
                  └─────────────────┘
```

Каждый контроллер (Deployment, ReplicaSet, StatefulSet, Service, Job, Node, etc.) подписан на свой тип ресурсов в `etcd` и постоянно проверяет: спека = действительность? Если нет — действует.

Из этого вытекают важные практические следствия:

- **Идемпотентность**: `kubectl apply -f` 100 раз — то же, что и 1 раз. Контроллер только убирает diff.
- **Самовосстановление**: упал Pod → ReplicaSet видит «replicas: 3, alive: 2», создаёт новый.
- **Eventual consistency**: между «применил yaml» и «состояние сошлось» проходит время — секунды, иногда минуты. Это нормально.
- **Нет отката в смысле `git revert`**: если вы применили плохой yaml — `kubectl apply -f` старого yaml перезапишет ситуацию. Каждое примирение — это «новое желаемое состояние», без понятия истории.

---

## 3. Архитектура: управляющий слой и слой нагрузки

```
┌─────────────────── Kubernetes Cluster ───────────────────┐
│                                                          │
│  Control Plane (мозг)        Worker Nodes (мышцы)        │
│  ┌──────────────────┐        ┌──────────────────────┐   │
│  │  kube-apiserver  │◄──────►│  kubelet             │   │
│  │  etcd            │        │  kube-proxy          │   │
│  │  scheduler       │        │  container runtime   │   │
│  │  controller-mgr  │        │  ┌───┐ ┌───┐ ┌───┐  │   │
│  └──────────────────┘        │  │Pod│ │Pod│ │Pod│  │   │
│                              │  └───┘ └───┘ └───┘  │   │
│                              └──────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 3.1. Управляющий слой — из чего состоит

**`kube-apiserver`** — единственная дверь к кластеру. Принимает HTTP/JSON-запросы, валидирует через **admission controllers** (mutating: можно подменить yaml перед записью; validating: можно отклонить), пишет в etcd, отдаёт ответ. Все остальные компоненты — клиенты apiserver: kubelet «спрашивает», scheduler «спрашивает», controller-manager «спрашивает». Apiserver единственный, кто пишет в etcd.

Почему все ходят через apiserver, а не прямо в etcd: централизованная аутентификация, авторизация (RBAC), audit log, schema validation, hooks для extension.

**`etcd`** — распределённое хранилище «ключ-значение» на основе консенсуса Raft. Хранит **всё**: yaml-манифесты всех ресурсов, статусы подов, секреты. Это **единственный компонент кластера, хранящий состояние**. Падёт etcd — кластер слепнет. Производственные кластера запускают etcd в кворуме (3 или 5 нод) и регулярно бэкапят.

**`kube-scheduler`** — отвечает за «где запустить Pod». Когда apiserver принимает yaml с новым Pod (без `nodeName`), scheduler:
1. **Filtering** (предикаты): какие ноды вообще подходят (есть ресурсы, метки соответствуют, нет несовместимых taints).
2. **Scoring** (приоритеты): из подходящих — какая лучше. Считаются метрики: распределение нагрузки, image locality, anti-affinity.
3. Записывает в Pod `nodeName: <выбранная>` через apiserver.

После этого под забирает kubelet выбранного узла и запускает его.

**`kube-controller-manager`** — пакет десятков контроллеров: DeploymentController, ReplicaSetController, NodeController (отмечает упавшие ноды), EndpointsController, JobController, и так далее. Каждый — независимая reconciliation loop для своего типа ресурсов.

### 3.2. Слой нагрузки — что стоит на каждом узле

**`kubelet`** — агент, общающийся с apiserver. Получает «здесь должны работать Pods A, B, C», обращается к container runtime через **CRI (Container Runtime Interface)**, чтобы их запустить. Регулярно отправляет в apiserver статус ноды и подов. Без kubelet нода нерабочая.

**`kube-proxy`** — реализует абстракцию Service. Слушает изменения Service и Endpoints через apiserver, настраивает на ноде сетевые правила (iptables / IPVS / eBPF) так, чтобы трафик на `ClusterIP` корректно перенаправлялся на живые Pods. См. §7.

**Container runtime** — то, что на самом деле запускает контейнеры. С K8s 1.24 — это **containerd** или **CRI-O** (Docker удалён, см. [DOCKER.md §11.1](DOCKER.md)). Под containerd живёт runc — реализация OCI runtime spec.

### 3.3. Потоки наблюдения — как контроллеры узнают об изменениях

Реализация reconciliation loop требует, чтобы каждый контроллер мгновенно узнавал об изменениях своих ресурсов. Polling apiserver каждую секунду тысячью контроллеров — это убьёт apiserver. Решение — **watch**: long-polling HTTP-соединение, через которое apiserver стримит события (Added / Modified / Deleted) клиенту.

Контроллер делает:
1. `GET /api/v1/pods` — снимок всех текущих подов с `resourceVersion: 12345`.
2. `WATCH /api/v1/pods?resourceVersion=12345` — открыть long-poll, получать события «дельты».
3. На каждое событие — отработать reconciliation.

Это позволяет ~100 ms reaction time на изменения, при минимальной нагрузке на apiserver.

---

## 4. Под — минимальная единица выкатки

Pod = группа из 1+ контейнеров, **запускающихся на одной ноде** и **разделяющих**:
- **Network namespace** (один IP, один набор портов; контейнеры общаются через `localhost`).
- **IPC namespace** (System V IPC, POSIX очереди — между контейнерами Pod'a).
- **Volumes** (любой volume Pod'a может быть смонтирован в любой контейнер).
- Опционально: **PID namespace** (`shareProcessNamespace: true`).

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
  labels:
    app: myapp
spec:
  containers:
    - name: app
      image: myapp:1.0.0
      ports:
        - containerPort: 8080
      resources:                    # ОБЯЗАТЕЛЬНО для production
        requests:
          cpu: "250m"               # 0.25 CPU core
          memory: "256Mi"
        limits:
          cpu: "500m"
          memory: "512Mi"
```

### 4.1. Почему не контейнер минимальная единица

Логичный вопрос: зачем городить «Pod» поверх контейнера, если в 90% случаев Pod = один контейнер? Потому что 10% случаев требуют группировки:

- **Sidecar pattern**: один контейнер — приложение, второй — proxy (Envoy в Istio), log forwarder (Fluent Bit), metrics exporter. Они работают вместе с приложением, делят его сеть и volumes.
- **Adapter pattern**: контейнер-обёртка, нормализующий формат logs/metrics приложения для централизованного сборщика.
- **Ambassador pattern**: контейнер-прокси для outgoing traffic — приложение ходит в `localhost:6379`, ambassador транслирует в реальный Redis-кластер.
- **Init containers**: запускаются последовательно **до** основных контейнеров. Выходят успешно — стартуют основные. Используются для миграции БД, прогрева кэшей, ожидания зависимостей.

### 4.2. Pause-контейнер — как реализовано общее пространство имён

Когда вы создаёте под с двумя контейнерами, kubelet **на самом деле создаёт три**:

1. **pause** — крошечный контейнер (несколько КБ, написан на Go или C). Его задача — захватить и удерживать network/IPC namespace.
2. Ваш контейнер А — присоединяется к namespaces pause.
3. Ваш контейнер Б — тоже присоединяется к namespaces pause.

Pause-контейнер ничего не делает: он буквально `pause()` syscall в бесконечном цикле. Но если все ваши контейнеры умрут одновременно — namespaces удалятся. Pause не даёт этого случиться: он PID 1 в поде, держит namespaces alive, пока сам не убит.

### 4.3. Init-контейнеры — последовательная подготовка

```yaml
spec:
  initContainers:
    - name: wait-for-db
      image: busybox:1.36
      command: ['sh', '-c', 'until nc -z postgres 5432; do sleep 1; done']
    - name: db-migrate
      image: myapp:1.0
      command: ['java', '-jar', 'app.jar', '--migrate']
  containers:
    - name: app
      image: myapp:1.0
```

Поведение:
1. kubelet запускает `wait-for-db`. Ждёт его exit 0.
2. Запускает `db-migrate`. Ждёт exit 0.
3. Только после этого запускает основной `app`.
4. Если init container упал — Pod в состоянии `Init:Error`, restartPolicy решает, что дальше.

Это намного чище, чем держать миграцию в основном образе с конфигом «delay 30 seconds and then start» — миграция гарантированно прошла, а потом стартовало приложение.

### 4.4. Под смертен

Главное, что нужно усвоить: **Pod — не сервер**. Не пытайтесь относиться к нему как к долгоживущей сущности. Pod может быть убит:

- Eviction по нехватке памяти на ноде.
- Drain ноды для обновления ядра.
- Failed liveness probe.
- Удалён вами / другим контроллером.
- Нода упала.

При перезапуске у нового Pod **другой IP, новый writable layer**, нет сохранённого state. Stateless дизайн приложения — это не «хорошо бы», это базовое требование.

---

## 5. Контроллеры рабочих нагрузок

«Pod смертен → нужно что-то, что следит за подами и пересоздаёт упавшие». Это делают workload controllers — отдельные ресурсы Kubernetes, управляющие группами подов.

### 5.1. Deployment и ReplicaSet — самый частый случай

```
Deployment
  └── ReplicaSet (v1)           ← предыдущая версия (для rollback)
  └── ReplicaSet (v2)           ← текущая версия
        ├── Pod (replica 1)
        ├── Pod (replica 2)
        └── Pod (replica 3)
```

- **Deployment**: вы описываете «такая-то версия приложения должна работать в 3 копиях».
- **ReplicaSet**: контроллер, обеспечивающий «N живых подов с такими-то labels».
- **Pod**: конкретный экземпляр.

Логика разделения: Deployment управляет **жизненным циклом версий** (rolling update, rollback). Под капотом для каждой версии создаётся отдельный ReplicaSet, и Deployment масштабирует старый вниз / новый вверх. Старый ReplicaSet остаётся (с `replicas: 0`), чтобы можно было сделать `rollout undo`.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp          # связывает Deployment с Pod через label
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1   # не более 1 Pod недоступно в любой момент
      maxSurge: 1         # не более 1 Pod сверх replicas при обновлении
  template:
    metadata:
      labels:
        app: myapp        # должен совпадать с selector.matchLabels
    spec:
      containers:
        - name: app
          image: myapp:1.0.0
```

#### RollingUpdate в действии

```
Initial:   [v1] [v1] [v1]                  replicas=3, all v1
Step 1:    [v1] [v1] [v1] [v2-pending]     maxSurge=1: +1 новый
Step 2:    [v1] [v1] [v2-ready]            maxUnavailable=1: -1 старый
Step 3:    [v1] [v1] [v2] [v2-pending]
...
Final:     [v2] [v2] [v2]                  все на v2
```

Старый ReplicaSet не удаляется — у него остаются 0 replicas. `kubectl rollout undo` возвращает старый ReplicaSet к 3 replicas.

Альтернативная стратегия — `Recreate`: убить все старые, потом создать новые. Используется только когда приложение **не может** работать в двух версиях одновременно (например, monolith с эксклюзивной блокировкой на БД).

```bash
kubectl rollout status deployment/myapp    # статус деплоя
kubectl rollout history deployment/myapp   # история
kubectl rollout undo deployment/myapp      # откат
```

### 5.2. StatefulSet — для нагрузок с состоянием

Deployment делает поды взаимозаменяемыми: имена случайные (`myapp-7d8f9-abc12`), порядок старта/останова — какой попало. Для приложений, хранящих состояние (БД, Kafka, ZooKeeper, Elasticsearch), это не подходит:

- БД-master должен подняться раньше реплик.
- Каждый под нуждается в **стабильном** identity (имя, DNS), потому что узлы-соседи знают его в лицо.
- Каждый под нуждается в **своём** Persistent Volume, который не должен «прыгать» с пода на под.

StatefulSet это даёт:
- Имена детерминированные: `mysql-0`, `mysql-1`, `mysql-2`.
- Порядок старта: сначала -0, потом -1, потом -2 (если -0 не готов — -1 не стартует).
- Порядок удаления: обратный.
- Стабильный DNS: `mysql-0.mysql-headless.default.svc.cluster.local`.
- VolumeClaimTemplates: каждый под получает свой PVC, который сохраняется между перезапусками.

Headless Service (`clusterIP: None`) обязателен — он обеспечивает per-Pod DNS.

### 5.3. DaemonSet — по одному поду на узел

«На каждой ноде кластера должен работать один такой Pod». Типичные кейсы:
- Log collector (Fluent Bit, Promtail) — должен читать локальные логи каждой ноды.
- Metrics agent (Prometheus node-exporter) — экспортирует метрики хоста.
- CSI driver, CNI plugin.
- Сервисная mesh sidecar injector / proxy.

Когда в кластер добавляется новая нода — DaemonSet controller автоматически создаёт там свой Pod. Когда удаляется — Pod исчезает.

### 5.4. Job и CronJob — разовые и периодические задачи

**Job**: запустить Pod, дождаться успешного завершения. Если упал — перезапустить (по `backoffLimit`). Когда `completions: N` — запустить N успешных раз.

Использование: один-разовая миграция БД, batch обработка файла, генерация отчёта.

**CronJob**: расписание (cron-syntax: `"0 2 * * *"` = каждый день в 02:00), создаёт `Job` по расписанию.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-cleanup
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: cleaner
              image: myapp:1.0
              command: ["java", "-jar", "app.jar", "--cleanup"]
          restartPolicy: OnFailure
```

Важный нюанс CronJob: если кластер был недоступен в 02:00, по умолчанию пропущенные запуски не догоняются (`startingDeadlineSeconds` контролирует поведение). А ещё CronJob может одновременно запустить несколько Job, если предыдущий не успел отработать — это контролируется `concurrencyPolicy: Forbid`.

---

## 6. Лейблы, селекторы и аннотации

Это, вероятно, самая недооценённая часть Kubernetes. Labels — не просто метаданные, это **способ связи между ресурсами**.

```yaml
metadata:
  labels:
    app: myapp
    version: v2
    tier: backend
    environment: production
```

- **Labels** — ключ-значение, индексируются, по ним делается selector. Используются для группировки и связывания.
- **Annotations** — ключ-значение, **не индексируются**, для произвольных метаданных (ссылки на дашборды, commit SHA, инструменты типа Helm/Argo пишут сюда свой state).

### Как labels связывают ресурсы

```
Service: selector: app=myapp,tier=backend
                            │
                            ▼ ищет Pods с такими labels
                  ┌──────────────────┐
                  │ Pod (app=myapp,  │
                  │      tier=backend)│
                  └──────────────────┘
                  ┌──────────────────┐
                  │ Pod (app=myapp,  │
                  │      tier=backend)│
                  └──────────────────┘
```

Если под не имеет нужных labels — Service его не «увидит», трафик к нему не пойдёт. Это частая причина «у меня всё запущено, но Service ничего не отдаёт»: проверьте `kubectl get pods --show-labels`, потом `kubectl describe service` и сравните селектор.

Точно так же ReplicaSet использует labels для «своих» подов. Если вручную поменять `label` на Pod, ReplicaSet решит, что этот Pod — чужой, создаст новый, а ваш «отвязанный» Pod останется жить.

---

## 7. Service — сетевой доступ к поду

Проблема: поды умирают и пересоздаются, IP меняются. Никто не может «обратиться к поду по IP». Нужен стабильный эндпоинт.

```
Client ──► Service (ClusterIP) ──► kube-proxy ──► Pod 1
                                               ──► Pod 2
                                               ──► Pod 3
           selector: app=myapp    (round-robin / iptables)
```

Service — это **виртуальный IP + DNS-имя + LB**, который автоматически отслеживает живые поды соответствующих labels.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-svc
spec:
  selector:
    app: myapp            # отбирает Pod с этим label
  ports:
    - port: 80            # порт Service
      targetPort: 8080    # порт контейнера
  type: ClusterIP         # только внутри кластера
```

### 7.1. Типы Service

| Тип | Доступность | Когда использовать |
|-----|------------|-------------------|
| `ClusterIP` (default) | Только внутри кластера | Внутренние микросервисы |
| `NodePort` | Снаружи через `<node-ip>:<30000-32767>` | Dev/тестирование, on-prem без LB |
| `LoadBalancer` | Снаружи через облачный LB | Production в cloud (AWS ELB, GCP LB) |
| `ExternalName` | Алиас на внешний DNS | Доступ к внешним системам с «именем внутри кластера» |
| **Headless** (`clusterIP: None`) | Нет VIP, DNS возвращает все Pod IPs напрямую | StatefulSet БД, peer-to-peer (Kafka, Cassandra) |

DNS имя сервиса внутри кластера: `myapp-svc.default.svc.cluster.local`. В пределах того же namespace — просто `myapp-svc`.

### 7.2. Endpoints и EndpointSlices

«За» через Service живёт ресурс `Endpoints` (или `EndpointSlices` в современных кластерах) — список IP:port активных подов с подходящими labels. Этот список обновляется в реальном времени контроллером.

`EndpointSlices` — замена `Endpoints` для масштаба. У `Endpoints` есть проблема: один объект на Service, в нём список всех endpoints. Если у Service 5000 подов и каждый kube-proxy «следит» этот Endpoints — каждое изменение посылает 5000 watch events. С `EndpointSlices` Endpoints разбиты на куски по ~100, и обновляется только нужный slice.

### 7.3. Режимы kube-proxy — как устроена балансировка

`kube-proxy` на каждой ноде должен взять «IP Service 10.96.0.10:80» и «список Pod IPs» и сделать так, чтобы пакеты на 10.96.0.10:80 уходили в один из Pod IPs. Это можно сделать тремя способами:

- **iptables** (default многие годы): kube-proxy пишет правила `iptables` для каждого Service. Для 5000 объектов Service это десятки тысяч правил, каждый пакет проходит их последовательно (O(n)) — медленно. До сих пор default, но не для больших кластеров.
- **IPVS** (Linux kernel-level load balancer): O(1) lookup через hash. Используется в больших кластерах (1000+ нод). Поддерживает разные алгоритмы (round-robin, least conn, source-hash).
- **eBPF** (Cilium kube-proxy replacement): полная замена `kube-proxy` через eBPF-программы прямо в ядре. Самый быстрый, но требует современного ядра и Cilium как CNI.

Переключаться можно: `--proxy-mode=ipvs` при старте kube-proxy.

### 7.4. CoreDNS — разрешение имён внутри кластера

DNS-резолвер в кластере — `CoreDNS` (DaemonSet, обычно в `kube-system`). Когда под делает `lookup myapp-svc`, запрос идёт в `/etc/resolv.conf` пода → CoreDNS → returned ClusterIP.

CoreDNS сам watches Services через apiserver и держит в памяти зону `.svc.cluster.local`. Любое изменение Service отражается в DNS за секунды.

---

## 8. Ingress против Gateway API

`Service type: LoadBalancer` — это **L4 балансировка** (TCP/UDP). У каждого облачного LB своя цена (~$20–30/мес у AWS). 50 микросервисов с LoadBalancer = $1500/мес.

**Ingress** — единый L7 (HTTP) роутер для всех HTTP-сервисов:

```
                        Ingress
                        ┌──────────────────────────────┐
api.example.com  ────►  │ /v1/users   → users-svc      │
                        │ /v1/orders  → orders-svc     │
                        │ /admin/*    → admin-svc      │
                        └──────────────────────────────┘
```

Один LB снаружи → Ingress controller внутри (nginx, Traefik, HAProxy, AWS ALB Ingress Controller, etc.) → routing по host/path → Service.

`Ingress` ресурс — это **только конфигурация**. Кто-то должен это конфигурацию читать и реализовывать. Это и есть **Ingress controller** — отдельный Deployment в кластере (часто `nginx-ingress`). Без установленного controller Ingress-объекты ничего не делают.

### Gateway API — следующее поколение

Ingress был спроектирован в 2015, в API застряло много примитивов и quirks. С 2020 разрабатывается **Gateway API** — следующее поколение L7-роутинга:

- Чёткое разделение ролей: GatewayClass (admin), Gateway (operator), HTTPRoute / TCPRoute / TLSRoute (developer).
- Богаче маршрутизация: header/query matching, traffic splitting, request mirroring.
- Кросс-namespace routing с разрешениями.
- Расширяемость через policy attachments.

Gateway API GA в 2024. Постепенно вытесняет Ingress. Новые проекты — лучше сразу на Gateway API; legacy Ingress пока работает и не объявлен устаревшим.

---

## 9. ConfigMap и Secret

```yaml
# ConfigMap — нечувствительная конфигурация
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_ENV: production
  LOG_LEVEL: INFO
  DB_HOST: postgres-svc

---
# Secret — чувствительные данные (base64, не шифрование!)
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
type: Opaque
data:
  DB_PASSWORD: c2VjcmV0MTIz   # echo -n "secret123" | base64
```

Использование в Pod (два способа):

```yaml
spec:
  containers:
    - name: app
      envFrom:
        - configMapRef:
            name: app-config    # все ключи как env variables
      env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: DB_PASSWORD
      volumeMounts:
        - name: config-vol
          mountPath: /config    # монтировать как файлы
  volumes:
    - name: config-vol
      configMap:
        name: app-config
```

### 9.1. Главный миф: «Secret — это зашифровано»

**Нет.** `data:` в Secret — это **base64**, а не encryption. `echo c2VjcmV0MTIz | base64 -d` → `secret123`. Любой, кто получил доступ к `kubectl get secret -o yaml`, видит секрет в открытом виде.

Базовая защита Secret в Kubernetes:
- **RBAC** — отдельные права на чтение Secret (можно дать `get`/`list` на ConfigMap, но не на Secret).
- **etcd encryption at rest** — настраиваемая опция, шифрует Secret перед записью в etcd. **Не включена по умолчанию** в большинстве дистрибутивов. Без неё Secret лежит в etcd в plain text (точнее, в base64).
- **Audit log** — kube-apiserver можно настроить логировать все обращения к Secret.

### 9.2. За пределами Secret: реальный secrets management

Для серьёзного хранения секретов используются специализированные системы, описанные подробно в [`SECRETS.md`](SECRETS.md). Короткий список:

- **HashiCorp Vault** — централизованное хранение, dynamic secrets, аудит, leasing. Интеграция с K8s через Vault Agent Injector.
- **Sealed Secrets** (Bitnami) — Secret, зашифрованный публичным ключом, безопасно лежит в Git. Расшифровывается в кластере при apply.
- **External Secrets Operator** — синхронизирует Secret из AWS Secrets Manager / GCP Secret Manager / Vault в обычные K8s Secret.
- **SOPS** (Mozilla) — шифрование yaml/json по полям, используется с Helm/Kustomize.

В CI/CD не пишите Secret в plain text в Git ever. Это эквивалентно публикации пароля в README.

---

## 10. Пробы состояния

Это, наверное, самая важная и одновременно самая запутанная часть K8s для разработчика. Пробы определяют, что такое «живой» Pod.

```
         startupProbe          readinessProbe    livenessProbe
              │                      │                │
   Старт ─────┼─── OK ──────────────┼─── трафик ────┼─── работа
              │                      │                │
           Приложение            Pod добавлен    Если падает —
         инициализируется       в Service LB    перезапуск
```

### 10.1. Три типа probe и их семантика

- **`livenessProbe`** — «жив ли процесс»? Если падает (failureThreshold подряд) — kubelet **перезапускает контейнер** (не под целиком). Цель: автоматическое восстановление зависших процессов.
- **`readinessProbe`** — «готов ли принять трафик»? Если падает — kubelet **выводит под из Service** (удаляет из Endpoints), но **не перезапускает**. Цель: временно вывести под из ротации (перегружен, потерял БД).
- **`startupProbe`** — «закончилось ли инициализация»? Действует только до первого success, потом отключается. Если падает — kubelet перезапускает контейнер. Цель: дать медленно стартующим приложениям время.

```yaml
containers:
  - name: app
    # Защита медленного старта: 10s * 30 = 300 секунд максимум
    startupProbe:
      httpGet:
        path: /actuator/health/readiness
        port: 8080
      failureThreshold: 30
      periodSeconds: 10

    # Трафик только на готовый Pod
    readinessProbe:
      httpGet:
        path: /actuator/health/readiness  # ДРУГОЙ путь чем liveness!
        port: 8080
      initialDelaySeconds: 0
      periodSeconds: 10
      failureThreshold: 3

    # Перезапуск при зависании
    livenessProbe:
      httpGet:
        path: /actuator/health/liveness
        port: 8080
      initialDelaySeconds: 0
      periodSeconds: 30
      failureThreshold: 3
```

Spring Boot Actuator автоматически предоставляет:
- `/actuator/health/liveness` — жив ли процесс
- `/actuator/health/readiness` — готов ли принимать трафик

### 10.2. Разбор: Henning Jacobs против liveness-проб

Henning Jacobs (тогда Principal Engineer в Zalando) написал в 2019 знаменитый пост **«Liveness probes are dangerous»**. Суть проблемы:

Многие команды настраивают `liveness` и `readiness` на **один и тот же эндпоинт**, например `/health`. Этот эндпоинт проверяет «БД жива, очередь жива, всё работает». Логично же, что если БД отвалилась — приложение не готово.

Что происходит при реальном инциденте:
1. БД под нагрузкой, отвечает медленно (500 ms вместо 5 ms).
2. `/health` начинает таймаутить.
3. **Все** поды одновременно считаются `unhealthy`.
4. `readinessProbe` выводит их из Service — но трафик-то всё равно куда-то идёт, нагрузка размазывается по выжившим.
5. **`livenessProbe` тоже падает** — kubelet **перезапускает все поды**.
6. Перезапущенные поды стартуют, **открывают новые соединения к БД** (которая и так под нагрузкой), стартуют медленно, не успевают пройти `readiness` в дефолтные таймауты.
7. **Каскадный отказ**: вся сервисная сетка падает, восстанавливается долго.

Уроки:
1. **Никогда не давайте `liveness` и `readiness` один и тот же эндпоинт**.
2. **`livenessProbe` должен проверять только сам процесс** — не зависимости. Условие: «приложение зациклилось / deadlock / OOM-почти». Не «БД лежит».
3. **`readinessProbe` может проверять зависимости** (это нормально его задача).
4. **Лучше отсутствие liveness probe, чем плохо настроенная**. Без неё в худшем случае один под останется в зависшем состоянии. С плохой — все поды перезапускаются под нагрузкой.

### 10.3. startupProbe — зачем он нужен

Для тяжёлых приложений (Spring Boot с прогревом кэшей, JVM с lazy loading, ML модели) старт может занимать 30–120 секунд. Без `startupProbe` приходится либо:
- Ставить `initialDelaySeconds: 120` на livenessProbe — но тогда **каждый** рестарт ждёт 2 минуты слепого времени.
- Делать ленивый healthcheck endpoint, что усложняет код.

startupProbe позволяет отдельные параметры для фазы старта: `failureThreshold * periodSeconds` = максимальное время старта. Когда `startup` прошёл — он отключается, и `livenessProbe` начинает работать в нормальном (быстром) режиме.

---

## 11. Ресурсы, лимиты и классы QoS

```yaml
resources:
  requests:
    cpu: "250m"           # минимум; планировщик ищет узел, где это есть
    memory: "256Mi"
  limits:
    cpu: "500m"           # потолок: троттлинг при превышении
    memory: "512Mi"       # потолок: OOMKilled при превышении
```

### 11.1. Семантика requests и limits

- **requests по процессору**: сколько узел обязуется выделить поду. Планировщик использует это для размещения, HPA — для расчёта процента загрузки.
- **limits по процессору**: жёсткий потолок. При превышении ядро **троттлит** процесс — замедляет, но не убивает: процессорное время делится эластично.
- **requests по памяти**: то же самое при планировании.
- **limits по памяти**: жёсткий потолок. При превышении ядро **убивает** процесс — память нельзя «замедлить», её можно только отнять.

### 11.2. Классы QoS — что выживает при нехватке памяти

Класс QoS **не задаётся** в манифесте: kubelet выводит его из соотношения `requests` и limits.
Три пода в одном кластере (minikube v1.37.0, kubectl v1.34.1):

```
$ kubectl get pod -o custom-columns='POD:.metadata.name,QOS:.status.qosClass,\
REQ_CPU:.spec.containers[0].resources.requests.cpu,LIM_CPU:.spec.containers[0].resources.limits.cpu'
POD              QOS          REQ_CPU   LIM_CPU
qos-besteffort   BestEffort   <none>    <none>
qos-burstable    Burstable    100m      200m
qos-guaranteed   Guaranteed   100m      100m
```

Правило видно из вывода: `requests == limits` → Guaranteed, `requests < limits` → Burstable,
не задано ничего → BestEffort. Схема целиком:

```
Guaranteed (requests == limits)     ← выселяется последним
  CPU: 500m / 500m
  MEM: 256Mi / 256Mi

Burstable (requests < limits)       ← средний приоритет
  CPU: 250m / 500m
  MEM: 128Mi / 256Mi

BestEffort (нет requests/limits)    ← выселяется первым
```

Лимит по памяти — это не пожелание планировщику, а cgroup-лимит на узле. Под с
`limits.memory: 64Mi` изнутри видит ровно его:

```
$ kubectl exec qos-guaranteed -- cat /sys/fs/cgroup/memory.max
67108864                      # = 64 × 1024 × 1024
```

Что происходит при превышении — тоже проверяется. Под, просящий 200 МБ при лимите 100 Ми:

```
$ kubectl get pod oom-demo -o custom-columns='PHASE:.status.phase,\
REASON:.status.containerStatuses[0].state.terminated.reason'
PHASE    REASON
Failed   OOMKilled
```

Контейнер **убит**, а не замедлен: память нельзя отнять частично. Именно поэтому лимит по памяти
и лимит по процессору — механизмы разной природы, о чём §11.3.

Когда на узле не хватает памяти, kubelet начинает **выселять** поды, освобождая её:
1. Сначала BestEffort — он ничего не просил, ему ничего и не обещали.
2. Потом Burstable, у которых фактическое потребление выше запрошенного.
3. Только в крайнем случае Guaranteed.

Отсюда правило: **в продакшене у каждого пода есть `requests` и limits**. BestEffort — это табличка «убей меня первым».

### 11.3. Лимиты на процессор — спорный вопрос

Здесь сообщество разделилось. Разборы от Datadog, Buffer и Grafana Labs сходятся на том, что
**лимиты по процессору часто вредят** в продакшене. Почему:

1. CPU кратно «эластичнее» памяти. Если у соседнего пода request 100m, но он сейчас простаивает — почему мой не может занять эти 100m?
2. С лимитом ядро троттлит процесс, даже когда процессор на узле свободен. Всплесковые нагрузки (уплотнение в сборщике мусора, прогрев) получают скачки задержки.
3. Лимит по процессору отмеряется **периодами** (по умолчанию 100 мс). Исчерпали квоту за период — ждёте следующего. На многоядерной машине это особенно болезненно: один поток съедает всю квоту за миллисекунды и блокирует остальные до конца периода.

Альтернативная стратегия: **requests ставить по фактической нагрузке, limits на процессор не ставить**. Лимит по памяти ставить обязательно — память троттлить нельзя, только отнимать (что и показано выше как `OOMKilled`).

Это не универсальное правило: многое зависит от характера нагрузки и от того, насколько шумные соседи по узлу. Но проверить, нужны ли вам лимиты на процессор, стоит обязательно.

---

## 12. HPA / VPA / Cluster Autoscaler

Три автоматики, работающих на разных уровнях:

| | Что делает | Реагирует на |
|--|-----------|-------------|
| **HPA** (Horizontal Pod Autoscaler) | Меняет `replicas` у Deployment | Метрики подов (CPU, memory, custom) |
| **VPA** (Vertical Pod Autoscaler) | Меняет `requests` / `limits` у Pod'a | Историческое потребление ресурсов |
| **Cluster Autoscaler** | Добавляет / удаляет ноды | Pending поды, недозагруженные ноды |

### 12.1. HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70    # 70% от requests.cpu
```

HPA каждые 15 секунд:
1. Запрашивает метрики из metrics-server.
2. Считает: `desiredReplicas = ceil(currentReplicas * (currentMetric / targetMetric))`.
3. Применяет через apiserver.

**Обязательно**: `resources.requests.cpu` в Pod spec. Иначе HPA не знает, относительно чего считать проценты.

HPA умеет custom metrics — например, scale по числу сообщений в Kafka, по длине очереди, по latency. Для этого нужен custom-metrics-adapter (Prometheus Adapter, KEDA для event-driven scaling).

### 12.2. Cluster Autoscaler

Если все ноды заняты и HPA пытается добавить Pod, который не помещается — Pod в состоянии `Pending`. Cluster Autoscaler видит это и идёт в облако: «добавь новую ноду по такому-то Auto Scaling Group / instance template». Через несколько минут нода готова, scheduler размещает на ней Pod.

Обратно: если на ноде ничего нет (или есть, но влезает в другие ноды), Cluster Autoscaler выводит ноду из ASG.

HPA и Cluster Autoscaler работают вместе: HPA сказал «нужно ещё 5 подов», но они не вмещаются → CA добавил ноду → поды запустились.

---

## 13. Namespaces, RBAC, NetworkPolicy

### 13.1. Пространства имён — логическое разделение

Namespace — это **виртуальный кластер внутри кластера**. Все ресурсы (Pod, Service, ConfigMap, Deployment, ...) живут в пространствах имён. Это даёт:
- Изоляцию имён: `api` в `production` и `api` в `staging` — разные ресурсы.
- Scope для RBAC: команда видит только свой namespace.
- ResourceQuota: ограничение CPU/memory на namespace.
- LimitRange: дефолтные requests/limits для подов в namespace.

Типичное деление: `production`, `staging`, `monitoring`, `infra`, `team-payments`, `team-checkout`.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: production
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "20"
```

### 13.2. RBAC — кому что разрешено

Четыре концепта:

- **Role** — список разрешений в **одном namespace** (`get pods in production`).
- **ClusterRole** — то же, но кластерные ресурсы (Nodes, PersistentVolumes) или применяется в любом namespace.
- **RoleBinding** — даёт `Role` конкретному пользователю/группе/ServiceAccount.
- **ClusterRoleBinding** — то же для ClusterRole.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: production
  name: pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  namespace: production
  name: read-pods
subjects:
  - kind: User
    name: alice@example.com
  - kind: ServiceAccount
    name: prometheus
    namespace: monitoring
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

Принцип least privilege: давать минимально необходимые права. Не давать `cluster-admin` всем.

### 13.3. NetworkPolicy — кому с кем можно общаться

По умолчанию **все поды могут общаться со всеми** (в пределах кластера). Это удобно при старте, но это катастрофа для security: компрометация одного пода — компрометация ВСЕХ.

NetworkPolicy — ingress/egress правила, аналог фаервола на уровне подов:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-allow-from-frontend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

Этот политика говорит: «к подам с label `app=api` могут подключаться только поды с label `app=frontend` на порт 8080. Всё остальное — отбрасывать».

NetworkPolicy реализуется CNI плагином (Calico, Cilium, Weave). Если ваш CNI не поддерживает NetworkPolicy (например, базовый `kubenet`) — yaml применится, но ничего не сделает.

Production-обязательная вещь, особенно в мультиарендных кластерах.

---

## 14. Хранилище: PV, PVC, StorageClass

Контейнеры stateless, но базы данных, файлы загрузок и т. п. требуют **persistent storage**, переживающий перезапуски пода. В Kubernetes это разделено на три уровня:

```
┌─────────────────┐    binds to    ┌──────────────────┐    backed by    ┌──────────────────┐
│ PersistentVolume│ ◄─────────────►│PersistentVolume- │ ◄──────────────►│  StorageClass    │
│ (PV)            │                │     Claim (PVC)  │                 │  (AWS EBS, NFS,  │
│ — реальный диск │                │— запрос на диск  │                 │   GCP PD, ...)  │
└─────────────────┘                └──────────────────┘                 └──────────────────┘
        ▲                                  ▲
        │ provisioned by                   │ used by
        ▼                                  ▼
   CSI driver                       Pod (volumeMounts)
```

- **PV** — представление конкретного диска в кластере. Может быть выделен вручную (admin создал) или динамически (StorageClass).
- **PVC** — запрос Pod'a: «дайте мне 10 GB, ReadWriteOnce». Связывается с подходящим PV.
- **StorageClass** — драйвер: «как создавать PV». Обычно один или несколько (быстрый SSD vs дешёвый HDD).

### 14.1. CSI — Container Storage Interface

CSI (с 2018) — стандартный интерфейс между Kubernetes и storage providers. Каждый облачный провайдер пишет CSI driver — Kubernetes API общается с ним стандартным способом. Это позволяет:
- Не зашивать знание о AWS EBS в код kubelet.
- Сторонним провайдерам (Portworx, Longhorn, Rook/Ceph) интегрироваться без патчей k8s.

### 14.2. Режимы доступа

- `ReadWriteOnce` (RWO) — один под может одновременно писать. Это **дефолт** для EBS / GCP PD / Azure Disk.
- `ReadOnlyMany` (ROX) — много подов могут читать одновременно. Used для статических файлов.
- `ReadWriteMany` (RWX) — много подов могут одновременно писать. Требует shared filesystem (NFS, Ceph, EFS). **Гораздо реже** доступен из коробки в облаках.

Большинство БД работает в RWO — один Pod, один диск. Кластеризованные БД (Cassandra, MongoDB ReplicaSet) — каждый узел свой диск.

### 14.3. Почему stateful в K8s сложнее

- Жизненный цикл диска не совпадает с жизнью пода — `reclaimPolicy` контролирует, удалять ли PV при удалении PVC (`Retain` vs `Delete`).
- Бэкапы не делаются автоматически — нужен Velero или ad-hoc snapshots на уровне provider.
- Migration между нодами требует, чтобы диск тоже мог быть «переподключён» — в EBS это занимает минуту, для NFS мгновенно.
- Statefulset гарантирует Pod-to-PVC stickiness, но если нода физически умерла — восстанавливаться приходится вручную или через оператора.

Для серьёзных БД часто проще использовать managed-сервис cloud-провайдера (RDS, Cloud SQL) и не разворачивать БД в K8s. Это [`infrastructure/CLOUD.md`](CLOUD.md) тема.

---

## 15. Планирование: на какой узел попадёт под

Scheduler не «просто кладёт куда есть место». Он учитывает:

- **`nodeSelector`** — самая простая фильтрация: «только на ноды с label `disktype=ssd`».
- **`nodeAffinity`** — расширенный `selector` с операторами (`In`, `NotIn`), мягкими / жёсткими правилами.
- **Taints и Tolerations** — обратная сторона: нода говорит «я не для всех», Pod должен «извиниться» (tolerate). Используется для специальных нод: GPU, spot instances, control plane.
- **PodAffinity / PodAntiAffinity** — «помести меня рядом с другими `app=cache` подами» / «не помещай на одну ноду с другим подом моего Deployment».
- **TopologySpreadConstraints** — распределение по зонам/нодам: «спред поды поровну между AZ».

### 15.1. PodAntiAffinity — разнос по узлам

Если у вашего Deployment `replicas: 3`, и планировщик по умолчанию положил все три на одну ноду — `kubectl drain` этой ноды убьёт весь сервис. PodAntiAffinity предотвращает это:

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: myapp
        topologyKey: kubernetes.io/hostname
```

«Не размещай мой под на той же ноде, где уже есть другой под с `app=myapp`».

### 15.2. TopologySpreadConstraints — разнос по зонам доступности

В cloud-кластере с тремя AZ:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: myapp
```

«Раскидай поды по AZ так, чтобы между любыми двумя AZ разница в количестве была не больше 1». 6 replicas → 2+2+2 по AZ, не 6+0+0.

---

## 16. Антипаттерны

| Антипаттерн | Проблема | Как правильно |
|-------------|----------|---------------|
| `image: myapp:latest` | Недетерминированный rollout, разные ноды разные образы | Pin к version или digest |
| Нет `resources.requests` | HPA не работает; scheduler не знает; ⇒ BestEffort QoS = первый на eviction | Всегда ставить requests |
| Один endpoint для liveness и readiness | Каскадный отказ под нагрузкой (Henning Jacobs story) | Разные endpoints; liveness — только базовая жизнь процесса |
| Stateful данные в writable layer пода | Теряются при перезапуске | PVC / external БД |
| Нет PodAntiAffinity для replicas | Один drain ноды = весь сервис лёг | Anti-affinity по hostname или zone |
| Pull-from-Docker-Hub в production | Rate limit Docker Hub, hit на старте всех нод | Локальный mirror / private registry |
| Secrets в plain text в Git | Утечка | Vault / Sealed Secrets / SOPS ([SECRETS.md](SECRETS.md)) |
| Хардкод environment в image | Каждое окружение требует отдельный image | ConfigMap / Secret для конфигурации |
| Нет ResourceQuota в namespace | Один сервис «съел» весь кластер | Quota на CPU/memory/Pod count |
| Один namespace на всё | RBAC невозможен; конфликты имён | Разделение по окружениям/командам |
| `kubectl edit` в production | Изменение state не отражено в git/IaC | GitOps (Argo CD, Flux) + только PR-merges |
| Нет NetworkPolicy | Compromised Pod может ходить куда угодно | Default-deny + явные allow rules |
| CPU limits для всех | Throttling на burst-нагрузках | Только memory limits; CPU только requests |

---

## 17. Когда это неправильный ответ

**Kubernetes вместо надёжного приложения.** Кластер перезапускает контейнер — и только. Если
экземпляр Orders API теряет незаписанные заказы при остановке, Kubernetes сделает потерю
**регулярной**: он будет перезапускать под при каждой правке манифеста, при выселении, при
обновлении узла. Сначала приложение должно переживать `SIGTERM` в любой момент, потом кластер.

**Liveness там, где нужен readiness.** Самая дорогая ошибка модуля. Liveness-проба, проверяющая
базу, превращает недоступность базы в перезапуск всех подов сразу — вместо того чтобы просто убрать
их из балансировки. Henning Jacobs формулирует это как «liveness проверяет, жив ли процесс, а не
здорова ли система»: если проба может ответить «нет» из-за чужого отказа, это не liveness (§10).

**Перезапуск как средство от каскадного отказа.** Под перезапустился, прогрелся, принял ту же
нагрузку, что его убила, и умер снова. Kubernetes честно повторит это по кругу с
экспоненциальной паузой. Механизм, который здесь нужен, — изоляция отказа и деградация, и он
живёт в [`microservices/FAILURE_ISOLATION.md`](../../microservices/theory/FAILURE_ISOLATION.md),
а не в манифесте.

**StatefulSet как способ запустить базу в кластере.** StatefulSet даёт стабильное имя и стабильный
том — это всё. Он не даёт ни резервных копий, ни переключения на реплику, ни восстановления на
точку во времени. Для Orders API правильный ответ — управляемый PostgreSQL
([`CLOUD.md`](CLOUD.md) §4), а StatefulSet — для случая, когда команда уже умеет
эксплуатировать базу и сознательно берёт это на себя.

**HPA по загрузке процессора для нагрузки, упирающейся не в процессор.** Orders API ждёт ответа
базы — процессор при этом простаивает, HPA не масштабирует, задержка растёт. Признак: p99 вырос,
загрузка процессора не изменилась. Масштабировать нужно по метрике, отражающей очередь
(число запросов в обработке, длина очереди), а не по процессору (§12).

**Kubernetes для одного приложения на одной машине.** Управляющий слой, сетевой слой и слой
абстракций стоят дороже, чем дают, пока экземпляр один и заменить его некем. `docker compose`
или systemd-юнит честнее.

---

## 18. Шпаргалка

**Что у вас на входе → что брать**

| Ситуация | Решение | Почему |
|---|---|---|
| Взаимозаменяемые экземпляры без состояния | `Deployment` | ReplicaSet пересоздаёт под с новым именем и новым IP |
| Нужны стабильное имя и свой том у каждого экземпляра | `StatefulSet` | Имя `app-0`, `app-1` переживает пересоздание |
| Демон на каждом узле (сбор логов, метрики узла) | `DaemonSet` | Один под на узел, включая новые узлы |
| Разовая или регулярная задача | `Job` / `CronJob` | Считается успешной по коду выхода, а не по «работает» |
| «Готов ли принимать трафик» | `readinessProbe` | Провал убирает из Endpoints, под не перезапускается |
| «Жив ли процесс» | `livenessProbe` **без зависимостей** | Провал перезапускает контейнер — цена ошибки высока |
| Медленный старт (JVM, прогрев кэша) | `startupProbe` | Отключает две другие пробы, пока не пройдёт |
| Приложение должно выжить при нехватке памяти на узле | `requests == limits` → Guaranteed | Выселяется последним |
| Нагрузка упирается в процессор | HPA по `cpu` | Метрика отражает то, что действительно кончается |
| Нагрузка упирается в ожидание ввода-вывода | HPA по своей метрике | Процессор простаивает, по нему масштабирования не будет |
| Конфигурация без секретов | `ConfigMap` | Меняется без пересборки образа |
| Пароль, ключ, сертификат | Внешнее хранилище, не голый `Secret` | `Secret` — это base64, а не шифрование (§9) |

**Как ставится диагноз**

| Симптом | Куда смотреть |
|---|---|
| `CrashLoopBackOff` | `kubectl logs --previous` — логи прошлого запуска, не текущего |
| `Pending` | `kubectl describe pod` → события планировщика: не хватило ресурсов или не нашлось узла |
| `OOMKilled` | `limits.memory` мал либо утечка; `.status.containerStatuses[0].state.terminated.reason` |
| `ImagePullBackOff` | Тег, реестр, `imagePullSecrets` |
| Под `Running`, но трафика нет | Селектор `Service` не совпал с лейблами пода; `kubectl get endpoints` |
| Перезапуски под нагрузкой | Liveness-проба зависит от внешней системы или таймаут меньше времени ответа |

---

## Вопросы для самопроверки

1. Что означает «декларативность» на уровне механизма? Почему `kubectl apply` сто раз даёт тот же
   результат, что один раз?
2. Под — это контейнер? Если нет, что именно объединяет контейнеры внутри пода и через какой
   механизм?
3. Liveness и `readiness` обе провалились. Что произойдёт с подом в каждом случае и почему разница
   принципиальна?
4. Почему liveness-проба, ходящая в базу, опаснее отсутствия liveness-пробы вообще?
5. Deployment обновляется, старые поды ещё живы, новые не готовы. Кто в этот момент получает
   трафик и какой механизм это решает?
6. Класс QoS не написан в манифесте. Откуда он берётся и как получить Guaranteed?
7. Под превысил лимит по памяти и лимит по процессору. Почему исходы разные?
8. `Service` типа ClusterIP: что происходит с пакетом от момента резолва DNS-имени до попадания
   в под?
9. Почему `Secret` без дополнительной настройки не является секретом и что именно нужно включить?
10. HPA настроен на 70% процессора, задержка растёт, реплик по-прежнему три. Назовите две
    возможные причины.
11. Под в `Pending` уже десять минут. Как за одну команду узнать, чего ему не хватает?
12. Почему pod IP нельзя использовать как адрес для конфигурации другого сервиса?

---

## Упражнения

- [Ex08: под и Deployment](../exercises/kubernetes/Ex08_PodAndDeployment) — RollingUpdate, §4–5.
- [Ex09: ConfigMap и Secret](../exercises/kubernetes/Ex09_ConfigMapsSecrets) — §9.
- [Ex10: пробы](../exercises/kubernetes/Ex10_Probes) — liveness, readiness, startup, §10.
- [Ex11: HPA](../exercises/kubernetes/Ex11_HPA) — §12.
- [Ex12: пространства имён и ResourceQuota](../exercises/kubernetes/Ex12_Namespaces) — §13.
- [Ex13: requests и limits](../exercises/kubernetes/Ex13_ResourceLimits) — §11, классы QoS.
- [Ex14: Service](../exercises/kubernetes/Ex14_Services) — ClusterIP, NodePort, §7.

---

## Источники

**Официальная документация:**
- [Kubernetes Documentation](https://kubernetes.io/docs/) — concepts, tasks, reference. Особенно важны разделы Workloads, Services-Networking, Configuration.
- [Kubernetes API Reference](https://kubernetes.io/docs/reference/kubernetes-api/) — каноническое описание спек ресурсов.
- [Kubernetes Enhancement Proposals (KEPs)](https://github.com/kubernetes/enhancements) — что меняется в API и почему.
- [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)

**Books:**
- *Kubernetes Up & Running*, 3rd ed. (Brendan Burns, Joe Beda, Kelsey Hightower, Lachlan Evenson, O'Reilly 2022).
- *Kubernetes Patterns*, 2nd ed. (Bilgin Ibryam, Roland Huss, O'Reilly 2023) — каталог паттернов: Health Probe, Sidecar, Init Container, Stateful Service.
- *The Kubernetes Book* (Nigel Poulton, 2024) — обновляется ежегодно под новые версии.
- *Programming Kubernetes* (Michael Hausenblas, Stefan Schimanski, O'Reilly 2019) — для тех, кто пишет операторов.

**Battle stories / postmortems:**
- [Henning Jacobs (Zalando) — «Liveness Probes are Dangerous»](https://srcco.de/posts/kubernetes-liveness-probes-are-dangerous.html) — почему неосторожный liveness probe вызывает каскадные перезапуски под нагрузкой. Must-read.
- [Cloudflare 2019 — «Bad regex took us offline»](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) — почему staged rollouts (canary) и откат нужны до того, как они понадобятся.

**Tooling:**
- [`kubectl` cheat sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
- [k9s — terminal UI for k8s](https://k9scli.io/) — на порядок удобнее голого `kubectl`.
- [Lens / OpenLens](https://k8slens.dev/) — desktop GUI.
