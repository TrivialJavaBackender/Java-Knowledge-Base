# Foreign Function & Memory API, Vector API

---

## 1. Откуда взялся Project Panama

Java исторически плохо взаимодействовала с native-кодом. Был **JNI** (Java Native Interface, 1996) — но в нём столько ручной работы, что использовать без C++-обёрток было невозможно:

```c
JNIEXPORT jlong JNICALL
Java_com_example_Native_strlen(JNIEnv *env, jclass cls, jstring str) {
    const char *cstr = (*env)->GetStringUTFChars(env, str, NULL);
    jlong result = strlen(cstr);
    (*env)->ReleaseStringUTFChars(env, str, cstr);
    return result;
}
```

Каждая JNI-функция — это:
- Manual conversion Java↔C типов;
- Manual reference management (`GetStringUTFChars` / `ReleaseStringUTFChars`);
- Risk forgetting Release → memory leak;
- Risk wrong types → JVM crash (segfault).

Параллельно для off-heap allocation использовался **`sun.misc.Unsafe`**:
```java
long addr = unsafe.allocateMemory(1024);
unsafe.putLong(addr, 0, 42L);
// ...
unsafe.freeMemory(addr);
```

`Unsafe` — undocumented, type-unsafe, лёгкие segfault. Использовался Netty, Cassandra, Aeron — серьёзная инфраструктура. Это создало **дефакто** public API, который Oracle не мог переделать.

**Project Panama** (2014–) — серия JEPs, призванная заменить и JNI, и Unsafe:
- **FFM API** (Foreign Function & Memory) — [JEP 454](https://openjdk.org/jeps/454), stable Java 22;
- **Vector API** — JEP series 338/414/417/417/426/438/448/460, incubator;
- (in development) AOT support, Memory Layouts for SIMD.

> Maurizio Cimadamore (Panama lead), [*Foreign Function & Memory API*](https://inside.java/2022/05/06/sip055/) — официальный обзор. Project page: <https://openjdk.org/projects/panama/>.

---

## 2. FFM API: основные типы

```java
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;

// 1. Allocate native memory
try (Arena arena = Arena.ofConfined()) {
    MemorySegment buf = arena.allocate(1024);       // 1 KB off-heap
    buf.set(ValueLayout.JAVA_INT, 0, 42);            // write int at offset 0
    int v = buf.get(ValueLayout.JAVA_INT, 0);        // read back
}  // arena closes → memory freed automatically
```

Ключевые типы:

- **`Arena`** — lifetime scope для allocations. Закрытие arena освобождает всё, что в ней.
- **`MemorySegment`** — typed view над диапазоном памяти (off-heap или onto byte[]/heap).
- **`ValueLayout`** — `JAVA_INT`, `JAVA_LONG`, `ADDRESS`, `JAVA_FLOAT`, `JAVA_DOUBLE`, `JAVA_BYTE`, `JAVA_CHAR`, `JAVA_BOOLEAN`, `JAVA_SHORT` с native endianness/alignment.
- **`MemoryLayout`** — composite описание layout'а (struct, array of struct).
- **`Linker`** — для downcall и upcall в native libraries.

---

## 3. Arena types

| Type | Confinement | Thread-safe close | Use case |
|---|---|---|---|
| `Arena.ofConfined()` | single-thread (creator) | no | local struct, fast-path |
| `Arena.ofShared()` | any thread | yes (synced close) | shared off-heap data |
| `Arena.ofAuto()` | auto-close on GC | yes | сложные lifetime, fallback |
| `Arena.global()` | never closes | n/a | static buffers |

### 3.1. `ofConfined` — самый быстрый и безопасный

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment seg = arena.allocate(100);
    // только current thread может работать с seg
}
```

Если другой thread пытается обратиться → `WrongThreadException`. Это **enforced** check, не just convention. Используй когда возможно.

### 3.2. `ofShared` — для multi-thread

```java
try (Arena arena = Arena.ofShared()) {
    MemorySegment seg = arena.allocate(100);
    // любой thread может читать/писать
}
```

Чуть медленнее (требует synchronization на close, чтобы не закрыть пока другие читают).

### 3.3. `ofAuto` — GC-managed lifetime

```java
MemorySegment seg = Arena.ofAuto().allocate(100);
// освободится когда seg станет phantom-reachable (через Cleaner)
```

Эквивалент `ByteBuffer.allocateDirect`. Для случаев когда lifetime сложно определить вручную.

### 3.4. `global` — для constant buffers

```java
MemorySegment greeting = Arena.global().allocateUtf8String("hello");
// никогда не освобождается, живёт всю JVM
```

Для static lookup tables, constants. Использовать sparingly — global memory leak by definition.

### 3.5. Проверка lifecycle

```java
seg.scope().isAlive();   // true если arena open
seg.scope().isAccessibleFromThread(Thread.currentThread());   // confinement check
```

После `arena.close()` — любое обращение к `seg` → `IllegalStateException`. Не сохраняй long-lived ссылки на segments из closed arenas.

---

## 4. MemoryLayout: structured memory

Для сложных структур (C `struct`):

```java
MemoryLayout point = MemoryLayout.structLayout(
    ValueLayout.JAVA_INT.withName("x"),
    ValueLayout.JAVA_INT.withName("y"),
    MemoryLayout.paddingLayout(8)             // 8 bytes padding (для alignment)
).withName("Point");

VarHandle xH = point.varHandle(MemoryLayout.PathElement.groupElement("x"));
VarHandle yH = point.varHandle(MemoryLayout.PathElement.groupElement("y"));

try (Arena a = Arena.ofConfined()) {
    MemorySegment p = a.allocate(point);
    xH.set(p, 0L, 5);    // write Point.x
    yH.set(p, 0L, 10);   // write Point.y
}
```

VarHandle (см. [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md)) используется и здесь — atomic-доступ к полям off-heap structure.

### 4.1. Array of struct

```java
MemoryLayout pointArray = MemoryLayout.sequenceLayout(100, point);
try (Arena a = Arena.ofConfined()) {
    MemorySegment arr = a.allocate(pointArray);
    
    VarHandle arrX = pointArray.varHandle(
        MemoryLayout.PathElement.sequenceElement(),
        MemoryLayout.PathElement.groupElement("x")
    );
    arrX.set(arr, 0L, 5L, 42);   // arr[5].x = 42
}
```

PathElement — way to navigate в layout: `sequenceElement(index)`, `groupElement(name)`, `dereferenceElement()`.

---

## 5. Foreign Linker: вызов native functions

Замена JNI:

```java
import static java.lang.foreign.ValueLayout.*;

Linker linker = Linker.nativeLinker();
SymbolLookup lookup = linker.defaultLookup();

// Find native function
MemorySegment strlenAddr = lookup.find("strlen").orElseThrow();

// Create MethodHandle wrapper
MethodHandle strlen = linker.downcallHandle(
    strlenAddr,
    FunctionDescriptor.of(JAVA_LONG, ADDRESS)
);

// Call it
try (Arena a = Arena.ofConfined()) {
    MemorySegment cstr = a.allocateUtf8String("Hello");
    long len = (long) strlen.invokeExact(cstr);   // 5
}
```

Не нужны `javah`, C-обёртки, `System.loadLibrary` (хотя для custom libs всё ещё может быть нужен).

### 5.1. Upcalls (callback из C в Java)

```java
// Java callback method
class Callback {
    public static int compare(MemorySegment a, MemorySegment b) {
        return Integer.compare(a.get(JAVA_INT, 0), b.get(JAVA_INT, 0));
    }
}

MethodHandle target = MethodHandles.lookup().findStatic(
    Callback.class, "compare",
    MethodType.methodType(int.class, MemorySegment.class, MemorySegment.class)
);

FunctionDescriptor fd = FunctionDescriptor.of(JAVA_INT, ADDRESS, ADDRESS);

try (Arena arena = Arena.ofConfined()) {
    MemorySegment cmpFn = linker.upcallStub(target, fd, arena);
    // Передавать cmpFn в C qsort как callback
}
```

Upcall stub живёт пока живёт arena.

### 5.2. Tools и code generation

`jextract` — JDK tool для генерации **готовых bindings** из C header file:
```bash
jextract -t com.example.bindings -- /usr/include/stdio.h
```

Создаёт Java-классы с pre-built MethodHandle для каждой функции, MemoryLayout для каждого struct. Огромная экономия времени для bindings к libraries.

> Inside Java, [*Foreign Function and Memory API*](https://inside.java/tag/foreign/).

---

## 6. Off-heap patterns

```java
// Большой буфер, GC-managed
MemorySegment buf = Arena.ofAuto().allocate(100 * 1024 * 1024);   // 100 MB

// Memory-mapped file (zero-copy)
try (FileChannel ch = FileChannel.open(path, READ);
     Arena arena = Arena.ofShared()) {
    MemorySegment file = ch.map(MapMode.READ_ONLY, 0, ch.size(), arena);
    // file shared между потоками, освободится при arena.close()
}
```

Заменяет:
- `ByteBuffer.allocateDirect` (без размера limit `-XX:MaxDirectMemorySize`);
- `FileChannel.map` для mmap;
- `Unsafe.allocateMemory` / `Unsafe.putLong`.

### 6.1. Сравнение с ByteBuffer

| | ByteBuffer (legacy) | MemorySegment |
|---|---|---|
| Max size | 2 GB (int offset) | 8 EiB (long offset) |
| Lifetime | через Cleaner | через Arena |
| Atomic ops | через VarHandle (Java 9+) | native через VarHandle |
| Type safety | ByteBuffer-typed | ValueLayout strict |
| Performance | OK | равна или лучше (no defensive checks) |

Новый код пиши на FFM. Старый — оставь на ByteBuffer для compatibility.

---

## 7. Vector API (incubator)

`jdk.incubator.vector` — SIMD operations с pure Java. Использует CPU vector instructions (AVX2, AVX-512, NEON) когда доступно; fallback на scalar loop если нет.

### 7.1. Basic example

```java
import jdk.incubator.vector.*;

static final VectorSpecies<Integer> SPECIES = IntVector.SPECIES_PREFERRED;

void addArrays(int[] a, int[] b, int[] out) {
    int i = 0;
    int upper = SPECIES.loopBound(a.length);   // round-down to multiple of SPECIES.length()
    
    for (; i < upper; i += SPECIES.length()) {
        IntVector va = IntVector.fromArray(SPECIES, a, i);
        IntVector vb = IntVector.fromArray(SPECIES, b, i);
        va.add(vb).intoArray(out, i);
    }
    
    // Scalar tail для остатка
    for (; i < a.length; i++) out[i] = a[i] + b[i];
}
```

- **`SPECIES_PREFERRED`** — выбирает максимальный размер для CPU (512 бит на AVX-512, 256 на AVX2, 128 на NEON);
- **`loopBound`** — round-down до кратного size;
- Tail обрабатывается scalar loop.

### 7.2. Masked operations

```java
IntVector vec = IntVector.fromArray(SPECIES, arr, i);
VectorMask<Integer> mask = vec.lt(threshold);   // элементы < threshold
IntVector other = IntVector.fromArray(SPECIES, otherArr, i);
vec.add(other, mask);   // add только там, где mask=true
```

Полезно для conditional updates без branch'ей.

### 7.3. Lanes operations

```java
IntVector v = IntVector.fromArray(SPECIES, arr, i);
int sum = v.reduceLanes(VectorOperators.ADD);   // horizontal sum
int max = v.reduceLanes(VectorOperators.MAX);
int dotProd = v.mul(other).reduceLanes(VectorOperators.ADD);   // dot product
```

### 7.4. Use cases

- **Numerical computing**: вектор-векторные операции для линейной алгебры;
- **Image processing**: pixel transformations;
- **Vector databases**: cosine similarity, dot product для embeddings;
- **Cryptography**: AES, ChaCha20 (JDK internal использует Vector API);
- **JSON parsing fast path**: ahed для symbol search (Simdjson-style);
- **String operations**: indexOf, substring search.

Skylake-X AVX-512 даёт 4–8× speedup на правильных workloads. ARM NEON — 2–4×.

### 7.5. Pitfalls

- **Species mismatch**: смешивать `IntVector` и `FloatVector` нельзя; viewing — `reinterpretAsFloats`.
- **JIT dependencies**: Vector API сильно зависит от C2/Graal intrinsics. На interpreter — **очень** медленно. JIT обычно справляется; проверить `-XX:+UnlockDiagnosticVMOptions -XX:+PrintIntrinsics`.
- **Confinement violations**: `ofConfined` arena, доступ из другого потока → `WrongThreadException`. Чётко проектировать ownership.
- **Native lifecycle**: `MemorySegment` после закрытия arena → `IllegalStateException`. Не сохранять long-lived ссылки.
- **Alignment**: `ValueLayout.JAVA_DOUBLE` требует 8-byte alignment. `MemorySegment.allocate(layout)` аллоцирует с правильным alignment. Ручная аллокация — следить за `byteAlignment`.
- **Endianness**: default — native (little на x86, big на legacy SPARC/ppc). `withOrder(ByteOrder.LITTLE_ENDIAN)` явно.

> [Vector API Cookbook](https://openjdk.org/jeps/438). [Project Panama Vector intrinsics](https://wiki.openjdk.org/display/HotSpot/Vector+API).

---

## 8. Что заменяет — таблица

| Старая технология | FFM / Vector |
|---|---|
| JNI | `Linker.downcallHandle` |
| `Unsafe.allocateMemory` / `freeMemory` | `Arena.allocate` |
| `ByteBuffer.allocateDirect` | `MemorySegment` |
| `Unsafe.putLong(addr, val)` | `MemorySegment.set(JAVA_LONG, offset, val)` |
| Hand-coded SIMD via JNI | `IntVector` / `FloatVector` |
| `FileChannel.map(ByteBuffer)` | `FileChannel.map(MapMode, offset, size, arena)` |
| AtomicIntegerFieldUpdater | `VarHandle` over MemorySegment |

---

## 9. Когда оно нужно

Большинство приложений **не использует** FFM/Vector напрямую — это инфраструктурные API для:

- **High-performance libraries**: Netty, Aeron, Lucene, Apache Arrow, JDBC drivers;
- **Vector databases**: Lucene KNN, Vespa, Milvus-Java;
- **ML inference**: deep learning через native (DeepJavaLibrary);
- **WebAssembly hosts** (GraalWasm, Chicory);
- **Native crypto**: BoringSSL bindings, Hardware AES intrinsics;
- **Database engines on JVM**: H2, HSQLDB native components;
- **Game engines**: LWJGL (OpenGL bindings).

В типичном backend / web сервисе их не трогаешь, но **полезно знать про существование** — на senior собесе обязательно спросят про замену Unsafe и JNI.

---

## 10. Что обязательно знать на собесе

1. **Зачем Project Panama** — проблемы JNI и Unsafe.
2. **FFM API basics**: Arena, MemorySegment, ValueLayout, Linker.
3. **4 Arena типа**: confined / shared / auto / global — когда что.
4. **`WrongThreadException`** — confinement enforcement.
5. **`Linker.downcallHandle`** — как заменяет JNI.
6. **`MemoryLayout` + `VarHandle`** — typed struct access.
7. **Vector API basics**: SPECIES_PREFERRED, loopBound, masked ops.
8. **`jextract`** — code generation для bindings.
9. **Use cases** — где реально нужно (HTTP libs, ML, crypto, не каждое app).
10. **Что заменяет** Unsafe / JNI / ByteBuffer.

---

## Related

- Direct ByteBuffer, off-heap → [`JVM_MEMORY_AREAS.md`](JVM_MEMORY_AREAS.md)
- VarHandle access modes → [`REFLECTION_HANDLES.md`](REFLECTION_HANDLES.md)
- GraalVM Native Image → [`JIT_COMPILATION.md`](JIT_COMPILATION.md)
- JPMS и доступ к JDK internal → [`JPMS_MODULES.md`](JPMS_MODULES.md)

### Внешние ресурсы

- **Project Panama**: <https://openjdk.org/projects/panama/>
- **JEP 454 (FFM API)**: <https://openjdk.org/jeps/454>
- **JEP 471 (Deprecate Unsafe memory access)**: <https://openjdk.org/jeps/471>
- **Maurizio Cimadamore, *Panama lead* talks** — JVM Language Summit recordings
- **Inside Java — Foreign Function**: <https://inside.java/tag/foreign/>
- **Vector API documentation**: <https://docs.oracle.com/en/java/javase/21/docs/api/jdk.incubator.vector/jdk/incubator/vector/package-summary.html>
- **jextract**: <https://github.com/openjdk/jextract>
- **Aleksey Shipilëv, *Inside JVM I/O***: <https://shipilev.net/> — общая performance perspective
