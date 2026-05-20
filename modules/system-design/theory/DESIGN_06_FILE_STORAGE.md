# Design Problem: File Storage (Dropbox/Google Drive)

Cloud storage с sync через devices, чанкинг, дедупликация, conflict resolution. Главные challenges: large file handling, sync efficiency, multi-device consistency.

---

## 1. Requirements

### Functional
- Upload files (любого размера до limit, e.g., 50 GB)
- Download
- Sync across devices (desktop, mobile, web)
- Share files (link, permission)
- Version history
- (Optional) Real-time collaborative editing (Google Docs-style)

### Non-functional
- **Reliable** — никогда не лишать пользователя файлов (99.999999999% durability как S3)
- **Efficient sync** — only diff transmitted, not whole file
- **Available** — 99.99%
- **Bandwidth-efficient** — для mobile / slow connections
- **Cross-device consistency** — change on phone → visible on laptop within seconds

---

## 2. Estimation

```
500M users, 100M DAU
Each stores avg 50 GB → total 25 EB (exabytes!)
Compressed + deduplicated → maybe 5 EB unique

Daily uploads: 100M users × avg 10 files × 5 MB = 5 PB/day
Daily downloads: 5× more = 25 PB/day

Bandwidth peak: serve to ~ 10M concurrent connections globally
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
→ { changes: [...], nextCursor }   # changes since last sync
```

---

## 4. High-level architecture

```
Client (desktop app, mobile, web)
  ↓
LB → API Gateway
  ↓
  ├── Metadata Service (file/folder hierarchy, versions)
  ├── Block Service (chunk upload, retrieval)
  ├── Sync Service (change feed для clients)
  ├── Share Service (permissions, links)
  ↓
Storage:
  - Metadata DB (PostgreSQL / Cassandra) — file tree, ownership, permissions, versions
  - Block Storage (S3 / custom) — actual file chunks
  - Block hash index (Redis / DynamoDB) — для deduplication
```

---

## 5. Chunking — главный design pattern

Large files (1 GB+) разбиваются на **fixed-size chunks** (обычно 4 MB).

### Why chunks

- **Parallel upload** — N chunks одновременно
- **Resumable uploads** — connection drop → resume specific chunk
- **Deduplication** — same chunks reused across files / users
- **Efficient sync** — change one chunk → upload только changed chunk

### Chunk identification

Каждый chunk имеет **hash** (SHA-256). Hash = identifier and integrity check.

```
file F = [chunk1_hash, chunk2_hash, chunk3_hash, ...]

Upload protocol:
  Client splits file
  For each chunk:
    hash = SHA256(chunk_data)
    Check API: «do you have hash X?»
      Yes → skip upload (already exists, server reuses)
      No → upload chunk
  Finalize: send list of hashes to server
```

### Deduplication

Cross-user dedup: если 1M users have copy того же file (popular doc, distributed library), only one physical copy stored.

```
chunk_hash → (storage_location, refcount)

On upload: increment refcount or create new
On delete: decrement; if refcount==0 → mark для GC
```

Privacy implication: cross-user dedup может leak existence of files. **Per-user dedup** preserves privacy.

### Content-defined chunking (CDC)

Fixed-size has problem: insert 1 byte at beginning → all chunks shift, no dedup.

CDC: use **rolling hash** (Rabin fingerprint) to determine chunk boundaries based на content. Insert byte → only adjacent chunk changes.

Used by: rsync, Restic, BorgBackup, Dropbox.

---

## 6. Data model

```sql
-- Files / folders (sharded by user_id)
CREATE TABLE files (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    parent_id UUID,           -- NULL для root
    name TEXT,
    type ENUM('file', 'folder'),
    size BIGINT,               -- bytes
    current_version BIGINT,
    created_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- Versions
CREATE TABLE file_versions (
    file_id UUID,
    version BIGINT,
    chunks UUID[],             -- ordered list of chunk hashes
    size BIGINT,
    created_by BIGINT,
    created_at TIMESTAMPTZ,
    PRIMARY KEY (file_id, version)
);

-- Chunk index (high-throughput KV)
CREATE TABLE chunks (
    hash CHAR(64) PRIMARY KEY, -- SHA256 hex
    storage_path TEXT,         -- S3 path
    size INT,
    refcount BIGINT
);
```

---

## 7. Sync protocol

Client maintains local **cursor** (last sync state). On reconnect — fetch changes since cursor.

```
Client → GET /sync?cursor=last_known_position
Server → list of changes since cursor:
  [
    { event: "file_created", id, name, parent, chunks: [...] },
    { event: "file_updated", id, version, chunks: [...] },
    { event: "file_deleted", id },
    ...
  ]
  Plus new cursor

Client applies changes:
  - New file: fetch chunks (parallel)
  - Updated file: fetch ONLY new chunks (delta)
  - Deleted: remove locally
```

### Real-time push (alternative)

For instant sync, server pushes events via WebSocket / long-polling. Hybrid: push when connected, fallback к pull on reconnect.

---

## 8. Conflict resolution

Two devices edit same file offline. Both come online with different changes.

### Last-Write-Wins (simple)

Whichever client uploads first wins; second gets conflict notice.

```
Device A: uploads v5 of file (parent = v3)
Device B: tries v5 (also parent = v3) → server detects: «v5 already exists»
  Server saves Device B's version as «file (B's conflict).docx» (Dropbox style)
  User manually merges
```

### CRDT-based (Google Docs / collaborative)

Real-time text editing с CRDTs (Yjs / Automerge). См. [`CRDT.md`](CRDT.md).

```
Each edit = CRDT operation
All operations broadcast к peers
Eventual convergence
```

Не подходит для arbitrary file types — только structured (text, JSON, etc.).

---

## 9. Sharing

### Share link

Generate unique token per file:
```
fileId + shareToken → unique URL
```

Permissions:
- Public (anyone with link)
- Specific users (email-based)
- Read vs write

### Permission DB

```sql
CREATE TABLE share_permissions (
    file_id UUID,
    user_id BIGINT,        -- or NULL для public link
    permission ENUM('read', 'write', 'admin'),
    expires_at TIMESTAMPTZ
);
```

ACL check на каждый access (cached).

---

## 10. Storage backend

### S3-compatible

Most cloud providers use object storage (S3, GCS, Azure Blob) for actual chunks.

```
chunk hash → S3 object key (e.g., bucket/chunks/ab/cd/abcd1234...)
Use 2-3 character prefix for sharding (avoid S3 hot partition)
```

### Tiered storage

- **Hot tier** — recently accessed chunks, S3 Standard or local SSD cache
- **Cold tier** — old, rarely accessed, S3 Glacier / Deep Archive
- Move via lifecycle policies (auto)

### Replication

S3 replicates 11x9 nines durability — no single-DC failure loss.

---

## 11. Cache strategy

### Edge cache

For shared / public files, push to CDN.

```
File → CDN edge cache (signed URL)
Other users в region serve from edge.
```

### Recent files

Hot per-user cache in app: recently accessed metadata + chunks.

---

## 12. Bandwidth optimization

### Delta sync (diff upload)

Use rsync-style algorithm:
- Server computes hashes for each chunk (already stored)
- Client computes rolling hash при editing → finds matching chunks → only sends new ones

### Compression

Compress text-based files (txt, html, json) before upload. Binary files (images, video) — already compressed.

### Bandwidth limits

User configurable in client (e.g., «pause sync when on cellular», «limit to 1 MB/s»).

---

## 13. Failure modes

| Scenario | Handling |
|----------|----------|
| Upload interrupted | Resume from last successful chunk |
| Chunk hash mismatch на download | Re-fetch chunk (corruption) |
| User exceeds storage quota | Reject upload, alert user |
| Sync conflict | Save as «file (conflict).ext», user merges |
| Server error during finalize | Client retries; idempotent — same chunks recognized |
| Block storage outage | Fallback secondary region; uploads queue |

---

## 14. Trade-offs

### Chunk size

- **Smaller** (1 MB) — better dedup, more granular sync, but more metadata overhead
- **Larger** (16 MB) — less metadata, but worse dedup; whole chunk re-upload on edit

Typical: 4 MB (Dropbox).

### Per-user dedup vs cross-user

- **Per-user** — privacy preserved, but storage cost ×N (each user separately)
- **Cross-user** — massive storage savings, but theoretical privacy leak (file existence detectable)

Dropbox does cross-user dedup; some competitors per-user (privacy-focused).

### Sync strategy

- **Selective sync** — user picks folders to sync (laptop limited space)
- **Stream files** — Files On-Demand (Windows OneDrive style) — placeholder, fetch on open
- **Full sync** — everything everywhere (heavy)

---

## Источники

- *System Design Interview Vol. 1* (Alex Xu) — Ch. 15 «Design Google Drive»
- [Hello Interview — Dropbox](https://www.hellointerview.com/learn/system-design/problem-breakdowns/dropbox)
- [Dropbox Engineering Blog — Architecture](https://dropbox.tech/) — many posts on chunking, sync
- [Dropbox — Magic Pocket: building Dropbox's storage system](https://dropbox.tech/infrastructure/inside-the-magic-pocket)
- [rsync algorithm paper (Andrew Tridgell)](https://www.samba.org/~tridge/phd_thesis.pdf)
- *Cracking the Coding Interview* — Dropbox-style problems
