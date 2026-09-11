# Путь записи и путь чтения

> **Какую проблему решает.** Пик маркетплейса — 20 тыс. записей в секунду, и при этом «последние
> 20 заказов пользователя» обязаны отвечать за единицы миллисекунд. Здесь разобрано, за счёт чего
> запись держит такой поток без единого чтения с диска, почему чтение платит за это слиянием
> источников — и почему `DELETE` делает чтение медленнее, а не быстрее.
> **Кому это надо.** Тому, кто уже выбрал Cassandra и должен объяснить, почему ночная чистка
> отменённых заказов уронила задержку чтения; тому, кто читает трассировку запроса и должен понимать
> каждую её строку.
> **Когда НЕ надо.** Это не руководство «как ускорить чтение». Путь чтения одинаков для удачной и
> провальной схемы; если чтение медленное, отвечает обычно модель данных
> ([`QUERY_FIRST_DESIGN.md`](QUERY_FIRST_DESIGN.md)), а не настройки пути.

**Границы с соседями.** LSM-дерево против B-дерева и WAL как класс механизмов —
[`../../databases/theory/STORAGE_ENGINES.md`](../../databases/theory/STORAGE_ENGINES.md) §2, §5;
устройство bloom-фильтра —
[`../../system-design/theory/PROBABILISTIC_STRUCTURES.md`](../../system-design/theory/PROBABILISTIC_STRUCTURES.md);
когда tombstone физически исчезает — [`COMPACTION.md`](COMPACTION.md) §4–§5.

Прогоны — на одноузловом Apache Cassandra 5.0.9 (`cassandra:5.0`,
`storage_compatibility_mode=CASSANDRA_4`: формат SSTable `big`, файлы с префиксом `nb-`).

---

## 1. Путь записи: commitlog → memtable → SSTable

**Задача.** 20 тыс. вставок заказа в секунду.

**Наивное представление.** Чтобы записать строку, надо найти её место в файле: прочитать страницу,
изменить, записать обратно. Тогда 20 тыс. записей в секунду — это сначала 20 тыс. случайных чтений.

**Механизм.** Cassandra при записи не читает ничего. Координатор делает две вещи: дописывает
мутацию в конец commitlog и кладёт её в memtable — структуру в оперативной памяти. Ответ клиенту
уходит после этого; SSTable на диске в этот момент ещё нет.

Видно прямо в файловой системе — после `INSERT` каталог таблицы пуст, но строка уже читается:

```
$ docker exec cass-theory sh -c 'ls -la /var/lib/cassandra/data/wr_demo/orders_by_user-*/'
total 8
drwxr-xr-x 2 cassandra cassandra 4096 .
drwxr-xr-x 3 cassandra cassandra 4096 ..

$ docker exec cass-theory cqlsh -e "SELECT status, total FROM wr_demo.orders_by_user;"
 status | total
--------+---------
    NEW | 1500.00
```

Файлы появляются только когда memtable сбрасывается на диск — по заполнению или по команде:

```
$ docker exec cass-theory nodetool flush wr_demo orders_by_user
$ docker exec cass-theory sh -c 'ls -la /var/lib/cassandra/data/wr_demo/orders_by_user-*/'
-rw-r--r-- 1 cassandra cassandra   47 nb-1-big-CompressionInfo.db
-rw-r--r-- 1 cassandra cassandra   81 nb-1-big-Data.db
-rw-r--r-- 1 cassandra cassandra   10 nb-1-big-Digest.crc32
-rw-r--r-- 1 cassandra cassandra   16 nb-1-big-Filter.db
-rw-r--r-- 1 cassandra cassandra   33 nb-1-big-Index.db
-rw-r--r-- 1 cassandra cassandra 5111 nb-1-big-Statistics.db
-rw-r--r-- 1 cassandra cassandra  131 nb-1-big-Summary.db
-rw-r--r-- 1 cassandra cassandra   92 nb-1-big-TOC.txt
```

Одна SSTable — это восемь файлов, и все они пишутся **последовательно и один раз**: SSTable
неизменяема. `Filter.db` — bloom-фильтр, `Index.db` — индекс партиций, `Summary.db` — его
разреженная выжимка в памяти; они понадобятся в §2.

**Что делает commitlog.** Memtable живёт в куче и при падении процесса исчезает целиком. Проверка:
вставить строку, ничего не сбрасывать, перезапустить узел.

```
$ docker exec cass-theory sh -c 'ls /var/lib/cassandra/data/wr_demo/durable-*/ | wc -l'
0
$ docker restart cass-theory
$ docker exec cass-theory cqlsh -e "SELECT * FROM wr_demo.durable;"
 id | note
----+----------------------------------
  1 | записано, но не сброшено на диск

$ docker logs cass-theory | grep CommitLog.java
CommitLog.java:206 - Replaying /opt/cassandra/data/commitlog/CommitLog-7-1788857648870.log, ...
CommitLog.java:210 - Log replay complete, 450 replayed mutations in 295 ms
```

450 мутаций восстановлены из журнала за 295 мс — ровно те, что не успели попасть в SSTable.

**Где «дёшево» перестаёт означать «надёжно».** По умолчанию запись подтверждается до того, как
commitlog дошёл до диска. `cassandra.yaml:631` про режим `periodic`:

> the default option is "periodic" where writes may be acked immediately and the CommitLog is
> simply synced every `commitlog_sync_period` milliseconds

При заводских `commitlog_sync: periodic` и `commitlog_sync_period: 10000ms`
(`cassandra.yaml:634,636`) окно — до 10 секунд: запись переживёт падение процесса, но не
обязательно переживёт пропажу питания на узле.

**Правило.** «Запись дешёвая» — утверждение о том, что она не читает; долговечность в него не
входит и чинится числом реплик ([`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §1), а не
настройкой commitlog.

## 2. Путь чтения: bloom-фильтр → индекс партиции → слияние источников

**Задача.** `SELECT ... WHERE order_id = ?` по таблице «заказ по идентификатору».

**Наивное представление.** Есть индекс — значит, одно обращение по смещению и готово.

**Где ломается.** Индекс в Cassandra принадлежит конкретной SSTable и знает только про неё. Места,
где записано «актуальная версия ключа K лежит вот здесь», нет ни одного: §1 писал каждую версию
туда, где было место в этот момент. Реплика обязана опросить memtable и **каждую** SSTable, которая
может содержать ключ.

**Механизм.** Он целиком виден в трассировке. Таблица `orders_by_id` из 600 заказов в двух
SSTable, ищется заказ, лежащий в первой:

```
$ docker exec cass-theory cqlsh -e \
    "TRACING ON; SELECT status,total FROM wr_demo.orders_by_id \
     WHERE order_id=00000000-0000-0000-0000-0000000000bb;"

activity                                                        source_elapsed (мкс)
Executing single-partition query on orders_by_id [ReadStage-3]   604
Acquiring sstable references [ReadStage-3]                       643
Merging memtable contents [ReadStage-3]                          670
Bloom filter allows skipping sstable 2 [ReadStage-3]             706
Partition index found for sstable 1, size = 0 [ReadStage-3]      833
Read 1 live rows and 0 tombstone cells [ReadStage-3]            1001
```

Построчно:

- `Acquiring sstable references` — собирается набор кандидатов. Из него уже выброшены SSTable, чей
  диапазон ключей не покрывает искомый токен: это сравнение границ, без чтения файла.
- `Merging memtable contents` — memtable в наборе всегда: самая свежая версия может быть ещё там.
- `Bloom filter allows skipping sstable 2` — фильтр из `Filter.db` (§1) отвечает «ключа точно нет».
  Ответ «нет» у bloom-фильтра точный, ответ «да» — вероятностный
  ([`../../system-design/theory/PROBABILISTIC_STRUCTURES.md`](../../system-design/theory/PROBABILISTIC_STRUCTURES.md)),
  поэтому фильтр умеет только **исключать** файлы, но не подтверждать попадание.
- `Partition index found for sstable 1` — по `Index.db` найдено смещение партиции в `Data.db`. На
  повторе того же запроса эта строка сменяется на `Key cache hit for sstable 1, size = 0` —
  смещение уже в кэше ключей, читать индекс не нужно.
- `Read 1 live rows and 0 tombstone cells` — итог слияния версий; что именно побеждает при
  конфликте, разбирает §3.

Запрос несуществующего ключа в этой же таблице даёт две строки `Bloom filter allows skipping` и
`Read 0 live rows and 0 tombstone cells` — ни один файл не открыт вообще. Цена промаха фильтра
измерима отдельным полем:

```
$ docker exec cass-theory nodetool tablestats wr_demo.orders_by_id
		SSTable count: 2
		Number of partitions (estimate): 600
		Bloom filter false positives: 0
		Bloom filter false ratio: 0.00000
		Bloom filter space used: 784
```

784 байта на 600 партиций и ноль ложных срабатываний. Растущий `Bloom filter false ratio` означает,
что реплика зря открывает файлы.

**Правило.** Чтение по ключу — не поиск, а слияние. Все три структуры пути (границы ключей,
bloom-фильтр, индекс партиции) только сокращают набор файлов; ни одна не отвечает на вопрос
«где актуальная версия» — на него отвечает только само слияние.

## 3. Разрешение конфликтов: last-write-wins на уровне ячейки

**Задача.** Заказ обновили в двух дата-центрах до синхронизации: в первом сменили `status`, во
втором — чуть раньше — пересчитали `total`. Что останется в строке после слияния (§2)?

**Наивный ответ.** Побеждает версия строки с большей меткой времени, вторая теряется.

**Механизм.** Метка времени лежит на каждой ячейке, и сравниваются ячейки. После двух `UPDATE`
с разными `USING TIMESTAMP` в SSTable оказывается одна строка с двумя разными метками:

```
$ docker exec cass-theory /opt/cassandra/tools/bin/sstabledump .../lww-*/nb-1-big-Data.db
"rows" : [ {
    "type" : "row",
    "liveness_info" : { "tstamp" : "2001-09-09T01:46:40Z" },
    "cells" : [
      { "name" : "status", "value" : "SHIPPED", "tstamp" : "2001-09-09T01:46:40.000200Z" },
      { "name" : "total",  "value" : 1499.00,   "tstamp" : "2001-09-09T01:46:40.000100Z" } ] } ]
```

Уцелели обе правки, хотя метки разные: у `status` и `total` свои независимые «победители», и
`SELECT` возвращает `SHIPPED` вместе с `1499.00`.
При равных метках побеждает большее значение побайтно, а не последняя по времени запись — две
вставки `'aaa'` и `'zzz'` с одинаковым `USING TIMESTAMP` дают `'zzz'` в любом порядке.

**Правило.** Cassandra не разрешает конфликты — она их не замечает: две правки разных колонок
просто сложатся. Это ровно то, чего вы хотите при обновлении статуса и опасно там, где строка
осмысленна только целиком (адрес доставки, состав заказа): такую сущность пишите одним `INSERT`
всех колонок, чтобы у них была общая метка. Сама метка — микросекундное показание настенных часов
без всякой кластерной синхронизации, поэтому расхождение часов
([`../../system-design/theory/distributed_systems.md`](../../system-design/theory/distributed_systems.md))
здесь напрямую превращается в потерю правки.

## 4. Tombstone: удаление — это тоже запись

**Задача.** Ночное задание чистит отменённые заказы старше 30 дней.

**Наивное ожидание.** Освободится место, и чтение «последние 20 заказов пользователя» ускорится.

**Механизм.** Стирать байты некуда: SSTable неизменяема (§1). Поэтому `DELETE` — это обычная
запись, идущая тем же путём: commitlog, memtable, SSTable. Различить живую и удалённую строку
можно только по содержимому — вот обе в одном дампе:

```
$ docker exec cass-theory /opt/cassandra/tools/bin/sstabledump .../tomb-*/nb-1-big-Data.db
{ "type" : "row", "clustering" : [ 1 ],
  "liveness_info" : { "tstamp" : "2026-09-08T09:35:23.123576Z" },
  "cells" : [ { "name" : "status", "value" : "NEW" }, { "name" : "total", "value" : 100.00 } ] },
{ "type" : "row", "clustering" : [ 2 ],
  "deletion_info" : { "marked_deleted"     : "2026-09-08T09:35:23.126091Z",
                      "local_delete_time"  : "2026-09-08T09:35:23Z" },
  "cells" : [ ] }
```

`marked_deleted` — та самая метка времени из §3: она и побеждает старые версии при слиянии.
`local_delete_time` — секунды местного времени узла, отдельное поле; по нему потом решается,
можно ли маркер выбросить ([`COMPACTION.md`](COMPACTION.md) §4).

**Почему чтение замедляется.** Удалённая строка участвует в слиянии наравне с живыми: слияние
обязано её увидеть, чтобы понять, что данные под ней невидимы. Трассировка на партиции с одной
живой и одной удалённой строкой — `SELECT` вернул одну строку, а прочитал две:

```
Merged data from memtables and 1 sstables [ReadStage-15]
Read 1 live rows and 1 tombstone cells [ReadStage-15]
```

**Форма удаления решает масштаб.** Две одинаковые таблицы по 500 строк в одной партиции, в каждой
удалены 480, обе сброшены на диск командой `nodetool flush`. Разница только в форме удаления:

| Как удаляли | Трассировка чтения 20 живых строк | `Data.db` |
|---|---|---|
| `DELETE ... WHERE order_id > 20` — один диапазон | `Read 20 live rows and 2 tombstone cells` | 233 B |
| 480 отдельных `DELETE ... AND order_id = N` | `Read 20 live rows and 480 tombstone cells` | 4407 B |

Дамп объясняет разницу: в первой SSTable `sstabledump` находит 20 объектов `"type" : "row"` и два
`"type" : "range_tombstone_bound"` (границы `inclusive` и `exclusive`), во второй — 500 строк.
Диапазонное удаление хранится двумя маркерами границ, а не отметкой на каждой строке, поэтому
удалённые строки до диска даже не дошли: слияние при сбросе memtable выбросило их сразу.

**Правило.** `DELETE` увеличивает объём данных и стоимость чтения. Если удаление регулярное,
формулируйте его диапазоном по ключу кластеризации, а лучше замените на TTL и стратегию, которая
роняет данные целыми файлами ([`COMPACTION.md`](COMPACTION.md) §1, §3). Пороги, на которых
накопленные tombstone начинают ронять запросы, — в
[`OPERATIONS_PITFALLS.md`](OPERATIONS_PITFALLS.md) §3.

## 5. Почему чтение дороже записи

Асимметрия выводится из §1 и §2. Работа записи не зависит ни от чего: append в журнал и вставка в
структуру в памяти стоят одинаково для ключа, записанного впервые, и для ключа, у которого уже сорок
версий. Работа чтения зависит от того, во скольких местах ключ может лежать, — а §2 показал, что ни
одна структура пути не умеет ответить «актуальная версия здесь»; свести набор кандидатов к одному
файлу в общем случае нечем, потому что версий действительно несколько и все они равноправны до
слияния.

Отсюда: **стоимость чтения — функция от того, насколько история одного ключа размазана по файлам.**
Проверяется прямо:

```
$ docker exec cass-theory cqlsh -f /tmp/amp_read.cql      # 200 чтений по ключу партиции
$ docker exec cass-theory nodetool tablestats wr_demo.amp
```

| Состояние таблицы | `Local read latency` | `Local write latency` |
|---|---|---|
| 1 SSTable | 0.078 → 0.056 мс | 0.007 мс |
| 10 SSTable (автокомпакция выключена) | 0.134 → 0.129 мс | 0.009 мс |
| после `nodetool compact`, снова 1 SSTable | 0.105 → 0.091 мс | — |

Замер на Apple M4 (10 ядер), Darwin 25.6.0, один узел `cassandra:5.0` (5.0.9) в контейнере,
`MAX_HEAP_SIZE=1G`. Это не бенчмарк, а порядок величин: таблица `amp` — 200 партиций по 5 строк,
каждый замер — 200 чтений подряд, две цифры в ячейке это два последовательных замера подряд
(значение в `tablestats` затухающее, поэтому дрейфует). Повторяется командами выше.

Читаем: десятикратный рост числа SSTable удвоил чтение и не тронул запись — при том что записей
за то же время прошло в десять раз больше (10 000 против 1000). Это же видно в трассировке
поштучно: на партиции, размазанной по шести SSTable, появляется `Merged data from memtables and
6 sstables` и шесть строк `Key cache hit for sstable N` вместо одной.

**Когда это становится проблемой.** Не когда данных много, а когда одна партиция обновляется много
раз: каждый сброс memtable кладёт очередную версию в очередной файл. Заказ в `orders_by_user` меняет
статус три-пять раз за неделю — ровно такой профиль, и удерживает его только уплотнение
([`COMPACTION.md`](COMPACTION.md) §1).

**Правило.** Медленное чтение в Cassandra диагностируют не профилировщиком, а вопросом «сколько
SSTable накрывают эту партицию».

## 6. Шпаргалка

**Путь записи.** commitlog (дозапись в конец) → memtable (в памяти) → ответ клиенту → сброс →
SSTable (8 файлов, неизменяема). Чтения на этом пути нет ни одного.

**Путь чтения — что означает каждая строка трассировки:**

| Строка трассировки | Что произошло |
|---|---|
| `Acquiring sstable references` | собран набор кандидатов; отсеяны файлы по диапазону ключей |
| `Merging memtable contents` | memtable добавлен в набор — он всегда кандидат |
| `Bloom filter allows skipping sstable N` | фильтр сказал «ключа точно нет»; файл не открыт |
| `Partition index found for sstable N` | по `Index.db` найдено смещение партиции в `Data.db` |
| `Key cache hit for sstable N` | то же смещение взято из кэша, читать индекс не нужно |
| `Merged data from memtables and N sstables` | итог: слито N источников; N — цена запроса |
| `Read X live rows and Y tombstone cells` | Y — работа, оплаченная за строки, которых нет |

**Разрешение конфликта:** по метке времени, на уровне ячейки; при равных метках побеждает большее
значение побайтно.

**Удаление:** `DELETE` — запись. Диапазонный `DELETE` — два маркера границ; построчный — маркер на
каждую строку. Освобождение места — только через уплотнение, и не раньше `gc_grace_seconds`.

### Формулировки для собеседования

- «Запись дешёвая, потому что не читает: append в журнал плюс вставка в память. Долговечность в
  это не входит — при `commitlog_sync: periodic` подтверждение уходит до `fsync`.»
- «Чтение — не поиск, а слияние. Bloom-фильтр и индекс только сокращают набор файлов; какая версия
  актуальна, знает только само слияние.»
- «Метка времени живёт на ячейке, а не на строке, поэтому две правки разных колонок не конфликтуют
  вовсе — они складываются.»
- «`DELETE` увеличивает объём и замедляет чтение: маркер удаления читается наравне с данными.»
- «Медленное чтение в Cassandra — почти всегда вопрос "сколько SSTable накрывают эту партицию".»

## Упражнения

- [`../exercises/ex03_tombstones/README.md`](../exercises/ex03_tombstones/README.md) — воспроизвести
  на живом кластере чтение, которое читает на порядок больше ячеек, чем возвращает, и измерить это
  трассировкой (§4).
- [`../exercises/ex06_diagnose/README.md`](../exercises/ex06_diagnose/README.md) — разбор
  замедлившегося запроса; вся §2 и §5 нужны, чтобы прочитать трассировку.

## Источники

- Apache Cassandra 5.0 Documentation, [Architecture / Storage Engine](https://cassandra.apache.org/doc/stable/cassandra/architecture/storage-engine.html)
  — commitlog, memtable, SSTable и состав файлов на диске.
- Apache Cassandra 5.0 Documentation, [Architecture / Guarantees](https://cassandra.apache.org/doc/stable/cassandra/architecture/guarantees.html)
  — что база обещает по долговечности и атомарности записи.
- Apache Cassandra 5.0 Documentation, [Configuration / cassandra.yaml](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
  — `commitlog_sync`, `commitlog_sync_period`: режим `periodic` и окно подтверждения до сброса на диск.
- Apache Cassandra 5.0 Documentation, [Operating / Bloom Filters](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/bloom_filters.html)
  — роль фильтра в пути чтения и цена ложного срабатывания.
- Apache Cassandra 5.0 Documentation, [CQL / Data Manipulation](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/dml.html)
  — метки времени записи, разрешение конфликтов, удаление.
- Apache Cassandra 5.0 Documentation, [Tools / sstabledump](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/sstable/sstabledump.html)
  — чем смотреть физическое содержимое SSTable.
- Устройство LSM в общем виде — [`STORAGE_ENGINES.md`](../../databases/theory/STORAGE_ENGINES.md) §2;
  bloom-фильтр как структура — [`PROBABILISTIC_STRUCTURES.md`](../../system-design/theory/PROBABILISTIC_STRUCTURES.md).
- Все выводы команд в тексте получены на одноузловом Apache Cassandra 5.0.9 (образ `cassandra:5.0`).
