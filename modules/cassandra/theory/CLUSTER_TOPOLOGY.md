# Топология кластера: кольцо, стратегия, снитч

> **Какую проблему решает.** История заказов маркетплейса выросла, узлов надо добавить, а к
> существующему дата-центру — пристроить второй, потому что чтение обязано пережить потерю любого
> из них. Здесь разобрано, что при этом физически двигается по сети, откуда Cassandra берёт само
> понятие «дата-центр» и почему новый ДЦ после запуска узлов ещё несколько часов пуст.
> **Кому это надо.** Тому, кто планирует расширение и должен назвать цену в переданных байтах;
> тому, кто читает `nodetool status` при разборе инцидента и должен понимать каждую колонку.
> **Когда НЕ надо.** Один дата-центр и меньше десятка узлов — почти все решения этого файла уже
> приняты умолчаниями, и трогать `num_tokens` или снитч без причины вредно: токены раздаются узлу
> при первом запуске, а имя ДЦ намертво вшито в определения всех keyspace (§2).

**Границы с соседями.** Сам приём «кольцо вместо остатка от деления» разобран в
[`DISTRIBUTED_CACHING.md`](../../caching-deep-dive/theory/DISTRIBUTED_CACHING.md); здесь — что
из него сделали в Cassandra. Репликация без ведущего узла как класс —
[`REPLICATION.md`](../../databases/theory/REPLICATION.md) §6; протокол gossip —
[`GOSSIP_PROTOCOL.md`](../../system-design/theory/GOSSIP_PROTOCOL.md); active-active между
регионами как архитектурный выбор —
[`MULTI_REGION.md`](../../system-design/theory/MULTI_REGION.md). Почему при двух ДЦ берут
`LOCAL_QUORUM` — [`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §2; что делает координатор с
запросом после того, как нашёл реплики, — [`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §1–§2.

Прогоны выполнены на **одноузловом** Apache Cassandra 5.0.9 (`cassandra:5.0`, контейнер
`cass-theory`); операции с несколькими узлами и ДЦ на нём невоспроизводимы — это оговорено в
каждом таком месте. Дальше первого раза команда сокращена до `cqlsh …` и `nodetool …`.

---

## 1. Кольцо токенов и vnodes: зачем узлу много токенов

**Задача.** 50 млн пользователей, и по ключу `user_id` нужно за один прыжок понять, какие узлы
хранят его заказы. Завтра узлов станет на три больше.

**Наивное решение.** Остаток от деления хеша на число узлов. Ломается на слове «завтра»: смена
делителя переставляет почти все ключи разом. Лечится это кольцом
([`DISTRIBUTED_CACHING.md`](../../caching-deep-dive/theory/DISTRIBUTED_CACHING.md)); интересно,
что именно из кольца сделали здесь.

**Механизм.** Ключ партиции хешируется в 64-битный **токен** — точку на кольце. Функция не
внутренняя, её видно прямо в CQL:

```
$ cqlsh -e "SELECT user_id, token(user_id) FROM cons_demo.orders_by_user;"
 bbbbbbb2-2222-2222-2222-222222222222 | 5598544330155404621
 aaaaaaa1-1111-1111-1111-111111111111 | 7400897248728540835
 cec37ad9-565e-44a3-8b7c-ffc2adab3b32 | 7603277611427995890

$ nodetool describecluster | head -5
Cluster Information:
	Name: theory
	Snitch: org.apache.cassandra.locator.SimpleSnitch
	DynamicEndPointSnitch: enabled
	Partitioner: org.apache.cassandra.dht.Murmur3Partitioner
```

Строки вернулись в порядке токена, а не вставки: кольцо — это и физический порядок хранения.

Если у узла один токен, он владеет дугой до следующего токена по часовой стрелке, и новый узел
режет ровно одну дугу: данные ему передаёт **один** сосед, у которого на время ввода удваивается
исходящий трафик. Vnodes убирают это узкое место — узлу выдают много токенов вразброс, и его
будущие диапазоны оказываются нарезаны у многих владельцев сразу:

```
$ nodetool status
Datacenter: datacenter1
=======================
Status=Up/Down
|/ State=Normal/Leaving/Joining/Moving
--  Address     Load       Tokens  Owns  Host ID                               Rack
UN  172.17.0.2  48.76 MiB  16      ?     28e4bd08-c549-4a58-9b3e-2549df2d7504  rack1

$ nodetool ring | grep -c '172.17.0.2'
16
```

Шестнадцать — умолчание **файла конфигурации** образа, а не кода: комментарий над параметром
`num_tokens` предупреждает, что без него было бы иначе — «If you leave this unspecified, Cassandra
will use the default of 1 token for legacy compatibility». Сами токены при этом не случайны, если
задан фактор репликации: соседний параметр `allocate_tokens_for_local_replication_factor: 3`
включает раскладку, которая «attempts to choose tokens in a way that optimizes replicated load over
the nodes in the datacenter for the replica factor» (оба — [`cassandra.yaml`](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
образа). Случайные шестнадцать точек на маленьком кластере дают перекос владения.

**Правило.** Число vnodes задаёт зернистость перемещения: чем их больше, тем ровнее размазан ввод
и вывод узла — и тем больше узлов задето каждой такой операцией.

---

## 2. `NetworkTopologyStrategy`: фактор репликации задаётся на каждый ДЦ отдельно

**Задача.** Keyspace маркетплейса должен держать по три реплики в каждом из двух ДЦ.

**Наивное решение.** `SimpleStrategy` с `replication_factor: 6`: шесть реплик, два ДЦ, выйдет по
три. Ломается потому, что `SimpleStrategy` о дата-центрах не знает — она берёт следующие шесть
владельцев по кольцу, и все шесть могут оказаться в одном ДЦ. Разницу видно даже в тексте
предупреждения: у `SimpleStrategy` в счёте фигурируют просто узлы, у `NetworkTopologyStrategy` —
узлы конкретного ДЦ.

```
$ cqlsh -e "CREATE KEYSPACE topo_simple WITH replication =
    {'class':'SimpleStrategy','replication_factor':6};"
Your replication factor 6 for keyspace topo_simple is higher than the number of nodes 1

$ cqlsh -e "CREATE KEYSPACE cons_rf3 WITH replication =
    {'class':'NetworkTopologyStrategy','datacenter1':3};"
Your replication factor 3 for keyspace cons_rf3 is higher than the number of nodes 1 for datacenter datacenter1
```

**Механизм.** `NetworkTopologyStrategy` получает не одно число, а карту «имя ДЦ → фактор
репликации», и обходит кольцо для каждого ДЦ независимо, пропуская стойки, в которых реплика уже
стоит: «If the number of racks is greater than or equal to the replication factor for the
datacenter, each replica is guaranteed to be chosen from a different rack» (документация Apache
Cassandra 5.0, Dynamo → NetworkTopologyStrategy). Отсюда практическое следствие: три стойки на ДЦ
при RF=3 дают гарантию, что падение стойки оставит две реплики из трёх — ровно `LOCAL_QUORUM`
([`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §2).

**Где ломается — дважды.** Во-первых, имя ДЦ здесь не свободный текст, а ключ, который должен
совпасть с тем, что сообщил снитч (§3). Опечатка или ещё не существующий ДЦ — не предупреждение,
а отказ:

```
$ cqlsh -e "CREATE KEYSPACE bad_dc WITH replication =
    {'class':'NetworkTopologyStrategy','datacenter1':3,'dc_us':3};"
ConfigurationException: Unrecognized strategy option {dc_us} passed to NetworkTopologyStrategy for keyspace bad_dc

$ cqlsh -e "CREATE KEYSPACE bad_dc2 WITH replication =
    {'class':'NetworkTopologyStrategy','dc-east':3};"
ConfigurationException: Unrecognized strategy option {dc-east} passed to NetworkTopologyStrategy for keyspace bad_dc2
```

Во-вторых — и это опаснее — фактор репликации больше числа живых узлов ДЦ сервер **не
запрещает**: он печатает предупреждение (см. блок выше) и создаёт keyspace. Запись и чтение в нём
пройдут только на `ONE`/`LOCAL_ONE`; любой кворум будет отвечать `Unavailable` до тех пор, пока
узлов не добавят ([`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §1). Предупреждение в выводе
`cqlsh` из скрипта миграции обычно никто не читает, а сервер ошибки не возвращает — поэтому
опечатку в числе замечают уже на нагрузке.

**Правило.** Фактор репликации в Cassandra — это всегда «сколько реплик **в каком** ДЦ»; число без
имени ДЦ означает, что топологию за вас выбрало кольцо.

---

## 3. Снитч: откуда берётся имя дата-центра

**Задача.** `NetworkTopologyStrategy` требует имя ДЦ и отвергает неизвестное (§2). Откуда сервер
знает, какие имена существуют?

**Наивный ответ.** Из файла [`cassandra-rackdc.properties`](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_rackdc_file.html) —
там прямо написано `dc=`.

**Где ломается.** На нашем стенде в файле написано одно, а узел сообщает другое — и стратегия
принимает версию узла, а не файла:

```
$ docker exec cass-theory grep -vE '^#|^$' /etc/cassandra/cassandra-rackdc.properties
dc=dc1
rack=rack1

$ cqlsh -e "SELECT data_center, rack FROM system.local;"
 data_center | rack
-------------+-------
 datacenter1 | rack1

$ cqlsh -e "CREATE KEYSPACE topo_bad WITH replication =
    {'class':'NetworkTopologyStrategy','dc1':3};"
ConfigurationException: Unrecognized strategy option {dc1} passed to NetworkTopologyStrategy for keyspace topo_bad
```

**Механизм.** Имя даёт **снитч** — компонент, отвечающий на вопрос «к какому ДЦ и стойке относится
этот адрес». Файл — не источник истины, а вход для того снитча, который настроен его читать:

```
$ nodetool describecluster | grep -i snitch
	Snitch: org.apache.cassandra.locator.SimpleSnitch
	DynamicEndPointSnitch: enabled
```

`SimpleSnitch` возвращает константы `datacenter1`/`rack1` и файл не открывает вовсе — отсюда
расхождение выше. Для продакшена конфиг рекомендует другой:
«GossipingPropertyFileSnitch — This should be your go-to snitch for production use. The rack and
datacenter for the local node are defined in cassandra-rackdc.properties and propagated to other
nodes via gossip» (комментарий в `cassandra.yaml` образа, над параметром `endpoint_snitch`). Слово
«propagated» здесь ключевое: имена ДЦ и стойки живут как обычные поля состояния узла и разъезжаются
по кластеру тем же механизмом, что и всё остальное
([`GOSSIP_PROTOCOL.md`](../../system-design/theory/GOSSIP_PROTOCOL.md)):

```
$ nodetool gossipinfo
/172.17.0.2
  STATUS:19:NORMAL,-1924883844938873586
  DC:9:datacenter1
  RACK:11:rack1
  RELEASE_VERSION:6:5.0.9
  HOST_ID:3:28e4bd08-c549-4a58-9b3e-2549df2d7504
  TOKENS:17:<hidden>
```

**Правило.** Снитч — единственный источник имён топологии, а имена вшиты в определение каждого
keyspace (§2): менять снитч на работающем кластере — это миграция схемы, а не правка конфига.

---

## 4. Координатор: роль на один запрос, а не выделенный узел

**Задача.** Клиент открыл соединение к одному из шести узлов и просит последние 20 заказов
пользователя. Этот узел вполне может не хранить его партицию вовсе.

**Наивный ответ.** Значит, в кластере есть узел-маршрутизатор, который знает, где что лежит.

**Где ломается.** Такого узла нет, и реестра узлов тоже нет: каждый знает о соседях из gossip (§3),
и эта таблица у него своя.

```
$ cqlsh -e "SELECT peer, data_center, rack, host_id FROM system.peers;"
 peer | data_center | rack | host_id
------+-------------+------+---------

(0 rows)
```

**Механизм.** Координатором становится узел, к которому клиент обратился **для этого запроса**;
на следующем им будет другой. Он считает токен ключа партиции (§1), по стратегии репликации
keyspace (§2) получает список владельцев и собирает ответы по уровню согласованности
([`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §1). Шаг «получить владельцев» наблюдаем
отдельно:

```
$ nodetool getendpoints cons_demo orders_by_user aaaaaaa1-1111-1111-1111-111111111111
172.17.0.2
```

На кластере из многих узлов здесь был бы список из RF адресов. Что роль отдельная, видно и по
метрикам: координаторская работа меряется отдельным счётчиком (`nodetool proxyhistograms`) от
работы реплики (`nodetool tablehistograms`), и на нашем стенде это 103 микросекунды медианной
записи против 4 — один узел в двух ролях. Отсюда оптимизация на стороне приложения: если драйвер
сам подключится к реплике, лишний прыжок исчезнет — маршрутизация по токену
([`DRIVER_AND_APP.md`](DRIVER_AND_APP.md) §5).

**Правило.** «Координатор» — это не узел, а роль на время одного запроса; отсюда и отсутствие
единой точки отказа, и требование, чтобы клиент ходил в свой ДЦ
([`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §2).

---

## 5. Ввод и вывод узла: где физически двигаются данные

**Задача.** К шести узлам надо добавить три. Что происходит с момента запуска процесса до момента,
когда новый узел начинает обслуживать запросы?

**Наивный ответ.** Узел поднялся, gossip его увидел, владение по кольцу пересчиталось — готово.

**Где ломается.** Пересчёт владения означает, что узел теперь **отвечает** за диапазоны, которых у
него нет, — поэтому в строй его не пускают, пока он их не получит: «the joining node will pick
current replicas of the token ranges it will become responsible for to stream data from»
(документация Apache Cassandra 5.0, [Adding, replacing, moving and removing nodes](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/topo_changes.html)).
Промежуточное состояние перечислено прямо в легенде `nodetool status`:

```
Status=Up/Down
|/ State=Normal/Leaving/Joining/Moving
```

**Механизм — то же самое в обратную сторону.** Уходящий узел обязан раздать свои диапазоны, и
Cassandra следит, чтобы после ухода фактор репликации не просел:

```
$ nodetool help decommission
        -f, --force
            Force decommission of this node even when it reduces the number of
            replicas to below configured RF

$ nodetool decommission
nodetool: Unsupported operation: no other normal nodes in the ring; decommission would be pointless
```

(второй вывод — с одноузлового стенда; на кластере команда запустила бы передачу.) Разница между
уходом по-хорошему и по-плохому в том, кто отдаёт байты: «If decommission is used, the data will
stream from the decommissioned node. If removenode is used, the data will stream from the remaining
replicas» (там же) — убитый узел никто не заменяет сам собой, его диапазоны восстанавливают
уцелевшие реплики и только по явной команде. Первичное наполнение можно и пропустить: «It's
possible to skip the bootstrapping process entirely … by setting the hidden parameter
`auto_bootstrap: false`. This may be useful when restoring a node from a backup or creating a new
data-center» (там же) — второй случай ровно §6.

**Правило.** Ввод и вывод узла планируются по объёму данных и полосе канала, а не по времени старта
процесса: это передача терабайтов, замаскированная под изменение состава кластера.

---

## 6. Второй дата-центр: что меняется в работающем кластере

**Задача.** Маркетплейс живёт в `dc_eu`, и надо выполнить требование «чтение переживает потерю
ДЦ». Поднимаем три узла в `dc_us`, они входят в кластер, gossip их видит.

**Наивный ответ.** Дальше кластер сам разложит реплики по новому ДЦ.

**Где ломается.** Не разложит: репликация описана в определении каждого keyspace по именам ДЦ (§2),
и нового имени там нет — значит, ни одной реплики в `dc_us` не назначено. Расширять надо явно, и
сам `ALTER KEYSPACE` данные **не двигает**, о чём сервер сообщает прямым текстом:

```
$ cqlsh -e "SELECT keyspace_name, replication FROM system_schema.keyspaces
            WHERE keyspace_name='cons_demo';"
 cons_demo | {'class': 'org.apache.cassandra.locator.NetworkTopologyStrategy', 'datacenter1': '1'}

$ cqlsh -e "ALTER KEYSPACE cons_demo WITH replication =
    {'class':'NetworkTopologyStrategy','datacenter1':3};"
When increasing replication factor you need to run a full (-full) repair to distribute the data.

$ cqlsh -e "SELECT keyspace_name, replication FROM system_schema.keyspaces
            WHERE keyspace_name='cons_demo';"
 cons_demo | {'class': 'org.apache.cassandra.locator.NetworkTopologyStrategy', 'datacenter1': '3'}

$ nodetool netstats
Mode: NORMAL
Not sending any streams.
```

Фактор репликации вырос втрое мгновенно, потока данных не возникло вовсе. Прогон сделан внутри
одного ДЦ (добавление второго на одноузловом стенде невоспроизводимо), но именно это поведение
`ALTER KEYSPACE` делает следующий шаг обязательным.

**Механизм.** Наполнение нового ДЦ — отдельная команда с обязательным аргументом «откуда брать»:

```
$ nodetool help rebuild
NAME
        nodetool rebuild - Rebuild data by streaming from other nodes (similarly
        to bootstrap)

SYNOPSIS
        ... rebuild [--exclude-local-dc] [(-ks <specific_keyspace> | --keyspace <specific_keyspace>)]
                [(-s <specific_sources> | --sources <specific_sources>)] [--] <src-dc-name>
```

Порядок получается жёстким: узлы нового ДЦ поднимают без первичного наполнения
(`auto_bootstrap: false`, §5) → расширяют каждый keyspace через `ALTER` → на каждом узле нового ДЦ
запускают `nodetool rebuild dc_eu`. Каждый — включая служебные, которые тоже описаны стратегией и
про новый ДЦ ничего не знают:

```
$ nodetool describecluster | grep -A3 Keyspaces
Keyspaces:
	system_auth -> Replication class: SimpleStrategy {replication_factor=1}
	system_distributed -> Replication class: SimpleStrategy {replication_factor=3}
	system_traces -> Replication class: SimpleStrategy {replication_factor=2}
```

Пропущенный `system_auth` означает, что приложения второго региона не смогут аутентифицироваться,
когда первый станет недоступен, — при том что данные заказов будут на месте.

**Правило.** До завершения `rebuild` клиентов второго региона обслуживать нельзя: `LOCAL_QUORUM`
там не выполним не потому, что реплики отстают, а потому что их нет
([`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §2).

---

## 7. Шпаргалка

Что двигается при изменении топологии:

| Действие | Что меняется | Что физически передаётся |
|---|---|---|
| новый узел вошёл в кольцо | владение диапазонами | узел тянет свои будущие диапазоны у текущих владельцев |
| `nodetool decommission` | владение диапазонами | уходящий узел раздаёт свои диапазоны |
| `nodetool removenode` (узел мёртв) | владение диапазонами | недостающие копии восстанавливают оставшиеся реплики |
| `ALTER KEYSPACE` (рост RF) | только метаданные | ничего; нужен `nodetool repair -full` |
| добавлен второй ДЦ | только метаданные | ничего; нужен `nodetool rebuild <src-dc>` на каждом узле |

Где смотреть топологию:

| Вопрос | Команда |
|---|---|
| кто в кластере, сколько токенов, состояние | `nodetool status` |
| какой снитч и разделитель, какие стратегии у keyspace | `nodetool describecluster` |
| какое имя ДЦ и стойки у узла на самом деле | `SELECT data_center, rack FROM system.local` |
| какие узлы хранят конкретный ключ | `nodetool getendpoints <ks> <table> <key>` |
| идёт ли сейчас передача данных | `nodetool netstats` |

Умолчания образа `cassandra:5.0`: `num_tokens: 16` (в коде было бы 1),
`allocate_tokens_for_local_replication_factor: 3`, `endpoint_snitch: SimpleSnitch`
(для продакшена — `GossipingPropertyFileSnitch`), разделитель `Murmur3Partitioner`.

### Формулировки для собеседования

- «Ключ партиции хешируется в токен; узел владеет не одним диапазоном, а `num_tokens` кусочками
  кольца — поэтому ввод узла грузит многих соседей понемногу, а не одного вдвое.»
- «Фактор репликации в Cassandra задаётся на каждый ДЦ отдельно, и имя ДЦ приходит от снитча, а не
  из строки в CQL: неизвестное имя keyspace просто не примет.»
- «Координатор — роль на один запрос: любой узел считает токен, находит реплики и собирает кворум.»
- «`ALTER KEYSPACE` меняет метаданные и не двигает ни байта: данные приносит `repair -full` внутри
  ДЦ и `rebuild` при добавлении нового.»

## Упражнения

- [`ex04_consistency`](../exercises/ex04_consistency/README.md) — в `schema.cql` требуется keyspace
  с фактором репликации по дата-центрам: прямое применение §2, а вопрос «что будет при потере
  `dc_us`» — §6.
- [`ex06_diagnose`](../exercises/ex06_diagnose/README.md) — диагностика по инструментам кластера:
  `nodetool status`, `getendpoints`, трассировка и вопрос «сколько узлов участвовало в запросе»
  (§4, §7).

## Источники

- Apache Cassandra 5.0 Documentation, [Architecture / Dynamo](https://cassandra.apache.org/doc/stable/cassandra/architecture/dynamo.html)
  — кольцо токенов, vnodes, `NetworkTopologyStrategy` и правило про стойки, роль координатора.
- Apache Cassandra 5.0 Documentation, [Operating / Adding, replacing, moving and removing nodes](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/topo_changes.html)
  — первичное наполнение узла, `auto_bootstrap`, `decommission` против `removenode`.
- Apache Cassandra 5.0 Documentation, [nodetool rebuild](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/rebuild.html)
  и [nodetool decommission](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/decommission.html)
  — наполнение нового ДЦ и вывод узла.
- Apache Cassandra 5.0 Documentation, [nodetool status](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/status.html)
  и [nodetool getendpoints](https://cassandra.apache.org/doc/stable/cassandra/managing/tools/nodetool/getendpoints.html)
  — колонки состояния и поиск владельцев ключа.
- Apache Cassandra 5.0 Documentation, [Configuring / cassandra.yaml](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
  — `num_tokens`, `allocate_tokens_for_local_replication_factor`, `endpoint_snitch`.
- Apache Cassandra 5.0 Documentation, [Configuring / cassandra-rackdc.properties](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_rackdc_file.html)
  — откуда `GossipingPropertyFileSnitch` берёт имя ДЦ и стойки.
- Apache Cassandra 5.0 Documentation, [CQL / Data Definition](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/ddl.html#create-keyspace-statement)
  — синтаксис `CREATE`/`ALTER KEYSPACE` и стратегии репликации.
- Apache Cassandra 5.0 Documentation, [Getting started / Production recommendations](https://cassandra.apache.org/doc/stable/cassandra/getting-started/production.html)
  — рекомендации по числу токенов и снитчу для боевого кластера.

Проверено на одноузловом Apache Cassandra 5.0.9 (образ `cassandra:5.0`): все выводы `cqlsh` и
`nodetool` в блоках выше — из реальных прогонов; операции с несколькими узлами и дата-центрами на
таком стенде невоспроизводимы и подпёрты документацией, о чём сказано по месту.
