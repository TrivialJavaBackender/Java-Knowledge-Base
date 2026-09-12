# Образ и реестр: как конвейер собирает контейнер и чем адресует результат

> **Какую проблему решает.** Артефакт между `mvn package` и работающим подом надо изготовить, не открыв заданию дверь на хост, и назвать так, чтобы имя не переставало значить то же самое.
> **Кому это надо.** Тому, кто пишет `Dockerfile` сервиса и шаг сборки образа в конвейере.
> **Когда НЕ надо.** Если `Dockerfile` начинается с `COPY . .`, кэшировать нечего: сначала порядок слоёв, потом их кэширование.

Соседнее: слой и реестр — [`DOCKER.md` §3, §9](../../infrastructure/theory/DOCKER.md), эфемерность — [`PIPELINE_MODEL.md` §5](PIPELINE_MODEL.md), кэш — [`RUNNERS_AND_EXECUTION.md` §4](RUNNERS_AND_EXECUTION.md), продвижение — [`ENVIRONMENTS_AND_PROMOTION.md` §1](ENVIRONMENTS_AND_PROMOTION.md).

---

## 1. Почему `docker build` внутри контейнера конвейера — проблема

На управляемом исполнителе `docker buildx build --push` работает без настройки: задание идёт прямо на
машине с демоном. На исполнителе контейнерного типа тот же шаг падает с `Cannot connect to the Docker
daemon`, и `docker-cli` не помогает: `docker` — клиент, а собирает демон. Способов два — DinD или сокет
хоста, — и платят они одним: «when you share the Docker daemon, you effectively disable the container's
security mechanisms and expose your host to privilege escalation», а DinD требует «`privileged` mode»
(GitLab docs).

Дело в конструкции: у API демона нет модели прав, и клиент, дотянувшийся до него, «can start a
container where the `/host` directory is the `/` directory on your host… and alter your host
filesystem without any restriction», а сам демон работает с правами root (Docker docs).
Отсюда: **доступ к демону Docker эквивалентен root на машине, где этот демон работает**; сокет отдаёт
хост, DinD — контейнер сборщика с привилегиями, вдобавок качающий базовые слои с пустого хранилища.
Нормально это при трёх условиях: код доверенный, машина эфемерна, чужого на ней нет.

## 2. Kaniko, Buildah, BuildKit — три разных ответа

Только два из трёх про отсутствие демона. *BuildKit демон не убирает* — это движок сборки Docker
(«BuildKit is the builder backend used by Docker»), отвечающий на вопрос «как собирать быстро»:
параллелит независимые этапы, пропускает ненужные, передаёт только изменившиеся файлы контекста; сам
сборщик может жить отдельным контейнером со своим сетевым пространством имён (§3). *Kaniko убирает
демон целиком:* он «doesn't depend on a Docker daemon and executes each command within a Dockerfile
completely in userspace», привилегий не нужно, запускается обычным подом. *Buildah убирает и демон, и
`Dockerfile`:* слои создаются командами скрипта, но кэшируемость декларативного описания становится
вашей заботой. Безопасной недоверенную сборку не делает ни один: «kaniko by itself **does not** make it
safe to run untrusted builds».

| Что должно быть правдой | Что из этого следует |
|---|---|
| Демон есть, он ваш, машина одноразовая | `docker buildx` (то есть BuildKit) |
| Демона нет: сборка идёт подом в кластере | Kaniko |
| Образ собирается скриптом, не из `Dockerfile` | Buildah |
| Демон есть, но **чужой** — общий на несколько команд | ни один не спасает: проблема в §1 |

## 3. Кэш слоёв, который не переживает исполнителя

Полная сборка образа без кэша — **95,66 с** (Apple Silicon, macOS 15, Docker 29.4.3, buildx v0.33.0;
не бенчмарк). Кэш слоёв лежит в файловой системе сборщика, а исполнитель эфемерен: вместе с машиной
уходит кэш, и каждая сборка первая (то же состояние даёт `docker buildx prune -af` — освободил
1,438 ГБ). Значит, кэш должен лежать в реестре: «it can efficiently cache multi-stage builds in `max`
mode, instead of only the final stage» (Docker docs) — без `mode=max` сохранится только последний этап,
самый дешёвый.

| Сборка | Реальное время | Шагов взято из кэша |
|---|---|---|
| `--cache-from type=registry` после полной очистки | **3,74 с** | **13** |
| без кэша вовсе | **95,66 с** | 0 |

Отношение ≈ 26×. **Ловушка дороже замера:** сборщик создан обычным способом
(`--driver docker-container`), кэш направлен в `registry:2` на хосте, команда отработала 251 секунду и
вышла **с кодом 0** — а реестр пуст:

```
$ curl -s http://localhost:5001/v2/payments/tags/list
{"errors":[{"code":"NAME_UNKNOWN","message":"repository name not known to registry", …}]}
```

Сборщик живёт в отдельном контейнере, и `localhost:5001` внутри означает его самого (лечится
`--driver-opt network=host`). **Второй урок: `--cache-to`, не записавший кэш, не роняет сборку** — кэш
не входит в результат, поэтому отказ неотличим от «кэш не окупается»: смотреть надо не на код
возврата, а на тег кэша в реестре.

## 4. Layered jar, Jib, buildpacks: что экономит каждый

`COPY target/*.jar app.jar` кладёт 40 МБ классов и зависимостей одним слоем, а слой адресуется
дайджестом содержимого: правка одной строки кода делает jar другим файлом целиком, то есть другим слоем
целиком — реестр принимает 40 МБ заново, и каждый узел кластера заново их скачивает. «This layering is
designed to separate code based on how likely it is to change between application builds» (Spring Boot
docs): `extract --layers` раскладывает jar на `dependencies`, `spring-boot-loader`,
`snapshot-dependencies`, `application`, и копируются они отдельными `COPY` по возрастанию изменчивости,
потому что слой инвалидирует все слои выше себя. Времени сборки в этой цене нет — дороже доставка.

**Побочный эффект, стоивший красной сборки:** с `--launcher` `application.jar` нет вовсе, есть дерево
`BOOT-INF/`, `META-INF/`, `org/`, и образ падал с `non-zero exit (1)` во всех репликах, пока точку
входа не взяли из манифеста:

```
$ grep -a "Main-Class" /app/META-INF/MANIFEST.MF
Main-Class: org.springframework.boot.loader.launch.JarLauncher
```

| Что должно быть правдой | Что из этого следует |
|---|---|
| Нужен контроль над базовым образом, пользователем, точкой входа | `Dockerfile` + `extract --layers` |
| Демона нет, лишнего файла в репозитории не хочется | Jib: «builds… images without a Docker daemon», раскладывая зависимости и классы по слоям |
| Единый способ на десяток сервисов | buildpacks, но образ уезжает «into your locally running Docker daemon» |

## 5. Тег против дайджеста

Тот же тег до и после пересборки того же дерева исходников указывает на разное содержимое, и **никакой
ошибки при этом не возникает** — это штатное поведение, ради которого теги придуманы.

```
$ docker buildx imagetools inspect localhost:5001/payments:v1
Digest:    sha256:25a00689dd771dfcbdaaa524ab9739c6ebbcbb5a4c4ac179c4ee030a2e5bb52b
# … пересборка и push под тем же тегом …
Digest:    sha256:81fc786d34ef4d8957ce99f13ac108aa8692ead54a4a151e39e7e74b57bab132
```

Манифест адресуется тегом или дайджестом, но связь «имя → содержимое» берётся из разных мест: тег —
запись в реестре, меняемая операцией `push`; дайджест — «a unique identifier created from a
cryptographic hash of a Blob's content», который «one can verify… by recalculating the digest
independently» (OCI Image Spec). **Тег можно переставить, потому что он
хранится; дайджест — нет, потому что он вычисляется.**

Отсюда следствия. «Тот же тег» не значит «тот же образ»: «you might end up with a mix of Pods running
the old and new code» — расходятся отдельные поды, стартовавшие до перестановки и после, а
`IfNotPresent` это усиливает («the image is pulled only if it is not already present locally»,
Kubernetes docs). Откат по тегу — не откат: «вернём `v1.2.3`» имеет смысл, только если это те же байты;
`latest`, `dev`, `staging`, `stable` — один и тот же случай. Поэтому вниз по графу задание отдаёт
дайджест: **тег для людей, дайджест для машин.** Происхождения он не доказывает: образ, подложенный
тем, у кого есть право `push`, имеет такой же честный дайджест
([`SUPPLY_CHAIN_SECURITY.md` §9](SUPPLY_CHAIN_SECURITY.md)).

## 6. Аутентификация конвейера в реестре

`docker login` с паролем из переменной работает с первой попытки, но пароль **долгоживущий**,
**широкий** (у учётной записи людей права на весь реестр) и **доступный любому заданию**, умеющему
читать секреты. Способы отличаются тем, сколько живёт учётная запись: robot-аккаунт с правом `push` в
один репозиторий сужает радиус поражения, но секрет долгоживущий; токен платформы умирает вместе с
запуском, и «the token's permissions are limited to the repository that contains your workflow» (GitHub
docs); федерация меняет короткоживущий подписанный токен на временные учётные данные облака
([`SUPPLY_CHAIN_SECURITY.md` §2](SUPPLY_CHAIN_SECURITY.md)). **Про
вторую учётную запись забывают:** `push` делает конвейер, `pull` — кластер, и общая учётка превращает
компрометацию узла в право переписать образ.

## 7. Хранение и сборка мусора в реестре

Двадцать слияний в день — пять тысяч образов за год, и «удалим старые теги» места не освобождает:
удаление манифеста снимает ссылку, а освобождает отдельный проход — «in the "mark" phase, the process
scans all the manifests… in the "sweep" phase… if a blob's content address digest is not in the mark
set, the process deletes it», причём «as long as a layer is referenced by one manifest, it cannot be
garbage collected», а реестр на время прохода должен быть «in read-only mode» (Docker Registry docs).
Отсюда: удаление одного образа освобождает почти ничего (базовый образ и слой `dependencies` общие для
всех сборок — уходит верхний слой с классами, единицы мегабайт из сорока), а сборка мусора —
операционное окно: образ, появившийся после снимка манифестов, будет признан мусором.

Удержание описывается критерием «что оставить», и «retention is matched at the tag level but retention
/ deletion is carried out at the artifact level» (Harbor docs): правило пишут про теги, а удаляется
артефакт со всеми своими тегами — образ, оставленный как `v1.4.0`, исчезнет, если критерий смотрел на
`dev`. Критерии «последние N сборок» считают от ветки, а не от того, что в проде, и откат упирается в
«manifest unknown». **Правило:** удержание проектируется от политики отката; растёт реестр не от числа
сборок, а от числа **разных** слоёв.

## 8. Образы под несколько архитектур

`--platform linux/amd64,linux/arm64` даёт не два образа, а один составной: «multi-platform images
contain a manifest list, pointing to multiple manifests». Ломается это об исполнителя: архитектура у
него одна, остальное идёт через эмуляцию, а «emulation with QEMU can be much slower than native builds,
especially for compute-heavy tasks like compilation and compression» (Docker docs) — ровно на этапах
Maven и распаковки jar.

Выбор из трёх стратегий (QEMU, нативные узлы, кросс-компиляция) определяется одним вопросом: **что в
вашей сборке зависит от целевой архитектуры.** Для Java — почти ничего: байткод нейтрален по
определению формата, и зависит только базовый образ с JRE.
Компилировать надо один раз, нативно: `FROM --platform=$BUILDPLATFORM` «is pinned to the native
platform of the builder… to prevent emulation from kicking in», и под эмуляцию уходит финальный этап,
копирующий готовые каталоги. Как только появляется нативная библиотека, JNI или GraalVM Native Image,
цена возвращается целиком, и остаётся выбор между эмуляцией и нативными узлами — двумя исполнителями и
матрицей. Под две архитектуры «на всякий случай» собирать незачем.

## 9. Шпаргалка

| Вопрос | Ответ одной строкой |
|---|---|
| Что выбирает способ сборки образа | чей код собирается и что ещё стоит на машине |
| Чему равен доступ к сокету демона | root на хосте, где работает демон |
| Что убирает BuildKit | не демон, а лишнюю работу: граф, параллелизм, контекст |
| Что убирают Kaniko и Buildah | демон, но не опасность недоверенной сборки |
| Почему кэш слоёв не работает сам собой | он лежит на исполнителе, а исполнитель умирает |
| Как понять, что внешний кэш работает | тег кэша появился в реестре, следующая сборка взяла шаги |
| Худший режим отказа кэша | `--cache-to` не записал, сборка зелёная: «не окупается» вместо «кэша нет» |
| Что экономит layered jar | не размер образа, а размер дельты между сборками |
| Чем тег отличается от дайджеста | тег хранится и переставляется, дайджест вычисляется |
| Что дайджест не гарантирует | происхождение: чем и из какого кода собран образ |
| Почему удаление не освобождает место | слои общие; освобождает проход mark-and-sweep |
| От чего проектируется удержание | от политики отката, не от размера диска |
| Что для Java зависит от архитектуры | только базовый образ с JRE; байткод — нет |

### Формулировки для собеседования

- «Доступ к демону Docker — это root на хосте: API демона позволяет запустить контейнер с корнем хоста внутри и прав не проверяет».
- «Кэш слоёв не переживает исполнителя; если выгрузка в реестр не удалась, сборка зелёная — проверять надо наличие кэша, а не код возврата».
- «Тег хранится и переставляется операцией `push`, дайджест вычисляется из содержимого; продвижение и откат адресуются дайджестом».
- «Layered jar экономит не размер образа, а размер того, что меняется между сборками».

## Источники

- [Docker Engine security](https://docs.docker.com/engine/security/) — root, корень хоста в контейнере.
- [GitLab: Docker build](https://docs.gitlab.com/ci/docker/using_docker_build/) — DinD, `privileged`, сокет.
- [BuildKit](https://docs.docker.com/build/buildkit/), [Registry cache](https://docs.docker.com/build/cache/backends/registry/) — граф, `mode=max`.
- [Kaniko](https://github.com/GoogleContainerTools/kaniko), [Buildah](https://buildah.io/), [Jib](https://github.com/GoogleContainerTools/jib) — без демона.
- [Spring Boot: слои](https://docs.spring.io/spring-boot/reference/packaging/efficient.html), [buildpacks](https://docs.spring.io/spring-boot/reference/packaging/container-images/cloud-native-buildpacks.html).
- [OCI Image Spec](https://github.com/opencontainers/image-spec/blob/main/descriptor.md), [Distribution Spec](https://github.com/opencontainers/distribution-spec/blob/main/spec.md) — дайджест.
- [Kubernetes: Images](https://kubernetes.io/docs/concepts/containers/images/) — «mix of Pods».
- [Registry GC](https://distribution.github.io/distribution/about/garbage-collection/), [Harbor retention](https://goharbor.io/docs/2.12.0/working-with-projects/working-with-images/create-tag-retention-rules/).
- [Multi-platform](https://docs.docker.com/build/building/multi-platform/) — QEMU, `$BUILDPLATFORM`.
