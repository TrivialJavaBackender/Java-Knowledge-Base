# Go — Стандартная библиотека

> Стандартная библиотека Go — это «батарейки в комплекте»: ввод-вывод, форматирование,
> работа со временем, кодирование, сортировка — всё под рукой, без сторонних зависимостей.
> Её устройство опирается на одну идею: **малые интерфейсы** (`io.Reader`, `io.Writer`)
> и свободная композиция типов вокруг них.
>
> Разработчику из Java/Kotlin полезно держать в голове аналогии: `io.Reader` ≈ `InputStream`,
> `io.Writer` ≈ `OutputStream`, `encoding/json` ≈ Jackson, `time` ≈ `java.time`, но идиомы
> заметно отличаются — об этом ниже.

Этот файл покрывает базовые пакеты: `io`, `bufio`, `os`, `fmt`, `strconv`, `strings`,
`bytes`, `time`, `sort`, `slices`, `maps`, `encoding/json`. Сетевой код (`net/http`)
вынесен в отдельный файл — см. [./NET_HTTP.md](./NET_HTTP.md).

---

## 1. `io` — два интерфейса, на которых стоит всё

В Go нет иерархии классов потоков. Вместо неё — два крошечных интерфейса:

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}
```

`Read` заполняет переданный буфер `p`, возвращает число прочитанных байт `n` и ошибку.
`Write` отдаёт байты из `p`, возвращает число записанных. Всё остальное в `io` —
расширения этих двух.

| Интерфейс | Метод(ы) | Аналог в Java |
|---|---|---|
| `io.Reader` | `Read([]byte) (int, error)` | `InputStream.read` |
| `io.Writer` | `Write([]byte) (int, error)` | `OutputStream.write` |
| `io.Closer` | `Close() error` | `Closeable.close` |
| `io.Seeker` | `Seek(offset int64, whence int) (int64, error)` | `RandomAccessFile.seek` |
| `io.ReadWriter` | `Reader` + `Writer` | — |
| `io.ReadCloser` | `Reader` + `Closer` | — |
| `io.ReadWriteCloser` | всё вместе | — |

Большие интерфейсы собираются из малых встраиванием (embedding) — подробно в
[./INTERFACES.md](./INTERFACES.md). Идея «определяй интерфейс у потребителя, возвращай
конкретный тип» — оттуда же.

### `io.EOF` как идиома конца

Конец данных в Go — это **не исключение и не специальное значение `-1`**, а ошибка-сентинел
`io.EOF`. Когда `Read` дочитал до конца, он возвращает `io.EOF` (иногда вместе с последней
порцией данных в том же вызове). Сравнивать нужно явно:

```go
for {
    n, err := r.Read(buf)
    process(buf[:n])           // обработать прочитанное ДО проверки err
    if err == io.EOF {
        break                  // нормальный конец
    }
    if err != nil {
        return err             // настоящая ошибка
    }
}
```

Важная тонкость: `Read` может вернуть `n > 0` **и** `err == io.EOF` одновременно. Поэтому
прочитанные байты обрабатывают до проверки ошибки. Для `io.EOF` сравнение через `==`
допустимо (это не обёрнутая ошибка), но безопаснее — `errors.Is(err, io.EOF)`. Подробнее об
ошибках-сентинелах — [./ERRORS_PANIC.md](./ERRORS_PANIC.md).

### Готовые функции вместо ручного цикла

Цикл выше почти никогда не пишут руками. В `io` есть готовые помощники:

```go
n, err := io.Copy(dst, src)        // копирует, пока src не выдаст io.EOF; буфер внутри
data, err := io.ReadAll(r)         // читает всё в []byte (осторожно с большими данными!)
io.WriteString(w, "hello")         // записать строку без конверсии в []byte вручную
io.CopyN(dst, src, 1024)           // ровно N байт
```

`io.Copy` сам управляет буфером и не грузит весь поток в память — это правильный способ
«перелить» большой файл или ответ HTTP. `io.ReadAll` удобен, но читает всё целиком: для
недоверенного или потенциально огромного входа лимитируйте через `io.LimitReader(r, max)`.

### Композиция через декораторы

Поскольку `Reader`/`Writer` — интерфейсы, их легко **оборачивать**, получая «трубопровод»
обработки. Это паттерн «декоратор» в чистом виде, и стандартная библиотека им пронизана.

```go
r1 := io.MultiReader(a, b, c)      // последовательно читает a, потом b, потом c
w := io.MultiWriter(f, os.Stdout)  // каждый Write дублируется во все приёмники (как tee)
tee := io.TeeReader(src, log)      // всё прочитанное из src попутно пишется в log
```

| Декоратор | Что делает |
|---|---|
| `io.MultiReader(r1, r2, ...)` | конкатенация источников в один `Reader` |
| `io.MultiWriter(w1, w2, ...)` | веерная запись (fan-out) в несколько приёмников |
| `io.TeeReader(r, w)` | читает из `r`, попутно копируя прочитанное в `w` |
| `io.LimitReader(r, n)` | обрезает источник после `n` байт |
| `io.NopCloser(r)` | добавляет пустой `Close` к `Reader` (даёт `ReadCloser`) |

Пример «трубопровода»: посчитать контрольную сумму, не нарушая основной поток чтения.

```go
h := sha256.New()                  // h реализует io.Writer
tee := io.TeeReader(resp.Body, h)  // всё, что читаем, утекает в hash
body, _ := io.ReadAll(tee)         // читаем тело как обычно
sum := h.Sum(nil)                  // а хэш уже посчитан попутно
```

Никакого второго прохода по данным: декоратор встроился в существующий путь чтения.

---

## 2. `bufio` — буферизация и построчное чтение

«Голый» `io.Reader`/`Writer` может делать системный вызов на **каждый** `Read`/`Write`.
Читать файл по одному байту через `os.File.Read` — это тысячи syscall. `bufio` добавляет
буфер в памяти: чтение/запись идут пачками, число syscall падает на порядки. Это та же
причина, по которой в Java оборачивают поток в `BufferedReader`/`BufferedWriter`.

```go
br := bufio.NewReader(file)        // буфер по умолчанию 4096 байт
line, err := br.ReadString('\n')   // прочитать до разделителя включительно

bw := bufio.NewWriter(file)
bw.WriteString("data\n")
bw.Flush()                         // ОБЯЗАТЕЛЬНО: иначе хвост останется в буфере
```

`bufio.Writer` копит данные и сбрасывает их пачкой; **забытый `Flush` — классический баг**
(данные теряются, файл оказывается обрезан). Обычно `Flush` ставят в `defer`.

### `bufio.Scanner` — удобное построчное чтение

`Scanner` — самый частый способ читать ввод по строкам или токенам:

```go
sc := bufio.NewScanner(os.Stdin)
for sc.Scan() {                    // true, пока есть следующий токен
    line := sc.Text()              // токен без завершающего '\n'
    process(line)
}
if err := sc.Err(); err != nil {   // io.EOF сюда НЕ попадает — это нормальный конец
    log.Fatal(err)
}
```

`Scan` возвращает `false` и при конце данных, и при ошибке — отличить их позволяет
`sc.Err()` (после цикла). По умолчанию режим разбиения — построчный (`bufio.ScanLines`).

Режим задаётся `Split`:

```go
sc.Split(bufio.ScanWords)          // по словам
sc.Split(bufio.ScanRunes)          // по символам (рунам)
sc.Split(myCustomSplitFunc)        // своя функция разбиения
```

**Лимит буфера.** У `Scanner` есть защитный максимум длины токена (по умолчанию 64 КБ).
Строка длиннее → `Scan` вернёт `false`, а `sc.Err()` — `bufio.ErrTooLong`. Для длинных строк
лимит расширяют явно:

```go
buf := make([]byte, 0, 1024*1024)
sc.Buffer(buf, 10*1024*1024)       // стартовый буфер + потолок 10 МБ
```

Если строки бывают произвольно длинными — лучше `bufio.Reader.ReadString('\n')`, у него
нет жёсткого лимита.

---

## 3. `os` — процесс, окружение, файлы

```go
os.Args                            // []string: [0] — имя программы, [1:] — аргументы
v := os.Getenv("HOME")             // "" если переменной нет — НЕ отличить от пустого значения
v, ok := os.LookupEnv("HOME")      // ok == false ⇒ переменная не задана (надёжно)
```

Для разбора флагов командной строки используют пакет `flag` (или `cobra` вне stdlib);
`os.Args` — это «сырьё».

### Файлы

```go
f, err := os.Open("in.txt")        // только для чтения; *os.File реализует io.Reader/Closer
defer f.Close()

f, err := os.Create("out.txt")     // создать/обрезать для записи; io.Writer
defer f.Close()

data, err := os.ReadFile("in.txt")     // весь файл в []byte одним вызовом
err := os.WriteFile("out.txt", data, 0o644)  // создать и записать целиком (perm 0644)
```

`*os.File` — это `io.ReadWriteCloser` и `io.Seeker` одновременно, так что он подходит везде,
где ждут `io.Reader`/`io.Writer`. `os.ReadFile`/`os.WriteFile` удобны для небольших файлов;
для потоковой обработки больших данных — `os.Open` + `bufio` + `io.Copy`.

### Стандартные потоки

```go
os.Stdin                           // *os.File, io.Reader
os.Stdout                          // *os.File, io.Writer — обычный вывод
os.Stderr                          // *os.File, io.Writer — ошибки и диагностика
```

Идиома: вывод программы — в `Stdout`, всё диагностическое (логи, ошибки) — в `Stderr`,
чтобы их можно было разделить при перенаправлении (`prog > out.txt 2> err.txt`).

### `os.Exit` и почему `defer` не сработает

```go
func main() {
    defer fmt.Println("cleanup")   // НЕ выполнится!
    os.Exit(1)                     // немедленный выход, отложенные вызовы пропускаются
}
```

`os.Exit` завершает процесс **сразу**, минуя раскрутку стека: отложенные через `defer`
вызовы не исполняются, буферы не сбрасываются. Поэтому `os.Exit` вызывают только из `main`
после того, как весь нужный cleanup уже сделан. В библиотечном коде вместо `os.Exit`
возвращают ошибку. (`log.Fatal` внутри тоже зовёт `os.Exit` — те же последствия.)

### Сигналы (кратко)

Перехват сигналов ОС — через канал и пакет `os/signal`:

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
<-ctx.Done()                       // разблокируется по Ctrl+C / SIGTERM
```

`signal.NotifyContext` отменяет `context` при сигнале — это идиоматичная основа плавного
завершения (graceful shutdown). Подробнее про `context` и завершение — [./CONCURRENCY_PATTERNS.md](./CONCURRENCY_PATTERNS.md).

---

## 4. `fmt` — форматирование

`fmt` — это `String.format` / `printf` Go. Центральное понятие — **глаголы** (verbs):
подстановки вида `%v`, `%d`, `%s` в строке формата.

| Глагол | Значение | Пример вывода для `P{X:1,Y:2}` / `"hi"` |
|---|---|---|
| `%v` | значение в «человеческом» виде | `{1 2}` |
| `%+v` | то же, но с именами полей структуры | `{X:1 Y:2}` |
| `%#v` | Go-синтаксис (как написали бы в коде) | `main.P{X:1, Y:2}` |
| `%T` | тип значения | `main.P` |
| `%q` | строка/руна в кавычках с экранированием | `"hi"` |
| `%d` `%f` `%s` `%t` | int / float / string / bool | — |
| `%x` | шестнадцатеричный | — |
| `%p` | указатель | `0xc0000140a0` |
| `%w` | **обернуть ошибку** (только в `Errorf`) | — |

`%v` и `%+v` — рабочие лошадки логирования. `%#v` незаменим в отладке: показывает точную
структуру. `%w` стоит особняком — это не «печать», а оборачивание ошибки с сохранением
цепочки (см. [./ERRORS_PANIC.md](./ERRORS_PANIC.md)):

```go
return fmt.Errorf("loading config %q: %w", path, err)  // err достижим через errors.Is/As
```

### Семейство функций

```go
fmt.Println(a, b)                  // в Stdout, через пробел, с переводом строки
fmt.Printf("%s = %d\n", k, v)      // в Stdout по формату
s := fmt.Sprintf("%05d", n)        // вернуть строку (без печати)
fmt.Fprintf(os.Stderr, "err: %v\n", err)  // в произвольный io.Writer
err := fmt.Errorf("...: %w", cause)        // собрать ошибку (часто с %w)
```

`Fprintf` принимает первым аргументом любой `io.Writer` — именно поэтому форматированный
вывод можно направить в файл, буфер, сетевое соединение. `Print*` — это `Fprint*` с
`os.Stdout`, `Sprint*` — с внутренним буфером.

### `Stringer` и `Formatter`

Если тип реализует интерфейс `fmt.Stringer`, `fmt` использует его для `%v`/`%s`:

```go
type Color struct{ R, G, B uint8 }

func (c Color) String() string {
    return fmt.Sprintf("#%02X%02X%02X", c.R, c.G, c.B)
}

fmt.Println(Color{255, 0, 128})    // #FF0080
```

Это аналог `toString()` в Java, но «подхватывается» структурно. Для полного контроля над
всеми глаголами есть более низкоуровневый `fmt.Formatter` (нужен редко).

> Ловушка: если `String()` сам вызывает `fmt.Sprintf("%v", c)` на том же типе — будет
> бесконечная рекурсия. Форматируйте поля, а не сам `c`.

### Ввод (кратко)

```go
fmt.Scan(&x, &y)                   // из Stdin, по пробелам
fmt.Sscanf(line, "%d-%d", &a, &b)  // распарсить из строки
```

На практике для разбора ввода чаще берут `bufio.Scanner` + `strconv`, чем `fmt.Scan`.

---

## 5. `strconv`, `strings`, `bytes`

### `strconv` — числа ⇄ строки

`fmt` умеет форматировать что угодно, но он медленнее и аллоцирует больше. Для простых
конверсий «число ↔ строка» есть специализированный `strconv`:

```go
n, err := strconv.Atoi("42")           // string → int
s := strconv.Itoa(42)                  // int → string ("42")
f, err := strconv.ParseFloat("3.14", 64)
b, err := strconv.ParseBool("true")    // "1"/"t"/"true"/... → bool
i, err := strconv.ParseInt("ff", 16, 64)   // основание 16, разрядность 64
q := strconv.Quote("a\tb")             // `"a\tb"` — строковый литерал с экранированием
```

`Atoi`/`ParseInt` возвращают `*strconv.NumError` при неверном вводе — это типизированная
ошибка, её можно достать через `errors.As` (см. [./ERRORS_PANIC.md](./ERRORS_PANIC.md)).

### `strings.Builder` — почему не конкатенация

Строки в Go **неизменяемы** (как в Java). Поэтому `s += part` в цикле — это O(n²):
каждая операция выделяет новую строку и копирует весь накопленный результат.

```go
// ❌ Квадратичная сложность и куча мусора
s := ""
for _, p := range parts {
    s += p
}

// ✅ Линейно: Builder копит в растущий буфер []byte, копирует один раз
var b strings.Builder
for _, p := range parts {
    b.WriteString(p)
}
s := b.String()                    // финальная строка без лишней копии
```

`strings.Builder` — это аналог `StringBuilder` в Java: амортизированно линейное добавление,
итоговый `String()` отдаёт результат без копирования. Если число частей известно —
`b.Grow(n)` заранее резервирует ёмкость.

Основные функции пакета:

```go
strings.Split("a,b,c", ",")        // ["a" "b" "c"]
strings.Join([]string{"a", "b"}, "-")  // "a-b"
strings.Contains(s, "sub")
strings.HasPrefix(s, "http://")
strings.HasSuffix(s, ".go")
strings.TrimSpace("  x  ")         // "x"
strings.TrimSuffix("file.txt", ".txt")  // "file"
strings.ReplaceAll(s, "old", "new")
strings.ToLower(s) / strings.ToUpper(s)
strings.Fields("  a   b ")         // ["a" "b"] — разбить по пробелам
strings.NewReader("data")          // строка как io.Reader
```

### `bytes.Buffer` — изменяемый буфер байт

`bytes.Buffer` — это `strings.Builder` для случаев, когда нужен `io.Reader` **и**
`io.Writer` одновременно (например, собрать данные, потом отдать как поток):

```go
var buf bytes.Buffer
fmt.Fprintf(&buf, "id=%d\n", 7)    // Buffer — io.Writer
buf.WriteString("more\n")
io.Copy(os.Stdout, &buf)           // Buffer — ещё и io.Reader
```

Правило выбора: собираете **строку** — `strings.Builder`; нужен **буфер-поток** (читать и
писать, передавать в `io.Copy`) — `bytes.Buffer`. Пакет `bytes` зеркалит `strings`
(`bytes.Contains`, `bytes.Split`, `bytes.Count` и т. д.), но для `[]byte`.

---

## 6. `time` — время и длительности

Два главных типа: `time.Time` (момент) и `time.Duration` (промежуток, в наносекундах
как `int64`).

```go
now := time.Now()
d := 3 * time.Second               // Duration — арифметика на константах пакета
later := now.Add(d)
diff := later.Sub(now)             // Duration между двумя Time
fmt.Println(now.Year(), now.Hour())
```

`Duration` — это типизированный `int64`, поэтому длительности складывают из именованных
констант: `time.Millisecond`, `time.Second`, `time.Minute`, `time.Hour`.

### Опорный layout `2006-01-02 15:04:05`

Главная странность `time` для новичка: формат даты задаётся **не** буквами `yyyy-MM-dd`
(как в Java `SimpleDateFormat`), а **конкретной опорной датой**:

```
Mon Jan 2 15:04:05 MST 2006
```

Это «магическая» эталонная дата, и её части — по сути, пронумерованы: **1 2 3 4 5 6 7**
(месяц=1, день=2, час=3 в 24-часовом — 15, минута=4, секунда=5, год=6, зона=7 / MST). Чтобы
задать формат, вы **записываете эту самую дату** в нужном виде, а Go подставит реальные
значения.

```go
const layout = "2006-01-02 15:04:05"
t, err := time.Parse(layout, "2026-05-31 14:30:00")   // строка → Time
s := t.Format(layout)                                 // Time → строка
```

Готовые константы избавляют от запоминания: `time.RFC3339` (`2006-01-02T15:04:05Z07:00`),
`time.DateOnly` (`2006-01-02`), `time.TimeOnly` (`15:04:05`).

> Частые ошибки: `15` — это 24-часовой формат; для 12-часового пишут `03` + `PM`. `01` и `02`
> с ведущим нулём фиксированной ширины, `1`/`2` — без него. Перепутанные местами «месяц» и
> «день» — самый частый баг (`01` vs `02`).

### Таймеры, тикеры, дедлайны

```go
t := time.Since(start)             // сокращение для time.Now().Sub(start) — замер длительности
left := time.Until(deadline)       // сколько осталось до момента в будущем

<-time.After(2 * time.Second)      // канал, в который через 2с придёт значение
```

Для конкуренции и таймаутов есть таймеры и тикеры:

```go
timer := time.NewTimer(5 * time.Second)
<-timer.C                          // сработает один раз
timer.Stop()                       // отменить, если уже не нужен

ticker := time.NewTicker(time.Second)
defer ticker.Stop()                // ОБЯЗАТЕЛЬНО: иначе утечка
for range ticker.C {               // тикает каждую секунду
    poll()
}
```

`time.After` удобен в `select` для таймаута, но создаёт таймер, который живёт до
срабатывания, — в горячем цикле это утечка; там берут `NewTimer` с `Stop`/`Reset`.
Использование таймеров в `select` и отмена — [./CONCURRENCY_PATTERNS.md](./CONCURRENCY_PATTERNS.md).

### Монотонные часы и часовые пояса

`time.Now()` в Go содержит **две** отметки: настенное время (wall clock) и монотонные часы
(monotonic). Для измерения интервалов (`Sub`, `Since`) используется монотонная составляющая —
поэтому замеры **не ломаются**, если системные часы скорректировали (шаг NTP, ручной перевод
часов назад). Это решает классическую проблему «отрицательной длительности» из Java до
`System.nanoTime`.

Часовые пояса:

```go
loc, _ := time.LoadLocation("Europe/Berlin")
t := time.Now().In(loc)            // тот же момент, представленный в другой зоне
utc := t.UTC()
```

Храните и передавайте моменты в `UTC`, переводите в локальную зону только для отображения.

---

## 7. `sort`, `slices`, `maps`

### `sort` и современный `slices`

Исторически сортировка жила в пакете `sort`. С Go 1.21 для срезов появился обобщённый
(generic) `slices` — он короче и type-safe, и сейчас это предпочтительный путь.

```go
nums := []int{3, 1, 2}
slices.Sort(nums)                  // на месте, по возрастанию ([1 2 3])

people := []Person{...}
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age)   // <0, 0, >0 — как Comparator в Java
})
```

`SortFunc` ждёт компаратор, возвращающий знак (`-1/0/+1`); удобно строить через
`cmp.Compare`. Полезные функции `slices`:

| Функция | Что делает |
|---|---|
| `slices.Sort(s)` | сортировка по возрастанию (для `cmp.Ordered`) |
| `slices.SortFunc(s, cmp)` | сортировка с компаратором |
| `slices.Contains(s, v)` | есть ли элемент |
| `slices.Index(s, v)` | индекс первого вхождения или `-1` |
| `slices.BinarySearch(s, v)` | `(индекс, found)` в **отсортированном** срезе |
| `slices.Equal(a, b)` | поэлементное равенство |
| `slices.Sorted(seq)` | собрать итератор в отсортированный срез |
| `slices.Reverse(s)` | развернуть на месте |
| `slices.Max(s)` / `slices.Min(s)` | экстремумы |

```go
i, found := slices.BinarySearch([]int{1, 3, 5, 7}, 5)  // i=2, found=true
ok := slices.Equal([]int{1, 2}, []int{1, 2})           // true
```

### `maps` и итераторы `range`-over-func (1.23)

Пакет `maps` даёт обобщённые операции над `map`:

```go
m := map[string]int{"a": 1, "b": 2}
clone := maps.Clone(m)             // поверхностная (shallow) копия
maps.Equal(m, clone)               // поэлементное сравнение
```

`maps.Keys`/`maps.Values` возвращают **итераторы** (`iter.Seq`), а не срезы — это
range-over-func из Go 1.23. По ним можно итерировать напрямую или собрать в срез:

```go
for k := range maps.Keys(m) {      // итерация по ключам
    use(k)
}
keys := slices.Sorted(maps.Keys(m))  // ключи в отсортированный срез (детерминизм!)
```

Это важно, потому что **порядок обхода `map` в Go намеренно случаен** (см.
[./SLICES_MAPS_STRINGS.md](./SLICES_MAPS_STRINGS.md)). Когда нужен стабильный вывод —
извлеките ключи и отсортируйте.

> Терминология: `iter.Seq[V]` / `iter.Seq2[K,V]` — это функции-итераторы, появившиеся в
> 1.23. Их можно писать самому, но для базовых задач хватает `slices`/`maps`.

---

## 8. `encoding/json`

Аналог Jackson, встроенный в stdlib. Маппинг идёт по **полям структуры** через рефлексию.

### `Marshal` / `Unmarshal`

```go
type User struct {
    Name string
    Age  int
}

b, err := json.Marshal(User{Name: "Alice", Age: 30})   // → []byte: {"Name":"Alice","Age":30}

var u User
err = json.Unmarshal([]byte(`{"Name":"Bob","Age":25}`), &u)  // в УКАЗАТЕЛЬ
```

`Unmarshal` принимает указатель на цель. `MarshalIndent(v, "", "  ")` даёт человекочитаемый
отступ.

### Struct tags: имя, `omitempty`, `-`

По умолчанию имя ключа JSON = имя поля Go (`Name`, не `name`). Управляют этим через тег
`json:"..."`:

```go
type Product struct {
    ID       int      `json:"id"`                 // ключ "id" вместо "ID"
    Title    string   `json:"title"`
    Discount float64  `json:"discount,omitempty"` // опустить, если нулевое значение
    internal string   `json:"-"`                  // никогда не сериализовать (и поле неэкспортируемо)
    Tags     []string `json:"tags,omitempty"`
}
```

| Синтаксис тега | Эффект |
|---|---|
| `json:"id"` | переименовать ключ |
| `json:"id,omitempty"` | пропустить поле при нулевом значении (0, "", nil, пустой срез/map) |
| `json:"-"` | полностью исключить поле из JSON |
| `json:",string"` | сериализовать число/bool как JSON-строку |

`omitempty` срабатывает на **нулевое значение** типа. Тонкость: для `int` ноль и
«отсутствует» неразличимы — `0` будет опущен, даже если он осмыслен. Когда нужно отличать
«ноль» от «не задано», используют **указатель** (`*int`): `nil` ⇒ опустить, `&0` ⇒ передать 0.

### Главная ловушка: неэкспортируемые поля не сериализуются

```go
type Config struct {
    Host string         // экспортируемое (с большой буквы) → попадёт в JSON
    port int            // неэкспортируемое (с маленькой) → ПРОПУЩЕНО молча
}
```

`encoding/json` работает через рефлексию и **видит только экспортируемые** (начинающиеся с
заглавной буквы) поля. Поле с маленькой буквы не сериализуется и не десериализуется — без
ошибки, без предупреждения. Это причина №1 «почему моё поле не попадает в JSON». Подробно про
экспортируемость — [./BASICS.md](./BASICS.md).

### Вложенность и анонимные (встроенные) поля

```go
type Address struct {
    City string `json:"city"`
}

type Person struct {
    Name    string  `json:"name"`
    Address Address `json:"address"`   // вложенный объект {"address":{"city":...}}
    Meta    `json:"-"`                 // встроенная структура
}
```

Встроенное (анонимное) поле «всплывает»: его поля попадают в JSON **на верхний уровень**
родителя, как при наследовании, — если у анонимного поля нет своего тега-имени. С тегом
(`json:"meta"`) оно становится вложенным объектом.

### Указатели для optional и неизвестные поля

```go
type Patch struct {
    Name *string `json:"name,omitempty"`   // nil = не трогать, &"" = задать пустую строку
}
```

При десериализации **неизвестные поля JSON по умолчанию игнорируются** (как в Jackson с
`FAIL_ON_UNKNOWN_PROPERTIES=false`). Чтобы запретить лишние поля — `Decoder.DisallowUnknownFields()`.

### `json.RawMessage` и `json.Number`

```go
type Envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage  `json:"payload"`  // отложить разбор: сырой JSON как []byte
}
```

`json.RawMessage` — это `[]byte`, который `json` **не разбирает**: удобно, когда тип
полезной нагрузки зависит от поля `type` (разберёте позже, узнав тип). Аналог
«ленивого `JsonNode`».

`json.Number` сохраняет число **как строку**, не приводя к `float64`. Это спасает от потери
точности у больших `int64` (числа JSON по умолчанию декодируются в `float64`, теряя младшие
разряды для значений > 2^53):

```go
dec := json.NewDecoder(r)
dec.UseNumber()                    // числа → json.Number вместо float64
```

### `Encoder` / `Decoder` — потоковая обработка и NDJSON

`Marshal`/`Unmarshal` работают с целым `[]byte` в памяти. Для **потоков** есть
`Encoder`/`Decoder`, привязанные к `io.Writer`/`io.Reader`:

```go
enc := json.NewEncoder(w)          // пишет JSON в io.Writer
enc.Encode(v)                      // добавляет '\n' после каждого объекта

dec := json.NewDecoder(r)          // читает JSON из io.Reader
dec.Decode(&v)
```

Ключевое свойство: `Decoder` читает **по одному JSON-значению за вызов**, оставляя остальной
поток нетронутым. Это ровно то, что нужно для **NDJSON** (newline-delimited JSON — по одному
объекту на строку, формат логов и стримов):

```go
dec := json.NewDecoder(r)
for {
    var rec Record
    if err := dec.Decode(&rec); err == io.EOF {
        break                      // поток закончился — нормально
    } else if err != nil {
        return err                 // битая строка
    }
    handle(rec)
}
```

`Decoder` не грузит весь вход в память — можно разбирать гигабайтный лог потоково.
Симметрично `Encoder.Encode` в цикле производит корректный NDJSON (каждый объект + `\n`).

### Кастомные `MarshalJSON` / `UnmarshalJSON`

Чтобы переопределить (де)сериализацию типа, реализуют интерфейсы `json.Marshaler` /
`json.Unmarshaler`:

```go
type Celsius float64

func (c Celsius) MarshalJSON() ([]byte, error) {
    return []byte(fmt.Sprintf("%q", fmt.Sprintf("%.1f°C", float64(c)))), nil
}

func (c *Celsius) UnmarshalJSON(b []byte) error {
    var s string
    if err := json.Unmarshal(b, &s); err != nil {
        return err
    }
    s = strings.TrimSuffix(s, "°C")
    f, err := strconv.ParseFloat(s, 64)
    if err != nil {
        return err
    }
    *c = Celsius(f)
    return nil
}
// Marshal даст "21.5°C"; Unmarshal примет ту же строку обратно (round-trip).
```

Это аналог кастомных `JsonSerializer`/`JsonDeserializer` в Jackson. Обратите внимание:
`MarshalJSON` — на значении (`Celsius`), `UnmarshalJSON` — обязательно на **указателе**
(`*Celsius`), потому что метод должен **изменить** получателя.

### Частые ошибки `encoding/json`

| Симптом | Причина | Решение |
|---|---|---|
| Поле молча пропадает из JSON | поле неэкспортируемо (с маленькой буквы) | сделать с заглавной + тег |
| `0` / `""` не отличить от «не задано» | `omitempty` опускает нулевое значение | использовать `*T` (указатель) |
| Потеря точности больших чисел | число → `float64` (52-битная мантисса) | `Decoder.UseNumber()` или `json.Number` |
| `Unmarshal` не меняет переменную | передан не указатель | передавать `&v` |
| Кастомный `UnmarshalJSON` не вызывается | метод объявлен на значении, а не на `*T` | receiver — указатель |

Подробнее о деталях кодирования — пост [Go Blog — JSON](https://go.dev/blog/json).

---

## Типичные ошибки (сводка)

- **Забыли `bufio.Writer.Flush()`** — хвост данных остаётся в буфере, файл обрезан.
- **`os.Exit` рядом с `defer`** — отложенный cleanup не выполнится; выходите после очистки.
- **`os.Getenv` для проверки наличия** — `""` неотличимо от «не задано»; берите `LookupEnv`.
- **`io.ReadAll` на недоверенном входе** — риск OOM; ограничивайте `io.LimitReader`.
- **Перепутали месяц/день в layout** — `01` это месяц, `02` это день; не `MM`/`dd`.
- **Конкатенация строк в цикле** — O(n²); используйте `strings.Builder`.
- **Неэкспортируемое поле + JSON** — не сериализуется молча; начинайте с заглавной буквы.
- **`Unmarshal` без указателя** — передавайте `&v`, иначе ничего не запишется.

---

## Шпаргалка

```go
// io
n, err := io.Copy(dst, src)              // перелить поток (без загрузки в память)
data, _ := io.ReadAll(io.LimitReader(r, 1<<20))  // безопасное чтение целиком
tee := io.TeeReader(src, hash)           // читать и попутно хэшировать
w := io.MultiWriter(file, os.Stdout)     // fan-out записи

// bufio
sc := bufio.NewScanner(r)
for sc.Scan() { line := sc.Text() }      // построчно; sc.Err() после цикла
bw := bufio.NewWriter(f); defer bw.Flush()

// os
v, ok := os.LookupEnv("KEY")             // надёжная проверка наличия
data, _ := os.ReadFile("f.txt")          // маленький файл целиком

// fmt
fmt.Printf("%+v\n", v)                   // структура с именами полей
fmt.Errorf("ctx: %w", err)               // обернуть ошибку

// strconv / strings
n, _ := strconv.Atoi(s); s := strconv.Itoa(n)
var b strings.Builder; b.WriteString(p); _ = b.String()

// time
const L = "2006-01-02 15:04:05"          // опорный layout (НЕ yyyy-MM-dd)
t, _ := time.Parse(L, in); out := t.Format(L)
elapsed := time.Since(start)             // монотонный замер

// slices / maps
slices.Sort(s); i, ok := slices.BinarySearch(s, x)
keys := slices.Sorted(maps.Keys(m))      // детерминированный порядок

// encoding/json
b, _ := json.Marshal(v)                  // экспортируемые поля + теги
json.Unmarshal(b, &v)                    // в указатель
dec := json.NewDecoder(r)                // потоковый разбор / NDJSON
for { if dec.Decode(&rec) == io.EOF { break } }
```

---

## Где почитать дальше

- [./BASICS.md](./BASICS.md) — экспортируемость (заглавная буква), нулевые значения, базовый ввод-вывод.
- [./INTERFACES.md](./INTERFACES.md) — малые интерфейсы, `io.Reader`/`Writer`, embedding, проверка реализации.
- [./ERRORS_PANIC.md](./ERRORS_PANIC.md) — ошибки-сентинелы (`io.EOF`), `%w`, `errors.Is`/`As`, `*strconv.NumError`.
- [./SLICES_MAPS_STRINGS.md](./SLICES_MAPS_STRINGS.md) — внутреннее устройство срезов/строк, случайный порядок `map`.
- [./NET_HTTP.md](./NET_HTTP.md) — `net/http`: клиент и сервер, тела запросов как `io.Reader`, JSON по сети.

---

## Источники

- [pkg.go.dev/std](https://pkg.go.dev/std) — справочник стандартной библиотеки: `io`, `bufio`, `os`, `fmt`, `strconv`, `strings`, `bytes`, `time`, `sort`, `slices`, `maps`, `encoding/json`.
- [Go Blog — JSON and Go](https://go.dev/blog/json) — `Marshal`/`Unmarshal`, теги, потоковый `Decoder`, кастомные маршалеры.
- [Go Blog — Strings, bytes, runes and characters in Go](https://go.dev/blog/strings) — устройство строк, UTF-8, конверсии для `strings`/`bytes`.
