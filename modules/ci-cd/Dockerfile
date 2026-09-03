# syntax=docker/dockerfile:1.7
#
# Образ сервиса payments — сквозной пример модуля ci-cd.
# Разбор того, почему он устроен именно так: theory/IMAGE_BUILD_AND_REGISTRY.md.

# ---------- этап 1: сборка ----------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src

# Зависимости отдельным слоем: pom.xml меняется реже исходников, поэтому
# слой с зависимостями переиспользуется, пока не тронут pom.
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp dependency:go-offline

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp package -DskipTests

# ---------- этап 2: разбор jar на слои ----------
# Один fat jar — один слой образа: правка одной строки кода заставляет реестр
# принимать заново все 40 МБ зависимостей. Разбор на слои чинит именно это.
FROM eclipse-temurin:21-jre-alpine AS extract
WORKDIR /app
COPY --from=build /src/target/*.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --launcher --destination extracted

# ---------- этап 3: то, что поедет в реестр ----------
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Непривилегированный пользователь: контейнер, работающий под root, отдаёт
# ядру хоста больше, чем нужно приложению.
RUN addgroup -S app && adduser -S -G app app

# Порядок COPY = порядок слоёв. Сначала то, что меняется редко.
COPY --from=extract --chown=app:app /app/extracted/dependencies/ ./
COPY --from=extract --chown=app:app /app/extracted/spring-boot-loader/ ./
COPY --from=extract --chown=app:app /app/extracted/snapshot-dependencies/ ./
COPY --from=extract --chown=app:app /app/extracted/application/ ./

USER app
EXPOSE 8080

# Дайджест образа приезжает как переменная окружения на этапе раскатки:
# сам образ не знает, в каком окружении он запущен, — это и есть
# «конфигурация отдельно от артефакта».
ENV PAYMENTS_ENVIRONMENT=local \
    PAYMENTS_BUILD_DIGEST=unknown

# После разбора на слои единого app.jar в образе НЕТ — есть распакованное дерево
# (BOOT-INF/, META-INF/, org/), поэтому `java -jar app.jar` здесь не работает.
# Запускается launcher, имя которого берётся из Main-Class манифеста.
# В Spring Boot 3.2+ он переехал в пакет ...loader.launch (раньше был ...loader).
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
