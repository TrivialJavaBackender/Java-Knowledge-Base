# Сквозные конвейеры релиза: от `git push` до канарейки в проде

> **Какую проблему решает.** Механика канарейки известна, манифесты написаны — а в конвейере по-прежнему `kubectl apply` и `sleep 60`, потому что неясно, кто нажимает «дальше» и откуда конвейер узнаёт, что релиз провалился.
> **Кому это надо.** Тому, кто собирает релизный конвейер целиком и должен показать его на собеседовании: где гейт, где ожидание, где откат.
> **Когда НЕ надо.** Один сервис, один кластер, релиз раз в месяц — весь этот аппарат дороже проблемы, которую решает. Там достаточно `helm upgrade --wait --atomic`.

**Границы с соседними файлами.**
- **Схемы раскатки и их манифесты** — [`PROGRESSIVE_DELIVERY_K8S.md`](PROGRESSIVE_DELIVERY_K8S.md); здесь они уже считаются известными.
- **Толчок против вытягивания как модель** — [`DELIVERY_PUSH_VS_PULL.md` §1, §5](DELIVERY_PUSH_VS_PULL.md). **Дайджест как идентификатор образа** — [`IMAGE_REGISTRY_AND_TAGS.md` §1](IMAGE_REGISTRY_AND_TAGS.md). **OIDC вместо долгоживущего токена** — [`PIPELINE_CREDENTIALS.md` §2](PIPELINE_CREDENTIALS.md).
- **Продвижение одного артефакта по окружениям** — [`ENVIRONMENTS_AND_PROMOTION.md` §1](ENVIRONMENTS_AND_PROMOTION.md).

---

## 1. Любой релизный конвейер — это четыре шага

Рецепты ниже отличаются не набором действий, а тем, **кто** делает третий шаг и **кто** выносит вердикт на четвёртом.

| Шаг | Что происходит | Кто делает |
|---|---|---|
| 1. Собрать | один артефакт на весь путь до прода | конвейер |
| 2. Зафиксировать | дайджест образа, а не тег | конвейер |
| 3. Изменить желаемое состояние | новый дайджест в манифесте | конвейер или агент в кластере |
| 4. Дождаться вердикта | «раскатка здорова» или «откачено» | контроллер, метрики или человек |

Шаг 4 — тот, который обычно забывают. Конвейер, заканчивающийся на «манифест применён», сообщает об успехе ровно в тот момент, когда релиз ещё не начался.

## 2. Рецепт A: канарейка толчком, гейт внутри конвейера

Подходит, когда кластер один, а конвейер имеет к нему доступ. Конвейер сам применяет `Rollout` и сам ждёт исхода.

```yaml
name: release
on:
  push: { branches: [main] }
permissions:
  contents: read
  id-token: write                      # OIDC: без долгоживущего kubeconfig в секретах
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      digest: ${{ steps.image.outputs.digest }}
    steps:
    - uses: actions/checkout@v4
    - uses: docker/login-action@v3
      with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
    - id: image
      uses: docker/build-push-action@v7
      with:
        push: true
        tags: ghcr.io/acme/payments:${{ github.sha }}

  release:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: production, url: https://payments.example.com }
    steps:
    - uses: actions/checkout@v4
    - run: |
        curl -sSL -o /usr/local/bin/kubectl-argo-rollouts \
          https://github.com/argoproj/argo-rollouts/releases/latest/download/kubectl-argo-rollouts-linux-amd64
        chmod +x /usr/local/bin/kubectl-argo-rollouts
    - name: Запустить раскатку
      run: |
        kubectl argo rollouts set image payments \
          payments=ghcr.io/acme/payments@${{ needs.build.outputs.digest }}
    - name: Дождаться исхода
      run: kubectl argo rollouts status payments --timeout 30m
    - name: Откатить, если провалилось
      if: failure()
      run: kubectl argo rollouts abort payments
```

Три места, где этот конвейер отличается от наивного:

- **Образ передаётся дайджестом, а не тегом.** `outputs.digest` — это `sha256:…`, и следующий шаг ставит в манифест именно его: тег `main` через час будет означать другой образ.
- **`kubectl argo rollouts status` блокирует.** Команда «watch rollout until it finishes or the timeout is exceeded. Returns success if the rollout is healthy upon completion and an error otherwise» — то есть шаг конвейера краснеет ровно тогда, когда раскатка не здорова.
- **`abort` в `if: failure()`.** Без него провалившаяся канарейка остаётся стоять на половине веса: контроллер не откатывает по таймауту конвейера, он вообще про конвейер не знает.

**Чем платите.** У конвейера есть доступ в прод-кластер, и этот доступ живёт столько же, сколько репозиторий. Именно от этого уходят в GitOps.

## 3. Рецепт B: та же канарейка через GitOps

Конвейер не трогает кластер. Он меняет **репозиторий конфигурации**, а изменение в кластер переносит Argo CD.

```yaml
  promote:
    needs: build
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
      with: { repository: acme/payments-config, token: ${{ secrets.CONFIG_REPO_TOKEN }} }
    - name: Записать новый дайджест в overlay прода
      run: |
        cd overlays/prod
        kustomize edit set image \
          payments=ghcr.io/acme/payments@${{ needs.build.outputs.digest }}
        git commit -am "payments: ${{ github.sha }}"
        git push
```

Дальше работает не конвейер: Argo CD замечает расхождение и синхронизирует `Rollout`, Rollout едет по шагам, анализ решает, продолжать ли. Вердикт конвейеру не возвращается вовсе — и это не недостаток, а суть модели.

Если вердикт всё же нужен в логе сборки, добавляется отдельное ожидание:

```yaml
    - run: argocd app wait payments-prod --health --timeout 1800
```

**Разница с рецептом A в одном:** источник истины. В A истина — то, что конвейер применил последним; в B — то, что лежит в git. Поэтому откат в B — это `git revert` коммита с дайджестом, а не команда в кластере: откатив кластер напрямую, вы получите расхождение, которое агент тут же вернёт обратно ([`DELIVERY_PUSH_VS_PULL.md` §5](DELIVERY_PUSH_VS_PULL.md)).

## 4. Где ставить ручной гейт: `pause` или окружение

Оба механизма останавливают релиз до решения человека, но платят за это по-разному.

| | `pause: {}` в Rollout | `environment` с ревьюерами |
|---|---|---|
| Кто ждёт | контроллер в кластере | задание конвейера |
| Стоимость ожидания | ноль | минуты исполнителя, пока задание висит |
| Что видит дежурный | `kubectl argo rollouts get` | кнопка в интерфейсе конвейера |
| Как продолжить | `promote` | одобрение, до 6 ревьюеров, достаточно одного |
| Если никто не пришёл | стоит бесконечно, трафик поделён | задание висит в ожидании |

**Правило.** Гейт, который решает «пускать ли эту версию к людям вообще», ставится в конвейере до первого шага раскатки — там дешевле передумать. Гейт «увеличивать ли долю» ставится в `Rollout`: он относится к уже идущему релизу, и конвейеру там делать нечего.

Промежуточный вариант — таймер: `wait timer` в окружении GitHub задерживает задание на заданное число минут без участия человека. Это честная замена «подождём и посмотрим», когда смотреть некому.

## 5. Рецепт C: blue-green с превью-адресом

Здесь конвейер даёт человеку возможность потрогать новую версию до того, как на неё пойдут пользователи. Превью-сервис уже описан в `Rollout` ([`PROGRESSIVE_DELIVERY_K8S.md` §5](PROGRESSIVE_DELIVERY_K8S.md)), конвейеру остаётся показать адрес и дождаться решения.

```yaml
  preview:
    environment:
      name: preview
      url: https://payments-preview.example.com   # виден в интерфейсе как ссылка
    steps:
    - run: kubectl argo rollouts set image payments payments=ghcr.io/acme/payments@${{ needs.build.outputs.digest }}
    - run: kubectl argo rollouts status payments --timeout 10m || true   # дойдёт до паузы
    - run: ./smoke-test.sh https://payments-preview.example.com

  switch:
    needs: preview
    environment: { name: production }               # ревьюеры одобряют здесь
    steps:
    - run: kubectl argo rollouts promote payments   # переключение селектора Service
```

Обязательное условие — `autoPromotionEnabled: false`. При значении по умолчанию (`true`) контроллер переключит трафик, как только новая версия станет готовой, и задание `switch` одобрят уже после того, как пользователи на ней окажутся.

## 6. Провал: три разных «откатить»

Слово одно, операций три, и на инциденте их путают.

| Ситуация | Команда | Что происходит |
|---|---|---|
| Канарейка едет, метрики плохие | `kubectl argo rollouts abort` | вес возвращается на стабильную версию, новая остаётся в кластере |
| Раскатка завершилась, проблема нашлась позже | `kubectl argo rollouts undo` | предыдущая ревизия становится желаемой |
| Управление через GitOps | `git revert` коммита с дайджестом | агент возвращает кластер к прежнему состоянию |

В GitOps-модели первые две команды работают, но результат живёт до следующей синхронизации: агент сравнивает кластер с git и возвращает то, что записано там. Поэтому `abort` в GitOps — это средство немедленно остановить кровотечение, а не откат; откат — коммит.

**Правило.** В конвейере с GitOps всегда есть два пути отката: быстрый в кластере и настоящий в git. Оба должны быть в runbook, и второй обязан идти сразу за первым.

## 7. A/B-эксперимент конвейером не управляется

Соблазн сделать эксперимент этапом релиза объясним, но это ошибка. Релиз заканчивается тем, что одна версия вытеснила другую; эксперимент — тем, что обе живут неделю, а решение принимает продуктовая аналитика, а не доля пятисоток.

Поэтому в конвейере эксперимент выглядит скучно: доставить обе версии и не трогать маршрут. Правило маршрутизации по заголовку меняется отдельно — конфигом, флагом функциональности или коммитом в конфиг-репозиторий ([`RELEASE_STRATEGIES.md` §4](../../engineering-process/theory/RELEASE_STRATEGIES.md)).

Практическое следствие: версия под экспериментом должна переживать обычные релизы соседних сервисов и не блокировать их. Если ветка эксперимента живёт в отдельном образе, который нельзя обновить без остановки эксперимента, через неделю вы получите ветку с недельным отставанием и конфликтом на слияние.

## 8. Шпаргалка

**Выбор рецепта.**

| Что у вас | Рецепт |
|---|---|
| Один кластер, доступ у конвейера, нужен вердикт в сборке | A: толчком, гейт `rollouts status` |
| Несколько кластеров, аудит, «истина в git» | B: GitOps, вердикт в Argo CD |
| Нужно потрогать версию до пользователей | C: blue-green с превью-адресом |
| Сегмент пользователей на недели | не релиз: доставить обе версии, маршрут менять конфигом |

**Скелет релизного задания.**

```
собрать → дайджест → записать желаемое состояние → ждать вердикт → откатить при провале
```

Отсутствие любого из пяти элементов — конкретный дефект: без дайджеста нельзя доказать, что в проде тот же артефакт; без ожидания зелёный конвейер ничего не значит; без отката провалившаяся раскатка стоит на половине веса до прихода человека.

### Формулировки для собеседования

- «Конвейер, который заканчивается на `kubectl apply`, сообщает об успехе до того, как релиз начался.»
- «`kubectl argo rollouts status` блокирует и возвращает ошибку, если раскатка не здорова: это и есть гейт в конвейере.»
- «В GitOps откат — это коммит; команда в кластере живёт до следующей синхронизации.»
- «Гейт "пускать ли версию" ставится в конвейере, гейт "увеличивать ли долю" — в Rollout.»
- «Эксперимент — не этап релиза: релиз вытесняет старую версию, эксперимент требует, чтобы обе жили неделями.»

## Источники

- [docker/build-push-action](https://github.com/docker/build-push-action) — выходные значения `digest`, `imageid`, `metadata`.
- [GitHub Actions — Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) — ревьюеры (до 6, достаточно одного одобрения), таймер ожидания, `environment.url`.
- [GitHub Actions — OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) — `permissions: id-token: write` вместо долгоживущих секретов.
- [Argo Rollouts — kubectl plugin: status](https://argo-rollouts.readthedocs.io/en/stable/generated/kubectl-argo-rollouts/kubectl-argo-rollouts_status/) — блокирующее ожидание, `--timeout`, признак неуспеха.
- [Argo Rollouts — kubectl plugin: promote](https://argo-rollouts.readthedocs.io/en/stable/generated/kubectl-argo-rollouts/kubectl-argo-rollouts_promote/) и [abort](https://argo-rollouts.readthedocs.io/en/stable/generated/kubectl-argo-rollouts/kubectl-argo-rollouts_abort/) — продвижение и прерывание раскатки.
- [Argo CD — argocd app wait](https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_app_wait/) — ожидание состояния приложения.
- [Kustomize — поле `images` в kustomization](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/images/) — что именно записывает `kustomize edit set image` в overlay.
