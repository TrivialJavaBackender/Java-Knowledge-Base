# Interview Prep — Web app

Single-user локальный сайт поверх `modules/` для:
- чтения теории с подсветкой и навигацией по roadmap;
- трекинга прогресса (read/known) по теории, упражнениям и Q&A;
- Anki-style повторения карточек (Leitner, 5 коробок) с авто-генерацией из `INTERVIEW_QUESTIONS.md` и ручным созданием.

Контент берётся из `../modules/`. Прогресс хранится в `prisma/dev.db` (SQLite).

## Запуск

```bash
cd web
pnpm install                                   # один раз
pnpm prisma migrate deploy                     # применить миграции (первый раз)
node_modules/.bin/tsx scripts/sync.ts          # импортировать контент
pnpm dev                                       # → http://localhost:3000
```

После правки файлов в `../modules/` — пере-импорт:

```bash
node_modules/.bin/tsx scripts/sync.ts
```

Sync идемпотентен: без изменений делает 0 записей. Прогресс и Leitner-стейт сохраняются через стабильные natural keys (`(moduleSlug, slug)` для теории/упражнений, `(moduleSlug, qNumber)` для Q&A).

## Что где

```
/                                 общий прогресс + 7 модулей
/modules/<slug>                   theory + exercises + Q&A
/modules/<slug>/theory/<doc>      рендер md (порядок из ROADMAP.md)
/modules/<slug>/exercises/<ex>    read-only код, Open in IDE
/modules/<slug>/qa                раскрывающиеся Q&A с per-Q "I know this"
/flashcards                       сегодняшняя очередь Leitner, хоткеи Space/1/2
/flashcards/manage                таблица всех карточек, фильтры, archive/reset
/flashcards/new                   форма ручной карточки
```

Поиск живёт в шапке и доступен с любой страницы: `⌘K` / `Ctrl+K` или `/` — фокус,
`↑`/`↓` — перебор, `Enter` — переход, `Esc` — закрыть.

## Карточки и Leitner

5 коробок с интервалами:

| Box | Интервал |
|-----|----------|
| 1   | 1 день   |
| 2   | 3 дня    |
| 3   | 7 дней   |
| 4   | 14 дней  |
| 5   | 30 дней  |

- **«Знал»**: `box = min(5, box+1)`, streak +1, `nextDueAt = startOfTomorrow + interval`.
- **«Повторить»**: `box = 1`, lapses +1, streak = 0, `nextDueAt = startOfTomorrow`.

`startOfDay` берётся в локальной TZ — очередь стабильна независимо от времени review. Сегодняшняя очередь сортируется `box ASC`, лимит 50/день.

### Когда появляются новые карточки?

**Авто (из `INTERVIEW_QUESTIONS.md`):** каждый новый Q после `pnpm sync` создаёт карточку в box 1. При первичном sync `nextDueAt` раскидывается round-robin по 7 ближайшим дням, чтобы день 1 не утопил очередь. Дальше карточки появляются каждый раз когда:
- ты добавил новый `### Q<N>:` в `INTERVIEW_QUESTIONS.md` и сделал `pnpm sync` — она встанет на сегодня (далее по round-robin для anti-avalanche).
- ты создал manual-карточку через `/flashcards/new` — она встанет на сегодня (box 1).

При правке текста Q box/streak сохраняются, обновляется только front/back. Удалённые Q → карточка архивируется (`/flashcards/manage` с фильтром `archived = yes`).

## Тёмная/светлая тема

Кнопка `☀︎ Light / ☾ Dark` в правом верхнем углу. Запоминается в localStorage. Inline-скрипт в `<head>` применяет тему до первой отрисовки — флэш-эффекта нет.

Подсветка кода Shiki использует `github-dark-default` независимо от темы (фон блока всегда тёмный — общая практика для читаемости).

## Открытие файлов в IDE

В шапке упражнения/теории кнопка **«Open in IDE»** → POST `/api/open-in-ide` → сервер запускает `open -a "IntelliJ IDEA" <path>` (macOS). Работает во всех браузерах (включая Safari) и не требует JetBrains URL handler. Безопасно: путь должен лежать внутри `MODULES_ROOT`.

## Архитектура

**Стек:** Next.js 15 (App Router), React 19, Prisma 5 + SQLite, Tailwind 3 + `@tailwindcss/typography`, Shiki, marked.

**Модель данных:**
- `Module` (id, slug, title, order)
- `TheoryDoc` (moduleId, slug, title, body, order, isRead)
- `Exercise` (moduleId, slug, number, title, body, language, isRead)
- `InterviewSection` + `InterviewQA` (moduleId, qNumber unique, isKnown)
- `Flashcard` (source AUTO/MANUAL, qaId? FK, front, back, archived)
- `LeitnerState` (flashcardId unique, box, nextDueAt, streak, lapses)
- `ReviewLog` (история отметок)

Авто-карточки имеют `qaId` → 1:1 с `InterviewQA`. При правке Q в .md sync обновляет front/back, но Leitner-стейт сохраняется через FK.

**Парсер `INTERVIEW_QUESTIONS.md`:** выбирается по `qaFormat` в `content.config.ts`. Три формата (см. CLAUDE.md в корне репо).

**Парсер ROADMAP.md:** ищет первое упоминание `theory/<NAME>.md` в roadmap и проставляет `TheoryDoc.order`. Не упомянутые файлы получают order=999 (в конец, дальше по алфавиту).

## Поиск

Ищет по **структуре** контента: концепты из `../knowledge/GLOBAL_INDEX.md` (1011),
заголовки теории H2–H4 (4640), названия документов (198), вопросы Q&A (692), упражнения (53).
Тел статей в индексе нет.

**Почему так.** Приложение и база стоят в США, читатель — нет. Запрос в базу на каждое
нажатие клавиши стоил бы трансатлантического round-trip и нагружал Neon. Поэтому индекс
собирается заранее, отдаётся один раз и фильтруется целиком в браузере: **запросов к базе на
поиск — ноль**.

**Как устроено:**

- `scripts/sync.ts` попутно собирает `public/search-index.json` (~830 КБ, ~155 КБ под brotli).
  Отдельного прохода по `../modules/` нет — sync и так читает каждый файл, так что индекс не
  может разъехаться с тем, какие страницы реально существуют.
- Путь `search-index.json` исключён из матчера в `middleware.ts`, поэтому Netlify отдаёт его
  как обычный CDN-ассет с эджа рядом с читателем, а не функцией из США. Заголовок кэша задан
  в `next.config.mjs`: всегда ревалидировать, но тело перекачивать только после реальной правки.
- `components/SearchBox.tsx` тянет индекс лениво — на первом фокусе, один раз на вкладку
  (модульный синглтон переживает клиентские переходы). Ссылки результатов идут с
  `prefetch={false}`: иначе Next отрендерил бы на сервере каждую видимую строку выпадашки,
  вместе с её запросами в базу.
- `lib/search.ts` — матчинг и ранжирование, без React. Совпадение целого слова весит больше,
  чем начало более длинного (`cas` → «CAS», а не «cascade»). Запрос от 2 символов; токены
  длиной 2 засчитываются только на границе слова — иначе `gc` вытаскивал бы мусор.

**Якоря.** `lib/markdown.tsx` проставляет `id` заголовкам (`lib/slugify.ts`), а индекс
слагифицирует тот же текст в том же порядке — поэтому результат-заголовок попадает именно в
свою секцию. Q&A адресуется как `#qa-<qNumber>` — natural key, как и остальные ссылки в проекте.

Sync печатает предупреждение на каждый концепт `GLOBAL_INDEX.md`, чей модуль или файл не
нашёлся. Это заодно самая дешёвая проверка, что глобальный индекс не протух.

## Когда что-то ломается

| Симптом | Причина | Решение |
|---------|---------|---------|
| `pnpm dev` падает с `prisma generate` | engine binary не скачан | `node_modules/.bin/prisma generate` |
| После правки модуля ничего не меняется | sync не запущен | `node_modules/.bin/tsx scripts/sync.ts` |
| Q потерял Leitner-стейт | поменял `qNumber` в .md | Восстанови Q-номер либо смирись с потерей бокса |
| «Open in IDE» молчит | IntelliJ Toolbox не зарегистрировал app | проверить `which idea`; используется `open -a "IntelliJ IDEA"` |
| Поиск не находит новую теорию | индекс пересобирается только в sync | `node_modules/.bin/tsx scripts/sync.ts` |
| Результат-заголовок ведёт в начало страницы | якоря разъехались с рендером | заголовок правился без пересборки индекса — прогони sync |
| Карточек завал на день 1 | round-robin распределение есть только при первичном sync; massive add сейчас даст всё на сегодня | мириться или временно `archived = true` через manage |

## Игнорируется в git

`web/prisma/dev.db*` — твой прогресс не должен попадать в git, иначе будет конфликтовать между машинами.

`web/public/search-index.json` — генерируется из `../modules/`, в сборке пересоздаётся сам.
