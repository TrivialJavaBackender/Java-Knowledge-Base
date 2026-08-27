# Helm: одно приложение, пять окружений, один источник правды

> **Какую проблему решает.** Orders API едет в dev, staging, preview и продакшен. Манифесты
> различаются четырьмя значениями — числом реплик, тегом образа, доменом и лимитами, — а копий
> манифестов четыре. Через месяц они расходятся, и никто не знает, в какую сторону. Helm убирает
> копии: остаётся один шаблон и четыре файла значений.
> **Кому это надо.** Тому, кто выкатывает одно приложение больше чем в одно окружение; тому, кто
> ставит чужое (PostgreSQL, Prometheus, cert-manager) — оно распространяется чартами; и тому, кого
> спросят «Helm или Kustomize и почему».
> **Когда НЕ надо.** Helm — шаблонизатор текста, ничего не знающий о смысле YAML: он с одинаковой
> готовностью сгенерирует валидный манифест и синтаксический мусор. Если окружение одно, он даёт
> отступы `nindent` вместо пользы. Если манифесты свои и лежат в монорепозитории, Kustomize
> решает ту же задачу без шаблонного языка (§1.1). И Helm не заменяет GitOps: `helm upgrade`
> с ноутбука — это состояние кластера, которого нет в git (§7).

Сквозной пример модуля: Orders API — Spring Boot backend и nginx-frontend, три экземпляра
в продакшене и один в staging. В этом файле он существует как чарт: `values.yaml` на окружение,
шаблоны на всё остальное.

## 1. Зачем вообще нужен Helm

**Задача.** Orders API нужно выкатить в четыре окружения: dev, staging, preview-ветку и продакшен.
Приложение одно и то же. Различаются четыре вещи: число реплик (1 против 3), тег образа, домен
в Ingress и лимиты ресурсов.

**Наивное решение.** Скопировать каталог с манифестами четыре раза и поправить в копиях эти четыре
значения. Первый день работает.

**Где ломается.** Не на четырёх значениях, а на пятом. Приложение состоит из восьми манифестов —
Deployment, Service, Ingress, ConfigMap, Secret, ServiceAccount, HPA, NetworkPolicy. Добавляется
корпоративный лейбл `cost-center` — правок восемь на окружение, тридцать два всего. Правку в
preview забыли, потому что окружение временное. Через месяц никто не может ответить на вопрос
«чем staging отличается от продакшена», потому что ответ — «мы не знаем, надо сравнивать
руками». Разница между окружениями перестала быть **описанной** и стала **накопившейся**.

Промежуточный шаг — `envsubst` или `sed` поверх одного набора манифестов — работает ровно до
третьей переменной. Дальше начинается: подставить блок из нескольких строк с правильным отступом,
включить Ingress только в двух окружениях из четырёх, задать значение по умолчанию, если
переменная не определена. Это уже требования к языку шаблонов, и bash их не закрывает.

**Механизм.** Helm разделяет **структуру** и **значения**. Структура живёт в шаблонах один раз;
значения — в `values.yaml`, по файлу на окружение. Различие между продакшеном и staging перестаёт
быть разницей между двумя каталогами и становится разницей между двумя файлами на двадцать строк,
которую видно целиком:

```yaml
# values-prod.yaml            # values-staging.yaml
replicaCount: 3               replicaCount: 1
image: {tag: "1.4.2"}         image: {tag: "main-a3f21c"}
ingress: {host: orders.example.com}   ingress: {host: orders.stg.example.com}
resources: {limits: {memory: 512Mi}}  resources: {limits: {memory: 256Mi}}
```

Сверх этого Helm добавляет то, чего у копий каталогов нет в принципе: **релиз** как именованную
сущность с историей ревизий, а значит `helm rollback` вместо «найди в git состояние прошлой
пятницы» (§4), и **зависимости**, чтобы приложение приезжало вместе со своей очередью или кэшем
(§6).

**Правило.** Копировать манифесты между окружениями допустимо, пока окружений два и манифест один.
Как только различия перестают помещаться в голову — они должны стать данными (`values.yaml`),
а не копиями. Критерий не «сколько окружений», а «можете ли вы за минуту назвать все различия
между двумя из них».

Альтернативы шаблонному подходу есть: **Kustomize** (наслоения и патчи вместо шаблонов),
**Jsonnet/Tanka** (генерация из языка конфигурации), **Pulumi/CDK8s** (генерация из кода на
TypeScript, Python или Go). Первая из них — реальный конкурент в повседневной работе, и разбор
именно этого выбора идёт ниже. Helm при этом остаётся фактическим стандартом **распространения**:
если вы ставите чужое приложение в Kubernetes, оно почти наверняка приедет чартом.

### 1.1. Helm против Kustomize — главное противопоставление

| | Helm | Kustomize |
|---|------|-----------|
| Подход | Шаблоны с переменными | Базовые YAML + патчи (overlays) |
| Язык | Go templates | Чистый YAML |
| Версионирование | Версия чарта (semver) | Git |
| Управление зависимостями | Sub-charts, репозитории | Не из коробки |
| История релизов | Хранится в кластере | Нет, только Git |
| Откат | `helm rollback` | `git revert` + повторное применение |
| Кривая обучения | Крутая (шаблоны + scoping + helpers) | Лёгкая (всё ещё YAML) |
| Когда выбирать | Раздавать приложение наружу | Вести свои манифесты в монорепозитории |

В реальности часто используют **оба**: Helm для чужого (PostgreSQL, Prometheus, cert-manager), Kustomize для собственных приложений. Argo CD умеет и то, и другое.

### 1.2. Пакетный менеджер: аналогия с apt/dpkg

Если думать о Helm как `apt` для Kubernetes:

| apt / dpkg | Helm |
|-----------|------|
| `.deb` package | Chart (tar.gz с шаблонами) |
| Установленный пакет | Release |
| `/var/lib/dpkg/status` | Secret/ConfigMap в кластере с историей |
| `apt install nginx` | `helm install my-nginx bitnami/nginx` |
| `apt upgrade nginx` | `helm upgrade my-nginx bitnami/nginx` |
| `apt remove nginx` | `helm uninstall my-nginx` |
| Repository (apt sources) | Helm repository (`helm repo add`) |
| `dpkg --get-selections` | `helm list` |

Одна важная разница: `apt install nginx` создаёт **один** установленный пакет. `helm install my-nginx ...` можно сделать **несколько раз** под разными release names — получите `my-nginx-prod`, `my-nginx-staging` в одном кластере.

---

## 2. Анатомия чарта

```
myapp/                          ← директория chart
├── Chart.yaml                  ← метаданные chart
├── values.yaml                 ← значения по умолчанию
├── values.schema.json          ← (опционально) JSON Schema для валидации values
├── README.md
├── NOTES.txt                   ← (рендерится при install/upgrade в stdout)
├── templates/                  ← шаблоны Kubernetes манифестов
│   ├── _helpers.tpl            ← переиспользуемые шаблоны (по конвенции с _)
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   └── tests/                  ← test pods для `helm test`
│       └── test-connection.yaml
└── charts/                     ← вложенные chart-зависимости (sub-charts)
```

### 2.1. Chart.yaml

```yaml
apiVersion: v2                  # v2 для Helm 3+; v1 — legacy Helm 2
name: myapp
description: My Spring Boot application
type: application               # application | library
version: 0.1.0                  # версия chart (semver)
appVersion: "1.0.0"             # версия приложения, не чарта
kubeVersion: ">=1.24.0"         # совместимость с k8s
keywords:
  - spring-boot
  - api
maintainers:
  - name: Platform Team
    email: platform@example.com
dependencies:
  - name: postgresql
    version: 12.x.x
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
```

Два разных «version»:
- **`version`** — версия чарта (как `0.1.0`). Меняется при изменении шаблонов или values.
- **`appVersion`** — версия приложения (например, `1.0.0` для `myapp:1.0.0`). Меняется при релизе нового приложения.

Например, изменение HPA-настройки = bump `version` (chart изменился), но `appVersion` тот же. Release нового приложения = bump `appVersion` (а возможно и `version`, если меняли defaults).

### 2.2. values.yaml — точка настройки

```yaml
# values.yaml — значения по умолчанию
replicaCount: 1

image:
  repository: myapp
  tag: ""                       # по умолчанию использовать appVersion из Chart.yaml
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

ingress:
  enabled: false
  host: ""
  className: nginx
  tls:
    - secretName: myapp-tls
      hosts:
        - myapp.example.com

postgresql:
  enabled: true                 # включает sub-chart postgresql
  auth:
    database: myapp
```

`values.yaml` — это **дефолты**. Пользователь чарта переопределяет нужное через свой `values-prod.yaml`, `values-staging.yaml`, или флаг `--set`.

### 2.3. NOTES.txt — что увидит пользователь после установки

```
NAME: {{ .Release.Name }}
NAMESPACE: {{ .Release.Namespace }}
STATUS: {{ .Release.Status }}

Get the application URL:
{{- if .Values.ingress.enabled }}
  https://{{ .Values.ingress.host }}
{{- else }}
  kubectl port-forward svc/{{ include "myapp.fullname" . }} 8080:{{ .Values.service.port }}
  Open http://localhost:8080
{{- end }}
```

Это шаблон, который рендерится после `helm install` и печатается в stdout. Полезно для подсказки пользователю «вот как обратиться к свежеустановленному приложению».

---

## 3. Шаблонизация на Go templates

Helm использует **Go template engine** (плюс расширение через **Sprig** — библиотека утилит). Это не Kubernetes-specific — те же шаблоны в Hugo, в Prometheus alerting rules, в Docker `docker inspect --format`.

### 3.1. Базовый синтаксис

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "myapp.fullname" . }}      # вызов вспомогательного шаблона
  labels:
    {{- include "myapp.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}        # из values.yaml
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
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: 8080
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

Ключевые элементы:
- `{{ ... }}` — место подстановки.
- `{{- ... -}}` — варианты с дефисом убирают лишние whitespace/newlines с соответствующей стороны.
- `|` — pipe; результат слева — вход для функции справа.
- `.Values`, `.Chart`, `.Release` — **встроенные объекты** (контекст).

### 3.2. Встроенные объекты

| Объект | Что содержит |
|--------|--------------|
| `.Values` | Слитые values (defaults + overrides). Это то, что пишет пользователь. |
| `.Chart` | Содержимое `Chart.yaml` (Name, Version, AppVersion, ...). |
| `.Release` | Имя release, namespace, revision, флаги install/upgrade. |
| `.Files` | Доступ к файлам в chart (для `.Files.Get "config.json"`). |
| `.Capabilities` | Версия Kubernetes, доступные API. |
| `.Template` | Имя текущего файла шаблона (для error messages). |

### 3.3. Контекст `.` и проблема scoping

Точка `.` в шаблонах — **текущий контекст**. На верхнем уровне это вся data tree. Но многие функции/блоки **меняют контекст** на свой:

```yaml
{{- range .Values.env }}
- name: {{ .name }}        # внутри range . = текущий элемент списка, не корень
  value: {{ .value }}
{{- end }}

{{- with .Values.ingress }}
host: {{ .host }}           # внутри with . = .Values.ingress
{{- end }}
```

Это часто ломает новичков: внутри `range` написал `{{ .Values.replicaCount }}` — ошибка, `.Values` уже не доступен. Решение: либо использовать `$` (всегда указывает на корень: `{{ $.Values.replicaCount }}`), либо сохранить в переменную:

```yaml
{{- $root := . -}}
{{- range .Values.env }}
- name: {{ .name }}
  appLabel: {{ $root.Values.appLabel }}    # через сохранённый корень
{{- end }}
```

### 3.4. Ключевые функции Sprig

| Функция | Что делает | Пример |
|---------|-----------|--------|
| `toYaml` | Конвертирует value в YAML-строку | `{{ toYaml .Values.resources }}` |
| `nindent N` | Добавляет N пробелов + newline в начало каждой строки (правильно для multiline values) | `{{ toYaml .Values.resources \| nindent 12 }}` |
| `indent N` | Добавляет N пробелов в начало каждой строки (без leading newline) | реже нужно |
| `default` | Дефолт если значение пустое | `{{ .Values.image.tag \| default .Chart.AppVersion }}` |
| `required "msg" value` | Падает с ошибкой при пустом value | `{{ required "image.tag is required" .Values.image.tag }}` |
| `quote` | Оборачивает в кавычки | `value: {{ .Values.foo \| quote }}` |
| `printf` | sprintf | `name: {{ printf "%s-%s" .Release.Name .Chart.Name }}` |
| `tpl` | Рендерит строку как шаблон | для динамических шаблонов в values |
| `include` | Вызывает named template | `{{ include "myapp.fullname" . }}` |
| `tuple`, `list`, `dict` | Конструкторы коллекций | для сложной логики |
| `b64enc`, `b64dec` | base64 | для Secret |
| `randAlphaNum N` | Случайная строка | генерация default-пароля |

#### nindent vs indent — частая ошибка

```yaml
resources:
{{ toYaml .Values.resources | indent 2 }}    # неправильно
```

Здесь после `resources:` будет два символа: newline + результат функции. Результат `indent 2` начинается с пробелов (двух), а должен — с newline. Ошибка YAML.

```yaml
resources:
  {{- toYaml .Values.resources | nindent 2 }}    # правильно
```

`nindent` добавляет ведущий `\n`. `{{-` убирает trailing newline предыдущей строки. Итог: правильно вложенный YAML.

Правило большого пальца: **всегда используйте `nindent` для multiline values**.

### 3.5. _helpers.tpl — переиспользуемые шаблоны

```
{{/* templates/_helpers.tpl — файлы с _ не рендерятся в манифесты */}}

{{- define "myapp.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "myapp.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "myapp.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
```

Использование в манифестах через `include`:

```yaml
metadata:
  name: {{ include "myapp.fullname" . }}
  labels:
    {{- include "myapp.labels" . | nindent 4 }}
```

Конвенция: файлы, начинающиеся с `_`, **не рендерятся** в Kubernetes-манифесты. Это только определения. Helm создал её сам — Kubernetes об этом ничего не знает.

`include` обычно лучше, чем `template`: `include` поддерживает конвейер в Sprig-функции (`| nindent`), `template` — нет.

### 3.6. Условные конструкции

```yaml
# Создавать Ingress только если ingress.enabled = true
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
...
{{- end }}
```

```yaml
# Цикл по env
env:
  {{- range .Values.env }}
  - name: {{ .name }}
    value: {{ .value | quote }}
  {{- end }}
```

```yaml
# Защита: если nginx.enabled и tls.enabled — обе должны быть валидны
{{- if and .Values.ingress.enabled .Values.ingress.tls.enabled }}
tls:
  - hosts: [{{ .Values.ingress.host }}]
    secretName: {{ .Values.ingress.tls.secretName }}
{{- end }}
```

---

## 4. Релиз как конечный автомат

Когда вы делаете `helm install`, Helm создаёт **release** — конкретная инсталляция чарта. Это объект с состоянием, живущим в кластере.

```bash
# Установка
helm install myapp-prod ./myapp -f values-prod.yaml

# Обновление
helm upgrade myapp-prod ./myapp -f values-prod.yaml --set image.tag=1.1.0

# Установка или обновление (idempotent)
helm upgrade --install myapp-prod ./myapp -f values-prod.yaml

# История ревизий
helm history myapp-prod

# Откат к предыдущей ревизии
helm rollback myapp-prod

# Откат к конкретной ревизии
helm rollback myapp-prod 2

# Удаление
helm uninstall myapp-prod
```

### 4.1. Жизненный цикл

```
   ┌──────────┐    install    ┌──────────┐    upgrade    ┌──────────┐
   │  (none)  │ ─────────────► │ revision │ ─────────────► │ revision │ ── ► ...
   │          │                │    1     │                │    2     │
   └──────────┘                └──────────┘                └──────────┘
                                                                │
                                                                │ rollback
                                                                ▼
                                                         ┌──────────┐
                                                         │ revision │  (создаётся новая
                                                         │    3     │   revision = revision 1)
                                                         └──────────┘
```

Каждая операция (install/upgrade/rollback) создаёт **новую** revision. Rollback не «возвращает» к старой — он создаёт новую с содержимым старой. Это важно для аудита: history всегда наращивается, не «уменьшается».

### 4.2. Где хранится state

С Helm 3 (2019) Tiller (server-side компонент) удалён. State хранится прямо в Kubernetes:

```bash
kubectl get secret -l owner=helm
```

Каждая revision = один Secret типа `helm.sh/release.v1` в том же namespace, что и release. Содержит gzip-сжатые рендеренные манифесты + metadata.

Можно настроить хранение в ConfigMap (`HELM_DRIVER=configmap`) или внешнем SQL-хранилище (для очень больших installs).

По умолчанию хранятся **последние 10 ревизий** (`--history-max 10`). Дальше старые удаляются. Это конфигурируется.

### 4.3. `--atomic` и `--wait`

```bash
helm upgrade --install myapp ./chart --atomic --wait --timeout 5m
```

- `--wait`: ждать, пока все ресурсы будут Ready (Deployments scaled, Pods running, Services с endpoints).
- `--atomic`: если в течение таймаута не сошлось — **автоматически rollback**. Идеально для CI/CD.

Без `--atomic` неудачный обновление оставит кластер в полусломанном состоянии (часть ресурсов обновилась, часть нет). С `--atomic` — либо всё, либо ничего.

### 4.4. `--reuse-values` и подводный камень с `--set`

```bash
# Первый раз
helm install myapp ./chart --set image.tag=1.0 --set replicaCount=3

# Второй раз — НЕ передал --set replicaCount=3
helm upgrade myapp ./chart --set image.tag=1.1
# → replicaCount вернётся к default (1) — все scaling потеряны!
```

`--set` и `-f values.yaml` — **не сохраняются между upgrade**. Каждый обновление рендерится из chart's defaults + переданных `--set`/`-f`.

Решения:
- **Хранить все `values` в Git** (как `values-prod.yaml`), CI всегда передаёт его.
- **`--reuse-values`**: использовать `values` из предыдущего release + новые `--set` (но не `-f`). Имеет странную семантику с `-f`, лучше явно.

В CI/CD стандарт:

```bash
helm upgrade --install myapp ./chart \
  -f values-prod.yaml \
  --set image.tag=$CI_COMMIT_SHA \
  --atomic --wait --timeout 5m
```

---

## 5. Helm Hooks — события жизненного цикла

Hooks позволяют запускать Kubernetes ресурсы в определённые моменты жизненного цикла release.

```yaml
# templates/db-migration-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migration
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: myapp:{{ .Values.image.tag }}
          command: ["java", "-jar", "app.jar", "--migrate"]
```

### 5.1. Доступные hooks

| Hook | Когда выполняется |
|------|-------------------|
| `pre-install` | После рендера, **до** создания ресурсов при install |
| `post-install` | После создания всех ресурсов при install |
| `pre-upgrade` | До обновления ресурсов |
| `post-upgrade` | После обновления |
| `pre-rollback` | До отката |
| `post-rollback` | После отката |
| `pre-delete` | До удаления release |
| `post-delete` | После удаления |
| `test` | По команде `helm test` (smoke tests) |

### 5.2. hook-weight и порядок выполнения

Если у вас несколько `hooks` одного типа (`pre-install`), они выполняются по возрастанию `hook-weight`. Дефолт — 0. Можно положить, например, миграцию БД на `-10` (выполнить первой), а начальных данных на `0`.

### 5.3. hook-delete-policy

По умолчанию hook-ресурсы остаются в кластере после выполнения. Чтобы их убирать:

- `before-hook-creation` — удалить предыдущий `hook` перед созданием нового (дефолт).
- `hook-succeeded` — удалить, если `hook` прошёл успешно.
- `hook-failed` — удалить даже при провале (потерять логи! — обычно НЕ ставить).

Типичный production-pattern: `before-hook-creation,hook-succeeded` — оставлять только если упал (для debug).

### 5.4. Что если hook упал

Helm ждёт `Job` в статусе **Complete** (exit 0). Если `Job` упал (exit != 0 или timeout), весь `helm upgrade` помечается как **failed**:
- Без `--atomic`: новые ресурсы не созданы; кластер в состоянии «до обновления» (но hook-задача упал — лежит).
- С `--atomic`: автоматический откат к предыдущей revision.

Типичный use-case: pre-upgrade hook с DB-миграцией. Миграция упала — приложение не обновляется. Это защищает от ситуации «новый код требует новую схему БД, а схема осталась старой».

### 5.5. Hooks не входят в состав релиза

Важный нюанс: ресурсы, помеченные как hooks, **не управляются Helm**'ом в release. `helm uninstall` их **не удаляет**. Если ваш `hook` создаёт что-то, что должно жить дольше hook — это надо убирать вручную или через дополнительный post-delete hook.

---

## 6. Зависимости и sub-charts

Сложные приложения часто требуют дополнительные сервисы: PostgreSQL, Redis, RabbitMQ. Все они есть как готовые Helm-чарты от Bitnami / прочих. Объявите их зависимостями:

```yaml
# Chart.yaml
dependencies:
  - name: postgresql
    version: 12.x.x
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
  - name: redis
    version: 18.x.x
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
    alias: cache              # доступен как .Values.cache, не .Values.redis
```

```bash
helm dependency update ./myapp    # скачать sub-charts в ./charts/
```

`condition: postgresql.enabled` означает: sub-chart активен только если `postgresql.enabled: true` в values. Это позволяет одному чарту работать как с встроенным PG, так и с external (managed RDS).

### 6.1. Значения для sub-chart

Переопределения для `sub-chart` лежат под его именем:

```yaml
# values.yaml вашего чарта
postgresql:                   # имя sub-chart
  enabled: true
  auth:
    postgresPassword: ""      # переопределение параметра bitnami/postgresql
    database: myapp
  primary:
    persistence:
      size: 20Gi
```

`auth`, `primary` — параметры самого `bitnami/postgresql` чарта. Изучаете их в его документации, прокидываете нужные.

### 6.2. Umbrella chart / app-of-apps

Можно сделать chart, который вообще не содержит собственных манифестов — только dependencies. Это **umbrella chart**:

```yaml
# umbrella/Chart.yaml
name: my-platform
dependencies:
  - name: api
    version: 1.0.0
    repository: file://../api-chart
  - name: worker
    version: 1.0.0
    repository: file://../worker-chart
  - name: dashboard
    version: 1.0.0
    repository: file://../dashboard-chart
```

Один `helm install` поднимает всю платформу. Argo CD имеет похожий паттерн **app-of-apps**: одно Argo Application, которое содержит ссылки на много дочерних объектов Application.

### 6.3. Library charts (Helm 3+)

Chart с `type: library` не может быть установлен сам по себе — он содержит только helpers. Используется, когда у вас 30 микросервисов и хочется не дублировать `_helpers.tpl` в каждом:

```yaml
# library/Chart.yaml
name: company-common
type: library
version: 1.0.0
```

```yaml
# library/templates/_labels.tpl
{{- define "company-common.labels" -}}
company.com/team: {{ .Values.team }}
company.com/cost-center: {{ .Values.costCenter }}
{{- end }}
```

Каждый микросервис тянет библиотеку как dependency и `{{ include "company-common.labels" . }}`. Изменение в library → bump version → каждый чарт берёт новую версию.

---

## 7. Что запускает Helm за вас: GitOps и надстройки

### 7.1. Helmfile

`helm install/upgrade` — это императивная команда. Если у вас 30 микросервисов в 4 окружениях, поддерживать команды деплоя — мука.

**Helmfile** — декларативный wrapper:

```yaml
# helmfile.yaml
repositories:
  - name: bitnami
    url: https://charts.bitnami.com/bitnami

releases:
  - name: postgres
    chart: bitnami/postgresql
    version: 12.5.0
    values:
      - postgres-values.yaml

  - name: api
    chart: ./charts/api
    needs: [postgres]
    values:
      - environments/{{ .Environment.Name }}/api.yaml
```

```bash
helmfile -e production sync       # синхронизировать всё для production
helmfile -e production diff       # увидеть что изменится
```

### 7.2. Argo CD — GitOps для Helm

Argo CD — GitOps-controller для Kubernetes. Принцип: **истина в Git, не в кластере**.

- Argo Application указывает на репозиторий с Helm chart + values.yaml.
- Argo постоянно сравнивает yaml в Git с состоянием в кластере.
- При drift (кто-то поменял что-то напрямую через kubectl) — Argo сигнализирует или возвращает к Git.
- Деплой = коммит в Git + Argo Application sync.

Это убирает `helm install/upgrade` вообще. CI не имеет доступа в production — только `git push`.

В 2026 году Argo CD + Helm — стандарт для serious deployments. Чистый `helm upgrade` от руки — для dev/локальной разработки.

---

## 8. Отладка

```bash
# Проверить chart без установки (lint правил)
helm lint ./myapp

# Показать итоговые манифесты без применения
helm template my-release ./myapp -f values-prod.yaml

# Установить с dry-run — apiserver валидирует, но не создаёт
helm install myapp ./myapp --debug --dry-run

# Получить текущие values установленного release
helm get values myapp-prod

# Получить рендеренные манифесты
helm get manifest myapp-prod

# Получить полную информацию о release
helm get all myapp-prod
```

`helm template` — самый частый debugging tool. Он показывает, что именно Helm отправит в apiserver. Если результат «не то, что вы ожидали» — это проблема шаблонов; если apiserver его не принимает — это проблема Kubernetes API.

---

## 9. Антипаттерны

| Антипаттерн | Проблема | Как правильно |
|-------------|----------|---------------|
| Hardcoded values в шаблоне (image: `myrepo/app:1.0`) | Невозможно переопределить | Через `.Values.image.repository` + `:tag` |
| Нет `default` для критических параметров | Странные ошибки рендера | `{{ .Values.foo \| default "bar" }}` или `required` |
| Многослойный `_helpers.tpl` на 500 строк | Невозможно найти определение | Разбить на `_labels.tpl`, `_names.tpl` |
| `--set image.tag=...` без хранения в values | Через 3 upgrade забыли, что задавали | Хранить ВСЕ values в Git |
| Не использовать `--atomic` в CI | Полусломанный кластер при failed upgrade | `--atomic --wait` всегда |
| Хранить Secret в values.yaml в Git | Утечка паролей | Sealed Secrets / Vault / External Secrets ([см. SECRETS.md](SECRETS.md)) |
| `helm upgrade --reuse-values` без понимания | Тяжёлый conflict при изменении defaults в chart | Явные `-f values-prod.yaml` |
| Не пинить chart version | Bitnami обновил chart breaking-way → production упал | В CI всегда `--version X.Y.Z` |
| Изменение namespace в шаблоне без `.Release.Namespace` | Resources создаются не там | `{{ .Release.Namespace }}` |
| Огромный chart на всё подряд | Невозможно обновлять компоненты независимо | Разбить, использовать umbrella или Argo |
| Хук без `hook-delete-policy` | Job накапливаются в namespace | Всегда `hook-delete-policy: before-hook-creation,hook-succeeded` |

---

## 10. Разбор инцидента: несовместимые изменения в чартах Bitnami

Bitnami — самые популярные публично доступные Helm чарты. И они **меняются**. Major version bump (`postgresql 11.x → 12.x`) часто приходит с breaking changes:

- Изменение схемы Secret (auth.postgresPassword → auth.password).
- Перенос ресурсов в другой пространство имён или smena имени.
- Drop поддержки старых версий Kubernetes.

Если ваш CI делает `helm upgrade --install postgres bitnami/postgresql` **без явного `--version`**, в один прекрасный день Bitnami релизит 12.0.0, ваш CI берёт его, и обновление падает с непонятной ошибкой. Хуже — Helm может удалить ваш Secret с паролем и пересоздать новый с другим значением. Приложение потеряло доступ к БД.

Правила:
1. **Пинить chart version**: `--version 11.9.13` в CI.
2. **Тестировать обновление в staging** перед production.
3. **Читать changelog** при бампе major.
4. **Бэкап БД перед upgrade** (всегда, не только для Helm).

---

## 11. Когда это неправильный ответ

**Helm ради одного окружения.** Шаблон, у которого один файл значений, — это исходный YAML плюс
`{{ }}`, `nindent` и невозможность прочитать манифест глазами без `helm template`. Цена платится,
выгода нулевая. Правило из §1 работает в обе стороны.

**Шаблонизация как замена пониманию манифеста.** Helm подставляет текст и не знает, что такое
Deployment. Опечатка в отступе даёт валидный с точки зрения Helm результат и невалидный манифест;
`helm lint` ловит часть таких случаев, `helm template | kubectl apply --dry-run=server` — больше.
Если чарт «работает, но никто не знает почему» — это не проблема Helm, это отсутствующий шаг
проверки вывода.

**`helm upgrade` руками в продакшене.** Состояние кластера начинает отличаться от git, и
единственный, кто знает об изменении, — тот, кто набрал команду. История релизов Helm тут не
спасает: она отвечает на «что стоит сейчас», а не «почему так решили». Ответ — GitOps (§7), где
`helm upgrade` выполняет Argo CD по коммиту.

**Чужой чарт без закреплённой версии.** `helm repo update` в CI молча подтягивает мажорную версию
чарта с несовместимыми изменениями — разбор такого случая в §10. Версия чарта фиксируется так же,
как версия библиотеки.

**Секреты в `values.yaml`.** Файл лежит в git, попадает в CI-журналы и виден в
`helm get values`. Механизмы, которые для этого предназначены, — в
[`SECRETS.md`](SECRETS.md): External Secrets Operator, Sealed Secrets, SOPS, Vault Agent.

**Hook там, где нужен init-контейнер.** `pre-install` hook выполняется один раз на релиз, а не на
под, и ничего не знает о том, что под пересоздали. Миграция схемы базы — сценарий для hook;
ожидание готовности зависимости перед стартом конкретного пода — для init-контейнера
([`KUBERNETES.md`](KUBERNETES.md) §4).

---

## 12. Шпаргалка

**Что у вас на входе → что брать**

| Ситуация | Решение | Почему |
|---|---|---|
| Своё приложение, свои манифесты, монорепозиторий | Kustomize | Патчи без шаблонного языка |
| Приложение раздаётся наружу или ставится чужое | Helm | Формат распространения де-факто |
| Различия между окружениями не помещаются в голову | Шаблон + `values-<env>.yaml` | Различие становится данными, а не копиями |
| Нужно откатиться на прошлую версию за минуту | `helm rollback <релиз> <ревизия>` | История ревизий хранится в кластере |
| Миграция схемы перед выкаткой | Hook `pre-upgrade` | Выполняется один раз на релиз, до выкатки подов |
| Ожидание готовности зависимости при старте пода | init-контейнер, не hook | Hook не знает о пересоздании пода |
| Приложение приезжает вместе с очередью или кэшем | Sub-chart в `dependencies` | Версия зависимости фиксируется в `Chart.yaml` |
| Выкатка не должна оставить кластер в половинчатом состоянии | `helm upgrade --atomic --wait` | Откат при неуспехе выполняется автоматически |
| Пароль к базе | Внешнее хранилище, не `values.yaml` | Значения видны в git и в `helm get values` |

**Порядок проверки чарта — от дешёвого к дорогому**

1. `helm lint` — структура чарта, обязательные поля.
2. `helm template . -f values-prod.yaml` — что реально сгенерируется; читать глазами.
3. `helm template … | kubectl apply --dry-run=server -f -` — проверка схемой API кластера.
4. `helm upgrade --install --atomic --wait --timeout 5m` — в CI, чтобы неуспех откатывался сам.
5. `helm diff upgrade` (плагин) — что изменится по сравнению с тем, что стоит.

---

## Вопросы для самопроверки

1. Чем задача, которую решает Helm, отличается от задачи, которую решает Kustomize? Ответ должен
   опираться на механизм, а не на «Helm мощнее».
2. Где физически хранится история релиза и что из этого следует при потере кластера?
3. `helm upgrade` завершился с ошибкой на середине. В каком состоянии кластер и какой флаг это
   меняет?
4. Чем `helm rollback` отличается от `git revert` + повторного применения манифестов?
5. Почему `nindent` в шаблонах встречается чаще, чем `indent`, и что происходит, если перепутать?
6. Hook `pre-install` и init-контейнер: какая задача решается каждым и почему их нельзя поменять
   местами?
7. Sub-chart переопределяет значение родительского чарта. Кто выигрывает и по какому правилу?
8. Что именно ломается, когда в CI не закреплена версия чужого чарта?
9. Почему `helm template` — обязательный шаг перед выкаткой, даже когда `helm lint` прошёл?
10. Релиз с одним и тем же именем поставлен дважды в разные пространства имён. Это один релиз
    или два, и где это видно?
11. Значение задано и в `values.yaml`, и через `--set`. Какое применится?

---

## Упражнения

- [Ex15: базовый чарт](../exercises/helm/Ex15_BasicChart) — §2.
- [Ex16: значения и шаблоны](../exercises/helm/Ex16_ValuesAndTemplates) — §3.
- [Ex17: hooks](../exercises/helm/Ex17_HelmHooks) — `pre-install`, `post-upgrade`, §5.
- [Ex18: условная шаблонизация](../exercises/helm/Ex18_HelmConditionals) — `_helpers.tpl`, `if`/`range`, §3.

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
- [Bitnami Charts](https://github.com/bitnami/charts) — самые популярные production-ready charts; примеры паттернов.

**Альтернативы (важно знать):**
- [Kustomize](https://kustomize.io/) — встроенный в `kubectl` overlay-инструмент, без шаблонов.
- [Argo CD](https://argo-cd.readthedocs.io/) — GitOps-операционка для Helm/Kustomize в проде.
- [Helmfile](https://github.com/helmfile/helmfile) — declarative wrapper над `helm install/upgrade`.
