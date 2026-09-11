# Моделирование от запросов: таблица на запрос

> **Какую проблему решает.** У истории заказов маркетплейса ровно три запроса: «последние 20 заказов
> пользователя», «заказ по идентификатору», «заказы продавца за период». Схема, нарисованная от
> сущности «заказ», обслужит первый и откажет на остальных — сервер просто не примет такой `WHERE`.
> Здесь показано, как из списка запросов получается список таблиц и чем за это платят.
> **Кому это надо.** Тому, кто проектирует схему, и тому, кто уже получил
> `Cannot execute this query as it might involve data filtering` и думает, дописать ли
> `ALLOW FILTERING`.
> **Когда НЕ надо.** Если список запросов заранее неизвестен или меняется каждый спринт — метод не
> работает, а Cassandra в этой роли неправильный ответ
> ([`WHY_CASSANDRA.md`](WHY_CASSANDRA.md) §5). Моделирование от запросов не заменяет и аналитику по
> произвольным срезам: под неё нужен отдельный движок.

**Что здесь и чего здесь нет.** Здесь — приём: как из шаблонов доступа получить таблицы и почему
дублирование данных считается нормой. Устройство первичного ключа, ячейки и предел партиции —
[`DATA_MODEL.md`](DATA_MODEL.md) §1, §2, §4. Почему запрос без ключа партиции вообще невозможен и
почему нет транзакций между партициями — [`WHY_CASSANDRA.md`](WHY_CASSANDRA.md) §3 и §4. Как большая
или горячая партиция обнаруживается в работающем кластере и что такое `LOGGED batch` —
[`OPERATIONS_PITFALLS.md`](OPERATIONS_PITFALLS.md) §1, §2, §5. Устройство инвертированного индекса
как структуры — [`../../system-design/theory/INVERTED_INDEX.md`](../../system-design/theory/INVERTED_INDEX.md).

Прогоны выполнены на одноузловом Apache Cassandra 5.0.9 (контейнер `cass-theory`), Apple M4 /
Darwin 25.6.0, keyspace `qfd_demo` с `SimpleStrategy` и RF=1. Это не бенчмарк: цифры показывают
порядок величин и соотношение, а не абсолютную производительность. Выводы в блоках — реальные.

## 1. Сначала список запросов, потом таблицы

**Задача.** Те самые три запроса истории заказов. Один заказ, три способа его найти.

**Наивное решение.** Одна таблица `orders` с ключом по `order_id` — как сделали бы в РСУБД, а
остальные два запроса закрыть условием по колонке.

**Где ломается.** Сервер отказывается ещё на разборе запроса:

```
$ cqlsh -e "SELECT order_id,status FROM qfd_demo.orders_by_id WHERE status='SHIPPED';"
InvalidRequest: code=2200 [Invalid query] message="Cannot execute this query as it might
involve data filtering and thus may have unpredictable performance. If you want to execute
this query despite the performance unpredictability, use ALLOW FILTERING"
```

**Механизм.** Ключ партиции — не «один из индексов», а единственный адрес, по которому узел умеет
найти данные, не опрашивая всё кольцо ([`WHY_CASSANDRA.md`](WHY_CASSANDRA.md) §3). Порядок строк
внутри партиции задан на диске один раз, при записи ([`DATA_MODEL.md`](DATA_MODEL.md) §3). Значит
таблица обслуживает ровно один шаблон доступа: «известен такой-то ключ, нужны строки в таком-то
порядке». Отсюда счёт: **сколько шаблонов доступа — столько таблиц**, и проектирование идёт от
списка запросов, а не от списка сущностей.

| Запрос приложения | Таблица | Ключ партиции | Кластеризация |
|---|---|---|---|
| последние 20 заказов пользователя | `orders_by_user` | `user_id` | `created_at DESC, order_id DESC` |
| заказ по идентификатору | `orders_by_id` | `order_id` | — |
| заказы продавца за период | `orders_by_seller` | `seller_id, bucket` | `created_at DESC, order_id DESC` |

Первый запрос на этой схеме читает ровно столько строк, сколько отдаёт, — при том что в партиции
пользователя их около тысячи:

```
$ cqlsh -e "TRACING ON; SELECT order_id,created_at FROM qfd_demo.orders_by_user
            WHERE user_id=00000000-0000-0000-0000-00000000045c LIMIT 20;"

 Executing single-partition query on orders_by_user            829
 Partition index found for sstable 4, size = 0                1090
 Read 20 live rows and 0 tombstone cells                      1271
 Request complete                                             1355   (мкс)
```

`LIMIT 20` здесь не «отфильтровать лишнее после чтения», а «прочитать 20 строк подряд и
остановиться»: порядок уже записан на диск.

**Правило.** Таблица в Cassandra — это материализованный ответ на один запрос. Если для нового
экрана в приложении не находится таблицы, в которой ключ партиции известен заранее, — нужна не
хитрость в `WHERE`, а новая таблица.

## 2. Денормализация: N независимых мутаций вместо одной сущности

**Задача.** Заказ оформлен. Его надо положить в три таблицы из §1.

**Наивное решение.** Три `INSERT` подряд в коде сервиса. Заказ один, значит и запись логически одна.

**Где ломается.** Запись не одна, а три — и между ними процесс может умереть. Прогон: выполняем две
вставки из трёх и спрашиваем обе стороны.

```
$ cqlsh -e "SELECT order_id,status FROM qfd_demo.orders_by_id WHERE order_id=22222222-…-0001;"
 22222222-0000-0000-0000-000000000001 |   PAID

$ cqlsh -e "SELECT order_id FROM qfd_demo.orders_by_seller
            WHERE seller_id=33333333-…-0001 AND bucket='2026-03';"
 (0 rows)
```

Оба ответа успешны. Заказ существует для страницы «мои заказы» и не существует для отчёта продавца,
и **никто об этом не сообщает**: ошибки нет, предупреждения нет, метрики чистые.

**Механизм.** Атомарности между партициями в Cassandra нет
([`WHY_CASSANDRA.md`](WHY_CASSANDRA.md) §4), а три проекции — это три разные партиции на трёх разных
наборах узлов. Чинить такое расхождение тоже нечем: единица `nodetool repair` — таблица и диапазон
токенов (`nodetool help repair`: «Repair one or more tables»), он сверяет реплики одной таблицы между
собой и про существование второй проекции не знает. `LOGGED batch` сдвигает проблему, но не снимает:
он обещает, что мутации рано или поздно применятся все, и не обещает, что читатель не увидит половину
([`OPERATIONS_PITFALLS.md`](OPERATIONS_PITFALLS.md) §5).

**Правило.** Назначьте одну таблицу источником истины — в примере это `orders_by_id`, единственная,
где заказ лежит целиком, — а остальные считайте производными, которые можно перестроить из неё.
Тогда у частичной записи есть лечение: повторить операцию целиком. Повтор безопасен, потому что
повторная вставка тех же значений по тому же ключу даёт то же состояние — разрешение конфликтов
идёт по последней записи ([`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §3). Исключение — счётчики: их
повтор не идемпотентен, и в проекциях им не место ([`DATA_MODEL.md`](DATA_MODEL.md) §8).

## 3. Бакетирование по времени: чем платите за ограниченный размер партиции

**Задача.** У пользователя заказов десятки, и партиция `orders_by_user` не растёт. У продавца их
тысячи в день, и партиция `orders_by_seller` растёт столько, сколько живёт продавец.

**Наивное решение.** Оставить ключом партиции `seller_id`: запрос за период — одно чтение, красиво.

**Где ломается.** Замер: 200 тыс. заказов одного продавца за четыре с половиной месяца, две
таблицы — с ключом партиции `(seller_id)` и с ключом `(seller_id, bucket)`, где `bucket` — месяц.

```
$ nodetool tablestats qfd_demo.seller_nobucket | seller_bucket

seller_nobucket:  Number of partitions (estimate): 1
                  Compacted partition maximum bytes: 8409007
                  Space used (live): 2892342
seller_bucket:    Number of partitions (estimate): 5
                  Compacted partition maximum bytes: 1955666
                  Space used (live): 2894217
```

Одна партиция на 8,4 МБ против пяти по 1,9 МБ; на диске разница в 1875 байт, то есть её нет.
Продавец живёт не четыре месяца, а годы, и без бакета та же кривая уходит в сотни мегабайт —
а партиция это единица чтения и уплотнения ([`DATA_MODEL.md`](DATA_MODEL.md) §4).

**Механизм.** Бакет — это лишнее поле в составном ключе партиции
([`DATA_MODEL.md`](DATA_MODEL.md) §2): токен считается от пары `(seller_id, bucket)`, и смена месяца
переносит запись на другое место кольца. Платят за это на чтении — диапазон теперь пересекает
несколько партиций, и каждая читается отдельно:

```
$ cqlsh -e "TRACING ON; SELECT order_id FROM qfd_demo.seller_bucket
            WHERE seller_id=… AND bucket IN ('2025-01',…,'2025-05') LIMIT 20;"

 Executing single-partition query on seller_bucket    208
 Read 20 live rows and 0 tombstone cells              267
 … ещё четыре такие же пары …
 Request complete                                    1170   (мкс)
```

Пять чтений по 20 строк ради 20 строк ответа: `LIMIT` применяется к каждой партиции отдельно, слияние
делает координатор. Годовой отчёт при месячном бакете — двенадцать таких чтений.

Чего бакетирование **не** даёт: чтение «последних 20» из большой партиции не было медленнее
(1666 мкс против 1088 мкс из бакета) — свежие строки лежат в начале по порядку кластеризации. Бакет
спасает не этот запрос, а уплотнение, ремонт и память узла.

**Правило.** Ширину бакета считают от скорости записи, а не от календаря: целевой размер партиции в
единицы мегабайт разделите на измеренный размер строки и посмотрите, за какой срок столько заказов
набегает у самого крупного продавца.

## 4. Вторичные индексы: 2i против SAI

**Задача.** Поддержке нужен четвёртый запрос — «покажи заказы в статусе `SHIPPED`», десять раз в
день. Заводить ради него четвёртую таблицу не хочется.

**Наивное решение.** `CREATE INDEX ON orders_by_id (status)` — привычный индекс, как в РСУБД.

**Где ломается.** 2i — не структура внутри таблицы, а **отдельная скрытая таблица** в каталоге
базовой, и ключ партиции у неё — индексируемое значение. На 200 тыс. заказов с пятью различными
статусами получается таблица из пяти партиций:

```
$ nodetool tablestats qfd_demo.orders_by_id.orders_by_id_status_idx
        Table (index): orders_by_id.orders_by_id_status_idx
        SSTable count: 3
        Number of partitions (estimate): 5
        Compacted partition maximum bytes: 545791
```

Это проблема большой партиции ([`DATA_MODEL.md`](DATA_MODEL.md) §4), спрятанная внутрь индекса:
40 тыс. записей в одной партиции при 200 тыс. строк таблицы, и дальше линейно от объёма данных на
узле — чем ниже кардинальность колонки, тем хуже. Обратите внимание и на `SSTable count: 3` при одном
SSTable у базовой таблицы после `nodetool compact`: индекс живёт своей жизнью и уплотняется отдельно.

**Механизм SAI.** SAI ([Storage-Attached Indexing](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/indexing/sai/sai-concepts.html),
общедоступен с 5.0) хранит индекс **внутри того же набора файлов SSTable**, что и данные, — той же
генерации, с тем же жизненным циклом:

```
$ ls /var/lib/cassandra/data/qfd_demo/orders_sai-<id>/
nb-6-big-Data.db
nb-6-big-SAI+aa+orders_sai_status_idx+TermsData.db
nb-6-big-SAI+aa+orders_sai_status_idx+PostingLists.db
nb-6-big-SAI+aa+orders_sai_total_idx+BalancedTree.db
```

Отсюда три следствия. Индекс строится при сбросе на диск и при уплотнении вместе с данными и с ними
же исчезает — отдельной таблицы, которая разъедется с базовой, просто нет. Под каждый тип колонки
своя структура: у текстовой — термы и списки вхождений
([`../../system-design/theory/INVERTED_INDEX.md`](../../system-design/theory/INVERTED_INDEX.md)), у
числовой — сбалансированное дерево, поэтому SAI умеет неравенства. И пересечение предикатов SAI
считает сам, без `ALLOW FILTERING`, — 2i на том же запросе отказывает:

```
$ cqlsh -e "SELECT order_id FROM qfd_demo.orders_sai WHERE status='SHIPPED' AND total_cents > 150000;"
 (5 rows)
$ cqlsh -e "SELECT order_id FROM qfd_demo.orders_by_id WHERE status='SHIPPED' AND total_cents > 150000;"
InvalidRequest: … "Cannot execute this query as it might involve data filtering …"
```

**Чего не даёт ни один из них.** Ни 2i, ни SAI не превращают запрос без ключа партиции в адресное
чтение. В трассировке обоих одно и то же начало — `Computing ranges to query` и `Submitting range
requests on 17 ranges`: координатор обходит кольцо диапазон за диапазоном. На одном узле это дёшево;
на кластере из тридцати узлов запрос трогает все тридцать, и его стоимость растёт с размером
кластера, а не с числом найденных строк.

**Правило.** Индекс в Cassandra — инструмент уточнения, а не поиска: он хорош, когда ключ партиции
известен и надо отсечь строки внутри неё, и терпим для редких административных запросов. Запрос,
который приложение делает на каждый показ страницы, обслуживается таблицей из §1. Если индекс всё же
нужен — в 5.0 берите SAI.

## 5. Материализованные представления: выключены по умолчанию в 5.0

**Задача.** Писать три проекции руками, как в §2, — это код, который легко забыть обновить. Пусть
проекцию держит сама база.

**Наивное решение.** `CREATE MATERIALIZED VIEW`: описываем `orders_by_status` поверх
`orders_by_id`, и дальше «обновления базовой таблицы вызывают соответствующие обновления
представления» ([CQL / Materialized Views](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/mvs.html)).

**Где ломается.** На чистой 5.0.9 запрос не выполняется вовсе:

```
$ cqlsh -e "CREATE MATERIALIZED VIEW qfd_demo.orders_by_status AS SELECT * FROM qfd_demo.orders_by_id
            WHERE status IS NOT NULL AND order_id IS NOT NULL PRIMARY KEY ((status), order_id);"
InvalidRequest: code=2200 [Invalid query] message="Materialized views are disabled.
Enable in cassandra.yaml to use."
```

**Механизм.** Выключены они не случайно и не «пока не доделали». В
[`cassandra.yaml`](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
параметр `materialized_views_enabled: false` стоит в секции, названной прямым текстом:

```
#########################
# EXPERIMENTAL FEATURES #
#########################

# Enables materialized view creation on this node.
# Materialized views are considered experimental and are not recommended for production use.
materialized_views_enabled: false
```

Причина — та же, что в §2, только спрятанная от глаз. Строка представления живёт в другой партиции,
то есть на других узлах, чем строка базовой таблицы, и её обновление — отдельная мутация по сети.
Соседний параметр того же файла описывает, чем это кончается: «in extreme situations (losing >
quorum # nodes in a replica set), you may have data in your SSTables that never makes it to the
Materialized View». Расхождение между базой и представлением возможно, обнаружить его нечем, а кода,
который его починил бы, вы не писали — его написала база.

**Правило.** На собеседовании ответ звучит так: денормализацию делаем сами, как в §2, потому что
рассогласование проекций всё равно возможно, и лучше, когда за него отвечает свой код с известной
процедурой восстановления, чем механизм, выключенный в поставке по умолчанию.

## 6. `ALLOW FILTERING`: что сервер реально делает

**Задача.** Запрос из §1 отвергнут с подсказкой «use ALLOW FILTERING». Подсказка от сервера — значит,
так и надо?

**Наивное решение.** Дописать. На тестовой базе запрос отрабатывает мгновенно, тесты зелёные.

**Где ломается.** Две таблицы одной схемы и без индексов — на 5 тыс. строк и на 200 тыс. строк;
в ответе в обоих случаях ровно 20 строк:

```
таблица 5 тыс. строк:    Read 5000 live rows      Request complete     7006 мкс
таблица 200 тыс. строк:  Read 200000 live rows    Request complete   164337 мкс
```

Число отданных строк не изменилось, а время выросло в 23 раза: стоимость запроса определяется
размером таблицы, а не размером ответа. На тестовых данных это неотличимо от нормального запроса.

**Механизм.** Видно в трассировке того же запроса на 200 тыс. строк:

```
Computing ranges to query                                                             208
Submitting range requests on 17 ranges with a concurrency of 1 (11260.8 rows per range expected)
Executing seq scan across 1 sstables for (min(-9223372036854775808), min(…)]           997
Read 200000 live rows and 0 tombstone cells                                        164078
```

Кольцо режется на диапазоны токенов, по каждому идёт последовательный проход по SSTable, строки
читаются целиком и отбрасываются на месте. `ALLOW FILTERING` — не режим и не оптимизация, а согласие
клиента на такую работу; сервер честно называет её «unpredictable performance».

**Формулировка, которая хорошо звучит и неверна.** «`ALLOW FILTERING` означает полное сканирование».
Не означает: это разрешение, а не план. Если на колонке есть индекс, планировщик возьмёт индекс, и
`ALLOW FILTERING` просто не помешает — тот же запрос на таблице с 2i по `status` дал в трассировке
`Index mean cardinalities are orders_by_id_status_idx:13333. Scanning with orders_by_id_status_idx.`
и 1,8 мс вместо 164 мс. Вывод обратный успокоительному: по тексту запроса нельзя сказать, что он
делает, — смотрите трассировку.

**Правило.** `ALLOW FILTERING` допустим в одном случае: ключ партиции задан, и фильтр отсекает строки
**внутри** уже найденной партиции — тогда объём работы ограничен партицией (в прогоне ниже прочитана
вся партиция пользователя, 1014 строк, и ни строкой больше). Без ключа партиции тот же синтаксис
означает обход кольца, то есть отложенный инцидент, а не запрос.

```
$ cqlsh -e "TRACING ON; SELECT order_id FROM qfd_demo.orders_by_user
            WHERE user_id=00000000-…-045c AND status='SHIPPED' ALLOW FILTERING;"

 Executing single-partition query on orders_by_user   1771
 Read 1014 live rows and 0 tombstone cells            3932
 Request complete                                     4038   (мкс)
```

## 7. Шпаргалка

**Порядок проектирования.** Экраны и API → список запросов → таблица на запрос → ключ партиции из
«что известно на входе», кластеризация из «в каком порядке нужен ответ» → бакет, если партиция
растёт без границы.

| Задача | Инструмент | Цена |
|---|---|---|
| новый шаблон доступа | новая таблица | ещё одна мутация на запись, ручная согласованность |
| партиция растёт без границы | бакет в ключе партиции | N чтений на диапазон, слияние в координаторе |
| редкий запрос по неключевой колонке, ключ партиции известен | `ALLOW FILTERING` | чтение всей партиции |
| редкий запрос по неключевой колонке, ключа нет | SAI | опрос всех узлов диапазона |
| частый запрос по неключевой колонке | таблица, а не индекс | см. первую строку |

| | 2i (`CREATE INDEX`) | SAI (`USING 'sai'`) |
|---|---|---|
| где живёт | скрытая таблица, ключ партиции = значение | файлы внутри SSTable той же генерации |
| низкая кардинальность | большая партиция внутри индекса | нет отдельной партиции |
| несколько предикатов | требует `ALLOW FILTERING` | пересекает сам |
| неравенства | нет | да (дерево по числовой колонке) |
| видимость в метриках | как у обычной таблицы | блок `SAI …` в `nodetool tablestats` |
| опрос кольца | не отменяет | не отменяет |

### Формулировки для собеседования

- «Таблица в Cassandra — материализованный ответ на один запрос; сколько запросов, столько таблиц.»
- «Денормализация здесь — N независимых мутаций, а не транзакция: расхождение проекций чинит повтор
  операции, а не `nodetool repair`.»
- «`ALLOW FILTERING` — не план, а разрешение; что запрос делает, показывает трассировка.»
- «Индекс уточняет внутри партиции; по кольцу он ходить не перестаёт — стоимость растёт с размером
  кластера, а не ответа.»
- «Материализованные представления в 5.0 выключены в поставке — это и есть ответ, почему
  денормализуем руками.»

## Упражнения

- [`../exercises/ex01_order_history/README.md`](../exercises/ex01_order_history/README.md) —
  спроектировать схему под три запроса истории заказов и обосновать каждый ключ (§1, §2).
- [`../exercises/ex02_partition_sizing/README.md`](../exercises/ex02_partition_sizing/README.md) —
  посчитать размер партиции продавца и выбрать ширину бакета от скорости записи (§3).

## Источники

- Apache Cassandra 5.0 Documentation, [Data Modeling / Defining Application Queries](https://cassandra.apache.org/doc/stable/cassandra/developing/data-modeling/data-modeling_queries.html)
  — порядок «сначала запросы, потом таблицы» как официальная методика.
- Apache Cassandra 5.0 Documentation, [Data Modeling / Logical Data Modeling](https://cassandra.apache.org/doc/stable/cassandra/developing/data-modeling/data-modeling_logical.html)
  — правило «таблица на запрос» и вывод ключа партиции из шаблона доступа.
- Apache Cassandra 5.0 Documentation, [Data Modeling / Evaluating and Refining Data Models](https://cassandra.apache.org/doc/stable/cassandra/developing/data-modeling/data-modeling_refining.html)
  — оценка размера партиции и бакетирование как приём.
- Apache Cassandra 5.0 Documentation, [CQL / Data Manipulation](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/dml.html)
  — `ALLOW FILTERING` и формулировка про непредсказуемую производительность.
- Apache Cassandra 5.0 Documentation, [CQL / Secondary Indexes](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/indexes.html)
  — 2i: создание, ограничения, отношение к базовой таблице.
- Apache Cassandra 5.0 Documentation, [CQL / Storage-Attached Indexing: Concepts](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/indexing/sai/sai-concepts.html)
  — что SAI хранит вместе с SSTable и какие предикаты поддерживает.
- Apache Cassandra 5.0 Documentation, [CQL / Materialized Views](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/mvs.html)
  — семантика представления и его связь с базовой таблицей.
- Apache Cassandra 5.0 Documentation, [Configuring cassandra.yaml](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
  — `materialized_views_enabled` и секция экспериментальных возможностей.
- Apache Cassandra 5.0 Documentation, [nodetool tablestats](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/tablestats.html)
  — поля `Number of partitions`, `Compacted partition maximum bytes`, блок метрик SAI.
- Проверено на Apache Cassandra 5.0.9, одноузловой кластер; выводы команд в тексте — реальные.
