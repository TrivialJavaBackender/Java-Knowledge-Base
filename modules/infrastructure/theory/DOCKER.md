# Docker

---

## 1. Зачем вообще появились контейнеры

В середине нулевых типичный production-деплой выглядел так: запакованный архив выкладывали на сервер, который кто-то когда-то настроил, и где жили ещё пять других приложений. Если повезло — была инструкция «`apt-get install libfoo-1.2`, потом скопировать `application.conf`, потом перезапустить tomcat». Если не повезло — инструкции не было, и senior разработчик помнил половину шагов, а другую половину знал только админ, который уже уволился.

Это та самая знаменитая проблема **«works on my machine»**: сборка работает у разработчика, у тестировщика отваливается из-за версии libssl, в продакшене падает из-за того, что Java 8 update 192 ≠ Java 8 update 201, на staging вообще ставится не та locale.

Возможных решений было четыре, и все они имели большой минус:

1. **Документация** — никто её не пишет, а если пишет, она устаревает в течение недели.
2. **Configuration management** (Puppet, Chef, Ansible) — описывает желаемое состояние сервера, но не *самого приложения*. Если на сервере уже было что-то, состояние получается недетерминированным.
3. **Виртуальные машины** — каждое приложение в своей VM. Изоляция отличная, но образ — 5–20 GB, старт минуты, на одной железке умещается десяток-другой. Дорого.
4. **Build single deployable artifact** (jar, статически слинкованный бинарник) — работает для языков с runtime внутри артефакта (Java, Go), но не для приложений с системными зависимостями.

Контейнеры закрыли пробел: запаковать **приложение вместе со всеми его зависимостями вплоть до libc**, но запускать как обычный процесс — без виртуализации железа, без второго ядра, без минут на старт. Один образ — разработчик, тестировщик, продакшен видят буквально один и тот же байт-на-байт runtime.

### 1.1. Краткая история изоляции

Идеи изоляции процессов на одном ядре намного старше Docker:

| Год | Технология | Что давало |
|-----|-----------|-----------|
| 1979 | `chroot()` в V7 Unix | Изменение корня файловой системы для процесса. Можно было запереть процесс в поддиректорию. Но не изолированы процессы, сеть, пользователи. |
| 2000 | FreeBSD Jails | Полноценный контейнер: chroot + изоляция процессов + сеть. Использовался хостерами для VPS. |
| 2004 | Solaris Zones | То же на Solaris, плюс resource controls. |
| 2006 | Google `cgroups` (process containers) | Linux получает механизм ограничения ресурсов (CPU, memory, IO) для групп процессов. Гугл сразу запускает это в Borg. |
| 2008 | LXC (Linux Containers) | Сборка из cgroups + namespaces в полноценный «контейнер» как абстракцию. Использовать сложно — куча низкоуровневых ручек. |
| 2013 | **Docker 0.1** | Тонкая обёртка над LXC. Главная инновация — не низкоуровневая технология, а **формат образа и Dockerfile**. Разработчик пишет 15 строк Dockerfile и получает воспроизводимый образ. |
| 2014–2015 | Docker уходит от LXC, пишет свой runtime `libcontainer`. | Это даёт стабильность поведения и независимость от ядра. |
| 2015 | **Open Container Initiative (OCI)** | Стандарт формата образа и runtime. Docker, Google, RedHat, CoreOS подписываются. Теперь Docker — не монополист, а одна из реализаций OCI. |
| 2017+ | containerd, CRI-O, podman | Альтернативные runtime'ы, совместимые с OCI. Kubernetes начиная с 1.24 (2022) удалил поддержку Docker как runtime — общается напрямую с containerd. |

Если коротко: технология существовала 30+ лет, Docker не изобрёл её — он изобрёл **способ её упаковать так, чтобы было удобно разработчику**.

---

## 2. Что такое контейнер технически

```
Виртуальная машина:               Контейнер:
┌─────────────────────┐           ┌─────────────────────┐
│      App A          │           │  App A  │  App B    │
├─────────────────────┤           ├─────────┴───────────┤
│      Guest OS       │           │   Container Runtime  │
├─────────────────────┤           ├─────────────────────┤
│     Hypervisor      │           │      Host OS        │
├─────────────────────┤           ├─────────────────────┤
│      Hardware       │           │      Hardware       │
└─────────────────────┘           └─────────────────────┘
  ~GBs RAM, ~минуты старт           ~MBs RAM, ~секунды старт
```

Контейнер — это **обычный процесс хостовой ОС**, которому ядро показывает «суррогатную реальность»: свою таблицу процессов, свой набор сетевых интерфейсов, свою файловую систему. Все эти процессы используют **одно общее ядро** — ядро хоста.

Два механизма Linux реализуют этот «обман»:

### 2.1. Namespaces — изоляция «вида»

Namespace говорит: «процесс P видит только подмножество системы». Если P смотрит на список PID — он увидит свой namespace, а не все процессы хоста. В Linux есть восемь видов namespace, и каждый изолирует свой ресурс:

| Namespace | Что изолирует | Что увидит изнутри контейнера |
|-----------|---------------|-------------------------------|
| `PID` | Список процессов | Свой `init` (PID 1), не видит процессов хоста |
| `mount` | Точки монтирования | Свой `/`, свои `/proc`, `/sys` |
| `network` | Сетевые интерфейсы, маршруты, файрвол, сокеты | Свои `eth0`, `lo`, свои порты, свою таблицу маршрутизации |
| `IPC` | System V IPC, POSIX message queues | Свои очереди и семафоры |
| `UTS` | Hostname и domain name | Свой `hostname` |
| `user` | UID/GID mapping | UID 0 внутри ≠ UID 0 снаружи (если включён user namespace) |
| `cgroup` | Видимость cgroups | Свою корневую cgroup |
| `time` (с 5.6) | CLOCK_MONOTONIC, CLOCK_BOOTTIME | Свои часы (для CRIU/migration) |

То есть **контейнер — это процесс, у которого все восемь рычагов «переключены» в новые значения**. Командой `unshare` это можно сделать вручную:

```bash
# Создать новый PID + mount namespace и запустить bash
sudo unshare --fork --pid --mount-proc bash
ps aux  # внутри увидите только bash и ps — никаких других процессов
```

Никакого Docker — это всё стандартный Linux с 2002 года.

### 2.2. cgroups — ограничение ресурсов

Namespace говорит «*что* процесс видит», cgroups говорит «*сколько* процесс может использовать». В cgroups v2 (Linux 4.5+, продакшен с ~2019) основные контроллеры:

- `cpu` — ограничение CPU shares и периоды
- `memory` — лимит RAM (при превышении — OOM kill **только этой группы**, не других процессов хоста)
- `io` — лимит блочного I/O
- `pids` — максимум процессов в группе (защита от fork-бомб)
- `hugetlb`, `cpuset`, `rdma`, `misc` — экзотика

Когда вы пишете `docker run --memory 512m --cpus 0.5 myapp`, Docker создаёт cgroup и сажает в неё процесс. Ядро дальше **само** следит, чтобы суммарно процессы в группе не превысили 512 MB и 50% одного CPU.

### 2.3. Почему контейнер — это не «маленькая VM»

Самое частое заблуждение: «контейнер — это лёгкая VM». Это неверно по нескольким причинам:

| | Виртуальная машина | Контейнер |
|--|------------------|----------|
| Изоляция | Аппаратная — отдельное ядро в hypervisor (KVM/Xen) | Программная — один и тот же kernel |
| Стартует | Минуты (полный boot ОС) | Доли секунды (fork + exec) |
| RAM на инстанс | 500 MB – 4 GB (включая kernel + сервисы guest OS) | Сколько занимает само приложение — от 10 MB |
| Плотность на хосте | Десятки | Тысячи |
| Security boundary | Сильный — нужно пробить hypervisor | Слабее — общий kernel; уязвимость в ядре = compromise всех контейнеров |
| Образ | 1–20 GB | 10–500 MB |
| Когда выбирать | Многокомпонентные системы с разными ОС, строгая изоляция (multi-tenant SaaS) | Микросервисы одного приложения, dev/CI/CD |

Главное практическое следствие: **если злоумышленник нашёл local privilege escalation в ядре — он вышел из всех контейнеров на хосте сразу**. Поэтому в multi-tenant средах (например, public-cloud serverless platforms) внутри контейнера часто запускают ещё VM (Firecracker у AWS Lambda, gVisor у Google Cloud Run) — это второй периметр безопасности.

---

## 3. Образ как слоистая файловая система

Образ контейнера — это **не tar-архив**, а стопка тонких слоёв, наложенных друг на друга через **union mount**. Технология называется OverlayFS (в современном Docker), исторически использовались AUFS, devicemapper, btrfs.

### 3.1. Идея union mount

Представьте три прозрачные плёнки, наложенные одна на другую. Сверху видно все три, но если на верхней плёнке нарисовано что-то поверх символа с нижней — видна только верхняя версия.

```
       (что видит процесс)
       merged view: /
       ├─ /app/app.jar         ← из слоя 4
       ├─ /etc/passwd          ← из базового слоя
       └─ /var/lib/myapp/      ← из слоя 3

┌─────────────────────────────────────┐
│  Layer 4 (writable)                 │  ← contains: /app/app.jar
├─────────────────────────────────────┤
│  Layer 3 (read-only)                │  ← contains: RUN mkdir /var/lib/myapp
├─────────────────────────────────────┤
│  Layer 2 (read-only)                │  ← contains: apt installed deps
├─────────────────────────────────────┤
│  Layer 1 — base image (read-only)   │  ← contains: /etc/passwd, /bin/, /lib/
└─────────────────────────────────────┘
```

OverlayFS использует терминологию `lowerdir` (read-only слои снизу), `upperdir` (writable верхний слой) и `merged` (то, что видит процесс).

### 3.2. Copy-on-write

Когда контейнер пытается **изменить** файл, который физически лежит в нижнем (read-only) слое, OverlayFS:

1. Копирует файл в `upperdir`.
2. Применяет изменение к копии.
3. Когда процесс читает этот файл, видит «верхнюю» версию.

Это **copy-on-write**: пока никто ничего не меняет, файл физически лежит в одной копии (shared между сотнями контейнеров), но при первой записи появляется частная копия.

Удаление работает через **whiteout-файлы**: специальные «чёрные дыры» в `upperdir`, которые «прячут» файл из нижнего слоя. Файл физически остаётся в lowerdir (вместе со всеми остальными контейнерами), но конкретный контейнер его не видит.

### 3.3. Почему это важно для практики

- **Дисковая экономия**: пять контейнеров на хосте, использующих один и тот же базовый образ `eclipse-temurin:21-jre` (~300 MB), потребляют не 1500 MB, а 300 MB + дельты.
- **Кэш слоёв при сборке** (см. §4): если слой не изменился — Docker берёт его готовый из локального кэша.
- **Скорость pull**: при `docker pull` скачиваются только отсутствующие слои. Поэтому деплой того же приложения с новой версией кода тянет с registry буквально дельту в килобайты.

### 3.4. Writable layer — anti-pattern «записать данные в контейнер»

У каждого работающего контейнера сверху всех слоёв есть один **writable layer**. Туда складываются все runtime-изменения. Это тоже OverlayFS-слой, и поэтому:

- Он **исчезает при удалении контейнера** (`docker rm`).
- На нём действует overlay — каждая первая запись в файл из нижнего слоя триггерит copy-on-write (это медленно, особенно для I/O-интенсивных приложений).
- В кластере с auto-scaling новый под — пустой writable layer.

Поэтому **в writable layer нельзя писать ничего, что должно пережить контейнер**: БД, файлы загрузок, логи в файловой системе, сессии. Для этого есть volumes (см. §7).

---

## 4. Dockerfile и кэш слоёв

Dockerfile — декларативный рецепт. Каждая инструкция, изменяющая filesystem (`RUN`, `COPY`, `ADD`), создаёт **новый слой**. Метаданные-инструкции (`ENV`, `LABEL`, `EXPOSE`, `USER`) тоже создают слой, но «пустой».

### 4.1. Кэш слоёв и почему порядок инструкций критически важен

```
┌─────────────────────────────────────┐
│  COPY target/app.jar /app.jar       │  Layer 4 — меняется каждый build
├─────────────────────────────────────┤
│  RUN mvn dependency:go-offline      │  Layer 3 — меняется при смене pom.xml
├─────────────────────────────────────┤
│  COPY pom.xml .                     │  Layer 2 — меняется при смене pom.xml
├─────────────────────────────────────┤
│  eclipse-temurin:21-jre (base)      │  Layer 1 — кэшируется надолго
└─────────────────────────────────────┘
```

Каждая инструкция Dockerfile создаёт новый слой (read-only diff). При сборке Docker проверяет кэш: если слой не изменился — берёт из кэша. **Изменение слоя инвалидирует все последующие слои.**

Правильный порядок — от редко меняющегося к часто меняющемуся:

1. Базовый образ — меняется раз в месяц/квартал.
2. Системные зависимости (apt-get install) — меняются раз в неделю.
3. Зависимости приложения (`pom.xml`, `package.json`, `requirements.txt`) — меняются раз в несколько дней.
4. Исходный код — меняется каждый коммит.

Если поставить `COPY . .` перед загрузкой зависимостей, любое изменение в любом `.kt`-файле инвалидирует кэш `mvn dependency:go-offline`, и Maven пойдёт скачивать 200 MB зависимостей заново. На CI это превращает 30-секундный build в 5-минутный — каждый раз.

### 4.2. `.dockerignore` — что попадает в build context

При `docker build .` Docker-демону передаётся **build context** — содержимое директории, в которой вы находитесь. Если в директории лежит `target/` (300 MB Maven build), `.git/` (50 MB истории), `node_modules/` (500 MB), `.idea/`, видео-демо в `docs/`, всё это **сначала упаковывается, потом отправляется демону**. Даже если `Dockerfile` ничего из этого не копирует.

Последствия:
- Каждый `docker build` тратит секунды-минуты на упаковку и передачу.
- При неаккуратном `COPY . .` весь мусор попадёт в финальный образ — размер раздуется, секреты в `.env.local` улетят в registry.
- BuildKit умнее (стримит контент инкрементально), но базовый принцип тот же.

`.dockerignore` — список того, что **не нужно** включать в context. Синтаксис — как у `.gitignore`:

```
# .dockerignore
.git
.idea
.vscode
target/
node_modules/
*.log
.env*
docs/
README.md
Dockerfile        # сам Dockerfile тоже не нужен внутри context
.dockerignore     # и этот файл — тоже
```

Типичные ошибки:
- Не положили `.dockerignore` — context 2 GB, build тащит вечность.
- Не исключили `.env*` — секреты улетели в образ.
- Исключили `target/` (правильно для исходников), но в multi-stage используете `target/app.jar` — теперь и его не видно. Решение: для CI собирать jar и потом отдельным `Dockerfile` копировать готовый — или собирать прямо внутри multi-stage без зависимости от хостового `target/`.

### 4.3. Ключевые инструкции

```dockerfile
# Базовый образ — всегда указывай конкретный тег, не :latest
FROM eclipse-temurin:21-jre-alpine

# Рабочая директория
WORKDIR /app

# COPY предпочтительнее ADD (ADD умеет tar и URL — неявное поведение)
COPY target/app.jar app.jar

# Запуск от non-root пользователя
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Документирование порта (не публикует!)
EXPOSE 8080

# Проверка здоровья контейнера
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1

# ENTRYPOINT — что запускать (не переопределяется без --entrypoint)
# CMD — аргументы по умолчанию (переопределяются через docker run)
ENTRYPOINT ["java", "-jar", "app.jar"]
CMD []
```

| Инструкция | Назначение | Важное |
|-----------|-----------|--------|
| `FROM` | Базовый образ | Указывай конкретный тег |
| `COPY` | Копировать файлы | Предпочтительнее ADD |
| `ADD` | Копировать + распаковать tar | Только для tar/URL |
| `RUN` | Выполнить команду | Объединяй через `&&` |
| `ENV` | Переменная окружения | Видна в `docker inspect` |
| `ARG` | Переменная только во время build | Не попадает в runtime |
| `ENTRYPOINT` | Основной процесс | Exec-форма: `["java"]` |
| `CMD` | Аргументы для ENTRYPOINT | Переопределяется при запуске |
| `EXPOSE` | Документация порта | Не публикует! |

### 4.4. `:latest` — почему его нельзя использовать в production

Тег `:latest` — это просто метка, которая в каждый момент времени указывает на «последний загруженный» образ. Свежий push в registry — `:latest` тихо стал указывать на другой image digest.

Что это даёт на практике:
- **Pod на одной ноде получил один image, на другой — другой**. Поведение приложения зависит от того, в какую ноду попал scheduler — недетерминированно.
- **Rollback теряет смысл**: «откатиться к предыдущему `:latest`» — невозможно, потому что предыдущий уже не `:latest`.
- **Кэш по digest перестаёт работать**: Kubernetes по умолчанию pull policy для `:latest` — `Always`, что замедляет старт каждого пода.

Правильно: **пинить тег к immutable identifier**. Варианты:
- Semantic version: `myapp:1.7.3` (тоже может быть переписан, но соглашение обычно держится).
- Git SHA: `myapp:a3f7b91` — уникален навсегда.
- Image digest: `myapp@sha256:e8b9...` — криптографически прибит к конкретному содержимому. Если кто-то перепушит тег, digest не сменится. **Это единственный по-настоящему immutable способ**.

В Kubernetes Deployment рекомендуется указывать digest для критических deployments.

### 4.5. ENTRYPOINT vs CMD и проблема PID 1

`ENTRYPOINT` определяет, что именно запускается. `CMD` — аргументы по умолчанию. У каждой инструкции есть две формы:

```dockerfile
# Exec form (рекомендуется) — JSON-массив, exec syscall, без shell
ENTRYPOINT ["java", "-jar", "app.jar"]
CMD ["--spring.profiles.active=prod"]

# Shell form — запускается через /bin/sh -c "...", появляется лишний shell-процесс
ENTRYPOINT java -jar app.jar
```

Разница не косметическая. В shell-form ваше приложение запускается с PID 2, а PID 1 — это `sh`. И тут начинается **проблема PID 1**.

В Linux PID 1 — особенный процесс (`init`). Ядро обрабатывает его иначе остальных:
1. **Сигналы**: для всех остальных процессов несрегистрированный сигнал даёт дефолтное поведение (`SIGTERM` → die). Для PID 1 — ядро **игнорирует** несрегистрированные сигналы. Если ваш Java-процесс не повесил обработчик SIGTERM, `docker stop` пошлёт SIGTERM в PID 1, ничего не произойдёт, потом по таймауту (10 сек) полетит SIGKILL — процесс убит насильно, без graceful shutdown.
2. **Зомби-процессы**: когда дочерний процесс умирает, его entry в process table остаётся (zombie), пока родитель не вызовет `wait()`. По умолчанию это делает `init`. Если у вас PID 1 — Java-процесс без логики `wait()`, и приложение форкает что-то (например, `Runtime.exec`), зомби-процессы накапливаются.

Решения:
- **Exec-form ENTRYPOINT**: процесс получает PID 1 напрямую, без shell-обёртки. Это сделает корректную обработку сигналов **только если в самом приложении это правильно реализовано** (Spring Boot — да, многие Python-скрипты — нет).
- **`tini` или dumb-init** — крошечный init для контейнеров. `tini` становится PID 1, forwarded сигналы вашему приложению, reapper zombies:
  ```dockerfile
  RUN apk add --no-cache tini
  ENTRYPOINT ["/sbin/tini", "--", "java", "-jar", "app.jar"]
  ```
- **`docker run --init`** — Docker сам инжектит `tini` без правки Dockerfile.
- **В Kubernetes** этого недостаточно делать вручную — `shareProcessNamespace: true` в Pod spec позволяет sidecar-контейнерам видеть процессы основного, но это другой кейс.

Для Spring Boot, Node.js и большинства современных runtimes exec-form достаточен — они корректно регистрируют signal handlers. Но если вы видите, что `docker stop` молча убивает контейнер через 10 секунд вместо graceful shutdown за 1 секунду — это ровно эта проблема.

### 4.6. HEALTHCHECK подробнее

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:8080/actuator/health || exit 1
```

Параметры:
- `--interval` — как часто запускается команда (default: 30s).
- `--timeout` — после скольких секунд команда считается зависшей (default: 30s).
- `--start-period` — «grace period» при старте: failures в это окно не учитываются. Полезно для slow-starting приложений.
- `--retries` — сколько подряд failures должно быть, чтобы контейнер пометился `unhealthy` (default: 3).

Команда внутри `CMD` запускается в контейнере. **Должен существовать соответствующий бинарь** — в alpine-образах часто нет `curl`, есть `wget`. В distroless нет ни того, ни другого — нужен embedded healthcheck endpoint, который проверяется снаружи (Kubernetes `httpGet`).

Состояния:
- `starting` — в grace period.
- `healthy` — последняя проверка прошла.
- `unhealthy` — `retries` подряд failed.

Docker сам не перезапускает unhealthy контейнер — это делает orchestrator (Compose с `restart: always`, Swarm, K8s). HEALTHCHECK — это только сигнал.

В Kubernetes `HEALTHCHECK` из Dockerfile **не используется** — вместо него отдельные `livenessProbe` и `readinessProbe` (см. [KUBERNETES.md](KUBERNETES.md)).

### 4.7. BuildKit и современные возможности

С 2019 года Docker по умолчанию использует **BuildKit** — переписанный с нуля builder. Что он добавил:

- **Параллельная сборка независимых stage'ов** (раньше всё было последовательно).
- **Cache mount**: `RUN --mount=type=cache,target=/root/.m2 mvn package` — кэширует `~/.m2` между билдами, не попадая в финальный слой. Сильно ускоряет рекомпиляцию.
- **Secret mount**: `RUN --mount=type=secret,id=npm_token npm install` — секрет видим во время сборки, но не попадает в финальный образ.
- **SBOM (Software Bill of Materials)**: `docker buildx build --sbom=true` — генерирует список всех пакетов в образе. Нужно для compliance/security audit.

Включается через `DOCKER_BUILDKIT=1` или в Docker 23+ по умолчанию.

---

## 5. Multi-stage build

```dockerfile
# ===== Stage 1: build =====
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

# Сначала зависимости (кэшируются отдельно от кода)
COPY pom.xml .
RUN mvn dependency:go-offline -q

# Потом код
COPY src/ src/
RUN mvn package -q -DskipTests

# ===== Stage 2: runtime =====
FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app
USER app

# Только jar из первого stage — Maven, исходники, кэши не попадают в образ
COPY --from=build /workspace/target/*.jar app.jar

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -q -O- http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
```

```
Stage 1 (build): ~700 MB    Stage 2 (runtime): ~85 MB
  Maven 3.9                   JRE 21-alpine
  JDK 21                      app.jar
  .m2 cache                   ← только это
  src/
```

Почему это важно:

1. **Размер образа в 8 раз меньше** — быстрее pull, быстрее старт пода, меньше места в registry.
2. **Меньше attack surface** — нет компилятора, нет Maven, нет исходников. Если кто-то получит RCE, у него не будет инструментов для дальнейшей эксплуатации.
3. **Нет «прилипших» секретов** — если в build-stage был `--mount=type=secret`, в runtime-stage его уже нет.

Для Go-приложений финальный stage часто `FROM scratch` (пустой) или `FROM gcr.io/distroless/static` — там лежит только скомпилированный бинарник, ничего больше. Образ — 10–20 MB. Подробнее про distroless в §8.

### 5.1. Multi-arch images

До 2020 года почти весь production был на amd64. После выхода Apple Silicon (M1, ноябрь 2020) и роста AWS Graviton (ARM64-серверы, в 2–3 раза дешевле x86 у AWS), arm64 стал нормой и для разработчиков, и для прода. Соответственно, приложениям нужно собирать **под обе архитектуры одновременно**.

`docker buildx` (часть BuildKit) умеет это:

```bash
docker buildx create --use --name multibuilder
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/myorg/myapp:1.0 --push .
```

В registry попадает не один image, а **manifest list** — манифест, который говорит: «вот для amd64 такой digest, для arm64 — такой». Когда клиент с M1 делает `docker pull myapp:1.0`, registry отдаёт версию для arm64; с amd64-сервера — версию для amd64. Один тег, два бинаря.

Сборка для разных архитектур работает через `qemu-user-static` (эмуляция CPU) — медленно. На production-CI обычно делают параллельно два билда на нативных runners: arm64-build на arm64-машине, amd64-build на amd64-машине, и потом склеивают манифест:

```bash
docker buildx imagetools create -t myapp:1.0 myapp:1.0-amd64 myapp:1.0-arm64
```

Это снимает QEMU overhead и ускоряет CI в 5–10 раз для крупных образов.

---

## 6. Docker Networking

Когда контейнер стартует, Docker создаёт ему network namespace и подключает к одной из сетей. Изнутри namespace выглядит как отдельный хост: свой `eth0`, своя таблица маршрутизации, свой `lo`. Снаружи — Docker через `iptables` правила решает, какой трафик куда направлять.

### 6.1. Драйверы сетей

| Драйвер | Что делает | Когда использовать |
|---------|-----------|-------------------|
| `bridge` (default) | Виртуальный мост `docker0`, контейнеры в одной сети видят друг друга по IP и DNS | Обычные приложения на одном хосте |
| `host` | Контейнер использует сетевой стек хоста напрямую — нет изоляции портов | Тесты latency, монолиты, low-level networking |
| `none` | Никакой сети, только loopback | Полная сетевая изоляция, batch jobs |
| `overlay` | Многохостовая сеть через VXLAN | Docker Swarm, для K8s обычно не используется (K8s свой CNI) |
| `macvlan` / `ipvlan` | Контейнер получает MAC/IP напрямую на физическом интерфейсе хоста | Когда контейнер должен выглядеть как физический хост в L2 сети |

### 6.2. DNS внутри bridge сети

В custom bridge-сети Docker запускает встроенный **DNS resolver на 127.0.0.11** внутри каждого контейнера. Когда контейнер делает `lookup postgres`, запрос идёт на 127.0.0.11, который смотрит на список контейнеров в этой сети и возвращает IP контейнера с именем `postgres`.

В стандартном `bridge` (без явного создания) DNS не работает — есть только `--link`, что давно депрекейтнуто. Поэтому **всегда создавайте custom сети** для приложений из нескольких контейнеров, либо используйте Compose, который это делает автоматически.

```bash
docker network create mynet
docker run -d --name postgres --network mynet postgres:16
docker run -it --network mynet alpine ping postgres   # работает
```

### 6.3. Port mapping

`docker run -p 8080:80` означает «трафик на порт 8080 хоста перенаправляй на порт 80 контейнера». Под капотом — `iptables` правило в таблице `nat`:

```
host:8080 ─── DNAT (iptables) ─── container:80
```

Это работает только для входящего трафика. Контейнер исходящий трафик отправляет через NAT (`MASQUERADE`) — снаружи виден IP хоста.

```
┌──────────────────────────────────────────────┐
│              docker-compose network           │
│  ┌──────────┐  DNS: "app"   ┌──────────────┐ │
│  │   app    │◄────────────► │   postgres   │ │
│  │  :8080   │               │    :5432     │ │
│  └──────────┘               └──────────────┘ │
└──────────────────────────────────────────────┘
          │
       port mapping
          │
    host :8080 ─► app :8080
```

---

## 7. Volumes — данные, переживающие контейнер

В §3.4 уже было сказано: писать данные в writable layer контейнера — anti-pattern. Volumes — механизм для долгоживущих данных.

### 7.1. Три типа volumes

| Тип | Команда | Где живёт | Когда использовать |
|-----|---------|-----------|-------------------|
| **bind mount** | `-v /host/path:/container/path` | Конкретный путь на хосте | Локальная разработка (live reload кода) |
| **named volume** | `-v mydata:/container/path` | `/var/lib/docker/volumes/mydata/_data/` (управляется Docker) | Production-данные (БД, файлы загрузок) |
| **tmpfs** | `--tmpfs /container/path` | RAM, не на диске | Чувствительные данные (токены), временные кэши |

#### Bind mount

```bash
docker run -v $(pwd)/src:/app/src node:20 npm run dev
```

Хост-директория `./src` напрямую видна внутри контейнера. Изменения на хосте — сразу видны в контейнере, и наоборот. Удобно для разработки, но в production создаёт сильную связь между хостом и контейнером — нарушается главное преимущество контейнеров (переносимость).

#### Named volume

```bash
docker run -v pgdata:/var/lib/postgresql/data postgres:16
docker volume ls    # видит pgdata
docker volume inspect pgdata    # видит точный путь
```

Docker сам решает, где физически хранить. Volume переживает удаление контейнера: можно остановить, пересоздать, и БД будет на месте. Это **дефолт для production**.

#### tmpfs

```bash
docker run --tmpfs /tmp:size=64m,mode=1777 alpine
```

В RAM. Когда контейнер останавливается — данные исчезают. Идеально для:
- Кэшей, которые можно пересоздать.
- Секретов, которые не должны попадать на диск.
- Тестов, не желающих оставлять артефактов.

### 7.2. Anti-pattern: запись в writable layer для production

Типичная ошибка новичка:

```dockerfile
FROM postgres:16
# pgdata лежит в /var/lib/postgresql/data — внутри writable layer контейнера
```

Если запустить и положить туда данные, то при `docker rm` они **полностью исчезнут**. Каждый раз пересоздавая контейнер (например, при обновлении версии Postgres), вы теряете базу.

Правильный подход — официальные образы баз данных всегда монтируют volume:

```bash
docker run -d \
  --name postgres \
  -v pgdata:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=secret \
  postgres:16
```

---

## 8. Безопасность контейнеров

«Контейнеры безопасны по умолчанию» — миф. Контейнер делит ядро с хостом, и большинство опций — это **снижение** прав, а не «безопасность из коробки».

### 8.1. Non-root user

По умолчанию процессы внутри контейнера запускаются от `root` (UID 0). Это **root в namespace контейнера**, но при типичной конфигурации (без user namespace) это **тот же UID 0, что и root на хосте**. Если внутри контейнера случается RCE и злоумышленник пробьёт container escape — у него root на хосте.

```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
```

После `USER app` процесс работает от непривилегированного пользователя. Большая часть атак на ядро требует root внутри namespace.

### 8.2. Capabilities — fine-grained privileges

Linux давно разделил «root-привилегии» на ~40 **capabilities**: `CAP_NET_BIND_SERVICE` (биндить порты < 1024), `CAP_SYS_ADMIN` (почти всё, что может root), `CAP_NET_ADMIN` (управлять сетью) и т. д.

Docker по умолчанию даёт контейнеру **подмножество** capabilities (`chown`, `dac_override`, `kill`, `setuid`, `setgid`, `net_bind_service` и ещё ~10). Лучшая практика — **выключить всё и явно включить нужное**:

```bash
docker run --cap-drop=ALL --cap-add=NET_BIND_SERVICE myapp
```

В Kubernetes:

```yaml
securityContext:
  capabilities:
    drop: ["ALL"]
    add:  ["NET_BIND_SERVICE"]
```

### 8.3. Read-only filesystem

`docker run --read-only` запрещает запись в файловую систему. Если приложению нужно писать только в один временный каталог:

```bash
docker run --read-only --tmpfs /tmp myapp
```

Это сильно ограничивает действия атакующего после RCE: ему нечего изменить на диске, нечем persistir backdoor.

### 8.4. seccomp и AppArmor / SELinux

`seccomp` — фильтр системных вызовов. У Docker есть дефолтный профиль, блокирующий ~50 опасных syscalls (`reboot`, `kexec_load`, и др.). Можно затянуть сильнее, разрешив только нужные приложению вызовы.

AppArmor (Ubuntu, Debian) и SELinux (RHEL, Fedora) — MAC-системы, ограничивающие доступ к файлам и операциям независимо от Unix-прав.

### 8.5. Distroless и FROM scratch

«Distroless» (от Google) — образы, содержащие **только runtime и сертификаты**. Никакого shell, package manager, утилит. Пример: `gcr.io/distroless/java21-debian12` — это JRE 21 и больше ничего. Размер — 100–150 MB вместо 400–500 MB у `eclipse-temurin:21`.

Плюсы:
- Минимальный attack surface — нечем pivot'ить после RCE.
- Меньше CVE — нечему быть уязвимым.
- Меньше размер.

Минусы:
- **Нельзя зайти в контейнер `docker exec sh`** — нет shell. Отладка сложнее.
- **Нельзя установить ничего на лету** — нет apt/apk.

Дальше — `FROM scratch`: вообще пустой базовый образ, в нём только то, что вы скопировали через `COPY`. Используется для Go-бинарников: статически слинкованный бинарь — единственное содержимое, образ ~10 MB.

### 8.6. Docker socket — самый частый источник escape

Многие CI/CD инструменты (Jenkins, Drone) рекомендуют пробрасывать сокет Docker внутрь контейнера:

```bash
docker run -v /var/run/docker.sock:/var/run/docker.sock ci-runner
```

Это **эквивалентно даче root-прав на хосте**. Внутри контейнера можно сделать:

```bash
docker run --privileged --pid=host -v /:/host ubuntu chroot /host bash
```

И вы оказались в root-shell хоста. Поэтому:
- **Никогда не пробрасывайте `/var/run/docker.sock` в контейнер, доступный наружу** (например, в production-приложение).
- В CI используйте **rootless Docker** или **buildah/kaniko** — они не требуют privileged daemon.

### 8.7. Battle story: CVE-2019-5736 — runc breakout

В феврале 2019 была опубликована CVE-2019-5736 — уязвимость в **runc** (low-level runtime, используемый Docker, containerd, CRI-O, podman). Если внутри контейнера запускался привилегированный процесс, и злоумышленник имел доступ к этому процессу, он мог перезаписать **исполняемый файл runc на хосте**. При следующем запуске любого контейнера на хосте — выполнялся код атакующего, от root.

Trigger:
1. Контейнер запущен от root (типичный дефолт).
2. Атакующий — внутри контейнера.
3. Атакующий открывает `/proc/self/exe` (= runc на хосте) для записи через хитрый трюк с file descriptors.
4. Перезаписывает.
5. На следующий `docker exec` или старт нового контейнера — выполняется malicious runc.

Что бы спасло: **non-root user в контейнере**. Атакующий не смог бы получить запись в `/proc/self/exe`.

Это конкретная причина, почему `USER appuser` — не косметика, а реальный security boundary. И почему практика «не запускать от root» — не паранойя.

---

## 9. Registry — где живут образы

Образы хранятся в **registry** — серверах, поддерживающих OCI Distribution API.

| Registry | Кто хостит | Особенности |
|----------|-----------|-------------|
| Docker Hub | Docker Inc. | Самый большой, rate-limit для анонимов (100 pull/6h на IP) |
| GitHub Container Registry (`ghcr.io`) | GitHub | Бесплатный для public, легко интегрируется с Actions |
| AWS ECR | AWS | IAM-интеграция, есть public ECR |
| Google Artifact Registry | GCP | Удобно с GKE |
| Quay.io | Red Hat | Image scanning, robot accounts |
| Self-hosted (Harbor, Nexus) | Вы | Полный контроль, проксирование апстрима |

### 9.1. Pull / push цикл

```bash
docker login ghcr.io
docker tag myapp:1.0 ghcr.io/myorg/myapp:1.0
docker push ghcr.io/myorg/myapp:1.0

# На production
docker pull ghcr.io/myorg/myapp:1.0
```

При push отправляются **только новые слои**, существующие skipped. Это критично для скорости CI/CD: после первого push нового тег'а — это секунды, даже если образ 500 MB.

### 9.2. Pull-through cache / mirror

В production-среде с десятками нод и тысячами pull'ов в день полезен **локальный proxy-registry**: Harbor или sonatype Nexus, который кэширует public registry. Первый pull тянет извне, следующие — из локального кэша. Это:
- Снимает зависимость от внешнего registry (что если Docker Hub лежит).
- Экономит egress traffic.
- Ускоряет деплои.

### 9.3. Content trust — подпись образов

Можно ли быть уверенным, что `myapp:1.0` в registry — тот же образ, который вы туда положили? По умолчанию — нет. У registry может быть скомпрометированный admin, или сам registry может подменить образ.

Решения:
- **Docker Content Trust (Notary)** — старая система подписи; сейчас deprecated в пользу Sigstore.
- **Sigstore / Cosign** — современная open-source инфраструктура подписи. `cosign sign $IMAGE` подписывает образ ключом, `cosign verify` проверяет.
- **Kubernetes admission control**: с помощью Kyverno или OPA Gatekeeper можно требовать, чтобы все Pods запускались только из подписанных образов.

---

## 10. Docker Compose

Compose — инструмент описания **многоконтейнерного приложения** одним YAML-файлом. Стандартный сценарий: «backend + БД + Redis для локальной разработки». Не предназначен для production — для этого Kubernetes.

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"          # host:container
    environment:
      - DB_URL=jdbc:postgresql://postgres:5432/mydb
    depends_on:
      postgres:
        condition: service_healthy  # ждёт HEALTHCHECK, не просто старта
    networks:
      - backend

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data  # named volume — персистентность
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - backend

volumes:
  pgdata:          # Docker управляет хранением

networks:
  backend:         # изолированная сеть
```

### 10.1. `depends_on` и его подводный камень

Без `condition: service_healthy` `depends_on` означает только «запусти postgres раньше app». Но «запустился» ≠ «принимает соединения»: между fork postgres-процесса и моментом, когда он реально начнёт слушать порт 5432, проходит 1–5 секунд. За это время app стартует, не достучится до postgres, упадёт.

С `condition: service_healthy` Compose ждёт, пока HEALTHCHECK postgres вернёт success подряд несколько раз — только тогда стартует app.

### 10.2. Profiles

Compose v2 поддерживает `profiles` — выборочный запуск сервисов:

```yaml
services:
  app: { ... }
  test-runner:
    image: myapp-tests
    profiles: ["test"]   # запускается только при --profile test
```

`docker compose up` запускает только сервисы без профиля. `docker compose --profile test up` запускает их + те, что в профиле `test`. Удобно для опциональных сервисов: e2e-тесты, debug-инструменты, фоновые воркеры.

### 10.3. Resource limits

В Compose v3+ можно ограничивать CPU/memory:

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
```

Это удобно при локальном «симулировании» того, что приложение получит в Kubernetes.

---

## 11. Архитектура: docker CLI, dockerd, containerd, runc

Когда вы пишете `docker run ...`, под капотом происходит цепочка из четырёх уровней:

```
docker CLI  ──HTTP/Unix-socket──►  dockerd  ──gRPC──►  containerd  ──exec──►  runc  ──namespaces+cgroups──►  процесс
(client)                          (daemon,        (high-level         (low-level
                                   build,           runtime,            runtime,
                                   network,         image pulls,        OCI spec)
                                   compose)         containers)
```

- **`docker` (CLI)** — то, что вы набираете в терминале. Это просто HTTP-клиент.
- **`dockerd` (Docker daemon)** — сервис, слушающий на `/var/run/docker.sock`. Делает «всё»: парсит Dockerfile, билдит образы, управляет сетями и volumes, общается с registry, дёргает containerd для запуска. Запускается под root.
- **`containerd`** — high-level runtime: pulls образы, управляет lifecycle контейнеров, gRPC API. Создан в Docker, передан в CNCF в 2017.
- **`runc`** — low-level runtime, реализующий OCI Runtime Specification. Получает спецификацию (JSON с командой, namespaces, mounts, cgroups), запускает процесс с правильным окружением. Это ровно та компонента, в которой случилось CVE-2019-5736 (§8.7).

### 11.1. Почему Kubernetes 1.24 «удалил Docker»

В 2020 году Kubernetes объявил deprecation Docker как container runtime, и в 1.24 (май 2022) убрал поддержку. Часто это понимают как «Kubernetes больше не работает с Docker» — это неверно.

Изначально kubelet общался с Docker через специальный shim — компонент-переводчик с Kubernetes CRI (Container Runtime Interface) на Docker API. Этот shim жил в самом Kubernetes, его называли `dockershim`. Он мешал по двум причинам:

1. Docker не реализует CRI напрямую. Шим — лишний layer, source бажности.
2. Сам Docker делает кучу того, что Kubernetes не нужно (сборка образов, networking через iptables, Compose). Все эти возможности на production-нодах не используются, но процесс жрёт ресурсы и расширяет attack surface.

Под Docker уже давно лежит containerd. У containerd есть **нативный CRI plugin**. Kubernetes теперь общается прямо с containerd, без шима. Это:
- Меньше слоёв = меньше bug surface.
- Меньше ресурсов на ноде.
- Меньше attack surface.

**Что это значит для разработчика**: ровно ничего. Образы Docker — это образы OCI; они работают в containerd, podman, и где угодно. `Dockerfile` тоже не привязан к Docker — `buildkit`, `kaniko`, `buildah` все умеют его читать. Менять что-то в коде или в Dockerfile не нужно.

### 11.2. Rootless Docker и Podman

`dockerd` запускается от root. Этого хватает для compromise хоста, если кто-то получит RCE в daemon. Альтернативы:

- **Rootless Docker** (с 2019) — `dockerd` под обычным пользователем. Использует user namespaces, slirp4netns для сети. Работает, но с ограничениями: нельзя биндить порты < 1024 (без CAP_NET_BIND_SERVICE), некоторые storage drivers недоступны.
- **Podman** (Red Hat) — daemonless container engine. Каждая команда `podman run` напрямую запускает контейнер без долгоживущего демона. Совместим с Docker CLI: `alias docker=podman` обычно работает. По умолчанию rootless.
- **Buildah** — только сборка (без runtime), pair'ится с Podman для CI/CD.
- **Kaniko** (Google) — сборка образов **внутри контейнера без daemon и без root**. Идеально для CI в Kubernetes: один Pod билдит образ, не требуя privileged.

Для production-серверов Podman + Buildah — реальная замена Docker. В CI Kaniko снимает headache с пробросом docker.sock внутрь builder-контейнера (см. §8.6).

---

## 12. Антипаттерны

| Антипаттерн | Проблема | Как правильно |
|-------------|----------|---------------|
| `FROM ubuntu:latest` | Нестабильный тег, огромный образ | Конкретный тег, alpine/distroless, или digest |
| Запуск от root | Container escape → root на хосте (CVE-2019-5736) | `USER appuser` |
| `ADD` вместо `COPY` | Неявное поведение (tar, URL) | `COPY` по умолчанию |
| Один `RUN` на команду | Много слоёв, большой образ, мусор в кэше | Объединять через `&&`, чистить `rm -rf /var/lib/apt/lists/*` в том же RUN |
| `COPY . .` до зависимостей | Инвалидирует кэш при любом изменении кода | Сначала `pom.xml` + deps |
| Нет HEALTHCHECK | `depends_on` не знает о готовности, K8s не видит unhealthy | Добавить HEALTHCHECK |
| Секреты через `ENV` | Видны в `docker inspect` и в слоях | `--mount=type=secret` в BuildKit, runtime env через secret manager |
| `RUN curl ... > /etc/something` без проверки | MITM в build → backdoor | Pin checksums, или `COPY` после ручного скачивания + проверки |
| Pull `:latest` в Kubernetes | Недетерминированный deploy | Pin к digest |
| Запись персистентных данных в writable layer | Теряются при `docker rm` | Named volume |
| Pробрасывание `/var/run/docker.sock` | Root на хосте | Rootless Docker, buildah, kaniko |
| Запуск однопроцессных приложений с PID 1 (без init) | Сигналы SIGTERM теряются, зомби-процессы | `tini` (`--init` флаг у docker) или ENTRYPOINT exec-форма |

---

## Источники

**Официальная документация / стандарты:**
- [Docker Documentation](https://docs.docker.com/) — Dockerfile reference, Compose, networking, storage.
- [OCI Image Specification](https://github.com/opencontainers/image-spec) — открытый стандарт формата образов (его реализуют Docker, containerd, podman).
- [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec) — как именно запускается контейнер.
- [Dockerfile best practices (Docker Docs)](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)

**Books:**
- *Docker in Action*, 2nd ed. (Jeff Nickoloff, Stephen Kuenzli, Manning 2019).
- *The Docker Book* (James Turnbull, 2014) — основа, до сих пор актуальная по концепциям.

**Talks / posts:**
- [Liz Rice — «What is a container, really?» (KubeCon)](https://www.youtube.com/watch?v=8fi7uSYlOdc) — namespaces + cgroups «руками».
- [Jérôme Petazzoni — «Container internals: namespaces and cgroups»](https://jpetazzo.github.io/2014/03/23/lxc-attach-nsinit-nsenter-docker-0-9/) — каноническая работа от инженера Docker.
- [Google — Distroless images](https://github.com/GoogleContainerTools/distroless) — почему минимальный attack surface важен.
- [«Use multi-stage builds» (Docker blog)](https://docs.docker.com/build/building/multi-stage/)

**Security:**
- [CVE-2019-5736 — runc breakout](https://nvd.nist.gov/vuln/detail/CVE-2019-5736) — почему non-root user в контейнере не косметика.
- [Snyk — «10 Docker image security best practices»](https://snyk.io/blog/10-docker-image-security-best-practices/)
