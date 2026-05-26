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

### Точность vs длина

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
- **Неравные ячейки** — прямоугольные ячейки не учитывают кривизну Земли; ближе к полюсам сильное искажение
- **Поиск соседей непрост** — найти 8 соседних geohash требует логики (а не просто +1 / −1)

### Применение

- Простой spatial search в РБД (PostgreSQL `WHERE substring(geohash,1,5) = 'XXXXX'`)
- Geohashing в Redis sorted sets (легко sort + range)

---

## S2 (Google)

Библиотека Google: разбивает sphere на cells через **Hilbert curve**. Преодолевает ограничения Geohash.

### Идея

- Земля → проекция на куб (6 граней)
- Каждая грань → рекурсивное разбиение на квадранты (как quadtree)
- Hilbert curve линеаризует ячейки: одномерный порядок сохраняет двумерную локальность

```
Cell IDs at level 30: ~1 cm²
Cell IDs at level 0: ~ 85 trillion km² (entire planet face)
```

### Свойства

- **Сферический:** корректно учитывает кривизну Земли;
- **Иерархический:** ID ячейки хранят иерархию родитель-потомок;
- **Сохраняет локальность:** соседние ячейки имеют похожие ID
- **Эффективный:** integer cell ID (8 байт), быстрое сравнение

### Применение

- **Google Maps** — внутреннее использование
- **Foursquare** — запросы по заведениям
- **MongoDB 2dsphere** — поддерживает S2-like
- **PostGIS** — также поддерживает

---

## H3 (Uber)

Библиотека Uber: гексагональная сетка. Каждая ячейка — шестиугольник (в отличие от прямоугольников в S2/quadtree).

### Зачем шестиугольники

- **Все соседи равноудалены** — у квадрата 8 соседей (4 близких + 4 диагональных, дальше); у hex — 6 соседей на равном расстоянии
- **Нет неопределённости в углах** — углы квадратов сложны («3-way intersection»)
- Удобно для подбора поездок: пассажир в одном шестиугольнике ищет водителей в соседних на одинаковом расстоянии

### Уровни разрешения

```
Resolution 0: ~ 4250 km² (large)
Resolution 15: ~ 1 m² (tiny)
Resolution 9 (popular for ride-share): ~ 0.1 km²
```

### Применение

- **Uber** — поиск драйверов в окрестности
- **Foursquare** — поиск мест вблизи
- **DoorDash** — зона доставки
- **Kepler.gl** — визуализация

### vs S2 vs Geohash

| | Geohash | S2 | H3 |
|---|---|---|---|
| Форма ячейки | Прямоугольник | Квадрат (на face) | Шестиугольник |
| Соседи равноудалены | No | No | **Yes** |
| Сортируемые ID | **Yes** (строки) | Yes (целые) | Yes (uint64) |
| Иерархичность | Yes | **Yes** (родитель-потомок) | Yes |
| Открытый исходный код | Yes | **Yes** | **Yes** |
| Уровни разрешения | 12 | 30 | 15 |
| Распространённость | Simple | Google services | Uber |

---

## Quadtree

Рекурсивное разбиение 2D-плоскости. Каждый узел делится на 4 квадранта при превышении threshold.

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

### Запрос

```python
def find_nearby(point, radius, node):
    if node.boundary intersect circle(point, radius):
        if node is leaf:
            return [p for p in node.points if distance(point, p) <= radius]
        else:
            return concat(find_nearby(point, radius, child) for child in node.children)
    return []
```

### Применение

- **In-memory spatial index** для игровых карт, RTS
- **PostGIS** — альтернатива R-tree
- **Image processing** (квадратные деревья изображений)

### Ограничения

- **Неравномерные данные** — если все точки в одной области → разбалансированное дерево, глубокое
- **Вставка / удаление** — может требовать rebalance

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

### Запрос

`WHERE point inside MBR` — спускаемся по дереву, отсекаем поддеревья, чьи MBR не пересекают запрос.

### Свойства

- **Сбалансированный** — глубина ограничена
- **Удобен для обновлений** — insert находит самое плотное MBR, обновления идут вверх
- **Поддерживает** произвольные формы (не только точки): полигоны, линии

### Применение

- **PostGIS** — GiST-индекс по сути вариант R-tree
- **MongoDB** 2dsphere index
- **SQLite** R*Tree module
- **Пространственные соединения:** «найти все дороги, пересекающие этот прямоугольник»

### R+ tree, R* tree

Оптимизации: лучшие эвристики split, меньше пересекающихся MBR.

---

## Выбор хранилища / индекса

| Хранилище | Лучший индекс | Примечание |
|-------|-----------|------|
| **PostgreSQL** | GiST с PostGIS (R-tree-like) | Отраслевой стандарт для геоданных в РСУБД |
| **MongoDB** | 2dsphere (S2) | Нативные геозапросы |
| **Elasticsearch** | geo_point / geo_shape (BKD tree) | Полнотекстовый поиск + пространственный |
| **Redis** | GEO commands (geohash + sorted set) | Быстро, всё в памяти |
| **Cassandra** | Нет нативного — вручную через geohash-ключ |
| **In-memory** | H3 / S2 / Quadtree library | Оптимально для высоконагруженных сервисов |

---

## Типовые запросы

### Точка в полигоне (point-in-polygon)

«Находится ли пользователь в зоне доставки?»
- Spatial DB: `ST_Within(point, polygon)`
- H3/S2: найти шестиугольник, содержащий точку, проверить принадлежность

### Ближайший сосед (k-NN)

«10 ближайших водителей к пассажиру»
- R-tree / GiST: поиск методом ветвей и границ (branch-and-bound)
- H3: найти шестиугольник пассажира, загрузить водителей из него и соседних, отсортировать по расстоянию

### Запрос по радиусу (range query)

«Все водители в радиусе 5 км»
- Spatial DB: `ST_DWithin(rider_point, driver_point, 5000)`
- H3/S2: вычислить набор ячеек, покрывающих радиус, загрузить все, отфильтровать точно

### Геозонирование (geofencing)

«Пользователь вошёл в зону доставки — отправить уведомление»
- Полигон хранится заранее, точка проверяется при каждом обновлении местоположения пользователя

---

## Типичные ошибки

- **Порядок lat/lon** — разный в разных API (PostgreSQL: lat, lon; GeoJSON: lon, lat) — источник багов!
- **Форма Земли** — плоское 2D-расстояние ≠ great-circle distance. Для длинных дистанций (>10 км) — Haversine или проекция
- **Антимеридиан** — lon = ±180 заворачивается. Запросы через эту линию требуют отдельной обработки
- **Сингулярность полюсов** — географические проекции искажаются у полюсов
- **Частые обновления** — движущиеся объекты (водители, машины): стоимость обновления индекса. Часто: не индексируем в БД, держим в памяти (Redis), пишем в БД батчами

---

## Реальная архитектура (в стиле Uber)

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

**Библиотеки / документация:**
- [Google S2 Geometry Library](https://s2geometry.io/) — C++, has bindings
- [Uber H3 Library](https://h3geo.org/) — C, has bindings to JS/Py/Go/Java
- [PostGIS Documentation](https://postgis.net/documentation/)
- [Redis Geospatial Commands](https://redis.io/commands/?group=geo)

**Инженерные блоги:**
- [Uber — H3: A Hexagonal Hierarchical Geospatial Indexing System](https://www.uber.com/blog/h3/)
- [Foursquare — Using S2 for spatial indexing](https://medium.com/foursquare-direct/)
- [DoorDash — Building flexible polygon services for delivery zones](https://doordash.engineering/)
