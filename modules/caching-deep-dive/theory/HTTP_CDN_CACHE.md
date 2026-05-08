# HTTP & CDN Caching

HTTP — самый старый и самый стандартизованный кэширующий протокол. Управляется заголовками; работает на трёх уровнях: browser → CDN edge → origin.

База по HTTP — [`system-design/theory/http_networking.md`](../../system-design/theory/http_networking.md).

## `Cache-Control` (RFC 7234 / 9111)

Самый главный заголовок. Запрос/ответ.

### Директивы ответа

| Директива | Семантика |
|-----------|-----------|
| `max-age=<s>` | Свежесть N секунд. Обязательная. |
| `s-maxage=<s>` | Как `max-age`, но **только для shared caches** (CDN, прокси). Перебивает `max-age`. |
| `public` | Можно кэшировать **shared** caches (CDN). |
| `private` | Только в **private** cache (браузер юзера). Не клади в CDN. |
| `no-cache` | **Обязан** revalidate (через `If-None-Match`/`If-Modified-Since`) перед использованием. **НЕ значит "не кэшировать"**. |
| `no-store` | Вообще не кэшировать (ни диск, ни память). Для чувствительного. |
| `must-revalidate` | После `max-age` обязан revalidate. Обычно подразумевается, но строгое поведение запрещает stale-on-error. |
| `immutable` | Контент НИКОГДА не изменится. Браузер не делает revalidate в `max-age`. Идеал для versioned URLs. |
| `stale-while-revalidate=<s>` | После `max-age` отдавать stale + async revalidate в течение N секунд. |
| `stale-if-error=<s>` | При ошибке origin — отдавать stale в течение N секунд. |

### Директивы запроса

| Директива | Семантика |
|-----------|-----------|
| `no-cache` | Заставить revalidate (Ctrl+F5 в браузере) |
| `no-store` | Заставить не кэшировать |
| `max-age=0` | "Свежее, чем 0s" → revalidate |
| `only-if-cached` | Не ходить в сеть, если miss — 504 |

### Типичные комбинации

```
Cache-Control: no-store
```
Чувствительное (банковские балансы, токены).

```
Cache-Control: max-age=0, no-cache
```
HTML страница с динамикой — заставить revalidate каждый раз (ETag решит, передавать ли тело).

```
Cache-Control: public, max-age=31536000, immutable
```
Versioned static asset (`/app.abc123.js`) — год в кэше без revalidate.

```
Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=86400
```
API-эндпоинт: браузер 1 минута, CDN 10 минут; на CDN после 10 минут — stale в течение суток + async refresh.

---

## Validators: ETag и Last-Modified

Заголовки **на ответ** дают валидаторы; клиент шлёт их назад на следующем запросе.

### ETag / If-None-Match

```
GET /article/42
←  200 OK
   ETag: "abc-v3"
   Body: ...

GET /article/42
   If-None-Match: "abc-v3"
←  304 Not Modified
   (без body)
```

**Strong ETag (`"abc"`):** точное совпадение байт ответа.
**Weak ETag (`W/"abc"`):** семантическое равенство (например, разные форматы пробелов считаются равными).

ETag можно генерить как:
- хеш контента (`SHA1(body)`)
- версия из БД (`row.version`)
- timestamp (но тогда лучше `Last-Modified`)

### Last-Modified / If-Modified-Since

```
GET /article/42
←  200 OK
   Last-Modified: Wed, 06 May 2026 10:00:00 GMT

GET /article/42
   If-Modified-Since: Wed, 06 May 2026 10:00:00 GMT
←  304 Not Modified
```

Гранулярность 1 секунда. Уязвим к clock skew.

### Strong vs Weak validation для `If-Match` (PUT)

```
PUT /article/42
   If-Match: "abc-v3"
   Body: ...
```

Optimistic locking. Если ETag не совпал → `412 Precondition Failed`. ETag — **strong** обязателен для PUT (W/ нельзя).

---

## `Vary`

Сообщает кэшу, что ответ зависит от значений других заголовков:

```
Cache-Control: public, max-age=60
Vary: Accept-Encoding, Accept-Language
```

CDN/браузер хранит отдельные копии для разных значений `Accept-Encoding` (gzip vs br) и `Accept-Language` (en vs ru).

**Грабли:** `Vary: User-Agent` или `Vary: Cookie` → cardinality взрывается, hit-ratio падает в ноль. Никогда не делать `Vary: Cookie` для статики.

---

## CDN

CDN = распределённая сеть edge-серверов с кэшем перед origin'ом.

### Pull vs Push

- **Pull:** edge не знает контент заранее; на первый miss идёт к origin, кэширует локально. Дефолт (Cloudflare, Fastly, CloudFront).
- **Push:** контент заливается на edge заранее (через API). Подходит для крупных файлов, гарантированных hits.

### Invalidation

1. **Versioned URLs:** вместо `/app.js` → `/app.abc123.js`. На deploy меняется хеш → новый URL → instant rollout. Старые версии живут в кэше до eviction. **Default для статики.**
2. **Purge API:** удалить ресурс из всех edge'ей. Минуты задержки распространения; иногда деньги; не всегда атомарно.
3. **Soft purge** (Fastly, Cloudflare Workers): помечает stale, не удаляет — следующий запрос принесёт revalidate, а пока висит — stale-while-revalidate.

Default стратегия: **versioned URLs для всего, что меняется при deploy**. Purge — только для контента, который **должен** исчезнуть (legal removal).

### Cache key

Edge кэширует по `(method, host, path, query, Vary headers)`. Удалить из ключа что не нужно (например, рекламные параметры `?utm_source=...`) — настройка в CDN.

### Surrogate-Control

Альтернатива `Cache-Control` только для CDN (origin шлёт CDN'у; CDN не передаёт клиенту). Используется в Fastly/Akamai для разделения "cache в CDN на 1 час, но клиент не должен кэшировать".

---

## Service Worker / Browser-side

Service Worker может перехватывать `fetch` в браузере и реализовывать произвольные стратегии:
- **cache-first:** сначала кэш, fallback в сеть.
- **network-first:** сначала сеть, fallback в кэш (offline).
- **stale-while-revalidate:** отдать кэш + обновить в фоне.

Полезно для PWA / offline-first.

---

## Грабли

1. **`no-cache` ≠ `no-store`.** `no-cache` РАЗРЕШАЕТ кэшировать, требует revalidate. `no-store` запрещает.
2. **Куки + кэширование:** если `Cache-Control: private` забыт, CDN может закэшировать ответ с set-cookie от одного юзера и отдать другому. **Default'но включи `private` или `no-store` для аутентифицированных ответов.**
3. **GET vs POST:** POST по умолчанию не кэшируется. Для idempotent читалки используй GET (или `Cache-Control: max-age` на POST с явной поддержкой кэшем — реализуется редко).
4. **CORS preflight (`OPTIONS`)** кэшируется отдельно через `Access-Control-Max-Age`.
5. **`Vary` забыт:** разные пользователи получают чужой gzip/non-gzip → "битые" картинки.
6. **Огромный ETag:** weak ETag из 8 байт лучше strong из 64. Большие ETag увеличивают header size.

## См. также

- HTTP базовые → [`system-design/theory/http_networking.md`](../../system-design/theory/http_networking.md)
- ETag упражнение → Ex09
- Anti-patterns → [ANTI_PATTERNS.md](ANTI_PATTERNS.md)
