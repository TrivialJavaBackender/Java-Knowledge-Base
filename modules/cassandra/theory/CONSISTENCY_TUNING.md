# Настройка согласованности: какой кворум и чей

> **Какую проблему решает.** История заказов маркетплейса живёт в двух дата-центрах, и чтение
> обязано пережить потерю одного из них целиком. Уровень согласованности задаётся на каждый
> запрос, и цена ошибки несимметрична: слишком слабый уровень тихо отдаёт устаревший заказ,
> слишком сильный — превращает потерю дальнего ДЦ в полный отказ сервиса в ближнем.
> **Кому это надо.** Тому, кто пишет `session.execute(...)` и обязан назвать уровень явно; тому,
> кто дежурит и видит в логе `Cannot achieve consistency level QUORUM` при живом локальном ДЦ.
> **Когда НЕ надо.** Уровень согласованности не делает запись атомарной и не разрешает гонку двух
> писателей: при равных условиях побеждает большая метка времени
> ([`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §3), сколько бы реплик ни ответило. Задача «двое не
> должны зарезервировать последний экземпляр» решается не уровнем, а условной записью (§5), и
> стоит на порядок дороже.

**Границы с соседями.** Здесь арифметика кворума только применяется: сама формула `R + W > N`,
CAP и PACELC — в [`distributed_systems.md`](../../system-design/theory/distributed_systems.md),
протокол Paxos — в [`CONSENSUS.md`](../../system-design/theory/CONSENSUS.md), устройство
Merkle-дерева — в [`MERKLE_TREE.md`](../../system-design/theory/MERKLE_TREE.md), обнаружение узлов
через gossip — в [`GOSSIP_PROTOCOL.md`](../../system-design/theory/GOSSIP_PROTOCOL.md). Где
физически лежат реплики и откуда берётся имя ДЦ — [`CLUSTER_TOPOLOGY.md`](CLUSTER_TOPOLOGY.md).

Прогоны выполнены на **одноузловом** Apache Cassandra 5.0.9 (`cassandra:5.0`, контейнер
`cass-theory`, `datacenter1`/`rack1`); там, где нужен второй ДЦ, это оговорено и подпёрто
документацией. Дальше первого раза команда сокращена до `cqlsh …`.

---

## 1. Префиксы `LOCAL_` и `EACH_`: чей именно кворум считаем

**Задача.** Keyspace маркетплейса реплицируется по трём узлам в каждом из двух дата-центров.
Клиент пишет заказ на уровне `QUORUM`. Сколько реплик должно подтвердить запись?

**Наивный ответ.** Кворум от трёх — это две.

**Где ломается.** `QUORUM` не знает о дата-центрах вовсе: `N` для него — сумма фактора репликации
по всем перечисленным ДЦ, то есть 3 + 3 = 6, а кворум от шести — четыре. Проверяется на
одноузловом кластере: keyspace с тем же суммарным `N` даёт ровно это число в ответе сервера.

```
$ docker exec cass-theory cqlsh -e "CREATE KEYSPACE cons_rf6 WITH replication =
    {'class':'NetworkTopologyStrategy','datacenter1':6};
    CREATE TABLE cons_rf6.t (k int PRIMARY KEY, v text);"
Warnings :
Your replication factor 6 for keyspace cons_rf6 is higher than the number of nodes 1 for datacenter datacenter1

$ cqlsh -e "CONSISTENCY QUORUM; SELECT * FROM cons_rf6.t LIMIT 1;"
Unavailable: message="Cannot achieve consistency level QUORUM"
  info={'consistency': 'QUORUM', 'required_replicas': 4, 'alive_replicas': 1}

$ cqlsh -e "CONSISTENCY ALL; SELECT * FROM cons_rf6.t LIMIT 1;"
  info={'consistency': 'ALL', 'required_replicas': 6, 'alive_replicas': 1}
```

Четыре из шести — значит, при двух ДЦ по RF=3 ни один ДЦ не способен набрать `QUORUM` в одиночку:
у него всего три реплики.

**Механизм.** Префикс отвечает на вопрос «чей кворум», и ответов ровно три, а не три градации
одного числа.

`LOCAL_` — большинство реплик **в ДЦ координатора**; ответы чужих ДЦ не ожидаются вовсе:
«A majority of the replicas in the local datacenter (whichever datacenter the coordinator is in)
must respond» (документация Apache Cassandra 5.0, Dynamo → Tunable Consistency). Это не «половина
от `QUORUM`»: на том же keyspace, где все шесть реплик лежат в одном ДЦ, `LOCAL_QUORUM` требует
те же четыре.

```
$ cqlsh -e "CONSISTENCY LOCAL_QUORUM; SELECT * FROM cons_rf6.t LIMIT 1;"
  info={'consistency': 'LOCAL_QUORUM', 'required_replicas': 4, 'alive_replicas': 1}
```

`EACH_` — большинство **в каждом ДЦ по отдельности**, и сервер называет виновный ДЦ прямо в
сообщении:

```
$ cqlsh -e "CONSISTENCY EACH_QUORUM; SELECT * FROM cons_rf3.t LIMIT 1;"
Unavailable: message="Cannot achieve consistency level EACH_QUORUM in DC datacenter1"
  info={'consistency': 'EACH_QUORUM', 'required_replicas': 2, 'alive_replicas': 0}
```

Во всех трёх случаях координатор сравнивает требуемое число с числом живых реплик **до** отправки
запроса: `Unavailable` — отказ по арифметике, а не по таймауту, и именно этим отличается от
`WriteTimeout` («реплики есть, но не ответили»).

**Правило.** Читая `QUORUM` в коде, подставляйте не фактор репликации одного ДЦ, а их сумму.

### Формулировка, которая хорошо звучит и неверна

**«`EACH_QUORUM` работает только на запись».** В 5.0.9 это не так: чтение на `EACH_QUORUM`
выполняется и падает по недостатку реплик, а не по недопустимому уровню (см. вывод выше — это
`Unavailable`, а не `InvalidRequest`). Уровень, который действительно отвергается на чтении, —
`ANY`:

```
$ cqlsh -e "CONSISTENCY ANY; SELECT * FROM cons_demo.stock LIMIT 1;"
InvalidRequest: code=2200 [Invalid query] message="ANY ConsistencyLevel is only supported for writes"
```

`ANY` стоит особняком и по смыслу: он засчитывает запись, для которой не ответила ни одна реплика,
лишь бы координатор успел сохранить hint (§3).

---

## 2. Почему `LOCAL_QUORUM` — рабочий выбор для двух дата-центров

**Задача.** Маркетплейс стоит в `dc_eu` (основной трафик) и `dc_us`, keyspace создан как
`{'class': 'NetworkTopologyStrategy', 'dc_eu': 3, 'dc_us': 3}`. Требование бизнеса одно: чтение
истории заказов обязано работать при полной потере любого из ДЦ.

**Наивный ответ.** `QUORUM` — это же большинство, значит надёжно.

**Где ломается.** Большинство здесь считается от шести (§1), то есть четыре, а живой `dc_eu`
располагает тремя репликами. Требование «пережить потерю ДЦ» и уровень `QUORUM` несовместимы
арифметически: каждое чтение в уцелевшем ДЦ ответит `Unavailable, required_replicas: 4`. Выбор
`QUORUM` не смягчает потерю дальнего ДЦ, а превращает её в полный отказ ближнего. `EACH_QUORUM` и
`ALL` отпадают по той же причине, только очевиднее: оба ждут ответа именно от потерянных узлов.

**Механизм.** `LOCAL_QUORUM` при RF=3 в своём ДЦ требует две реплики, и это число не зависит от
состояния соседнего ДЦ — в подсчёт входят только реплики координатора:

```
$ cqlsh -e "CONSISTENCY LOCAL_QUORUM; SELECT * FROM cons_rf3.t LIMIT 1;"
Unavailable: message="Cannot achieve consistency level LOCAL_QUORUM"
  info={'consistency': 'LOCAL_QUORUM', 'required_replicas': 2, 'alive_replicas': 1}
```

Keyspace `cons_rf3` — RF=3 в одном ДЦ; операция не проходит, потому что жив один узел из трёх, но
требуемое число видно, и оно равно двум, а не четырём (сам двухдатацентровый прогон на одном узле
невоспроизводим). Подставьте эту двойку в `R + W > N`
([`distributed_systems.md`](../../system-design/theory/distributed_systems.md)), взяв за `N` фактор
репликации **одного** ДЦ: `2 + 2 > 3`. Внутри `dc_eu` читатель гарантированно видит собственную
запись, и запас переживает смерть одного локального узла заодно с потерей всего `dc_us`.

**Чего `LOCAL_QUORUM` не даёт.** Ничего между ДЦ: запись, подтверждённая двумя репликами `dc_eu`,
уезжает в `dc_us` без ожидания ответа. Поэтому уровень работает только вместе с привязкой клиента к
своему ДЦ ([`DRIVER_AND_APP.md`](DRIVER_AND_APP.md) §5) — пользователь, которого балансировщик
перекинул в другой регион, читает историю без гарантии «увижу свою запись».

**Правило.** Требование «пережить потерю ДЦ» и любой уровень без префикса `LOCAL_` —
взаимоисключающие пункты; спорить с этим будет арифметика, а не Cassandra.

---

## 3. Hinted handoff: что чинит и где обрывается гарантия

**Задача.** Одну из трёх реплик `dc_eu` увели на обновление на десять минут. Запись на
`LOCAL_QUORUM` всё это время проходит — двух живых хватает. Что происходит с пропущенными
мутациями, когда третья реплика возвращается?

**Наивный ответ.** Догонит сама, репликация же асинхронная.

**Где ломается.** Догоняет не «репликация вообще», а отдельный механизм с конкретным окном, и за
его границей не догоняет ничего. Координатор, не дождавшись ответа недоступной реплики, кладёт
hint — отложенную мутацию — себе на локальный диск:

```
$ docker exec cass-theory grep -nE 'hinted_handoff_enabled|max_hint_window|hinted_handoff_throttle' \
    /etc/cassandra/cassandra.yaml
68:hinted_handoff_enabled: true
80:max_hint_window: 3h
88:hinted_handoff_throttle: 1024KiB

$ docker exec cass-theory nodetool statushandoff
Hinted handoff is running
```

**Механизм.** Вернувшаяся реплика получает накопленное и догоняет — но только если уложилась в
окно, и отсчитывается оно не от возврата, а от момента, когда узел признан мёртвым. Комментарий над
параметром говорит об этом прямо (`cassandra.yaml:75–78`): «this defines the maximum amount of time
a dead host will have hints generated. After it has been dead this long, new hints for it will not
be created until it has been seen alive and gone down again». Десять минут — внутри трёх часов,
значит наш сценарий закрывается hint целиком. Реплика, лежавшая четыре часа, получит hint за первые
три и **ничего** за четвёртый: на живых репликах эти мутации есть, на вернувшейся их не будет, пока
не пройдёт `nodetool repair` (§4).

**Чего hinted handoff не делает.** Не даёт гарантии даже внутри окна: «Hints are best effort,
however, and do not guarantee eventual consistency like anti-entropy repair does» (документация
Apache Cassandra 5.0, Operating → Hints). Hint лежит на диске координатора и исчезает вместе с ним.

**Правило.** Hint сокращает длительность расхождения, а не отвечает за его устранение; узел,
пролежавший дольше `max_hint_window`, обязан пройти repair перед тем, как его начнут читать.

---

## 4. Read repair против `nodetool repair`: чинят разные вещи

**Задача.** Продолжение §3: реплика пролежала четыре часа, окно hint закрыто. Пользователь
открывает «последние 20 заказов» и видит их полностью и правильно.

**Наивный вывод.** Раз прочиталось верно — данные сошлись.

**Где ломается.** Сошлось ровно то, что прочитали. Read repair — не отдельная операция, а свойство
пути чтения самой таблицы, и оно видно в её описании:

```
$ cqlsh -e "DESCRIBE TABLE cons_demo.orders_by_user;" | grep read_repair
    AND read_repair = 'BLOCKING'
```

**Механизм.** Координатор и так опрашивает несколько реплик — столько, сколько требует уровень
(§1), — расхождение обнаруживает бесплатно и досылает отстающим правильные значения; `BLOCKING`
означает, что ответ клиенту уйдёт только после подтверждения досылки. Отсюда обе границы механизма
сразу: чинятся **только прочитанные ключи** и **только опрошенные реплики**. Партиция пользователя,
не заходившего месяц, останется расходящейся ровно столько, сколько её не читают.

`nodetool repair` решает обратную задачу — обходит диапазон токенов целиком независимо от того,
читал его кто-нибудь: реплики строят Merkle-деревья по общим диапазонам
([`MERKLE_TREE.md`](../../system-design/theory/MERKLE_TREE.md)) и передают потоком различия. Это
намеренная и дорогая операция с собственным расписанием:

```
$ docker exec cass-theory nodetool help repair        # фрагмент раздела OPTIONS
        -full, --full
            Use -full to issue a full repair.

        -local, --in-local-dc
            Use -local to only repair against nodes in the same datacenter

        -pr, --partitioner-range
            Use -pr to repair only the first range returned by the partitioner
```

Срок задаётся не удобством, а `gc_grace_seconds` (по умолчанию десять суток,
[`COMPACTION.md`](COMPACTION.md) §4): «At a minimum, repair should be run often enough that the gc
grace period never expires on unrepaired data. Otherwise, deleted data could reappear»
(документация Apache Cassandra 5.0, Operating → Repair) — пропущенный цикл воскрешает удалённые
заказы.

**Правило.** Read repair — это гигиена горячих данных; сходимость холодных обеспечивает только
запланированный `nodetool repair`, и его период должен быть меньше `gc_grace_seconds`.

### Формулировка, которая хорошо звучит и неверна

**«Read repair срабатывает с вероятностью 10 процентов, это настраивается через
`read_repair_chance`».** Вероятностного read repair в Cassandra 5.0 нет, как нет и самих
параметров — их убрали в 4.0. Настройка одна, и значений у неё ровно два:

```
$ cqlsh -e "ALTER TABLE cons_demo.stock WITH read_repair_chance = 0.1;"
SyntaxException: Unknown property 'read_repair_chance'

$ cqlsh -e "ALTER TABLE cons_demo.stock WITH read_repair = 'ASYNC';"
Server error: java.lang.IllegalArgumentException:
  No enum constant org.apache.cassandra.service.reads.repair.ReadRepairStrategy.ASYNC
```

Подтверждение в байт-коде: у перечисления `ReadRepairStrategy` ровно две константы, `NONE` и
`BLOCKING` (`javap -p` по `apache-cassandra-5.0.9.jar`).

---

## 5. Условная запись: цена в раундах и когда без неё не обойтись

**Задача.** Остался один экземпляр товара, и двое одновременно нажимают «зарезервировать».
Обычная запись примет обе, обоим ответит успехом, а разрешение по метке времени оставит ту, что
пришла позже ([`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §3). Нужен `INSERT ... IF NOT EXISTS` —
условная запись (LWT, lightweight transaction).

**Наивный ответ.** Та же запись плюс дешёвая проверка; а если условие не выполнилось, сервер
отвечает `false` сразу и почти бесплатно.

**Где ломается — дважды.** Во-первых, одна условная запись — это три стадии согласования и четыре
дозаписи в commitlog вместо одной (трассировка сокращена до опорных строк, последняя колонка —
`source_elapsed`, микросекунды):

```
$ cqlsh -e "TRACING ON; INSERT INTO cons_demo.stock (item_id, reserved_by)
            VALUES ('sku-42','user-1') IF NOT EXISTS;"
 [applied] = True

 Promising ballot 08284ab2-ae24-11f1-51fc-38240da1898a                 |  8574
 Appending to commitlog / Adding to paxos memtable                     |  9052
 Reading existing values for CAS precondition                          | 11814
 CAS precondition is met; proposing client-requested updates for 0828… | 13516
 Accepting proposal Accepted(140084533204110002:08284ab2-…)            | 14263
 Committing proposal Committed(140084533204110002:08284ab2-…)          | 17093
 Appending to commitlog / Adding to stock memtable                     | 17123
 CAS applied successfully                                              | 18274
 Request complete                                                      | 18327
```

Обычная запись в ту же таблицу занимает семь строк трассировки и одну дозапись в commitlog:
`Determining replicas for mutation | 867`, `Appending to commitlog | 1094`,
`Adding to stock memtable | 1134`, `Request complete | 1229`. Разница после прогрева, по три
прогона каждого вида (`source_elapsed` строки `Request complete`, микросекунды):

```
LWT    5252 / 3258 / 4152
обычная 253 /  320 /  280
```

Это не бенчмарк, а порядок величин, и снят он на **одном узле**, где сети нет вовсе: на реальном
кластере к каждой стадии добавляется сетевой круг до кворума реплик.

Во-вторых, отказ стоит столько же, сколько успех. Тот же запрос на уже занятый ключ:

```
 CAS precondition does not match current values [cons_demo.stock] key=lwt-cnt …  | 3295
 Accepting proposal Accepted(140084533589610002:1f228e12-…, …:key=lwt-cnt)       | 3935
 CAS did not apply                                                               | 4128
 Request complete                                                                | 4289
```

4289 микросекунд против 4152 у сработавшей: раунд выполняется целиком, и предложение всё равно
принимается — только пустое, без единой колонки (в строке `Accepted` от записи остался один ключ).
Цикл «при `false` попробовать следующий экземпляр» платит полную цену на каждой итерации.

**Механизм.** Уровень согласованности записи к фазе согласования отношения не имеет — у неё свой,
отдельный:

```
$ cqlsh -e "CONSISTENCY ONE; INSERT INTO cons_rf6.t (k,v) VALUES (9,'x') IF NOT EXISTS;"
Unavailable: message="Cannot achieve consistency level QUORUM"
  info={'consistency': 'QUORUM', 'required_replicas': 4, 'alive_replicas': 1}

$ cqlsh -e "SERIAL CONSISTENCY LOCAL_SERIAL;
            INSERT INTO cons_rf6.t (k,v) VALUES (10,'x') IF NOT EXISTS;"
Unavailable: message="Cannot achieve consistency level LOCAL_QUORUM"
  info={'consistency': 'LOCAL_QUORUM', 'required_replicas': 4, 'alive_replicas': 1}
```

Клиент попросил `ONE` — сервер потребовал `QUORUM`, хотя обычный `INSERT` на `ONE` в тот же
keyspace проходит. Значение по умолчанию `SERIAL` считает кворум по всем ДЦ (§1), то есть в
мультирегионе каждая стадия уходит за океан; `LOCAL_SERIAL` возвращает согласование в свой ДЦ — и
вместе с задержкой убирает саму защиту: два ДЦ независимо зарезервируют один экземпляр.

**Как прочитать результат.** Обычное чтение может застать раунд между «принято» и «закоммичено» и
не увидеть исхода; чтению, которому нужен результат именно этой операции, задают
`SERIAL`/`LOCAL_SERIAL` — оно дочитывает незавершённые раунды за свой счёт. Сама условная запись
ограничена одной партицией ([`WHY_CASSANDRA.md`](WHY_CASSANDRA.md) §4): договориться о двух заказах
разных пользователей она не может в принципе.

**Правило.** `IF NOT EXISTS` — не условие в `WHERE`, а согласование: считайте его на порядок
дороже обычной записи даже без конкуренции и держите на единицах процентов трафика.

---

## 6. Шпаргалка

Два ДЦ, RF=3 в каждом (`N` суммарный = 6, `N` локальный = 3):

| Что требует задача | Запись | Чтение | Требуется реплик |
|---|---|---|---|
| пережить потерю ДЦ, «увижу свою запись» в своём ДЦ | `LOCAL_QUORUM` | `LOCAL_QUORUM` | 2 + 2 из 3 локальных |
| лента, где отставание в секунды допустимо, задержка критична | `LOCAL_QUORUM` | `LOCAL_ONE` | 2 и 1 |
| подтверждение видно во всех ДЦ сразу после ответа | `EACH_QUORUM` | `LOCAL_QUORUM` | 2 в каждом ДЦ |
| единственность значения (резерв экземпляра) | `IF NOT EXISTS` | `SERIAL` / `LOCAL_SERIAL` | кворум на каждую стадию |
| «лишь бы не потерять», согласованность не нужна | `ANY` (hint считается) | — | 0 |

Значения по умолчанию Apache Cassandra 5.0.9, снятые с `cass-theory`:

| Параметр | Значение | Где смотреть |
|---|---|---|
| `hinted_handoff_enabled` | `true` | `cassandra.yaml:68` |
| `max_hint_window` | `3h` | `cassandra.yaml:80` |
| `read_repair` (на таблицу) | `BLOCKING`; второе и последнее значение — `NONE` | `DESCRIBE TABLE` |
| `gc_grace_seconds` | `864000` (10 суток) — верхняя граница периода repair | `DESCRIBE TABLE` |
| serial consistency | `SERIAL` (кворум по всем ДЦ) | `SERIAL CONSISTENCY` в cqlsh |

### Формулировки для собеседования

- «`QUORUM` считает `N` как сумму RF по всем ДЦ, поэтому при двух ДЦ по RF=3 ему нужно четыре
  ответа — и ни один ДЦ в одиночку столько не даст.»
- «`LOCAL_QUORUM` — это не половина `QUORUM`, а большинство фактора репликации ДЦ координатора.»
- «Hinted handoff сокращает длительность расхождения, но гарантию сходимости даёт только repair,
  и его период обязан быть короче `gc_grace_seconds`.»
- «Read repair чинит то, что читают; холодные партиции чинит только `nodetool repair`.»
- «Условная запись не смотрит на уровень записи: согласование идёт по serial consistency, и
  несработавшая условная запись стоит столько же, сколько сработавшая.»

## Упражнения

- [`ex04_consistency`](../exercises/ex04_consistency/README.md) — четыре сценария маркетплейса и
  два ДЦ: назвать уровень чтения и записи для каждого, показать арифметику `R + W > N` и сказать,
  что произойдёт при полной потере одного ДЦ. Прямое применение §1, §2 и §5.
- [`ex06_diagnose`](../exercises/ex06_diagnose/README.md) — разбор инцидента, где встречаются и
  `Unavailable`, и последствия пропущенного repair.

## Источники

- Apache Cassandra 5.0 Documentation, [Architecture / Dynamo](https://cassandra.apache.org/doc/stable/cassandra/architecture/dynamo.html)
  — Tunable Consistency (определения `QUORUM`, `LOCAL_QUORUM`, `EACH_QUORUM`) и Replica
  Synchronization.
- Apache Cassandra 5.0 Documentation, [Operating / Hints](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/hints.html)
  — что такое hint, окно `3 h`, «Hints are best effort … do not guarantee eventual consistency like
  anti-entropy repair does».
- Apache Cassandra 5.0 Documentation, [Operating / Repair](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/repair.html)
  — полный против инкрементального; «repair should be run often enough that the gc grace period
  never expires on unrepaired data».
- Apache Cassandra 5.0 Documentation, [nodetool repair](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/repair.html)
  — ключи `-full`, `-pr`, `-local`, `-dc`.
- Apache Cassandra 5.0 Documentation, [Configuring / cassandra.yaml](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
  — `hinted_handoff_enabled`, `max_hint_window`, `hinted_handoff_throttle`.
- Apache Cassandra 5.0 Documentation, [CQL / Data Definition](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/ddl.html)
  — табличная настройка `read_repair` и `gc_grace_seconds`.
- Apache Cassandra 5.0 Documentation, [CQL / Data Manipulation](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/dml.html)
  — условная запись `IF NOT EXISTS` и её ограничение одной партицией.
- Apache Cassandra 5.0 Documentation, [Tools / cqlsh](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/cqlsh.html)
  — команды `CONSISTENCY` и `SERIAL CONSISTENCY`, которыми сняты прогоны выше.

Проверено на одноузловом Apache Cassandra 5.0.9 (образ `cassandra:5.0`): все выводы `cqlsh`,
`nodetool` и трассировок в блоках выше — из реальных прогонов; двухдатацентровые сценарии на таком
стенде невоспроизводимы и подпёрты документацией, о чём сказано по месту.
