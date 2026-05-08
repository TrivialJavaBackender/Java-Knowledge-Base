package exercises

/**
 * Ex09 — HTTP ETag / If-None-Match → 304.
 *
 * Реализуй мини-handler без реальной сети, который имитирует HTTP-семантику валидаторов.
 *
 * `Resource(id, body)` — данные на сервере. `body` может изменяться через `setBody`.
 *
 * `EtagHandler.handle(request: Request): Response`:
 * - request: id ресурса + опционально `If-None-Match`.
 * - response:
 *   - 200 OK с body и заголовком `ETag` — если ресурс существует и (нет If-None-Match,
 *     либо его значение не совпадает с текущим ETag).
 *   - 304 Not Modified, без body, с заголовком `ETag` — если If-None-Match совпал.
 *   - 404 Not Found — если ресурса нет.
 * - ETag — strong, формула: `"sha1-${SHA1(body).take(16)}"`. (Криптостойкость не нужна; это
 *   только демо.)
 *
 * Дополнительно:
 * - Реализуй `If-Match` для PUT (`PutRequest`):
 *   - 200 OK + новый ETag если If-Match совпал.
 *   - 412 Precondition Failed если ресурс существует, но If-Match не совпал.
 *   - 200 OK без проверки если If-Match отсутствует (но это плохая практика — оставь
 *     warning в логах).
 *
 * Тесты в main:
 * 1. GET без If-None-Match → 200 + body + ETag.
 * 2. GET с правильным If-None-Match → 304 без body.
 * 3. GET с неправильным If-None-Match → 200 с body.
 * 4. setBody → ETag меняется → If-None-Match со старым ETag даёт 200.
 * 5. PUT с If-Match старого ETag → 412.
 * 6. PUT с If-Match актуального ETag → 200 + новый ETag.
 *
 * Не используй HTTP-фреймворки. Только классы данных и логика.
 */

import java.security.MessageDigest

data class Request(val id: String, val ifNoneMatch: String? = null)
data class PutRequest(val id: String, val body: ByteArray, val ifMatch: String? = null)

data class Response(
    val status: Int,
    val body: ByteArray? = null,
    val etag: String? = null
)

class Resource(val id: String, body: ByteArray) {
    var body: ByteArray = body
        private set
    fun setBody(newBody: ByteArray) { body = newBody }
}

class EtagHandler {
    private val resources = mutableMapOf<String, Resource>()

    fun add(r: Resource) { resources[r.id] = r }

    fun handle(req: Request): Response { TODO() }

    fun handlePut(req: PutRequest): Response { TODO() }

    private fun etagOf(body: ByteArray): String { TODO() }
}

fun main() {
    val handler = EtagHandler()
    handler.add(Resource("a1", "hello".toByteArray()))

    val r1 = handler.handle(Request("a1"))
    require(r1.status == 200 && r1.etag != null && r1.body != null)
    val tag = r1.etag!!

    val r2 = handler.handle(Request("a1", ifNoneMatch = tag))
    require(r2.status == 304 && r2.body == null) { "expected 304, got $r2" }

    val r3 = handler.handle(Request("a1", ifNoneMatch = "\"sha1-bogus\""))
    require(r3.status == 200)

    handler.handle(Request("missing")).also { require(it.status == 404) }

    // Изменили — старый ETag больше не валиден
    handler.add(Resource("a1", "hello world".toByteArray()))
    val r4 = handler.handle(Request("a1", ifNoneMatch = tag))
    require(r4.status == 200)

    // PUT с устаревшим If-Match
    val putBad = handler.handlePut(PutRequest("a1", "boom".toByteArray(), ifMatch = tag))
    require(putBad.status == 412)

    val cur = handler.handle(Request("a1")).etag!!
    val putOk = handler.handlePut(PutRequest("a1", "boom".toByteArray(), ifMatch = cur))
    require(putOk.status == 200 && putOk.etag != cur)

    println("all checks passed")
}
