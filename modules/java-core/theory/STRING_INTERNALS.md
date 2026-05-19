# String Internals

---

## 1. Почему `String` — особенный

`java.lang.String` — самый часто используемый объектный тип в любой Java-программе. Spring Boot приложение средних размеров на старте создаёт **сотни тысяч** String объектов: HTTP-заголовки, JSON-keys, имена beans, конфиги. Поэтому каждый байт памяти и каждый такт CPU в `String` — это значимое решение, влияющее на heap-pressure и pause time всей JVM.

Sun и Oracle потратили много инженерных усилий на оптимизацию `String` за 25+ лет: pool, compact strings, invokedynamic для concat. Это даёт многое **бесплатно**, но требует понимания — иначе наступаешь на сложные грабли.

---

## 2. Структура `String` (Java 9+)

С Java 9 (JEP 254 **Compact Strings**) внутренняя репрезентация:

```java
public final class String implements ... {
    private final byte[] value;     // было char[] в Java 8
    private final byte coder;       // LATIN1 (0) или UTF16 (1)
    private int hash;               // lazy кэш hashCode (mutable!)
    private boolean hashIsZero;     // флаг «hash==0 уже посчитан»
}
```

Главное: с Java 9 `String` хранит **байты, а не chars**. Один из двух режимов:

- **LATIN1**: все символы из 0–0xFF (ASCII + western European). `byte[]` ровно `length()` байт.
- **UTF16**: есть хоть один символ за пределами LATIN1 (кириллица, эмодзи, ideographs). `byte[]` длины `2 × length()` (big-endian или little-endian зависит от платформы).

JVM на компайл-тайме литералов выбирает coder. Для runtime concat и парсинга — выбор делается на основе содержимого.

### 2.1. Экономия памяти

| Use case | Java 8 | Java 9+ |
|---|---|---|
| 100K ASCII строк по 20 символов | ~4 MB (char[] = 2 байта/символ + header) | ~2 MB (byte[]) |
| HTTP headers (typical) | 100% | ~50% |
| JSON keys | 100% | ~50% |
| Локализованный UI (кириллица) | 100% | 100% (UTF16) |

На реальных backend-приложениях heap сокращается на **10–30%** от перехода Java 8 → 9. Это, пожалуй, главный «бесплатный» win при апгрейде.

Отключить: `-XX:-CompactStrings`. Нужно только для бенчмарков «как было раньше».

### 2.2. Цена

API остался **прежним** (`charAt`, `length`, `indexOf` возвращают `char`), но **под капотом** появился branch по `coder`:

```java
public char charAt(int index) {
    if (isLatin1()) {
        return (char) (value[index] & 0xff);
    } else {
        return StringUTF16.charAt(value, index);
    }
}
```

JIT обычно скомпилирует это так, что branch предсказан → стоимость почти нулевая. Но в специфических hot loops с `charAt` (древние парсеры на массивных String'ах) — иногда возникает регресс. Поэтому performance-engineers иногда работают с `byte[]` напрямую.

### 2.3. `hash` — benign data race

Поле `hash` mutable (без `final`), `hashCode()` ленится:

```java
public int hashCode() {
    int h = hash;
    if (h == 0 && !hashIsZero) {
        h = 0;
        for (byte v : value) h = 31 * h + (v & 0xff);
        if (h == 0) hashIsZero = true;
        else hash = h;
    }
    return h;
}
```

Если два потока одновременно вызовут `hashCode()` на одном String — оба вычислят одно значение и оба запишут. Это **benign race**: запись идемпотентна, конечное значение детерминированно.

> Источник: [JEP 254 (Compact Strings)](https://openjdk.org/jeps/254). Aleksey Shipilëv, [*JVM Anatomy Quark #5: TLABs and Heap Parsability*](https://shipilev.net/jvm/anatomy-quarks/5-tlabs-and-heap-parsability/) — обсуждение String layout.

---

## 3. String Pool (StringTable)

JVM держит **canonical map** `String → String` — пул для дедупликации.

```java
String a = "foo";                  // в pool
String b = "foo";                  // та же ссылка из pool
String c = new String("foo");      // отдельный объект в heap, НЕ в pool
String d = c.intern();             // === a, через pool

a == b      // true
a == c      // false
a == d      // true
a.equals(c) // true (всегда)
```

### 3.1. Кто попадает в pool автоматически

- **String-литералы** (`"foo"`) — попадают через bytecode `ldc` инструкцию. Resolution constant pool entry дереферирует в pool.
- **Compile-time concat констант** (`"foo" + "bar"` где оба `static final`) → один литерал в constant pool.
- **`String.intern()` explicit** — добавляет вручную, возвращает canonical reference.

**НЕ попадают**:
- `new String("foo")` (обычный конструктор);
- `runtime concat` (`"foo" + variable`);
- результат метода (`.substring`, `.toLowerCase`).

### 3.2. История: где живёт pool

**До Java 7**: pool жил в **PermGen** — зоне фиксированного размера. `String.intern()` в loop → `OutOfMemoryError: PermGen`. Лечилось `-XX:MaxPermSize=512m`.

**С Java 7** ([JEP 6962931](https://bugs.openjdk.org/browse/JDK-6962931)): pool переехал в **heap** — GC-managed, может расти. Сама хеш-таблица StringTable — это native структура (вне heap), но её **entries** ссылаются на heap-String'ы.

Размер StringTable: `-XX:StringTableSize=N` (default ~60013 — простое число для хорошего хеширования). Если у тебя миллионы interned strings — увеличить. Текущая утилизация:

```bash
jcmd <pid> VM.stringtable
```

### 3.3. Когда `intern()` полезен и когда вреден

**Полезен** — есть реальная hot-set дублирующихся строк:
- Парсинг 10М JSON документов с одними и теми же 20 keys → `intern()` keys экономит 95% строк (10М × 20 - 20 = ~200М объектов).
- Symbol-like values: enum names, country codes, currencies — мало уникальных значений, частые повторения.

**Вреден**:
- Random unique strings (UUID, timestamps, user IDs) — раздувает StringTable, никакого re-use.
- Hot loop `someString.intern()` — кажется хорошей идеей, но это **global synchronized lookup** (lock on table bucket).
- Webapp redeploy — interned strings остаются в pool, даже если CL дохнет (StringTable per-JVM, не per-CL).

Альтернативы:
- Просто `HashMap<String, String>` для дедупликации в hot path — без global lock;
- **G1 String Deduplication** (`-XX:+UseStringDeduplication`) — G1 сам дедуплицирует строки с одинаковым содержимым во время GC. Прозрачно, без `intern()`.

> [JEP 192: String Deduplication in G1](https://openjdk.org/jeps/192). Подробности: Claes Redestad (cl4es), [*String Deduplication*](https://cl4es.github.io/2021/02/14/Investigating-String-Deduplication.html).

---

## 4. Concatenation и `invokedynamic` (JEP 280)

### 4.1. До Java 9 — `StringBuilder` под капотом

`javac` превращал `"a" + b + "c"` в:

```java
new StringBuilder().append("a").append(b).append("c").toString()
```

В bytecode видно:
```
new StringBuilder
invokevirtual <init>
ldc "a"
invokevirtual append
aload b
invokevirtual append
ldc "c"
invokevirtual append
invokevirtual toString
```

Проблемы:
- Аллокация `StringBuilder` (`char[]` + wrapper);
- Default capacity 16 → resize при overflow → ещё аллокация + копия;
- `toString` копирует ещё раз в финальный `String`.

**Три** объекта-аллокации, **минимум две** копии массива.

### 4.2. С Java 9 — `invokedynamic` + `StringConcatFactory`

JEP 280 переписал concatenation на `invokedynamic`:

```
ldc "a"
aload b
ldc "c"
invokedynamic makeConcatWithConstants("a\1c"...)
```

JVM в runtime через `StringConcatFactory.makeConcatWithConstants` выбирает стратегию:
- `MH_INLINE_SIZED_EXACT` (default) — строит MethodHandle, который:
  1. Вычисляет финальный размер за один проход (`length()` всех частей);
  2. Аллоцирует **один** `byte[]` нужного размера;
  3. Копирует все части напрямую.

**Один** объект, **одна** копия. Никакого StringBuilder.

### 4.3. Эффект

| | Java 8 | Java 9+ |
|---|---|---|
| Allocations | 2–3 объекта | 1 объект |
| Memory copies | 2 | 1 |
| Throughput | baseline | 2–5× |
| GC pressure | baseline | -50–70% |

Backward-compatible: старый bytecode со StringBuilder продолжает работать. Перекомпилируете — получаете invokedynamic. Стратегию можно менять через JVM-флаг **без перекомпиляции пользовательского кода** — гибкость, недоступная при статической компиляции.

> [JEP 280: Indify String Concatenation](https://openjdk.org/jeps/280). Aleksey Shipilëv, [*Faster String Concat*](https://shipilev.net/blog/2017/string-concatenation-yoga/) — детальный разбор всех стратегий.

---

## 5. `substring` после Java 7u6 — fix для memory leak

До Java 7u6 (2012) `substring` **шарил backing `char[]`** с оригиналом:

```java
String big = readMegabyteFile();
String tiny = big.substring(0, 4);
big = null;   // не помогает! tiny держит весь массив через offset/count
```

Это была сознательная оптимизация: `substring` без копии — O(1). Но создавало классический memory leak: возвращаешь короткую подстроку из большой → memory на много МБ удерживается через ту короткую строку.

С Java 7u6 `substring` **копирует** содержимое в новый `byte[]`. Подстрока — независимая, оригинал может быть GC-нут. Цена: O(n) вместо O(1), больше allocations. Принят как correctness > performance.

---

## 6. Charsets и encoding

`String.getBytes()` без аргумента использует **default charset OS** — главный bug-источник кросс-платформенного кода (Windows-1251 vs UTF-8 vs MacRoman). **Всегда** передавайте явно:

```java
str.getBytes(StandardCharsets.UTF_8);
new String(bytes, StandardCharsets.UTF_8);
```

`java.nio.charset.StandardCharsets` (Java 7+) — константы для UTF-8, UTF-16, ISO-8859-1, US-ASCII. Не бросают checked `UnsupportedEncodingException` (как `Charset.forName(name)`).

С Java 18 ([JEP 400](https://openjdk.org/jeps/400)) **default charset = UTF-8 на всех платформах**, включая Windows. До этого Windows JVM использовал OS-default (часто Windows-1252 или -1251), что ломало кросс-платформенные операции.

Переопределить: `-Dfile.encoding=ISO-8859-1` или системная переменная `JAVA_TOOL_OPTIONS`.

---

## 7. `String` vs `StringBuilder` vs `StringBuffer`

| Тип | Mutable | Thread-safe | Performance |
|---|---|---|---|
| `String` | нет | yes (immutable) | concat — JIT-инлайн (см. §4) |
| `StringBuilder` | yes | нет | основной выбор |
| `StringBuffer` | yes | yes (`synchronized`) | legacy, не используйте без честного sharing |

Capacity: `StringBuilder` начинает с 16, удваивается при overflow. Если знаешь размер — `new StringBuilder(expectedCapacity)` экономит resize. На массивных concat'ах:

```java
StringBuilder sb = new StringBuilder(items.size() * 32);   // estimate
for (Item item : items) {
    sb.append(item.toString());
}
return sb.toString();
```

**Не используйте `StringBuffer`** в современном коде. Synchronization не нужна в 99% случаев, deserves только historical artifact из Java 1.0.

---

## 8. Полезные API Java 11+

С Java 11 интенсивно расширяется String API:

- **`String.repeat(int n)`** (11+) — `"-".repeat(80)`;
- **`String.isBlank()`** (11+) — пустая или whitespace-only;
- **`String.lines()`** (11+) — `Stream<String>` по `\n` / `\r\n` / `\r`;
- **`String.strip()` / `stripLeading()` / `stripTrailing()`** (11+) — Unicode-aware trim (`trim()` только ASCII whitespace);
- **`String.chars()` / `String.codePoints()`** (8+) — Stream characters/codepoints;
- **`String.formatted(args)`** (15+) — `printf`-style instance method;
- **Text blocks** (15+) — multi-line `"""..."""`, см. [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md);
- **`String.indent(int n)`** (12+) — добавить/убрать leading whitespace;
- **String templates** — был preview в 21/22, отозваны в 23, будущее неясно.

---

## 9. Performance gotchas

### 9.1. `String.split(regex)`

```java
String[] parts = s.split(",");
```

Компилирует regex **на каждый вызов**. Для single-char delimiters (`,`, `;`, `|`, `.`, `<space>`) JDK имеет fast path без regex, но для всего остального — `Pattern.compile` каждый раз.

Best practice: предкомпилировать pattern:
```java
private static final Pattern COMMA = Pattern.compile(",");
String[] parts = COMMA.split(s);
```

Для CSV / TSV — использовать специализированные парсеры (OpenCSV, Apache Commons CSV) — они быстрее и корректно обрабатывают quoting.

### 9.2. `String.format` — медленный

`String.format("Hello, %s!", name)` создаёт `Formatter`, парсит pattern, делает кучу allocations. На hot path:

```java
// Плохо в hot path:
log.info(String.format("user %s did %s", user, action));

// Лучше: SLF4J уже знает про placeholders, делает lazy formatting:
log.info("user {} did {}", user, action);

// Или StringBuilder:
StringBuilder sb = new StringBuilder(64);
sb.append("user ").append(user).append(" did ").append(action);
String result = sb.toString();
```

### 9.3. `replace` — две вкусности

```java
str.replace('a', 'b');          // быстрый, char-level
str.replace("foo", "bar");      // медленный, regex-based?
```

На самом деле `replace(CharSequence, CharSequence)` НЕ regex-based с Java 6 — он использует прямой поиск, без `Pattern.compile`. Но `replaceAll(regex, replacement)` — regex.

### 9.4. `intern()` lock contention

`String.intern()` под капотом lock'ит bucket StringTable. Hot loop с intern'ом → contention. С Java 7 пул переехал в heap, но lock остался.

### 9.5. `equals` vs `==`

Для **литералов** из constant pool `==` работает корректно по JLS §3.10.5:
```java
"foo" == "foo"   // true (один pool entry)
```

Но это **деталь реализации**, на которую завязываться не следует. Всегда используйте `.equals` для сравнения содержимого. `==` оставьте для identity check (когда оно реально нужно, например в `if (a == EMPTY)`).

---

## 10. Что обязательно знать на собесе

1. **Compact Strings (JEP 254)** — `byte[]` + coder, экономия в LATIN1 случае.
2. **String pool** — как работает, что попадает автоматически, когда `intern()` полезен.
3. **`+` через invokedynamic (JEP 280)** — почему быстрее старого StringBuilder.
4. **`substring` 7u6 fix** — почему скопировали, был ли это performance regression.
5. **`StandardCharsets.UTF_8`** — почему явно, что с `getBytes()`.
6. **`StringBuilder` vs `StringBuffer`** — когда что (никогда `StringBuffer` в новом коде).
7. **String Deduplication (G1)** — альтернатива `intern()` без global lock.
8. **`equals` vs `==`** — детали реализации vs API контракт.

---

## Related

- Bytecode `ldc`, `invokedynamic` → [`BYTECODE_INVOKEDYNAMIC.md`](BYTECODE_INVOKEDYNAMIC.md)
- Compact Strings + Metaspace + StringTable layout → [`JVM_MEMORY_AREAS.md`](JVM_MEMORY_AREAS.md)
- Text blocks, formatted templates → [`MODERN_JAVA_FEATURES.md`](MODERN_JAVA_FEATURES.md)
- G1 String Deduplication → [`GARBAGE_COLLECTION.md`](GARBAGE_COLLECTION.md)

### Внешние ресурсы

- **JEP 254 Compact Strings** — <https://openjdk.org/jeps/254>
- **JEP 280 Indify String Concat** — <https://openjdk.org/jeps/280>
- **Aleksey Shipilëv, *Faster String Concat***: <https://shipilev.net/blog/2017/string-concatenation-yoga/>
- **Claes Redestad (cl4es)**: <https://cl4es.github.io/> — про string deduplication, indify, string layouts
- **Inside Java — text blocks**: <https://inside.java/2022/04/28/text-blocks/>
