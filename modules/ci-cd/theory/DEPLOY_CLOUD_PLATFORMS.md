# Управляемые платформы как цель раскатки: чем они различаются на самом деле

> **Какую проблему решает.** Образ `payments` собран, кластера Kubernetes нет, а запустить контейнер
> предлагают пять служб AWS и две службы Google — и почти каждая описана словами «fully managed».
> **Кому это надо.** Тому, кого спросят «ECS или EKS» и «чем Cloud Run отличается от GKE».
> **Когда НЕ надо.** Если Kubernetes уже есть: вторая цель раскатки — это второй способ выкатывать,
> откатывать и дежурить, и эта цена почти всегда выше экономии на отдельном сервисе.

**Границы.** Модели услуг и привязка к поставщику —
[`CLOUD.md` §3, §7, §9](../../infrastructure/theory/CLOUD.md); применение и откат —
[`DEPLOY_TO_K8S.md`](DEPLOY_TO_K8S.md); схемы выката —
[`PROGRESSIVE_DELIVERY_K8S.md`](PROGRESSIVE_DELIVERY_K8S.md). Цен и тарифов здесь нет намеренно.

---

## 1. AWS: пять служб, три разных вопроса

ECS, EKS, Fargate, App Runner, Elastic Beanstalk и CodeDeploy **не лежат на одной оси**: они
отвечают на три независимых вопроса, и выбрать можно любую комбинацию.

**Какой API вы программируете** — ECS или EKS. Ходовая формулировка «ECS проще, потому что не надо
содержать control plane» описывает несуществующее различие: ECS работает «without the complexity of
managing a control plane», но и в EKS standard «AWS manages the Kubernetes control plane». Настоящее
различие — словарь: EKS «certified Kubernetes-conformant», и всё написанное против Kubernetes
переносится, а словарь ECS свой и короткий (task definition, cluster, task, service). Та же развилка,
что между Swarm и Kubernetes ([`DEPLOY_SWARM.md` §3](DEPLOY_SWARM.md)).

**Кто владеет серверами** — не альтернатива первому вопросу, а вариант ёмкости **под** ним: на EC2
вы выбираете тип и число машин, на Fargate «you don't need to manage servers». Отсюда частая ошибка
формулировки: **«мы выбрали Fargate вместо ECS»** — предложение без смысла, Fargate не оркестратор.

**Нужен ли оркестратор вообще** — два ответа «нет» и один «да, но раскатку хочу отдельно».

| Служба | Ответ | Что это на самом деле |
|---|---|---|
| App Runner | нет | раскатка «directly to a scalable and secure web application» из кода или образа; сегодня «no longer open to new customers» |
| Elastic Beanstalk | нет | «provisions Amazon EC2 instances, configures load balancing, sets up health monitoring»: конвейер отдаёт бандл, а не желаемое состояние |
| CodeDeploy | да, отдельно | схема выката поверх чужой цели: «stop and roll back», для ECS и Lambda всё «blue/green», трафик «canary, linear, or all-at-once»; те же схемы на Kubernetes — [`PROGRESSIVE_DELIVERY_K8S.md`](PROGRESSIVE_DELIVERY_K8S.md) |

**Правило.** Не «какой сервис AWS лучше», а три вопроса по порядку: API, владелец серверов,
отдельная служба раскатки. И строка про App Runner доказывает: любой обзор платформ — снимок.

## 2. GCP: Cloud Run, GKE и что такое Cloud Build

«Cloud Run для маленького, GKE для большого» неверно: Cloud Run «rapidly scales out to handle all
incoming requests» и поднимается до более чем тысячи экземпляров. Различий два, и оба не про размер.

**Единица управления.** Cloud Run умеет «routing incoming traffic to the latest revision, **rolling
back to a previous revision**, and **splitting traffic to multiple revisions**»: то, что в Kubernetes
собирается из Deployment, Service, Ingress и отдельного инструмента для канарейки
([`PROGRESSIVE_DELIVERY_K8S.md`](PROGRESSIVE_DELIVERY_K8S.md)), здесь встроено в модель, и вопрос
«где хранится предыдущая версия и кто её вернёт»
([`DEPLOY_TO_K8S.md` §4](DEPLOY_TO_K8S.md)) имеет ответ по умолчанию. GKE даёт весь
словарь Kubernetes, и внутри него повторяется ось из §1: в Autopilot «Google Cloud also manages your
worker nodes», в Standard узлы ваши.

**Что происходит, когда запросов нет.** «If there are no incoming requests to your service, **even
the last remaining instance will be removed**» — а плата описана там же и намеренно без единого
числа: новый экземпляр «can increase the response time for these initial requests, **depending on
how quickly your container becomes ready**». Последние пять слов — буквально про нас: `payments` —
Spring Boot на JVM, и любое «холодный старт занимает N секунд» выдумка, пока вы не измерили свой
образ. Компромисс («keep a minimum amount of instances active») отменяет само приобретение, а ответ
получается разный по окружениям: рабочее под постоянным трафиком (пик 40 запросов в секунду) до нуля
не сворачивается вообще, а на dev и qa, где ночью запросов нет, сворачивание даёт экономию ценой
медленного первого запроса утром
([`ENVIRONMENT_ANATOMY.md` §2](ENVIRONMENT_ANATOMY.md)). Cloud Build в этот ряд не
входит: он «executes your builds on Google Cloud», то есть исполнитель сборки
([`RUNNERS.md` §1](RUNNERS.md)), а не место, где живёт сервис.

**Правило.** Cloud Run против GKE решают два вопроса: нужен ли словарь Kubernetes целиком и есть ли
у трафика простой.

## 3. Голая виртуальная машина с systemd: нижняя граница

Шаг раскатки на три машины пишется в две команды — и ломается в трёх местах:

```bash
scp target/payments.jar deploy@host:/opt/payments/payments.jar
ssh deploy@host 'systemctl restart payments'
```

`restart` — остановка и запуск, то есть окно недоступности на каждой машине. Команда завершается
успехом, когда systemd запустил процесс, а не когда Spring поднял контекст и Actuator ответил
([`DEPLOY_TO_K8S.md` §2](DEPLOY_TO_K8S.md)), — и дописать сюда команду ожидания
неоткуда. И `scp` перезаписал файл: предыдущей версии больше нет, откатывать нечем.

Systemd даёт ровно одно: `Restart=` перезапускает процесс, когда тот завершился, был убит или не
уложился в таймаут (пауза `RestartSec=` по умолчанию 100 мс). Это **поддержание одного процесса
живым на одной машине**, первая половина согласования желаемого состояния; второй половины нет —
никто не знает, что машин три и что при смерти одной процесс надо поднять на другой. Её закрывает
Ansible, и не полностью: идемпотентность прогона есть, а агента, который непрерывно возвращал бы
машину к описанию, нет ([`DELIVERY_PUSH_VS_PULL.md` §1](DELIVERY_PUSH_VS_PULL.md),
[`IAC_OWNERSHIP.md` §3](IAC_OWNERSHIP.md)).

**Чего у этой цели нет.** Постепенной замены по машинам с ожиданием готовности. Условия «продолжать,
только если новая версия здорова». Отката как операции — предыдущую версию храните сами.
Перепланирования: упавший процесс systemd поднимет, но на живую машину не перенесёт.

Это законный выбор, когда сервисов один-два, нагрузка предсказуема, машины оплачены, а список выше
не нужен или покрыт балансировщиком; сюда же закрытый контур и машина заказчика. Долгом он
становится по одному признаку: вы дописываете пункты списка скриптами — последовательная раскатка,
проверка `/actuator/health`, хранение предыдущего каталога.

**Правило.** Голая машина законна, пока конвейер не начал реализовывать в скриптах то, что
оркестратор делает по определению: с этого момента сравнение идёт между чужим оркестратором и вашим.

## 4. Критерий выбора: четыре оси размена

Сравнительная таблица возможностей не помогает потому, что **все её строки истинны и ни одна не
решает**: она отвечает на «что умеет платформа», а выбирать надо по «что из этого будет правдой для
нас».

| Ось | EKS / GKE | Cloud Run | Голая машина |
|---|---|---|---|
| Откат | есть, но через ваш инструмент поверх | ревизия платформы, встроен | пишете сами |
| Простой | реплики живы всегда | сворачивается до нуля, платит первым запросом | реплики живы всегда |
| Переносимость описания | заявлена конформность | проверять отдельно | переносится ваш скрипт |
| Словарь | Kubernetes целиком | сервис, ревизия, трафик | процесс и юнит systemd |

По оси отката считают не время, а шаги: сколько их между решением «откатить» и работающей прежней
версией и сколько из них ваши. По оси переносимости контейнер переносим всегда, это образ OCI, —
непереносимо **описание раскатки**: EKS «certified Kubernetes-conformant … without refactoring», то
есть чарт и манифесты едут с вами, а для Cloud Run и App Runner такого заявления в обзорных
страницах нет ([`CLOUD.md` §9](../../infrastructure/theory/CLOUD.md)).

Четвёртую ось задают последней, а решать надо первой: **нужны ли вам примитивы Kubernetes
конкретно** — не «мы за Kubernetes», а список из CRD, операторов и сетевых политик. Пуст — весь спор
шёл о словаре, которым вы не собираетесь пользоваться.

Закрывают выбор два вопроса, и оба не про технику: форма графика нагрузки (а не пиковая цифра) и
наличие людей, готовых содержать оркестратор. У `payments` профиль ровный — половина различий между
платформами для него не наступает, и это самый частый случай.

**Правило.** Выбор платформы — не таблица, а порядок вопросов; «возьмём Kubernetes, это стандарт»
пропускает все четыре. Kubernetes уже есть — EKS или GKE, разговор окончен; нет и список примитивов
пуст — Cloud Run закрывает всё, включая ось отката; голая машина — только если машины уже оплачены.
Денег критерий не считает: сравнение стоимости без своего профиля нагрузки — сравнение чужих
([`PIPELINE_DURATION.md` §1](PIPELINE_DURATION.md)).

## 5. Чем именно конвейер раскатывает на каждую цель

Интеграционного слоя под управляемую платформу не понадобится: примитив вызова короткий у всех.

| Цель | Команда в задании | Чем дожидаетесь готовности |
|---|---|---|
| EKS / GKE | `helm upgrade` или `kubectl apply` | `kubectl rollout status`, `--wait`, `argocd app wait` |
| ECS (на EC2 или Fargate) | новое определение задачи + `aws ecs update-service` | `aws ecs wait services-stable` |
| Cloud Run | `gcloud run deploy --image …` | ничего дописывать не надо |
| Голая машина | `ansible-playbook` с ролью, обновляющей юнит systemd | пишете сами (§3) |

**`--force-new-deployment` в ECS — диагноз, а не флаг:** он нужен, чтобы запустить раскатку «with no
service definition changes … to use a newer Docker image with **the same image/tag combination
(`my_image:latest`)**». Адресуйте образ дайджестом
([`IMAGE_REGISTRY_AND_TAGS.md` §1](IMAGE_REGISTRY_AND_TAGS.md)) — и новое определение задачи
отличается от старого само.

**Умолчания ожидания у поставщиков противоположны.** У Cloud Run флаг `--async` заставляет команду
вернуться немедленно — значит, без флага она ждёт; у `helm upgrade` стратегия ожидания без флага —
`hookOnly` ([`DEPLOY_TO_K8S.md` §2](DEPLOY_TO_K8S.md)). Для ECS ожидание дописывается
и тоже с умолчанием: `aws ecs wait services-stable` опрашивает раз в 15 секунд и выходит с кодом 255
после 40 неудачных проверок — ваш предельный срок раскатки, заданный не вами. Там же `--no-traffic`:
ревизия развёрнута, трафика не получает, включается отдельным решением
([`RELEASE_STRATEGIES.md` §4](../../engineering-process/theory/RELEASE_STRATEGIES.md)).

**Правило.** Под новую цель ищите в документации два ответа: ждёт ли команда по умолчанию и каков
предельный срок ожидания.

## 6. Шпаргалка

| Вопрос | Ответы |
|---|---|
| Какой API программируем? | ECS (свой словарь) или EKS (Kubernetes, переносимо) |
| Кто владеет серверами? | EC2 / узлы GKE Standard — вы; Fargate / GKE Autopilot — поставщик |
| Нужна ли отдельная служба раскатки? | CodeDeploy (схемы выката и откат) или обновление сервиса |

**Порядок вопросов при выборе цели раскатки.**

1. Какие примитивы Kubernetes назовём по имени? Пусто → управляемая платформа приложений.
2. Есть ли у трафика ночь? Есть → сворачивание до нуля это деньги, нет → медленный первый запрос.
3. Сколько шагов до отката и чьи они?
4. Переносимо ли **описание** раскатки (контейнер переносим всегда).
5. Кто это будет содержать и что будет, когда он уйдёт.

### Формулировки для собеседования

- «Fargate — не альтернатива ECS, а вариант ёмкости под ним: сначала выбирают API, потом — кто
  владеет машинами.»
- «Переносим контейнер, а не раскатка: у EKS переносимость описания заявлена как конформность
  Kubernetes, у платформ приложений это надо проверять отдельно.»
- «Голая машина перестаёт быть законным выбором в тот момент, когда конвейер начинает скриптами
  реализовывать постепенную замену и откат.»

## Источники

- [What is Amazon ECS?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html) —
  управляющий слой, словарь ECS, ёмкость EC2 против Fargate.
- [What is Amazon EKS?](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html) —
  конформность Kubernetes и переносимость описания.
- [App Runner](https://docs.aws.amazon.com/apprunner/latest/dg/what-is-apprunner.html),
  [Elastic Beanstalk](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/Welcome.html),
  [CodeDeploy](https://docs.aws.amazon.com/codedeploy/latest/userguide/welcome.html) — закрытие для
  новых клиентов; модель «загрузите бандл»; «stop and roll back» и схемы выката.
- [`ecs update-service`](https://docs.aws.amazon.com/cli/latest/reference/ecs/update-service.html),
  [`ecs wait services-stable`](https://docs.aws.amazon.com/cli/latest/reference/ecs/wait/services-stable.html)
  — `--force-new-deployment`; 40 проверок по 15 секунд.
- [What is Cloud Run](https://cloud.google.com/run/docs/overview/what-is-cloud-run),
  [GKE overview](https://cloud.google.com/kubernetes-engine/docs/concepts/kubernetes-engine-overview),
  [Cloud Build overview](https://cloud.google.com/build/docs/overview) — ревизии, деление трафика,
  удаление последнего экземпляра, Autopilot против Standard.
- [gcloud run deploy](https://cloud.google.com/sdk/gcloud/reference/run/deploy) — `--async`,
  `--no-traffic`.
- [systemd.service(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
  — `Restart=`, `RestartSec=`.
