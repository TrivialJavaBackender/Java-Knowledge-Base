# Design Problem: Video Streaming (Netflix / YouTube)

Доставлять видео миллионам пользователей с низкой latency и адаптивным качеством. Главные компоненты: **video encoding pipeline**, **CDN distribution**, **adaptive bitrate streaming (HLS/DASH)**.

---

## 1. Requirements

### Functional
- Upload видео (creator)
- Просмотр видео в реальном времени (viewer)
- Adaptive quality (mobile 3G → 4K)
- Поиск, рекомендации
- Комментарии, лайки (YouTube-специфика)

### Non-functional
- **Плавное воспроизведение** — без буферизации при приемлемой полосе
- **Низкая startup latency** — < 2 сек от клика до первого кадра
- **High availability** — 99.99%
- **Глобальный масштаб** — миллиарды пользователей
- **Storage** — экзабайты видео

---

## 2. Estimation

```
100M DAU, в среднем 30 мин/день
1 час 1080p ≈ 3 ГБ
1 час 4K ≈ 7 ГБ

Пик bandwidth: 100M пользователей × в среднем 2 Мбит/с = 200 Тбит/с
  → обслуживается edge'ами CDN, не origin

Storage:
  1B видео × в среднем 10 мин × 7 уровней качества × ~100 МБ на encoding
  = ~700 ПБ (растёт)

Compute на encoding:
  1M новых видео/день × в среднем 30 мин × 7 качеств
  = серьёзный compute (50K+ encoding-worker'ов)
```

---

## 3. API

```http
POST /api/v1/videos/upload
Body (multipart): { title, description, file }
→ { videoId, uploadUrl } # presigned S3 URL для самого upload

GET /api/v1/videos/:id
→ { id, title, description, manifestUrl, thumbnails }

GET /api/v1/videos/:id/manifest.m3u8   # HLS manifest
→ playlist'ы по качествам
```

---

## 4. Upload + encoding pipeline

```
Creator загружает оригинал →
  S3 (raw-бакет)
  ↓ Object created event (S3 → SNS → SQS)
  ↓
Encoding workers (Spark / Kafka consumers):
  1. Скачать оригинал
  2. Transcode в несколько качеств (240p, 360p, 480p, 720p, 1080p, 4K)
  3. Нарезать на сегменты (chunks 2–10 сек): HLS/DASH
  4. Сгенерировать thumbnails (каждые 5 сек)
  5. Загрузить encoded-файлы в CDN-origin бакет
  6. Сгенерировать manifest (.m3u8 / .mpd)
  7. Пометить видео как "published" в БД

Creator получает уведомление: видео готово
```

**Стоимость transcoding'а:** очень тяжёлый CPU/GPU. Используют специализированные ускорители (NVIDIA NVENC, AWS MediaConvert).

**Параллелизация:** видео разбивается на chunks, encoding идёт параллельно, потом склейка.

---

## 5. Adaptive Bitrate Streaming (HLS / MPEG-DASH)

### Концепт

Видео кодируется в **несколько уровней качества**. Player выбирает качество по текущей полосе и динамически адаптируется.

### Структура HLS

```
master.m3u8                    # Master playlist
├── 240p.m3u8                  # Media playlist для 240p
│   ├── seg_001.ts             # 6-секундные сегменты
│   ├── seg_002.ts
│   └── ...
├── 720p.m3u8
│   ├── seg_001.ts
│   └── ...
└── 1080p.m3u8
    └── ...
```

```
# master.m3u8
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240
240p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8
```

### Поведение player'а

```
Player забирает master.m3u8
Начинает с самого низкого качества (или оценивает по speed test)
Скачивает первый сегмент, замеряет время загрузки
  - Быстро → следующий запрос на manifest более высокого качества
  - Медленно / буферизация → понижаем качество
Непрерывно адаптируется
```

### HLS vs DASH

| | HLS | DASH |
|---|---|---|
| Автор | Apple | ISO-стандарт |
| Формат | TS (transport stream) / fragmented MP4 | MP4 |
| Manifest | .m3u8 | .mpd (XML) |
| Браузеры | Safari нативно, остальные через библиотеки | Большинство современных |
| Устройства | iOS нативно | Android, web, и т. п. |

Сейчас обычно отдают оба или используют **CMAF** (Common Media Application Format) — единый mp4 + варианты manifest'а.

---

## 6. CDN distribution

Edge-кэш + origin shielding обязательны на масштабе.

```
Пользователь в Tokyo запрашивает сегмент видео →
  CDN edge (Tokyo PoP) — hit? Отдаём сегмент.
  Miss → запрос к регионального shield (Asia) → origin (S3 в основном регионе)
  Кэшируем для следующих пользователей.
```

**Целевой cache hit ratio:** 95%+. Иначе origin захлёбывается.

**Smart pre-population:** популярные видео заранее пушатся на edge (Netflix ML-моделями предсказывает паттерны просмотра по регионам и пре-кэширует).

**Custom CDN:** Netflix Open Connect — CDN, развёрнутый прямо внутри сетей ISP для очень низкой latency.

---

## 7. Storage

### Оригинал (raw upload)

S3 Standard или Glacier (после encoding'а обращаются редко).

### Encoded-сегменты

- Hot (популярные): S3 + CDN
- Cold (старые, редкие): S3 Glacier

На видео: ~700 МБ суммарно по качествам (10-минутное HD-видео).
1B видео × 700 МБ = 700 ПБ (согласуется с оценкой выше).

### Metadata DB

PostgreSQL / Cassandra — метаданные видео, комментарии, лайки (отдельная агрегация).

---

## 8. Live streaming (расширение)

Отличия от VOD (Video on Demand):
- Источник: непрерывный encoder шлёт chunks на origin
- Manifest обновляется непрерывно (`#EXT-X-MEDIA-SEQUENCE` инкрементится)
- Latency budget жёстче — зрители хотят «live»
- Low Latency HLS (LL-HLS) → < 5 сек end-to-end (vs 30+ сек у традиционного HLS)
- WebRTC для интерактива (sub-second, видеозвонки)

**Pipeline:**
```
Camera → RTMP → Ingest-сервер → Transcoding (real-time, несколько качеств) →
  Хранилище сегментов → CDN → Player зрителя
```

---

## 9. Рекомендации / персонализация

### Pre-compute (batch)

Ежедневный Spark-job:
- Collaborative filtering (matrix factorization)
- Матрица оценок «пользователь × видео»
- Top-N на пользователя — в Redis / DynamoDB

### Real-time re-ranking

При открытии приложения:
- Достаём pre-computed кандидатов (top 1000)
- Re-rank с учётом контекста: недавние просмотры, устройство, время суток
- Online inference ML-моделью

**A/B testing** — разные ranking-модели работают на разных бакетах пользователей.

---

## 10. Комментарии и лайки (YouTube-специфика)

### Лайки — counter

PostgreSQL / Redis HINCRBY как счётчик. Async-агрегация для отображения:

```
Пользователь нажал like:
  моментально: визуальный +1 (optimistic UI)
  async: increment счётчика в Redis
  batch: раз в 60 сек, persist Redis → DB
```

### Комментарии

Cassandra, partition по videoId. Pagination по timestamp.

```
TABLE comments (
  video_id BIGINT,
  comment_id TIMEUUID,
  user_id BIGINT,
  text TEXT,
  PRIMARY KEY (video_id, comment_id)
) WITH CLUSTERING ORDER BY (comment_id DESC);
```

### Reply'и / треды

Ссылка `parent_comment_id`. Рекурсивный запрос с ограничением по глубине.

---

## 11. Anti-piracy / DRM

Для платного контента (оригиналы Netflix, premium):
- **DRM (Digital Rights Management)** — Widevine (Google), FairPlay (Apple), PlayReady (Microsoft)
- Зашифрованные сегменты идут через CDN
- Player договаривается с DRM-сервером о лицензии
- Ключи дешифрования выдаются только на валидные устройства

Free-тир (базовый YouTube):
- Без DRM
- Watermarks для creator-контента
- Ручной review / takedown по copyright-жалобам

---

## 12. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| CDN edge тормозит → буферизация | Player переключается на качество ниже |
| Origin-бакет упал | Multi-region replication, failover |
| Encoding pipeline в backlog'е | Увеличиваем число worker'ов; viewer получает 240p до готовности остальных |
| Live encoder упал | Резервный encoder подхватывает (active-active) |
| Recommendations down | Fallback на список популярных видео (pre-cached) |

---

## 13. Trade-offs

### Стоимость хранения vs число качеств

7 качеств × 1B видео — дорого. Trade-off:
- Меньше качеств (3–4 вместо 7) — меньше storage, меньше выбора
- Encoding по требованию для холодных видео — высокая cold-latency
- Гибрид: больше качеств только для популярных видео

### CDN pull vs push

- **Pull** (по умолчанию) — первый пользователь вызывает cache miss
- **Push** — Netflix заранее размещает видео на edge'ах по ML-прогнозам

### Live: latency vs reliability

- 1 сек (WebRTC) — интерактивно, нет буфера на сбои сети
- 5 сек (LL-HLS) — есть буфер на «икоту» сети
- 30 сек (классический HLS) — надёжно, поздний catch-up

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 14 «Design YouTube»
- [Netflix Tech Blog — Open Connect CDN, video encoding](https://netflixtechblog.com/)
- [YouTube architecture (talk, 2007)](https://www.youtube.com/watch?v=-w7UOMnTSrU) — принципы актуальны
- [Apple HLS Specification](https://developer.apple.com/streaming/)
- [DASH Industry Forum](https://dashif.org/)
- [Twitch — Live streaming infrastructure](https://blog.twitch.tv/en/tags/engineering/)
- [Hello Interview — YouTube / Live Streaming](https://www.hellointerview.com/learn/system-design/problem-breakdowns/youtube)
