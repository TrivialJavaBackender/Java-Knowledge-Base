# Apache Cassandra — Interview Prep

Модуль по Apache Cassandra для backend-разработчика на Java/Kotlin: от мотивации
(зачем отказываться от джоинов и транзакций) до внутреннего устройства (путь записи и чтения,
compaction, настраиваемая согласованность, топология кольца) и прикладной работы через
java-driver.

> Акцент — на объяснении механизма, а не на перечислении CQL-синтаксиса. Справочник по CQL
> полнее в официальной документации; здесь разбирается, **почему** запрос без ключа партиции
> требует `ALLOW FILTERING` и почему это плохой ответ на собеседовании.

## Сквозной пример

Через все файлы теории проходит одна задача — **история заказов маркетплейса**:

- 50 млн пользователей, пик 20 тыс. записей в секунду;
- три запроса: «последние 20 заказов пользователя», «заказ по идентификатору»,
  «заказы продавца за период»;
- два дата-центра, чтение обязано пережить потерю одного.

На ней сравниваются подходы: как ложится модель данных, где ломается наивная схема, что даёт
`LOCAL_QUORUM`, почему у крупного продавца партиция становится горячей.

## Структура

```
├── ROADMAP.md                      # 9 тем в порядке прохождения + чеклисты
├── INTERVIEW_QUESTIONS.md          # вопросы с ответами для собеседования
├── _SUMMARY.md                     # семантическое сжатие модуля
│
├── theory/
│   ├── WHY_CASSANDRA.md            # зачем wide-column, наследие Dynamo, чем платим
│   ├── DATA_MODEL.md               # ключ партиции и кластеризации, wide row, коллекции
│   ├── QUERY_FIRST_DESIGN.md       # таблица на запрос, денормализация, 2i/SAI, MV
│   ├── WRITE_READ_PATH.md          # commitlog → memtable → SSTable; путь чтения; tombstone
│   ├── COMPACTION.md               # STCS/LCS/TWCS/UCS, амплификация, gc_grace_seconds
│   ├── CONSISTENCY_TUNING.md       # уровни согласованности, hinted handoff, repair, LWT
│   ├── CLUSTER_TOPOLOGY.md         # токены и vnodes, NetworkTopologyStrategy, DC/rack
│   ├── DRIVER_AND_APP.md           # подготовленные запросы, постраничность, повторы
│   └── OPERATIONS_PITFALLS.md      # большая партиция, tombstone hell, батчи, диагностика
│
└── exercises/                      # задания на CQL — схемы и запросы
```

## Как работать

Модуль без сборки: теория читается как есть, упражнения выполняются на живом кластере
в контейнере.

```bash
# поднять одноузловой кластер (первый старт ~40–60 с)
docker run -d --name cass -p 9042:9042 -e MAX_HEAP_SIZE=1G -e HEAP_NEWSIZE=256M cassandra:5.0

# дождаться готовности
docker exec cass cqlsh -e "SELECT release_version FROM system.local;"

# интерактивная оболочка
docker exec -it cass cqlsh

# выполнить файл упражнения
docker exec -i cass cqlsh < exercises/ex01_order_history/schema.cql
```

Инструменты, которыми проверяются утверждения теории (и решения упражнений):

```bash
docker exec cass nodetool status                  # состояние узлов и владение токенами
docker exec cass nodetool tablestats ks.table     # размер партиции, tombstone на чтение
docker exec cass nodetool compactionstats         # что уплотняется прямо сейчас
docker exec -it cass cqlsh -e "TRACING ON; SELECT ...;"   # что реально делал координатор
```

Остановить и удалить: `docker rm -f cass`.

## Фокус code review для упражнений

Упражнение здесь — это **схема плюс запросы**, а не программа. Проверяется:

- **Ключ партиции.** Обеспечивает ли он равномерное распределение и ограниченный размер
  партиции; нет ли неограниченного роста (партиция «на продавца» без бакета по времени).
- **Ключ кластеризации.** Даёт ли он нужный порядок без сортировки на клиенте; совпадает ли
  `CLUSTERING ORDER BY` с направлением чтения.
- **Соответствие запросам.** Каждый запрос из условия обязан обслуживаться ключом, а не
  `ALLOW FILTERING` и не вторичным индексом «на всякий случай».
- **Денормализация.** Согласованы ли таблицы-проекции между собой; что происходит при
  частичном сбое записи в одну из них.
- **Удаления и TTL.** Сколько tombstone порождает решение и переживут ли они `gc_grace_seconds`.
- **Уровень согласованности.** Обоснован ли выбор `ONE` / `QUORUM` / `LOCAL_QUORUM` условием
  задачи, а не взят по умолчанию.

## Что вынесено в другие модули

Общие механизмы не дублируются — раскрываются владельцем (правило NO OVERLAP,
см. `knowledge/GLOBAL_INDEX.md`):

| Тема | Владелец |
|------|----------|
| LSM-дерево против B-дерева, WAL | [databases/STORAGE_ENGINES.md](../databases/theory/STORAGE_ENGINES.md) |
| Репликация без ведущего, CDC | [databases/REPLICATION.md](../databases/theory/REPLICATION.md) |
| Consistent hashing | [caching-deep-dive/DISTRIBUTED_CACHING.md](../caching-deep-dive/theory/DISTRIBUTED_CACHING.md) |
| CAP, PACELC, кворум `R + W > N` | [system-design/distributed_systems.md](../system-design/theory/distributed_systems.md) |
| Gossip, Merkle tree, Bloom filter, Paxos | [system-design/](../system-design/theory/) |
