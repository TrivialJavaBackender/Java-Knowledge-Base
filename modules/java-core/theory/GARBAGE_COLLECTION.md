# Garbage Collection

---

## 1. Откуда взялся GC и почему это сложно

Когда в 1995 году Джеймс Гослинг и команда из Sun Microsystems делали Java, они приняли несколько спорных решений. Запретили арифметику указателей. Запретили `delete`. Запретили `free`. Программист больше не управляет памятью — за него это делает runtime. Та же идея уже была в Lisp (с 1959 года), Smalltalk и в исследовательских языках, но **в индустриальном языке общего назначения** это был серьёзный шаг.

Почему: ручное управление памятью — главный источник серьёзных багов в C/C++. Use-after-free, double-free, memory leak, buffer overflow — всё это утечки или эксплойты. Microsoft в 2019 году [опубликовал статистику](https://www.zdnet.com/article/microsoft-70-percent-of-all-security-bugs-are-memory-safety-issues/): 70% security-уязвимостей в их продуктах — memory safety bugs. Java эту категорию проблем закрывает почти полностью (off-heap и FFM — отдельная история, см. [FOREIGN_MEMORY_VECTOR.md](FOREIGN_MEMORY_VECTOR.md)).

Цена — нужен GC. И GC — не один алгоритм, а целая дисциплина. С 1995 до 2025 года в HotSpot сменилось ~7 разных коллекторов, появилось 5 LTS-выпусков с разными default GC, и буквально каждый год выходит [новая статья](https://shipilev.net/jvm/anatomy-quarks/) от инженеров OpenJDK о том, как сделать ещё чуть лучше.

### 1.1. Три цели, которые конфликтуют

Любой GC балансирует между тремя метриками:

- **Latency (pause time)** — насколько долго приложение простаивает во время GC. Critical для real-time и interactive системы.
- **Throughput** — доля CPU, которая идёт на полезную работу (а не на GC). Critical для batch-обработки.
- **Footprint** — память, нужная сверх heap (структуры self-bookkeeping, fragmentation). Critical для embedded и cloud-billing.

Это **pick-two-of-three**: уменьшаешь pause time → растёт overhead на барьеры → теряется throughput; уменьшаешь footprint → больше CPU тратится на compaction. Каждый коллектор делает свой выбор — нет одного «лучшего» GC.

> Источник: Charlie Hunt, *Java Performance Companion* (Pearson, 2016), глава «GC Theory».

---

## 2. Что вообще считается «мусором»

Объект — мусор, если до него **нельзя добраться** из **GC roots** через цепочку ссылок. GC roots — это якоря, от которых начинается обход живого графа:

- **Stack локалы и параметры всех активных потоков** — `Thread.currentThread().getStackTrace()` показывает, какие frame'ы есть, в каждом — свои locals.
- **Статические поля всех загруженных классов** — `Class.getDeclaredFields()` без `instance`. Это самый коварный источник утечек: один static `Map` может удерживать гигабайты.
- **JNI / FFM live references** — то, что захватил native код (через `NewGlobalRef` или `MemorySegment.scope`).
- **Mounted CPU registers** — JIT может временно держать references в регистрах; safepoint синхронизирует это.
- **Monitor objects** — то, на чём кто-то держит `synchronized` lock.
- **Internal JVM roots** — Reference queue, System.in/out, ClassLoaders.

Любой объект, до которого **нет пути из roots**, можно собрать. Главный алгоритмический вопрос: как этот «достижимый граф» эффективно найти.

### 2.1. Reachability и тонкости

Reachability — статическое свойство в момент GC. Но между двумя моментами времени объект может «вернуться к жизни» (см. финализаторы в §11), либо наоборот, перейти в категорию **softly reachable** (см. §10). Спецификация JLS §12.6 различает несколько уровней:

- **Strongly reachable** — обычные ссылки;
- **Softly reachable** — путь только через `SoftReference`;
- **Weakly reachable** — путь только через `WeakReference`;
- **Phantom reachable** — путь только через `PhantomReference`, объект уже finalized;
- **Unreachable** — нет пути вообще, можно собрать.

Это иерархия: stronger состояния «побеждают». Если на объект есть хотя бы одна strong и одна weak ссылка — он strongly reachable.

> JLS §12.6.1 *Implementing Finalization*: <https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html#jls-12.6>

---

## 3. Поколения: эмпирика «большинство объектов умирает молодыми»

В 1984 году Ungar и Hudson, наблюдая Smalltalk, заметили: распределение «как долго живёт объект» — bimodal. **Большинство объектов умирает почти сразу**: temporary в выражении, итератор в цикле, билдер для строки. Меньшинство живёт всю программу: конфигурация, кэши, синглтоны. Между ними — почти ничего.

Это и есть **generational hypothesis**. Если выделить «детскую зону» (young generation), где живут свежие объекты, и сборка происходит часто — большинство умерших ловятся быстро, не сканируя весь heap. То, что выжило несколько циклов, переезжает в «взрослую зону» (old generation), где сборка реже.

### 3.1. Карта heap

```
   ┌─────────────────────────────────────────────────┐
   │  Young Generation                                │
   │  ┌────────┐  ┌──────────┐  ┌──────────┐         │
   │  │  Eden  │  │  Survivor│  │  Survivor│         │
   │  │ (90%)  │  │    S0    │  │    S1    │         │
   │  └────────┘  └──────────┘  └──────────┘         │
   ├─────────────────────────────────────────────────┤
   │  Old (Tenured) Generation                        │
   │                                                  │
   │  объекты, пережившие N minor-GC                  │
   └─────────────────────────────────────────────────┘
   ┌─────────────────────────────────────────────────┐
   │  Metaspace (native memory, вне heap)             │
   │  метаданные классов, bytecode методов            │
   └─────────────────────────────────────────────────┘
```

Default ratio для Parallel GC: Eden:Survivor = `-XX:SurvivorRatio=8` (то есть 80%:10%:10%), Young:Old = `-XX:NewRatio=2` (то есть 1/3 : 2/3). Для G1 эти ratios адаптивные — он сам выбирает размер регионов.

### 3.2. TLAB — почему аллокация в Java дешёвая

Когда вы пишете `new User(...)`, GC не делает global lock и не ищет «свободное место в heap». Вместо этого:

1. У каждого потока есть свой **TLAB (Thread-Local Allocation Buffer)** — кусок Eden размером ~100–500 KB.
2. В TLAB есть один указатель `top` — где «свободное» начинается.
3. Аллокация: проверить, что `size <= eden_end - top`, сделать `top += size`, вернуть указатель. **Это ~10 машинных инструкций без синхронизации.**
4. Когда TLAB заполнен — поток просит новый у GC. Это медленнее, но редко.

Это **bump-the-pointer allocation**. Стоимость = одна арифметическая операция + branch на overflow. Поэтому в Java «создание объекта дёшево» — это правда. На уровне x86 это разница между `add rax, 32` и полноценным аллокатором типа `malloc`.

Большие объекты (> `PretenureSizeThreshold`) идут сразу в Old, минуя TLAB и Eden. Размер этого порога не публичный, варьируется по collector'у.

> Подробнее: Aleksey Shipilëv, *JVM Anatomy Quark #4: TLAB Allocation* — <https://shipilev.net/jvm/anatomy-quarks/4-tlab-allocation/>

### 3.3. Minor / Major / Mixed / Full GC

Терминология сбивает с толку, давайте разложим:

- **Minor GC (Young GC)** — собирается только young generation. Дёшево (мало живых объектов), часто (раз в секунды на нагруженном сервисе).
- **Major GC (Old GC)** — собирается только old generation. Дорого, редко.
- **Mixed GC** — G1-специфичный термин: собираются все young-регионы плюс **несколько** old-регионов. Аналог partial major.
- **Full GC** — собирается весь heap. STW. На production — обычно симптом проблемы.

Один важный нюанс: терминология **зависит от collector'а**. У ZGC нет «minor» — он concurrent. У Parallel — есть только «minor» и «full». Лог GC помечает каждую сборку конкретным именем, не пытайтесь угадать по `gc.log` без контекста.

### 3.4. Tenuring threshold и promotion

Объект, переживший один minor GC, копируется из Eden в S0. Пережил два — из S0 в S1. И так далее. Счётчик возраста хранится в **mark word** объекта (несколько бит). Когда возраст достигает `-XX:MaxTenuringThreshold` (default 15 для большинства collector'ов) — объект **promoted** в Old.

JVM может **динамически** уменьшать threshold, если survivor space переполняется: лучше отправить сразу в Old, чем падать с promotion failure. См. `-XX:+PrintTenuringDistribution` для лога.

**Premature promotion** — анти-паттерн: объект на самом деле короткоживущий, но из-за высокой аллокации Survivor не хватает места → попадает в Old → копится → triggers expensive major GC. Лечение: увеличить Young (`-Xmn`), профилировать аллокацию.

---

## 4. Алгоритмы: что делает GC физически

Над живым графом можно совершать четыре базовых операции. Каждый GC — это комбинация из них.

### 4.1. Mark-Sweep

Простой и старый. Две фазы:

1. **Mark**: обойти граф от roots, поставить каждому достижимому объекту «mark bit».
2. **Sweep**: пройти всю heap, нашёл объект без bit'а — освободить.

**Преимущества:** простота, не требует свободного пространства сверх heap (in-place).

**Недостатки:** **фрагментация**. После нескольких циклов heap превращается в «решето» — большие объекты не находят contiguous space, нужен compact.

Mark-Sweep чисто исторический сейчас, используется только как часть других алгоритмов.

### 4.2. Mark-Compact

После mark — **сжать** живые объекты в начало региона. Свободное пространство становится contiguous, фрагментации нет.

Цена: тяжёлая операция (memmove'ы), приходится **обновлять все ссылки** (адрес объекта изменился). Используется в Parallel Old, CMS final compact (когда CMS не справился), full G1.

### 4.3. Copying (semi-space)

Идея Cheney (1970): heap делится пополам — **from-space** и **to-space**. Аллокация только в from-space. Когда место кончилось:

1. Обход графа: каждый достижимый объект **копируется** в to-space (с обновлением forward pointer).
2. Все ссылки переписываются на новые адреса.
3. From-space целиком обнуляется → становится новым to-space.

**Преимущества:** очень быстро (касаемся только живых, dead не сканируем); никакой фрагментации; bump-the-pointer внутри to-space.

**Недостатки:** **половина heap всегда свободна**. Это допустимо для young (там мало живых), но для old — катастрофично.

Используется для Young GC во всех современных collector'ах. Eden + S0 → S1 — это и есть copying GC.

### 4.4. Generational combine

Соединить: copying в young (мало живых, копируем быстро), mark-compact в old (объекты долгоживущие, копировать слишком дорого). Это и есть базовый дизайн HotSpot generational GC с конца 90-х.

> Введение в алгоритмы: Richard Jones, Antony Hosking, Eliot Moss, *The Garbage Collection Handbook* (Chapman & Hall, 2-е изд. 2023) — каноническая академическая монография.

---

## 5. Tri-color invariant и concurrent mark

Когда GC хочет mark'ить **параллельно с приложением** (concurrent collector — G1, ZGC, Shenandoah), возникает классическая проблема: пока GC идёт от roots в графе, приложение **меняет ссылки**. Без защиты GC может пропустить живой объект.

Tri-color algorithm (Dijkstra, Lamport, 1978) представляет объекты в трёх цветах:

- **Белый** — ещё не посещён GC. Все объекты стартуют белыми. Белые в конце = мусор.
- **Серый** — посещён, но его дети ещё не сканированы. В рабочей очереди.
- **Чёрный** — посещён, все дети просканированы. Точно живой.

**Инвариант**: «нет белой ссылки из чёрного объекта». Если этот invariant нарушается — белый объект может остаться неотмеченным, GC решит, что он мусор, и освободит → use-after-free.

Нарушение происходит, когда:
1. Mutator пишет в чёрный объект ссылку на белый.
2. Одновременно теряется предыдущая ссылка на тот же белый.

Решение — **write barrier** (см. §6) ловит это и либо помечает белого серым, либо вспоминает старую ссылку.

> Dijkstra, *On-the-Fly Garbage Collection: An Exercise in Cooperation* (1978) — оригинал концепции. Современное изложение: Shipilëv, [*JVM Anatomy Quark #18: Marking Pace*](https://shipilev.net/jvm/anatomy-quarks/18-marking-pace/).

---

## 6. Write barriers и card table

**Write barrier** — runtime-hook, исполняющийся на каждой записи reference-поля (`obj.field = ref`). Это **код, который JIT вставляет** в каждый `putfield` инструкцию.

Зачем барьер нужен для двух разных целей:

### 6.1. Generational barrier (для минимизации сканирования)

Когда GC делает minor GC (только young), ему нужно знать: какие ссылки из old указывают в young? Без этого знания пришлось бы сканировать весь Old (terabytes!) при каждом minor GC.

Решение — **card table**: байтовый массив, где один байт описывает 512 байт heap. Когда old → young write, барьер ставит соответствующий card в "dirty":

```
heap[offset = 1234567]   ←   card_index = 1234567 / 512 = 2411
card_table[2411] = DIRTY
```

Перед minor GC сканируются **только dirty cards**. Это в тысячи раз быстрее полного сканирования Old.

Структура **remembered set (RSet)** — более точная альтернатива (в G1, ZGC). Хранит per-region список cross-region references. Дороже в обновлении, но точнее в сканировании. Подробнее: [Inside Java — *Understanding G1 GC* by Erik Österlund](https://inside.java/2022/05/01/sip057/).

### 6.2. Concurrent mark barrier (для tri-color invariant)

Два подхода:

**SATB (Snapshot-At-The-Beginning, G1, Shenandoah)** — фиксирует «фотографию» графа на момент начала mark. Барьер **сохраняет старое значение** перед перезаписью:

```
void write(Object obj, Field f, Object newRef) {
    Object oldRef = obj.f;   // прочесть старое
    if (oldRef != null && marking_phase) {
        markQueue.push(oldRef);   // сохранить
    }
    obj.f = newRef;   // записать новое
}
```

Concurrent mark обработает всё, что было живо на старте. Цена: после mark остаются объекты, которые **только что умерли** (floating garbage) — соберутся на следующем цикле.

**Incremental Update (CMS, ZGC load barrier)** — барьер ловит **новые** ссылки. При записи `black.field = white` — barrier добавляет белого в work queue:

```
void write(Object obj, Field f, Object newRef) {
    obj.f = newRef;
    if (isBlack(obj) && isWhite(newRef) && marking_phase) {
        markQueue.push(newRef);
    }
}
```

Менее floating garbage, но больше overhead на каждой записи (нужны checks).

### 6.3. ZGC load barrier — особый зверь

ZGC использует **load barrier**, а не write. На каждое чтение reference проверяется bit pattern в самом указателе (colored pointers — см. §7.5). Если pattern «good» — продолжаем. Если «bad» — slow path: relocate / remap / mark.

Это позволяет ZGC делать concurrent compaction (объекты перемещаются параллельно с приложением), за счёт ~4% overhead на каждом чтении ссылок. На современном CPU этот overhead практически невидим из-за branch prediction.

> Per Liden, Stefan Karlsson, *ZGC: A Concurrent Garbage Collector* — [Inside Java](https://inside.java/tag/zgc/).

---

## 7. Современные collectors: who's who

### 7.1. Serial GC (`-XX:+UseSerialGC`)

Single-threaded, stop-the-world, generational. Mark-copy young + mark-compact old. Подходит для:
- Embedded JVM (контейнеры с одним CPU);
- Очень мелкие heap (< 100 MB);
- Default в client-VM (deprecated с 9).

В container с CPU limit < 2 — JVM может **по умолчанию выбрать Serial**, даже если вы не указывали. Проверить: `java -XX:+PrintFlagsFinal -version | grep UseSerialGC`.

### 7.2. Parallel GC (`-XX:+UseParallelGC`)

Multi-threaded версия Serial. **Все** фазы STW, но параллельные потоки. Mark-copy young + mark-compact old.

Цель — **maximum throughput**, plateau pause time. Используйте для batch-обработки, ETL, BigData workloads.

Был default для server-class до JDK 8. С JDK 9 default — G1.

### 7.3. CMS (Concurrent Mark-Sweep) — deprecated

Первый concurrent collector в HotSpot (с 2003). Большинство фаз concurrent, mark-sweep без compaction. Из-за no-compaction — фрагментация → промежуточные full GC (с компакцией).

Deprecated в JDK 9, удалён в JDK 14 (JEP 363). Замещён G1.

### 7.4. G1 (`-XX:+UseG1GC`) — current default

Дизайн от Sun (2004), production-quality с JDK 8 update 40, **default с JDK 9** (JEP 248).

Главная инновация — **regional heap**. Heap режется на ~2000 регионов размером 1–32 MB (`-XX:G1HeapRegionSize`). Регион — это **роль** (Eden / Survivor / Old / Humongous), не физический диапазон. Регион может переходить из роли в роль между циклами GC.

Алгоритм:
1. **Initial Mark** (STW, piggybacked на young GC) — root scanning;
2. **Concurrent Mark** — обход графа параллельно с приложением, SATB;
3. **Remark** (STW) — догнать concurrent изменения;
4. **Cleanup** (STW) — учёт regions, выбор collection set;
5. **Evacuation pause** (STW) — копирование живых из выбранных регионов в новые.

`MaxGCPauseMillis` (default 200 ms) — **soft hint**, G1 пытается выбирать столько регионов в collection set, чтобы успеть в pause-budget. Не гарантия!

**Humongous objects** (> ½ region size) занимают отдельные H-регионы; обрабатываются специально (не копируются).

> Specification: Monica Beckwith, *G1 GC Tuning* — [Oracle Blog](https://blogs.oracle.com/javamagazine/post/g1-the-garbage-first-garbage-collector).

### 7.5. ZGC (`-XX:+UseZGC`)

Дизайн от Oracle (Per Liden), production с JDK 15 (JEP 377). Цель — **sub-millisecond pauses** на heap до 16 TB.

Ключевые идеи:
- **Colored pointers**: в верхних битах указателя кодируется состояние (Marked0/1, Remapped, Finalizable). На 64-bit платформе указатели всего ~48 бит используются, остальные свободны. Это позволяет за **одну инструкцию** определить, нужно ли load-barrier.
- **Load barrier**: на каждое чтение ссылки — проверка состояния. Если bad — slow-path relocate/remap.
- **Concurrent compaction**: объекты перемещаются параллельно с приложением. Forwarding tables хранят «куда переехал».
- **Region-based**: как G1, регионы трёх типов (small/medium/large).

Все фазы практически concurrent. Pauses обычно **< 1 ms** независимо от heap.

До JDK 21 ZGC был **non-generational** — всегда сканировал весь heap, что давало хороший latency, но плохой throughput на small heap. **Generational ZGC** (JEP 439, Java 21) добавил young/old разделение → теперь почти всегда лучше G1 по latency, и сравним по throughput.

`-XX:+UseZGC -XX:+ZGenerational` (или просто `-XX:+UseZGC` с JDK 23+).

> [JEP 333: ZGC](https://openjdk.org/jeps/333), [JEP 439: Generational ZGC](https://openjdk.org/jeps/439), [Inside Java — ZGC tag](https://inside.java/tag/zgc/).

### 7.6. Shenandoah (`-XX:+UseShenandoahGC`)

Дизайн от Red Hat (2014), production с JDK 12 (на OpenJDK дистрибутиве Red Hat) / JDK 15 (mainline).

Похож на ZGC по цели — sub-10 ms pauses. Реализация другая:
- **Brooks forwarding pointer**: дополнительный slot в header каждого объекта, указывающий на «текущее место» (для concurrent move).
- **Read+write barriers** на каждое обращение.
- Pre/post barrier для concurrent compact.

В JDK 21+ Shenandoah тоже получил generational mode (preview).

Используется в основном в Red Hat OpenJDK / Eclipse Temurin. Production выбор обычно — между G1 (default) и ZGC (low-latency).

> [Shenandoah Wiki](https://wiki.openjdk.org/display/shenandoah), Aleksey Shipilëv, *Shenandoah's Design* — [shipilev.net/jvm/diy-gc/](https://shipilev.net/jvm/diy-gc/).

### 7.7. Epsilon (`-XX:+UseEpsilonGC`) — no-op

Только аллоцирует, никогда не освобождает. JEP 318, JDK 11. Полезен для:
- Short-lived workloads (CLI tools, lambdas);
- Performance baseline ("какой overhead даёт GC?");
- Тестирование memory leaks (heap растёт линейно).

### 7.8. Выбор в production

| Workload | Recommended |
|---|---|
| Web backend, latency p99 < 100 ms | **G1** (default), переход на ZGC если pauses вид'ы |
| Real-time trading, p99 < 10 ms | **ZGC** (с JDK 21 generational) |
| Batch ETL, throughput-bound | **Parallel** (`-XX:+UseParallelGC`) |
| Очень маленький heap (< 100 MB), один CPU | **Serial** (выбирается JVM-автоматом) |
| Embedded, IoT | **Serial** или **Epsilon** для short-lived |
| Lambdas / FaaS | **Serial** или **Epsilon** (быстрый старт) |
| Database, large heap (TB) | **ZGC** (sub-ms pauses scale to TB heap) |

---

## 8. Safepoint — что и где

**Safepoint** — точка в bytecode или JIT-коде, где поток может быть **безопасно** остановлен GC, JFR sampler, debugger, deoptimization. «Безопасно» означает:
- Стек консистентен (никакой объект не в полусоздании);
- Все references либо в JVM-known locations (стек, регистры на которые есть OopMap), либо JIT знает, как их извлечь.

JVM ставит safepoint-полл в нескольких местах:
- **Backward branches циклов** (для tight loop ситуации, см. §8.1);
- **Method return**;
- **Non-leaf method invocations** (вход в любой метод, который не тривиален).

### 8.1. Time-to-safepoint (TTSP) — скрытая боль

Когда JVM нужно начать STW, она:
1. Устанавливает «safepoint requested» flag.
2. Ждёт, пока **все** потоки достигнут safepoint и проверят flag.
3. Только тогда STW начинается.

**Time-to-safepoint** = max time, нужное любому потоку, чтобы дойти до safepoint. Если один поток не делает safepoint-проверок (например, tight counted loop без safepoint), он **блокирует** всю pause: остальные потоки уже остановились и ждут.

Пример проблемы:
```java
for (int i = 0; i < 1_000_000_000; i++) {
    sum += arr[i];   // нет вызовов методов, нет backward jump'ов в bytecode виде
}
```

JIT может определить это как "counted loop" и **убрать** safepoint-полл (для скорости). На больших N — секунды без safepoint. Если в это время другой поток вызвал STW — всё приложение зависло.

С JDK 10+ default `-XX:+UseCountedLoopSafepoints` (вставляет safepoint в каждую итерацию counted loop). С JDK 8 — нужно явно. Альтернатива — разбить loop на chunks с явным вызовом метода.

> Aleksey Shipilëv, *JVM Anatomy Quark #22: TTSP* — [shipilev.net/jvm/anatomy-quarks/22-ttsp/](https://shipilev.net/jvm/anatomy-quarks/22-ttsp/).

### 8.2. STW фазы даже у concurrent collectors

«Fully concurrent» — это маркетинг. У всех современных GC есть **некоторые** STW фазы, просто короткие:

| Collector | STW phases | Typical duration |
|---|---|---|
| G1 | Initial Mark, Remark, Cleanup, Evacuation | 5–200 ms |
| ZGC | Mark Start, Mark End, Relocate Start | < 1 ms |
| Shenandoah | Init Mark, Final Mark, Init Update Refs | < 10 ms |

ZGC's "sub-ms" — реальность, потому что STW phases — это **только rooting** (scanning thread stacks). Mark и compact полностью concurrent.

---

## 9. Что писать в production

### 9.1. Базовый JVM-набор флагов

```
-Xms2g -Xmx2g                          # heap fixed (избегать растяжения)
-XX:MaxRAMPercentage=75                # альтернативно: 75% от cgroup limit
-XX:+UseG1GC                            # явно (даже если default)
-XX:MaxGCPauseMillis=200                # G1 pause target
-XX:+AlwaysPreTouch                     # touch all heap pages at startup
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/heap.hprof
-XX:+ExitOnOutOfMemoryError             # для k8s: лучше упасть и перезапуститься
-Xlog:gc*,gc+heap=debug,gc+age=trace:file=gc.log:time,uptime,level,tags:filecount=5,filesize=100M
```

### 9.2. Что наблюдать

Главные метрики (через JMX / Micrometer / Prometheus JVM exporter):

- `jvm_gc_pause_seconds{quantile="0.99"}` — p99 pause time. Алерт > pause target × 1.5.
- `jvm_gc_pause_seconds_count` — частота. Алерт на > 10/s.
- `jvm_gc_memory_promoted_bytes_total` — rate of promotion. Постоянный promotion = leak или premature promotion.
- `jvm_gc_overhead_percent` — общая доля времени в GC. > 5% — алерт.

См. [`modules/infrastructure/theory/METRICS.md`](../../infrastructure/theory/METRICS.md) для как настроить.

### 9.3. GC log analysis

Tools:
- **[GCViewer](https://github.com/chewiebug/GCViewer)** — старый, но рабочий swing-tool;
- **[GCeasy](https://gceasy.io)** — online анализ, free для < 30 MB логов;
- **[JFR](https://docs.oracle.com/javacomponents/jmc-5-5/jfr-runtime-guide/about.htm)** — Java Flight Recorder, встроен в JVM, capture GC events plus много другого;
- **[`jdk.gc.*`](https://docs.oracle.com/en/java/javase/21/jfapi/index.html) JFR events** — программный доступ к GC статистике.

Типичные проблемы в логах:
- **Long pauses** → check `-Xlog:gc+phases`: какая фаза доминирует. Если remark — много references. Если evacuation — большой survivor.
- **Frequent young GC** → Eden слишком мал. `-Xmn` больше.
- **Promotion failures** → survivor переполняется. `-XX:SurvivorRatio=6` или больше Young.
- **Full GC every minute** → либо OOM приближается, либо `System.gc()` где-то вызывается. `-XX:+DisableExplicitGC`.
- **GC overhead limit exceeded** → > 98% времени в GC, < 2% heap reclaimed. Это OOM в маскировке.

---

## 10. References API: Soft / Weak / Phantom

`java.lang.ref` предоставляет четыре уровня «нестрогих» ссылок. Это **компонента взаимодействия с GC**, а не оптимизация — нужны, когда у тебя есть use case «держи объект, но не мешай GC».

### 10.1. Strong (обычная)

`Object o = new Object();` — это strong. Пока есть путь по strong ссылкам, объект не собирается.

### 10.2. SoftReference

```java
SoftReference<Image> ref = new SoftReference<>(bigImage);
Image cached = ref.get();   // null или объект
```

GC **может** собрать soft-referenced объект, **если нужна память**. На практике HotSpot держит soft-references до тех пор, пока heap не близок к OOM. Поведение настраивается `-XX:SoftRefLRUPolicyMSPerMB`.

Use case: memory-sensitive cache. Когда heap большой — кэш живёт. Когда мало памяти — GC чистит. Реализация `Caffeine.softValues()` — поверх SoftReference.

Caveat: GC может собрать soft references **очень неравномерно** — несколько подряд, потом ничего долго. Не используй для предсказуемого кэша; используй [Caffeine с size-based eviction](../../caching-deep-dive/theory/CAFFEINE.md).

### 10.3. WeakReference

```java
WeakReference<User> ref = new WeakReference<>(user);
User u = ref.get();
```

GC собирает weakly-referenced объект на **первой же** возможности (любой GC цикл). Использования:
- **`WeakHashMap`** — entry удаляется, когда ключ становится weakly reachable.
- **Listener registries**, чтобы дерегистрация была автоматической при «забывании» listener'а.
- **ThreadLocal storage** для значений — listener-pattern на CL.

### 10.4. PhantomReference

```java
PhantomReference<Resource> ref = new PhantomReference<>(resource, refQueue);
// ref.get() ВСЕГДА возвращает null
```

PhantomReference никогда не возвращает объект через `get()`. Единственное назначение — **уведомление о смерти объекта** через `ReferenceQueue`. Когда объект становится phantom-reachable, JVM enqueues ref в queue.

Use case: **pre-mortem cleanup** для native resources. Когда твой Java-объект-обёртка вокруг native handle становится phantom-reachable, ты получаешь уведомление и можешь освободить native ресурс. Реализация **`java.lang.ref.Cleaner`** (JEP 264) основана на phantom references.

```java
Cleaner cleaner = Cleaner.create();
cleaner.register(this, () -> nativeFree(handle));
// callback вызовется, когда `this` станет phantom-reachable
```

Cleaner — рекомендуемая замена `finalize()` (см. §11).

> [JEP 264: Platform Logging API and Service](https://openjdk.org/jeps/264). Brian Goetz, [*All About Cleaner*](https://www.infoq.com/articles/Cleaners-Java/) (InfoQ, 2018).

---

## 11. `finalize()` — почему deprecated

`Object.finalize()` — метод, вызываемый GC перед сборкой объекта. Идея — позволить объекту «cleanup перед смертью».

Что пошло не так:
1. **Порядок не гарантирован** — JVM может в любом порядке;
2. **Время не гарантировано** — между «не reachable» и `finalize()` могут пройти минуты;
3. **Может «воскресить»** объект — `this.staticRef = this;` в `finalize()` делает объект reachable снова → объект «оживает», но `finalize` больше не вызовется;
4. **Performance penalty** — Finalizer thread обрабатывает финализуемые объекты в отдельной очереди, что замедляет GC.

**Deprecated с Java 9** (JEP 421), **terminally deprecated с Java 18**, **возможно удалят** в будущей версии.

Замена — **`Cleaner`** (см. §10.4). Различия:
- Cleaner action **не имеет** ссылки на объект → не может его воскресить;
- Cleaner — daemon thread по умолчанию, не блокирует shutdown JVM;
- Несколько Cleaner-ов в одной JVM — независимые;
- Регистрация явная — нет «авто-вызовов» для всех объектов.

> [JEP 421: Deprecate Finalization for Removal](https://openjdk.org/jeps/421).

---

## 12. Container-aware sizing — production realities

Когда JVM работает в Docker / Kubernetes, она читает **cgroup limits**:
- `cgroup v1`: `/sys/fs/cgroup/memory/memory.limit_in_bytes`
- `cgroup v2`: `/sys/fs/cgroup/memory.max`

И настраивает heap соответственно. До Java 8u191 / Java 10 — этого не было; JVM читала host RAM → катастрофически промахивалась с heap sizing в container'ах.

`-XX:+UseContainerSupport` (default on с 10) — обязательно проверять, что не выключено.

### 12.1. `MaxRAMPercentage` — как считать

Default `-XX:MaxRAMPercentage=25.0` — JVM возьмёт 25% от cgroup limit под heap. Это **очень мало** для backend сервиса; типично нужно **60–80%**.

Помни: **heap — не весь RSS** (см. [`JVM_MEMORY_AREAS.md`](JVM_MEMORY_AREAS.md)):
- Metaspace 100–300 MB;
- Code Cache 100–250 MB;
- Thread stacks (`-Xss × N_threads`);
- Direct ByteBuffer (`-XX:MaxDirectMemorySize`);
- GC structures, JIT data, NIO buffers, JNI, FFM.

Резерв 20–30% от container limit на non-heap — практическое правило. Если задаёшь `MaxRAMPercentage=80`, получишь OOMKilled при большом количестве threads.

### 12.2. AlwaysPreTouch

`-XX:+AlwaysPreTouch` — на старте JVM **физически** touch'ает все страницы heap (memset 0). Это медленнее старта (секунды), но:
- **Нет page-fault latency** на первой аллокации;
- В контейнерах с swappy memory — гарантия, что heap реально аллоцирован.

Для микросервиса с быстрым стартом (lambda) — не использовать (увеличит cold start). Для long-running service — включать.

---

## 13. Common pitfalls и debug

### 13.1. Memory leak шаблоны

- **Static collections без bounded size** — `static Map<Key, Value>` живёт всю JVM.
- **ThreadLocal в shared thread pool** — value живёт, пока живёт thread.
- **Listener registrations без deregister**.
- **Inner classes** держат outer reference.
- **String.intern()** в loop раздувает StringTable (см. [`STRING_INTERNALS.md`](STRING_INTERNALS.md)).
- **ClassLoader leaks** при webapp redeploy (см. [`CLASS_LOADERS.md`](CLASS_LOADERS.md)).
- **Direct ByteBuffer leaks** — wrapper не дошёл до GC → Cleaner не сработал → native память течёт.

### 13.2. Tools

- `jcmd <pid> GC.heap_info` — текущее распределение heap;
- `jcmd <pid> GC.run` — force GC (для дебага, не для prod);
- `jmap -dump:format=b,file=heap.hprof <pid>` — heap dump;
- `-XX:+HeapDumpOnOutOfMemoryError` — auto dump на OOM;
- **Eclipse MAT (Memory Analyzer Tool)** — анализ dump, dominator tree, leak suspects;
- **async-profiler** `--alloc` — flame graph аллокаций;
- **JFR** — `-XX:StartFlightRecording=filename=app.jfr,duration=60s,settings=profile`.

### 13.3. Анти-паттерн: `System.gc()`

`System.gc()` — это **hint**, JVM может проигнорировать. На практике HotSpot **всегда** выполняет full GC по этому вызову. В production это:
- блокирует приложение на секунды;
- ломает работу всех concurrent collectors (G1, ZGC планируют сами);
- редко решает реальную проблему.

`-XX:+DisableExplicitGC` отключает. Или `-XX:+ExplicitGCInvokesConcurrent` (для G1/ZGC — превратит в concurrent cycle вместо STW).

> Brian Goetz, *Java theory and practice: Garbage collection in the HotSpot JVM* (IBM developerWorks, archived) — классические объяснения. Современнее: серия [shipilev.net/jvm/anatomy-quarks/](https://shipilev.net/jvm/anatomy-quarks/).

---

## 14. Что обязательно знать на собесе

1. **Generational hypothesis** — почему поколения, что такое TLAB, bump-the-pointer.
2. **G1 vs ZGC vs Shenandoah** — когда что выбирать, при каких pause требованиях.
3. **Safepoint** — что это, почему tight loop без safepoint = проблема.
4. **Write barrier** — зачем нужен, разница SATB vs incremental update.
5. **Tri-color invariant** — на собесе уровня senior могут попросить нарисовать.
6. **Strong / Soft / Weak / Phantom reference** — типичные use cases.
7. **`finalize()` deprecated, Cleaner replacement** — современная практика.
8. **Container-aware sizing** — `MaxRAMPercentage`, почему `-Xmx == cgroup_limit` плохо.
9. **Анализ GC log** — что искать (long pauses, promotion failures, full GC frequency).
10. **System.gc() анти-паттерн** — почему.

---

## Related

- JMM (happens-before, visibility) → [`modules/concurrency/theory/THREADS_BASICS.md`](../../concurrency/theory/THREADS_BASICS.md)
- JVM memory areas (heap, metaspace, code cache, direct) → [`JVM_MEMORY_AREAS.md`](JVM_MEMORY_AREAS.md)
- JIT и safepoint placement, lock elision → [`JIT_COMPILATION.md`](JIT_COMPILATION.md)
- Reference types и `Cleaner` API детальнее → [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md) (раздел VarHandle и Unsafe replacement)
- JVM в контейнерах (cgroups, OOMKilled) → [`modules/infrastructure/theory/DOCKER.md`](../../infrastructure/theory/DOCKER.md)
- Prometheus JVM metrics, GC dashboards → [`modules/infrastructure/theory/METRICS.md`](../../infrastructure/theory/METRICS.md)
- Caffeine soft-references vs size-based eviction → [`modules/caching-deep-dive/theory/CAFFEINE.md`](../../caching-deep-dive/theory/CAFFEINE.md)

### Внешние ресурсы

- **OpenJDK GC team**: <https://wiki.openjdk.org/display/HotSpot/Main>
- **Aleksey Shipilëv's blog**: <https://shipilev.net> — особенно [JVM Anatomy Quarks](https://shipilev.net/jvm/anatomy-quarks/) (40+ статей по 1 теме каждая)
- **Inside Java** (Oracle): <https://inside.java/tag/gc/> и <https://inside.java/tag/zgc/>
- **JEP index**: <https://openjdk.org/jeps/0> — поиск по GC JEPs (333, 318, 363, 377, 379, 439)
- **The Garbage Collection Handbook** (Jones, Hosking, Moss) — academic monograph
- **Java Performance Companion** (Hunt, John, Beckwith) — practitioners' guide
