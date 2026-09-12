# Драйвер и приложение: решения, которых не видно в CQL

> **Какую проблему решает.** Запрос написан верно, таблица спроектирована под него — и всё равно
> «мои заказы» открываются две секунды у части пользователей, а в логе лежит
> `DriverTimeoutException` на записи, которая на самом деле применилась.
> **Кому это надо.** Тому, кто пишет `session.execute(...)` на Java или Kotlin и отвечает за
> задержку и за корректность повторов, а не только за схему.
> **Когда НЕ надо.** Драйвер не чинит модель данных: если p99 упирается в `ALLOW FILTERING`
> ([`QUERY_FIRST_DESIGN.md`](QUERY_FIRST_DESIGN.md) §6) или в размер партиции, клиентские
> настройки не помогут — они экономят прыжок, а не объём читаемого.

**Границы.** Уровни согласованности — [`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md), кольцо и
координатор — [`CLUSTER_TOPOLOGY.md`](CLUSTER_TOPOLOGY.md) §1 и §4. Повторы с экспоненциальной
паузой (backoff), джиттер, бюджет повторов, hedged request и ключ идемпотентности как паттерны —
[`RELIABILITY_PATTERNS.md`](../../system-design/theory/RELIABILITY_PATTERNS.md); circuit breaker —
[`FAILURE_ISOLATION.md`](../../microservices/theory/FAILURE_ISOLATION.md); consistent hashing —
[`DISTRIBUTED_CACHING.md`](../../caching-deep-dive/theory/DISTRIBUTED_CACHING.md).

Клиент — Apache Cassandra Java Driver 4.x (до передачи в ASF назывался DataStax Java Driver; API
тот же). Прогоны: Cassandra 5.0.9 (один узел), драйвер 4.19.0, Temurin 21.0.9+10. Что требует
второго узла или второго ДЦ — помечено по месту и подпёрто документацией.

---

## 1. Подготовленные запросы: условие для маршрутизации, а не просто скорость

**Задача.** «Последние 20 заказов пользователя» выполняются 20 тысяч раз в секунду; строка запроса
одна, меняются два значения — пользователь и бакет месяца.

**Наивный ответ.** Подготовка экономит разбор строки на сервере, разбор дешёвый, значит можно
подставить значения в строку и отправить `SimpleStatement`.

**Где ломается.** Вместе со строкой теряется информация о том, что в запросе — ключ партиции. Три
варианта одного запроса с одинаковыми значениями:

```
A simple   : keyspace=null      routingKey=null
B prepared : keyspace=drv_demo  routingKey=29 bytes   idempotent=null
C prepared*: keyspace=drv_demo  routingKey=null
```

B — связаны оба компонента ключа партиции (`user_id`, `bucket`); C — `user_id` оставлен в строке
константой. Ключ маршрутизации есть только у B, и это правило, а не случайность: «For simple
statements, routing information is never computed automatically»; «For bound statements … the
routing key is only available if **all** components of the partition key are bound as variables»
([Load balancing](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/load_balancing)).

**Механизм.** `session.prepare()` — отдельный обмен: сервер разбирает строку, кэширует и
возвращает `PREPARED`, где кроме 16-байтового идентификатора лежат метаданные — имена, типы и
принадлежность переменных ключу партиции (`bound vars = 2 : user_id UUID, bucket TEXT`). Из них
`BoundStatement` собирает ключ маршрутизации сам, а из него получается токен (§5). Серверная
сторона кэша видна напрямую — с Cassandra 3.10 она лежит в системной таблице:

```
$ docker exec cass-theory cqlsh -e "SELECT query_string FROM system.prepared_statements;"
 INSERT INTO drv_demo.orders_by_user (user_id, bucket, order_id, seller_id, total) VALUES (?,?,?,?,?)
 SELECT order_id, total FROM drv_demo.orders_by_user WHERE user_id = ? AND bucket = ?
 SELECT order_id FROM drv_demo.orders_by_user WHERE user_id = 11111111-… AND bucket = ?
 SELECT order_id FROM drv_demo.orders_by_user WHERE user_id = ? AND bucket = ?
(4 rows)
```

Варианты B и C — один и тот же запрос по смыслу, но лежат двумя отдельными записями: строки
разные. Ключ кэша — строка байт в байт, драйвер её не нормализует («the query string exactly as
you provided it: the driver does not perform any kind of trimming or sanitizing»,
[Prepared statements](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/statements/prepared)),
поэтому подготовка склеенной со значением строки забивает оба кэша — по записи на пользователя.

**Правило.** Готовьте запрос один раз при старте и держите `PreparedStatement` в поле; в строке не
должно остаться ни одного значения, ключ партиции в первую очередь, — иначе маршрутизация
отключается молча, без ошибки и без предупреждения.

## 2. Постраничность: почему в CQL нет `OFFSET`

**Задача.** Экран отдаёт двадцать заказов и кнопку «дальше». В реляционной базе это
`LIMIT 20 OFFSET 40`.

**Наивный ответ.** Написать то же самое на CQL.

**Где ломается.** Синтаксиса нет:

```
$ SELECT order_id FROM drv_demo.orders_by_user
    WHERE user_id = 1111… AND bucket = '2026-09' LIMIT 10 OFFSET 10;
SyntaxError: line 1:130 mismatched input 'OFFSET' expecting EOF (… LIMIT 10 [OFFSET]…)
```

Заявка «extend LIMIT to define offset, row_count» открыта в декабре 2013 года и закрыта *Won't
Fix* ([CASSANDRA-6511](https://issues.apache.org/jira/browse/CASSANDRA-6511)): «such queries are
inherently linear: the database would have to restart from the beginning every time, and skip
unwanted rows until it reaches the desired offset». Смещение — не адрес: сороковую строку не
отдать, не прочитав и не выбросив тридцать девять, заново на каждой странице, — а строки ещё и
сливаются из нескольких SSTable на лету ([`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §2).

**Механизм.** Сервер отдаёт **paging state** — непрозрачную позицию, с которой продолжать.
Двадцать пять заказов, размер страницы десять:

```
стр.1: строк в странице=10  paging state=30 байт
стр.2: строк в странице=10  paging state=30 байт
полный обход: строк=25  ответов сервера=3
```

Размер не растёт от страницы к странице: внутри координата последней отданной строки, а не счётчик
пройденного. Отсюда три свойства. Обход партиции стоит три ответа сервера вместо одного — цена не
исчезает, а размазывается. Курсор идёт только вперёд. И он привязан к конкретному запросу вместе
со значениями — безопасная форма (`getSafePagingState()`) это проверяет:

```
чужой statement:           Paging state mismatch, this means that either the paging state contents
                           were altered, or you're trying to apply it to a different statement
другое значение параметра: Paging state mismatch, …
```

Второе важнее первого: та же строка запроса, но `bucket = '2026-08'` — уже другой запрос.
Произвольный доступ по номеру страницы драйвер эмулирует на клиенте (`OffsetPager`), делая ровно
то, от чего отказался сервер, и требует предела в коде приложения: «enforce a maximum, so that an
attacker can't inject a large value that could potentially fetch millions of rows»
([Paging](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/paging)).

**Правило.** Постраничность здесь — «дальше», а не «на страницу N»; проектируйте интерфейс под
курсор, тогда цена страницы не зависит от того, как глубоко ушёл пользователь.

### Формулировка, которая хорошо звучит и неверна

**«Paging state — закодированное смещение, его можно разобрать и подправить».** Размер одинаков на
обеих страницах, а драйвер называет значение непрозрачным: «It is an opaque value that is only
meant to be collected, stored and re-used. If you try to modify its contents or reuse it with a
different statement, the results are unpredictable».

## 3. Идемпотентность запроса: что драйверу разрешено повторить

**Задача.** Запись заказа ушла на координатор, соединение оборвалось до ответа: мутация могла
дойти до реплик, а могла не дойти.

**Наивный ответ.** Повторить — Cassandra перезапишет по метке времени
([`WRITE_READ_PATH.md`](WRITE_READ_PATH.md) §3), второй такой же `INSERT` ничего не испортит.

**Где ломается.** Для `INSERT` со всеми колонками — правда, и те же слова по инерции произносят над
двумя операциями, где они неверны. Счётчик инкрементируется, а не присваивается
([`DATA_MODEL.md`](DATA_MODEL.md) §8): повтор даёт двойку вместо единицы, и откатить нечем.
Дописывание в non-frozen-коллекцию ([`DATA_MODEL.md`](DATA_MODEL.md) §6) — то же: «`update
my_table set list_col = [1] + list_col where pk = 1` is not idempotent: if `list_col` was initially
empty, it will contain `[1]` after the first execution, `[1, 1]` after the second»
([Query idempotence](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/idempotence)).
Отличить одно от другого драйвер не может: для него это строка.

**Механизм.** Решение переложено на вас флагом на запросе, и по умолчанию флаг запрещающий:

```
default-idempotence    = false      # basic.request.default-idempotence
retry-policy           = DefaultRetryPolicy
speculative-exec-policy= NoSpeculativeExecutionPolicy
```

Флаг — не подсказка, а переключатель двух механизмов сразу: «retries and speculative executions
only happen for idempotent statements». Причём это условие входа, а не решение политики: на
неидемпотентном запросе политику не спрашивают вовсе — «the driver bypasses the retry policy and
always rethrows the error»
([Retries](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/retries)). Так
оформлены три метода из пяти — таймаут записи, обрыв соединения, прочие ошибки в ответе, то есть
ровно случаи с неизвестным исходом. Два оставшихся, `UNAVAILABLE`
([`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §1) и таймаут чтения, вызываются всегда: там
точно известно, что мутации не было. Мимо всех флагов повторяются два доказуемо безопасных случая:
ошибка **до** записи в сокет и ответ `UNPREPARED`, после которого запрос готовится заново (§1).

Сама политика скромна: «retries at most once, in cases that have a high chance of success» — один
повтор, на `UNAVAILABLE` на следующем узле плана (первый координатор мог быть отрезан от
остальных), на таймауте на том же (отставшую реплику к этому моменту уже пометили мёртвой).

**Правило.** Проставляйте флаг явно на каждом запросе: чтения и присваивающие записи — `true`,
счётчики и коллекции — `false`. Значение по умолчанию корректно, но лишает повторов и чтения
тоже — безопасно и дорого.

## 4. Спекулятивное исполнение: когда помогает, когда усиливает отказ

**Задача.** Медиана чтения — четыре миллисекунды, p99 — две секунды, виновник один узел с длинной
паузой сборки мусора раз в несколько минут.

**Наивный ответ.** Включить спекуляцию везде: драйвер продублирует запрос на другую реплику, хвост
срежется, хуже не станет.

**Где ломается.** Станет — ровно в том случае, ради которого механизм и вспоминают. Спекуляция
лечит один медленный узел **среди здоровых**: дубликат уходит туда, где свободно. Если медленно
отвечает весь кластер, свободного места нет, а запросов вдвое больше: чем хуже отвечает кластер,
тем чаще срабатывает порог. Руководство предупреждает в первых строках: «creates more traffic:
tune your pool and provision your cluster accordingly»
([Speculative execution](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/speculative_execution)).

Вторая поломка — в самом пороге. Естественно взять p99 из метрик, но перцентиль считается по
фактическим задержкам, и больной узел задирает его сам: «A percentile setting can backfire. If a
single host becomes unavailable, it can force up the percentiles. A value of p99 will not speculate
as intended because the value at the specified percentile has increased too much»
([CQL / Data Definition](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/ddl.html)
— про серверный порог, но арифметика одна).

**Механизм.** Спекуляция выключена по умолчанию (§3) и включается политикой с фиксированной паузой:
`delay` — через сколько слать дубликат, `max-executions` — сколько исполнений всего, считая
исходное. Дубликат уходит на следующий узел **того же** плана запроса (§5), поэтому узел не
опрашивается дважды; побеждает первый пришедший ответ. Слово «отменяется» означает меньше, чем
кажется: «cancelling in this context simply means discarding the response when it arrives later,
Cassandra does not support cancellation of in flight requests» — проигравший запрос доходит до узла
и выполняется целиком. Отсюда требование идемпотентности (§3) и расход номеров потоков в
соединении, из-за которого при частой спекуляции соединения пересоздаются чаще обычного.

**Правило.** Лекарство от дисперсии, а не от перегрузки: включать на идемпотентных чтениях, порог
снимать на **здоровом** кластере и фиксировать числом, при росте задержки по всему кластеру —
выключать.

### Формулировка, которая хорошо звучит и неверна

**«Спекулятивное исполнение уже включено — это `speculative_retry` на таблице».** Другой механизм и
другая сторона. `speculative_retry` (по умолчанию `99p`, видно в описании любой таблицы) управляет
**координатором**: «a coordinator sends more requests than needed to satisfy the consistency
level» — лишнюю реплику опрашивает сервер внутри кластера и только на чтении. Драйверная спекуляция
— второй **клиентский** запрос к другому координатору, по умолчанию выключенный. Механизмы
складываются.

## 5. Маршрутизация по токену: как драйвер убирает лишний сетевой прыжок

**Задача.** Координатором становится любой узел ([`CLUSTER_TOPOLOGY.md`](CLUSTER_TOPOLOGY.md) §4).
Клиент открыл соединения ко всем узлам ДЦ и раскладывает запросы по кругу. Важно ли, кому достался
запрос?

**Наивный ответ.** Нет: узел, не хранящий данные, перешлёт запрос тому, кто хранит.

**Где ломается.** Перешлёт — но это лишний внутренний прыжок, целиком ложащийся на задержку,
которую видит клиент; координаторская работа и работа реплики даже меряются разными счётчиками
(`CLUSTER_TOPOLOGY.md` §4). При трёх репликах из шести узлов в ДЦ мимо реплики уходит половина
запросов.

**Механизм.** Драйвер выбирает реплику сам: из метаданных подготовленного запроса собирает ключ
маршрутизации (§1), хеширует тем же разделителем, что и сервер
([`CLUSTER_TOPOLOGY.md`](CLUSTER_TOPOLOGY.md) §1), и ищет токен в карте кольца у себя — всё без
обращения к серверу:

```
token(B)   = Murmur3Token(4171329810690023163)
replica    = /127.0.0.1:9042 dc=datacenter1
```

Дальше политика балансировки строит план запроса, и разница между двумя её ветками целиком
объясняет, зачем нужен §1: «If there isn't any [routing information], the query plan is a simple
round-robin shuffle of all connected nodes that are located in the local datacenter. If the
statement has routing information, the policy uses it to determine the *local* replicas … shuffled
in random order, followed by a round-robin shuffle of the rest of the nodes». Реплики
перемешиваются между собой, иначе весь трафик партиции лёг бы на одну. Запрос без ключа
маршрутизации попадает в первую ветку: механизм не выключен, ему нечего маршрутизировать.

Второе слово в обеих ветках — «local». `DefaultLoadBalancingPolicy` требует назвать локальный ДЦ и
соединяется только с ним, остальным узлам присваивая расстояние `IGNORED`. Это и есть привязка
клиента к своему ДЦ, без которой `LOCAL_QUORUM` не даёт «увижу свою запись»
([`CONSISTENCY_TUNING.md`](CONSISTENCY_TUNING.md) §2).

**Правило.** Маршрутизация по токену не включается флагом — она следствие того, что запрос
подготовлен и **все** компоненты ключа партиции переданы связанными переменными.

**Чего она не даёт.** Не меняет уровень согласованности и число ожидаемых реплик — координатором
просто будет одна из них. Не спасает от горячей партиции
([`OPERATIONS_PITFALLS.md`](OPERATIONS_PITFALLS.md) §2), а наоборот, адресует весь её трафик тем
узлам, которым и так тяжело. Бесполезна для запросов без ключа партиции.

## 6. Таймаут драйвера против таймаута сервера: разные вещи, нужны обе

**Задача.** В логе `DriverTimeoutException` на записи заказа. Дежурный должен ответить: заказ
создан или нет?

**Наивный ответ.** Раз исключение, операция не прошла.

**Где ломается.** Профиль с таймаутом в одну миллисекунду, один `INSERT`, затем чтение той же
партиции обычным профилем:

```
запись: DriverTimeoutException: Query timed out after PT0.001S (клиент сдался через 4 мс)
  прочитано: order_id=6f55a970-ae8e-11f1-b0d7-9f3eb1a544e0 total=999
строк в партиции после "провалившейся" записи: 1
```

Таймаут драйвера — решение **клиента** перестать ждать. Сервер о нём не знает, отменять начатый
запрос не умеет в принципе (§4), и мутация, дошедшая до координатора, будет разослана репликам
независимо от того, слушает ли ещё кто-нибудь ответ.

**Механизм.** Таймеров два, они независимы и меряют разное. Серверный — сколько **координатор**
ждёт реплики; их несколько по роду операции, и комментарии в конфигурации называют их прямо («How
long the coordinator should wait for read operations to complete»):

```
$ docker exec cass-theory grep -nE '^(read|write|range)_request_timeout:' /etc/cassandra/cassandra.yaml
1322:read_request_timeout: 5000ms
1326:range_request_timeout: 10000ms
1330:write_request_timeout: 2000ms
```

Клиентский — `basic.request.timeout`, один на весь вызов: «a global limit on the duration of a
`session.execute()` call, **including any internal retries** the driver might do»
([Configuration reference](https://docs.datastax.com/en/developer/java-driver/4.17/manual/core/configuration/reference/index.html)),
по умолчанию две секунды. Сложите числа: на медленном чтении клиент сдаётся через 2 секунды, а
координатор признаёт провал только через 5, то есть клиент гарантированно первый. Последствий два.
Приложение получает `DriverTimeoutException` — «координатор не ответил вовсе» — вместо
`ReadTimeoutException`, в котором сервер рассказал бы, сколько реплик ответило и были ли среди них
данные. И политика повторов не вызывается: её пять методов описывают, что пришло с узла (§3), а
истёкший клиентский таймаут — не событие внутри запроса, а внешняя граница, за которой запрос
заканчивают.

Отдельная ловушка — нижний предел: таймауты планируются на общем таймере с тиком в 100
миллисекунд, и конфигурация предупреждает, что значение обязано быть больше тика, иначе «timeouts
will not be triggered as timely as desired». Это не «сработает неточно»: тот же прогон с таймаутом
в 1 миллисекунду и нетронутым тиком трижды подряд закончился успехом.

```
запись: успех (таймаут не сработал)   строк=1
запись: успех (таймаут не сработал)   строк=2
запись: успех (таймаут не сработал)   строк=3
```

**Правило.** Клиентский таймаут ставьте заведомо больше серверного для этого типа операции, иначе
диагностика с сервера до вас не доходит, а повторы отключаются. На само исключение смотрите как на
«исход неизвестен»: корректный ответ дежурного — прочитать и посмотреть.

## 7. Шпаргалка

| Запрос | Идемпотентность | Спекуляция |
|---|---|---|
| чтение по ключу партиции: «последние 20 заказов», «заказ по идентификатору» | `true` | да, порог снят на здоровом кластере |
| чтение веером по многим партициям: «заказы продавца за период» | `true` | нет — веер и так широкий |
| `INSERT` / `UPDATE` с присваиванием колонок | `true` | нет: это запись |
| счётчик, non-frozen-коллекция, `IF NOT EXISTS` | `false` | нет |

| Сторона | Параметр | Значение по умолчанию |
|---|---|---|
| клиент | `basic.request.timeout` | `2 s` — весь вызов, повторы внутри |
| клиент | `basic.request.page-size` | `5000` строк, и это подсказка, не гарантия |
| клиент | `basic.request.default-idempotence` | `false` |
| клиент | балансировка / повторы / спекуляция | по токену и одному ДЦ / один повтор / выключена |
| клиент | `advanced.netty.timer.tick-duration` | `100 ms` — нижний предел любого таймаута |
| сервер | `read_request_timeout` / `write_request_timeout` | `5000ms` / `2000ms` |
| сервер | `speculative_retry` (на таблицу) | `99p`, и это не драйверная спекуляция |

### Формулировки для собеседования

- «Подготовка нужна не ради разбора строки: в ответе `PREPARED` приходят метаданные, из которых
  драйвер собирает ключ маршрутизации. Один компонент ключа партиции, оставленный в строке,
  отключает маршрутизацию молча.»
- «`OFFSET` нет, потому что смещение линейно: сороковую строку не отдать, не выбросив тридцать
  девять. Paging state — курсор, его цена не зависит от номера страницы.»
- «Флаг идемпотентности — условие входа, а не подсказка: на неидемпотентном запросе политику
  повторов не вызывают вовсе.»
- «Спекуляция лечит один медленный узел среди здоровых; при перегрузке кластера она удваивает
  трафик, а порог по перцентилю задирает тот самый больной узел.»
- «`DriverTimeoutException` не означает, что запись не прошла: сервер о клиентском таймауте не
  знает и начатую операцию не отменяет.»

## Упражнения

- [`ex01_order_history`](../exercises/ex01_order_history/README.md) — три запроса маркетплейса;
  первый прямо требует постраничного продолжения (§2), а таблицы из него — проверка §1 и §5: все
  ли компоненты ключа партиции удастся связать переменными.
- [`ex06_diagnose`](../exercises/ex06_diagnose/README.md) — p99 вырос втрое при здоровом кластере:
  разбор §4, §5 и §6, включая вопрос, чей таймаут сработал.
- [`ex04_consistency`](../exercises/ex04_consistency/README.md) — уровни для тех же сценариев; §3
  добавляет вопрос, какие из этих операций вообще можно повторять.

## Источники

- Apache Cassandra Java Driver 4.x, [Prepared statements](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/statements/prepared)
  — что приходит в `PREPARED`, включая «which bound variables are part of the partition key»; кэш
  по строке запроса без нормализации; переподготовка по `UNPREPARED`.
- Apache Cassandra Java Driver 4.x, [Paging](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/paging)
  — paging state как непрозрачный курсор, только вперёд и только для того же запроса; эмуляция
  смещения на клиенте и требование верхнего предела номера страницы.
- Apache Cassandra Java Driver 4.x, [Query idempotence](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/idempotence)
  — «retries and speculative executions only happen for idempotent statements», пример с
  non-frozen-списком, значение по умолчанию `false`.
- Apache Cassandra Java Driver 4.x, [Retries](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/retries)
  — пять случаев отказа и вердикт на каждый; какие методы вызываются только для идемпотентных
  запросов; что драйвер повторяет мимо политики.
- Apache Cassandra Java Driver 4.x, [Speculative execution](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/speculative_execution)
  — политика с фиксированной паузой, общий план запроса, «Cassandra does not support cancellation
  of in flight requests», расход номеров потоков в соединении.
- Apache Cassandra Java Driver 4.x, [Load balancing](https://github.com/apache/cassandra-java-driver/tree/4.x/manual/core/load_balancing)
  — план запроса с ключом маршрутизации и без него; откуда ключ берётся у подготовленного и у
  простого запроса; привязка к локальному ДЦ.
- DataStax Java Driver 4.17, [Configuration reference](https://docs.datastax.com/en/developer/java-driver/4.17/manual/core/configuration/reference/index.html)
  — значения по умолчанию, «a global limit on the duration of a `session.execute()` call, including
  any internal retries», предупреждение про тик таймера.
- Apache Cassandra 5.0, [Configuring / cassandra.yaml](https://cassandra.apache.org/doc/stable/cassandra/managing/configuration/cass_yaml_file.html)
  — `read_request_timeout`, `write_request_timeout`, `range_request_timeout` и комментарии «How
  long the coordinator should wait …».
- Apache Cassandra 5.0, [CQL / Data Definition](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/ddl.html)
  — табличное `speculative_retry`: упреждающий опрос лишней реплики координатором и ловушка
  перцентиля.
- Apache Cassandra JIRA, [CASSANDRA-6511](https://issues.apache.org/jira/browse/CASSANDRA-6511)
  — «extend LIMIT to define offset, row_count», открыта 19 декабря 2013 года, закрыта *Won't Fix*.

Проверено на одноузловом Apache Cassandra 5.0.9 с Apache Cassandra Java Driver 4.19.0 на Temurin
21.0.9+10: все выводы в блоках — из реальных прогонов; сценарии, требующие второго узла или второго
дата-центра, невоспроизводимы на таком стенде и подпёрты документацией, о чём сказано по месту.
