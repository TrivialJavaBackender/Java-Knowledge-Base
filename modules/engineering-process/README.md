# Engineering Process — Interview Prep

Модуль о том, как в компании устроен полный цикл работы: откуда берётся задача, как она попадает
в бэклог, как её оценивают и приоритизируют, как команда живёт спринтами, как код доходит до
основной ветки, как из основной ветки получается релиз в проде, что происходит при инциденте и
как всё это измеряют.

Модуль отвечает на вопросы, где интервьюер проверяет не знание фактов, а рамку рассуждения:
«бизнесу нужно пять задач, а команда тянет две — что выберешь», «спринт перегружен на середине»,
«убеди меня выделить время на технический долг», «как вы катите в прод».

> Терминология процесса зафиксирована в [`knowledge/GLOSSARY.md`](../../knowledge/GLOSSARY.md)
> (раздел «Процессы разработки, планирование и доставка») и
> [`knowledge/CANONICAL_TERMS.md`](../../knowledge/CANONICAL_TERMS.md) (блок Engineering Process).

## Структура проекта

```
├── ROADMAP.md                          # 14 тем в порядке прохождения + чеклисты
├── INTERVIEW_QUESTIONS.md              # вопросы с ответами (формат qa-bold)
├── _SUMMARY.md                         # семантическое сжатие модуля
│
└── theory/
    ├── INTRO_SDLC.md                   # карта цикла, зачем процесс, когда Scrum не нужен
    ├── ROLES_AND_STAKEHOLDERS.md       # роли Scrum + окружение, кто такие стейкхолдеры
    ├── DISCOVERY_AND_INTAKE.md         # источники задач, приём заявок, критерии приёмки, DoR
    ├── BACKLOG_MANAGEMENT.md           # бэклог продукта и спринта, refinement, нарезка, DoD
    ├── ESTIMATION.md                   # стори-поинты, velocity, Монте-Карло, #NoEstimates
    ├── PRIORITIZATION.md               # cost of delay, WSJF, RICE, MoSCoW — «5 задач, а можешь 2»
    ├── SCRUM_PROCESS.md                # события, артефакты, обязательства, ScrumBut
    ├── FLOW_AND_WIP.md                 # закон Литтла, WIP-лимиты, очереди, перегруз
    ├── BRANCHING_AND_CODE_FLOW.md      # trunk-based / GitHub Flow / GitFlow, ревью, CI-гейт
    ├── RELEASE_STRATEGIES.md           # релизная ветка, теги, CD, semver, feature flags, откат
    ├── TECH_DEBT.md                    # квадрант Фаулера, измерение, бюджет долга
    ├── INCIDENTS_AND_POSTMORTEM.md     # дежурство, ход инцидента, разбор без поиска виноватых
    └── DELIVERY_METRICS.md             # DORA, метрики потока, закон Гудхарта
```

## Темы

| Раздел | Содержание | Теория |
|--------|------------|--------|
| Введение | Карта цикла, цена процесса и его отсутствия | [INTRO_SDLC](theory/INTRO_SDLC.md) |
| Роли | Scrum-ответственности, окружение команды, стейкхолдеры | [ROLES_AND_STAKEHOLDERS](theory/ROLES_AND_STAKEHOLDERS.md) |
| Источники задач | Продукт, продажи, поддержка, комплаенс, инциденты | [DISCOVERY_AND_INTAKE](theory/DISCOVERY_AND_INTAKE.md) |
| Бэклог | Уточнение, нарезка, DoR/DoD, гниение бэклога | [BACKLOG_MANAGEMENT](theory/BACKLOG_MANAGEMENT.md) |
| Оценка | Стори-поинты, velocity, вероятностный прогноз | [ESTIMATION](theory/ESTIMATION.md) |
| Приоритизация | Cost of delay, WSJF, RICE, размен вместо отказа | [PRIORITIZATION](theory/PRIORITIZATION.md) |
| Scrum | События, тайм-боксы, артефакты, антипаттерны | [SCRUM_PROCESS](theory/SCRUM_PROCESS.md) |
| Поток | Закон Литтла, WIP-лимиты, перегруз команды | [FLOW_AND_WIP](theory/FLOW_AND_WIP.md) |
| Код в основную ветку | Стратегии ветвления, ревью, CI-гейт | [BRANCHING_AND_CODE_FLOW](theory/BRANCHING_AND_CODE_FLOW.md) |
| Релизы | Ветка / тег / CD, semver, feature flags, откат | [RELEASE_STRATEGIES](theory/RELEASE_STRATEGIES.md) |
| Технический долг | Квадрант Фаулера, бюджет, обоснование бизнесу | [TECH_DEBT](theory/TECH_DEBT.md) |
| Инциденты | Дежурство, ход инцидента, постмортем | [INCIDENTS_AND_POSTMORTEM](theory/INCIDENTS_AND_POSTMORTEM.md) |
| Метрики | DORA, метрики потока, закон Гудхарта | [DELIVERY_METRICS](theory/DELIVERY_METRICS.md) |

## Сквозной пример

Вся теория разбирается на одной ситуации.

> **Платёжный сервис продуктовой компании.** Команда: пять инженеров, Product Owner, QA,
> разделяемый с другими командами SRE. Спринт две недели, историческая пропускная способность —
> около восьми задач за спринт. На ближайший спринт в бэклог пришло двенадцать единиц работы:
> две продуктовые функции (одна — интеграция нового провайдера платежей), требование комплаенса
> с законодательным сроком, баг из поддержки, действие по итогам сентябрьского инцидента,
> миграция схемы БД, технический долг от команды.

Из этого одного набора выводятся все решения модуля: как задачи попадают в бэклог, почему
двенадцать не помещаются в восемь, по какому критерию выбирают, что едет в этот спринт, как
выбранное доходит до прода и что происходит, когда посреди спринта падает прод.

## Границы модуля

Модуль отвечает на вопрос **«когда и по какому решению катим»**. Механика инструментов принадлежит
другим модулям и здесь только упоминается со ссылкой:

- механика развёртывания в Kubernetes, probes, откат Deployment — [infrastructure/KUBERNETES.md](../infrastructure/theory/KUBERNETES.md)
- GitOps и Argo CD — [infrastructure/HELM.md](../infrastructure/theory/HELM.md)
- разбор вопросов с собеседования («пять задач против двух», «срежь тесты», «прод упал»,
  disagree and commit, bus factor, HR-раунд) — [behavioral-interview](../behavioral-interview/).
  Здесь — механизмы, там — что произносить вслух
- SLI / SLO / error budget — [infrastructure/OBSERVABILITY.md](../infrastructure/theory/OBSERVABILITY.md)
- что стоит в CI-гейте (пирамида тестов, contract testing) — [software-engineering/TESTING.md](../software-engineering/theory/TESTING.md)
- Event Storming и Example Mapping — [ddd/EVENT_STORMING.md](../ddd/theory/EVENT_STORMING.md)

## Как работать

Это теоретический модуль: сборки и упражнений с кодом нет. Прогресс, чтение теории и повторение
карточек — в web app репозитория.

```
"следующий"   — следующая тема теории по ROADMAP
"квиз"        — 5 случайных вопросов из INTERVIEW_QUESTIONS.md
```

## Источники

- *The Scrum Guide* (ноябрь 2020) — Ken Schwaber, Jeff Sutherland
- *Accelerate: The Science of Lean Software and DevOps* — Nicole Forsgren, Jez Humble, Gene Kim
- *Continuous Delivery* — Jez Humble, David Farley
- *The Principles of Product Development Flow* — Donald Reinertsen (cost of delay, WSJF, очереди)
- *Kanban: Successful Evolutionary Change for Your Technology Business* — David J. Anderson
- *Actionable Agile Metrics for Predictability* — Daniel Vacanti (метрики потока, Монте-Карло)
- *Agile Estimating and Planning* — Mike Cohn
- *Site Reliability Engineering* — Google (дежурство, постмортемы, error budget)
- *User Story Mapping* — Jeff Patton
- Статьи Мартина Фаулера: TechnicalDebtQuadrant, FeatureToggle, PatternsOfLegacyDisplacement
- Спецификации: [Semantic Versioning 2.0.0](https://semver.org/), [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)
