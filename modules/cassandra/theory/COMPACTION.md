# Уплотнение: выбор стратегии, TTL и почему tombstone живут десять дней

> **Какую проблему решает.** Заказ в `orders_by_user` меняет статус три-пять раз за неделю, и
> каждая правка ложится в отдельный файл — чтение дорожает
> ([`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §5). Уплотнение сводит версии обратно, но выбирать,
> как именно, приходится вам: неверная стратегия превращает чистку старых данных в переписывание
> терабайтов, а верная роняет их целыми файлами почти даром.
> **Кому это надо.** Тому, кто заводит таблицу и обязан назвать стратегию, а не оставить
> умолчание; тому, кто поставил TTL и обнаружил, что место не освободилось.
> **Когда НЕ надо.** Настройка уплотнения не лечит модель данных. Если партиция растёт без
> границ или удаления построчные, стратегия только меняет, чем вы за это платите.

**Границы с соседями.** Механика size-tiered, leveled и time-window и треугольник амплификаций —
[`../../databases/theory/STORAGE_ENGINES.md`](../../databases/theory/STORAGE_ENGINES.md) §3; что
такое tombstone — [`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §4; пороги, на которых накопленные
tombstone роняют запросы, и их обнаружение —
[`OPERATIONS_PITFALLS.md`](OPERATIONS_PITFALLS.md) §3. Здесь — выбор под нагрузку, параметры 5.0 и
взаимодействие с TTL, tombstone и ремонтом.

Прогоны — на одноузловом Apache Cassandra 5.0.9 (`cassandra:5.0`), Apple M4 / Darwin 25.6.0.

---

## 1. Выбор стратегии под три таблицы маркетплейса

**Задача.** Три таблицы под три запроса: `orders_by_id` (записывается один раз, читается по
ключу), `orders_by_user` (заказ меняет статус три-пять раз за неделю, дальше лежит вечно),
`orders_by_seller` (забакетирована по месяцу, [`QUERY_FIRST_DESIGN.md`](QUERY_FIRST_DESIGN.md) §3 —
закрытый месяц больше не меняется).

**Наивное решение.** Не указывать ничего: умолчание же разумное.

**Где ломается.** Умолчание одно на все три — и это STCS:

```
$ docker exec cass-theory cqlsh -e "DESCRIBE TABLE wr_demo.orders_by_user;"
    AND compaction = {'class': 'org.apache.cassandra.db.compaction.SizeTieredCompactionStrategy',
                      'max_threshold': '32', 'min_threshold': '4'}
```

`min_threshold: 4` — порог срабатывания: файлы сливаются, когда накопилось четыре похожих. Порог
реальный, а не декоративный: пять циклов «обновить строку → `nodetool flush`» оставили на диске
два файла, а те же пять циклов после `nodetool disableautocompaction` — шесть. «Похожие» —
это про размер, и границы ведра заданы константами в поставляемом jar:

```
$ javap -p -constants -cp apache-cassandra-5.0.9.jar \
    org.apache.cassandra.db.compaction.SizeTieredCompactionStrategyOptions
  protected static final long   DEFAULT_MIN_SSTABLE_SIZE = 52428800l;
  protected static final double DEFAULT_BUCKET_LOW  = 0.5d;
  protected static final double DEFAULT_BUCKET_HIGH = 1.5d;
```

Всё мельче 50 МиБ — одно ведро; дальше ведро собирается из файлов в пределах половины и полутора
средних размеров. Отсюда свойство, которое и решает выбор: крупный старый файл и свежие мелкие в
одно ведро не попадут, пока мелкие не дорастут, — а когда дорастут, старое будет переписано вместе
с ними. Для `orders_by_seller` это значит переписывать закрытые месяцы, которые не менялись
полгода.

**Механизм выбора.** Стратегия — это ответ на вопрос «какой вид амплификации мне не жалко»
([`../../databases/theory/STORAGE_ENGINES.md`](../../databases/theory/STORAGE_ENGINES.md) §3).
Профиль таблицы задаёт ответ:

| Профиль | Что нельзя допустить | Стратегия |
|---|---|---|
| Запись один раз, чтение по ключу (`orders_by_id`) | — | STCS, умолчание |
| Несколько правок строки, дальше покой (`orders_by_user`) | — | STCS, умолчание |
| Строка переписывается десятки раз в сутки | много файлов на партицию | LCS |
| Данные стареют и умирают по сроку (`orders_by_seller`, журнал событий) | переписывать неизменное | TWCS |

Для `orders_by_seller` окно задаётся явно и принимается сервером как есть:

```
$ docker exec cass-theory cqlsh -e "
    CREATE TABLE cmp_demo.orders_by_seller (...)
    WITH compaction = {'class':'TimeWindowCompactionStrategy',
                       'compaction_window_unit':'DAYS','compaction_window_size':30};
    DESCRIBE TABLE cmp_demo.orders_by_seller;"
    AND compaction = {'class': 'org.apache.cassandra.db.compaction.TimeWindowCompactionStrategy',
                      'compaction_window_size': '30', 'compaction_window_unit': 'DAYS',
                      'max_threshold': '32', 'min_threshold': '4'}
```

TWCS не смешивает окна между собой, поэтому закрытый месяц записывается один раз и больше не
переписывается — и именно это делает его удаление почти бесплатным (§3).

**Правило.** Стратегия выводится не из размера таблицы, а из того, стареют ли в ней данные:
стареют — TWCS, переписываются на месте — LCS, всё остальное — умолчание.

## 2. UCS в Cassandra 5.0: один параметризуемый механизм вместо выбора

**Задача.** Профиль таблицы изменился: журнал событий заказа был чисто вставочным, а теперь по
нему ходят точечные чтения при разборе инцидентов. Выбранная год назад стратегия больше не
подходит.

**Наивное решение.** `ALTER TABLE ... WITH compaction = {'class':'LeveledCompactionStrategy'}` —
одна строка, что тут может стоить дорого.

**Где ломается.** Стратегия описывает не будущие файлы, а все. Шесть SSTable, записанных под STCS,
после `ALTER` на LCS остаются нетронутыми только потому, что уплотнение на таблице выключено:

```
$ docker exec cass-theory sh -c 'for f in .../migr-*/*-Data.db; do
      /opt/cassandra/tools/bin/sstablemetadata $f | grep "SSTable Level"; done'
nb-1-big-Data.db SSTable Level: 0
nb-2-big-Data.db SSTable Level: 0
nb-3-big-Data.db SSTable Level: 0
nb-4-big-Data.db SSTable Level: 0
nb-5-big-Data.db SSTable Level: 0
nb-6-big-Data.db SSTable Level: 0

$ docker exec cass-theory nodetool enableautocompaction cmp_demo migr   # +10 с
nb-7-big-Data.db SSTable Level: 0
```

Шесть файлов переписаны в один. На шести файлах это десять секунд, на боевой таблице — тот же
объём работы, только поверх рабочей нагрузки.

**Механизм.** UCS в 5.0 — не четвёртая строка в том же списке, а один механизм, чьё поведение
задаётся параметром. Формат параметра выдаёт сам сервер, когда его не понимает:

```
$ docker exec cass-theory cqlsh -e "CREATE TABLE cmp_demo.ucs_bad (id int PRIMARY KEY)
    WITH compaction={'class':'UnifiedCompactionStrategy','scaling_parameters':'X7'};"
ConfigurationException: Scaling parameter X7 must match N|L[0-9]+|T[0-9]+|[+-]?[0-9]+
```

`T` — поведение size-tiered, `L` — leveled, `N` — нейтральная середина; число задаёт
коэффициент ветвления уровня.
Параметр задаётся списком, по значению на уровень, и такой список сервер 5.0.9 принимает:
`{'class':'UnifiedCompactionStrategy','scaling_parameters':'T8, T4, N, L4'}` — нижние уровни
ведут себя как STCS, верхние как LCS, в одной таблице. Сама UCS доступна из коробки, но
умолчанием не является: `DESCRIBE TABLE` на таблице без опций по-прежнему показывает STCS (§1).

Переразметку файлов UCS не отменяет — она отменяет необходимость **угадать класс стратегии
заранее**, когда профиль нагрузки ещё неизвестен или меняется со временем.

**Правило.** UCS берут не ради скорости, а чтобы решение «tiered или leveled» осталось
настраиваемым числом, а не вписанным в схему классом.

## 3. TTL и массовое истечение — не бесплатная операция

**Задача.** На заказы старше года поставили TTL: пусть чистятся сами.

**Наивное ожидание.** Срок вышел — строки нет, место освободилось.

**Механизм.** Истечение — не событие, а сравнение при чтении. Прогон: 200 строк с `TTL 20` и 20
строк без TTL в одной партиции, один `nodetool flush`, дальше ничего не трогаем.

```
# сразу после сброса на диск
Read 20 live rows and 0 tombstone cells
"liveness_info" : { "tstamp" : "…", "ttl" : 20, "expires_at" : "…09:49:37Z", "expired" : false }

# те же 25 секунд спустя — тот же файл, те же 1958 байт
Read 20 live rows and 200 tombstone cells
"liveness_info" : { "tstamp" : "…", "ttl" : 20, "expires_at" : "…09:49:37Z", "expired" : true }
```

На диске не изменился ни один байт — изменился результат сравнения `expires_at` с текущим
временем. Двести истёкших строк стали tombstone ([`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §4) и
читаются наравне с живыми, пока их не уберёт уплотнение, то есть не раньше `gc_grace_seconds` (§4).
Массовый TTL опасен именно одновременностью: записанное пачкой истекает пачкой.

**Исключение — TWCS с равномерным TTL.** Если в SSTable не осталось ни одной живой строки, файл
удаляется целиком, без переписывания. Прогон на TWCS с окном в минуту и `default_time_to_live 20`:

```
$ ls -l .../twcs_expire-*/*-Data.db | awk '{print $5, $9}'   # 300 строк с TTL, после сброса
3864 nb-1-big-Data.db

$ ls -l .../twcs_expire-*/*-Data.db | awk '{print $5, $9}'   # после истечения и проверки
40   nb-3-big-Data.db
$ cqlsh -e "SELECT count(*) FROM cmp_demo.twcs_expire;"   →  1
```

Файл на 3864 байта исчез, не оставив ни одного tombstone; уцелел ровно тот, где лежала
единственная не истёкшая строка. Подвох в том, что проверка периодическая:
`TimeWindowCompactionStrategyOptions.DEFAULT_EXPIRED_SSTABLE_CHECK_FREQUENCY_SECONDS = 600` —
десять минут, и при умолчании файл через 30 секунд после истечения ещё лежал на месте.

**Правило.** TTL бесплатен только тогда, когда истекает целая SSTable, — то есть при TWCS и
одинаковом сроке жизни у всех строк в окне; в любой другой раскладке это массовая генерация
tombstone.

## 4. `gc_grace_seconds`: зачем ждать десять дней

**Задача.** Ночная чистка отработала, уплотнение прошло. Место не освободилось.

**Наивное ожидание.** Проход сливает файлы и выбрасывает всё, что перекрыто маркером удаления.

**Где ломается.** Таблица на 500 строк, 480 удалены построчно, один сброс на диск. Запускаем
полное уплотнение:

```
$ ls -l .../gc_demo-*/*-Data.db | awk '{print $5, $9}'       # до
4375 nb-1-big-Data.db
   Read 20 live rows and 480 tombstone cells

$ docker exec cass-theory nodetool compact cmp_demo gc_demo   # gc_grace_seconds = 864000
4384 nb-2-big-Data.db
   Read 20 live rows and 480 tombstone cells
   Droppable tombstone ratio: 0.00000
```

Проход отработал — `nb-1` сменился на `nb-2` — и файл даже вырос на девять байт. Теперь то же
самое, изменив ровно одно значение:

```
$ docker exec cass-theory cqlsh -e "ALTER TABLE cmp_demo.gc_demo WITH gc_grace_seconds = 0;"
$ docker exec cass-theory nodetool compact cmp_demo gc_demo
218 nb-3-big-Data.db
   Read 20 live rows and 0 tombstone cells
```

4384 байта против 218: выбросить маркеры проход умеет, но отказывался.

**Механизм.** Реплика была недоступна в момент удаления и маркера не получила — у неё осталась
живая строка. Когда она вернётся, `nodetool repair` сверит её содержимое с остальными репликами.
Если маркер к этому моменту уже выброшен, у остальных про эту строку нет **ничего**, а «ничего» не
побеждает «что-то»: разрешение по метке времени ([`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §3)
сравнивает версии, и когда версии нет, сравнивать нечего — ремонт разнесёт удалённую строку обратно
на все реплики. Это зомби-данные: запись, воскресшая из отставшей реплики.

Отсюда смысл параметра. `gc_grace_seconds` — не таймер безопасности, а контракт: уплотнение
обязуется не трогать маркер указанный срок, администратор обязуется за этот срок прогнать ремонт.
Умолчание `864000` (десять суток) — запас поверх еженедельного ремонта, а не свойство данных.
Механика самого ремонта — в
[`../../databases/theory/REPLICATION.md`](../../databases/theory/REPLICATION.md) и
[`../../system-design/theory/MERKLE_TREE.md`](../../system-design/theory/MERKLE_TREE.md), чем он
отличается от read repair — в [`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §4.

**Правило.** Снижать `gc_grace_seconds` ради места можно ровно настолько, насколько вы готовы
сократить интервал между ремонтами, — иначе вы покупаете место за зомби-данные.

## 5. Почему tombstone переживают проход уплотнения

**Задача.** Срок из §4 истёк, уплотнение отработало — маркеры на месте.

**Наивное ожидание.** Ждать больше нечего, значит следующий проход их уберёт.

**Где ломается.** Таблица с `gc_grace_seconds = 0` — ждать заведомо нечего. Два файла: в первом
500 живых строк, во втором 480 маркеров удаления. Уплотняем только второй:

```
$ docker exec cass-theory nodetool compact --user-defined .../gc2-*/nb-2-big-Data.db
4364 nb-1-big-Data.db
4222 nb-3-big-Data.db        # результат прохода: sstabledump находит 480 × deletion_info
```

Все 480 маркеров пережили проход. Тот же набор данных, но в проход входят оба файла:

```
$ docker exec cass-theory nodetool compact cmp_demo gc2
220 nb-4-big-Data.db         # sstabledump: 0 × deletion_info, 20 строк
```

**Механизм.** Проход видит только вошедшие в него файлы. Маркер перекрывает старую версию строки,
а она лежит в `nb-1` — вне прохода; выбросить маркер значит сделать её снова видимой. Поэтому
условие на выброс двойное: срок истёк **и** данных под маркером нет ни в одном файле за пределами
прохода. Второе условие в частичном проходе не выполнялось — и не выполнялось бы, даже если бы
маркеры пролежали год.

Кто формирует набор прохода — стратегия (§1). STCS собирает файлы по размеру, так что свежий файл
с маркерами и крупный старый файл с перекрытыми данными попадают в разные вёдра и могут не
встретиться очень долго; `nodetool compact` без аргументов сводит все файлы в один именно потому,
что это единственный проход, у которого «вне набора» ничего не остаётся.

**Ловушка в диагностике.** Счётчик в трассировке не считает маркеры, уже просроченные по
`gc_grace_seconds`, хотя физически они в файле. Одна и та же таблица `gc2` с теми же 480
`deletion_info` на диске:

```
gc_grace_seconds = 0       →  Read 20 live rows and 0 tombstone cells
gc_grace_seconds = 864000  →  Read 20 live rows and 480 tombstone cells
```

Ноль здесь означает «маркеры больше не мешают ответу», а не «маркеров нет»: место они занимают
по-прежнему.

**Правило.** Маркер исчезает не по возрасту, а когда встречается в одном проходе со всем, что
перекрывает.

## 6. Шпаргалка

**Дерево решений.**

```
Данные стареют и умирают по сроку?      → да  → TWCS + одинаковый TTL на всё окно
Одна строка переписывается десятки раз? → да  → LCS
Профиль ещё неизвестен или поплывёт?    → да  → UCS, дальше крутить scaling_parameters
иначе                                         → умолчание (STCS)
```

**Умолчания Cassandra 5.0.9, проверенные на кластере и в поставляемом jar:**

| Параметр | Значение | Откуда |
|---|---|---|
| стратегия таблицы | `SizeTieredCompactionStrategy` | `DESCRIBE TABLE` |
| `min_threshold` / `max_threshold` | 4 / 32 | `DESCRIBE TABLE` |
| `gc_grace_seconds` | 864000 (10 суток) | `DESCRIBE TABLE` |
| `default_time_to_live` | 0 (без TTL) | `DESCRIBE TABLE` |
| STCS `min_sstable_size` | 50 МиБ | `javap` |
| STCS `bucket_low` / `bucket_high` | 0.5 / 1.5 | `javap` |
| TWCS `expired_sstable_check_frequency_seconds` | 600 | `javap` |

**Когда «место не освобождается»:** смотреть `SSTable count` в `nodetool tablestats`, истёк ли
`gc_grace_seconds`, и встретились ли маркеры с перекрытыми данными в одном проходе.

### Формулировки для собеседования

- «Стратегия выбирается не по размеру таблицы, а по тому, стареют ли данные: стареют — TWCS,
  переписываются на месте — LCS, остальное — умолчание.»
- «TTL бесплатен, только когда истекает целая SSTable. В любой другой раскладке это массовая
  генерация tombstone, которые надо читать и сливать.»
- «`gc_grace_seconds` — это не таймер, а контракт: уплотнение не трогает маркер десять дней, вы за
  эти десять дней обязаны прогнать ремонт. Не прогоняете — получаете зомби-данные.»
- «Маркер удаления исчезает не по возрасту, а когда попадает в один проход со всем, что
  перекрывает: проход не видит файлов за пределами своего набора.»
- «Ноль tombstone в трассировке не значит, что их нет на диске: просроченные по gc_grace маркеры
  просто перестают считаться.»

## Упражнения

- [`../exercises/ex05_compaction/README.md`](../exercises/ex05_compaction/README.md) — выбрать
  стратегию для трёх профилей нагрузки и назвать, какой амплификацией платит каждый выбор (§1, §2).
- [`../exercises/ex03_tombstones/README.md`](../exercises/ex03_tombstones/README.md) —
  воспроизвести проблему tombstone и объяснить, почему они переживают принудительное уплотнение
  (§4, §5).

## Источники

- Apache Cassandra 5.0 Documentation, [Operating / Compaction](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/compaction/index.html)
  — общая механика прохода, когда он запускается и что делает с tombstone.
- Apache Cassandra 5.0 Documentation, стратегии по отдельности:
  [STCS](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/compaction/stcs.html),
  [LCS](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/compaction/lcs.html),
  [TWCS](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/compaction/twcs.html),
  [UCS](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/compaction/ucs.html)
  — пороги, параметры и область применимости каждой.
- Apache Cassandra 5.0 Documentation, [CQL / Data Definition](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/ddl.html)
  — `WITH compaction`, `default_time_to_live`, `gc_grace_seconds` в определении таблицы.
- Apache Cassandra 5.0 Documentation, [Configuration / cassandra.yaml](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
  — параметры уплотнения уровня узла.
- Apache Cassandra 5.0 Documentation, [Tools / nodetool](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/nodetool.html)
  — `compact`, `compactionstats`, `tablestats`, `disableautocompaction`.
- Механика LSM и стратегий в общем виде — [`STORAGE_ENGINES.md`](../../databases/theory/STORAGE_ENGINES.md) §3;
  ремонт и деревья Меркла — [`MERKLE_TREE.md`](../../system-design/theory/MERKLE_TREE.md).
- Все выводы команд в тексте получены на одноузловом Apache Cassandra 5.0.9 (образ `cassandra:5.0`).
