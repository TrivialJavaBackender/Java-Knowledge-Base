# Design Problem: Leaderboard

Real-time scoring и ранжирование — гейминг (top-игроки по score), фитнес-приложения, e-commerce («top sellers»). Главные challenges: высокий write throughput, tie-breaking, percentile-запросы, масштабирование.

---

## 1. Requirements

### Functional
- Обновление score игрока (на каждое действие / событие)
- Top-K leaderboard (top 100 глобально, только друзья, per-region)
- Ранг игрока: «Ты #1234 из 10M»
- История score (график во времени)

### Non-functional
- **Низкая latency reads** — top-K < 100 мс
- **Real-time updates** — изменение score видно за секунды
- **Высокий write throughput** — миллионы обновлений в минуту
- **Consistency** — eventual ok для отображения; точный ранг — по запросу

---

## 2. Estimation

```
10M MAU, пик 1M одновременно
Score-обновления: 10 событий / игрок / час = ~30K updates/sec в среднем, пик 100K

Чтения: 100M запросов leaderboard'а/день = ~1500 reads/sec
Lookup'ы ранга: тот же масштаб

Storage:
  10M игроков × 100 байт (id, score, metadata) = 1 ГБ
  Компактно, влезает в память
```

---

## 3. API

```http
POST /api/v1/scores
Body: { playerId, scoreDelta, gameMode? }
→ 204

GET /api/v1/leaderboard/global?limit=100
→ [{ playerId, score, rank }, ...]

GET /api/v1/leaderboard/me
→ { playerId, score, rank: 1234, percentile: 99.9 }

GET /api/v1/leaderboard/friends?userId=X
→ ранжированный список друзей пользователя
```

---

## 4. Архитектура — Redis Sorted Set (ZSET)

Redis ZSET идеален: упорядоченный set со score на member.

```redis
# Обновление score игрока
ZADD leaderboard 9500 player:123
# (если инкремент, а не замена: ZINCRBY leaderboard +50 player:123)

# Top 100
ZREVRANGE leaderboard 0 99 WITHSCORES

# Ранг игрока (0-indexed)
ZREVRANK leaderboard player:123

# Игроки в диапазоне score
ZRANGEBYSCORE leaderboard 1000 2000
```

**Производительность:**
- Insert / update / delete: O(log N)
- Range-запросы: O(log N + M), где M — число возвращаемых элементов
- Lookup ранга: O(log N)

Одна Redis-нода держит 100K–1M ops/sec.

---

## 5. Масштаб за пределы одной ноды

Один ZSET ограничен памятью (десятки ГБ) и тем, что Redis single-threaded.

### Sharded leaderboard

Несколько Redis-нод, у каждой подмножество. Top-K — запросы ко всем, потом merge.

```
Шардирование по hash(player_id) → какая нода держит score игрока
У каждой ноды частичный leaderboard

Для глобального top-K:
  Запрашиваем top-K с каждого shard'а параллельно
  Merge: собираем top-K с каждого (M shards × K элементов), сортируем, возвращаем top K
```

Cost: top-K = M × K элементов на сбор + сортировка = O(M × K log(MK)).

При K=100, M=10 shards: 1000 элементов на merge. Тривиально.

### Приближённый top-K и percentile

Для очень больших N точный ранг дорогой. Используем приближение:

```
Поддерживаем count-min sketch / структуры для квантилей
Top-K из приближённых score
Показываем «approximate rank» (например, «top 1%»)
```

Менее точно, но память — константная.

---

## 6. Tie-breaking

Игроки с одинаковым score — как упорядочить?

```
Tied scores:
  - Alice: 9500
  - Bob: 9500
  - Carol: 9500
```

Варианты:
- **Лексикографически по имени** — сортируем по player ID / username (детерминированно, но произвольно)
- **Кто раньше дошёл** — кто первым набрал 9500 (по времени)
- **Composite score** — `score × 1B + (max_timestamp - their_timestamp)` → вторичная сортировка

Redis ZSET: members с одним score по умолчанию сортируются лексикографически. Кастомизация — через composite-кодирование score.

---

## 7. Time-windowed leaderboards

«Топ игроков за неделю / день / месяц».

### Naive: храним каждый leaderboard отдельно

```
leaderboard:all-time → ZADD ...
leaderboard:weekly:2024-W42 → ZADD ...
leaderboard:daily:2024-10-15 → ZADD ...
```

Storage: ×N временных окон.

### Smart: трекинг событий + фильтрация

События со score хранятся с timestamp. Аггрегируются на чтении по окну.

```
events: (player, points, timestamp)
Daily leaderboard: SUM(points) WHERE date = today, GROUP BY player, ORDER BY sum DESC
```

Cassandra / ClickHouse — эффективны для агрегаций.

### Гибрид

Pre-агрегация периодически (раз в минуту) для свежих окон; холодные диапазоны — по запросу.

---

## 8. Leaderboard друзей

Показать только среди друзей пользователя.

```
Для пользователя X:
  достать список друзей (User Service): friends = [Y, Z, W]
  для каждого → достать score из leaderboard'а
  отсортировать, вернуть
```

Друзей обычно мало (< 1000), задача тривиальна.

Для больших списков (Facebook gaming) — pre-computed friend-leaderboard'ы.

---

## 9. Multi-region

```
Global leaderboard: cross-region, eventually consistent
Per-region leaderboard: низкая локальная latency

Реализация:
  Локальный Redis в каждом регионе
  Async-репликация в глобальный Redis
  Запросы «глобальный ранг» идут в global; «ранг в моём регионе» — в local
```

---

## 10. Anti-cheating

Для соревновательных игр — защита от инъекции score.

- **Score-обновления только из server-authoritative game state** — клиент предлагает, сервер валидирует
- **Anomaly detection** — резкий скачок score, невозможные темпы
- **Verification по replay'у** — для top-score запросить видео / replay
- **Anti-cheat-сервисы** (Easy Anti-Cheat, BattlEye)

---

## 11. Hot-key проблема

«Топ 10» читают все — hot-path.

Митигации:
- **CDN edge-кэш** — top-K с TTL 30 сек (небольшое отставание ок)
- **Application-level кэш** (Caffeine LRU) — каждый app-инстанс кэширует top-K
- **Replica reads** — несколько Redis-replica, round-robin
- **Pre-computed views** — материализованный top-K, обновляется периодически

---

## 12. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| Redis упал | Replica повышается; обновления последней секунды могут потеряться (интервал RDB snapshot) |
| Score-обновление упало | Retry с идемпотентностью; если стабильно фейлится → DLQ |
| Баг раздувает score | Детект: anomaly-алёрты; rollback событий за последние N часов |
| Гонка на ZINCRBY | Redis single-threaded — атомарно по умолчанию |

---

## 13. Trade-offs

### Real-time vs batch

- **Real-time** (ZSET на каждое событие) — мгновенное обновление, дорого на масштабе
- **Batch** (агрегация раз в минуту) — дешевле, небольшой лаг

Большинство игр: real-time, опираясь на эффективность Redis.

### Точный vs приближённый ранг

При N=10M точный ранг требует полного скана сверху. Приближение (percentile) допустимо.

- Показывать «#1234», если N < 10K
- Показывать «Top 5%», если N > 1M

### Persistence

Redis ZSET ephemeral (RAM). При crash недавние обновления теряются.
- AOF (every-second) — ~1 секунда потерь
- RDB (periodic snapshot) — больше потерь
- Источник истины — events DB (Kafka log replay, если Redis умрёт)

---

## 14. Жизненный цикл данных

Старые score со временем менее интересны. Архивируем / сжимаем.

```
Daily-leaderboards: храним 30 дней, архивируем в S3
Weekly: 1 год
Monthly: вечно
All-time: не архивируем (один ZSET, небольшой)
```

---

## 15. Real-world примеры

- **Discord** — лидерборды Server Boost, message count'ы
- **Strava** — segment leaderboard'ы (по времени)
- **Twitch** — топ-стримеры, число зрителей
- **PUBG / Fortnite** — competitive ranking, ELO-based
- **Reddit** — hot posts (похоже, time-decayed score)

---

## 16. Вариант: ELO-ранкинг

Не raw score, а **относительная сила** между игроками.

```
Player A (ELO 1500) vs Player B (ELO 1400):
  A ожидаемо выигрывает в 64% случаев.
  Если A победил → получает мало очков (ожидаемо); B теряет мало.
  Если B победил (upset) → получает много; A теряет много.
```

Применяется: шахматы, онлайн-игры, dating-приложения.

Реализация:
- Та же структура leaderboard'а (ZSET с ELO как score)
- Score-обновления по формуле ELO после каждого матча

---

## Источники

- *System Design Interview Vol. 2* (Alex Xu) — глава про Top-K / Leaderboard
- [Redis ZSET Documentation](https://redis.io/commands/?group=sorted-set)
- [Hello Interview — Leaderboard / Top-K](https://www.hellointerview.com/learn/system-design)
- [Discord — Server boost leaderboard](https://discord.com/blog/)
- [Reddit — Hot posts ranking algorithm](https://www.reddit.com/r/programming/comments/h6m2t/reddits_hot_algorithm_explained/)
- ELO rating system — [Wikipedia: Elo rating system](https://en.wikipedia.org/wiki/Elo_rating_system)
