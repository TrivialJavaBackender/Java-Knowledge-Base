# Docker

---

## 1. Контейнеры vs виртуальные машины

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

Контейнер — изолированный процесс на хосте, использующий namespace (изоляция PID, network, mount) и cgroups (ограничение CPU, memory). Гостевой ОС нет — контейнеры делят ядро хоста.

**Ключевое:** контейнер = процесс + изоляция. Если процесс умирает — контейнер останавливается.

---

## 2. Образы и слои

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
1. Базовый образ
2. Системные зависимости
3. Зависимости приложения (pom.xml)
4. Исходный код

---

## 3. Dockerfile — ключевые инструкции

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

---

## 4. Multi-stage build

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
Stage 1 (build): ~500 MB    Stage 2 (runtime): ~85 MB
  Maven 3.9                   JRE 21-alpine
  JDK 21                      app.jar
  .m2 cache                   ← только это
  src/
```

---

## 5. Docker Networking

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

Типы сетей:
- **bridge** (default) — изолированная сеть на хосте, контейнеры видят друг друга по имени
- **host** — контейнер использует сеть хоста напрямую (нет изоляции портов)
- **none** — полная сетевая изоляция

В docker-compose контейнеры в одной сети обращаются друг к другу по **имени сервиса** как по DNS:
`postgres:5432`, `redis:6379` — работает автоматически.

---

## 6. Docker Compose

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

---

## 7. Антипаттерны

| Антипаттерн | Проблема | Как правильно |
|-------------|----------|---------------|
| `FROM ubuntu:latest` | Нестабильный тег, огромный образ | Конкретный тег, alpine/distroless |
| Запуск от root | Security risk | `USER appuser` |
| `ADD` вместо `COPY` | Неявное поведение | `COPY` по умолчанию |
| Один `RUN` на команду | Много слоёв, большой образ | Объединять через `&&` |
| `.` в `COPY . .` до зависимостей | Инвалидирует кэш при любом изменении кода | Сначала pom.xml + deps |
| Нет HEALTHCHECK | `depends_on` не знает о готовности | Добавить HEALTHCHECK |
| Секреты через `ENV` | Видны в `docker inspect` и слоях | `--secret` или runtime env |

---

## Вопросы для собеседования

### Q1: Чем контейнер отличается от VM?
**A:** VM эмулирует полное железо и запускает гостевую ОС (GBs памяти, минуты старта). Контейнер — изолированный процесс на хостовом ядре через namespace и cgroups (MBs памяти, секунды старта). Контейнеры не полностью изолированы: если процесс падает — контейнер останавливается, уязвимость ядра может затронуть все контейнеры.

### Q2: Что произойдёт, если изменить строку 10 в исходном коде и пересобрать образ?
**A:** Инвалидируются все слои начиная с того, который копирует исходный код (`COPY src/ src/`). Если до него идут `COPY pom.xml` и `RUN mvn dependency:go-offline` — зависимости возьмутся из кэша. Именно поэтому важен порядок: pom.xml отдельно перед src/.

### Q3: В чём разница между `ENTRYPOINT` и `CMD`?
**A:** `ENTRYPOINT` — основной исполняемый процесс, не переопределяется через `docker run <args>` (только через `--entrypoint`). `CMD` — аргументы по умолчанию, полностью заменяются при `docker run image <new-args>`. Exec-форма `["java", "-jar"]` предпочтительнее shell-формы: процесс получает PID 1 и правильно обрабатывает сигналы.

### Q4: Почему `depends_on` не гарантирует готовность сервиса?
**A:** По умолчанию `depends_on` лишь гарантирует порядок старта контейнеров — postgres стартует раньше app. Но приложение может начать принимать соединения спустя секунды после старта контейнера. Решение: `depends_on: postgres: condition: service_healthy` — compose ждёт пока `HEALTHCHECK` postgres не вернёт success.

### Q5: Что такое .dockerignore и зачем он нужен?
**A:** `.dockerignore` исключает файлы из build context, который Docker daemon получает перед сборкой. Без него в контекст попадают `target/`, `.git/`, IDE-файлы — это замедляет передачу и может случайно попасть в образ через `COPY . .`. Типичное содержимое: `target/`, `.git`, `*.md`, `.idea/`.

### Q6: Когда использовать именованный volume, а когда bind mount?
**A:** Bind mount (`-v /host/path:/container/path`) удобен в разработке — изменения файлов видны в контейнере мгновенно без rebuild. Named volume (`-v mydata:/data`) для production данных: не зависит от структуры хоста, управляется Docker, переносим. Для базы данных всегда named volume.

### Q7: Как уменьшить размер Docker образа?
**A:** Multi-stage build (убрать build-инструменты из runtime), alpine/distroless базовый образ, объединить RUN-команды через `&&` (меньше слоёв), `.dockerignore` для исключения ненужных файлов, `--no-cache` для apt, удалять временные файлы в том же RUN где создаются.

### Q8: Что такое distroless образ?
**A:** Образы от Google, содержащие только runtime без shell, package manager, лишних утилит. `gcr.io/distroless/java21` содержит только JRE. Преимущества: меньше размер, минимальный attack surface (нет shell = нет возможности зайти в контейнер интерактивно). Недостаток: сложнее отлаживать.

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
