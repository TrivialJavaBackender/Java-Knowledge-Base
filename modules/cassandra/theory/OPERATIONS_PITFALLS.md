# Эксплуатационные ловушки: как это выглядит, когда уже сломалось

> **Какую проблему решает.** p99 на истории заказов выросла в десять раз. Узлы живы, нагрузка не
> изменилась, в схеме ничего не меняли. Причин у такой картины немного — большая партиция, горячая
> партиция, накопленные tombstone, неудачные batch, — и все они выглядят снаружи одинаково. Здесь
> показано, чем они отличаются в выводе команд и в каком порядке эти команды запускать.
> **Кому это надо.** Дежурному, которому надо назвать причину за пятнадцать минут; и тому, кого на
> собеседовании спросят не «что такое tombstone», а «как вы это обнаружите».
> **Когда НЕ надо.** Это не инструкция по настройке кластера и не способ спасти плохую схему:
> большинство описанного здесь лечится моделированием
> ([`QUERY_FIRST_DESIGN.md`](QUERY_FIRST_DESIGN.md) §1, §3), а операции лишь показывают счёт.

**Что здесь и чего здесь нет.** Здесь — обнаружение и диагностика. Механизм tombstone (почему
удаление это запись) — [`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §4; почему они не исчезают сами
(`gc_grace_seconds`, перекрытие SSTable) — [`COMPACTION.md`](COMPACTION.md) §4–5; где предел размера
партиции и откуда он берётся — [`DATA_MODEL.md`](DATA_MODEL.md) §4. Горячий ключ как явление и его
лечение (key splitting, sticky sharding, request coalescing) — [`../../databases/theory/SHARDING.md`](../../databases/theory/SHARDING.md) §5;
здесь только то, как перекос выглядит именно в Cassandra. Очередь и DLQ как паттерн —
[`../../system-design/theory/RELIABILITY_PATTERNS.md`](../../system-design/theory/RELIABILITY_PATTERNS.md),
подходящий для очереди инструмент — [`../../system-design/theory/kafka.md`](../../system-design/theory/kafka.md);
здесь только то, почему на этой роли ломается Cassandra. Механика LSM и стратегий уплотнения —
[`../../databases/theory/STORAGE_ENGINES.md`](../../databases/theory/STORAGE_ENGINES.md).

Прогоны выполнены на одноузловом Apache Cassandra 5.0.9 (контейнер `cass-theory`), Apple M4 /
Darwin 25.6.0. Это не бенчмарк: важны соотношения и текст сообщений, а не абсолютные задержки.
Выводы в блоках — реальные.

## 1. Большая партиция: guardrail есть, но выключен

**Задача.** Схему писали год назад, продавцов стало больше, партиции у некоторых из них выросли.
Надо узнать об этом раньше, чем узнают пользователи.

**Наивное решение.** В 5.0 есть guardrail `partition_size_warn_threshold` — значит, сервер сам
предупредит.

**Где ломается.** Не предупредит: в поставке порог не задан.

```
$ nodetool getguardrailsconfig | grep partition
partition_size_threshold                     [null, null]
partition_tombstones_threshold               [-1, -1]
```

**Механизм.** Три ограничения зафиксированы прямо в комментарии
[`cassandra.yaml`](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html),
и каждое важно: «The guardrail is only checked when writing sstables (flush and compaction)»,
«exceeding the fail threshold on that moment will only log an error message, without interrupting the
operation», «This operates on a per-sstable basis, so it won't detect a large partition if it is
spread across multiple sstables». То есть это не защита, а отложенное сообщение в лог — и только про
ту часть партиции, что попала в один файл.

Порог включается на живом узле, без перезапуска (`setguardrailsconfig`, аргументы идут в порядке
«fail, warn»), и тогда при уплотнении в `system.log` появляется запись — а уплотнение спокойно
завершается следом:

```
$ nodetool setguardrailsconfig partition_size_threshold 2MiB 1MiB
$ nodetool compact qfd_demo seller_nobucket

INFO  GuardrailsOptions.java:1083 - Updated partition_size_warn_threshold from null to 1MiB
ERROR NoSpamLogger.java:110 - Guardrail partition_size violated: Partition
  qfd_demo.seller_nobucket:00000000-…-0007 on sstable …/nb-3-big-Data.db has size 7996951,
  this exceeds the failure threshold of 2097152. Too large partitions can cause performance problems.
INFO  CompactionTask.java:274 - Compacted (…) 1 sstables to […] 2.742MiB to 2.742MiB in 152ms.
```

Пока порог не включён, партицию ищут сами — в
[`nodetool tablestats`](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/tablestats.html)
по полю `Compacted partition maximum bytes` и в `tablehistograms` по колонке `Partition Size`. Одна
оговорка: обе величины — границы бакетов гистограммы с шагом 1,2, а не точные числа. Это видно по
самому ряду значений в выводах: `925 → 1109 → 1331`, `42511 → 51012`; отношение соседних ровно 1,2,
и у двух разных таблиц максимум партиции печатается одинаковым числом 51012.

**Правило.** По умолчанию о большой партиции не сообщает никто — включите guardrail сами и не
считайте его страховкой: он пишет в лог после факта и не видит партицию, размазанную по нескольким
SSTable.

## 2. Горячая партиция: где именно это видно

**Задача.** Один продавец даёт 80% чтений истории заказов. Его партиция помещается в память, размер
её нормальный — но узлы, хранящие её реплики, загружены заметно сильнее остальных.

**Наивное решение.** Посмотреть `tablestats` и `tablehistograms`: они же показывают задержку по
таблице.

**Где ломается.** Ничего не покажут. Перекос — свойство распределения запросов по ключам, а обе
команды агрегируют по таблице целиком: в них горячая партиция растворяется среди тысяч холодных.
Размер партиции при этом нормальный, число SSTable нормальное, `Droppable tombstone ratio` ноль.
Проблема есть, а в метриках таблицы её нет.

**Механизм.** Что перекос делает с системой и чем лечится (key splitting, sticky sharding)
— общая тема шардирования, [`../../databases/theory/SHARDING.md`](../../databases/theory/SHARDING.md) §5.
Cassandra-специфична здесь ровно одна вещь — точка обнаружения. `nodetool toppartitions` сэмплирует
живой трафик за указанное окно и печатает ключи партиций, а не агрегат по таблице:

```
$ nodetool toppartitions qfd_demo orders_by_user 6000

Frequency of reads by partition:
   Table                   Partition                            Count +/-
   qfd_demo.orders_by_user 00000000-0000-0000-0000-0000000003e9 2205  0
   qfd_demo.orders_by_user 00000000-0000-0000-0000-000000000465 8     0
   qfd_demo.orders_by_user 00000000-0000-0000-0000-000000000427 7     0
   …
Frequency of writes by partition:
   Nothing recorded during sampling period...
```

Нагрузка была именно такой: 4000 запросов, 80% из них по одному `user_id`. В выводе перекос виден
как есть — 2205 против 7–8 у соседей, и отдельно сказано, что запись в окне не наблюдалась, то есть
проблема односторонняя. Ниже команда печатает ещё и самые долгие запросы окна с их текстом, так что
ключ и запрос находятся за один прогон.

**Правило.** Горячую партицию ищут не метриками таблицы, а сэмплированием по ключам: `toppartitions`
с окном в несколько секунд — первая команда, если задержка выросла, а размер партиции и число
SSTable в норме.

## 3. Пороги tombstone: порог чтения — не порог записи

**Задача.** В таблице много удалений. Хочется узнать о проблеме до того, как запрос перестанет
работать.

**Наивное решение.** `tombstone_warn_threshold: 1000` задан в поставке — сервер предупредит, когда
маркеров накопится тысяча.

**Где ломается.** Формулировка «накопится» неверна: порог считает маркеры, просканированные **одним
запросом**, и срабатывает у того, кто читает, а не у того, кто удалял. Два прогона на таблицах с
5000 и 150 000 просроченных ячеек в одной партиции:

```
$ cqlsh -e "SELECT * FROM ops_demo.tomb_warn WHERE p=1;"
(0 rows)
Warnings :
Read 0 live rows and 5000 tombstone cells for query SELECT * FROM ops_demo.tomb_warn WHERE p = 1
LIMIT 100 …; token -4069959284402364209 (see tombstone_warn_threshold)

$ cqlsh -e "SELECT * FROM ops_demo.tomb_fail WHERE p=1;"
ReadFailure: Error from server: code=1300 [Replica(s) failed to execute read] message="Operation
failed - received 0 responses and 1 failures: READ_TOO_MANY_TOMBSTONES from /172.17.0.2:7000"
```

В логе узла второму случаю соответствует `ERROR StorageProxy.java:2248 - Scanned over 100001
tombstones during query '…'; query aborted`. Заметьте, что сломался **запрос**, а не удаление:
удаления прошли успешно и молча.

**Механизм.** Порогов два, и у них похожие имена и разная природа.

| | `tombstone_warn_threshold` / `_failure_threshold` | `partition_tombstones_warn_threshold` / `_fail_threshold` |
|---|---|---|
| когда срабатывает | при чтении, на каждый запрос | при записи SSTable: flush и уплотнение |
| что считает | маркеры, просканированные запросом | маркеры в партиции внутри одного SSTable |
| в поставке 5.0.9 | `1000` / `100000`, включён | `-1` / `-1`, выключен |
| последствие | предупреждение клиенту / отказ запроса | строка в логе |

Первая пара живёт в
[`cassandra.yaml`](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
с объяснением, зачем она вообще нужна: «we need to keep the tombstones seen in memory so we can
return them to the coordinator… this can cause performance problems and even exaust the server heap».
Вторая — guardrail, и её состояние видно там же, где состояние §1: `partition_tombstones_threshold
[-1, -1]`.

**Чему порог не научит.** Он считает не все маркеры на диске, а только те, что участвуют в слиянии.
На таблице с `gc_grace_seconds = 0` после 2000 удалений чтение сообщает ноль:

```
$ cqlsh -e "TRACING ON; SELECT * FROM ops_demo.tomb_gc0 WHERE p=1;"
 Read 0 live rows and 0 tombstone cells                        531 мкс

$ sstablemetadata …/tomb_gc0-…/nb-1-big-Data.db
totalRows: 2000
```

Ни предупреждения клиенту, ни строки в логе — при 2000 маркеров в файле на 22 641 байт. Почему они
вообще лежат на диске после истечения срока — [`COMPACTION.md`](COMPACTION.md) §5.

**Правило.** Порог tombstone — датчик на читателе, а не на данных: тишина означает «никто пока не
прочитал столько маркеров за один запрос», а не «маркеров нет».

## 4. Cassandra как очередь: почему это классический провал

**Задача.** Нужна очередь задач. Cassandra уже есть, добавлять Kafka ради тысячи задач в час не
хочется.

**Наивное решение.** Таблица `(shard, seq)`, потребитель берёт голову `LIMIT 10`, обрабатывает и
удаляет обработанное.

**Где ломается.** Таблица из 3000 задач, первые 2000 обработаны и удалены. Потребитель приходит за
следующей десяткой:

```
$ cqlsh -e "SELECT seq FROM ops_demo.q2 WHERE shard=1 LIMIT 10;"
Warnings :
Read 10 live rows and 2000 tombstone cells for query SELECT * FROM ops_demo.q2 WHERE shard = 1
LIMIT 10 …; (see tombstone_warn_threshold)
```

Десять полезных строк стоили двух тысяч маркеров, и порог из §3 уже пройден. Через сто тысяч
обработанных задач эта партиция перестанет читаться вовсе — тем самым `READ_TOO_MANY_TOMBSTONES`.

**Механизм.** Очередь ставит удаление ровно туда, куда смотрит чтение. Голова партиции — единственное
место, куда ходит потребитель, и он же засевает это место маркерами; скорость их появления равна
скорости потребления, а убрать их раньше `gc_grace_seconds` уплотнение не имеет права
([`COMPACTION.md`](COMPACTION.md) §4). Случай известен разработчикам сервера: комментарий к
`tombstone_warn_threshold` в `cassandra.yaml` отсылает читателя к разбору «cassandra anti-patterns:
queues and queue-like datasets» — то есть порог и антипаттерн прямо связаны в самой конфигурации.

**Правило.** Очередь в Cassandra ломается не объёмом, а формой доступа: читать и удалять одну и ту
же голову партиции нельзя. Инструмент для этой задачи —
[`../../system-design/theory/kafka.md`](../../system-design/theory/kafka.md); паттерн повторной
обработки и DLQ — [`../../system-design/theory/RELIABILITY_PATTERNS.md`](../../system-design/theory/RELIABILITY_PATTERNS.md).

## 5. `LOGGED` против `UNLOGGED` batch

**Задача.** Заказ пишется в три таблицы ([`QUERY_FIRST_DESIGN.md`](QUERY_FIRST_DESIGN.md) §2). Три
обращения к серверу вместо одного — хочется сложить их в `BATCH`.

**Наивное решение.** Собрать в один `BATCH` побольше мутаций: документация прямо обещает, что batch
«saves network round-trips between the client and the server»
([CQL / Data Manipulation](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/dml.html)),
а раз так — чем больше, тем лучше.

**Где ломается.** Сервер возражает трижды, и каждое возражение приходит клиенту, а не только в лог:

```
A. UNLOGGED, 30 партиций по 1 байту:
   Warnings : Unlogged batch covering 30 partitions detected against table [ops_demo.orders_by_id].
   You should use a logged batch for atomicity, or asynchronous writes for performance.

B. UNLOGGED, 20 партиций по 400 байт:
   Warnings : Batch for [ops_demo.orders_by_id] is of size 10120, exceeding specified threshold
   of 5120 by 5000.

C. UNLOGGED, 200 партиций по 400 байт:
   InvalidRequest: code=2200 [Invalid query] message="Batch too large"
```

Пороги заданы в поставке: `unlogged_batch_across_partitions_warn_threshold: 10`,
`batch_size_warn_threshold: 5KiB`, `batch_size_fail_threshold: 50KiB`.

**Механизм.** `BATCH` в Cassandra решает не ту задачу, ради которой его берут. Что он действительно
даёт: «By default, all operations in the batch are performed as logged, to ensure all mutations
eventually complete (or none will)» — координатор сначала пишет batchlog на другие узлы и лишь потом
рассылает мутации. Это и есть цена `LOGGED`. Изоляции при этом нет: «operations are only isolated
within a single partition». `UNLOGGED` платы не несёт и гарантии тоже: «a failed batch might leave
the batch only partly applied».

Отсюда и объяснение порогов. Мутации в разные партиции идут на разные узлы, и единственный способ
выполнить их «одной посылкой» — сложить всю работу на одного координатора, который затем разошлёт её
сам. Клиентский драйвер сделал бы то же самое параллельно и с правильного узла
([`CLUSTER_TOPOLOGY.md`](CLUSTER_TOPOLOGY.md) §4). Поэтому большой межпартиционный batch — не
экономия обращений, а перенос веерного распределения с клиента на один узел.

Проверяется это прямо: тот же объём в **одной** партиции не вызывает ни предупреждения, ни отказа —
200 строк по 400 байт (около 80 000 байт, вдвое выше порога отказа) прошли молча. Пороги размера
применяются только к batch, охватывающим несколько партиций, а «a LOGGED batch to a single partition
will be converted to an UNLOGGED batch as an optimization» — batchlog в этом случае не пишется вовсе.

**Правило.** `BATCH` — про атомарность в пределах одной партиции, а не про экономию обращений: одна
партиция — берите, несколько — пишите параллельными запросами и считайте предупреждение о числе
партиций ошибкой в коде.

## 6. Один инцидент, три команды по порядку

**Задача.** Алерт: p99 чтения на одной таблице выросла в десять раз. Пятнадцать минут на то, чтобы
назвать причину.

**Наивное решение.** Включить `TRACING ON` и посмотреть медленный запрос.

**Где ломается.** Трассировка отвечает на «где ушло время в этом запросе», но не на «что с таблицей»:
она снимается с одного запроса, который ещё надо выбрать, и одинаково выглядит при разных причинах.
Начинать с неё — значит тратить самый точный инструмент до того, как известно, что искать.

**Механизм.** Порядок идёт от агрегата к частному, и каждый шаг отсекает класс причин.

*Шаг 1 — `nodetool tablestats <ks>.<таблица>`.* Здесь в одном экране видно соотношение полезной
работы и накладной. Контраст очевиден без порогов: слева таблица-очередь из §4, справа обычная.

```
ops_demo.q2              Local read latency: 0.706 ms
                         Average live cells per slice (last five minutes): 10.0
                         Average tombstones per slice (last five minutes): 2299.0
qfd_demo.orders_by_user  Local read latency: 0.065 ms
                         Average live cells per slice (last five minutes): 5.0
                         Average tombstones per slice (last five minutes): 1.0
```

*Шаг 2 — [`nodetool tablehistograms`](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/tablehistograms.html).*
Он отвечает на «на каком перцентиле», «чтение или запись» и «сколько SSTable трогает одно чтение» —
всё в одной таблице:

```
qfd_demo/orders_by_user histograms
Percentile      Read Latency     Write Latency          SSTables    Partition Size        Cell Count
                    (micros)          (micros)                             (bytes)
50%                    42.00              1.00              1.00             29521              1331
99%                   310.00              2.00              1.00             51012              2299
Min                    11.00              0.00              1.00                87                 3
```

Колонка `SSTables` здесь ровно 1: одно чтение обходится одним файлом. Значение в несколько единиц
означало бы, что уплотнение отстаёт, — и тогда следующая команда `nodetool compactionstats`, где
смотрят `pending tasks`.

*Шаг 3 — `TRACING ON` на конкретном запросе.* Теперь известно, что искать, и трассировка показывает
шаг пути чтения ([`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §2), на котором уходит время.

**Как отличить причины по выводу.**

| Что видно | Что это | Чем подтвердить |
|---|---|---|
| `Partition Size` высок на верхних перцентилях | большая партиция (§1) | `Compacted partition maximum bytes` |
| `tombstones per slice` много при малом `live cells` | tombstone (§3, §4) | предупреждение в ответе клиенту |
| `SSTables` на чтение больше единиц | уплотнение отстаёт | `compactionstats`, `pending tasks` |
| всё в норме, а задержка выросла | горячая партиция (§2) | `toppartitions` за несколько секунд |

**Правило.** Трассировка — последний шаг, а не первый: сначала агрегат по таблице, потом перцентили,
и только потом один запрос.

## 7. Шпаргалка

| Команда | Что показывает | Когда запускать |
|---|---|---|
| `nodetool tablestats <ks>.<t>` | живые ячейки против маркеров, число SSTable, максимум партиции | первой при росте задержки |
| `nodetool tablehistograms <ks>.<t>` | перцентили чтения и записи, SSTable на чтение, размер партиции | второй, чтобы понять «где» |
| `nodetool toppartitions <ks> <t> <мс>` | ключи партиций, получившие больше всего запросов в окне | когда метрики таблицы в норме |
| `nodetool compactionstats` | `pending tasks` — успевает ли уплотнение | если `SSTables` на чтение больше единиц |
| `nodetool getguardrailsconfig` | фактические значения guardrail на узле | при проверке «а порог вообще включён» |
| `TRACING ON` | шаги пути чтения для одного запроса | последней, когда ясно что искать |

**Значения в поставке 5.0.9**

| Параметр | Значение | Механизм |
|---|---|---|
| `tombstone_warn_threshold` | `1000` | чтение, предупреждение клиенту |
| `tombstone_failure_threshold` | `100000` | чтение, `READ_TOO_MANY_TOMBSTONES` |
| `partition_size_threshold` | `[null, null]` | запись SSTable, выключен |
| `partition_tombstones_threshold` | `[-1, -1]` | запись SSTable, выключен |
| `unlogged_batch_across_partitions_warn_threshold` | `10` | предупреждение клиенту |
| `batch_size_warn_threshold` / `_fail_threshold` | `5KiB` / `50KiB` | только межпартиционные batch |

### Формулировки для собеседования

- «Guardrail размера партиции в 5.0 есть, но выключен, срабатывает при уплотнении и только в
  пределах одного SSTable — это сообщение после факта, а не защита.»
- «Порог tombstone стоит на читателе: он считает маркеры, просканированные одним запросом, поэтому
  падает не тот, кто удалял.»
- «Горячую партицию не видно в метриках таблицы — её ищут `toppartitions` по ключам.»
- «`BATCH` — про атомарность внутри партиции; межпартиционный batch не экономит обращения, а
  сажает веерное распределение на один координатор.»
- «Трассировка последняя, не первая: сначала `tablestats`, потом `tablehistograms`.»

## Упражнения

- [`../exercises/ex06_diagnose/README.md`](../exercises/ex06_diagnose/README.md) — найти причину
  медленного чтения по выводу команд, не заглядывая в схему (§1, §2, §6).
- [`../exercises/ex03_tombstones/README.md`](../exercises/ex03_tombstones/README.md) — довести
  партицию до порога предупреждения и до отказа чтения (§3, §4).
- [`../exercises/ex02_partition_sizing/README.md`](../exercises/ex02_partition_sizing/README.md) —
  посчитать, когда партиция дорастёт до порога, и включить guardrail под этот расчёт (§1).

## Источники

- Apache Cassandra 5.0 Documentation, [Configuring cassandra.yaml](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
  — пороги tombstone и batch, guardrail размера партиции и их значения по умолчанию.
- Apache Cassandra 5.0 Documentation, [CQL / Data Manipulation](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/dml.html)
  — семантика `BATCH`: batchlog, изоляция в пределах партиции, `UNLOGGED`.
- Apache Cassandra 5.0 Documentation, [nodetool tablestats](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/tablestats.html)
  — состав полей, включая маркеры и живые ячейки на срез.
- Apache Cassandra 5.0 Documentation, [nodetool tablehistograms](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/tablehistograms.html)
  — перцентили задержки, SSTable на чтение, размер партиции.
- Apache Cassandra 5.0 Documentation, [nodetool toppartitions](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/toppartitions.html)
  — сэмплирование трафика по ключам партиций.
- Apache Cassandra 5.0 Documentation, [nodetool compactionstats](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/compactionstats.html)
  — очередь уплотнения.
- Apache Cassandra 5.0 Documentation, [nodetool getguardrailsconfig](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/getguardrailsconfig.html)
  и [setguardrailsconfig](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/setguardrailsconfig.html)
  — чтение и изменение guardrail без перезапуска узла.
- Apache Cassandra 5.0 Documentation, [Monitoring / Metrics](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/metrics.html)
  — те же величины как метрики для дашборда и алертов.
- Apache Cassandra 5.0 Documentation, [Troubleshooting / Reading Cassandra Logs](https://cassandra.apache.org/doc/stable/cassandra/troubleshooting/reading_logs.html)
  — как читать `WARN`/`ERROR` из `system.log`.
- Apache Cassandra 5.0 Documentation, [Troubleshooting / Using nodetool](https://cassandra.apache.org/doc/stable/cassandra/troubleshooting/use_tools.html)
  — порядок команд при разборе инцидента.
- Проверено на Apache Cassandra 5.0.9, одноузловой кластер; выводы команд в тексте — реальные.
