# Реестр образов: чем адресовать результат и что с ним происходит дальше

> **Какую проблему решает.** Образ уехал в реестр под тегом `dev`, через час тот же тег указывает на другое содержимое, и никто этого не заметил: имя не переставало значить то же самое только на словах.
> **Кому это надо.** Тому, кого спросят «почему образ адресуется дайджестом, а не тегом», «почему удаление образов не освобождает место» и «что даёт мультиархитектурная сборка».
> **Когда НЕ надо.** Мультиархитектурный образ «на всякий случай» — чистый расход: он нужен, когда обе архитектуры действительно исполняются.

**Границы.** Как образ собирается в конвейере — [`IMAGE_BUILD_IN_CI.md`](IMAGE_BUILD_IN_CI.md); слой и устройство реестра — [`DOCKER.md` §3, §9](../../infrastructure/theory/DOCKER.md); продвижение артефакта по окружениям — [`ENVIRONMENTS_AND_PROMOTION.md` §1](ENVIRONMENTS_AND_PROMOTION.md); подпись и происхождение — [`SUPPLY_CHAIN_ATTACKS.md` §4](SUPPLY_CHAIN_ATTACKS.md).

---

## 1. Тег против дайджеста

Образ собран под тегом `dev`, раскатан на dev и проверен; на qa должно поехать **то же самое**. Но
один и тот же тег до и после пересборки того же дерева исходников указывает на разное содержимое:

```
$ docker buildx imagetools inspect localhost:5001/payments:v1
Digest:    sha256:25a00689dd771dfcbdaaa524ab9739c6ebbcbb5a4c4ac179c4ee030a2e5bb52b
# … пересборка и push под тем же тегом …
Digest:    sha256:81fc786d34ef4d8957ce99f13ac108aa8692ead54a4a151e39e7e74b57bab132
```

Тег `v1` указывает уже на другое содержимое, и **никакой ошибки не возникает** нигде — ни в реестре,
ни в конвейере, ни в кластере: это штатное поведение, ради которого теги придуманы. Спецификация
разрешает обе формы адресации — «the digest of the manifest or (b) a tag» (OCI Distribution Spec), —
но связь «имя → содержимое» они берут из разных мест.

*Тег — запись в реестре.* Отношение «тег `v1` указывает на манифест X» хранит реестр, и меняет его
операция `push`; в самом образе про его теги не записано ничего. *Дайджест — функция от содержимого:*
«a unique identifier created from a cryptographic hash of a Blob's content» (там же), и его можно
«verify… by recalculating the digest independently» (OCI Image Spec). Отсюда асимметрия одной фразой:
**тег можно переставить, потому что он хранится; дайджест — нельзя, потому что он вычисляется**;
«подменить» дайджест — это не право `push`, а коллизия SHA-256.

Три следствия. *«Тот же тег» не значит «тот же образ» — ни между окружениями, ни между узлами:*

> «When using image tags, if the image registry were to change the code that the tag on that image
> represents, you might end up with a mix of Pods running the old and new code. An image digest
> uniquely identifies a specific version of the image, so Kubernetes runs the same code every time it
> starts a container with that image name and digest specified.» — Kubernetes docs, «Images»

Слово «mix» ключевое: расходятся не окружения целиком, а отдельные поды — стартовавшие до перестановки
тега и после; усиливает это `IfNotPresent`, при которой «the image is pulled only if it is not already
present locally». *Откат по тегу — не откат:* «вернём `v1.2.3`» имеет смысл, только если это те же
байты, а проверяется это только сравнением дайджестов. *`latest` — крайний случай того же самого:*
«avoid using the `:latest` tag… as it is harder to track which version of the image is running and
more difficult to roll back properly» (там же). `dev`, `staging`, `stable` ничем не лучше: любой
переставляемый тег — это `latest` под другим именем.

Поэтому задание сборки отдаёт вниз по графу не тег, а дайджест (`digest: ${{ steps.push.outputs.digest
}}`), тег же с номером коммита остаётся человеку: **тег адресует образ для людей, дайджест — для
машин.** **Чего дайджест не делает:** он идентифицирует содержимое и ничего не говорит о происхождении
— образ, подложенный тем, у кого есть право `push`, имеет такой же честный дайджест
([`SUPPLY_CHAIN_ATTACKS.md` §4](SUPPLY_CHAIN_ATTACKS.md)).

## 2. Аутентификация конвейера в реестре

Наивное решение — `echo "$REGISTRY_PASSWORD" | docker login registry.example.com -u "$REGISTRY_USER"
--password-stdin` — работает с первой попытки, и все три его свойства уже разобраны как класс:
долгоживущий (не истекает, после утечки полезен неограниченно долго), широкий (у учётной записи,
которой пользуются люди, права на весь реестр, а не на один репозиторий образа) и доступный любому
заданию, читающему секреты ([`PIPELINE_CREDENTIALS.md` §1](PIPELINE_CREDENTIALS.md)).

Три способа отличаются тем, сколько живёт учётная запись. *Robot-аккаунт* — отдельная запись под
конвейер с правом `push` только в репозиторий `payments`: секрет по-прежнему долгоживущий, но радиус
поражения сузился с реестра до одного репозитория; это минимум, ниже которого опускаться незачем.
*Токен, который платформа выдаёт заданию:* реестр внутри той же платформы, что и конвейер, может не
требовать хранимого секрета — токен создаётся под запуск и умирает вместе с ним, а права объявляются
явно (`permissions: packages: write`), причём «the token's permissions are limited to the repository
that contains your workflow» (GitHub docs). *Федерация:* для ECR и Artifact Registry конвейер
предъявляет короткоживущий подписанный токен, который облако обменивает на временные данные
([`PIPELINE_CREDENTIALS.md` §2](PIPELINE_CREDENTIALS.md)).

**Про вторую учётную запись забывают.** `push` делает конвейер, `pull` — кластер: кластеру нужен
только `pull` и только на запускаемые им репозитории, а одна общая учётка «для образов» превращает
компрометацию узла в право переписать образ. **Правило:** про доступ в реестр задают два вопроса —
**сколько эта учётная запись живёт** и **что она может, кроме `push` в один репозиторий**; правильные
ответы «минуты» и «ничего».

## 3. Хранение и сборка мусора в реестре

Конвейер собирает образ на каждое слияние в `main`: двадцать слияний в день — около пяти тысяч образов
за год, и это один сервис из двадцати. «Кончится место — удалим старые теги» не работает: реестр хранит
манифесты и блобы отдельно, удаление манифеста снимает ссылку, а место освобождает отдельный проход.

> «Garbage collection runs in two phases. First, in the "mark" phase, the process scans all the
> manifests… Secondly, in the "sweep" phase, the process scans all the blobs and if a blob's content
> address digest is not in the mark set, the process deletes it.» «As long as a layer is referenced by
> one manifest, it cannot be garbage collected.» «You should ensure that the registry is in read-only
> mode or not running at all.» — Docker Registry docs, «Garbage collection»

Отсюда два контринтуитивных следствия. *Удаление одного образа освобождает почти ничего:* базовый
`eclipse-temurin:21-jre-alpine` и слой `dependencies` общие для всех сборок, и пока жива хоть одна, они
не уйдут — удаляется верхний слой с классами, единицы мегабайт из сорока. Разделение слоёв, экономившее
трафик ([`IMAGE_BUILD_IN_CI.md` §4](IMAGE_BUILD_IN_CI.md)), так же экономит хранение: пять тысяч сборок
занимают один набор общих слоёв плюс пять тысяч маленьких верхушек. *Сборка мусора — операционное окно,
а не фоновая задача:* живые блобы вычисляются по снимку манифестов, и образ, появившийся после снимка,
в него не попал — его слои признают мусором.

Политика удержания описывается критерием «что оставить»: «when you set a rule, any tags… that are not
identified as being eligible for retention are discarded», причём «retention is matched at the tag
level but retention / deletion is carried out at the artifact level» (Harbor docs). Вторая фраза
объясняет ходовой сюрприз: правило пишут про теги, а удаляется артефакт целиком, со всеми остальными
своими тегами — образ, оставленный как `v1.4.0`, исчезнет вместе с ним, если критерий смотрел на тег
`dev`. Артефакты вовсе без тегов — результат перестановки тега из §1: старый манифест никуда не делся,
просто на него больше никто не ссылается по имени.

По-настоящему ломается это на критериях вида «последние N сборок»: они считают от ветки сборки, а не
от того, что работает в проде, и прод, отставший на два релиза, оказывается за пределами последних N —
первый же откат упирается в «manifest unknown». **Правило:** политика удержания проектируется от
политики отката, а не от размера диска, и обязана удерживать всё, на что ссылается живое развёртывание;
второй счёт — реестр растёт от числа **разных** слоёв, а не сборок, поэтому смена базового образа стоит
дороже тысячи коммитов.

## 4. Образы под несколько архитектур

Разработчики на arm64, прод исторически на amd64, инфраструктура присматривается к arm-инстансам ради
цены. Дописать `--platform linux/amd64,linux/arm64` формально достаточно, и результат — не два образа,
а один составной: «multi-platform images contain a manifest list, pointing to multiple manifests, each
of which points to a different configuration and set of layers» (Docker docs). Ломается это об
исполнителя: архитектура у него одна, остальное идёт через эмуляцию, а «emulation with QEMU can be much
slower than native builds, especially for compute-heavy tasks like compilation and compression or
decompression» — то есть на самых дорогих этапах сборки.

Стратегий три («using emulation, via QEMU; a builder with multiple native nodes; cross-compilation with
multi-stage builds»), и выбор определяется одним вопросом: **что в вашей сборке зависит от целевой
архитектуры.** Для Java ответ приятный — почти ничего: байткод архитектурно нейтрален по определению
формата, jar с amd64 побайтово годится для arm64, зависит только базовый образ с JRE. Значит,
компилировать надо один раз нативно, различая лишь последний этап: «the `FROM` instruction is pinned to
the native platform of the builder (using the `--platform=$BUILDPLATFORM` option) to prevent emulation
from kicking in» — то есть `FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS build`: этап
сборки остаётся нативным, под эмуляцию уходит финальный, который лишь копирует готовые каталоги.

**Когда эта стратегия не спасает.** Как только в сборке появляется что-то, действительно компилируемое
под целевую архитектуру — нативная библиотека, JNI, GraalVM Native Image, — цена возвращается целиком,
и остаётся выбор между медленной эмуляцией и нативными узлами: «using multiple native nodes provide
better support for more complicated cases that QEMU can't handle, and also provides better
performance». Нативные узлы — два исполнителя вместо одного, то есть матрица сборки со всеми издержками
([`PIPELINE_CACHE_AND_CONCURRENCY.md` §3](PIPELINE_CACHE_AND_CONCURRENCY.md)): парк машин под каждую архитектуру, две
очереди, два набора кэша. **Правило:** разделите сборку на «что зависит от архитектуры» и «что нет»;
для типового Java-сервиса первая часть — только базовый образ, и тогда вторая платформа почти
бесплатна.

## 5. Шпаргалка

| Вопрос | Ответ одной строкой |
|---|---|
| Чем тег отличается от дайджеста | тег хранится и переставляется, дайджест вычисляется из содержимого |
| Почему `IfNotPresent` усиливает проблему | узел, у которого образ уже есть, новый не заберёт |
| Что дайджест не гарантирует | происхождение: чем и из какого кода собран образ |
| Два вопроса про доступ в реестр | сколько живёт учётная запись и что она может кроме `push` в один репозиторий |
| Почему удаление образа не освобождает место | слои общие; освобождает проход mark-and-sweep |
| Почему чистку нельзя совмещать со сборками | «mark» берёт снимок манифестов: новый образ признают мусором |
| Ловушка политики удержания | правило пишут про теги, удаляется артефакт со всеми своими тегами |
| Что для Java зависит от архитектуры | только базовый образ с JRE; байткод — нет |
| Когда мультиарх дорог | когда есть JNI, нативные библиотеки или GraalVM Native Image |

### Формулировки для собеседования

- «Тег хранится в реестре и переставляется операцией `push`, дайджест вычисляется из содержимого; всё, на чём держатся продвижение и откат, адресуется дайджестом».
- «Перестановка тега не вызывает ошибки нигде: расходятся отдельные поды — стартовавшие до неё и после».
- «Удаление образа почти не освобождает место: слои общие, а освобождает отдельный проход mark-and-sweep, требующий реестра в режиме только на чтение».
- «Для Java от архитектуры зависит только базовый образ с JRE: компилировать надо один раз нативно, различая лишь последний этап».

## Источники

- [OCI Image Spec](https://github.com/opencontainers/image-spec/blob/main/descriptor.md), [OCI Distribution Spec](https://github.com/opencontainers/distribution-spec/blob/main/spec.md) — дайджест как content identifier, адресация тегом или дайджестом.
- [Kubernetes: Images](https://kubernetes.io/docs/concepts/containers/images/) — «mix of Pods running the old and new code», `IfNotPresent`, почему не `:latest`.
- [GitHub: публикация пакета из Actions](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions) — токен задания и его границы.
- [Registry: garbage collection](https://distribution.github.io/distribution/about/garbage-collection/) — фазы mark и sweep, режим только на чтение, общие слои.
- [Harbor: tag retention rules](https://goharbor.io/docs/2.12.0/working-with-projects/working-with-images/create-tag-retention-rules/) — удержание по тегу, удаление по артефакту.
- [Multi-platform builds](https://docs.docker.com/build/building/multi-platform/) — манифест-список, три стратегии, QEMU и `--platform=$BUILDPLATFORM`.
