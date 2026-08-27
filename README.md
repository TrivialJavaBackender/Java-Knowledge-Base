# Interview Prep

Подготовка к backend-собеседованиям: теория, вопросы с ответами, упражнения с кодом.
Шестнадцать независимых модулей в `modules/`, единая карта тем в
[`knowledge/GLOBAL_INDEX.md`](knowledge/GLOBAL_INDEX.md), прогресс и повторение карточек —
в web-приложении.

Теория здесь — **объяснение, а не справочник**: каждый файл открывается тремя вопросами
(какую проблему решает / кому это надо / когда НЕ надо), каждый раздел идёт по схеме
«задача → наивное решение и где оно ломается → механизм → правило», каждое утверждение
о поведении подпёрто исходником с номером строки, прогоном или спецификацией. Требования
зафиксированы в [`knowledge/THEORY_CONTRACT.md`](knowledge/THEORY_CONTRACT.md).

---

## Модули

| Модуль | Тема | Теория | Вопросы | Упражнения |
|--------|------|:------:|:-------:|:----------:|
| [Concurrency](modules/concurrency/README.md) | Java Concurrency: JMM, JUC, пулы, виртуальные потоки | 12 | 82 | 18 |
| [Kotlin Coroutines](modules/kotlin-coroutines/README.md) | suspend, Flow, Channel, structured concurrency | 18 | 86 | 18 |
| [System Design](modules/system-design/README.md) | Проектирование систем + 14 разобранных задач | 44 | 90 | — |
| [Microservices](modules/microservices/README.md) | Границы, связь, согласованность, изоляция отказа | 12 | 40 | — |
| [Databases](modules/databases/README.md) | Транзакции, индексы, storage engines, репликация | 6 | 21 | — |
| [Hibernate & JPA](modules/hibernate-jpa/README.md) | Lifecycle, маппинг, N+1, кэш L1/L2, блокировки | 13 | 31 | — |
| [Spring Frameworks](modules/spring-frameworks/README.md) | Core, Boot, MVC, Data, Security, Cloud | 6 | 17 | — |
| [Java Core](modules/java-core/README.md) | GC, JIT, ClassLoaders, JPMS, байт-код | 15 | 30 | — |
| [Infrastructure](modules/infrastructure/README.md) | Docker, K8s, Helm, наблюдаемость, секреты | 8 | 50 | — |
| [Caching Deep Dive](modules/caching-deep-dive/README.md) | CPU → JVM → Caffeine → Redis → CDN | 9 | 18 | 10 |
| [DDD](modules/ddd/README.md) | Стратегия, тактика, гексагональная архитектура | 10 | 28 | — |
| [Design Patterns](modules/design-patterns/README.md) | GoF, UML, GRASP, антипаттерны | 8 | 28 | 1 |
| [Software Engineering](modules/software-engineering/README.md) | SOLID, Stream API и FP, тестирование | 3 | 22 | — |
| [Engineering Process](modules/engineering-process/README.md) | Бэклог, оценки, Scrum, релизы, инциденты | 14 | 67 | — |
| [Go](modules/go/README.md) | Синтаксис, горутины, GMP-шедулер, GC, stdlib | 16 | 67 | — |
| [GraphQL (Kotlin)](modules/graphql-kotlin/README.md) | graphql-kotlin, DataLoader, Federation | 4 | 14 | 6 |

У каждого модуля есть `ROADMAP.md` (порядок прохождения с чеклистами),
`INTERVIEW_QUESTIONS.md` (вопросы с ответами) и `_SUMMARY.md` (сжатие на 2–4 КБ для быстрого
восстановления контекста).

---

## Web-приложение

Single-user Next.js: чтение теории, отметки прогресса, повторение карточек по Лейтнеру,
поиск по всем модулям. Карточки генерируются 1:1 из `INTERVIEW_QUESTIONS.md` автоматически.

```bash
cd web
pnpm dev                                     # localhost:3000
node_modules/.bin/tsx scripts/sync.ts        # пере-импорт после правки modules/
```

Синхронизация идемпотентна: без изменений даёт нули. Прогресс и интервалы повторения
сохраняются через стабильные natural keys, поэтому правка текста вопроса не сбрасывает
статистику карточки.

---

## Структура репозитория

```
├── modules/<slug>/
│   ├── theory/*.md              # теория (первый # — заголовок страницы на сайте)
│   ├── ROADMAP.md               # порядок прохождения; задаёт порядок теории на сайте
│   ├── INTERVIEW_QUESTIONS.md   # Q&A → авто-карточки
│   ├── _SUMMARY.md              # семантическое сжатие модуля
│   └── src/ или exercises/      # упражнения, если в модуле есть код
│
├── knowledge/                   # служебные документы репозитория
│   ├── GLOBAL_INDEX.md          # карта «концепт → файл-владелец» (single source of truth)
│   ├── THEORY_CONTRACT.md       # что отличает объяснение от перечисления API
│   ├── THEORY_SAMPLE.md         # образец формы на настоящих фрагментах
│   ├── CANONICAL_TERMS.md       # каноническая терминология
│   ├── GLOSSARY.md              # полный справочник перевода
│   └── GLOSSARY_CORE.md         # рабочая выжимка (покрывает почти все случаи)
│
└── web/                         # Next.js приложение
```

### Правило NO OVERLAP

Каждая тема принадлежит **ровно одному** модулю. Владелец разбирает механизм, остальные
ссылаются, а не переопределяют. Карта владения — `knowledge/GLOBAL_INDEX.md`, включая секцию
«Disambiguated Concepts» для тем, которые законно появляются в нескольких модулях под разными
углами: JMM → `concurrency`, кэш Hibernate → `spring-frameworks`, протокол OAuth2 →
`system-design`, механика circuit breaker → `microservices`.

Перед добавлением теории — сверка с индексом. При перекрытии больше 30% расширяется
существующий файл, а не создаётся новый.

---

## Сборка

Модули с `pom.xml` (`concurrency`, `kotlin-coroutines`, `caching-deep-dive`, `graphql-kotlin`,
`design-patterns`, `infrastructure`, `spring-frameworks`) собираются независимо:

```bash
cd modules/<slug>
mvn -q test-compile        # компиляция
mvn test                   # тесты
```

Остальные модули — чисто теоретические, сборки не имеют. Команды конкретного модуля — в его
`README.md`, раздел «Как работать».

---

## Работа с ассистентом

Инструкции для Claude Code — в [`CLAUDE.md`](CLAUDE.md). Основные команды в диалоге:

```
"следующий"              — следующая тема теории по ROADMAP активного модуля
"квиз"                   — 5 случайных вопросов из INTERVIEW_QUESTIONS.md
"проверь <модуль> Ex01"  — code review упражнения
"переключись на <модуль>"— смена активного модуля
/new-module <name>       — создать новый модуль (оркестрация сабагентами)
/check-translation <mod> — проверка терминологии по глоссарию
```
