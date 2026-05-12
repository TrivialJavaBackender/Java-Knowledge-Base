# Аутентификация и безопасность

## JWT (JSON Web Token)

### Структура

JWT = три части, разделённые точками: `header.payload.signature`

```
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIiwicm9sZXMiOlsiVVNFUiJdLCJleHAiOjE3MDA...}.<signature>
```

**Header** (base64url):
```json
{ "alg": "HS256", "typ": "JWT" }
```

**Payload** (base64url) — claims:
```json
{
  "sub": "user123",         // subject
  "iss": "auth-service",    // issuer
  "aud": "api-service",     // audience
  "exp": 1700000000,        // expiration (unix timestamp)
  "iat": 1699999000,        // issued at
  "roles": ["USER", "ADMIN"]
}
```

**Signature:**
```
HMAC-SHA256(base64url(header) + "." + base64url(payload), secretKey)
// или RSA/ECDSA для asymmetric (RS256/ES256)
```

### Валидация JWT (сервер)

1. Проверить структуру (3 части)
2. Декодировать header → алгоритм
3. Проверить подпись (HMAC или RSA)
4. Проверить `exp` — не просрочен
5. Проверить `iss`, `aud` — ожидаемый источник/получатель
6. Проверить `nbf` (not before) если есть

```java
// Spring: JwtDecoder + @EnableMethodSecurity
Jwt jwt = jwtDecoder.decode(token);
jwt.getClaimAsString("sub");
jwt.getClaimAsStringList("roles");
```

### Stateless vs Stateful аутентификация

| | Session (stateful) | JWT (stateless) |
|---|---|---|
| Хранение | Session ID в cookie, данные на сервере | Все данные в токене |
| Масштабирование | Нужен sticky session или distributed session store (Redis) | Нет серверного состояния |
| Отзыв | Удалить сессию → мгновенно | Нельзя отозвать до exp → нужен blocklist |
| Размер | Маленький cookie | JWT может быть большим |
| Применение | Монолит, Web App | Микросервисы, SPA, mobile |

### Отзыв JWT (Revocation)

JWT stateless — нет механизма отзыва без сервера. Решения:
1. **Короткий TTL** (5-15 минут) + refresh token с длинным TTL
2. **Blocklist в Redis** — хранить jti (JWT ID) отозванных токенов до exp
3. **Refresh token rotation** — при каждом обновлении выдавать новый refresh, старый инвалидировать

---

## OAuth 2.0

**OAuth 2.0** — фреймворк авторизации. Позволяет третьим сторонам получить доступ к ресурсам пользователя без раскрытия пароля.

### Роли

| Роль | Описание | Пример |
|------|----------|--------|
| Resource Owner | Пользователь | Вы |
| Client | Приложение, запрашивающее доступ | Мобильное приложение |
| Authorization Server | Выдаёт токены | Google, Keycloak, Auth0 |
| Resource Server | Защищённый API | Google Calendar API |

### Grant Types (потоки)

#### Authorization Code (с PKCE — рекомендуется для SPA/mobile)

```
1. Client → Authorization Server:
   GET /authorize?response_type=code&client_id=...&redirect_uri=...&scope=...&code_challenge=...

2. Пользователь логинится и соглашается

3. Authorization Server → Client (redirect):
   https://myapp.com/callback?code=AUTH_CODE

4. Client → Authorization Server (backend):
   POST /token
   { grant_type: authorization_code, code: AUTH_CODE, code_verifier: ... }

5. Authorization Server → Client:
   { access_token, refresh_token, expires_in }

6. Client → Resource Server:
   GET /api/data
   Authorization: Bearer ACCESS_TOKEN
```

**PKCE (Proof Key for Code Exchange):** `code_verifier` (random) → `code_challenge = SHA256(code_verifier)`. Защищает от перехвата кода.

#### Client Credentials (machine-to-machine)

```
Service A → Authorization Server:
POST /token
{ grant_type: client_credentials, client_id, client_secret, scope }

→ { access_token }
```

Нет пользователя. Используется для сервис-к-сервис.

#### Refresh Token

```
Client → Authorization Server:
POST /token
{ grant_type: refresh_token, refresh_token: REFRESH }

→ { access_token, [new refresh_token] }
```

### OpenID Connect (OIDC)

OIDC — слой идентификации поверх OAuth 2.0. Добавляет **ID Token** (JWT с информацией о пользователе).

```
scope=openid → получаем id_token + access_token
scope=openid profile email → + имя, email в id_token

// id_token claims:
{ sub, iss, aud, exp, iat, name, email, picture }
```

OAuth 2.0 — авторизация (что можно делать).  
OIDC — аутентификация (кто ты).

---

## Spring Security

> **Тема перенесена в модуль `spring-frameworks`.**
>
> См. [`modules/spring-frameworks/theory/SPRING_SECURITY.md`](../../spring-frameworks/theory/SPRING_SECURITY.md)
>
> Содержание: Filter Chain архитектура, SecurityContext, конфигурация SecurityFilterChain, JWT decoder, Method Security (@PreAuthorize), UserDetailsService, BCrypt, CSRF, OWASP Top 10.

---

> **Distributed Tracing** — см. [`modules/infrastructure/theory/OBSERVABILITY.md`](../../infrastructure/theory/OBSERVABILITY.md) (раздел 4). Tracing — один из трёх столпов observability, который живёт в infrastructure модуле.

---

## Источники

**RFC / стандарты:**
- [RFC 7519 — JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519)
- [RFC 6749 — The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7636 — Proof Key for Code Exchange (PKCE)](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 8252 — OAuth 2.0 for Native Apps (Best Current Practice)](https://datatracker.ietf.org/doc/html/rfc8252)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) — OIDC поверх OAuth 2.0.

**Security guidance:**
- [OWASP — JSON Web Token for Java Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html) — типичные ошибки валидации JWT.
- [OAuth 2.0 Threat Model and Security Considerations (RFC 6819)](https://datatracker.ietf.org/doc/html/rfc6819)
- [OAuth 2.0 Security Best Current Practice (draft-ietf-oauth-security-topics)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics) — почему Implicit flow устарел.

**Книги:**
- *OAuth 2 in Action* (Justin Richer, Antonio Sanso, Manning 2017) — единственная книга от автора многих RFC.
- *API Security in Action* (Neil Madden, Manning 2020) — JWT/JWE/JWS, OAuth, mTLS на практике.
