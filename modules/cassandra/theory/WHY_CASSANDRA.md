# Зачем Cassandra и когда она неправильный ответ

> **Какую проблему решает.** История заказов маркетплейса: 50 млн пользователей, пик 20 тыс.
> записей в секунду, два дата-центра, и чтение обязано пережить потерю одного из них целиком.
> В системе с одним ведущим узлом обе цифры упираются в одну машину, а потеря ДЦ с лидером — это
> пауза на переключение, во время которой запись невозможна нигде.
> **Кому это надо.** Тому, кто должен обосновать выбор хранилища числами, а не модой; и тому, кто
> уже пишет в Cassandra и удивляется, почему привычный `WHERE` не работает.
> **Когда НЕ надо.** Если инвариант домена охватывает несколько строк («со счёта списали ровно
> столько, сколько зачислили»), если запросы заранее неизвестны, или если весь объём спокойно
> живёт на одной машине РСУБД — Cassandra будет дороже и хуже (§5).

**Что здесь и чего здесь нет.** Здесь — только выбор: какую задачу Cassandra решает и чем за это
платят. Что делать вместо `JOIN` и вместо произвольного `WHERE` — [`QUERY_FIRST_DESIGN.md`](QUERY_FIRST_DESIGN.md).
Как устроен ключ, который становится единственным путём доступа — [`DATA_MODEL.md`](DATA_MODEL.md).
Механика репликации без ведущего узла — [`../../databases/theory/REPLICATION.md`](../../databases/theory/REPLICATION.md) §6;
CAP, PACELC и правило `R + W > N` — [`../../system-design/theory/distributed_systems.md`](../../system-design/theory/distributed_systems.md).

Прогоны выполнены на кластере в контейнере, Apache Cassandra 5.0.9. Выводы в блоках — реальные.

---

## 1. Проблема, которую решает отсутствие ведущего узла

**Задача.** История заказов: 50 млн пользователей, пик 20 тыс. записей в секунду, два дата-центра,
чтение обязано пережить потерю одного из них.

**Наивное решение.** PostgreSQL, потоковая реплика в соседнем ДЦ. Чтение с реплики, запись в лидера.

**Где ломается.** Не на цифре 20 тыс. — её одна машина берёт. Ломается на двух других местах.

*Потолок принадлежит одной машине.* Принимающий запись узел ровно один — реплика в соседнем ДЦ его не
разгружает. Когда 20 тыс. станут 60 тыс., следующий шаг не «ещё одна машина», а «машина втрое крупнее».

*Потеря ДЦ с лидером останавливает запись.* Условие говорит про чтение, и чтение переживёт — данные
на реплике есть. Запись же невозможна нигде, пока не завершится переключение на резерв (failover).
Это минуты, а минута на 20 тыс. записей в секунду — 1,2 млн потерянных заказов.

**Механизм.** В Cassandra роли лидера нет: реплики вычисляет тот узел, к которому пришёл клиент.
«When a mutation occurs, the coordinator hashes the partition key to determine the token range the
data belongs to and then replicates the mutation to the replicas of that data according to the
Replication Strategy» (Apache Cassandra 5.0, Architecture / Dynamo). Отсюда обе проектные цели,
записанные в документации: «Full multi-primary database replication» и «Linear throughput increase
with each additional processor». Оба ДЦ — равноправные наборы реплик; потеря одного не создаёт паузы,
потому что переключать нечего.

**Правило.** Спрашивайте не «выдержит ли база 20 тыс. записей в секунду», а «сколько машин имеют
право принять запись». Потолок задаёт это число, а не суммарная мощность кластера.

## 2. Наследие: что из Dynamo, что из BigTable

Вопрос обычно задают как выбор из двух, и оба варианта ответа неверны. Документация 5.0 отвечает
прямо: «This initial design implemented a combination of Amazon's Dynamo distributed storage and
replication techniques and Google's Bigtable data and storage engine model»
(Architecture / Overview). Гибрид, причём с чистым швом:

| Линия BigTable — «что и как лежит» | Линия Dynamo — «где лежит и что при отказе» |
|---|---|
| строки отсортированы ключом кластеризации | кольцо токенов, [consistent hashing](../../caching-deep-dive/theory/DISTRIBUTED_CACHING.md) |
| колонки группируются в семейства | репликация без ведущего узла ([REPLICATION.md](../../databases/theory/REPLICATION.md) §6) |
| SSTable и compaction поверх [LSM-дерева](../../databases/theory/STORAGE_ENGINES.md) | настраиваемый уровень согласованности, [Merkle tree](../../system-design/theory/MERKLE_TREE.md) в repair |
| разреженность: у строк разный набор колонок | [Gossip](../../system-design/theory/GOSSIP_PROTOCOL.md) вместо реестра узлов |

**Правило.** Отвечайте линией, а не системой: модель данных — BigTable, распределение — Dynamo.
Дальше про любую деталь видно, из какой она половины, — и вопрос «а почему тогда…» пропадает сам.

## 3. Цена: почему нет JOIN и нет произвольного WHERE

**Задача.** Показать заказ вместе с именем продавца. И отдельно — найти все заказы в статусе `NEW`.

**Наивное решение.** `JOIN` по `seller_id`; `WHERE status = 'NEW'`.

**Где ломается.** Обе попытки на кластере 5.0.9, таблицы `orders_by_user` и `sellers`:

```
$ docker exec cass-theory cqlsh -e "SELECT * FROM theory_why.orders_by_user JOIN theory_why.sellers ON seller_id = seller_id;"
<stdin>:1:SyntaxException: line 1:40 mismatched input 'JOIN' expecting EOF (SELECT * FROM theory_why.orders_by_user [JOIN]...)

$ docker exec cass-theory cqlsh -e "SELECT order_id, total FROM theory_why.orders_by_user WHERE status = 'NEW';"
<stdin>:1:InvalidRequest: Error from server: code=2200 [Invalid query] message="Cannot execute this
query as it might involve data filtering and thus may have unpredictable performance. If you want to
execute this query despite the performance unpredictability, use ALLOW FILTERING"
```

Обратите внимание на разницу в диагнозах. `JOIN` — **синтаксическая** ошибка на позиции 40, то есть
на самом слове: в грамматике CQL его нет. `WHERE status` — ошибка исполнения, и сервер жалуется не
на отсутствие индекса, а на непредсказуемость времени ответа.

**Механизм.** Обе формулировки — одно решение с двух сторон. Строки `orders_by_user` и `sellers`
живут на разных узлах, потому что у них разные ключи партиции; соединить их можно только опросив
кластер целиком. Время такого запроса зависело бы от числа узлов, а не от объёма ответа — то есть
росло бы при расширении кластера, ради которого кластер и расширяют. Тот же счёт у `WHERE status`:
статус не участвует в размещении, поэтому подходящие строки могут оказаться на всех узлах сразу.
Cassandra не сделала этот класс запросов медленным — она его не поддерживает, оставив таблице ровно
один дешёвый путь доступа: ключ партиции. `ALLOW FILTERING` индекса не создаёт, он лишь снимает
запрет и разрешает читать лишнее ([`QUERY_FIRST_DESIGN.md`](QUERY_FIRST_DESIGN.md) §6).

**Правило.** Таблица в Cassandra — не хранилище сущности, а заранее разложенный ответ на конкретный
запрос. Не спросили при проектировании — не спросите и во время работы.

## 4. Цена: нет транзакций между партициями

**Задача.** Списать 100 у одного продавца и начислить другому — при условии, что у первого эти 100
действительно есть. Два разных `seller_id` — две партиции.

**Наивное решение.** Обернуть обе `UPDATE` в batch с условиями `IF balance = ...`.

**Где ломается.** Сервер отвергает такой batch целиком:

```
$ cat batch.cql
BEGIN BATCH
  UPDATE theory_why.sellers SET balance = 900.00 WHERE seller_id = 22222222-2222-2222-2222-222222222222 IF balance = 1000.00;
  UPDATE theory_why.sellers SET balance = 1100.00 WHERE seller_id = 33333333-3333-3333-3333-333333333333 IF balance = 1000.00;
APPLY BATCH;

$ docker exec -i cass-theory cqlsh < batch.cql
<stdin>:5:InvalidRequest: Error from server: code=2200 [Invalid query] message="Batch with conditions cannot span multiple partitions"
```

**Механизм.** Оба механизма, которые в Cassandra ближе всего к транзакции, упираются в одну и ту же
границу. Условная запись — это [Paxos](../../system-design/theory/CONSENSUS.md) по ключу партиции:
согласовывать состояние двух ключей сразу он не умеет. Batch без условий партиции пересекать может, но
даёт только атомарность — «all operations in the batch are performed as logged, to ensure all mutations
eventually complete (or none will)», — а изоляцию не даёт: «operations are only isolated within a single
partition» (Apache Cassandra 5.0, CQL / Data Manipulation). Промежуточное состояние, в котором деньги
списаны и не зачислены, читателю видно, а отката из него нет — только вторая запись, компенсирующая
первую ([`OPERATIONS_PITFALLS.md`](OPERATIONS_PITFALLS.md) §5, [`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §5).

**Правило.** Инвариант, охватывающий два ключа партиции, либо переносится внутрь одной партиции, либо
становится задачей приложения. Третьего варианта база не предлагает.

## 5. Когда Cassandra — неправильный ответ

Три признака; хватает одного. Каждый — прямое следствие §1–§4, а не отдельное знание.

**Инвариант домена охватывает несколько строк.** Складские остатки с резервированием, двойная
запись в бухгалтерии, распределение мест в самолёте. По §4 такой инвариант базой не поддерживается —
его придётся собирать из условных записей и компенсаций, то есть писать в приложении то, что РСУБД
делает одним `BEGIN`. Отдельная ловушка: на маленьком объёме это даже работает — расхождения
появляются позже, при первом же неудачном стечении отказов.

**Запросы заранее неизвестны.** Аналитика, внутренняя админка с произвольными фильтрами, отчёты «а
покажи ещё в разрезе». По §3 каждый новый фильтр — это новая таблица и обратная засыпка в неё всей
истории: цена вопроса измеряется не минутами на запрос, а часами на перекладывание данных.

**Всё умещается на одной машине, и потеря ДЦ не в требованиях.** Терабайт данных и тысяча запросов в
секунду — это одна РСУБД с репликой. Cassandra в этом месте ничего не добавляет (§1 нечего решать),
но забирает `JOIN`, транзакции и произвольные выборки, а взамен требует минимум трёх узлов,
регулярного repair и человека, который понимает compaction.

Четвёртый случай — не архитектурный, а фольклорный: Cassandra в роли очереди задач. Почему это
разваливается предсказуемым образом, разобрано в [`OPERATIONS_PITFALLS.md`](OPERATIONS_PITFALLS.md) §4.

**Правило.** Cassandra окупается там, где известен список запросов и требуется писать одновременно в
нескольких местах планеты. Не выполнено первое — вы будете переделывать модель; не выполнено
второе — вы платите за то, чем не пользуетесь.

## 6. Место среди альтернатив: ScyllaDB, HBase, DynamoDB

Сравнивать эти три с Cassandra надо по разным осям, и в этом весь ответ: одна отличается реализацией,
вторая — половиной наследия из §2, третья — моделью эксплуатации.

**ScyllaDB — та же модель, другой движок.** Всё про ключ партиции и tombstone переносится один в
один; отличается то, во что упирается узел: «ScyllaDB runs one application thread per core and relies
on explicit message passing instead of shared memory between threads», причём у каждого ядра «its own
dedicated resources, including a separate cache, memtables, and SSTables» (ScyllaDB, Shard-per-Core
Architecture) — C++ и Seastar вместо JVM и общего пула. Проверять стоит не это, а версию, с которой
обещана совместимость: «ScyllaDB is a drop-in replacement for Apache Cassandra 3.11, with additional
features from Apache Cassandra 4.0» (ScyllaDB Docs, Cassandra Compatibility). Появившееся в 5.0 в это
обещание не входит.

**HBase — только линия BigTable.** Половина §2, взятая без второй: «The HMaster server controls the
HBase cluster», «The HRegionServer manages the data in its StoreFiles as directed by the HMaster», а
рядом обязательны ZooKeeper и HDFS (Apache HBase Reference Guide). Выделенная роль означает, что при
отказе есть что переключать, а две внешние системы — что их надо поднимать и обслуживать. Обратная
сторона: строка живёт в одном месте, поэтому вопрос выбора уровня согласованности не встаёт вовсе.

**DynamoDB — та же дисциплина моделирования, другая цена и другие потолки.** Проектировать придётся
так же от запросов, но эксплуатировать не придётся вовсе, а границы жёстче и заданы сервисом:
«For tables with local secondary indexes, there is a 10 GB size limit per partition key value» (AWS
DynamoDB Developer Guide). В Cassandra такого договорного потолка нет — партиция может быть широкой,
и цена за это не отказ в записи, а деградация, которую вы обнаружите сами
([`DATA_MODEL.md`](DATA_MODEL.md) §4).

## 7. Шпаргалка

Дерево решений — первый же «нет» закрывает тему:

```
1. Список запросов известен и меняется редко?      нет → РСУБД / аналитическая БД
2. Инвариант домена помещается в одну партицию?    нет → РСУБД
3. Нужна запись в нескольких ДЦ без переключения?  нет → РСУБД с репликой, дешевле во всём
4. Объём или поток перерастают одну машину?        да  → Cassandra оправдана
```

| Симптом в требованиях | Что он значит |
|---|---|
| «отчёт в произвольном разрезе» | новая таблица и обратная засыпка на каждый разрез (§3) |
| «списание и зачисление атомарно» | между партициями механизма нет (§4) |
| «выдержит 20 тыс. записей в секунду?» | вопрос не о базе, а о числе принимающих запись машин (§1) |

### Формулировки для собеседования

- «Лидера нет: узел, принявший запрос, сам считает владельцев ключа и рассылает мутацию репликам —
  поэтому запись масштабируется числом узлов, а не размером машины».
- «`JOIN` — не пропущенная возможность: слова нет в грамматике CQL, потому что соединение потребовало
  бы опроса всего кластера и время ответа зависело бы от его размера».
- «Атомарность кончается на границе партиции: условная запись — Paxos по одному ключу, а batch через
  партиции даёт атомарность без изоляции».

## Упражнения

- [`ex01_order_history`](../exercises/ex01_order_history/README.md) — три запроса сквозного примера
  превращаются в схему; здесь становится видно, что §3 — не абстракция.
- [`ex02_partition_sizing`](../exercises/ex02_partition_sizing/README.md) — цена решений из §1 в
  мегабайтах на партицию.

## Источники

- Apache Cassandra 5.0 Documentation, [Architecture / Overview](https://cassandra.apache.org/doc/stable/cassandra/architecture/overview.html)
  — наследие Dynamo и BigTable, список проектных целей.
- Apache Cassandra 5.0 Documentation, [Architecture / Dynamo](https://cassandra.apache.org/doc/stable/cassandra/architecture/dynamo.html)
  — координатор и рассылка мутации репликам.
- Apache Cassandra 5.0 Documentation, [CQL / Data Manipulation](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/dml.html)
  — атомарность batch, изоляция в границах партиции, Paxos у условной записи.
- A. Lakshman, P. Malik. Cassandra — A Decentralized Structured Storage System. ACM SIGOPS
  Operating Systems Review, 2010 — первоисточник обеих линий наследия.
- [Apache HBase Reference Guide](https://hbase.apache.org/book.html) — роль HMaster и RegionServer.
- ScyllaDB, [Shard-per-Core Architecture](https://www.scylladb.com/product/technology/shard-per-core-architecture/)
  и [Cassandra Compatibility](https://docs.scylladb.com/stable/using-scylla/cassandra-compatibility.html).
- AWS, [DynamoDB Developer Guide — Local secondary indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html)
  — потолок 10 ГБ на значение ключа партиции.
