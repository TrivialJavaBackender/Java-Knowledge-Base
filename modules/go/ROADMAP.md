# Go — Roadmap

Структурированный план изучения Go с нуля (для разработчика из Java/Kotlin).
Теория в папке `theory/`, упражнения — в `exercises/`. Каждая тема — чеклист со ссылками.

---

## Порядок прохождения

| # | Тема | Частота на собесах |
|---|------|--------------------|
| 1 | Tooling & Modules | ★★★☆☆ |
| 2 | Основы синтаксиса | ★★★★★ |
| 3 | Типы, struct, методы | ★★★★★ |
| 4 | Интерфейсы | ★★★★★ |
| 5 | Ошибки, panic, defer | ★★★★★ |
| 6 | Слайсы, maps, строки | ★★★★★ |
| 7 | Горутины и каналы | ★★★★★ |
| 8 | Паттерны конкурентности | ★★★★★ |
| 9 | Шедулер (GMP) | ★★★★☆ |
| 10 | Память и GC | ★★★★☆ |
| 11 | Дженерики | ★★★★☆ |
| 12 | Стандартная библиотека | ★★★★☆ |
| 13 | net/http | ★★★★☆ |
| 14 | Тестирование | ★★★★☆ |
| 15 | Идиомы и паттерны | ★★★☆☆ |
| 16 | Производительность и профилирование | ★★★☆☆ |

---

## 1. Tooling & Modules

📖 Теория: [theory/TOOLING_MODULES.md](theory/TOOLING_MODULES.md)

- [ ] `go build` / `run` / `test` / `vet` / `fmt` / `install`
- [ ] go modules: `go.mod`, `go.sum`, semantic import versioning
- [ ] `go get` / `go mod tidy` / `go mod download` / vendoring
- [ ] `go.work` (multi-module workspace)
- [ ] Структура проекта (`cmd/`, `internal/`, пакет = директория)
- [ ] Эволюция GOPATH → modules

---

## 2. Основы синтаксиса

📖 Теория: [theory/BASICS.md](theory/BASICS.md)

- [ ] Пакеты, `import`, `func main`
- [ ] `var`, `:=`, `const`, `iota`; zero values
- [ ] Базовые типы, преобразования (без неявных)
- [ ] `for` — единственный цикл (3 формы + `range`)
- [ ] `if`, `switch` (без `break`, `fallthrough`)
- [ ] Функции: множественный возврат, named returns, variadic
- [ ] Exported/unexported по заглавной букве

**Упражнение:** [ex01_basics](exercises/ex01_basics/)

---

## 3. Типы, struct, методы

📖 Теория: [theory/TYPES_STRUCTS_METHODS.md](theory/TYPES_STRUCTS_METHODS.md)

- [ ] `struct`, инициализация, анонимные структуры
- [ ] Методы; value vs pointer receiver — когда какой
- [ ] Встраивание (embedding) — композиция вместо наследования
- [ ] Теги полей (struct tags)
- [ ] Сравнимость структур
- [ ] `type` definition vs `type` alias

**Упражнение:** [ex02_structs](exercises/ex02_structs/)

---

## 4. Интерфейсы

📖 Теория: [theory/INTERFACES.md](theory/INTERFACES.md)

- [ ] Неявная реализация (structural typing)
- [ ] `any` / пустой интерфейс
- [ ] Type assertion (`x.(T)`, comma-ok), type switch
- [ ] Устройство интерфейсного значения (itab + data pointer)
- [ ] Nil-interface trap (typed nil)
- [ ] «Accept interfaces, return structs»

**Упражнение:** [ex03_interfaces](exercises/ex03_interfaces/)

---

## 5. Ошибки, panic, defer

📖 Теория: [theory/ERRORS_PANIC.md](theory/ERRORS_PANIC.md)

- [ ] `error` — это значение; идиома `if err != nil`
- [ ] Sentinel errors, кастомные типы ошибок
- [ ] Оборачивание: `fmt.Errorf("%w")`, `errors.Is` / `errors.As`
- [ ] `panic` / `recover`; когда уместно паниковать
- [ ] `defer`: порядок (LIFO), аргументы вычисляются сразу
- [ ] `defer` + named return для модификации результата

**Упражнение:** [ex04_errors](exercises/ex04_errors/)

---

## 6. Слайсы, maps, строки

📖 Теория: [theory/SLICES_MAPS_STRINGS.md](theory/SLICES_MAPS_STRINGS.md)

- [ ] Массив vs слайс; слайс-хедер (ptr/len/cap)
- [ ] `append`, рост ёмкости, ловушки aliasing
- [ ] `copy`, трёхиндексный слайс `s[a:b:c]`
- [ ] `map`: устройство, `comma-ok`, случайный порядок итерации
- [ ] `string` vs `[]byte` vs `[]rune`, UTF-8
- [ ] Nil-слайс vs пустой слайс; nil-map (чтение vs запись)

**Упражнение:** [ex05_collections](exercises/ex05_collections/)

---

## 7. Горутины и каналы

📖 Теория: [theory/GOROUTINES_CHANNELS.md](theory/GOROUTINES_CHANNELS.md)

- [ ] `go` — запуск горутины, стоимость
- [ ] Каналы: буферизованные vs небуферизованные
- [ ] Send/receive/close/`range`; кто закрывает канал
- [ ] `select`, `default`, nil-канал
- [ ] Обнаружение deadlock («all goroutines are asleep»)
- [ ] `for range` по каналу, паттерн поллинга

**Упражнение:** [ex06_channels](exercises/ex06_channels/)

---

## 8. Паттерны конкурентности

📖 Теория: [theory/CONCURRENCY_PATTERNS.md](theory/CONCURRENCY_PATTERNS.md)

- [ ] Worker pool, fan-in / fan-out, pipeline
- [ ] `context.Context`: cancellation, timeout, values
- [ ] `sync`: WaitGroup, Mutex, RWMutex, Once, Cond
- [ ] `sync/atomic`
- [ ] `golang.org/x/sync/errgroup`, semaphore (паттерн)
- [ ] Rate limiting (`time.Ticker`, token bucket)

**Упражнение:** [ex07_workerpool](exercises/ex07_workerpool/)

---

## 9. Шедулер (GMP)

📖 Теория: [theory/SCHEDULER.md](theory/SCHEDULER.md)

- [ ] Модель GMP (Goroutine / Machine / Processor)
- [ ] Жизненный цикл горутины, состояния
- [ ] Preemption (асинхронная, начиная с 1.14)
- [ ] Обработка syscall, hand-off P
- [ ] `GOMAXPROCS`, work-stealing
- [ ] Сравнение с JVM virtual threads (M:N)

---

## 10. Память и GC

📖 Теория: [theory/MEMORY_GC.md](theory/MEMORY_GC.md)

- [ ] Модель памяти Go (happens-before, гарантии sync/каналов)
- [ ] Data race; детектор гонок `-race`
- [ ] GC: конкурентный tri-color mark-sweep, non-moving
- [ ] `GOGC`, soft memory limit (`GOMEMLIMIT`), pacer
- [ ] Stack vs heap, escape analysis
- [ ] Рост стека горутины

**Упражнение:** [ex12_sync](exercises/ex12_sync/)

---

## 11. Дженерики

📖 Теория: [theory/GENERICS.md](theory/GENERICS.md)

- [ ] Type parameters, инстанцирование, вывод типов
- [ ] Constraints: интерфейсы-ограничения, `comparable`, `~` underlying
- [ ] Пакет `constraints`, типовые множества
- [ ] Когда дженерики уместны (и когда нет)
- [ ] Реализация: GC shape stenciling + dictionaries
- [ ] Контраст с Java type erasure

**Упражнение:** [ex08_generics](exercises/ex08_generics/)

---

## 12. Стандартная библиотека

📖 Теория: [theory/STDLIB_CORE.md](theory/STDLIB_CORE.md)

- [ ] `io.Reader` / `Writer` / `Closer`, `io.Copy`, `bufio`
- [ ] `os`, `fmt`, `strconv`, `strings`, `bytes`
- [ ] `time` (Duration, Timer, Ticker, layout)
- [ ] `sort`, `slices`, `maps`
- [ ] `encoding/json`: struct tags, Marshal/Unmarshal, custom

**Упражнение:** [ex09_io_json](exercises/ex09_io_json/)

---

## 13. net/http

📖 Теория: [theory/NET_HTTP.md](theory/NET_HTTP.md)

- [ ] `http.Handler` / `HandlerFunc`, `ServeMux`
- [ ] Routing в `ServeMux` 1.22 (методы, wildcards)
- [ ] Middleware (декораторы обработчиков)
- [ ] `http.Client`, таймауты, `context` в запросе
- [ ] Graceful shutdown (`Server.Shutdown`)
- [ ] Идиомы REST-обработчиков

**Упражнение:** [ex10_http](exercises/ex10_http/)

---

## 14. Тестирование

📖 Теория: [theory/TESTING_GO.md](theory/TESTING_GO.md)

- [ ] `testing.T`, table-driven тесты
- [ ] `t.Run` (subtests), `t.Parallel`, `t.Helper`
- [ ] Бенчмарки (`testing.B`, `b.N`, `b.ReportAllocs`)
- [ ] Fuzzing (`testing.F`)
- [ ] Testable examples (`Example...`)
- [ ] Покрытие, `-race`, `httptest`

**Упражнение:** [ex11_testing](exercises/ex11_testing/)

---

## 15. Идиомы и паттерны

📖 Теория: [theory/IDIOMS_PATTERNS.md](theory/IDIOMS_PATTERNS.md)

- [ ] Naming conventions (короткие имена, без геттеров)
- [ ] Паттерны `defer` (cleanup, unlock)
- [ ] Замыкания
- [ ] Functional options
- [ ] Стиль обработки ошибок (ранний возврат)
- [ ] Полезность zero value; дизайн пакетов

---

## 16. Производительность и профилирование

📖 Теория: [theory/PERFORMANCE_PROFILING.md](theory/PERFORMANCE_PROFILING.md)

- [ ] `pprof`: CPU / heap / goroutine / block / mutex
- [ ] Бенчмаркинг, `benchstat`
- [ ] Escape analysis (`go build -gcflags=-m`)
- [ ] `sync.Pool`, преаллокация слайсов
- [ ] Инлайнинг
- [ ] `GODEBUG`, `runtime/metrics`

---

## Файлы теории

| Файл | Тема |
|------|------|
| [theory/TOOLING_MODULES.md](theory/TOOLING_MODULES.md) | 1 |
| [theory/BASICS.md](theory/BASICS.md) | 2 |
| [theory/TYPES_STRUCTS_METHODS.md](theory/TYPES_STRUCTS_METHODS.md) | 3 |
| [theory/INTERFACES.md](theory/INTERFACES.md) | 4 |
| [theory/ERRORS_PANIC.md](theory/ERRORS_PANIC.md) | 5 |
| [theory/SLICES_MAPS_STRINGS.md](theory/SLICES_MAPS_STRINGS.md) | 6 |
| [theory/GOROUTINES_CHANNELS.md](theory/GOROUTINES_CHANNELS.md) | 7 |
| [theory/CONCURRENCY_PATTERNS.md](theory/CONCURRENCY_PATTERNS.md) | 8 |
| [theory/SCHEDULER.md](theory/SCHEDULER.md) | 9 |
| [theory/MEMORY_GC.md](theory/MEMORY_GC.md) | 10 |
| [theory/GENERICS.md](theory/GENERICS.md) | 11 |
| [theory/STDLIB_CORE.md](theory/STDLIB_CORE.md) | 12 |
| [theory/NET_HTTP.md](theory/NET_HTTP.md) | 13 |
| [theory/TESTING_GO.md](theory/TESTING_GO.md) | 14 |
| [theory/IDIOMS_PATTERNS.md](theory/IDIOMS_PATTERNS.md) | 15 |
| [theory/PERFORMANCE_PROFILING.md](theory/PERFORMANCE_PROFILING.md) | 16 |
