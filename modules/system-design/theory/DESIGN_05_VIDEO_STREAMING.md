# Design Problem: Video Streaming (Netflix/YouTube)

Доставлять видео миллионам пользователей с низкой latency и adaptive quality. Главные компоненты: **video encoding pipeline**, **CDN distribution**, **adaptive bitrate streaming (HLS/DASH)**.

---

## 1. Requirements

### Functional
- Upload видео (creator)
- Watch видео в realtime (viewer)
- Adaptive quality (mobile 3G → 4K)
- Search, recommendations
- Comments, likes (YouTube-specific)

### Non-functional
- **Smooth playback** — no buffering at acceptable bandwidth
- **Low startup latency** — < 2 sec from click to first frame
- **High availability** — 99.99%
- **Global scale** — billions of users
- **Storage** — exabytes of video

---

## 2. Estimation

```
100M DAU watching avg 30 min/day
1 hour of 1080p video = ~ 3 GB
1 hour of 4K video = ~ 7 GB

Bandwidth peak: 100M users × avg 2 Mbps = 200 Tbps
  → must be served from CDN edge, not origin

Storage:
  1B videos × avg 10 minutes × 7 quality levels × ~ 100 MB per encoding
  = ~ 700 PB (and growing)
  
Encoding compute:
  1M new videos uploaded/day × 30 min average length × 7 qualities
  = serious compute (50K+ encoding workers)
```

---

## 3. API

```http
POST /api/v1/videos/upload
Body (multipart): { title, description, file }
→ { videoId, uploadUrl } # presigned S3 URL for actual upload

GET /api/v1/videos/:id
→ { id, title, description, manifestUrl, thumbnails }

GET /api/v1/videos/:id/manifest.m3u8   # HLS manifest
→ playlists by quality
```

---

## 4. Upload + encoding pipeline

```
Creator uploads original video → 
  S3 (raw bucket)
  ↓ Object created event (S3 → SNS → SQS)
  ↓
Encoding workers (Spark / Kafka consumers):
  1. Download original
  2. Transcode to multiple qualities (240p, 360p, 480p, 720p, 1080p, 4K)
  3. Split into segments (2-10 sec chunks): HLS/DASH
  4. Generate thumbnails (every 5 sec)
  5. Upload encoded files to CDN-origin bucket
  6. Generate manifest file (.m3u8 / .mpd)
  7. Mark video "published" in DB
  
Creator gets notification: video ready
```

**Transcoding cost:** seriously CPU/GPU intensive. Use specialized hardware (NVIDIA NVENC, AWS MediaConvert).

**Parallelization:** split video в chunks, encode parallel, reassemble.

---

## 5. Adaptive Bitrate Streaming (HLS / MPEG-DASH)

### Концепт

Видео encoded в **multiple quality levels**. Player picks quality based на текущей пропускной способности и adapts dynamically.

### Структура HLS

```
master.m3u8                    # Master playlist
├── 240p.m3u8                  # Media playlist for 240p
│   ├── seg_001.ts             # 6-sec segments
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

### Player behavior

```
Player fetches master.m3u8
Initially picks lowest quality (or estimates from speed test)
Fetches first segment, measures download time
  - If fast → next request goes для higher quality manifest
  - If slow / buffering → drops to lower quality
Continuously adapts
```

### HLS vs DASH

| | HLS | DASH |
|---|---|---|
| Author | Apple | ISO standard |
| Format | TS (transport stream) / fragmented MP4 | MP4 |
| Manifest | .m3u8 | .mpd (XML) |
| Browsers | Safari native, others via libraries | Most modern |
| Devices | Apple iOS native | Android, web, many |

Modern: usually serve both или use **CMAF** (Common Media Application Format) — единый mp4 + manifest variants.

---

## 6. CDN distribution

Edge cache + origin shielding обязательны для масштабa.

```
User в Tokyo requests video segment →
  CDN edge (Tokyo PoP) — cache hit? Return segment.
  Miss → fetch from regional shield (Asia) → origin (S3 in main region)
  Cache for next users.
```

**Cache hit ratio target:** 95%+. Otherwise origin overwhelmed.

**Smart pre-population:** popular videos pushed to edges proactively (Netflix uses ML to predict viewing patterns per region, pre-cache).

**Custom CDN:** Netflix Open Connect (CDN deployed inside ISPs' networks для super-low latency).

---

## 7. Storage

### Original (raw upload)

S3 Standard или Glacier (rarely accessed после encoding).

### Encoded segments

- Hot (popular): S3 + CDN
- Cold (old, rare): S3 Glacier

Per video: ~ 700 MB across qualities (10-min HD video).
1B videos × 700 MB = 700 PB (matches earlier estimate).

### Metadata DB

PostgreSQL / Cassandra — video metadata, comments, likes (separate aggregation).

---

## 8. Live streaming (extension)

Differences from VOD (Video on Demand):
- Source: continuous encoder feeds chunks к origin
- Manifest: updated continuously (`#EXT-X-MEDIA-SEQUENCE` increments)
- Latency budget tighter — viewers want «live»
- Low Latency HLS (LL-HLS) → < 5 sec end-to-end (vs. 30+ sec traditional)
- WebRTC для interactive (sub-second, e.g. video calls)

**Pipeline:**
```
Camera → RTMP → Ingest server → Transcoding (real-time, multiple qualities) →
  Segment storage → CDN → Viewer player
```

---

## 9. Recommendations / Personalization

### Pre-compute (batch)

Daily Spark job:
- Collaborative filtering (matrix factorization)
- Per-user video score matrix
- Store top-N per user в Redis / DynamoDB

### Real-time re-ranking

When user opens app:
- Fetch pre-computed candidates (top 1000)
- Re-rank based на current context: recent watches, device, time of day
- ML model online inference

**A/B testing** — different ranking models served к user buckets.

---

## 10. Comments / Likes (YouTube-specific)

### Likes — counter

PostgreSQL / Redis HINCRBY for counter. Async aggregation для display:

```
User clicks like:
  immediate: visual +1 (optimistic UI)
  async: increment counter в Redis
  batch: every 60 sec, persist Redis → DB
```

### Comments

Cassandra с partitioning по videoId. Pagination by timestamp.

```
TABLE comments (
  video_id BIGINT,
  comment_id TIMEUUID,
  user_id BIGINT,
  text TEXT,
  PRIMARY KEY (video_id, comment_id)
) WITH CLUSTERING ORDER BY (comment_id DESC);
```

### Replies / threads

Parent_comment_id reference. Recursive query limits depth.

---

## 11. Anti-piracy / DRM

For paid content (Netflix originals, premium):
- **DRM (Digital Rights Management)** — Widevine (Google), FairPlay (Apple), PlayReady (Microsoft)
- Encrypted segments delivered through CDN
- Player negotiates licence with DRM server
- Decryption keys delivered only к valid devices

Free tier (YouTube basic):
- No DRM
- Watermarks для creator content
- Manual review/takedown для copyright issues

---

## 12. Failure modes

| Scenario | Handling |
|----------|----------|
| CDN edge slow → buffering | Player adapts to lower quality |
| Origin bucket down | Multi-region replication, failover |
| Encoding pipeline backed up | Scale up workers; viewers get 240p until ready |
| Live stream encoder crash | Backup encoder takes over (active-active) |
| Recommendation service down | Fall back на popular videos list (pre-cached) |

---

## 13. Trade-offs

### Storage cost vs encoding qualities

7 qualities × 1B videos = expensive. Trade-off:
- Encode less qualities (3-4 instead of 7) — smaller storage, less choice
- Encode on-demand для cold videos — cold latency
- Variable: keep more qualities only для popular videos

### CDN pull vs push

- **Pull** (default) — first user causes cache miss
- **Push** — Netflix pre-positions video на CDN edges based на ML predictions

### Live latency vs reliability

- 1-sec latency (WebRTC) — interactive, no buffer for network glitches
- 5-sec (LL-HLS) — buffer for hiccups
- 30-sec (traditional HLS) — robust, late catch-up

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — Ch. 14 «Design YouTube»
- [Netflix Tech Blog — Open Connect CDN, video encoding](https://netflixtechblog.com/)
- [YouTube architecture (old talk 2007)](https://www.youtube.com/watch?v=-w7UOMnTSrU) — relevant principles
- [Apple HLS Specification](https://developer.apple.com/streaming/)
- [DASH Industry Forum](https://dashif.org/)
- [Twitch — Live streaming infrastructure](https://blog.twitch.tv/en/tags/engineering/)
- [Hello Interview — YouTube / Live Streaming](https://www.hellointerview.com/learn/system-design/problem-breakdowns/youtube)
