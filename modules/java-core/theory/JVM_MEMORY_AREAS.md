# JVM Memory Areas

---

## 1. Heap — не вся память JVM

«Java-приложение жрёт 4 GB» — типичная фраза. И почти всегда вопрос «4 GB чего?» вызывает паузу. Heap? RSS процесса? Container memory usage? Это разные числа, и расхождение между ними — главная причина того, что Java-сервис в Kubernetes падает с OOMKilled, **хотя heap далеко не полон**.

Карта памяти JVM-процесса, как её видит Linux (через `/proc/<pid>/status`, поле `VmRSS`):

```
┌─────────────────────────────────────────────────────────┐
│  Java Heap            (-Xms / -Xmx)        │ GC-managed │
├─────────────────────────────────────────────────────────┤
│  Metaspace            (-XX:MaxMetaspaceSize)│ native    │
│  Compressed Class Space (-XX:CompressedClassSpaceSize)  │
├─────────────────────────────────────────────────────────┤
│  Code Cache           (-XX:ReservedCodeCacheSize)        │
├─────────────────────────────────────────────────────────┤
│  Thread Stacks        (-Xss × N_threads)                 │
├─────────────────────────────────────────────────────────┤
│  Direct ByteBuffer    (-XX:MaxDirectMemorySize)          │
│  Unsafe.allocateMemory / FFM Arena                        │
├─────────────────────────────────────────────────────────┤
│  GC structures (card tables, remembered sets, marking)   │
│  JIT data, symbol tables, JNI, FFM downcalls             │
└─────────────────────────────────────────────────────────┘
```

Все эти зоны живут **рядом**, и `-Xmx == container_limit` — рецепт катастрофы. cgroup OOM-killer не различает «это heap, а это metaspace»; он просто видит RSS > limit и кидает SIGKILL.

> Aleksey Shipilëv, [*JVM Anatomy Quark #12: Native Memory Tracking*](https://shipilev.net/jvm/anatomy-quarks/12-native-memory-tracking/) — подробный разбор всех зон с примерами.

---

## 2. Heap

Та самая зона, которой управляет GC. Подробности про generational структуру, Eden/Survivor/Old и алгоритмы сборки — см. [`GARBAGE_COLLECTION.md`](GARBAGE_COLLECTION.md). Здесь — про настройку.

### 2.1. Sizing-флаги

```
-Xms2g                  # initial heap (committed RAM)
-Xmx2g                  # max heap
-XX:NewSize=512m        # initial young
-XX:MaxNewSize=512m     # max young
-XX:NewRatio=2          # Old:Young = 2 (для Parallel; G1 сам управляет)
-XX:SurvivorRatio=8     # Eden:Survivor = 8 (default)
```

**Best practice**: `-Xms == -Xmx`. Иначе JVM ленится: стартует с `Xms`, расширяет при нехватке, контрактует при простое. В контейнере это создаёт ложное ощущение «памяти много, давайте ещё нагрузим» — а потом heap не сможет расшириться, потому что cgroup limit рядом.

В контейнерах часто используется альтернатива:

```
-XX:InitialRAMPercentage=70
-XX:MaxRAMPercentage=70
```

JVM возьмёт 70% от cgroup limit под heap. Преимущество — переносимый Helm chart: один и тот же образ работает с любым `resources.limits.memory`.

### 2.2. `-XX:+AlwaysPreTouch`

По умолчанию JVM **резервирует** heap пространство при старте (`mmap`), но **не trogает страницы** до первой записи. На первой записи происходит **page fault**: kernel выделяет физическую страницу, обнуляет. Это микросекунды, но на больших heap (десятки GB) суммарно — заметно.

`-XX:+AlwaysPreTouch` форсирует обход всех страниц при старте — JVM пишет 0 во все 4-килобайтные страницы heap. Это:
- Замедляет старт (для 30 GB heap — секунды);
- Гарантирует, что физическая память реально доступна (нет лишних page-fault'ов в hot path);
- Полезно для long-running сервисов с предсказуемой нагрузкой;
- Вредно для quick startup (lambda, CLI tool).

---

## 3. Metaspace — где живут классы

До Java 7 метаданные классов жили в **PermGen** — зоне heap фиксированного размера. Это создавало проблему: PermGen full → `OutOfMemoryError: PermGen space`, не лечилось ничем кроме рестарта с большим `-XX:MaxPermSize`.

Java 8 (JEP 122) убрал PermGen, метаданные переехали в **Metaspace** — область **native memory** вне heap. По умолчанию **`MaxMetaspaceSize` не ограничен** — растёт, пока есть RAM. Это часто хуже, чем PermGen: вместо OOM в нужный момент получаешь медленную утечку.

### 3.1. Что хранится

- **Klass-структура** на каждый загруженный класс — описание полей, методов, иерархия. Это ~5–20 KB на класс. Spring Boot приложение легко загружает 20K классов → 300–500 MB metaspace.
- **Bytecode методов** — копия `.class` в runtime-формате.
- **Constant pool** — литералы, имена, signature'ы.
- **MethodHandle linkage info, lambda call sites** — `invokedynamic`-метаданные (см. [`BYTECODE_INVOKEDYNAMIC.md`](BYTECODE_INVOKEDYNAMIC.md)).
- **Аннотации** — `@Retention(RUNTIME)` хранится здесь.

### 3.2. Compressed Class Space

Сегмент Metaspace для **класс-указателей**. На 64-bit платформе нативные указатели — 8 байт. Если heap < 32 GB и Klass-структуры < 1 GB — JVM использует **32-bit compressed class pointers** (`-XX:+UseCompressedClassPointers`, default).

В заголовке каждого объекта вместо 8-byte указателя на Klass хранится 4-byte offset в Compressed Class Space. Это экономит **4 байта на каждом объекте**, что для приложения с миллиардами мелких объектов — десятки GB suммарно.

Ограничение: `-XX:CompressedClassSpaceSize` (default 1 GB). Если упрётесь — нужно либо отключить compressed class pointers, либо разобраться, почему классов так много.

### 3.3. Memory leak via Metaspace — главная боль

Сценарий типичный для webapp redeploy (см. подробнее [`CLASS_LOADERS.md`](CLASS_LOADERS.md)):

1. Application server (Tomcat, JBoss) загружает webapp v1 в `WebappClassLoader_v1`.
2. Все классы webapp оседают в Metaspace, помечены этим CL.
3. Hot redeploy → новый `WebappClassLoader_v2`, новые классы загружаются.
4. **Старый CL не GC-ится**, потому что что-то держит на него ссылку: JDBC `Driver`, ThreadLocal в shared thread pool, MBean без unregister, AOP agent caches.
5. Все классы старого CL остаются в Metaspace.
6. После N redeploy: `OutOfMemoryError: Metaspace`.

Защита:
- **Всегда** ставить `-XX:MaxMetaspaceSize=256m` (или сколько нужно). Лучше явный OOM с heap dump, чем медленная деградация node.
- `-XX:+HeapDumpOnOutOfMemoryError` + анализ через Eclipse MAT (искать «Loader» классы в dominator tree).

### 3.4. Dynamic class generation

Каждая lambda → hidden class. Каждый CGLIB proxy → класс. Каждый Hibernate enhanced entity → класс. Каждый Mockito spy → класс.

Без bounded cache фреймворк может генерировать **новый** класс на каждый вызов → линейный рост metaspace. Hibernate, Spring AOP уже умеют кэшировать; самописные ASM/ByteBuddy агенты — часто нет.

```bash
jcmd <pid> VM.classloaders            # сколько CL живёт
jcmd <pid> GC.class_stats             # классы по CL и размеру
jcmd <pid> VM.metaspace               # детальная статистика
-Xlog:class+load=info:file=class.log  # все загруженные классы
```

> [JEP 122: Remove the Permanent Generation](https://openjdk.org/jeps/122). Stuart Marks, [*Lifecycle of Classes*](https://stuartmarks.wordpress.com/) — серия постов о ClassLoader/Metaspace.

---

## 4. Code Cache — место для JIT-компиляции

JIT-скомпилированный машинный код хранится в **Code Cache** — отдельная native-зона, ничего общего с heap. Default размер `-XX:ReservedCodeCacheSize=240m` (на 64-bit).

### 4.1. Segmented Code Cache (JEP 197)

С JDK 9 default `-XX:+SegmentedCodeCache` разбивает на три сегмента:

- **Non-method segment** — stubs, JVM internal code (interpreter, runtime helpers). Размер `-XX:NonNMethodCodeHeapSize`.
- **Profiled segment** — C1-compiled методы (короткоживущий, часто перекомпилируется). `-XX:ProfiledCodeHeapSize`.
- **Non-profiled segment** — C2/Graal compiled методы (долгоживущий, hot). `-XX:NonProfiledCodeHeapSize`.

Разделение нужно для:
- Лучшая CPU cache locality (hot C2-код кучкой);
- Точное планирование sweeper'а (старые C1 чаще удаляются).

### 4.2. Code Cache full — катастрофа

Когда Code Cache заполнен (типично — большое приложение с reflection-heavy фреймворками, dynamic class generation, hot redeploy):

```
Java HotSpot(TM) 64-Bit Server VM warning: CodeCache is full. 
Compiler has been disabled.
Try increasing the code cache size using -XX:ReservedCodeCacheSize=
```

JIT **выключается**. Дальше всё крутится через interpreter — latency **в 10–100 раз** хуже. Heroic recovery невозможен без рестарта (если не включён `-XX:+UseCodeCacheFlushing`, но он тоже не всегда помогает).

Для крупных enterprise приложений рекомендуется явно:

```
-XX:ReservedCodeCacheSize=512m
```

Мониторинг — JMX `java.lang:type=MemoryPool,name=CodeHeap *`, Prometheus JVM exporter эти метрики экспортит.

---

## 5. Thread Stacks — память за пределами heap

Каждый **platform thread** (`java.lang.Thread`) — это OS-уровневый поток с **фиксированным stack**. `-Xss` (default 1 MB на x64 Linux, 512K на 32-bit) — размер каждого стека.

```
10K threads × 1 MB = 10 GB native памяти
```

Это **до того, как приложение что-то сделало**. Поэтому платформенные потоки — фундаментальный bottleneck для high-concurrency I/O: тысячи блокирующих HTTP-вызовов = тысячи потоков = десятки GB только под стэки.

### 5.1. Виртуальные потоки (JEP 444)

Решение проблемы — **virtual threads** (JDK 21+). Виртуальный thread — это лёгковесное Java-объектное представление, выполняющееся на pool **carrier threads**. Стек хранится в **heap**, не в native, и **growable** (выделяется кусками).

Подробности — [`modules/concurrency/theory/VIRTUAL_THREADS.md`](../../concurrency/theory/VIRTUAL_THREADS.md). Здесь важно одно: виртуальные потоки **переносят** stack из native в heap, что разгружает RSS.

### 5.2. `StackOverflowError`

Кидается, когда frame не помещается в `-Xss`. Причины:
- глубокая рекурсия (особенно без TCO — JVM tail-call optimization не делает);
- циклическая `toString` / `equals` (объекты ссылаются друг на друга);
- Spring AOP interceptor chain (каждый proxy добавляет 5–10 frame'ов).

`-Xss512k` — экономия памяти для приложений с тысячами тонких потоков. `-Xss2m` — для глубокой рекурсии (compilers, parser'ы, recursive AST visitors).

---

## 6. Direct memory: off-heap из Java

`ByteBuffer.allocateDirect(int n)` аллоцирует **native** память через `Unsafe.allocateMemory`. JVM держит в heap только wrapper (`DirectByteBuffer` объект ~ 64 байта), реальные `n` байт — в native.

```java
ByteBuffer buf = ByteBuffer.allocateDirect(1024 * 1024 * 100);   // 100 MB native
buf.putLong(0, 42L);
```

Освобождение происходит **через `Cleaner`** (см. [`GARBAGE_COLLECTION.md`](GARBAGE_COLLECTION.md), PhantomReference): когда wrapper становится phantom-reachable, JVM вызывает callback, который освобождает native память.

### 6.1. Зачем direct buffer

- **Zero-copy I/O**: `FileChannel.read(buf)` и `SocketChannel.write(buf)` могут писать **напрямую** между kernel buffer и native memory, без копии через heap.
- **Off-heap storage**: Netty, Cassandra, Lucene держат гигабайты данных off-heap → нет GC pressure от больших long-lived объектов.
- **Memory-mapped files**: `FileChannel.map(...)` отдаёт `MappedByteBuffer` — это view над mmap'нутым файлом. Изменения автоматически попадают на диск (через page cache).

### 6.2. Direct memory leak

Главный pitfall: wrapper не дошёл до GC → Cleaner не сработал → native память течёт. Воспроизведение:

```java
while (true) {
    ByteBuffer.allocateDirect(1024 * 1024);   // wrapper short-lived
    // Eden быстро заполнится → minor GC → wrappers собраны
    // НО: между аллокациями minor GC не успевает, JVM forced to native OOM
}
```

Default `-XX:MaxDirectMemorySize` равен `-Xmx`. Если приложение интенсивно использует direct buffers — задавать явно. Превышение → `OutOfMemoryError: Direct buffer memory`.

Мониторинг: JMX `java.nio:type=BufferPool,name=direct`, Prometheus JVM exporter поле `jvm_buffer_count` / `jvm_buffer_memory_used_bytes`.

### 6.3. `Unsafe.allocateMemory` — наследие

`sun.misc.Unsafe` (после JDK 9 — `jdk.internal.misc.Unsafe`) даёт raw `malloc`/`free` через `allocateMemory` / `freeMemory`. Использовался Netty, Aeron, Disruptor для absolute control над off-heap.

Strongly discouraged с Java 9+. Замены:
- **VarHandle** для atomic-доступа к полям (см. [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md));
- **FFM API** для off-heap allocation (см. [`FOREIGN_MEMORY_VECTOR.md`](FOREIGN_MEMORY_VECTOR.md));
- **`MemorySegment.allocate`** заменяет `allocateMemory`.

> [JEP 471: Deprecate the Memory-Access Methods in `sun.misc.Unsafe` for Removal](https://openjdk.org/jeps/471).

---

## 7. Native Memory Tracking (NMT) — куда уходит RSS

Когда RSS > heap, и непонятно, что именно ест память:

```
java -XX:NativeMemoryTracking=summary -jar app.jar
jcmd <pid> VM.native_memory summary
```

Вывод:
```
Total: reserved=4.2GB, committed=2.8GB
-                 Java Heap (reserved=2GB, committed=2GB)
-                     Class (reserved=256MB, committed=200MB)
-                    Thread (reserved=104MB, committed=104MB)
-                      Code (reserved=240MB, committed=80MB)
-                        GC (reserved=120MB, committed=80MB)
-                  Compiler (reserved=4MB, committed=4MB)
-                  Internal (reserved=8MB, committed=8MB)
-                    Symbol (reserved=20MB, committed=20MB)
-    Native Memory Tracking (reserved=12MB, committed=12MB)
-               Arena Chunk (reserved=200MB, committed=200MB)
```

Категории:
- **Java Heap** — `-Xmx`;
- **Class** — Metaspace + Compressed Class Space;
- **Thread** — стэки потоков (видно total и per-thread);
- **Code** — Code Cache;
- **GC** — card tables, remembered sets, marking bitmaps (для G1 это десятки MB на каждый GB heap);
- **Compiler** — рабочие буферы C1/C2;
- **Internal**, **Symbol** — internal structures, string symbols;
- **Arena Chunk** — динамическая allocator-память.

`detail`-mode даёт точные call stack'и аллокаций. **Overhead NMT — 5–10%**, в production включать на время инцидента.

`summary.diff` (сравнение двух snapshot'ов) — золотой стандарт для поиска «откуда утечка»:

```
jcmd <pid> VM.native_memory baseline     # сохранить
# ... подождать, нагрузить ...
jcmd <pid> VM.native_memory summary.diff # сравнить
```

> [Inside Java — *Diagnosing Memory Issues with NMT*](https://inside.java/2023/11/15/diagnose-memory-with-nmt/).

---

## 8. Container-aware sizing

Java 8u131+ и 10+ **читают cgroup limits** из:
- `cgroup v1`: `/sys/fs/cgroup/memory/memory.limit_in_bytes`
- `cgroup v2`: `/sys/fs/cgroup/memory.max`

И настраивают heap / available CPUs соответственно. До этого JVM читала host RAM/CPU → дикие ошибки (e.g., `Runtime.getRuntime().availableProcessors()` возвращал 64 на хосте с 64-ядерным CPU, даже если container limit — 2 CPU).

### 8.1. Что включать

`-XX:+UseContainerSupport` — default **on с JDK 10**. Проверить:
```bash
java -XX:+PrintFlagsFinal -version | grep UseContainerSupport
```

Если по какой-то причине off — включить. Без этого нет container-aware sizing.

### 8.2. Best practice для k8s

```yaml
spec:
  containers:
    - name: app
      resources:
        requests:
          memory: 2Gi
        limits:
          memory: 2Gi              # equals — иначе get OOMKilled при burst
      env:
        - name: JAVA_TOOL_OPTIONS
          value: >-
            -XX:MaxRAMPercentage=70
            -XX:InitialRAMPercentage=70
            -XX:+UseG1GC
            -XX:+AlwaysPreTouch
            -XX:+ExitOnOutOfMemoryError
```

- `limits.memory == requests.memory` — иначе OOMKilled при burst;
- `MaxRAMPercentage=70` оставляет 30% на non-heap (~600 MB для 2 GB container);
- `ExitOnOutOfMemoryError` — для k8s лучше упасть и перезапуститься, чем зависнуть;
- `JAVA_TOOL_OPTIONS` подхватывается JVM автоматически (нет нужды менять Docker CMD).

См. [`modules/infrastructure/theory/DOCKER.md`](../../infrastructure/theory/DOCKER.md) про cgroups, OOMKilled.

---

## 9. Common pitfalls — что ломается

### 9.1. `-Xmx == container.limit`
Heap полон → JVM не сможет аллоцировать → но heap **меньше** RSS на ~30–40% → cgroup OOMKilled до того, как JVM сама поймает OOM. Никакого heap dump, никакого warning. Решение — оставлять резерв через `MaxRAMPercentage`.

### 9.2. Metaspace без limit
Default `-XX:MaxMetaspaceSize` unlimited. Утечка медленная, OOM приходит через дни после deploy. Всегда явно: `-XX:MaxMetaspaceSize=256m`.

### 9.3. Direct buffer leak
Heap нормальный, но `jvm_buffer_memory_used_bytes` растёт. Wrapper не GC-ится → Cleaner не вызывается. Решение — `-XX:MaxDirectMemorySize=512m` явно + мониторинг.

### 9.4. Thread stack overflow в production
10000 потоков × 1 MB = 10 GB native. На лету не видно (не heap), но RSS зашкаливает. Решения: virtual threads, thread pool с bounded size, `-Xss512k` для тонких потоков.

### 9.5. Code Cache overflow в long-running services
После недель работы Code Cache забивается дебрисом старых компиляций. JIT отключается, латентность взрывается. Решения: `-XX:ReservedCodeCacheSize=512m`, рестарт через ~неделю по cron.

---

## 10. Что обязательно знать на собесе

1. **Heap — не весь RSS** — что ещё ест память (metaspace, code cache, threads, direct, GC structures).
2. **PermGen → Metaspace** в Java 8, причины и риски (unlimited default).
3. **Compressed Class Space** — что это, зачем 32-bit class pointers.
4. **Direct ByteBuffer** — что такое, как освобождается (Cleaner), как мониторить.
5. **`-Xss`** — почему 10K потоков = 10 GB stack memory, и зачем virtual threads.
6. **NMT** — как использовать для поиска утечек native памяти.
7. **Container-aware sizing** — `MaxRAMPercentage`, почему `-Xmx == container_limit` — плохо.
8. **`-XX:+AlwaysPreTouch`** — что делает, когда полезно.

---

## Related

- GC, поколения, write barriers, references → [`GARBAGE_COLLECTION.md`](GARBAGE_COLLECTION.md)
- Code Cache детально, JIT pipeline → [`JIT_COMPILATION.md`](JIT_COMPILATION.md)
- Off-heap через FFM (modern replacement для Unsafe) → [`FOREIGN_MEMORY_VECTOR.md`](FOREIGN_MEMORY_VECTOR.md)
- ClassLoader leaks (главная причина Metaspace OOM) → [`CLASS_LOADERS.md`](CLASS_LOADERS.md)
- JVM в Docker/K8s (cgroups, OOMKilled) → [`modules/infrastructure/theory/DOCKER.md`](../../infrastructure/theory/DOCKER.md)
- Virtual threads (offload stack из native) → [`modules/concurrency/theory/VIRTUAL_THREADS.md`](../../concurrency/theory/VIRTUAL_THREADS.md)
- Prometheus JVM metrics → [`modules/infrastructure/theory/METRICS.md`](../../infrastructure/theory/METRICS.md)

### Внешние ресурсы

- **OpenJDK NMT docs**: <https://docs.oracle.com/en/java/javase/21/troubleshoot/diagnostic-tools.html#GUID-EF0BD8E8-5DAA-4290-9F3E-D89D3527BCE0>
- **Shipilëv's Anatomy Quarks** — особенно [#12 NMT](https://shipilev.net/jvm/anatomy-quarks/12-native-memory-tracking/) и [#16 MAT](https://shipilev.net/jvm/anatomy-quarks/16-mat/)
- **Inside Java**: <https://inside.java/tag/memory/>
- **JEP 122** (Remove PermGen): <https://openjdk.org/jeps/122>
- **JEP 197** (Segmented Code Cache): <https://openjdk.org/jeps/197>
