# Design Problem: Ride Sharing (Uber / Lyft)

Сопоставить rider'а с ближайшим driver'ом в реальном времени, рассчитать ETA, обработать платёж. Главные challenges: **geospatial matching**, **surge pricing**, **частые обновления локации** драйверов.

---

## 1. Requirements

### Functional
- Rider запрашивает поездку (origin, destination)
- Система находит ближайшего доступного driver'а
- Real-time tracking: driver → pickup → drop-off
- Оценка ETA
- Обработка платежа
- Surge pricing при высоком спросе

### Non-functional
- **Низкая latency matching** — < 5 сек от запроса до уведомления driver'а
- **High availability** — миллионы поездок в день
- **Точный location tracking** — driver обновляет позицию каждые 3–5 сек
- **Geo-масштаб** — глобально, multi-region

---

## 2. Estimation

```
100M пользователей в месяц, 10M DAU
Пик 1M одновременно активных driver'ов
Обновления локации driver'ов: 1M × раз в 4 сек = 250K writes/sec для location-сервиса
Запросы поездок: пик 5K/sec
Всего поездок в день: 10M+ глобально
```

---

## 3. API

```http
POST /api/v1/rides
Body: { origin: {lat, lon}, destination: {lat, lon}, vehicleType }
→ { rideId, estimatedDriver, estimatedFare, status: "matching" }

GET /api/v1/rides/:id
→ { status, driver, currentDriverLocation, ETA }

PATCH /api/v1/drivers/:id/location
Body: { lat, lon, heading }
→ 204

WebSocket /rides/:id/track
  ← real-time-обновления позиции driver'а
```

---

## 4. High-level архитектура

```
Rider App / Driver App
  ↓
LB → API Gateway
  ↓
  ├──→ Ride Service (request, match, lifecycle)
  ├──→ Location Service (позиции driver'ов, geosearch)
  ├──→ Driver Service (профили, статусы)
  ├──→ Payment Service
  ├──→ Notification Service (push в driver app)
  ↓
БД:
  - Cassandra (история поездок, денормализовано)
  - Redis (локации driver'ов, hex-ячейки)
  - PostgreSQL (drivers, riders, payments)
```

---

## 5. Location tracking

Самая критичная по масштабу часть.

### Driver app шлёт обновление каждые 4 сек

```
DriverApp → POST /location { driverId, lat, lon, heading }
  ↓
Location Service:
  - Вычислить H3-ячейку resolution 9 (~0.1 км²): cellId
  - Если driver сменил ячейку:
      ZREM old_cell:drivers driverId
      ZADD new_cell:drivers driverId
  - Обновить HASH driver:{id} текущими lat, lon
```

**Хранение:** Redis (in-memory, быстрые обновления).

```redis
HSET driver:123 lat 37.7749 lon -122.4194 status available
ZADD cell:8a283082adbffff drivers 0 driver:123   # score — фиктивный, нужен лишь membership
```

**Масштаб:** 1M driver'ов × частота 4 сек = 250K writes/sec → Redis Cluster на 5–10 shards.

---

## 6. Алгоритм matching'а

Rider запрашивает поездку из точки (lat, lon).

```
1. Вычисляем H3-ячейку для pickup (resolution 9 ~200 м)
2. Берём соседние ячейки: 1–2 hex ring'а (~1 км радиус)
3. Достаём доступных driver'ов из этих ячеек из Redis
4. Оцениваем кандидатов:
   - расстояние до rider'а (Haversine)
   - рейтинг driver'а
   - ETA с учётом трафика
   - время ожидания driver'а (справедливость очереди)
5. Шлём match-запрос top-кандидату
6. У driver'а 15 сек на подтверждение
7. При отказе / timeout → следующий driver
```

Lookup по ячейкам: O(1), Redis SMEMBERS / ZRANGE.

```
candidates = []
for cell in get_cell_with_neighbors(rider_lat, rider_lon, ring=2):
    candidates += redis.zrange(f"cell:{cell}:drivers", 0, -1)
# Отфильтровать доступных, посчитать расстояние, отсортировать, послать топу
```

---

## 7. Geospatial indexing (глубже)

См. теорию в [`GEOSPATIAL.md`](GEOSPATIAL.md).

### Uber использует H3 (гексагональная сетка)

- Resolution 9 (~0.1 км²) для matching
- Resolution 7 (~5 км²) для зон surge pricing
- Resolution 5 для аналитики уровня города

### Почему hex (а не квадраты или круги)

- Все 6 соседей равноудалены
- Нет «угловой» неоднозначности
- Плотная упаковка лучше покрывает площадь

### Используемые функции H3

- `latLngToCell(lat, lon, res)` — получить ID ячейки
- `cellToBoundary(cell)` — координаты полигона
- `kRing(cell, k)` — ячейки в радиусе k шагов
- `cellToParent(cell, parentRes)` — иерархическая агрегация

---

## 8. Жизненный цикл поездки

```
Состояния: requested → matching → matched → enroute_pickup →
           arrived → in_progress → completed → paid

State machine в БД, переходы — через библиотеку state-machine:
  если state == "matching" и driver_accepted → "matched"
  если state == "matched" и driver_near_pickup → "arrived"
  и т. д.
```

**События** в Kafka на каждом переходе:
- `ride_matched` → уведомить rider'а, диспатчить driver'а
- `ride_completed` → запустить обработку платежа
- `ride_canceled` → очистка, уведомления

---

## 9. Расчёт ETA

ETA = время в пути от текущей позиции driver'а до pickup.

### Naive: прямая дистанция / средняя скорость

Низкая точность. Не учитывает трафик.

### Лучше: routing-сервис

Свой или сторонний (Google Maps Directions API, OSRM поверх OpenStreetMap).

Вход routing'а: координаты origin → destination + текущее время.
Выход: маршрут, расстояние, ETA (с учётом данных о трафике).

### Кэширование запросов ETA

Идентичные недавние запросы — TTL ~30 сек (трафик не меняется резко).

### Real-time-обновления

Пока driver enroute, пересчитываем ETA каждые 30 сек по реальной позиции. Push в rider app по WebSocket.

---

## 10. Surge pricing

При высоком спросе (rides:drivers > 1) — повысить цены, чтобы:
- Снизить часть спроса → меньше rides
- Привлечь больше driver'ов в зону → больше supply

### Алгоритм

```
Для каждой surge-зоны (H3-ячейка resolution 7, ~5 км²):
  active_rides_in_zone = count
  available_drivers_in_zone = count
  ratio = rides / max(drivers, 1)
  
  если ratio > 1.5: surge_multiplier = 1.5×
  если ratio > 2.0: surge_multiplier = 2.0×
  ...
  если ratio > 5.0: surge_multiplier = 5.0× (максимум)
```

Multiplier применяется при расчёте fare. Пользователю сообщаем до подтверждения («surge 2.5×»).

### Хранение

Состояние surge на зону — в Redis с TTL 1–2 мин. Пересчёт периодический.

---

## 11. Обработка платежа

```
Поездка завершена →
  fare = base + (distance × rate) + (time × rate) + (surge × ...) + tip
  ↓
  Списание с сохранённого способа оплаты rider'а (Stripe, Braintree)
  ↓
  Async: выплата driver'у (с задержкой в несколько дней)
```

**Идемпотентность:** обработка платежа с idempotency key (rideId) — retry не приводит к двойному списанию.

**Failure handling:**
- Карта отклонена → уведомить rider'а, придержать поездку
- Stripe down → retry с backoff, очередь на потом
- Disputes → очередь ручного разбора

---

## 12. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| Driver принял, но перестал отвечать | Timeout 15 сек, переходим к следующему driver'у |
| У rider'а плохое покрытие сети | Локальный кэш последней известной позиции driver'а, показываем «driver рядом» |
| Спайк surge — driver'ов нет | Показываем «driver'ы недоступны», предлагаем позже |
| Stripe outage | Платёж в очередь, retry; поездка идёт |
| Региональный сбой (us-west-2) | Multi-region failover (каждый регион обслуживает свою территорию) |

---

## 13. Multi-region

Uber работает глобально. У каждого региона (Африка, Азия, EU, NA, SA) своя инфраструктура.

- **Riders / drivers** шардированы по региону
- **Trips** в региональной БД
- **Cross-region** — только агрегированная аналитика
- **Global-сервисы** — auth, payments (потенциально централизованы с региональными кэшами)

Trip-БД: Cassandra с datacenter-aware replication.

---

## 14. Trade-offs

### Push vs pull локаций driver'ов

- **Push (этот дизайн)** — driver app шлёт обновления каждые 4 сек
- **Pull** — сервер запрашивает по требованию. Не работает: сервер не знает, кого спрашивать

### Частота обновления локации

- **Чаще (раз в 1 сек)** — точнее, но стоимость в 4 раза выше (250K → 1M writes/sec)
- **Реже (раз в 10 сек)** — дешевле, но устаревшие данные для matching'а
- **Adaptive** — высокая частота при активном matching'е, низкая в idle

### Centralized matching vs distributed

- **Центральный сервис** — глобальный взгляд на supply/demand
- **Distributed (per-city)** — масштабируется, изоляция сбоев. Uber фактически использует региональные dispatcher-сервисы

---

## 15. Антипаттерны

- **Single-shard таблица «drivers»** — не вытянет 1M обновлений локации в секунду
- **SQL geospatial-запрос (Haversine по каждой строке)** — слишком медленно
- **Долгая matching-транзакция** — блокировки. Делать async matching через state machine
- **Sync-запись в durable-БД на каждое обновление локации** — overkill. Redis ephemeral, в БД только финальные данные поездки

---

## Источники

- *System Design Interview Vol. 2* (Alex Xu) — глава о Proximity Service / Uber
- [Uber Engineering — H3: Hexagonal Hierarchical Geospatial Indexing](https://www.uber.com/blog/h3/)
- [Uber Engineering — DISCO: dispatch system](https://www.uber.com/blog/dispatch-optimization/)
- [Uber's Marketplace — surge pricing](https://www.uber.com/blog/algorithms-tools-for-network-optimization/)
- [Hello Interview — Uber](https://www.hellointerview.com/learn/system-design/problem-breakdowns/uber)
- [Lyft Engineering — Matching backend](https://eng.lyft.com/)
