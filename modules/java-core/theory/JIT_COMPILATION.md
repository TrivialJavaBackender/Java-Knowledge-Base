# JIT Compilation

---

## 1. Зачем JIT и откуда он взялся

Java стартовала в 1995 году как **interpreted language**. Идея «write once, run anywhere» требовала, чтобы JVM на каждой платформе **исполняла** одни и те же байткоды. Простейший способ — интерпретация: цикл, читающий инструкцию за инструкцией.

Но интерпретация в 10–100 раз медленнее нативного кода. Java получила репутацию «медленного» языка, что мешало популярности в performance-sensitive нишах.

Решение пришло в 1999 году с HotSpot VM (купленным Sun у компании Longview Technologies, бывшей Animorphic). Главная идея: **не компилировать всё подряд, а только горячие методы**. Большинство кода исполняется редко — компилировать его — пустая трата времени. Профайлинг показывает, **что именно горячо** в этом конкретном запуске → компилируешь только это, и качественно.

Это и есть **JIT (Just-In-Time)**: компилируем по ходу исполнения, на основе runtime-профиля. К 2005 году HotSpot догнал C++ на типичных нагрузках. К 2015 — на некоторых обогнал (благодаря **profile-guided optimizations** — JIT может оптимизировать под актуальный, а не гипотетический трафик).

> Cliff Click, *The Java HotSpot Server Compiler* — [JVM '01 paper](https://www.usenix.org/legacy/events/jvm01/full_papers/paseman/paseman.pdf).

---

## 2. Pipeline: interpreter → C1 → C2

HotSpot — **mixed-mode** VM. Метод проходит через несколько уровней:

```
       ┌──────────────┐
bytecode → Interpreter ──── invocation/back-edge counters ─┐
       └──────────────┘                                    │
                                                           │
       ┌──────────────┐                                    │
       → C1 (Client)  ──── быстрая компиляция, малая ──────│
       └──────────────┘    оптимизация                     │
                                                           │
       ┌──────────────┐                                    │
       → C2 (Server)  ◄─── глубокая оптимизация на ────────┘
       └──────────────┘    основе профиля
```

- **Interpreter** — bytecode исполняется напрямую. Самый медленный, но мгновенно «работает».
- **C1 (Client compiler)** — быстрый компилятор. Простые оптимизации. Подходит для коротких приложений, где warmup критичен.
- **C2 (Server compiler)** — глубокий оптимизатор. Долгая компиляция, но финальный код лучший.

**Counters** запускают компиляцию:
- `invocation counter` — сколько раз метод был вызван;
- `back-edge counter` — сколько раз произошёл backward jump (loop iteration).

При превышении порога (`-XX:CompileThreshold` ~10000 для standalone C2, ~1500 для tiered C1) метод ставится в **очередь компиляции**. C1/C2 — отдельные потоки (`-XX:CICompilerCount`, default зависит от CPU).

### 2.1. Tiered Compilation (default since 8)

`-XX:+TieredCompilation` (on by default) — пять уровней:

| Level | Compiler | Profiling | Описание |
|---|---|---|---|
| 0 | Interpreter | базовое | стартовая точка |
| 1 | C1 | без профиля | trivial методы (геттеры, сеттеры) |
| 2 | C1 | invocation + back-edge | стартовая компиляция |
| 3 | C1 | full profile | сбор profile data для C2 |
| 4 | C2 | использует profile | финальный код, агрессивные оптимизации |

Типичный путь hot-метода: `0 → 3 → 4`. Trivial методы остаются на 1 (нет смысла гнать через C2). Backup-уровни (2, 1) — для случаев, когда очередь C2 переполнена.

Без tiered (`-XX:-TieredCompilation`): сразу `0 → 4`. Очень медленный warmup, но финальный код тот же. На бенчмарках с долгим warmup — норм; в production — снижает p99 первых минут.

### 2.2. On-Stack Replacement (OSR)

Если в методе **долгий loop** — вызовы редкие, но back-edge counter растёт быстро — JIT может скомпилировать метод **прямо во время** его исполнения, и продолжить уже в нативном коде. Это **OSR**.

Цена: OSR-скомпилированная версия отличается от обычной (entry-point в середине метода), оптимизируется чуть хуже. После OSR обычно происходит **повторная** компиляция без OSR, плавный переход. В JIT логе видно по суффиксу `% n osr`:

```
123  3   b  4    com.foo.Bar::loop (45 bytes)   <- normal compile
124  4   b  4 %  com.foo.Bar::loop @ 23 (45 bytes)   <- OSR
```

`%` — это OSR флаг.

---

## 3. Что делает C2 (агрессивные оптимизации)

C2 строит **SSA-граф** (Single Static Assignment) — внутреннее представление, где каждое значение определяется ровно один раз. Над ним выполняется десятки проходов оптимизаций.

### 3.1. Inlining — главная оптимизация

Метод inline'ится, если:
- размер ≤ `-XX:MaxInlineSize` (default 35 байт bytecode);
- метод hot ≤ `-XX:FreqInlineSize` (default 325 байт);
- иерархия позволяет (см. §6 polymorphic call sites).

Inlining ценен не сам по себе (сэкономить call instruction — не страшно). Ценность — он **открывает другие оптимизации**: после inline JIT видит весь контекст, может проводить escape analysis, constant propagation, eliminate dead code.

```
-XX:+UnlockDiagnosticVMOptions
-XX:+PrintInlining
```

Выводит лог типа:
```
@ 12   com.foo.Bar::compute (12 bytes)   inline (hot)
@ 18   com.foo.Bar::badMethod (340 bytes)   too big
@ 25   com.foo.Bar::veryColdMethod (5 bytes)   not reached
```

### 3.2. Escape Analysis (EA)

JIT-анализ, определяющий **выходит ли объект из метода / потока**. Категории:

- **NoEscape** — объект не покидает метод. JIT может сделать **scalar replacement**: разобрать объект на local-vars, heap-аллокация не происходит вообще. Например, `Iterator` в `for-each` цикле часто scalar-replace'ится.

```java
for (String s : list) { System.out.println(s); }
```

Декомпилируется примерно так после EA:
```java
Iterator it = list.iterator();
while (it.hasNext()) {
    String s = it.next();
    System.out.println(s);
}
```

`Iterator it` — NoEscape (не уходит за пределы). C2 элиминирует объект полностью, поля `it` живут в регистрах.

- **ArgEscape** — объект ушёл в other method, но не в global state. JIT может сделать **lock elision**: `synchronized` для thread-local объекта компилируется в no-op.

```java
synchronized (new Object()) { /* что-то */ }   // lock elided полностью
```

- **GlobalEscape** — объект ушёл за пределы (поле, return, static, в другой поток) → обычная heap-аллокация, обычные locks.

EA — одна из главных причин, почему «лишние объекты» в Java дёшевы. Не оптимизируй преждевременно через ручной object pooling — JIT часто справляется лучше.

> [JEP 169: Improve Escape Analysis](https://openjdk.org/jeps/169). Aleksey Shipilëv, [*JVM Anatomy Quark #18: Scalar Replacement*](https://shipilev.net/jvm/anatomy-quarks/18-scalar-replacement/).

### 3.3. Lock coarsening

Соседние `synchronized` блоки на **одном мониторе** сливаются в один:

```java
synchronized (lock) { x++; }
synchronized (lock) { y++; }
```

→

```java
synchronized (lock) { x++; y++; }
```

Меньше acquire/release pairs, меньше memory barriers.

### 3.4. Range check elimination

Внутри `for (int i = 0; i < arr.length; i++)` JIT доказывает, что `i` всегда в bounds → **не вставляет** bound check на каждый `arr[i]`. Это даёт почти прирост 2× на массивных алгоритмах.

### 3.5. Constant folding / propagation

```java
final int x = 42;
int y = x * 2 + 1;   // → 85 в compile-time
```

С генериками и lambda'ми constant folding часто видит то, что не видит programmer — например, после inline lambda тело становится «вшито» в callsite, и константные значения propagate'ятся.

### 3.6. Dead code elimination

```java
if (false) { veryExpensive(); }   // → выкинуто
if (debug && expensive()) { ... }   // если debug = compile-time const false → выкинуто
```

### 3.7. Loop unrolling / vectorization

Cycle `for (int i; i < N; i++)` может быть unrolled (несколько итераций в один блок без branch), векторизован (используются SIMD-инструкции AVX-2/AVX-512). См. [`FOREIGN_MEMORY_VECTOR.md`](FOREIGN_MEMORY_VECTOR.md) для Vector API — там autovectorization detailed.

### 3.8. Branch prediction & profile-guided layout

C2 знает из profile: какая ветка `if` берётся в 95% случаев. Эту ветку JIT кладёт **линейно** в нативный код (без jump), редкую — за `jmp` (cold path). CPU branch predictor любит линейный код → ещё прирост.

---

## 4. Deoptimization — когда assumptions ломаются

JIT строит оптимизации на **runtime profile** — на observed behaviour. Это **спекулятивно**: профиль может оказаться неточным. Если случается событие, нарушающее assumption — JIT не может «частично» работать. Он **откатывается** в interpreter (deoptimization), потом перекомпилирует с новым профилем.

### 4.1. Триггеры

**`unstable_if`** — JIT решил «эта ветка никогда не выполняется» (на основе профиля 0 hits), не сгенерировал для неё код вообще. Внезапно ветка выполняется → guard срабатывает → deopt.

**`class_check`** — site считался monomorphic (один тип), JIT inline-ил конкретную реализацию + guard `if (obj.getClass() != ExpectedClass) deopt`. Пришёл объект другого типа → guard сработал → deopt.

**`CHA invalidation`** — Class Hierarchy Analysis. JIT обнаружил, что у абстрактного метода **только одна** реализация → inline её напрямую. Потом загружается subclass с переопределением → CHA invalid → все скомпилированные методы с этим inline идут в deopt.

**`null_check`** — JIT считал поле never-null (на основе profile), не вставил null check. Появился null → NullPointerException, но через deopt → перекомпиляция уже с проверкой.

### 4.2. Цена

- Сама deopt — десятки µs (switch interpreter mode, восстановить frame);
- Потеря текущего профиля для этого метода;
- Очередь на перекомпиляцию;
- Деграда первых N вызовов после deopt (через interpreter).

Если deopt частые — это **алерт**. На warmup-фазе deopt — норма; в steady state — обычно nondeterministic нагрузка (полиморфизм там, где JIT ожидал monomorphic).

### 4.3. Логи

```
-XX:+UnlockDiagnosticVMOptions
-XX:+PrintCompilation
-XX:+TraceDeoptimization
```

Вывод:
```
Uncommon trap: trap_request=0xffffff45 ...
fr.pc 0x00007f8a... method=com.foo.Bar::process
reason=unstable_if action=reinterpret
```

`reason` показывает что сломало. `action=reinterpret` означает откат + повторная компиляция через profile.

---

## 5. Polymorphic call sites

Когда виртуальный метод вызывается в каком-то месте кода, C2 классифицирует **по числу типов**, виденных profile'ом:

- **Monomorphic** (1 тип) — inline single implementation + type guard. Стоимость почти как direct call.
- **Bimorphic** (2 типа) — inline обе ветки + type guard. Чуть дороже monomorphic.
- **Megamorphic** (3+ типов) — **нельзя** inline, используется vtable / itable lookup. Дорого: indirect jump, branch misprediction, потеря всех downstream-оптимизаций.

Анти-паттерн: **call site, видевший много типов**, теряет inline **навсегда**. Даже если потом 99% вызовов с одного типа — profile уже «грязный». Поэтому warmup проекта должен происходить с реалистичным набором типов (иначе production-нагрузка деградирует, когда впервые появится новый тип).

### 5.1. Inline cache (IC)

CPU-уровневая реализация call site: маленький cache из (type → target) пар. Hit — прямой jump. Miss — обновление IC. После 3 promotions IC становится megamorphic, на дальнейших miss выкидываются guard'ы.

Пример:
```java
interface Animal { void sound(); }
List<Animal> zoo = List.of(new Dog(), new Cat(), new Cow(), new Goat(), new Sheep());
for (Animal a : zoo) a.sound();   // 5 типов → megamorphic
```

Если бы было только `Dog` — monomorphic, JIT inline `Dog.sound()` напрямую.

---

## 6. JVMCI и Graal

**JVMCI** (Java VM Compiler Interface, [JEP 243](https://openjdk.org/jeps/243)) — API для подключения JIT-компилятора, **написанного на Java**. C2 написан на C++, его сложно дорабатывать. Graal-команда хотела попробовать другой подход.

**Graal** — C2-альтернатива. Преимущества:
- лучше оптимизирует Scala/Kotlin/реактивные конструкции (на C2 — анти-паттерн);
- partial escape analysis (PEA): объект может частично escape, JIT выделит только escape-part в heap;
- polymorphic inline caches богаче;
- проще модифицировать (Java vs C++);
- основа для **Truffle** — фреймворк для DSL'ов и других-языков-на-JVM (JS, Python, R, Ruby на GraalVM).

Подключение:
```
-XX:+UnlockExperimentalVMOptions
-XX:+UseJVMCICompiler
-XX:+EnableJVMCI
```

Недостатки: компиляция Graal'ом **медленнее** (Graal сам должен быть скомпилирован — chicken-and-egg). Фикс — **libgraal**: AOT-снимок Graal через `jaotc`, его можно линковать в JVM сразу.

**GraalVM** — отдельный JDK distribution (от Oracle Labs), включающий Graal + libgraal + Native Image + Truffle. Это **отдельный продукт**, не входит в default OpenJDK.

> [GraalVM website](https://www.graalvm.org/), [GraalVM Compiler GitHub](https://github.com/oracle/graal). Thomas Wuerthinger, *Graal: a high-performance Java compiler* — [OpenJDK Wiki](https://openjdk.org/projects/graal/).

---

## 7. AOT / Native Image

**AOT (Ahead-Of-Time) compilation** — компиляция bytecode → нативный exe **до запуска**, без JIT в runtime.

Эволюция:
- **`jaotc`** ([JEP 295](https://openjdk.org/jeps/295), Java 9–16) — экспериментально, удалён в 17. Был основан на Graal.
- **GraalVM Native Image** — production-grade AOT. Не входит в OpenJDK, отдельный продукт.

### 7.1. GraalVM Native Image

```bash
native-image -jar app.jar
./app   # standalone executable, без JVM!
```

Анализирует **closed-world** (все классы видны на compile-time), eliminates dead code, компилирует в standalone executable без JVM.

**Преимущества**:
- **Instant startup** (< 50 ms) — нет JVM warmup;
- **Низкий RSS** (10–50 MB вместо 200+);
- **Нет warmup latency** — peak performance сразу.

**Ограничения**:
- **Closed-world**: reflection / dynamic proxy / classloading в runtime требуют конфига `reflect-config.json`, иначе будет fail в runtime;
- Нет class loading в runtime — никакого dynamic plugin loading;
- Ограничения JIT-фич: нет deopt → нет speculative оптимизаций → код **в среднем** медленнее JIT-ed на long-running workload;
- Старт компиляции занимает минуты (анализ + кодоген).

### 7.2. Где использовать

- **CLI tools** (native Spring Boot CLI, GraalVM `js`/`gu`);
- **Serverless / FaaS** — cold start critical;
- **Microservices с быстрым стартом / коротким lifetime**;
- **WebAssembly hosts**, **embedded**.

Не подходит:
- Long-running services с разной нагрузкой (JIT даст лучше peak perf);
- Reflection-heavy фреймворки без поддержки native (Spring Boot 3+ поддерживает GraalVM nativeImage из коробки).

---

## 8. Compile-blackbox флаги для диагностики

```
-XX:+UnlockDiagnosticVMOptions
-XX:+PrintCompilation                 # лог компилируемых методов
-XX:+PrintInlining                    # what inlined, why not
-XX:+PrintAssembly                    # нужно hsdis-binary; выдаёт ассемблер!
-XX:CompileCommand="print,com/foo/Bar.hot"
-XX:+LogCompilation                   # XML лог в hotspot_pid.log → JITWatch
```

`PrintAssembly` требует [HSDIS plugin](https://github.com/openjdk/jdk/blob/master/src/utils/hsdis/README) — disassembler из binutils. С ним JIT-output показывает реальный x86/ARM код.

**JITWatch** ([github.com/AdoptOpenJDK/jitwatch](https://github.com/AdoptOpenJDK/jitwatch)) — GUI tool для анализа hotspot_pid.log. Показывает дерево inline, deopt'ы, ассемблер.

**async-profiler** (`--cpu` mode) — flame graph CPU-времени, видно где JIT-скомпилированный код, где interpreter, где safepoint.

**JFR** (`-XX:StartFlightRecording=...`) — JIT events встроены в JFR: `jdk.JitCompilation`, `jdk.Deoptimization`. Программный анализ через JFR API.

---

## 9. Что важно помнить про JIT

### 9.1. Warmup matters

Первые N вызовов идут через interpreter. **Нельзя мерить `System.nanoTime()` сразу после старта**. Используй **JMH** ([Java Microbenchmark Harness](https://github.com/openjdk/jmh)) — он сам обеспечивает warmup, измерения с iterations, статистическую обработку.

```java
@Benchmark
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
public int bench() { /* ... */ }
```

### 9.2. JIT может всё (де)оптимизировать

Код «оптимизированный руками» (manual unrolling, `final` для inline hint) часто **хуже** для JIT — он лучше знает hot path. `final` методам уже не нужен (CHA inlines полиморфные вызовы автоматически).

### 9.3. Anti-patterns

- **`synchronized` на `Integer.valueOf(N)`, `String literal`, `Boolean`** — JIT может elide lock (escape-analyzed как thread-local), но семантика — race condition. Никогда не lock'ить на кэшированных объектах.
- **Hot loop без safepoint** — pause time bug, см. [`GARBAGE_COLLECTION.md`](GARBAGE_COLLECTION.md).
- **Polymorphic call site** случайно (mock объект в тесте leaked в production prof) → megamorphic → деграда forever. Изоляция test/prof.

### 9.4. C2 bytecode-size cutoff

Слишком большой метод (> 8000 байт bytecode) **не компилируется**:
```
... did not compile (HugeMethodLimit)
```

Чинится разбиением на меньшие методы. Часто встречается в auto-generated code (parser'ы, protobuf accessors, switch-on-many-cases).

---

## 10. Что обязательно знать на собесе

1. **Mixed-mode VM**: interpreter → C1 → C2, **tiered compilation**.
2. **Что делает C2**: inlining, escape analysis (scalar replacement, lock elision), constant folding, dead code elim, range check elim, loop unrolling.
3. **Deoptimization** — что вызывает (unstable_if, class_check, CHA invalidation), цена.
4. **Polymorphic call sites** — mono/bi/megamorphic, важность профиля.
5. **OSR** — компиляция в середине метода для длинных циклов.
6. **JVMCI и Graal** — что это, чем лучше C2, в каких языках.
7. **GraalVM Native Image (AOT)** — преимущества, ограничения (closed-world, reflection config).
8. **Warmup в бенчмарках** — почему JMH, а не `System.nanoTime`.
9. **Hot loop без safepoint** — TTSP bug.

---

## Related

- Safepoints, GC pauses → [`GARBAGE_COLLECTION.md`](GARBAGE_COLLECTION.md)
- Code Cache для JIT-кода → [`JVM_MEMORY_AREAS.md`](JVM_MEMORY_AREAS.md)
- Lock elision и memory model → [`modules/concurrency/theory/THREADS_BASICS.md`](../../concurrency/theory/THREADS_BASICS.md)
- Bytecode, invokedynamic (что JIT inline'ит) → [`BYTECODE_INVOKEDYNAMIC.md`](BYTECODE_INVOKEDYNAMIC.md)
- Vector API autovectorization → [`FOREIGN_MEMORY_VECTOR.md`](FOREIGN_MEMORY_VECTOR.md)

### Внешние ресурсы

- **JMH (Java Microbenchmark Harness)** — <https://github.com/openjdk/jmh>
- **JITWatch GUI** — <https://github.com/AdoptOpenJDK/jitwatch>
- **Aleksey Shipilëv, *JVM Anatomy Quarks*** — особенно [#18 Scalar Replacement](https://shipilev.net/jvm/anatomy-quarks/18-scalar-replacement/), [#19 Lock Coarsening](https://shipilev.net/jvm/anatomy-quarks/19-lock-coarsening/), [#20 FFI Cost](https://shipilev.net/jvm/anatomy-quarks/20-fpu-spills/)
- **Claes Redestad (cl4es), *Inside Java***: <https://cl4es.github.io/>
- **HotSpot Engineering blog**: <https://inside.java/tag/hotspot/>
- **GraalVM Documentation**: <https://www.graalvm.org/latest/docs/>
- **JEP 243 (JVMCI)**: <https://openjdk.org/jeps/243>
- **Cliff Click's blog (HotSpot Server compiler author)**: <https://www.cliffc.org/blog/>
