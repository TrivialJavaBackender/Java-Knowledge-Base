# Design Problem: File Storage (Dropbox / Google Drive)

Cloud storage с синхронизацией между устройствами, чанкингом, дедупликацией и conflict resolution. Главные challenges: работа с большими файлами, эффективная sync, multi-device consistency.

---

## 1. Requirements

### Functional
- Upload файлов (любого размера до лимита, например 50 ГБ)
- Скачивание
- Sync между устройствами (desktop, mobile, web)
- Шеринг файлов (ссылка, права)
- История версий
- (Опционально) Real-time collaborative editing (стиль Google Docs)

### Non-functional
- **Надёжность** — никогда не терять файлы (durability 99.999999999% — как у S3)
- **Эффективный sync** — передаём только diff, не файл целиком
- **Available** — 99.99%
- **Экономия bandwidth** — для mobile и медленных сетей
- **Cross-device consistency** — изменение на телефоне → видно на ноутбуке за секунды

---

## 2. Estimation

```
500M пользователей, 100M DAU
В среднем хранят 50 ГБ → всего 25 ЭБ (экзабайт!)
С компрессией и дедупликацией → ~5 ЭБ уникальных данных

Ежедневные uploads: 100M × ~10 файлов × 5 МБ = 5 ПБ/день
Ежедневные downloads: ×5 = 25 ПБ/день

Пик bandwidth: обслуживание ~10M одновременных соединений глобально
```

---

## 3. API

```http
POST /api/v1/files
Body: { name, parentId, size }
→ { fileId, uploadSessionId }

PUT /api/v1/files/:fileId/chunks/:index
Body: <binary chunk>
→ { chunkHash, index }

POST /api/v1/files/:fileId/finalize
Body: { chunks: [...] }
→ { fileId, version, downloadUrl }

GET /api/v1/files/:fileId
→ { metadata, downloadUrl }

GET /api/v1/files/sync?cursor=...
→ { changes: [...], nextCursor }   # изменения с последнего sync
```

---

## 4. High-level архитектура

```
Client (desktop, mobile, web)
  ↓
LB → API Gateway
  ↓
  ├── Metadata Service (файлово-папочная иерархия, версии)
  ├── Block Service (upload и retrieve chunks)
  ├── Sync Service (поток изменений для клиентов)
  ├── Share Service (права, ссылки)
  ↓
Хранилище:
  - Metadata DB (PostgreSQL / Cassandra) — file tree, ownership, permissions, versions
  - Block Storage (S3 / custom) — собственно chunks
  - Block hash index (Redis / DynamoDB) — для дедупликации
```

---

## 5. Чанкинг — главный паттерн дизайна

Большие файлы (1 ГБ+) разбиваются на **fixed-size chunks** (обычно 4 МБ).

### Зачем chunks

- **Параллельный upload** — N chunks одновременно
- **Resumable uploads** — обрыв соединения → продолжаем с конкретного chunk
- **Дедупликация** — одинаковые chunks переиспользуются между файлами и пользователями
- **Эффективный sync** — изменился один chunk → отправляем только его

### Идентификация chunk

У каждого chunk есть **hash** (SHA-256). Hash служит одновременно идентификатором и integrity check.

```
file F = [chunk1_hash, chunk2_hash, chunk3_hash, ...]

Протокол upload:
  Клиент режет файл
  Для каждого chunk:
    hash = SHA256(chunk_data)
    Спрашиваем API: «у вас есть hash X?»
      Да → пропускаем upload (уже есть, сервер переиспользует)
      Нет → загружаем chunk
  Finalize: шлём серверу список хэшей
```

### Дедупликация

Cross-user dedup: если 1M пользователей хранят одинаковый файл (популярный документ, дистрибутив библиотеки), физически он лежит один раз.

```
chunk_hash → (storage_location, refcount)

На upload: increment refcount или создаём новый
На delete: decrement; если refcount==0 → помечаем на GC
```

Privacy-нюанс: cross-user dedup может выдавать существование файла. **Per-user dedup** сохраняет приватность.

### Content-defined chunking (CDC)

У fixed-size chunking есть проблема: вставка 1 байта в начало → все chunks сдвигаются, дедупликация ломается.

CDC: использовать **rolling hash** (Rabin fingerprint) для определения границ chunk'ов по содержимому. Вставили байт → изменился только соседний chunk.

Используют: rsync, Restic, BorgBackup, Dropbox.

---

## 6. Data model

```sql
-- Files / folders (шард по user_id)
CREATE TABLE files (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    parent_id UUID,           -- NULL для root
    name TEXT,
    type ENUM('file', 'folder'),
    size BIGINT,              -- в байтах
    current_version BIGINT,
    created_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- Версии
CREATE TABLE file_versions (
    file_id UUID,
    version BIGINT,
    chunks UUID[],            -- упорядоченный список хэшей chunk'ов
    size BIGINT,
    created_by BIGINT,
    created_at TIMESTAMPTZ,
    PRIMARY KEY (file_id, version)
);

-- Chunk index (high-throughput KV)
CREATE TABLE chunks (
    hash CHAR(64) PRIMARY KEY, -- SHA256 в hex
    storage_path TEXT,         -- путь в S3
    size INT,
    refcount BIGINT
);
```

---

## 7. Sync-протокол

Клиент держит локальный **cursor** (последнее состояние sync). При переподключении подтягивает изменения с этого cursor'а.

```
Client → GET /sync?cursor=last_known_position
Server → список изменений с cursor:
  [
    { event: "file_created", id, name, parent, chunks: [...] },
    { event: "file_updated", id, version, chunks: [...] },
    { event: "file_deleted", id },
    ...
  ]
  + новый cursor

Client применяет изменения:
  - Новый файл: качаем chunks (параллельно)
  - Обновлён файл: качаем ТОЛЬКО новые chunks (delta)
  - Удалён: убираем локально
```

### Real-time push (альтернатива)

Для мгновенного sync сервер пушит события через WebSocket / long-polling. Гибрид: push при подключённом клиенте, fallback на pull при reconnect.

---

## 8. Conflict resolution

Два устройства редактируют файл offline. Оба приходят online с разными изменениями.

### Last-Write-Wins (простой вариант)

Кто первым залил — победил; второй получает уведомление о конфликте.

```
Устройство A: загружает v5 (parent = v3)
Устройство B: пытается v5 (тоже parent = v3) → сервер видит «v5 уже существует»
  Сервер сохраняет версию B как «file (B's conflict).docx» (стиль Dropbox)
  Пользователь мержит вручную
```

### CRDT-based (Google Docs / collaborative)

Real-time-редактирование текста через CRDT (Yjs / Automerge). См. [`CRDT.md`](CRDT.md).

```
Каждое редактирование = CRDT-операция
Все операции broadcast'ятся peer'ам
Eventual convergence
```

Не подходит для произвольных типов файлов — только для структурированных (text, JSON и т. п.).

---

## 9. Шеринг

### Share-ссылка

Генерируем уникальный токен на файл:
```
fileId + shareToken → уникальный URL
```

Права:
- Public (любой по ссылке)
- Конкретные пользователи (по email)
- Read vs write

### Permission DB

```sql
CREATE TABLE share_permissions (
    file_id UUID,
    user_id BIGINT,        -- или NULL для публичной ссылки
    permission ENUM('read', 'write', 'admin'),
    expires_at TIMESTAMPTZ
);
```

ACL-проверка на каждом доступе (кэшируется).

---

## 10. Storage backend

### S3-совместимое хранилище

Большинство облаков используют object storage (S3, GCS, Azure Blob) под собственно chunks.

```
chunk hash → S3 object key (например, bucket/chunks/ab/cd/abcd1234...)
Используем 2–3-символьный префикс как sharding-ключ (защита от hot-partition S3)
```

### Tiered storage

- **Hot tier** — недавно использованные chunks, S3 Standard или локальный SSD-кэш
- **Cold tier** — старые, редко используемые, S3 Glacier / Deep Archive
- Перенос — через lifecycle policies (автоматически)

### Репликация

S3 даёт durability «11 девяток» — потери из-за падения одного DC исключены.

---

## 11. Cache strategy

### Edge cache

Для шаренных / публичных файлов — push в CDN.

```
Файл → edge-кэш CDN (signed URL)
Другие пользователи в регионе получают файл с edge'а.
```

### Recent files

Hot per-user кэш в приложении: недавно использованные метаданные + chunks.

---

## 12. Bandwidth optimization

### Delta sync (diff upload)

Используем rsync-подход:
- Сервер вычисляет хэши уже хранимых chunks
- Клиент при редактировании считает rolling hash → находит совпадающие chunks → шлёт только новые

### Compression

Сжимаем текстовые файлы (txt, html, json) перед upload'ом. Бинарные (картинки, видео) уже сжаты.

### Лимиты bandwidth

Настраиваются в клиенте («пауза sync на мобильной сети», «ограничить до 1 МБ/с»).

---

## 13. Failure modes

| Сценарий | Обработка |
|----------|-----------|
| Upload оборвался | Продолжаем с последнего успешного chunk |
| Несовпадение hash на download | Перекачиваем chunk (повреждение) |
| Превышена квота | Отвергаем upload, уведомляем пользователя |
| Sync-конфликт | Сохраняем как «file (conflict).ext», пользователь мержит |
| Ошибка сервера на finalize | Клиент retry'ит; идемпотентно — те же chunks распознаются |
| Сбой block storage | Fallback в secondary region; uploads в очередь |

---

## 14. Trade-offs

### Размер chunk

- **Меньше** (1 МБ) — лучше дедупликация, гранулярный sync, но больше overhead на metadata
- **Больше** (16 МБ) — меньше metadata, но хуже дедупликация; правки требуют перезагрузки всего chunk

Типично: 4 МБ (Dropbox).

### Per-user vs cross-user дедупликация

- **Per-user** — приватность сохранена, но storage cost ×N (каждый пользователь отдельно)
- **Cross-user** — огромная экономия места, но теоретическая утечка приватности (можно определить наличие файла)

Dropbox делает cross-user dedup; часть конкурентов — per-user (privacy-focused).

### Стратегия sync

- **Selective sync** — пользователь выбирает папки для sync (ограниченное место на ноутбуке)
- **Stream files** — Files On-Demand (стиль Windows OneDrive): placeholder, скачивание при открытии
- **Full sync** — всё везде (тяжело)

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — глава 15 «Design Google Drive»
- [Hello Interview — Dropbox](https://www.hellointerview.com/learn/system-design/problem-breakdowns/dropbox)
- [Dropbox Engineering Blog — Architecture](https://dropbox.tech/) — много постов про чанкинг и sync
- [Dropbox — Magic Pocket: building Dropbox's storage system](https://dropbox.tech/infrastructure/inside-the-magic-pocket)
- [rsync algorithm paper (Andrew Tridgell)](https://www.samba.org/~tridge/phd_thesis.pdf)
- *Cracking the Coding Interview* — Dropbox-style задачи
