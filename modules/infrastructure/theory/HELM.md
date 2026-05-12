# Helm

---

## 1. Зачем Helm?

Без Helm деплой приложения в Kubernetes — это набор YAML файлов, которые нужно вручную менять для каждого окружения:

```
# Без Helm: дублирование конфигурации для prod/staging/dev
deployment-prod.yaml   deployment-staging.yaml   deployment-dev.yaml
   replicas: 5             replicas: 2               replicas: 1
   image: app:1.0          image: app:1.0            image: app:dev
   cpu: 500m               cpu: 250m                 cpu: 100m
```

Helm решает это через шаблонизацию: один набор шаблонов + `values.yaml` на окружение.

---

## 2. Анатомия Helm Chart

```
myapp/                          ← директория chart
├── Chart.yaml                  ← метаданные chart
├── values.yaml                 ← значения по умолчанию
├── templates/                  ← шаблоны Kubernetes манифестов
│   ├── _helpers.tpl            ← переиспользуемые шаблоны
│   ├── deployment.yaml
│   ├── service.yaml
│   └── ingress.yaml
└── charts/                     ← зависимости (sub-charts)
```

```yaml
# Chart.yaml
apiVersion: v2
name: myapp
description: My Spring Boot application
version: 0.1.0         # версия chart (semver)
appVersion: "1.0.0"    # версия приложения
```

```yaml
# values.yaml — значения по умолчанию
replicaCount: 1

image:
  repository: myapp
  tag: "1.0.0"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80

resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

---

## 3. Шаблонизация

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "myapp.fullname" . }}      # из _helpers.tpl
  labels:
    {{- include "myapp.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}         # из values.yaml
  selector:
    matchLabels:
      {{- include "myapp.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "myapp.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: 8080
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          {{- if .Values.ingress.enabled }}    # условный блок
          env:
            - name: BASE_URL
              value: {{ .Values.ingress.host }}
          {{- end }}
```

```
# templates/_helpers.tpl
{{- define "myapp.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 }}
{{- end }}

{{- define "myapp.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
{{- end }}
```

Ключевые переменные в шаблонах:
- `.Values.*` — из values.yaml (или --set)
- `.Release.Name` — имя release при установке
- `.Chart.Name` — имя chart
- `.Chart.AppVersion` — версия приложения

---

## 4. Жизненный цикл Release

```bash
# Установка
helm install myapp-prod ./myapp -f values-prod.yaml

# Обновление
helm upgrade myapp-prod ./myapp -f values-prod.yaml --set image.tag=1.1.0

# Установка или обновление (idempotent)
helm upgrade --install myapp-prod ./myapp -f values-prod.yaml

# История
helm history myapp-prod

# Откат к предыдущей ревизии
helm rollback myapp-prod

# Откат к конкретной ревизии
helm rollback myapp-prod 2

# Удаление
helm uninstall myapp-prod
```

Helm хранит историю release в Kubernetes Secrets (namespace `helm.sh/release.v1`). Это позволяет rollback без внешнего хранилища.

---

## 5. Helm Hooks

```yaml
# templates/db-migration-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migration
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install   # выполнить ДО создания ресурсов
    "helm.sh/hook-weight": "-5"               # порядок (меньше = раньше)
    "helm.sh/hook-delete-policy": before-hook-creation  # очистить старый job
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: myapp:{{ .Values.image.tag }}
          command: ["java", "-jar", "app.jar", "--migrate"]
```

| Hook | Момент выполнения |
|------|-----------------|
| pre-install | До создания ресурсов при install |
| post-install | После создания всех ресурсов |
| pre-upgrade | До обновления ресурсов |
| post-upgrade | После обновления |
| pre-rollback | До отката |
| post-rollback | После отката |
| pre-delete | До удаления release |

Helm ждёт завершения Job (success) перед продолжением. Если Job упал — upgrade откатывается.

---

## 6. Условная шаблонизация и range

```yaml
# values.yaml
ingress:
  enabled: false
  host: ""

env:
  - name: SPRING_PROFILE
    value: production
  - name: LOG_LEVEL
    value: INFO
```

```yaml
# templates/ingress.yaml
{{- if .Values.ingress.enabled }}      # условный ресурс
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "myapp.fullname" . }}
spec:
  rules:
    - host: {{ .Values.ingress.host }}
      ...
{{- end }}

# В deployment.yaml — цикл по env переменным
env:
  {{- range .Values.env }}
  - name: {{ .name }}
    value: {{ .value | quote }}
  {{- end }}
```

---

## 7. Проверка и отладка

```bash
# Проверить chart без установки
helm lint ./myapp

# Показать итоговые манифесты без применения
helm template myapp ./myapp -f values-prod.yaml

# Установить с verbose выводом
helm install myapp ./myapp --debug --dry-run

# Получить текущие values установленного release
helm get values myapp-prod
```

---

## Вопросы для собеседования

### Q1: Что такое Helm release? Чем отличается от chart?
**A:** Chart — шаблон (пакет с шаблонами + values.yaml), аналог Docker image. Release — конкретная установка chart в кластер с конкретными values, аналог Docker container. Один chart можно установить несколько раз под разными именами: `helm install myapp-prod ./myapp -f prod.yaml` и `helm install myapp-staging ./myapp -f staging.yaml`. Каждый — отдельный release со своей историей.

### Q2: Как работает `helm rollback`?
**A:** Helm хранит все ревизии release в Kubernetes Secrets. При `helm rollback myapp 2` берёт манифесты ревизии 2 и применяет их через `kubectl apply`. Rollback создаёт новую ревизию (не удаляет текущую). Важно: rollback откатывает только Kubernetes ресурсы — не данные в базе, не внешние состояния. DB миграции не откатываются автоматически.

### Q3: Зачем нужны `_helpers.tpl`?
**A:** Для переиспользуемых шаблонных функций. Вместо дублирования одних и тех же labels в каждом файле — `include "myapp.labels" .` в любом шаблоне. Конвенция: файлы, начинающиеся с `_`, не рендерятся в манифесты напрямую. `define` в helpers, `include` в шаблонах.

### Q4: Чем `helm upgrade --install` лучше раздельных install/upgrade?
**A:** Idempotent операция: если release не существует — создаёт, если существует — обновляет. Идеально для CI/CD пайплайнов, где нужен один и тот же скрипт для первого деплоя и последующих. Без `--install` `upgrade` упал бы с ошибкой при первом запуске.

### Q5: Как переопределить значения при `helm upgrade`?
**A:** `--set key=value` для единичных значений (осторожно: не сохраняется между upgrade). `-f values-override.yaml` для набора значений. `--reuse-values` — взять values из предыдущего release и применить только новые. В CI/CD обычно: `helm upgrade --install myapp ./chart -f values-prod.yaml --set image.tag=$CI_COMMIT_SHA`.

### Q6: Что происходит при провале Helm hook Job?
**A:** Helm ждёт Job в статусе Complete (exit code 0). Если Job завершился ошибкой — весь `helm upgrade` помечается как failed, новые ресурсы не создаются. Это защищает от деплоя версии, где DB миграция не прошла. Состояние кластера зависит от `hook-delete-policy` и того, на каком этапе упал hook.

---

## Источники

**Официальная документация:**
- [Helm Documentation](https://helm.sh/docs/) — install, charts, templating, hooks, values.
- [Helm — Chart Best Practices](https://helm.sh/docs/chart_best_practices/) — naming, values, labels, dependencies.
- [Helm — Chart Hooks](https://helm.sh/docs/topics/charts_hooks/) — pre-/post-install, upgrade, rollback, delete.
- [Helm Template Functions and Pipelines](https://helm.sh/docs/chart_template_guide/function_list/)

**Books:**
- *Learning Helm* (Matt Butcher, Matt Farina, Josh Dolitsky, O'Reilly 2021) — авторы — core maintainers Helm.
- *The Kubernetes Book* (Nigel Poulton) — глава про Helm есть в современных изданиях.

**Engineering blogs / talks:**
- [«Helm vs Kustomize: Pros and Cons» (CNCF Blog)](https://www.cncf.io/blog/2020/08/26/why-do-devops-engineers-love-helm/) — когда Helm избыточен.
- [Helm Charts Repository — best practices](https://github.com/helm/charts) — большая коллекция реальных charts (deprecated, но образцы хороши).
- [Bitnami Charts](https://github.com/bitnami/charts) — самые популярные production-ready charts; примеры паттернов.

**Альтернативы (важно знать):**
- [Kustomize](https://kustomize.io/) — встроенный в `kubectl` overlay-инструмент, без шаблонов.
- [Argo CD](https://argo-cd.readthedocs.io/) — GitOps-операционка для Helm/Kustomize в проде.
