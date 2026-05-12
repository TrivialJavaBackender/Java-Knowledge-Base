# Indexes in PostgreSQL

## Почему нет кластерных индексов

В SQL Server / MySQL InnoDB кластерный индекс — физическое хранение строк в порядке ключа. В PostgreSQL это невозможно из-за MVCC: UPDATE пишет новый tuple туда, где есть место — физический порядок немедленно нарушается. Команда `CLUSTER` существует, но одноразовая, требует `ACCESS EXCLUSIVE` lock и деградирует после первого же UPDATE.

PostgreSQL компенсирует через **Index-Only Scan** и **covering indexes**.

---

## B-tree (по умолчанию)

`CREATE INDEX` без указания типа создаёт B-tree. Сбалансированное дерево, все листовые узлы на одной глубине.

**Операторы:** `=`, `<`, `>`, `<=`, `>=`, `BETWEEN`, `IN`, `IS NULL`, `LIKE 'foo%'` (только prefix).

```sql
CREATE INDEX ON reservations(res_date);
CREATE UNIQUE INDEX ON users(email);

-- Составной: использовать для (table_id) или (table_id, res_date),
-- но НЕ для (res_date) отдельно — leftmost prefix rule
CREATE INDEX ON reservations(table_id, res_date);
```

**Index-Only Scan** — если запрос запрашивает только колонки из индекса, heap не нужен:
```sql
CREATE INDEX ON orders(user_id, created_at);
SELECT user_id, created_at FROM orders WHERE user_id = 42; -- Index-Only Scan
```

**INCLUDE — covering index** — добавить колонки только для покрытия, без участия в поиске:
```sql
CREATE INDEX ON orders(user_id) INCLUDE (total_amount);
SELECT total_amount FROM orders WHERE user_id = 42; -- Index-Only Scan
-- Разница с (user_id, total_amount): INCLUDE-колонки не влияют на сортировку и WHERE
```

---

## Hash

Поддерживает **только `=`**. Компактнее B-tree при длинных ключах (UUID, токены).

```sql
CREATE INDEX ON sessions USING hash(session_token);
```

**Ограничения:** нет `<`/`>`, нет составных, нет сортировки. На практике B-tree на коротких ключах не медленнее → Hash используется редко.

---

## GIN (Generalized Inverted Index)

Для каждого **элемента** составного значения хранит список строк, где он встречается. Применение: `jsonb`, массивы, полнотекстовый поиск.

```sql
-- Массивы
CREATE INDEX ON products USING gin(tags);
SELECT * FROM products WHERE tags @> ARRAY['sale', 'new']; -- содержит все

-- JSONB
CREATE INDEX ON events USING gin(payload);
SELECT * FROM events WHERE payload @> '{"type": "click"}';
SELECT * FROM events WHERE payload ? 'user_id'; -- ключ существует

-- Полнотекст
CREATE INDEX ON articles USING gin(to_tsvector('english', body));
SELECT * FROM articles WHERE to_tsvector('english', body) @@ to_tsquery('postgres & index');
```

**Характеристики:** быстрые запросы, медленные обновления (дорого обновлять инвертированный индекс), большой размер.

---

## GiST (Generalized Search Tree)

Для нестандартных типов: близость, пересечение, вхождение. Extensible framework.

```sql
-- Range types — для EXCLUDE constraint
CREATE INDEX ON reservations USING gist(time_range);
EXCLUDE USING gist(table_id WITH =, time_range WITH &&);

-- Геометрия (PostGIS)
CREATE INDEX ON locations USING gist(coordinates);

-- Полнотекст (альтернатива GIN)
CREATE INDEX ON articles USING gist(to_tsvector('english', body));
```

**GiST vs GIN для полнотекста:**

| | GIN | GiST |
|---|---|---|
| Скорость запросов | Быстрее | Медленнее |
| Скорость обновлений | Медленнее | Быстрее |
| Размер | Больше | Меньше |
| Lossy (recheck) | Нет | Да |

GiST может возвращать false positives — PostgreSQL дополнительно перепроверяет по heap.

---

## BRIN (Block Range INdex)

Хранит **min/max** для диапазонов физических страниц. Размер индекса в сотни раз меньше B-tree.

```sql
CREATE INDEX ON events USING brin(created_at);
```

**Работает только если** данные физически упорядочены по колонке — append-only таблицы: логи, события, временные ряды. Бесполезен при произвольных вставках.

```sql
-- Проверить корреляцию (близко к 1.0 = хорошо):
SELECT correlation FROM pg_stats WHERE tablename='events' AND attname='created_at';
```

---

## Partial Index

Строится только по **подмножеству строк** — тех, что удовлетворяют WHERE.

```sql
-- Индексируем только незакрытые заказы — их мало
CREATE INDEX ON orders(user_id) WHERE status != 'completed';

-- Уникальность только для активных записей
CREATE UNIQUE INDEX ON users(email) WHERE deleted_at IS NULL;
```

Запрос должен содержать то же условие WHERE. Индекс на 10% строк работает в 10 раз быстрее.

---

## Expression Index

Строится по **результату выражения**.

```sql
-- Поиск без учёта регистра
CREATE INDEX ON users(lower(email));
SELECT * FROM users WHERE lower(email) = lower('User@Example.com');

-- Индекс по полю jsonb
CREATE INDEX ON events((payload->>'user_id'));
SELECT * FROM events WHERE payload->>'user_id' = '42';

-- Индекс по дате из timestamp
CREATE INDEX ON orders((created_at::date));
```

PostgreSQL использует expression index только если запрос содержит **точно такое же выражение**.

---

## pg_trgm — нечёткий поиск по подстроке

**pg_trgm** (trigram) — расширение для нечёткого и substring-поиска. Trigram — тройка последовательных символов. `"hello"` → `"  h"`, `" he"`, `"hel"`, `"ell"`, `"llo"`, `"lo "`.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN-индекс для substring-поиска (быстрее чем GiST для запросов)
CREATE INDEX ON products USING gin(name gin_trgm_ops);

-- Теперь LIKE '%middle%' использует индекс (обычно нет!)
SELECT * FROM products WHERE name LIKE '%laptop%';

-- Нечёткий поиск по схожести
SELECT name, similarity(name, 'macbook') AS sim
FROM products
WHERE name % 'macbook'          -- оператор % = similarity > pg_trgm.similarity_threshold (default 0.3)
ORDER BY sim DESC;

-- Расстояние Левенштейна
SELECT levenshtein('kitten', 'sitting'); -- 3
```

**Когда использовать:**
- `LIKE '%text%'` — обычный B-tree не работает, pg_trgm GIN — работает
- Поиск "похожих" слов (опечатки, fuzzy matching)
- Поиск по части имени/адреса/продукта

**GIN vs GiST для pg_trgm:**
- GIN: быстрее поиск, медленнее обновление, больше размер
- GiST: быстрее обновление, поддерживает операторы `<->` (расстояние)

---

## EXPLAIN и EXPLAIN ANALYZE

`EXPLAIN` — план запроса без выполнения. `EXPLAIN ANALYZE` — выполняет запрос, показывает реальное время.

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 42;
-- Seq Scan on orders  (cost=0.00..1234.00 rows=10 width=64)

EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 42;
-- Index Scan using orders_user_id_idx on orders
--   (cost=0.29..8.31 rows=1 width=64)
--   (actual time=0.023..0.024 rows=1 loops=1)
-- Planning Time: 0.1 ms
-- Execution Time: 0.045 ms
```

**Ключевые термины:**

| Термин | Что означает |
|--------|-------------|
| `Seq Scan` | Полный скан таблицы — индекс не используется |
| `Index Scan` | Скан по индексу + обращение к heap за строками |
| `Index Only Scan` | Скан по индексу, heap не нужен (covering index) |
| `Bitmap Heap Scan` | Сначала собирает bitmap страниц из индекса, потом читает heap |
| `cost=A..B` | A — startup cost, B — total cost (в условных единицах) |
| `rows=N` | Оценка числа строк (у ANALYZE — реальное) |
| `actual time=X..Y` | Реальное время: X — до первой строки, Y — всего |
| `loops=N` | Сколько раз узел выполнялся (nested loop) |

**Почему оптимизатор выбрал Seq Scan вместо Index Scan?**
- Таблица маленькая → seq scan дешевле
- Selectivity низкая (много строк подходит) → индекс не поможет
- Устаревшая статистика → `ANALYZE tablename` для обновления
- `enable_seqscan = off` можно принудительно отключить для тестирования

**EXPLAIN ANALYZE с подробностями:**
```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT o.id, u.email
FROM orders o JOIN users u ON o.user_id = u.id
WHERE o.status = 'pending';

-- Buffers: shared hit=5 read=2
-- hit — из shared_buffers (RAM), read — с диска
-- Много "read" при маленьком "hit" → нет в кэше, медленно
```

**Как читать JOIN в плане:**
```
Hash Join  (cost=...)
  Hash Cond: (o.user_id = u.id)
  -> Seq Scan on orders o  (filter: status='pending')
  -> Hash
       -> Index Scan on users u
```
Nested Loop — хорош при маленьком outer, Hash Join — при большом, Merge Join — при отсортированных данных.

---

## Шпаргалка

| Тип данных / запрос | Индекс |
|---|---|
| Числа, даты, строки, `=` `<` `>` `LIKE 'x%'` | **B-tree** (по умолчанию) |
| Только `=` на длинных ключах (UUID, токены) | **Hash** |
| `jsonb`, массивы, `@>`, `?`, `&&` | **GIN** |
| Полнотекстовый поиск, высокая запись | **GiST** |
| Полнотекстовый поиск, быстрые запросы | **GIN** |
| Геометрия, ranges, пересечения (`EXCLUDE`) | **GiST** |
| Временные ряды, логи, append-only | **BRIN** |
| IP-адреса, точки, префиксы строк | **SP-GiST** |
| Только часть строк (`WHERE status='active'`) | **Partial B-tree** |
| Поиск по `lower(col)`, выражениям | **Expression B-tree** |
| Покрыть запрос без обращения к heap | **Covering / INCLUDE** |
| Нечёткий поиск, `LIKE '%middle%'`, опечатки | **GIN/GiST + pg_trgm** |

---

## Источники

**Официальная документация:**
- [PostgreSQL 16 — Chapter 11. Indexes](https://www.postgresql.org/docs/16/indexes.html) — все типы индексов, операторы, expression/partial/INCLUDE.
- [PostgreSQL — `EXPLAIN` reference](https://www.postgresql.org/docs/16/sql-explain.html) и [Using EXPLAIN](https://www.postgresql.org/docs/16/using-explain.html).
- [`pg_trgm` extension docs](https://www.postgresql.org/docs/16/pgtrgm.html)
- [PostgreSQL — Index-Only Scans and Covering Indexes](https://www.postgresql.org/docs/16/indexes-index-only-scans.html)

**Книги:**
- [*Use The Index, Luke!* (Markus Winand)](https://use-the-index-luke.com/) — лучший практический справочник по индексам и плану выполнения, бесплатно онлайн.
- *Database Internals* (Alex Petrov, O'Reilly 2019) — Ch. 2 (B-Tree Basics), Ch. 4 (Implementing B-Trees).
- *PostgreSQL 14 Internals* (Egor Rogov, бесплатно от Postgres Pro) — раздел про MVCC и индексы.

**Engineering blogs:**
- [Heikki Linnakangas — PostgreSQL committer blog](https://hlinnaka.iki.fi/) — глубокие посты про реализацию индексов.
- [Bruce Momjian — PostgreSQL performance presentations](https://momjian.us/presentations/) — особенно «Explaining the Postgres Query Optimizer».
- [«ARC: a self-tuning, low-overhead replacement cache» (Megiddo & Modha, USENIX FAST '03)](https://www.usenix.org/legacy/publications/library/proceedings/fast03/tech/full_papers/megiddo/megiddo.pdf) — важно для понимания page cache, на котором построены индексы.
