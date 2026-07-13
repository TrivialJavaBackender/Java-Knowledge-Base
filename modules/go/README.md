# Go — Interview Prep

Подробный модуль по языку Go и его экосистеме — с нуля, для разработчика из Java/Kotlin.
Покрывает основы языка, типы и интерфейсы, обработку ошибок, конкурентность (горутины, каналы,
`context`, sync), внутренности рантайма (GMP-шедулер, GC, модель памяти), дженерики,
стандартную библиотеку (io, encoding/json, net/http), тестирование и профилирование.

> Только стандартная библиотека — без сторонних фреймворков (Gin/gRPC/ORM). Фундамент языка
> переносится на любой фреймворк; идиомы stdlib не устаревают.

## Структура проекта

```
├── ROADMAP.md                          # 16 тем в порядке прохождения + чеклисты
├── INTERVIEW_QUESTIONS.md              # вопросы с ответами для собеседования
│
├── theory/                             # Теория по каждой теме
│   ├── TOOLING_MODULES.md              # toolchain, go modules, go.work, структура проекта
│   ├── BASICS.md                       # синтаксис, типы, zero values, for, функции
│   ├── TYPES_STRUCTS_METHODS.md        # struct, методы, receivers, встраивание
│   ├── INTERFACES.md                   # неявная реализация, any, type switch, itab
│   ├── ERRORS_PANIC.md                 # error как значение, %w, panic/recover, defer
│   ├── SLICES_MAPS_STRINGS.md          # слайс-хедер, append-ловушки, map, rune
│   ├── GOROUTINES_CHANNELS.md          # горутины, каналы, select, deadlock
│   ├── CONCURRENCY_PATTERNS.md         # worker pool, pipeline, context, sync, atomic
│   ├── SCHEDULER.md                    # модель GMP, preemption, GOMAXPROCS
│   ├── MEMORY_GC.md                    # модель памяти, race detector, GC, escape analysis
│   ├── GENERICS.md                     # type parameters, constraints, инстанцирование
│   ├── STDLIB_CORE.md                  # io, bufio, fmt, time, slices, encoding/json
│   ├── NET_HTTP.md                     # сервер/клиент, ServeMux, middleware, graceful shutdown
│   ├── TESTING_GO.md                   # table-driven, subtests, benchmarks, fuzzing, httptest
│   ├── IDIOMS_PATTERNS.md              # naming, defer, functional options, дизайн пакетов
│   └── PERFORMANCE_PROFILING.md        # pprof, escape analysis, sync.Pool, GODEBUG
│
└── exercises/                          # Go-пакеты со стабами и тестами (см. exercises/README.md)
    ├── ex01_basics … ex12_sync
```

## Темы

| Тема | Ключевые концепты / API | Упражнение | Теория |
|------|--------------------------|-----------|--------|
| Tooling & Modules | `go build/test/vet`, go.mod/go.sum, go.work | — | [TOOLING_MODULES](theory/TOOLING_MODULES.md) |
| Основы | `:=`, `const`/`iota`, zero values, `for`, функции, exported | 01 | [BASICS](theory/BASICS.md) |
| Типы и методы | struct, value/pointer receiver, embedding, теги | 02 | [TYPES_STRUCTS_METHODS](theory/TYPES_STRUCTS_METHODS.md) |
| Интерфейсы | structural typing, `any`, type switch, itab, nil-trap | 03 | [INTERFACES](theory/INTERFACES.md) |
| Ошибки | error-значение, `%w`, `errors.Is/As`, panic/recover, defer | 04 | [ERRORS_PANIC](theory/ERRORS_PANIC.md) |
| Слайсы/Maps/Строки | слайс-хедер, append, aliasing, map, rune vs byte | 05 | [SLICES_MAPS_STRINGS](theory/SLICES_MAPS_STRINGS.md) |
| Горутины и каналы | `go`, каналы, `select`, close/range, deadlock | 06 | [GOROUTINES_CHANNELS](theory/GOROUTINES_CHANNELS.md) |
| Паттерны конкурентности | worker pool, pipeline, `context`, `sync`, `atomic` | 07 | [CONCURRENCY_PATTERNS](theory/CONCURRENCY_PATTERNS.md) |
| Шедулер | GMP, preemption, syscalls, GOMAXPROCS, work-stealing | — | [SCHEDULER](theory/SCHEDULER.md) |
| Память и GC | модель памяти, `-race`, tri-color GC, escape analysis | 12 | [MEMORY_GC](theory/MEMORY_GC.md) |
| Дженерики | type parameters, constraints, `comparable`, `~` | 08 | [GENERICS](theory/GENERICS.md) |
| Stdlib | io.Reader/Writer, fmt, time, slices, encoding/json | 09 | [STDLIB_CORE](theory/STDLIB_CORE.md) |
| net/http | Handler, ServeMux, middleware, graceful shutdown | 10 | [NET_HTTP](theory/NET_HTTP.md) |
| Тестирование | table-driven, subtests, benchmarks, fuzzing, httptest | 11 | [TESTING_GO](theory/TESTING_GO.md) |
| Идиомы | functional options, дизайн пакетов, zero value | — | [IDIOMS_PATTERNS](theory/IDIOMS_PATTERNS.md) |
| Производительность | pprof, escape analysis, sync.Pool, GODEBUG | — | [PERFORMANCE_PROFILING](theory/PERFORMANCE_PROFILING.md) |

## Как работать

Упражнения — настоящие Go-пакеты в `exercises/`. Каждый файл содержит условие в doc-комментарии
и стабы функций. Реализуй и запусти тесты:

```bash
cd exercises

go test ./ex01_basics/        # одно упражнение
go test ./...                 # все
go test -race ./...           # с детектором гонок (для конкурентных задач)
go vet ./...                  # статический анализ
gofmt -l .                    # форматирование (пусто = ок)
```

Команды в CLAUDE.md:
- `"проверь go Ex01"` — code review реализации + запуск тестов
- `"следующий"` / `"next"` — следующая незавершённая тема
- `"квиз"` / `"quiz"` — случайные вопросы из INTERVIEW_QUESTIONS.md

## Code review — на что смотреть

- **Ошибки как значения**: проверяется ли каждая `error`; корректное оборачивание `%w`,
  `errors.Is/As` вместо сравнения строк; не «проглатывается» ли ошибка.
- **Утечки горутин**: каждая запущенная горутина должна уметь завершиться (через `context`,
  закрытие канала или `done`-сигнал); нет «висящих» отправок в небуферизованный канал.
- **Гонки данных**: `go test -race` чист; общая мутабельная память под `sync.Mutex`/`atomic`.
- **Каналы и `select`**: кто закрывает канал (только отправитель), нет ли отправки в закрытый
  канал; `nil`-канал в `select`; правильный `default`.
- **`defer` в циклах**: не копится ли отложенный вызов до конца функции вместо итерации.
- **Slice-aliasing**: `append` поверх под-слайса, переиспользование backing-массива.
- **Интерфейс-pollution**: интерфейсы определяются у потребителя; «accept interfaces, return structs».
- **Receiver**: согласованность value vs pointer receiver; копирование мьютекса по значению.

## Стек

- Go 1.26 (toolchain `go1.26.2`)
- Только стандартная библиотека (тесты — пакет `testing`, без внешних зависимостей)

## Источники

- [go.dev/doc/effective_go](https://go.dev/doc/effective_go) — Effective Go
- [go.dev/ref/spec](https://go.dev/ref/spec) — спецификация языка
- [go.dev/ref/mem](https://go.dev/ref/mem) — модель памяти Go
- [go.dev/blog](https://go.dev/blog) — официальный блог
- "100 Go Mistakes and How to Avoid Them" — Teiva Harsanyi
- "The Go Programming Language" — Donovan & Kernighan
