# Geospatial Indexing

Способы быстро отвечать на «найди объекты рядом со мной» на масштабе. Используются в Uber, Tinder, Yelp, Foursquare, Lyft, DoorDash, любых сервисах с привязкой к локации.

---

## Зачем нужно

Запрос: «найди ближайшие 100 водителей в радиусе 5 км от координат `(lat, lon)`».

**Naive:**
```sql
SELECT * FROM drivers
WHERE earth_distance(lat, lon, driver_lat, driver_lon) < 5000
ORDER BY distance ASC LIMIT 100;
```

→ Full table scan, расчёт расстояния на каждую строку. На 1M водителей — секунды.

**Решение:** **пространственный индекс** — структура, разбивающая 2D-плоскость на регионы, чтобы запрос обходил только нужные.

---

## Geohash

Кодирует `(lat, lon)` в **строку**. Сортируема, общий префикс = соседние точки.

### Алгоритм

1. Lat range `[-90, +90]`, Lon range `[-180, +180]`.
2. Interleave bits: 1 bit lat, 1 bit lon, 1 bit lat, ...
3. Encode bits в base32: каждые 5 bits → 1 char.

```
(37.7749, -122.4194)  # San Francisco
→ binary representation
→ "9q8yyzd6kr"  # geohash precision 10 (~ 1 m)
```

### Precision vs size

| Length | Precision |
|--------|-----------|
| 1 | ~5000 km |
| 3 | ~150 km |
| 5 | ~5 km |
| 6 | ~600 m |
| 7 | ~76 m |
| 8 | ~19 m |
| 12 | ~37 mm |

### Свойства

- **Сортируется** — близкие места имеют общий префикс (`"9q8yyz"` vs `"9q8yya"`);
- **Лексикографический поиск** — `WHERE geohash LIKE '9q8yy%'` найдёт всё в этой ячейке;
- **Экономный по хранилищу** — строка (10–12 символов).

### Ограничения

- **Эффект границы** — точка рядом с границей geohash (например, на экваторе) имеет совсем другой geohash, чем сосед в нескольких метрах
- **Неравные ячейки** — прямоугольные boxes не учитывают кривизну Земли; ближе к полюсам сильное искажение
- **Поиск соседей непрост** — найти 8 соседних geohash требует логики (а не просто +1 / −1)

### Use cases

- Простой spatial search в РБД (PostgreSQL `WHERE substring(geohash,1,5) = 'XXXXX'`)
- Geohashing в Redis sorted sets (легко sort + range)

---

## S2 (Google)

Google's library: разбивает sphere на cells через **Hilbert curve**. Преодолевает Geohash limitations.

### Идея

- Earth → проекция на cube (6 faces)
- Каждый face → recursive quadrant subdivision (как quadtree)
- Hilbert curve linearizes cells: 1D ordering preserves 2D locality

```
Cell IDs at level 30: ~1 cm²
Cell IDs at level 0: ~ 85 trillion km² (entire planet face)
```

### Свойства

- **Сферический:** корректно учитывает кривизну Земли;
- **Иерархический:** ID ячейки хранят иерархию родитель-потомок;
- **Сохраняет локальность:** соседние ячейки имеют похожие ID
- **Efficient:** integer cell ID (8 байт), быстрое сравнение

### Use cases

- **Google Maps** — внутреннее использование
- **Foursquare** — venue queries
- **MongoDB 2dsphere** — supports S2-like
- **PostGIS** — также supports

---

## H3 (Uber)

Uber's library: hexagonal grid. Each cell is a hexagon (vs squares в S2/quadtree).

### Зачем hexagons

- **Все соседи равноудалены** — у квадрата 8 соседей (4 близких + 4 диагональных, дальше); у hex — 6 соседей на равном расстоянии
- **Нет неопределённости в углах** — углы квадратов сложны («3-way intersection»)
- Удобно для ride-matching: rider в одной hex ищет драйверов в соседних hex одинаково

### Levels

```
Resolution 0: ~ 4250 km² (large)
Resolution 15: ~ 1 m² (tiny)
Resolution 9 (popular for ride-share): ~ 0.1 km²
```

### Use cases

- **Uber** — поиск драйверов в окрестности
- **Foursquare** — exploration
- **DoorDash** — delivery radius
- **Kepler.gl** — visualization

### vs S2 vs Geohash

| | Geohash | S2 | H3 |
|---|---|---|---|
| Cell shape | Rectangle | Square (на face) | Hexagon |
| Neighbors equidistant | No | No | **Yes** |
| Sortable IDs | **Yes** (strings) | Yes (integers) | Yes (uint64) |
| Hierarchical | Yes | **Yes** (parent-child) | Yes |
| Open source | Yes | **Yes** | **Yes** |
| Resolution levels | 12 | 30 | 15 |
| Adoption | Simple | Google services | Uber |

---

## Quadtree

Рекурсивное разбиение 2D-плоскости. Каждая нода делится на 4 квадранта при превышении threshold.

```
Root: whole world
  ├─ NW quadrant (split when > 100 items)
  │   ├─ NW.NW
  │   ├─ NW.NE
  │   ├─ NW.SW
  │   └─ NW.SE
  ├─ NE quadrant
  ├─ SW quadrant
  └─ SE quadrant
```

### Query

```python
def find_nearby(point, radius, node):
    if node.boundary intersect circle(point, radius):
        if node is leaf:
            return [p for p in node.points if distance(point, p) <= radius]
        else:
            return concat(find_nearby(point, radius, child) for child in node.children)
    return []
```

### Use cases

- **In-memory spatial index** для игровых карт, RTS
- **PostGIS** — альтернатива R-tree
- **Image processing** (квадратные деревья изображений)

### Ограничения

- **Skewed data** — если все точки в одной области → разбалансированное дерево, глубокое
- **Insert / delete** — может требовать rebalance

---

## R-tree

R-tree группирует объекты в **bounding rectangles** (MBR — Minimum Bounding Rectangle). Иерархия:

```
Root MBR (covers whole)
  ├─ MBR child 1 (covers items A, B, C)
  │   ├─ Item A (its own MBR)
  │   ├─ Item B
  │   └─ Item C
  ├─ MBR child 2 (covers D, E)
  ...
```

### Query

`WHERE point inside MBR` — спускаемся по дереву, отсекаем поддеревья, чьи MBR не пересекают запрос.

### Свойства

- **Balanced** — глубина ограничена
- **Update-friendly** — insert находит самое плотное MBR, обновления идут вверх
- **Поддерживает** произвольные формы (не только точки): полигоны, линии

### Use cases

- **PostGIS** — GiST-индекс по сути вариант R-tree
- **MongoDB** 2dsphere index
- **SQLite** R*Tree module
- **Spatial joins:** «find all roads intersecting this rectangle»

### R+ tree, R* tree

Оптимизации: лучшие эвристики split, меньше пересекающихся MBR.

---

## Storage / Index choice

| Store | Best Index | Note |
|-------|-----------|------|
| **PostgreSQL** | GiST с PostGIS (R-tree-like) | Industry standard for spatial in RDBMS |
| **MongoDB** | 2dsphere (S2) | Geospatial queries native |
| **Elasticsearch** | geo_point / geo_shape (BKD tree) | Full-text + spatial combined |
| **Redis** | GEO commands (geohash + sorted set) | Fast in-memory |
| **Cassandra** | No native spatial — manual via geohash key |
| **In-memory** | H3 / S2 / Quadtree library | Best for high-perf services |

---

## Common queries

### Point-in-polygon

«Is user inside delivery area?»
- Spatial DB: `ST_Within(point, polygon)`
- H3/S2: get hex containing point, check membership

### Nearest neighbor (k-NN)

«Top 10 closest drivers to rider»
- R-tree / GiST: branch-and-bound NN search
- H3: get rider's hex, fetch drivers in same/neighboring hexes, sort by distance

### Range query (radius search)

«All drivers within 5 km»
- Spatial DB: `ST_DWithin(rider_point, driver_point, 5000)`
- H3/S2: compute set of cells covering radius, fetch all, filter exact

### Geofencing

«User entered delivery zone, send notification»
- Polygon stored, point checked on each user update

---

## Pitfalls

- **Порядок lat/lon** — разный в разных API (PostgreSQL: lat, lon; GeoJSON: lon, lat) — источник багов!
- **Форма Земли** — плоское 2D-расстояние ≠ great-circle distance. Для длинных дистанций (>10 км) — Haversine или проекция
- **Антимеридиан** — lon = ±180 заворачивается. Запросы через эту линию требуют отдельной обработки
- **Сингулярность полюсов** — географические проекции искажаются у полюсов
- **Update churn** — движущиеся объекты (драйверы, машины): стоимость обновления индекса. Часто: не индексируем в БД, держим in-memory (Redis), батчим записи в БД

---

## Real-world architecture (Uber-style)

```
Driver app → GPS update every 4s → Driver location service
  → Stores in Redis (hash by driverId)
  → Stores H3 cell membership (Redis sorted set per cell)

Rider app → request ride at (lat, lon)
  → Compute H3 cell for (lat, lon) (resolution 9 ~ 200m)
  → Get neighboring cells (1-2 hex rings)
  → Redis: fetch driver IDs in these cells
  → Compute exact distance + ETA per driver
  → Send top K to dispatch algorithm
```

Задержка: < 50 мс всего. Без SQL-запросов, всё в памяти.

---

## Источники

**Papers:**
- [Guttman (1984) — «R-Trees: A Dynamic Index Structure for Spatial Searching»](http://www-db.deis.unibo.it/courses/SI-LS/papers/Gut84.pdf)
- [Beckmann et al. (1990) — «The R*-tree: An Efficient and Robust Access Method for Points and Rectangles»](https://www.dpi.inpe.br/Cursos/sib-2009/material/aula07/papers/r-star_tree.pdf)
- [Niemeyer (2008) — Geohash explained](https://web.archive.org/web/20080305223755/http://blog.labix.org/2008/02/26/geohash-explanation)

**Libraries / documentation:**
- [Google S2 Geometry Library](https://s2geometry.io/) — C++, has bindings
- [Uber H3 Library](https://h3geo.org/) — C, has bindings to JS/Py/Go/Java
- [PostGIS Documentation](https://postgis.net/documentation/)
- [Redis Geospatial Commands](https://redis.io/commands/?group=geo)

**Engineering blogs:**
- [Uber — H3: A Hexagonal Hierarchical Geospatial Indexing System](https://www.uber.com/blog/h3/)
- [Foursquare — Using S2 for spatial indexing](https://medium.com/foursquare-direct/)
- [DoorDash — Building flexible polygon services for delivery zones](https://doordash.engineering/)
