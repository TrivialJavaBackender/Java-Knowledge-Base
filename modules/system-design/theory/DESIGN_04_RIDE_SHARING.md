# Design Problem: Ride Sharing (Uber/Lyft)

Сопоставить rider с ближайшим driver в реальном времени, рассчитать ETA, обработать платёж. Главные challenges: **geospatial matching**, **surge pricing**, **driver location updates** в high frequency.

---

## 1. Requirements

### Functional
- Rider requests ride (origin, destination)
- System matches с ближайшим available driver
- Real-time tracking: driver → pickup → drop-off
- ETA estimation
- Payment processing
- Surge pricing during high demand

### Non-functional
- **Low latency matching** — < 5 sec from request к driver notified
- **Highly available** — millions of trips/day
- **Accurate location tracking** — драйверы update каждые 3-5 sec
- **Geographic scale** — global, multi-region

---

## 2. Estimation

```
100M monthly riders, 10M daily active
1M concurrent active drivers (peak)
Driver location updates: 1M × every 4 sec = 250K writes/sec for location service
Ride requests: peak 5K/sec
Total rides/day: 10M+ globally
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
  ← real-time driver position updates
```

---

## 4. High-level architecture

```
Rider App / Driver App
  ↓
LB → API Gateway
  ↓
  ├──→ Ride Service (request, match, lifecycle)
  ├──→ Location Service (driver positions, geosearch)
  ├──→ Driver Service (driver profile, status)
  ├──→ Payment Service
  ├──→ Notification Service (driver app push)
  ↓
DBs:
  - Cassandra (rides history, denormalized)
  - Redis (driver locations, hex cells)
  - PostgreSQL (drivers, riders, payments)
```

---

## 5. Location tracking

Most critical scaling concern.

### Driver app sends update every 4 sec

```
DriverApp → POST /location { driverId, lat, lon, heading }
  ↓
Location Service:
  - Compute H3 cell at resolution 9 (~ 0.1 km²): cellId
  - If driver moved to new cell:
      ZREM old_cell:drivers driverId
      ZADD new_cell:drivers driverId
  - Update driver:{id} HASH с current lat, lon
```

**Storage:** Redis (in-memory, fast updates).

```redis
HSET driver:123 lat 37.7749 lon -122.4194 status available
ZADD cell:8a283082adbffff drivers 0 driver:123   # placeholder score (just membership)
```

**Scale:** 1M drivers × 4 sec frequency = 250K writes/sec → Redis Cluster с 5-10 shards.

---

## 6. Matching algorithm

Rider requests ride at (lat, lon).

```
1. Compute H3 cell для pickup (resolution 9 ~ 200m)
2. Get neighboring cells: 1-2 hex rings (~ 1 km radius)
3. Fetch available drivers in these cells from Redis
4. Score candidates:
   - distance to rider (Haversine)
   - driver rating
   - ETA based on traffic
   - driver wait time (queue fairness)
5. Send match request к top driver
6. Driver has 15 sec to accept
7. If decline / timeout → next driver
```

Cells lookup: O(constant), Redis SMEMBERS / ZRANGE.

```
candidates = []
for cell in get_cell_with_neighbors(rider_lat, rider_lon, ring=2):
    candidates += redis.zrange(f"cell:{cell}:drivers", 0, -1)
# Filter available, compute distance, sort, send to top
```

---

## 7. Geospatial indexing (deeper)

См. [`GEOSPATIAL.md`](GEOSPATIAL.md) для теории.

### Uber uses H3 (hexagonal):

- Resolution 9 (~ 0.1 km²) для matching
- Resolution 7 (~ 5 km²) для surge pricing zones
- Resolution 5 для city-level analytics

### Why hexagons (not squares/circles)

- All 6 neighbors equidistant
- No corner ambiguity
- Tight packing covers area better

### H3 functions used

- `latLngToCell(lat, lon, res)` — get cell ID
- `cellToBoundary(cell)` — polygon coordinates
- `kRing(cell, k)` — cells within k steps
- `cellToParent(cell, parentRes)` — hierarchical aggregation

---

## 8. Ride lifecycle

```
States: requested → matching → matched → enroute_pickup → 
        arrived → in_progress → completed → paid

State machine in DB, transitions via state machine library:
  if state == "matching" and driver_accepted → "matched"
  if state == "matched" and driver_near_pickup → "arrived"
  etc.
```

**Events** в Kafka на каждом transition:
- ride_matched → notify rider, dispatch driver
- ride_completed → trigger payment processing
- ride_canceled → cleanup, notify

---

## 9. ETA computation

ETA = travel time от current driver position к pickup.

### Naive: straight-line distance / average speed

Bad accuracy. Doesn't account для traffic.

### Better: routing service

Internal или 3rd party (Google Maps Directions API, OpenStreetMap-based OSRM).

Routing input: origin coordinates → destination coordinates + current time.
Returns: route, distance, ETA (с учётом traffic data).

### Cache ETA queries

Recent identical queries — TTL ~ 30 sec (traffic doesn't change drastically).

### Real-time updates

Once driver enroute, recompute ETA every 30 sec based на actual position. Push к rider app via WebSocket.

---

## 10. Surge pricing

При high demand (rides:drivers > 1) — повысить prices, чтобы:
- Discourage some riders → reduce demand
- Attract more drivers к area → increase supply

### Algorithm

```
For each surge zone (H3 cell at resolution 7, ~ 5 km²):
  active_rides_in_zone = count
  available_drivers_in_zone = count
  ratio = rides / max(drivers, 1)
  
  if ratio > 1.5: surge_multiplier = 1.5×
  if ratio > 2.0: surge_multiplier = 2.0×
  ...
  if ratio > 5.0: surge_multiplier = 5.0× (max)
```

Multiplier applied at fare calculation. Communicate к user before they confirm («2.5× surge in effect»).

### Storage

Surge state per zone в Redis с TTL 1-2 min. Recompute periodically.

---

## 11. Payment processing

```
Ride completed →
  Compute fare = base + (distance × rate) + (time × rate) + (surge × ...) + tip
  ↓
  Charge rider's stored payment method (Stripe, Braintree)
  ↓
  Async: pay driver (delayed several days)
```

**Idempotency:** payment processing with idempotency key (rideId) — retry не charges twice.

**Failure handling:**
- Card declined → notify rider, hold ride
- Stripe down → retry с backoff, queue for later
- Disputes → manual review queue

---

## 12. Failure modes

| Scenario | Handling |
|----------|----------|
| Driver accepts but stops responding | Timeout 15 sec, re-match to next driver |
| Rider in poor cell coverage | Local cache last known driver location, show «driver near you» |
| Surge spike — no drivers | Show «no drivers available», suggest later |
| Stripe outage | Queue payment, retry later, ride proceeds |
| Region outage (us-west-2) | Multi-region failover (each region serves its area) |

---

## 13. Multi-region

Uber operates globally. Each region (Africa, Asia, EU, NA, SA) has own infrastructure.

- **Riders/drivers** sharded by region
- **Trips** in region-local DB
- **Cross-region** redundancy — analytic aggregation only
- **Global services** — auth, payments potentially central with regional caches

Trip database: Cassandra с datacenter-aware replication.

---

## 14. Trade-offs

### Push vs pull driver locations

- **Push (this design)** — driver app sends updates every 4 sec
- **Pull** — server fetches on demand. Doesn't work — server doesn't know which drivers to ask

### Real-time location update frequency

- **Higher frequency (1 sec)** — accurate, but cost × 4 (250K → 1M writes/sec)
- **Lower (10 sec)** — saves cost, but stale matching
- **Adaptive** — high frequency when actively matched, low when idle

### Centralized matching vs distributed

- **Centralized service** — global view of supply/demand
- **Distributed (per-city)** — scalability, fault isolation. Uber actually uses регион-локальные dispatcher services

---

## 15. Anti-patterns

- **Single-shard «drivers» table** — won't scale to 1M location updates/sec
- **SQL geospatial query (Haversine on every row)** — too slow
- **Long-running matching transaction** — blocks. Async matching with state machine.
- **Sync write to durable DB on each location update** — overkill. Redis ephemeral, persist final trip data only.

---

## Источники

- *System Design Interview Vol. 2* (Alex Xu) — Ch. on Proximity Service / Uber
- [Uber Engineering — H3: Hexagonal Hierarchical Geospatial Indexing](https://www.uber.com/blog/h3/)
- [Uber Engineering — DISCO: dispatch system](https://www.uber.com/blog/dispatch-optimization/)
- [Uber's Marketplace — surge pricing](https://www.uber.com/blog/algorithms-tools-for-network-optimization/)
- [Hello Interview — Uber](https://www.hellointerview.com/learn/system-design/problem-breakdowns/uber)
- [Lyft Engineering — Matching backend](https://eng.lyft.com/)
