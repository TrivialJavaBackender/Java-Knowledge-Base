# Канареечный, blue-green и A/B релиз на Kubernetes

> **Какую проблему решает.** Новая версия выкатилась на все поды за сорок секунд и все сорок секунд отдавала пятисотки половине пользователей: между «поды заменились» и «трафик пошёл» не стоял никто.
> **Кому это надо.** Тому, кто пишет шаг раскатки и должен ответить, как выкатить на 5% пользователей, как это автоматически откатить и чем канарейка отличается от A/B.
> **Когда НЕ надо.** Без метрики, по которой видно «плохо», прогрессивная раскатка даёт только отсрочку: решение всё равно примет человек по графику, который он и так смотрел.

**Границы с соседними файлами.**
- Когда и на кого катим, откат против наката — [`RELEASE_STRATEGIES.md` §6, §8](../../engineering-process/theory/RELEASE_STRATEGIES.md); здесь только механика.
- Объекты Kubernetes, `RollingUpdate`, пробы — [`KUBERNETES.md` §5, §10](../../infrastructure/theory/KUBERNETES.md). Чем и кто применяет изменение — [`DEPLOY_TO_K8S.md` §1](DEPLOY_TO_K8S.md) и [`DELIVERY_PUSH_VS_PULL.md` §1](DELIVERY_PUSH_VS_PULL.md).
- Готовые сквозные конвейеры — [`RELEASE_PIPELINE_RECIPES.md`](RELEASE_PIPELINE_RECIPES.md).

---

## 1. `RollingUpdate` — это не канарейка

Штатная стратегия Deployment заменяет реплики пачками и не умеет остановиться на 10% и подождать. Ручек ровно две, `maxSurge` и `maxUnavailable`, и обе про скорость замены, а не про долю трафика.

```yaml
strategy:
  rollingUpdate: { maxSurge: 25%, maxUnavailable: 25% }   # быстро или медленно
  type: RollingUpdate                                      # но всегда до конца
```

Единственная пауза — отказ ехать дальше, если новые поды не проходят пробу готовности. Это ловит «не запустился», но не «запустился и отдаёт пятисотки на четверти запросов»: такой под с точки зрения кластера готов.

**Следствие.** Канарейка — механизм, внешний по отношению к Deployment: кто-то должен держать две версии, дозировать трафик и иметь право нажать «стоп».

## 2. Канарейка на репликах: минимальный вариант и его потолок

Два Deployment с общей меткой, на которую смотрит Service, и разным числом реплик. Трафик делится не потому, что его кто-то делит, а потому, что kube-proxy раскидывает соединения по endpoint'ам поровну.

```yaml
apiVersion: v1
kind: Service
metadata: { name: payments }
spec:
  selector: { app: payments }        # ловит оба Deployment: stable и canary
  ports: [{ port: 80, targetPort: 8080 }]
---
# payments-stable: replicas: 9, метки app=payments, track=stable
# payments-canary: replicas: 1, метки app=payments, track=canary   → ~10% трафика
```

Потолок способа — арифметика: доля канарейки равна `1/N` по числу подов. Пятипроцентная канарейка требует двадцати подов, полупроцентная — двухсот. Документация Argo Rollouts формулирует то же ограничение: без управления трафиком контроллер делает «best effort attempt to achieve the percentage listed in the last `setWeight` step».

**Следствие.** Способ работает там, где реплик много, а доли грубые: на трёх подах минимум, который вы выдадите, — 33%.

## 3. Вес в маршруте: канарейка, которой управляет не число подов

Доля трафика становится настоящей ручкой, когда её задаёт маршрутизатор. В Gateway API это поле `weight` у `backendRefs`: число подов больше ни при чём.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: payments }
spec:
  hostnames: [payments.example.com]
  rules:
  - backendRefs:
    - { name: payments-stable, port: 80, weight: 95 }
    - { name: payments-canary, port: 80, weight: 5 }
```

Три свойства `weight`, на которых ловят:

- **Это доли, а не проценты**: доля бэкенда равна его весу, делённому на сумму весов правила. Пары `90/10` и `9/1` означают одно и то же.
- **Вес по умолчанию — `1`**: забытое поле у одного из двух бэкендов даёт не ноль, а равную долю.
- **Один бэкенд получает всё**: «If only a single backend is specified for a route rule it implicitly receives 100% of the traffic, no matter what (if any) weight is specified».

**Следствие.** С весами канарейка на 1% возможна при двух подах, а шаг раскатки — это `PATCH` одного поля, операция для конвейера.

## 4. A/B: маршрут по заголовку, и почему это другая задача

Тот же `HTTPRoute` выбирает бэкенд по признаку запроса: заголовку, куке, значению из токена.

```yaml
  rules:
  - matches:
    - headers: [{ name: x-beta-user, value: "true" }]   # правило с match — первое
    backendRefs: [{ name: payments-canary, port: 80 }]
  - backendRefs: [{ name: payments-stable, port: 80 }]  # всё остальное
```

Механика похожа, задача противоположная:

| | Канарейка | A/B-эксперимент |
|---|---|---|
| Кого пускаем | случайные 5% | заданный сегмент, устойчиво |
| По какой метрике решаем | доля ошибок, задержка | конверсия, продуктовая метрика |
| Сколько длится | минуты | дни и недели |
| Кто читает результат | конвейер | продуктовая аналитика |

Различие не академическое: канарейку катят автоматически, эксперимент — нет. Пятиминутного окна не хватит ни одной продуктовой метрике.

**Следствие.** A/B по заголовку — доставка **двух живущих версий**, а не этап раскатки: обе версии живут в проде столько, сколько идёт эксперимент.

## 5. Blue-green: переключение указателя

Blue-green держит два полных стека и переключает трафик одним изменением: селектор Service указывает на другой набор подов. Откат — то же изменение назад, поэтому занимает секунды. В Argo Rollouts это стратегия `blueGreen` с боевым и превью-сервисом.

```yaml
strategy:
  blueGreen:
    activeService: payments            # обязательное поле: боевой трафик
    previewService: payments-preview    # опциональное: новая версия без пользователей
    autoPromotionEnabled: false         # по умолчанию true — переключит само
    scaleDownDelaySeconds: 30           # значение по умолчанию
    prePromotionAnalysis: { templates: [{ templateName: smoke }] }
```

- `autoPromotionEnabled` **по умолчанию `true`**: не выставив его, вы получите blue-green, который переключается сам, едва новый ReplicaSet готов.
- Переключение — дописывание хеша ReplicaSet в селектор существующего Service, а не создание нового объекта.
- `scaleDownDelaySeconds` нужен потому, что таблицы маршрутизации на узлах обновляются не мгновенно: старые поды ещё несколько секунд получают пакеты.

**Цена** — двойной ресурс и требование, чтобы обе версии работали с одной схемой БД ([`RELEASE_STRATEGIES.md` §7](../../engineering-process/theory/RELEASE_STRATEGIES.md)). Второе жёстче: blue-green не спасает от несовместимой миграции, а гарантирует, что старая версия в этот момент жива.

## 6. Argo Rollouts: раскатка, разбитая на шаги

`Rollout` — замена `Deployment` с теми же `template` и `selector`, но со стратегией в виде списка шагов. Контроллер исполняет их по очереди и останавливается там, где сказано.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: payments }
spec:
  replicas: 10
  strategy:
    canary:
      canaryService: payments-canary    # обязательны оба, когда есть trafficRouting
      stableService: payments-stable
      trafficRouting:
        plugins:
          argoproj-labs/gatewayAPI: { httpRoute: payments, namespace: prod }
      steps:
      - setWeight: 5
      - pause: { duration: 10m }        # без duration — пауза до ручного промоута
      - setWeight: 25
      - analysis: { templates: [{ templateName: success-rate }] }
      - setWeight: 50
      - pause: { duration: 10m }
```

- **`pause` без `duration` ждёт бесконечно** — штатный ручной гейт: дальше `kubectl argo rollouts promote`, назад `abort`.
- **`setWeight` без `trafficRouting` — снова реплики** со всеми ограничениями §2; по умолчанию `trafficRouting` не задан.
- **Gateway API подключается плагином**: в ядре живут Istio, NGINX, ALB, SMI, Traefik, Kong, APISIX, новые туда не принимают.
- `maxSurge` и `maxUnavailable` те же, что у Deployment: по умолчанию `25%`.

**Следствие.** Конвейер больше не «выкатывает», а запускает раскатку и ждёт исхода: решение «ехать дальше» принимает контроллер или дежурный.

## 7. Автоматический гейт: анализ вместо взгляда на график

`AnalysisTemplate` превращает «посмотрели графики» в условие для контроллера: шаг `analysis` блокирует раскатку до вердикта, анализ в `strategy.canary.analysis` идёт фоном.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: { name: success-rate }
spec:
  metrics:
  - name: success-rate
    interval: 1m           # как часто измерять
    count: 5               # сколько измерений; 0 в фоновом анализе = бесконечно
    failureLimit: 1        # сколько провалов терпим до отката
    successCondition: result[0] >= 0.99
    provider:
      prometheus:
        address: http://prometheus.monitoring:9090
        query: |
          sum(rate(http_server_requests_seconds_count{service="payments",status!~"5.."}[2m]))
          / sum(rate(http_server_requests_seconds_count{service="payments"}[2m]))
```

Ошибка здесь не в синтаксисе, а в арифметике. При 40 запросах в секунду и весе 5% на канарейку идёт два запроса в секунду, за минуту — 120. Рост доли ошибок с 0.1% до 1% означает 0.12 ожидаемой ошибки против 1.2 — шум. На весе 25% за десять минут те же пороги дают 6000 запросов и 60 ошибок против 6: сигнал.

**Следствие.** Длину шага задаёт число запросов, которое за него попадёт на канарейку, а не круглая цифра в минутах. На низком трафике канарейка в 5% не докажет ничего, и честнее начинать с 25%.

## 8. Flagger: тот же результат другой моделью

Flagger не заменяет `Deployment`, а забирает его: при создании ресурса `Canary` оператор делает копию-`primary`, переводит на неё весь трафик, а исходный Deployment масштабирует в ноль — «by default all traffic is routed to this version and the target deployment is scaled to zero». Дальше любое изменение исходного Deployment он трактует как заявку на релиз.

```yaml
analysis:
  interval: 1m        # шаг расписания, по умолчанию 60s
  threshold: 5        # сколько неудачных проверок до отката
  stepWeight: 10      # на сколько увеличивать вес за шаг
  maxWeight: 50       # до какого веса дойти перед промоутом
  metrics: [{ name: request-success-rate, thresholdRange: { min: 99 }, interval: 1m }]
```

Критерий выбора один: **кто владеет объектом рабочей нагрузки**. Argo Rollouts требует переписать `Deployment` в `Rollout`, зато раскатка описана явным списком шагов. Flagger оставляет `Deployment` на месте, но владельцем подов становится оператор, а поведение задаётся параметрами. Первое лучше, когда сценарии у сервисов разные; второе — когда политика одна на весь кластер. A/B-режим у Flagger — поля `iterations` и `match` вместо роста веса.

## 9. Когда это неправильный ответ

- **Несовместимая миграция схемы.** Все схемы держат две версии кода одновременно, и такая миграция гарантированно ломает одну. Сначала совместимая миграция ([`RELEASE_STRATEGIES.md` §7](../../engineering-process/theory/RELEASE_STRATEGIES.md)), потом раскатка.
- **Мало трафика.** На 0.5 запроса в секунду канарейка в 5% набирает 90 запросов за час: анализ становится генератором случайных вердиктов.
- **Липкие сессии.** Пользователь закреплён за подом: доля трафика перестаёт быть долей пользователей, а откат выбрасывает сессии.
- **Асинхронная работа.** Потребитель очереди получает сообщения, а не долю трафика.
- **`replicas: 1`.** Двум версиям негде существовать.

## 10. Шпаргалка

| Что нужно | Механизм | Цена |
|---|---|---|
| Обновить без простоя | `RollingUpdate` + пробы | нет гейта, едет до конца |
| Грубая канарейка без новых инструментов | два Deployment, один Service | шаг доли `1/N` |
| Точная доля трафика | `weight` в `HTTPRoute` / VirtualService | нужен шлюз или mesh |
| Сегмент пользователей | `matches.headers` | две версии живут долго |
| Мгновенный откат | blue-green | двойной ресурс, общая схема БД |
| Шаги с паузами и анализом | Argo Rollouts | `Deployment` → `Rollout` |
| Одна политика на кластер | Flagger | подами владеет оператор |

**Дерево решений.** Нет метрики здоровья → нужна метрика, а не канарейка. Мало трафика → blue-green с ручным переключением. Есть метрика и трафик → канарейка с анализом. Нужен сегмент, а не доля → это эксперимент.

### Формулировки для собеседования

- «Без управления трафиком доля канарейки равна `1/N` по числу подов — на трёх репликах это 33%.»
- «`weight` в Gateway API — доли от суммы весов, а не проценты, и по умолчанию он равен единице.»
- «Длину шага задаёт число запросов, попавших на новую версию, а не круглая цифра в минутах.»
- «Blue-green не спасает от несовместимой миграции: он гарантирует, что старая версия в этот момент жива.»

## Источники

- [Argo Rollouts — Canary](https://argo-rollouts.readthedocs.io/en/stable/features/canary/) — `setWeight`, `pause`, умолчания `maxSurge`/`maxUnavailable`, поведение без `trafficRouting`.
- [Argo Rollouts — BlueGreen](https://argo-rollouts.readthedocs.io/en/stable/features/bluegreen/) — `activeService`, `previewService`, `autoPromotionEnabled`, `scaleDownDelaySeconds`, переключение селектора.
- [Argo Rollouts — Analysis](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/) — `interval`, `count`, `failureLimit`, `successCondition`, фоновый и пошаговый анализ.
- [Argo Rollouts — Traffic Management](https://argo-rollouts.readthedocs.io/en/stable/features/traffic-management/) — список провайдеров и плагинная модель.
- [Gateway API plugin — Quick start](https://rollouts-plugin-trafficrouter-gatewayapi.readthedocs.io/en/latest/quick-start/) — ключ `argoproj-labs/gatewayAPI`, поля `httpRoute` и `namespace`.
- [Gateway API — Traffic splitting](https://gateway-api.sigs.k8s.io/guides/traffic-splitting/) — семантика `weight`, значение по умолчанию, единственный бэкенд.
- [Flagger — How it works](https://docs.flagger.app/usage/how-it-works) — ресурс `Canary`, primary-развёртывание, `interval`, `threshold`, `stepWeight`, `maxWeight`, `iterations`, `match`.
- [Kubernetes — Rolling update](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-update-deployment) — `maxSurge`, `maxUnavailable`, `progressDeadlineSeconds`.
