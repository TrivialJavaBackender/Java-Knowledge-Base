# Go — упражнения

Каждое упражнение — отдельный пакет в своей директории `exNN_<имя>/`:

- `exNN.go` — условие в doc-комментарии + сигнатуры функций со стаб-телом (`panic("TODO")`).
  Реализуй сам — подсказок в коде нет.
- `exNN_test.go` — проверяющие тесты (table-driven, только stdlib `testing`). Менять не нужно.

Зависимостей нет — только стандартная библиотека, работает офлайн.

## Как запускать

```bash
# из modules/go/exercises

go test ./...                 # все упражнения
go test ./ex01_basics/        # одно упражнение
go test -race ./...           # с детектором гонок (обязательно для ex06/ex07/ex12)
go test -run TestName ./ex06_channels/   # один тест
go test -bench=. ./ex11_testing/         # бенчмарки

go vet ./...                  # статический анализ
gofmt -l .                    # проверка форматирования (пусто = ок)
```

До реализации тесты **падают** — это нормально. Цель — сделать их зелёными.

## Список

| Дир | Тема | Теория |
|-----|------|--------|
| `ex01_basics`      | синтаксис, функции, множественный возврат | [BASICS](../theory/BASICS.md) |
| `ex02_structs`     | struct, методы, встраивание | [TYPES_STRUCTS_METHODS](../theory/TYPES_STRUCTS_METHODS.md) |
| `ex03_interfaces`  | интерфейсы, type switch | [INTERFACES](../theory/INTERFACES.md) |
| `ex04_errors`      | оборачивание ошибок, `errors.Is/As` | [ERRORS_PANIC](../theory/ERRORS_PANIC.md) |
| `ex05_collections` | слайсы/map, append-ловушки | [SLICES_MAPS_STRINGS](../theory/SLICES_MAPS_STRINGS.md) |
| `ex06_channels`    | горутины, каналы, pipeline | [GOROUTINES_CHANNELS](../theory/GOROUTINES_CHANNELS.md) |
| `ex07_workerpool`  | worker pool + `context` | [CONCURRENCY_PATTERNS](../theory/CONCURRENCY_PATTERNS.md) |
| `ex08_generics`    | дженерики, constraints | [GENERICS](../theory/GENERICS.md) |
| `ex09_io_json`     | io.Reader, encoding/json | [STDLIB_CORE](../theory/STDLIB_CORE.md) |
| `ex10_http`        | net/http, middleware, httptest | [NET_HTTP](../theory/NET_HTTP.md) |
| `ex11_testing`     | table-driven тесты, бенчмарки | [TESTING_GO](../theory/TESTING_GO.md) |
| `ex12_sync`        | sync-примитивы, thread-safe кэш, `-race` | [MEMORY_GC](../theory/MEMORY_GC.md) |
