# Identity Providers, OAuth2, OIDC, SAML 2.0

## Фундаментальная разница: аутентификация vs авторизация

**Аутентификация** — "кто ты?" (identity). Ты — Pavel, пользователь с email pavel@example.com.

**Авторизация** — "что тебе разрешено?" (permissions). Ты можешь читать /calendar, но не /admin.

Главная ошибка: OAuth2 — это **авторизация**, а не аутентификация. OAuth2 отвечает на вопрос "какие действия разрешены приложению X от имени пользователя Y". Он не говорит, кто этот пользователь. OIDC добавляет идентификацию поверх OAuth2.

---

## JWT — самодостаточный токен

JSON Web Token (RFC 7519) позволяет Resource Server проверить токен **локально**, без вызова Authorization Server на каждый запрос.

### Структура

JWT состоит из трёх частей, разделённых точками: `header.payload.signature`. Каждая часть — base64url.

```
eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJ1c2VyMTIzIiwiZXhwIjoxNzAwMDAwMDAwfQ.<signature>
```

**Header** (base64url):
```json
{ "alg": "RS256", "typ": "JWT", "kid": "key-id-1" }
```

**Payload** (base64url) — claims:
```json
{
  "sub": "user123",         // subject — стабильный ID пользователя
  "iss": "https://as.example.com",  // issuer — кто выдал
  "aud": "api-service",     // audience — для кого выдан
  "exp": 1700000000,        // expiration (Unix timestamp)
  "iat": 1699999000,        // issued at
  "nbf": 1699999000,        // not before (опционально)
  "jti": "9f8b...",         // JWT ID — используется в blocklist при отзыве
  "scope": "read:orders write:orders",
  "roles": ["USER", "ADMIN"]
}
```

**Signature** — зависит от алгоритма:
```
HS256: HMAC-SHA256(base64url(header) + "." + base64url(payload), secretKey)
RS256: RSA-SHA256(base64url(header) + "." + base64url(payload), privateKey)
ES256: ECDSA-SHA256 (более компактные ключи и подпись)
```

### Алгоритмы подписи

| Алгоритм | Тип | Кто подписывает | Кто проверяет | Когда использовать |
|----------|-----|-----------------|---------------|--------------------|
| HS256 | Symmetric (HMAC) | shared secret | shared secret | AS == RS (один сервис) |
| RS256 | Asymmetric (RSA) | private key (AS) | public key (любой) | Микросервисы, федерация |
| ES256 | Asymmetric (ECDSA) | private key (AS) | public key (любой) | То же что RS256, но компактнее |

В микросервисах и federated сценариях — RS256/ES256: Resource Server проверяет токен публичным ключом, который безопасно публикуется. Private key никогда не покидает AS.

### Валидация JWT (Resource Server)

```
Resource Server получает: Authorization: Bearer eyJhbGc...

1. Декодировать header: { "alg": "RS256", "kid": "key-id-1" }
2. Получить публичный ключ AS по kid: GET /.well-known/jwks.json (кешируется в памяти)
3. Проверить подпись RSA — математически, без обращения к AS
4. Проверить exp — токен не просрочен
5. Проверить iss — выдан ожидаемым AS
6. Проверить aud — токен предназначен этому Resource Server
7. (опционально) Проверить nbf — токен уже активен
```

Spring Security декодер:

```yaml
# application.yml — Spring сам загрузит JWKS через OIDC discovery
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://keycloak/realms/my-realm
```

```java
@Bean
SecurityFilterChain chain(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(a -> a
            .requestMatchers("/admin/**").hasRole("ADMIN")
            .anyRequest().authenticated())
        .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()))
        .build();
}

// Получить claims в контроллере:
@GetMapping("/me")
public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
    return Map.of(
        "sub", jwt.getClaimAsString("sub"),
        "roles", jwt.getClaimAsStringList("roles")
    );
}
```

### Stateless vs Stateful

| | Session (stateful) | JWT (stateless) |
|---|---|---|
| Хранение | Session ID в cookie, данные на сервере | Все данные в самом токене |
| Масштабирование | Sticky session или distributed session store (Redis) | Нет серверного состояния |
| Отзыв | Удалить сессию — мгновенно | Нельзя отозвать до exp — нужен blocklist |
| Размер | ~32 байта cookie | 500–2000 байт |
| Применение | Монолит, web app | Микросервисы, SPA, mobile |

### Отзыв JWT (revocation)

JWT stateless — отозвать до `exp` нельзя без какого-то серверного состояния. Три подхода:

**1. Короткий TTL + refresh rotation.** access_token живёт 5–15 минут, refresh_token (длинный TTL) хранится на сервере и может быть отозван. При каждом обмене refresh выдаётся новый — старый инвалидируется. Если refresh пытаются использовать дважды (token reuse) — это признак компрометации, инвалидируем всю цепочку.

**2. Blocklist в Redis по `jti`.** При выходе пользователя — сохранить `jti` отозванного токена с TTL до `exp`. Каждый запрос: Redis lookup по jti. Добавляет latency и зависимость от Redis, зато даёт мгновенный logout.

**3. Token introspection** — Resource Server при каждом запросе спрашивает AS:

```
POST /introspect?token=XXX
← { "active": true, "sub": "...", "scope": "...", "exp": ... }
```

Работает и для opaque (непрозрачных) токенов, которые RS вообще не декодирует. Минус — round-trip на каждый запрос; обычно AS-ответ кешируется на короткое время.

---

## OAuth 2.0 — фреймворк делегированной авторизации

### Зачем он появился

До OAuth каждое стороннее приложение, которому нужен доступ к твоим данным (например, фото в Google), просило твой логин и пароль Google. Это означало: приложение может делать от твоего имени всё что угодно, ты не можешь ограничить доступ, и при смене пароля нужно обновлять его везде.

OAuth решает это делегированием: ты даёшь приложению ограниченный токен, не пароль. Токен можно отозвать, ограничить по scope, поставить срок действия.

```
Без OAuth:
  App говорит: "Дай мне свой Google пароль"
  App делает: всё, что ты можешь делать в Google

С OAuth:
  Google спрашивает тебя: "App хочет читать твои фото. Разрешить?"
  Google выдаёт App: токен с правами read:photos, valid 1 hour
  App делает: только то, что разрешено в токене
```

### Роли

| Роль | Кто это | Пример |
|------|---------|--------|
| Resource Owner | Пользователь | Ты |
| Client | Приложение, которому нужен доступ | Твоё мобильное приложение |
| Authorization Server (AS) | Выдаёт токены, аутентифицирует пользователя | Google, Keycloak, Auth0 |
| Resource Server (RS) | Защищённый API с данными | Google Photos API |

---

## OAuth2 Flows — почему их несколько

Разные контексты требуют разных способов получения токена. Один flow для всех небезопасен.

### Authorization Code + PKCE — для web и mobile

Ключевая идея: браузер получает не токен, а одноразовый code. Токен получает backend-сервер, обменивая code. Так токен никогда не проходит через браузер, не попадает в History, не перехватывается JS.

PKCE (Proof Key for Code Exchange, RFC 7636) решает дополнительную проблему: что если кто-то перехватил code? Без PKCE его можно обменять на токен. С PKCE обмен code на токен требует знания `code_verifier` — случайной строки, которая была сгенерирована при начале flow и известна только оригинальному клиенту.

```
1. Клиент генерирует: code_verifier = random_string(43..128 chars)
                      code_challenge = BASE64URL(SHA256(code_verifier))

2. Редирект на AS: /authorize?response_type=code
                              &client_id=...
                              &redirect_uri=...
                              &scope=openid profile
                              &code_challenge=XYZ
                              &code_challenge_method=S256
   Пользователь логинится и нажимает "Разрешить"

3. AS редиректит обратно: /callback?code=AUTH_CODE (одноразовый, ~10 минут)

4. Backend обменивает:
   POST /token { grant_type: authorization_code,
                 code: AUTH_CODE,
                 code_verifier: original,
                 redirect_uri: ... }
   AS проверяет: SHA256(code_verifier) == code_challenge?  → выдаёт токены

5. Перехватчик AUTH_CODE без code_verifier → ничего не получит
```

### Client Credentials — для machine-to-machine

Нет пользователя. Сервис A хочет обратиться к Сервису B. Сервис A аутентифицируется своим `client_id` + `client_secret` (или сертификатом) и получает токен.

```
Order Service → POST /token { grant_type: client_credentials, client_id, client_secret }
             ← access_token (scope: payment:write)
Order Service → POST /charge + Bearer token → Payment Service
Payment Service проверяет токен: выдан AS, scope содержит payment:write → OK
```

Это ответ на вопрос "как один сервис доверяет другому в микросервисах".

### Refresh Token rotation

```
Client → AS:
POST /token
{ grant_type: refresh_token, refresh_token: REFRESH }

← { access_token, refresh_token: NEW_REFRESH, expires_in: 900 }
```

При каждом обмене refresh инвалидируется и выдаётся новый. Это даёт два эффекта:
- **Обнаружение компрометации:** если refresh пытаются использовать дважды — token reuse → AS инвалидирует всю цепочку refresh для этого пользователя/сессии.
- **Сужение окна:** даже если refresh утёк, после первого использования атакующим оригинальный клиент при следующем рефреше получит ошибку — и мы узнаем об атаке.

### Почему Implicit Flow устарел

Раньше для SPA использовался Implicit: токен возвращался прямо в redirect URI fragment (`#access_token=...`). Проблема — токен в URL, в History браузера, может утечь через Referer header. С PKCE Authorization Code flow безопасен для SPA без backend — Implicit больше не нужен (см. OAuth 2.0 Security BCP).

---

## OIDC — идентификация поверх OAuth2

OAuth2 не говорит кто пользователь — только что ему разрешено. OIDC добавляет один токен — `id_token` (всегда JWT), который содержит информацию о пользователе.

```
OAuth2 scope=openid → получаем id_token + access_token
       scope=openid profile email → + name, email в id_token

id_token (JWT):
{
  "sub": "user-123",           // стабильный идентификатор пользователя
  "iss": "https://as.example.com",
  "aud": "my-client-id",       // для кого выдан (Client, не RS)
  "exp": 1700000000,
  "iat": 1699999000,
  "nonce": "...",              // защита от replay
  "email": "pavel@example.com", // если scope=email
  "name": "Pavel Saroka"        // если scope=profile
}
```

**Главное правило:** id_token предназначен клиентскому приложению (Client). access_token предназначен Resource Server. Не передавай id_token в API как Bearer.

### Discovery endpoint

Все OIDC-совместимые AS публикуют метаданные по стандартному URL. Приложению не нужно hardcode-ить адреса endpoint'ов:

```
GET https://accounts.google.com/.well-known/openid-configuration
← {
    "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
    "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
    "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
    ...
  }
```

Spring Security использует `issuer-uri` в конфиге и сам загружает всё через discovery.

---

## SAML 2.0 — XML federation в enterprise

SAML (Security Assertion Markup Language, 2005) решает ту же задачу SSO что и OIDC, но через XML. Появился до OAuth2 и до мобильной эпохи, поэтому ориентирован на браузерные HTTP redirects и POST-формы.

### Зачем SAML нужен сегодня

Большинство корпоративных систем — Active Directory, Okta, Azure AD — поддерживают SAML. Если твоя компания использует эти IdP, и старые enterprise-приложения (Jira, Confluence, Salesforce) ожидают SAML — ты используешь SAML.

### Ключевое отличие от OAuth2: push vs pull

OAuth2 — **pull**: клиент сам запрашивает токен у AS.  
SAML — **push**: IdP POST'ит Assertion прямо в браузере на SP (через форму с SAMLResponse).

```
SAML SP-initiated flow:

1. Пользователь открывает app.company.com/report
2. SP видит: нет сессии → формирует SAMLRequest (XML, сжат, base64) → редиректит на IdP
3. Пользователь логинится в IdP (может через Windows Kerberos — SSO без ввода пароля)
4. IdP формирует SAMLResponse (XML с Assertion, подписан RSA приватным ключом IdP)
5. IdP POST'ит форму в браузер → браузер автоматически POST'ит на app.company.com/saml/acs
6. SP проверяет подпись XML (используя публичный ключ IdP из metadata)
7. SP создаёт сессию для пользователя → редиректит на /report
```

Assertion содержит атрибуты пользователя: email, группы, department — SP использует их для авторизации.

### Что внутри SAML Assertion

```
<saml:Assertion>
  <saml:Conditions NotBefore="10:00" NotOnOrAfter="10:10">
    <saml:AudienceRestriction>
      <saml:Audience>https://app.company.com</saml:Audience>
    </saml:AudienceRestriction>
  </saml:Conditions>

  <saml:Subject>
    <saml:NameID>pavel@company.com</saml:NameID>
  </saml:Subject>

  <saml:AttributeStatement>
    <saml:Attribute Name="groups">
      <saml:AttributeValue>engineering</saml:AttributeValue>
      <saml:AttributeValue>admin</saml:AttributeValue>
    </saml:Attribute>
  </saml:AttributeStatement>

  <ds:Signature>...</ds:Signature>  ← подписано IdP
</saml:Assertion>
```

### SAML vs OIDC — когда что выбрать

| | SAML 2.0 | OIDC |
|---|---|---|
| Формат | XML (тяжёлый) | JSON / JWT (лёгкий) |
| Транспорт | HTTP form POST / redirect | HTTP REST |
| Mobile | Плохо (нет redirect_uri flow) | Отлично |
| Корпоративная среда | Стандарт де-факто | Активно внедряется |
| Настройка | XML metadata обмен | Discovery endpoint |
| Refresh | Нет стандарта | Refresh token |

**Правило:** если сам выбираешь IdP для нового приложения — OIDC. Если нужна интеграция с корпоративным AD/Okta где IT требует SAML — SAML.

---

## Хранение паролей пользователей

### Почему нельзя SHA-256 (и даже SHA-512)

Криптографические хэши спроектированы быстрыми. GPU выполняет миллиарды SHA-256 в секунду — при утечке БД атакующий перебирает словарь паролей за минуты.

Правильные алгоритмы намеренно медленные: содержат настраиваемую "стоимость" (число итераций, объём памяти), которая делает перебор нерентабельным.

### Алгоритмы

| Алгоритм | Memory-hard | Рекомендован | Параметр сложности |
|----------|-------------|--------------|---------------------|
| MD5 / SHA-* | Нет | **Никогда** | — |
| bcrypt | Нет | Да | cost (10–12) |
| Argon2id | Да | **Лучший выбор** | memory, time, parallelism |
| PBKDF2 | Нет | Да (FIPS-compliant) | iterations (≥ 600 000) |
| scrypt | Да | Да | N, r, p |

**Memory-hard** означает, что для перебора нужно много RAM на каждое вычисление. GPU имеет быстрые ядра, но мало RAM на ядро — атака на GPU нерентабельна. Argon2id (RFC 9106) — победитель Password Hashing Competition 2015.

### Salt — защита от rainbow tables

Соль — случайные байты (≥ 16), уникальные для каждого пароля. Без соли одинаковые пароли дают одинаковые хэши, и атакующий может precompute таблицу хэшей для популярных паролей.

`bcrypt` и `Argon2` включают соль прямо в формат хэша — хранить отдельно не нужно:

```
$2b$12$<22-char-salt><31-char-hash>           ← bcrypt cost=12
$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>  ← Argon2id (OWASP recommended params)
```

### DelegatingPasswordEncoder — ротация алгоритма

Spring Security хранит хэши разных алгоритмов одновременно, идентифицируя их по префиксу. При логине старый хэш автоматически перевешивается на новый алгоритм:

```java
// Encoder выбирается по префиксу в хэше: {bcrypt}, {argon2}, {pbkdf2}, ...
PasswordEncoder encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();

// Новые пользователи — bcrypt (по умолчанию)
String hash = encoder.encode("userpassword");
// {bcrypt}$2a$10$...

// При логине: encoder.matches(plain, "{noop}old") → true → re-hash на bcrypt
// Сценарий: миграция с устаревшего MD5 без принудительного сброса всех паролей
```

Параметр сложности подбирается так, чтобы login на production занимал ~200–500 мс. Для bcrypt это обычно cost=12, для Argon2id — `m=19456, t=2, p=1` (OWASP recommendation).

---

## Keycloak — self-hosted IdP

Keycloak — open-source Identity Provider от Red Hat. Реализует OAuth2, OIDC, SAML 2.0. Self-hosted альтернатива SaaS-решениям (Auth0, Okta).

### Центральный концепт: Realm

Realm — полностью изолированное пространство. У каждого realm свои пользователи, приложения (clients), roles, настройки. Аналогия: отдельный tenant или отдельная организация.

```
master realm — системный, для управления Keycloak через Admin Console
my-company   — production realm
staging      — staging realm
```

Пользователь из `my-company` realm не может войти в `staging` realm — полная изоляция.

### Client — это твоё приложение

Client в Keycloak — это регистрация приложения, которое будет использовать Keycloak для аутентификации.

```
Confidential client (backend):
  - имеет client_secret
  - Authorization Code flow
  - Spring Boot app

Public client (SPA/mobile):
  - без client_secret (нельзя надёжно спрятать)
  - Authorization Code + PKCE
  - React SPA, Android app

Bearer-only (resource server):
  - только проверяет токены, не инициирует login
  - REST API
```

### Как Keycloak кладёт роли в JWT

Keycloak включает роли пользователя в access_token. Важно понимать структуру, чтобы правильно настроить Spring Security:

```json
{
  "realm_access": {
    "roles": ["offline_access", "user", "admin"]
  },
  "resource_access": {
    "my-backend-client": {
      "roles": ["reports:read"]
    }
  }
}
```

```java
// Spring: указать откуда брать roles из Keycloak JWT
@Bean
JwtAuthenticationConverter jwtAuthConverter() {
    var converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(jwt -> {
        var realmAccess = jwt.getClaimAsMap("realm_access");
        var roles = (List<String>) realmAccess.get("roles");
        return roles.stream()
            .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
            .toList();
    });
    return converter;
}
```

### Identity Brokering — Keycloak как прокси-IdP

Keycloak может аутентифицировать пользователей через внешние IdP: Google, GitHub, Facebook, корпоративный SAML IdP. С точки зрения твоего приложения — есть только Keycloak. Keycloak сам разбирается с внешними IdP.

```
Пользователь нажимает "Войти через Google"
  → Keycloak перенаправляет на Google OAuth
  → Google аутентифицирует пользователя
  → Google возвращает в Keycloak
  → Keycloak создаёт/обновляет запись пользователя в своём realm
  → Выдаёт свои токены (JWT от Keycloak, не от Google)
  → Приложение работает только с Keycloak — не знает про Google

Плюс: можно маппировать атрибуты Google (email, name) → атрибуты Keycloak realm
Плюс: можно добавить дополнительную проверку при первом логине через Google
```

### User Federation — существующий LDAP/AD

Если пользователи уже есть в Active Directory, Keycloak не заставляет их заново регистрироваться. User Federation позволяет Keycloak использовать AD как источник пользователей:

```
Пользователь вводит corporate логин/пароль в Keycloak
  → Keycloak делает LDAP bind к Active Directory
  → AD аутентифицирует пользователя (или отказывает)
  → Keycloak читает атрибуты из AD (email, department, groups)
  → Синхронизирует groups → Keycloak roles (по настройке маппинга)
  → Выдаёт JWT с ролями
```

---

## Популярные IdP — когда что использовать

| IdP | Тип | Особенности |
|-----|-----|-------------|
| **Keycloak** | Self-hosted | Полный контроль, бесплатно, требует ops |
| **Auth0** | SaaS | Простая настройка, дорого при > 7000 MAU |
| **Okta** | SaaS | Enterprise стандарт, HR/AD интеграции |
| **Azure AD (Entra ID)** | SaaS | M365, Windows SSO, корпоративная среда |
| **AWS Cognito** | SaaS | AWS-native, дешевле, ограниченная кастомизация |
| **Google Identity** | SaaS | Google Workspace, consumer |

---

## Типичные архитектурные схемы

### Схема 1: микросервисы + Keycloak

```
Browser ──(OIDC AuthCode+PKCE)──► Keycloak
                                       │
Browser получает JWT                   │
Browser ──Bearer token──► API Gateway  │
                              │        │
              проверяет JWT   │        │
              по JWKS от ─────┼────────┘
              Keycloak         │
                              ↓
              Service A   Service B   Service C
              (валидируют JWT локально — нет вызова Keycloak на каждый запрос)
```

### Схема 2: service-to-service

```
Order Service ──POST /token (client_credentials)──► Keycloak
              ◄── access_token ───────────────────
Order Service ──GET /charge + Bearer ─────────────► Payment Service
                                                       │
                                         проверяет JWT по JWKS
                                         убеждается: issuer = Keycloak,
                                         scope = payment:write → ОК
```

### Схема 3: корпоративный SAML + Keycloak как брокер

```
Employee открывает внутренний портал
  → Keycloak (SP) редиректит на корпоративный Okta/Azure AD (IdP)
  → Сотрудник аутентифицируется через Windows SSO (без ввода пароля)
  → Okta POST'ит SAML Assertion в Keycloak
  → Keycloak маппирует AD groups → Keycloak roles
  → Выдаёт JWT приложению

Приложение работает с Keycloak JWT — не знает про SAML/AD
```

---

## Связанные модули

> **Spring Security (реализация):** [`modules/spring-frameworks/theory/SPRING_SECURITY.md`](../../spring-frameworks/theory/SPRING_SECURITY.md) — Filter Chain, SecurityContext, JwtDecoder, Method Security (`@PreAuthorize`), UserDetailsService, CSRF, OWASP Top 10.
>
> **Distributed Tracing:** [`modules/infrastructure/theory/OBSERVABILITY.md`](../../infrastructure/theory/OBSERVABILITY.md) — trace context propagation (`traceparent`, `tracestate`) обычно проходит через тот же gateway, что и Authorization header.
>
> **Secrets/Vault/mTLS:** [`secrets_management.md`](secrets_management.md) — ops-уровень: где хранить client_secret, как доставить private key до AS, mTLS между сервисами.

---

## Частые вопросы на интервью

**Q: Зачем PKCE если уже есть client_secret?**  
A: Для public clients (SPA, mobile) client_secret нельзя хранить безопасно. PKCE решает проблему для них. Для confidential clients PKCE дополнительно защищает от authorization code interception — рекомендован и там.

**Q: Почему JWT нельзя отозвать?**  
A: JWT stateless — сервер не хранит состояния. Отзыв только через: blocklist в Redis (по jti claim), короткий TTL + refresh rotation, или token introspection (каждый раз спрашивает AS).

**Q: В чём разница access_token и id_token?**  
A: access_token — для Resource Server, говорит "что разрешено". id_token — для Client, говорит "кто пользователь". access_token не нужно декодировать клиенту, id_token не нужно передавать в API.

**Q: Как хранить client_secret в мобильном приложении?**  
A: Никак — мобильное приложение public client. client_secret не нужен. PKCE без secret — безопасный вариант.

**Q: SSO — как работает между несколькими приложениями?**  
A: После логина в Keycloak создаётся SSO session (cookie на домене Keycloak). При открытии второго приложения — оно редиректит на Keycloak, Keycloak видит валидную сессию и сразу выдаёт code без повторного ввода пароля.

**Q: HS256 vs RS256 — что выбрать?**  
A: HS256 — symmetric, требует shared secret → подходит только если AS и RS — один и тот же сервис. Микросервисы и federation — RS256/ES256: RS проверяет публичным ключом из JWKS, private key никогда не покидает AS.

**Q: Почему access_token живёт 5–15 минут, а refresh — недели?**  
A: access_token нельзя отозвать stateless → короткий TTL ограничивает окно компрометации. refresh хранится на сервере, может быть отозван, поэтому может жить долго. Rotation refresh при каждом обмене позволяет обнаружить компрометацию (token reuse → invalidate всей цепочки).

**Q: Почему bcrypt/Argon2, а не SHA-256?**  
A: SHA-* спроектированы быстрыми. GPU перебирает миллиарды SHA-256/сек → словарная атака на утёкший дамп БД занимает минуты. bcrypt/Argon2 намеренно медленные (~200–500 мс на хэш), Argon2 ещё и memory-hard — GPU-атака нерентабельна.

---

## Источники

**OAuth / OIDC:**
- [RFC 6749 — The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7636 — PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [RFC 7662 — Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [RFC 6819 — OAuth 2.0 Threat Model and Security Considerations](https://datatracker.ietf.org/doc/html/rfc6819)
- [OAuth 2.0 Security Best Current Practice (draft-ietf-oauth-security-topics)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics) — текущее «как делать правильно» от IETF.
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html), [Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html)

**JWT:**
- [RFC 7519 — JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519)
- [RFC 7515 — JSON Web Signature (JWS)](https://datatracker.ietf.org/doc/html/rfc7515)
- [RFC 7517 — JSON Web Key (JWK / JWKS)](https://datatracker.ietf.org/doc/html/rfc7517)
- [OWASP — JSON Web Token for Java Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html) — типичные ошибки валидации JWT.

**SAML 2.0:**
- [SAML 2.0 OASIS Standard — Core](http://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf)
- [SAML 2.0 Bindings (HTTP-Redirect, HTTP-POST)](http://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf)

**Password storage:**
- [RFC 9106 — Argon2 Memory-Hard Function](https://datatracker.ietf.org/doc/html/rfc9106) — победитель Password Hashing Competition 2015.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — рекомендуемые алгоритмы и параметры (Argon2id `m=19MiB, t=2, p=1` и т.д.).
- [Provos & Mazières (1999) — «A Future-Adaptive Password Scheme» (USENIX)](https://www.usenix.org/legacy/events/usenix99/provos/provos_html/) — оригинал bcrypt.
- [NIST SP 800-63B — Digital Identity Guidelines: Authentication](https://pages.nist.gov/800-63-3/sp800-63b.html) — текущие требования к хранению паролей и MFA.

**Документация продуктов:**
- [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/) — realms, clients, identity brokering, user federation.
- [Auth0 — OAuth 2.0 / OIDC concepts](https://auth0.com/docs/authenticate/protocols/oauth) — образцовое объяснение flow с диаграммами.

**Книги / posts:**
- *OAuth 2 in Action* (Justin Richer, Antonio Sanso, Manning 2017) — авторы — Working Group участники.
- *API Security in Action* (Neil Madden, Manning 2020) — JWT/JWE/JWS, OAuth, mTLS на практике.
- [Daniel Fett — «OAuth 2.0 Security Cheatsheet»](https://danielfett.de/) — глубокий разбор атак (mix-up, code interception).
