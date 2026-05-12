# Kubernetes

---

## 1. Архитектура (уровень понимания разработчика)

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

Как разработчик взаимодействует с кластером: `kubectl apply -f manifest.yaml` → kube-apiserver → etcd (сохраняет желаемое состояние) → scheduler (выбирает ноду) → kubelet (запускает контейнер).

---

## 2. Pod — минимальная единица деплоя

Pod = группа контейнеров с общей сетью и storage. Контейнеры внутри Pod общаются через `localhost`.

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

**Ключевое:** Pod смертен. Упал — не восстановится сам. Для управления Pod используют Deployment.

---

## 3. Deployment и ReplicaSet

```
Deployment
  └── ReplicaSet (v1)           ← предыдущая версия (для rollback)
  └── ReplicaSet (v2)           ← текущая версия
        ├── Pod (replica 1)
        ├── Pod (replica 2)
        └── Pod (replica 3)
```

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

Команды:
```bash
kubectl rollout status deployment/myapp    # статус деплоя
kubectl rollout history deployment/myapp   # история
kubectl rollout undo deployment/myapp      # откат
```

---

## 4. Service — сетевой доступ к Pod

```
Client ──► Service (ClusterIP) ──► kube-proxy ──► Pod 1
                                               ──► Pod 2
                                               ──► Pod 3
           selector: app=myapp    (round-robin / iptables)
```

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

| Тип | Доступность | Когда использовать |
|-----|------------|-------------------|
| ClusterIP | Только внутри кластера | Внутренние микросервисы |
| NodePort | Снаружи через `<node-ip>:<port>` | Dev/тестирование |
| LoadBalancer | Снаружи через облачный LB | Production |
| Headless | DNS без VIP (для StatefulSet) | БД, Kafka |

DNS имя сервиса внутри кластера: `myapp-svc.default.svc.cluster.local`
Краткая форма (внутри того же namespace): `myapp-svc`

---

## 5. ConfigMap и Secret

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

---

## 6. Health Probes

```
         startupProbe          readinessProbe    livenessProbe
              │                      │                │
   Старт ─────┼─── OK ──────────────┼─── трафик ────┼─── работа
              │                      │                │
           Приложение            Pod добавлен    Если падает —
         инициализируется       в Service LB    перезапуск
```

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

**Критично:** не давать liveness и readiness один endpoint. При временной нагрузке readiness может падать — это нормально, трафик уйдёт на другие Pod. Если liveness падает — контейнер перезапускается — плохо.

---

## 7. HPA — Horizontal Pod Autoscaler

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

HPA каждые 15 секунд: `currentCPU / targetCPU * currentReplicas = desiredReplicas`

**Обязательно:** `resources.requests.cpu` в Pod spec — без него HPA не знает относительно чего считать проценты.

---

## 8. Namespaces и ResourceQuota

```bash
# Основные namespace по назначению
kubectl create namespace production
kubectl create namespace monitoring
kubectl create namespace infra
```

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

---

## 9. Resource Requests vs Limits — QoS классы

```
Guaranteed (requests == limits)     ← выселяется последним
  CPU: 500m / 500m
  MEM: 256Mi / 256Mi

Burstable (requests < limits)       ← средний приоритет
  CPU: 250m / 500m
  MEM: 128Mi / 256Mi

BestEffort (нет requests/limits)    ← выселяется первым
```

При нехватке памяти на ноде Kubernetes убивает BestEffort Pod первыми, Guaranteed — последними.

---

## Вопросы для собеседования

### Q1: Что произойдёт с Pod, если он упадёт?
**A:** Зависит от того, кем управляется. Standalone Pod — не восстановится, исчезнет. Pod под Deployment → Deployment контроллер заметит несоответствие желаемого и реального состояния → создаст новый Pod. Этот цикл называется reconciliation loop — ключевой принцип Kubernetes.

### Q2: Как работает rolling update?
**A:** Deployment создаёт новый ReplicaSet с новой версией образа. Постепенно увеличивает replicas нового RS и уменьшает старого. Параметры `maxUnavailable` и `maxSurge` контролируют скорость. В любой момент часть Pod с новой версией, часть со старой — оба ReplicaSet живут параллельно. Старый RS не удаляется — для возможности `rollout undo`.

### Q3: Как Service находит нужные Pod?
**A:** Через `selector` — Service отбирает все Pod с совпадающими labels. kube-proxy на каждой ноде настраивает iptables/IPVS правила для роутинга трафика на IP этих Pod. При добавлении/удалении Pod список Endpoints Service обновляется автоматически. Именно поэтому labels — не просто метаданные, а механизм связи.

### Q4: Зачем разные endpoints для liveness и readiness probe?
**A:** Readiness отвечает на вопрос "могу ли я сейчас принять трафик?" — может зависеть от состояния зависимостей (БД перегружена → readiness падает → Pod временно выходит из балансировки). Liveness отвечает "жив ли процесс?" — только базовая проверка работоспособности. Если они на одном endpoint и readiness падает из-за нагрузки на БД — liveness тоже падает — Kubernetes перезапускает контейнер под нагрузкой — каскадный отказ.

### Q5: Объясни разницу между requests и limits для CPU и memory.
**A:** CPU requests: scheduler выбирает ноду с достаточным CPU, HPA считает проценты. CPU limits: при превышении контейнер throttle-ится (замедляется), но не убивается. Memory requests: то же для планирования. Memory limits: при превышении контейнер убивается (OOMKilled) — memory нельзя throttle. Поэтому memory limits должны быть с запасом. CPU limits — спорная тема: многие рекомендуют не ставить, чтобы не было лишнего throttling.

### Q6: Что происходит при `kubectl apply` vs `kubectl create`?
**A:** `create` — создаёт ресурс, ошибка если уже существует. `apply` — создаёт или обновляет (idempotent). В CI/CD всегда используется `apply`. Kubernetes сравнивает желаемое состояние из yaml с текущим в etcd и применяет только diff — это декларативный подход.

### Q7: Как работает DNS в Kubernetes?
**A:** CoreDNS — DNS сервер кластера — автоматически создаёт записи для каждого Service. Полное имя: `<service>.<namespace>.svc.cluster.local`. Pod обращаются через короткое имя (`postgres`) если в том же namespace, или `postgres.other-ns` для другого. DNS резолвится в ClusterIP Service, а не напрямую в Pod IP.

### Q8: Зачем нужен startupProbe?
**A:** Для приложений с медленным стартом (прогрев кэшей, heavy initialization). Без startupProbe нужно ставить большой `initialDelaySeconds` для liveness — это добавляет слепое время для всех рестартов. startupProbe позволяет задать отдельные параметры для фазы старта: `failureThreshold * periodSeconds` = максимальное время ожидания. После успешного startupProbe начинают работать liveness и readiness.

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
- [Henning Jacobs (Zalando) — «Liveness Probes are Dangerous»](https://srcco.de/posts/kubernetes-liveness-probes-are-dangerous.html) — почему неосторожный liveness probe вызывает каскадные перезапуски под нагрузкой; ровно та проблема, о которой пишет Q4. Must-read.
- [Reddit Engineering — «How a Single PR Brought Down Production for Hours»](https://www.reddit.com/r/kubernetes/) — типичные failure modes (resource starvation, eviction loops).
- [Cloudflare 2019 — «Bad regex took us offline»](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) — почему staged rollouts (canary) и rollback нужны до того, как они понадобятся.

**Tooling:**
- [`kubectl` cheat sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
- [k9s — terminal UI for k8s](https://k9scli.io/) — на порядок удобнее голого `kubectl`.
- [Lens / OpenLens](https://k8slens.dev/) — desktop GUI.
