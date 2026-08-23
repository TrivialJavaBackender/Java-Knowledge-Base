# Java Concurrency — Interview Prep

Подготовка к техническим собеседованиям по Java Concurrency и `java.util.concurrent`.

Теория написана не как справочник API, а как объяснение: каждый файл начинается с задачи, показывает,
где ломается наивное решение, и только потом вводит механизм — со ссылкой на исходники JDK 21 или
на воспроизводимый замер.

## Структура

```
├── ROADMAP.md                  # 12 модулей с чеклистами
├── INTERVIEW_QUESTIONS.md      # 82 вопроса с ответами и источниками
│
├── theory/
│   ├── WHY_CONCURRENCY.md          # зачем конкурентность, закон Литтла, цена потока
│   ├── THREADS_BASICS.md           # поток, прерывание как протокол, synchronized, wait/notify, ThreadLocal
│   ├── MEMORY_MODEL.md             # видимость, happens-before, публикация, гонки
│   ├── JUC_INTERNALS.md            # AQS, park/unpark — как устроен весь пакет сразу
│   ├── LOCKS.md                    # ReentrantLock, Condition, ReadWriteLock, StampedLock
│   ├── ATOMIC_CAS.md               # CAS и его цена, LongAdder, VarHandle, lock-free
│   ├── CONCURRENT_COLLECTIONS.md   # ConcurrentHashMap, BlockingQueue, COW, SkipList
│   ├── SYNCHRONIZERS.md            # CountDownLatch, CyclicBarrier, Semaphore, Phaser
│   ├── EXECUTORS_FUTURES.md        # пулы, очереди, политики отказа, ForkJoinPool
│   ├── ASYNC_COMPOSITION.md        # CompletableFuture изнутри
│   ├── PROBLEMS.md                 # deadlock, livelock, голодание + диагностика
│   └── VIRTUAL_THREADS.md          # Loom, pinning, миграция
│
├── src/main/kotlin/exercises/      # Ex01–Ex18 — упражнения с TODO
└── src/main/java/applied/          # прикладные задачи с тестами
```

## Темы

| Тема | Теория | Упражнения |
|------|--------|-----------|
| Зачем и чем платим | [WHY_CONCURRENCY](theory/WHY_CONCURRENCY.md) | — |
| Потоки, `synchronized`, `wait/notify` | [THREADS_BASICS](theory/THREADS_BASICS.md) | 01, 02 |
| Модель памяти | [MEMORY_MODEL](theory/MEMORY_MODEL.md) | — |
| Внутренности j.u.c. | [JUC_INTERNALS](theory/JUC_INTERNALS.md) | — |
| Локи | [LOCKS](theory/LOCKS.md) | 03, 04 |
| Atomic и CAS | [ATOMIC_CAS](theory/ATOMIC_CAS.md) | 05 |
| Коллекции | [CONCURRENT_COLLECTIONS](theory/CONCURRENT_COLLECTIONS.md) | 06, 07, 13, 14, 15 |
| Синхронизаторы | [SYNCHRONIZERS](theory/SYNCHRONIZERS.md) | 10 |
| Пулы потоков | [EXECUTORS_FUTURES](theory/EXECUTORS_FUTURES.md) | 09, 16, 18 |
| `CompletableFuture` | [ASYNC_COMPOSITION](theory/ASYNC_COMPOSITION.md) | 08, 17 |
| Проблемы и диагностика | [PROBLEMS](theory/PROBLEMS.md) | 11 |
| Виртуальные потоки | [VIRTUAL_THREADS](theory/VIRTUAL_THREADS.md) | 12 |

## Как работать

В каждом упражнении есть `TODO` с описанием задачи. Реализуй и запусти:

```bash
mvn compile
mvn exec:java -Dexec.mainClass="exercises.Ex01_ThreadBasicsKt"

# Прикладная часть (Java) — с тестами
mvn test -Dtest=BankServiceTest
```

Замеры из теории воспроизводятся одной командой без сборки — например:

```bash
java Hoist.java        # флаг остановки без volatile
java Reorder.java      # переупорядочивание: оба потока видят 0
java Pin.java          # pinning виртуальных потоков
```

Команды в CLAUDE.md:
- `"проверь Ex01"` — проверка реализации + запуск
- `"следующий"` / `"next"` — следующий модуль по ROADMAP
- `"квиз"` / `"quiz"` — 5 случайных вопросов из INTERVIEW_QUESTIONS.md

## Code review — на что смотреть

**Kotlin Ex01–Ex18:**
- гонки и потерянные обновления; составные операции, сделанные неатомарно (`check-then-act`);
- видимость: отсутствие `volatile` или happens-before там, где данные передаются между потоками;
- локи: `unlock()` не в `finally`, лок на публичном объекте, ввод-вывод под локом, порядок захвата;
- ожидание: `wait`/`await` вне цикла, `notify()` там, где нужен `notifyAll()`;
- отмена: проглоченный `InterruptedException`, отсутствие проверки флага в вычислительном цикле;
- пулы: неограниченная очередь, забытый `shutdown()`, `submit()` без чтения `Future`,
  периодическая задача без `try/catch`;
- `ThreadLocal` без `remove()` в пуле;
- `CompletableFuture`: `*Async` без явного executor, `join()` внутри стадии, `exceptionally`
  не в том месте цепочки.

**Applied (Java, `src/main/java/applied/…`):** тесты `mvn test -Dtest=ClassName`; смотри
потокобезопасность, стратегию блокировок, поведение под конкуренцией.

## Стек

- Kotlin 2.2 / JDK 21 (Temurin 21.0.9)
- Maven 3.9, JUnit 5

Замеры в теории сняты на Apple M4 (10 ядер), Temurin 21.0.9. Это не JMH — порядок величин;
у вас цифры будут другими, выводы те же.

## Источники

- *Java Concurrency in Practice* — Brian Goetz et al.
- JLS §17 (Threads and Locks), JSR-133 FAQ
- Исходники JDK 21 (`$JAVA_HOME/lib/src.zip`) — на них ссылается теория с номерами строк
- JEP 444 (Virtual Threads), JEP 491 (Synchronize Virtual Threads without Pinning)
