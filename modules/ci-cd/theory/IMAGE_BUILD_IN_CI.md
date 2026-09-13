# Сборка образа в конвейере: чем собирать, если демона давать нельзя

> **Какую проблему решает.** Задание конвейера само выполняется в контейнере, а ему нужно собрать контейнер — и первый способ, который приходит в голову, отдаёт этому заданию root на хосте.
> **Кому это надо.** Тому, кто пишет шаг сборки образа и кого спросят «зачем вам Kaniko, если есть `docker build`» и «почему кэш слоёв не ускоряет наш конвейер».
> **Когда НЕ надо.** Ни одна техника отсюда не ускоряет сборку сама по себе: если `Dockerfile` начинается с `COPY . .`, кэшировать нечего — сначала порядок слоёв, потом их кэширование.

Соседнее: реестр, теги и дайджест — [`IMAGE_REGISTRY_AND_TAGS.md`](IMAGE_REGISTRY_AND_TAGS.md); слой и устройство реестра — [`DOCKER.md` §3, §9](../../infrastructure/theory/DOCKER.md); эфемерность исполнителя и кэш конвейера — [`PIPELINE_MODEL.md` §5](PIPELINE_MODEL.md), [`RUNNERS_AND_EXECUTION.md` §4](RUNNERS_AND_EXECUTION.md).

---

## 1. Почему `docker build` внутри контейнера конвейера — проблема

`docker buildx build --push -t "$IMAGE:$SHA" .` на управляемом исполнителе работает без единой
настройки: задание выполняется прямо на виртуальной машине, где демон уже стоит. На собственном
исполнителе контейнерного типа ([`RUNNERS_AND_EXECUTION.md` §2](RUNNERS_AND_EXECUTION.md)) тот же шаг
падает с `Cannot connect to the Docker daemon`, и `docker-cli` не помогает: `docker` — клиент,
отправляющий запросы демону по HTTP, а сборку выполняет демон. Способов ровно два — принести демон
внутрь (DinD) или дать доступ к чужому снаружи (сокет хоста), — и платят они одним и тем же.

> «When you share the Docker daemon, you effectively disable the container's security mechanisms and
> expose your host to privilege escalation.» «This can cause container breakout.» «Use this approach
> when your runner supports `privileged` mode.» (про DinD) — GitLab docs, «Use Docker to build images»

Это не «настройка безопасности», а свойство конструкции: у API демона нет модели прав — он не
различает, кому можно собрать образ, а кому нельзя, и клиент, дотянувшийся до демона, запускает любой
контейнер с любыми параметрами.

> «Docker allows you to share a directory between the Docker host and a guest container… without
> limiting the access rights of the container… you can start a container where the `/host` directory is
> the `/` directory on your host; and the container can alter your host filesystem without any
> restriction.» «This daemon requires `root` privileges unless you opt-in to Rootless mode»
> — Docker docs, «Docker Engine security»

Три легальных шага — задание говорит с демоном, просит контейнер с корнем хоста внутри, пишет в него —
дают формулировку целиком: **доступ к демону Docker эквивалентен root на машине, где этот демон
работает.** Сокет отдаёт хост, DinD — контейнер сборщика с привилегиями и вдобавок качает базовые слои
заново, потому что стартует с пустым хранилищем образов.

**Когда это всё-таки нормальный ответ.** Три условия одновременно: код доверенный (никаких
пулл-реквестов из форков — [`RUNNERS_AND_EXECUTION.md` §9](RUNNERS_AND_EXECUTION.md)), машина эфемерна,
чужого на ней нет. **Правило:** сначала ответьте, **чей код я запускаю и что ещё стоит на этой
машине**.

## 2. Kaniko, Buildah, BuildKit — три разных ответа

Это не конкуренты: они отвечают на разные вопросы, и только два из трёх вообще про отсутствие демона.

*BuildKit демон не убирает* — это собственный движок сборки Docker («BuildKit is the builder backend
used by Docker»), то есть `docker build` уже вызывает BuildKit. Он отвечает на вопрос «как собирать
быстро»: параллелит независимые этапы, пропускает те, чей результат никому не нужен («Detect and skip
executing unused build stages»), передаёт только изменившиеся файлы контекста («Incrementally transfer
only the changed files in your build context» — Docker docs). Сам сборщик не обязан жить внутри вашего
демона: драйвер `docker-container` поднимает его отдельным контейнером со своим сетевым пространством
имён (§3).

*Kaniko убирает демон целиком:* он «doesn't depend on a Docker daemon and executes each command within
a Dockerfile completely in userspace» — каждая инструкция `RUN` выполняется процессом самого Kaniko,
привилегий не нужно, поэтому он запускается обычным подом: сборка там, где кластер есть, а демона нет.

*Buildah убирает демон и заодно `Dockerfile` как обязательную форму:* слои создаются отдельными
командами, образ собирается скриптом или из пакетов дистрибутива «without a full container runtime or
daemon installed» (buildah.io) — но то, что декларативно описано и потому кэшируется, становится вашим
скриптом со всеми последствиями.

| Что должно быть правдой | Что из этого следует |
|---|---|
| Демон есть, он ваш, машина одноразовая | `docker buildx` (то есть BuildKit) |
| Демона нет: сборка идёт подом в кластере | Kaniko |
| Образ собирается скриптом, не из `Dockerfile` | Buildah |
| Демон есть, но **чужой** — общий на несколько команд | ни один не спасает: проблема в §1 |

**Чего эти инструменты не делают.** Ни один не превращает недоверенную сборку в безопасную — «kaniko by
itself **does not** make it safe to run untrusted builds»: привилегий нет, а сеть, секреты пода и
сервис метаданных облака остаются там же.

## 3. Кэш слоёв, который не переживает исполнителя

Полная сборка образа без кэша — **95,66 с** (Apple Silicon, macOS 15, Docker 29.4.3, buildx v0.33.0;
не бенчмарк). Кэш слоёв — содержимое файловой системы сборщика, а исполнитель эфемерен: вместе с
машиной уходит кэш, и каждая сборка первая (`docker buildx prune -af` освободил 1,438 ГБ — то же
состояние локально).

Раз кэш обязан пережить машину, он должен лежать не на машине, а в реестре — отдельным артефактом:

> «It can efficiently cache multi-stage builds in `max` mode, instead of only the final stage.»
> — Docker docs, «Registry cache backend»

Без `mode=max` сохранится только последний этап, самый дешёвый, а долгий Maven-этап будет
пересобираться каждый раз. Сборка становится двусторонней: `--cache-to` выгружает кэш, `--cache-from`
подтягивает обратно.

| Сборка | Реальное время | Шагов взято из кэша |
|---|---|---|
| `--cache-from type=registry` после полной очистки | **3,74 с** | **13** |
| без кэша вовсе | **95,66 с** | 0 |

Отношение ≈ 26×, и это содержательный ответ на вопрос «как кэш переживает эфемерность»: никак — его
каждый раз приносят заново, просто принести 13 готовых слоёв дешевле, чем их построить.

**Ловушка дороже самого замера.** Первая попытка дала ложный успех: сборщик создан обычным способом
(`--driver docker-container`), кэш направлен в локальный `registry:2` на хосте, команда отработала 251
секунду и вышла **с кодом 0** — а реестр пуст, и следующая сборка взяла из кэша **0 шагов**:

```
$ curl -s http://localhost:5001/v2/payments/tags/list
{"errors":[{"code":"NAME_UNKNOWN","message":"repository name not known to registry", …}]}
```

Причина та же, что в §1, с другой стороны: сборщик живёт в отдельном контейнере, и `localhost:5001`
внутри означает его самого, а не хост (лечится `--driver-opt network=host`).

**Второй урок: `--cache-to`, который не смог записать кэш, не роняет сборку.** Кэш не входит в
результат — образ без него побайтово тот же, — поэтому падать сборке не от чего, и отказ неотличим от
«кэш не окупается». Код возврата молчит, смотрят на два признака: появился ли тег кэша в реестре рядом
с тегом образа (`{"name":"payments","tags":["v1","buildcache"]}`) и сколько шагов пришло из кэша в
следующей сборке. Тот же класс, что отравленный кэш
([`RUNNERS_AND_EXECUTION.md` §4](RUNNERS_AND_EXECUTION.md)): кэш **молча** меняет только время.

**Правило.** Кэш через реестр включается тремя действиями: направить `--cache-to ...,mode=max` в
реестр, убедиться, что кэш там появился, и один раз собрать после полной очистки локального.

## 4. Layered jar, Jib, buildpacks: что экономит каждый

Исполняемый jar Spring Boot — классы и все зависимости, порядка 40 МБ, и `COPY target/*.jar app.jar`
кладёт это одним слоем. Слой адресуется дайджестом содержимого, поэтому правка одной строки кода делает
jar другим файлом целиком, то есть другим слоем целиком: реестр принимает 40 МБ заново, и каждый узел
кластера заново их скачивает.

> «Putting your application's code and all its dependencies in one layer in the Docker image is not
> optimal.» «This layering is designed to separate code based on how likely it is to change between
> application builds.» — Spring Boot docs, «Efficient container images»

Времени сборки в этой цене **нет**: дороже стала доставка, и счёт выставляется сети и реестру. Spring
Boot разбивает jar на четыре части, копируются они по возрастанию изменчивости, потому что слой
инвалидирует все слои выше себя:

```dockerfile
RUN java -Djarmode=tools -jar app.jar extract --layers --launcher --destination extracted
COPY --from=extract /app/extracted/dependencies/ ./          # меняются редко
COPY --from=extract /app/extracted/spring-boot-loader/ ./
# … snapshot-dependencies …
COPY --from=extract /app/extracted/application/ ./           # меняются каждый коммит
```

После правки контроллера передаётся только последний слой — единицы мегабайт вместо сорока.

**Побочный эффект, стоивший красной сборки.** Документация показывает `extract --layers` без
`--launcher` и `ENTRYPOINT ["java", "-jar", "application.jar"]`, а с `--launcher` формы
`application.jar` нет вовсе, есть дерево `BOOT-INF/`, `META-INF/`, `org/`, и образ падал с `non-zero
exit (1)` во всех репликах, пока точку входа не взяли из манифеста:

```
$ grep -a "Main-Class" /app/META-INF/MANIFEST.MF
Main-Class: org.springframework.boot.loader.launch.JarLauncher
```

Отсюда `ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]`: после разбора на
слои запускается другой артефакт другим способом, и проверяется это запуском, а не чтением.

**Jib и buildpacks убирают `Dockerfile`.** Jib «builds optimized… images for your Java applications
without a Docker daemon», «separates your application into multiple layers, splitting dependencies from
classes» — то есть снимает и проблему §1. Buildpacks — противоположный случай: образ уезжает «into your
locally running Docker daemon» (Spring Boot docs), а демона у задания в контейнере нет.

| Что должно быть правдой | Что из этого следует |
|---|---|
| Нужен контроль над базовым образом, пользователем, точкой входа | `Dockerfile` + `extract --layers` |
| Демона нет, лишнего файла в репозитории не хочется | Jib |
| Единый способ на десяток сервисов | buildpacks, но проверьте, откуда возьмётся демон |

**Правило.** Вопрос не «как уменьшить образ», а **что в нём меняется от коммита к коммиту**: считайте
не мегабайты образа, а мегабайты дельты.

## 5. Шпаргалка

| Вопрос | Ответ одной строкой |
|---|---|
| Что выбирает способ сборки образа | чей код собирается и что ещё стоит на машине |
| Чему равен доступ к сокету демона | root на хосте, где работает демон |
| Чем DinD платит помимо привилегий | пустое хранилище образов: базовые слои качаются заново |
| Что убирает BuildKit | не демон, а лишнюю работу: граф, параллелизм, контекст |
| Что убирают Kaniko и Buildah | демон, но не опасность недоверенной сборки |
| Почему кэш слоёв не работает сам собой | он лежит на исполнителе, а исполнитель умирает |
| Зачем `mode=max` | иначе в кэш попадёт только последний этап, самый дешёвый |
| Как понять, что внешний кэш работает | тег кэша в реестре и шаги, взятые из него в следующей сборке |
| Худший режим отказа кэша | `--cache-to` не записал, сборка зелёная: «не окупается» вместо «нет» |
| Что экономит layered jar | не размер образа, а размер дельты между сборками |
| Что ломает `extract --launcher` | точку входа: `application.jar` нет, запускается `JarLauncher` |

**Дерево решения:** демон доступен и машина одноразовая → `docker buildx`; демона нет, есть кластер →
Kaniko; сборка не из `Dockerfile` → Buildah; демон общий с чужими заданиями → задача про изоляцию (§1).

### Формулировки для собеседования

- «Доступ к демону Docker — это root на хосте: API демона позволяет запустить контейнер с корнем хоста внутри и прав не проверяет».
- «Кэш слоёв не переживает исполнителя; если выгрузка в реестр не удалась, сборка зелёная — проверять надо наличие кэша, а не код возврата».
- «Layered jar экономит не размер образа, а размер того, что меняется между сборками».
- «Kaniko и Buildah убирают демон, но не делают безопасной сборку чужого кода — это разные вопросы».

## Источники

- [Docker Engine security](https://docs.docker.com/engine/security/) — root-привилегии демона, корень хоста в контейнере.
- [GitLab: Docker build](https://docs.gitlab.com/ci/docker/using_docker_build/) — DinD и `privileged`, риски проброса сокета.
- [BuildKit](https://docs.docker.com/build/buildkit/) — движок по умолчанию, граф, инкрементальный контекст.
- [Registry cache backend](https://docs.docker.com/build/cache/backends/registry/), [кэш в CI](https://docs.docker.com/build/ci/github-actions/cache/) — `--cache-to/--cache-from`, `mode=max`.
- [Kaniko](https://github.com/GoogleContainerTools/kaniko), [Buildah](https://buildah.io/) — сборка без демона и оговорка про недоверенные сборки.
- [Spring Boot: слои](https://docs.spring.io/spring-boot/reference/packaging/efficient.html), [buildpacks](https://docs.spring.io/spring-boot/reference/packaging/container-images/cloud-native-buildpacks.html), [Jib](https://github.com/GoogleContainerTools/jib) — четыре слоя, локальный демон, слои без `Dockerfile`.