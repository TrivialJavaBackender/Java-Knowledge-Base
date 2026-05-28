# HTTP и сетевые протоколы

## IPv4 против IPv6

| | IPv4 | IPv6 |
|---|---|---|
| Формат | 4 байта: `192.168.1.1` | 16 байт: `2001:0db8::1` |
| Адресное пространство | ~4.3 млрд адресов | 3.4 × 10³⁸ |
| NAT | Необходим (нехватка адресов) | Не нужен |
| Header | 20 байт, сложный | 40 байт, упрощённый |
| Broadcast | Есть | Нет (только multicast/anycast) |
| Автоконфигурация | DHCP | SLAAC (статelesss) + DHCPv6 |

**Специальные диапазоны IPv4:**
- `127.0.0.0/8` — loopback (localhost)
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` — private networks (RFC 1918)
- `0.0.0.0` — all interfaces
- `255.255.255.255` — broadcast

**Dual Stack** — современные системы поддерживают оба протокола одновременно. При DNS-запросе получают A-запись (IPv4) и AAAA-запись (IPv6).

---

## HTTP/1.1 против HTTP/2.0

### HTTP/1.1 (1997)

```
Client → одно TCP-соединение
GET /index.html → ответ
GET /style.css  → ответ    ← sequential, ждёт предыдущего
GET /script.js  → ответ
```

**Head-of-Line Blocking:** следующий запрос ждёт ответа на предыдущий в рамках соединения.  
**Workaround:** браузеры открывают 6-8 параллельных TCP-соединений к одному хосту.

**Keep-Alive:** `Connection: keep-alive` — переиспользовать TCP-соединение для нескольких запросов (дефолт в 1.1).

**Pipelining** — отправить несколько запросов не дожидаясь ответов, но ответы приходят строго по очереди → head-of-line всё равно есть. На практике почти не используется.

### HTTP/2.0 (2015)

**Мультиплексирование:** несколько **потоков** (stream — логических каналов) в одном TCP-соединении. Ответы приходят в любом порядке — нет head-of-line на уровне HTTP.

```
Одно TCP-соединение:
Stream 1: GET /index.html ←→ [frames: HEADERS, DATA]
Stream 3: GET /style.css  ←→ [frames: HEADERS, DATA]  (одновременно!)
Stream 5: GET /api/data   ←→ [frames: HEADERS, DATA]
```

**Бинарный протокол:** данные передаются фреймами, не текстом. Эффективнее парсинг.

**Header Compression (HPACK):** заголовки сжимаются через Huffman + таблицу ранее отправленных заголовков. Экономия 85-90% трафика заголовков.

**Server Push:** сервер может отправить ресурсы до запроса клиента.
```
Client: GET /index.html
Server: вот index.html + PUSH /style.css + PUSH /script.js
```

**Stream Prioritization:** можно указать приоритет потока (критические ресурсы первыми).

**Требует TLS** (на практике — HTTPS обязателен, хотя технически опционален).

### HTTP/3 (QUIC)

HTTP/2 решил head-of-line на уровне HTTP, но не TCP: потеря одного пакета → все потоки ждут повторной отправки.  
HTTP/3 переходит на **QUIC** (UDP + TLS встроен) — каждый поток независим на уровне транспорта.

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Транспорт | TCP | TCP | UDP (QUIC) |
| Формат | Текст | Бинарный | Бинарный |
| Мультиплексирование | Нет | Да | Да |
| HOL Blocking | HTTP + TCP | TCP | Нет |
| 0-RTT | Нет | Нет | Да |
| Header Compression | Нет | HPACK | QPACK |

---

## Протоколы уровня приложения

| Протокол | Транспорт | Применение |
|----------|-----------|------------|
| HTTP/1.1, HTTP/2, HTTP/3 | TCP / QUIC | Web, REST API |
| WebSocket | TCP (upgrade от HTTP) | В реальном времени: чат, игры, биржа |
| gRPC | HTTP/2 (TLS) | Microservices, потоковый RPC |
| MQTT | TCP | IoT, pub/sub, low-bandwidth |
| AMQP | TCP | Message brokers (RabbitMQ) |
| SMTP/IMAP/POP3 | TCP | Email |
| DNS | UDP (53) / TCP | Резолвинг имён |
| FTP | TCP | Передача файлов |
| SSH | TCP | Удалённый доступ |
| WebRTC | UDP + DTLS | P2P видео/аудио |

---

## REST на WebSockets

**WebSocket** — full-duplex соединение: сервер может отправить данные в любой момент без запроса клиента.

**Handshake** (HTTP Upgrade):
```
Client → GET /ws HTTP/1.1
         Upgrade: websocket
         Connection: Upgrade
         Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

Server → 101 Switching Protocols
         Upgrade: websocket
         Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

**Можно ли построить REST на WebSockets?** — технически да, но это антипаттерн:
- REST предполагает модель без состояния (запрос/ответ). WebSocket — с состоянием, постоянное соединение.
- HTTP методы (GET/POST/PUT/DELETE), коды ответа, кэширование — не существуют в WS
- WebSocket нужен для push-данных от сервера, двунаправленной потоковой передачи, работы в реальном времени

**Правильный выбор:**
- REST (HTTP) → request/response, CRUD, кэшируемость
- WebSocket → уведомления в реальном времени, чат, live data (котировки, scoreboard)
- gRPC → серверная/клиентская/двунаправленная потоковая передача с типизированным API
- SSE (Server-Sent Events) → server push в одну сторону, проще WebSocket

---

## Идемпотентность HTTP-методов

**Идемпотентность** — повторный вызов с теми же параметрами даёт тот же результат (состояние системы не меняется от количества повторений).

| Метод | Безопасный | Идемпотентный |
|-------|-----------|--------------|
| GET | Да | Да |
| HEAD | Да | Да |
| OPTIONS | Да | Да |
| PUT | Нет | Да |
| DELETE | Нет | Да |
| POST | Нет | Нет |
| PATCH | Нет | Нет (обычно) |

**GET должен быть идемпотентным** потому что:
1. Браузеры кэшируют GET — повторный запрос может не дойти до сервера
2. Прокси и CDN кэшируют GET
3. Предзагрузка — браузер может выполнить GET заранее
4. "Back" кнопка повторяет GET без предупреждения
5. Поисковые роботы обходят GET-ссылки

GET с side-effects нарушает эти ожидания → кэши вернут старый результат, предзагрузка изменит данные.

**POST не идемпотентен** — повторная отправка = повторная операция (дублирование заказа, платежа). Браузер предупреждает при повторной отправке формы.

---

## HTTP кэширование

### Заголовки кэша

**Cache-Control:**
```http
Cache-Control: max-age=3600           -- кэшировать 3600 секунд
Cache-Control: no-cache               -- всегда валидировать с сервером (ETag/Last-Modified)
Cache-Control: no-store               -- не кэшировать вообще (sensitive data)
Cache-Control: private                -- только браузер, не CDN/прокси
Cache-Control: public                 -- можно кэшировать везде (CDN)
Cache-Control: immutable              -- никогда не валидировать (хэшированные ресурсы)
Cache-Control: stale-while-revalidate=60  -- отдать устаревший, обновить в фоне 60с
```

**Валидация (условные запросы):**
```http
# Сервер → клиент при первом ответе:
ETag: "abc123"
Last-Modified: Wed, 21 Oct 2025 07:28:00 GMT

# Клиент → сервер при повторном запросе:
If-None-Match: "abc123"
If-Modified-Since: Wed, 21 Oct 2025 07:28:00 GMT

# Если не изменилось:
HTTP/1.1 304 Not Modified
# Тело не передаётся → экономия трафика
```

### Стратегии кэширования

**Cache busting** — добавить хэш файла в имя или query string:
```html
<script src="/app.js?v=abc123"></script>
<!-- или -->
<script src="/app.abc123.js"></script>
```
Тогда `Cache-Control: immutable, max-age=31536000` — браузер никогда не перепроверяет, а при изменении файла меняется URL.

**API кэширование:**
```http
# Публичные данные (курсы валют, каталог)
Cache-Control: public, max-age=60, stale-while-revalidate=600

# Пользовательские данные
Cache-Control: private, max-age=0, no-cache

# Sensitive (пароли, платёжные данные)
Cache-Control: no-store
```

### Уровни кэша

```
Browser cache → Service Worker → CDN (Cloudflare, etc.) → Reverse Proxy (Nginx) → App Server → DB Cache (Redis) → DB
```

**CDN** — географически распределённый кэш. Запрос идёт к ближайшему POP (point of presence). Ключ кэша: URL + Vary-заголовки.

**Vary:** указывает, от каких заголовков запроса зависит ответ:
```http
Vary: Accept-Encoding    -- разные версии для gzip/br/identity
Vary: Accept-Language    -- разные версии для en/ru
Vary: Authorization      -- запретить CDN кэшировать авторизованные ответы
```

---

## Шифрование, хеширование, кодирование

### Кодирование (Encoding)

Обратимое преобразование данных в другой формат. **Не для безопасности**.

| | Применение | Пример |
|---|---|---|
| Base64 | Передача бинарных данных в текстовом протоколе | Email attachments, JWT payload |
| URL encoding | Специальные символы в URL | `space → %20`, `& → %26` |
| UTF-8 | Текст в байты | Все строки |
| HTML encoding | Экранирование в HTML | `< → &lt;` (защита от XSS) |

### Хеширование (Hashing)

Одностороннее преобразование. Нельзя восстановить исходные данные из хеша.

| Алгоритм | Длина | Применение |
|----------|-------|-----------|
| MD5 | 128 бит | Контрольные суммы файлов (НЕ для безопасности) |
| SHA-1 | 160 бит | Устарел, git (скоро уйдёт) |
| SHA-256/512 | 256/512 бит | Целостность данных, HMAC |
| bcrypt | variable | Хранение паролей (медленный — защита от brute force) |
| Argon2 | variable | Хранение паролей (победитель PHC 2015) |
| PBKDF2 | variable | Хранение паролей (NIST рекомендует) |

**Соль (salt):** случайная строка, добавляемая к паролю перед хешированием. Защищает от rainbow table атак.

```java
// Spring Security
String hash = BCryptPasswordEncoder.encode(password); // bcrypt сам генерирует соль
// Соль хранится в начале хеша: $2a$10$<salt><hash>
```

**HMAC (Hash-based Message Authentication Code):** хеш с секретным ключом для проверки целостности.
```
HMAC-SHA256(key, message) → signature
```
Используется в JWT подписи, AWS API authentication.

### Шифрование (Encryption)

Обратимое преобразование с ключом. Можно расшифровать зная ключ.

#### Симметричное (один ключ для шифрования и расшифровки)

| Алгоритм | Длина ключа | Применение |
|----------|-------------|-----------|
| AES-256-GCM | 256 бит | Шифрование данных (рекомендуется) |
| AES-128-CBC | 128 бит | Старый стандарт |
| ChaCha20-Poly1305 | 256 бит | Мобильные устройства (быстрее AES без аппаратного ускорения) |
| 3DES | 168 бит | Устарел |

**Проблема:** как безопасно передать ключ? → Асимметричное шифрование.

#### Асимметричное (публичный + приватный ключ)

| Алгоритм | Применение |
|----------|-----------|
| RSA-2048/4096 | Подпись, обмен ключами, TLS |
| ECDSA (P-256, P-384) | Подпись (компактнее RSA) |
| X25519 (ECDH) | Key exchange в TLS 1.3 |
| Ed25519 | SSH ключи, JWT (EdDSA) |

**Принцип:** зашифровать публичным ключом → расшифровать только приватным. Подписать приватным → проверить публичным.

#### TLS — как работает (TLS 1.3)

```
1. Client Hello: поддерживаемые cipher suites, key_share (X25519)
2. Server Hello: выбранный cipher, key_share
3. Обе стороны вычисляют shared secret (ECDH) → session keys
4. Server Certificate + CertificateVerify (подпись приватным ключом)
5. Finished (MAC всего handshake)
6. Application Data (AES-GCM шифрование)
```

TLS 1.3 убрал RSA key exchange (нет Perfect Forward Secrecy), поддерживает только ECDH.

**Perfect Forward Secrecy:** временные ключи генерируются для каждой сессии. Компрометация долгосрочного ключа сервера не раскроет прошлые сессии.

---

## Источники

**RFC (HTTP стек):**
- [RFC 9110 — HTTP Semantics](https://datatracker.ietf.org/doc/html/rfc9110) — методы, статус-коды, header-семантика (заменил 7230-7235).
- [RFC 9111 — HTTP Caching](https://datatracker.ietf.org/doc/html/rfc9111) — `Cache-Control`, `ETag`, `Vary`, `If-None-Match`.
- [RFC 9112 — HTTP/1.1](https://datatracker.ietf.org/doc/html/rfc9112) — wire-format.
- [RFC 9113 — HTTP/2](https://datatracker.ietf.org/doc/html/rfc9113) — мультиплексирование, HPACK, `RST_STREAM`.
- [RFC 9114 — HTTP/3](https://datatracker.ietf.org/doc/html/rfc9114) и [RFC 9000 — QUIC](https://datatracker.ietf.org/doc/html/rfc9000).
- [RFC 6455 — The WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455).
- [RFC 8446 — TLS 1.3](https://datatracker.ietf.org/doc/html/rfc8446) — Perfect Forward Secrecy, 0-RTT, removed RSA key exchange.
- [RFC 1918 — Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918).

**Книги / open resources:**
- [*High Performance Browser Networking* (Ilya Grigorik, O'Reilly)](https://hpbn.co/) — каноническая бесплатная книга по HTTP/1.1/2/3, TLS, WebSocket.
- *TCP/IP Illustrated, Vol. 1* (W. Richard Stevens, 2nd ed.) — фундамент TCP, retransmission, congestion control.

**Engineering blogs:**
- [Cloudflare Learning Center — HTTP/2 vs HTTP/3 articles](https://www.cloudflare.com/learning/performance/http2-vs-http1.1/) — простые сравнения с диаграммами.
- [Daniel Stenberg (curl maintainer) — HTTP/3 Explained](https://http3-explained.haxx.se/) — бесплатная open-book.
- [Mark Nottingham (HTTP WG chair) blog](https://www.mnot.net/blog/) — нюансы спеки от человека, который её редактирует.
