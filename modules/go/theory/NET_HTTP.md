# Go — net/http

> `net/http` — это HTTP-сервер и HTTP-клиент промышленного уровня **внутри стандартной библиотеки**.
> Никакого Spring MVC, никакого встроенного Tomcat, никаких сторонних фреймворков для старта — всё это
> уже есть в языке. Вы пишете обработчик, регистрируете его и вызываете один метод запуска сервера.
>
> Для разработчика из мира Java/Kotlin главный сдвиг: здесь нет контейнера сервлетов, нет аннотаций
> `@RestController`, нет магии DI. Сервер — это обычный объект-структура, обработчик — это интерфейс
> с одним методом, а маршрутизация — явный код. Простота обманчива: чтобы написать **корректный**
> сервер, нужно понимать таймауты, отмену через context, закрытие тел и плавное завершение.

Эта статья про **API пакета `net/http`** (как использовать сервер и клиент в Go). Теорию **самого протокола**
HTTP — версии, методы, статусы, заголовки, постоянные соединения, TLS, HTTP/2, HTTP/3 — здесь намеренно
не раскрываем; канонический владелец этой темы — [../../system-design/theory/http_networking.md](../../system-design/theory/http_networking.md).

---

## 1. Четыре кита: Handler, HandlerFunc, ResponseWriter, Request

Вся серверная модель `net/http` строится на одном интерфейсе:

```go
type Handler interface {
    ServeHTTP(w http.ResponseWriter, r *http.Request)
}
```

**`http.Handler`** — это контракт «умею обработать один HTTP-запрос». Метод `ServeHTTP` получает два
аргумента:

- **`w http.ResponseWriter`** — то, во что вы пишете ответ. Это интерфейс: вы устанавливаете заголовки,
  пишете код статуса и тело. Аналог `HttpServletResponse` — и, как он, это **интерфейс** (конкретную реализацию даёт рантайм/контейнер).
- **`r *http.Request`** — входящий запрос: метод, URL, заголовки, тело, контекст. Указатель, потому что
  структура большая и местами изменяемая. Аналог `HttpServletRequest`.

Заметьте: `ServeHTTP` ничего **не возвращает**. Вы не возвращаете объект ответа — вы **пишете** его в `w`.
Это императивная модель «толкаем байты в поток ответа».

### http.HandlerFunc — адаптер функция → интерфейс

Реализовывать целый тип со методом `ServeHTTP` ради одной функции-обработчика утомительно. Поэтому в
стандартной библиотеке есть готовый адаптер:

```go
type HandlerFunc func(http.ResponseWriter, *http.Request)

// HandlerFunc сам реализует Handler, просто вызывая себя.
func (f HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    f(w, r)
}
```

Это **образцовый пример приёма «функция как реализация интерфейса»**, разобранного в
[./INTERFACES.md](./INTERFACES.md). Метод объявлен **на функциональном типе**. Любую обычную функцию
с подходящей сигнатурой можно привести к `http.HandlerFunc` — и она мгновенно становится `http.Handler`:

```go
func hello(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "hello")
}

var h http.Handler = http.HandlerFunc(hello) // обычная функция → объект Handler
```

В Java для подобного пришлось бы писать анонимный класс или лямбду под функциональный интерфейс.
В Go это «бесплатное» преобразование типа. Большинство обработчиков в реальном коде — именно
`http.HandlerFunc`, а не отдельные типы.

### Базовый обработчик целиком

```go
func handleHello(w http.ResponseWriter, r *http.Request) {
    name := r.URL.Query().Get("name") // ?name=...
    if name == "" {
        name = "world"
    }
    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
    w.WriteHeader(http.StatusOK)          // 200
    fmt.Fprintf(w, "hello, %s\n", name)
}
```

---

## 2. ServeMux: маршрутизация

**`http.ServeMux`** (от *multiplexer*) — встроенный маршрутизатор. Он сам реализует `http.Handler`:
получает запрос, выбирает зарегистрированный обработчик по шаблону пути и делегирует ему. Это
прямой аналог того, что в Spring делает `DispatcherServlet`, только без аннотаций — маршруты
регистрируются явным кодом.

```go
mux := http.NewServeMux()
mux.HandleFunc("/hello", handleHello)        // регистрируем функцию
mux.Handle("/api/", apiHandler)              // регистрируем Handler (любой объект)
```

- `Handle(pattern, handler)` принимает `http.Handler`.
- `HandleFunc(pattern, f)` — удобная обёртка: сама заворачивает функцию в `http.HandlerFunc`.

### Маршрутизация до Go 1.22 (важно знать про старый код)

Исторически `ServeMux` был очень примитивным:

- сопоставление **только по пути**, без учёта HTTP-метода (различать `GET`/`POST` приходилось
  вручную внутри обработчика через `if r.Method == ...`);
- никаких параметров пути (`{id}`) — путь вроде `/items/42` пришлось бы парсить руками из `r.URL.Path`;
- единственное правило приоритета: **самый длинный совпавший префикс**. Шаблон, оканчивающийся на `/`
  (например `/api/`), означает «поддерево» и совпадает со всеми путями под ним; шаблон без слэша
  (`/hello`) — точное совпадение.

Именно из-за этих ограничений в экосистеме появились сторонние маршрутизаторы: **chi**, **gorilla/mux**,
**httprouter**. Они давали параметры пути, привязку к методам, группы маршрутов и middleware. Если
встречаете их в проекте — это, как правило, наследие до 1.22 или потребность в фичах, которых в stdlib
нет до сих пор (например, регулярные выражения в путях). Углубляться в них не будем: для большинства
сервисов на современном Go хватает стандартного `ServeMux`.

### Маршрутизация в Go 1.22+: метод + шаблон + wildcards

С Go 1.22 встроенный `ServeMux` получил расширенные шаблоны — то, ради чего раньше тянули chi/gorilla.
Теперь это часть стандартной библиотеки.

**Шаблон может включать HTTP-метод:**

```go
mux.HandleFunc("GET /items/{id}", handleGetItem)
mux.HandleFunc("PUT /items/{id}", handlePutItem)
mux.HandleFunc("DELETE /items/{id}", handleDeleteItem)
mux.HandleFunc("GET /items", handleListItems)
mux.HandleFunc("POST /items", handleCreateItem)
```

| Элемент шаблона | Что означает |
|---|---|
| `GET /items` | метод `GET` + точный путь `/items` |
| `/items/{id}` | wildcard-сегмент: `{id}` ловит ровно **один** сегмент пути |
| `/files/{path...}` | завершающий wildcard: `{path...}` ловит **остаток** пути (несколько сегментов) |
| `/items/{$}` | `{$}` означает «конец пути»: совпадает только с `/items/`, но не с поддеревом |
| `/items/` (со слэшем) | поддерево: совпадает со всем под `/items/` |

Значения wildcard читаются из запроса методом **`r.PathValue("id")`**:

```go
func handleGetItem(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id") // строка "42" из пути /items/42
    // ... найти item по id ...
}
```

**Приоритет при пересечении шаблонов.** Если запросу подходит несколько шаблонов, выигрывает **более
специфичный** (тот, чьё множество совпадающих путей строго уже). Например, `/items/{id}` специфичнее, чем
`/items/{path...}`. Если два шаблона пересекаются, но ни один не специфичнее другого, `ServeMux` **паникует
при регистрации** — это намеренно: конфликт ловится на старте, а не в рантайме. Шаблон с указанным методом
специфичнее, чем тот же путь без метода.

> Автоматический бонус 1.22: для пути, у которого зарегистрирован только `GET`, запрос `HEAD`
> обрабатывается тем же обработчиком, а на несовпавший метод `ServeMux` сам отдаёт `405 Method Not Allowed`
> с заголовком `Allow`.

---

## 3. Сервер: http.Server и таймауты

Запустить сервер «по-быстрому» можно одной строкой:

```go
// nil как handler означает «использовать http.DefaultServeMux».
log.Fatal(http.ListenAndServe(":8080", mux))
```

`http.ListenAndServe` блокируется навсегда (пока сервер жив) и возвращает ошибку при остановке.
Но **для продакшена так делать нельзя** — у этого варианта нет таймаутов. Создавайте `http.Server`
явно:

```go
srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       15 * time.Second,
    WriteTimeout:      15 * time.Second,
    IdleTimeout:       60 * time.Second,
}
log.Fatal(srv.ListenAndServe())
```

### Почему таймауты критичны

По умолчанию `http.Server` **не имеет ни одного таймаута**. Медленный или вредоносный клиент,
открывший соединение и отправляющий заголовки по одному байту в секунду (классическая атака
**Slowloris**), удержит горутину и сокет занятыми сколь угодно долго. Без лимитов это прямой путь
к исчерпанию ресурсов.

| Поле | Что ограничивает | Зачем |
|---|---|---|
| `ReadHeaderTimeout` | время на чтение **заголовков** запроса | дёшево закрывает Slowloris; ставьте всегда |
| `ReadTimeout` | время на чтение всего запроса (заголовки + тело) | защита от медленной отправки тела |
| `WriteTimeout` | время от конца чтения заголовков до конца записи ответа | не дать медленному клиенту-читателю висеть вечно |
| `IdleTimeout` | время простоя постоянного соединения между запросами | освобождает keep-alive-соединения, держащие сокет зря |

**Минимальный разумный набор** — хотя бы `ReadHeaderTimeout` и `IdleTimeout`; полноценный — все четыре.
Это первое, что проверяют на code review серверного кода на Go.

### Модель горутин: соединение и запрос — в своей горутине

`net/http` обрабатывает каждое **входящее соединение в отдельной горутине**, а в рамках HTTP/2 — каждый
**запрос** в своей горутине. Вам не нужно ничего настраивать: сервер сам мультиплексирует тысячи
соединений на горутинах, дёшево создаваемых планировщиком (см. [./SCHEDULER.md](./SCHEDULER.md)).

Прямое следствие: **ваш обработчик исполняется конкурентно** многими горутинами одновременно. Любое
**общее изменяемое состояние** между запросами (счётчики, кэши, map в памяти) обязано быть
синхронизировано — через `sync.Mutex`/`sync.RWMutex`, атомарные операции или каналы. Это ровно те же
правила, что в [./CONCURRENCY_PATTERNS.md](./CONCURRENCY_PATTERNS.md) и [./GOROUTINES_CHANNELS.md](./GOROUTINES_CHANNELS.md).
Незащищённая `map`, в которую пишут два запроса одновременно, — гонка данных и паника рантайма
(`concurrent map writes`). В мире сервлетов вы привыкли, что singleton-бин должен быть потокобезопасным;
здесь ровно то же самое и так же строго.

---

## 4. Работа с запросом и ответом

### Чтение тела запроса

Тело запроса — это `r.Body` типа `io.ReadCloser` (см. [./STDLIB_CORE.md](./STDLIB_CORE.md)). Два правила:

1. **Ограничивайте размер.** Неограниченное тело — это OOM-вектор: клиент пришлёт гигабайты, и сервер
   попытается всё прочитать. Оборачивайте тело в **`http.MaxBytesReader`**:

```go
r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // не больше 1 MiB
```

   При превышении лимита чтение вернёт ошибку, а `MaxBytesReader` ещё и аккуратно подскажет серверу
   закрыть соединение.

2. **Закрывать тело на стороне сервера обычно не обязательно** — это сделает сам сервер после
   завершения обработчика. (А вот тело **ответа клиента** закрывать обязательно — см. раздел 6.)

Декодирование JSON из тела — потоково, через `json.Decoder`:

```go
var in Item
dec := json.NewDecoder(r.Body)
dec.DisallowUnknownFields()              // строгий разбор: лишние поля → ошибка
if err := dec.Decode(&in); err != nil {
    http.Error(w, "bad request body", http.StatusBadRequest) // 400
    return
}
```

### r.Context(): отмена со стороны клиента

У каждого запроса есть **`r.Context()`** типа `context.Context`. Этот контекст **отменяется
автоматически**, когда клиент разрывает соединение или истекает таймаут сервера. Прокидывайте его во
все нижележащие вызовы (запросы в БД, исходящие HTTP-вызовы), чтобы при уходе клиента ненужная работа
прерывалась, а не доделывалась впустую:

```go
func handleGetItem(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    item, err := store.Load(ctx, r.PathValue("id")) // ctx прокинут в БД-слой
    if err != nil {
        // ...
    }
    // ...
}
```

Семантика и приёмы работы с context (отмена, дедлайны, проброс значений) — в
[./CONCURRENCY_PATTERNS.md](./CONCURRENCY_PATTERNS.md).

### Заголовки, статусы, порядок WriteHeader/Write

Запись ответа подчиняется строгому порядку:

```go
w.Header().Set("Content-Type", "application/json") // 1) заголовки — ДО WriteHeader
w.WriteHeader(http.StatusCreated)                  // 2) код статуса (один раз!)
w.Write(body)                                       // 3) тело
```

Три ловушки:

- **Заголовки нужно установить до `WriteHeader`/`Write`.** После того как статус отправлен, изменения
  в `w.Header()` уже не попадут в ответ — заголовки на проводе зафиксированы.
- **Первый `Write` неявно делает `WriteHeader(200)`.** Если вы хотите статус, отличный от 200, вызовите
  `WriteHeader` **до** первого `Write`. Повторный `WriteHeader` будет проигнорирован с предупреждением.
- **После `WriteHeader` поздно слать другой статус.** Это частый баг: записали тело (→ ушёл 200),
  потом наткнулись на ошибку и хотите вернуть 500 — уже нельзя.

**`http.Error(w, msg, code)`** — хелпер: ставит `Content-Type: text/plain`, вызывает `WriteHeader(code)`
и пишет сообщение. Удобно для путей ошибок.

### Запись JSON

```go
func writeJSON(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    if err := json.NewEncoder(w).Encode(v); err != nil {
        // заголовки уже ушли — статус не изменить; только логируем
        log.Printf("encode response: %v", err)
    }
}
```

`json.NewEncoder(w).Encode(v)` пишет JSON **прямо в поток ответа** (без промежуточного `[]byte`).
Минус: если кодирование упадёт на середине, статус и часть тела уже отправлены — поэтому объект лучше
готовить заранее. `Encode` добавляет завершающий перевод строки — это нормально.

---

## 5. Middleware: декораторы обработчиков

В Spring у вас есть фильтры и интерсепторы. В Go аналог называется **middleware** и выражается одним
идиоматичным типом — функция, **оборачивающая** один `http.Handler` в другой:

```go
func(next http.Handler) http.Handler
```

Middleware принимает «следующий» обработчик и возвращает новый, который делает что-то **до** и/или
**после** вызова `next.ServeHTTP`. Это классический паттерн «декоратор».

```go
func WithLogging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)                 // передаём управление дальше по цепочке
        log.Printf("%s %s — %s", r.Method, r.URL.Path, time.Since(start))
    })
}
```

Обратите внимание: внутри снова используется адаптер `http.HandlerFunc` (раздел 1) — middleware
возвращает обычную функцию, превращённую в `http.Handler`.

### Цепочка middleware

Несколько middleware **композируются** оборачиванием. Применяются они в порядке обёртывания снаружи
внутрь, а «разворачиваются» (код после `next`) — в обратном:

```go
var handler http.Handler = mux
handler = WithLogging(handler)
handler = WithRequestID(handler)
handler = WithRecover(handler)   // применён последним → самый внешний: ловит панику всех middleware и mux
// порядок входа: Recover → RequestID → Logging → mux
```

### Типовые middleware

- **Логирование** — как выше: время, метод, путь, код ответа.
- **Recover (восстановление после паники)** — критично для сервера. Паника в одном обработчике без
  перехвата уронит **всю горутину соединения**; `net/http` имеет собственный встроенный recover, но
  своё middleware даёт контроль над логом и кодом ответа (`500`). Механика `recover`/`defer` — в
  [./ERRORS_PANIC.md](./ERRORS_PANIC.md):

```go
func WithRecover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic: %v", rec)
                http.Error(w, "internal server error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

- **Аутентификация** — проверить заголовок `Authorization`/токен; при провале вернуть `401` и **не**
  вызывать `next`.

### Проброс значений через context

Middleware часто кладёт что-то в контекст запроса (ID запроса, данные пользователя), чтобы нижние
обработчики могли это прочитать. Делается это **неизменяемым копированием** запроса с новым контекстом
через `r.WithContext`:

```go
type ctxKey int
const requestIDKey ctxKey = 0

func WithRequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := newID()
        w.Header().Set("X-Request-ID", id)
        ctx := context.WithValue(r.Context(), requestIDKey, id)
        next.ServeHTTP(w, r.WithContext(ctx)) // дальше идёт запрос с обогащённым контекстом
    })
}
```

Тип ключа делают **неэкспортируемым** (`ctxKey`), чтобы чужой пакет не мог случайно перезаписать
значение. Хранить в context значения «для удобства» (то, что должно быть явным аргументом) — антипаттерн;
context — для request-scoped метаданных и отмены.

---

## 6. Клиент: http.Client

Серверная половина — половина пакета. Вторая — HTTP-клиент.

### Никогда не используйте http.DefaultClient без таймаута

Самая частая ошибка новичков:

```go
resp, err := http.Get(url)            // ❌ под капотом http.DefaultClient — БЕЗ таймаута
```

`http.Get`/`http.Post` и `http.DefaultClient` **не имеют таймаута**. Зависший сервер на той стороне
заставит ваш вызов висеть **бесконечно**, удерживая горутину и соединение. Всегда создавайте свой
клиент с таймаутом:

```go
client := &http.Client{
    Timeout: 10 * time.Second, // на весь запрос целиком: соединение + отправка + получение тела
}
```

### Отмена через context (предпочтительный способ)

`Client.Timeout` — грубый общий лимит. Тонкий контроль (и проброс отмены сверху) даёт **context на
конкретном запросе**:

```go
req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
if err != nil {
    return err
}
resp, err := client.Do(req)
```

`ctx` (например, из `r.Context()` входящего запроса) свяжет жизнь исходящего вызова с жизнью входящего:
ушёл клиент — отменился и ваш downstream-запрос.

### Обязательно закрывайте resp.Body

Это правило нарушают чаще всего — и оно дорого обходится:

```go
resp, err := client.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()          // ✅ ВСЕГДА, сразу после проверки err

body, err := io.ReadAll(resp.Body)
// ...
```

Почему это обязательно:

- **`resp.Body` — это `io.ReadCloser`, и его обязан закрыть вызывающий.** Незакрытое тело — **утечка**:
  держится сетевое соединение и связанные с ним горутины/файловые дескрипторы.
- **Незакрытое (или недочитанное) тело ломает переиспользование соединений.** Транспорт может вернуть
  TCP-соединение в пул для keep-alive **только если тело прочитано до конца и закрыто**. Иначе на каждый
  запрос открывается новое соединение — деградация производительности и исчерпание сокетов.

`defer resp.Body.Close()` ставят **сразу после** проверки `err != nil` (при ошибке `resp` может быть `nil`,
поэтому defer — после проверки). Если тело не нужно целиком, но соединение хочется переиспользовать —
«досасывают» остаток через `io.Copy(io.Discard, resp.Body)` перед закрытием.

### Переиспользование клиента и пул соединений

```go
// ❌ Антипаттерн: новый Client на каждый запрос — не переиспользует соединения,
//    плодит сокеты, теряет смысл keep-alive.
func bad(url string) { c := &http.Client{}; c.Get(url) }
```

`http.Client` **потокобезопасен и предназначен для переиспользования**. Создавайте его **один раз**
(на приложение или на интеграцию) и используйте из множества горутин. Внутри клиента живёт
**`http.Transport`** — он держит **пул постоянных TCP-соединений** (keep-alive) и переиспользует их
между запросами. Тонкая настройка (`MaxIdleConns`, `MaxIdleConnsPerHost`, `IdleConnTimeout`) делается
именно на `Transport`. Создавая клиент на каждый вызов, вы выбрасываете этот пул — и каждый раз платите
за новое TCP/TLS-рукопожатие (handshake).

---

## 7. Graceful shutdown (плавное завершение)

При деплое/перезапуске нельзя обрывать соединения на полуслове: нужно **перестать принимать новые
запросы, дать активным доработаться** и только потом выйти. Для этого есть `srv.Shutdown(ctx)`.

`signal.NotifyContext` даёт контекст, который **отменяется по сигналу ОС** (`SIGINT`/`SIGTERM` — то, что
шлёт Ctrl+C, Kubernetes при остановке пода, systemd):

```go
func main() {
    srv := &http.Server{Addr: ":8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second}

    // ctx отменится при SIGINT/SIGTERM.
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("server error: %v", err)
        }
    }()

    <-ctx.Done() // ждём сигнал
    log.Println("shutting down…")

    // даём активным запросам максимум 10 секунд на завершение.
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Printf("graceful shutdown failed: %v", err)
    }
}
```

Ключевые детали:

- После сигнала `srv.Shutdown(ctx)` **закрывает слушающий сокет** (новые соединения не принимаются),
  закрывает простаивающие keep-alive-соединения и **ждёт завершения активных запросов**.
- Сам `ListenAndServe` при этом немедленно возвращает **`http.ErrServerClosed`** — это **не ошибка**,
  а штатный сигнал «сервер закрыт через Shutdown». Его нужно отличать от настоящих ошибок (как в примере).
- `ctx`, переданный в `Shutdown`, задаёт **дедлайн ожидания**: если активные запросы не уложились в
  10 секунд, `Shutdown` вернёт ошибку контекста, и вы выходите принудительно.

Это идиоматический скелет любого продакшен-сервиса на Go.

---

## 8. Тестирование (коротко)

Стандартный пакет **`net/http/httptest`** позволяет тестировать обработчики **без поднятия реального
сокета**, через фейковый `ResponseWriter`:

```go
func TestHello(t *testing.T) {
    req := httptest.NewRequest(http.MethodGet, "/hello?name=go", nil)
    rec := httptest.NewRecorder() // ResponseRecorder перехватывает ответ

    handler.ServeHTTP(rec, req)   // вызываем обработчик напрямую

    if rec.Code != http.StatusOK {
        t.Fatalf("status = %d, want 200", rec.Code)
    }
    // rec.Body.String(), rec.Header() — проверяем результат
}
```

- `httptest.NewRequest` строит `*http.Request` для теста, `httptest.NewRecorder` даёт
  `*httptest.ResponseRecorder` — он записывает статус, заголовки и тело в поля, доступные для проверки.
- Если нужен **настоящий** HTTP-уровень (реальный клиент, реальный сетевой стек), есть
  `httptest.NewServer`, поднимающий сервер на случайном порту локально.

Подробно — стратегии, table-driven тесты, `-race`, моки — в [./TESTING_GO.md](./TESTING_GO.md).

---

## Типичные ошибки (шпаргалка)

| Ошибка | Симптом | Лечение |
|---|---|---|
| `http.ListenAndServe` без таймаутов | Slowloris, висящие соединения, утечка ресурсов | явный `http.Server` с `ReadHeaderTimeout`/`IdleTimeout` и др. |
| Незакрытый `resp.Body` у клиента | утечка соединений, нет keep-alive, рост числа сокетов | `defer resp.Body.Close()` сразу после проверки `err` |
| `http.Get`/`http.DefaultClient` | вызов висит вечно при зависшем сервере | свой `http.Client{Timeout: …}` или `NewRequestWithContext` |
| Новый `http.Client` на каждый запрос | потеря пула соединений, лишние handshake | создать клиент один раз, переиспользовать |
| `w.Header().Set` после `WriteHeader` | заголовок не попал в ответ | ставить все заголовки **до** `WriteHeader`/`Write` |
| Повторный/поздний `WriteHeader` | «superfluous WriteHeader call», не тот статус | один `WriteHeader` до первого `Write`; `return` после ошибки |
| Незащищённая `map`/счётчик в обработчике | `concurrent map writes`, гонка данных | `sync.RWMutex`/atomic; запускать тесты с `-race` |
| Неограниченное `r.Body` | OOM от гигантского тела | `http.MaxBytesReader(w, r.Body, N)` |
| Игнор `r.Context()` в downstream | работа продолжается после ухода клиента | прокидывать `ctx` в БД/HTTP-вызовы |
| `Shutdown` без обработки `ErrServerClosed` | ложная «ошибка» при штатной остановке | трактовать `http.ErrServerClosed` как норму |
| Конфликтующие шаблоны 1.22 | паника при регистрации маршрута | сделать один шаблон специфичнее или развести пути |

---

## Где почитать дальше

- [./STDLIB_CORE.md](./STDLIB_CORE.md) — `io.Reader`/`Writer`/`Closer`, `encoding/json`, `io.Copy`/`io.Discard` — фундамент чтения тел и сериализации.
- [./CONCURRENCY_PATTERNS.md](./CONCURRENCY_PATTERNS.md) — `context.Context`: отмена, дедлайны, проброс значений; конкурентный доступ к общему состоянию обработчиков.
- [./ERRORS_PANIC.md](./ERRORS_PANIC.md) — `recover`/`defer` под капотом middleware-восстановления, обработка ошибок в обработчиках.
- [./TESTING_GO.md](./TESTING_GO.md) — подробное тестирование HTTP: `httptest`, table-driven, `-race`, моки клиента.

Теория **протокола** HTTP (методы, статусы, заголовки, версии, TLS, постоянные соединения) — каноничный
владелец [../../system-design/theory/http_networking.md](../../system-design/theory/http_networking.md).

---

## Источники

- [pkg.go.dev/net/http](https://pkg.go.dev/net/http) — справочник пакета: `Handler`, `HandlerFunc`, `ServeMux`, `Server`, `Client`, `Transport`, семантика таймаутов и `Shutdown`.
- [go.dev/blog/routing-enhancements](https://go.dev/blog/routing-enhancements) — расширенная маршрутизация `ServeMux` в Go 1.22: методы, wildcards `{id}`/`{path...}`, правила приоритета и конфликтов.
- [go.dev/doc/articles/wiki](https://go.dev/doc/articles/wiki) — каноничный туториал «Writing Web Applications»: обработчики, `ResponseWriter`, `Request` с нуля.
