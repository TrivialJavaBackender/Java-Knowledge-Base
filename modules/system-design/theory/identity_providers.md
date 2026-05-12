# Identity Providers, OAuth2, SAML 2.0

## Фундаментальная разница: аутентификация vs авторизация

**Аутентификация** — "кто ты?" (identity). Ты — Pavel, пользователь с email pavel@example.com.

**Авторизация** — "что тебе разрешено?" (permissions). Ты можешь читать /calendar, но не /admin.

Главная ошибка: OAuth2 — это **авторизация**, а не аутентификация. OAuth2 отвечает на вопрос "какие действия разрешены приложению X от имени пользователя Y". Он не говорит, кто этот пользователь. OIDC добавляет идентификацию поверх OAuth2.

---

## OAuth2 — зачем он вообще появился

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

### Роли в OAuth2

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

PKCE (Proof Key for Code Exchange) решает дополнительную проблему: что если кто-то перехватил code? Без PKCE его можно обменять на токен. С PKCE обмен code на токен требует знания `code_verifier` — случайной строки, которая была сгенерирована при начале flow и известна только оригинальному клиенту.

```
1. Клиент генерирует: code_verifier = random_string()
                      code_challenge = BASE64URL(SHA256(code_verifier))

2. Редирект на AS: /authorize?code_challenge=XYZ&code_challenge_method=S256
   Пользователь логинится и нажимает "Разрешить"

3. AS редиректит обратно: /callback?code=AUTH_CODE (одноразовый, 10 минут)

4. Backend обменивает:
   POST /token { code: AUTH_CODE, code_verifier: original }
   AS проверяет: SHA256(code_verifier) == code_challenge?  → выдаёт токены

5. Перехватчик code_AUTH_CODE без code_verifier → ничего не получит
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

### Почему Implicit Flow устарел

Раньше для SPA использовался Implicit: токен возвращался прямо в redirect URI fragment (`#access_token=...`). Проблема — токен в URL, в History браузера, может утечь через Referer header. С PKCE Authorization Code flow безопасен для SPA без backend — Implicit больше не нужен.

---

## OIDC — идентификация поверх OAuth2

OAuth2 не говорит кто пользователь — только что ему разрешено. OIDC добавляет один токен — `id_token` (всегда JWT), который содержит информацию о пользователе.

```
OAuth2 scope=openid → получаем id_token + access_token

id_token (JWT):
{
  "sub": "user-123",           // стабильный идентификатор пользователя
  "iss": "https://as.example.com",
  "aud": "my-client-id",       // для кого выдан
  "exp": 1700000000,
  "iat": 1699999000,
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
    ...
  }
```

Spring Security использует `issuer-uri` в конфиге и сам загружает всё через discovery.

---

## JWT — самодостаточный токен

JWT (access_token или id_token) позволяет Resource Server проверить токен **локально**, без вызова Authorization Server:

```
Resource Server получает: Bearer eyJhbGc...

1. Декодировать header: { "alg": "RS256", "kid": "key-id-1" }
2. Получить публичный ключ AS: GET /jwks.json → публичные ключи (кешируются)
3. Проверить подпись RSA — математически, без обращения к AS
4. Проверить exp, iss, aud
5. Готово — токен валиден
```

Плюс — нет latency на вызов AS при каждом запросе. Минус — невозможно отозвать до exp. Поэтому access_token живёт 5–15 минут, а refresh_token с долгим TTL хранится на сервере и может быть отозван.

**Token introspection** — альтернатива для opaque (непрозрачных) токенов: Resource Server спрашивает AS `POST /introspect?token=XXX` → AS отвечает `{active: true, sub: ..., scope: ...}`. Работает и для отозванных токенов, но добавляет latency.

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
    "roles": ["offline_access", "user", "admin"]  ← realm roles
  },
  "resource_access": {
    "my-backend-client": {
      "roles": ["reports:read"]  ← client roles
    }
  }
}
```

```java
// Spring: нужно указать откуда брать roles из Keycloak JWT
converter.setAuthoritiesClaimName("realm_access.roles");
// иначе Spring ищет стандартный claim "scope", где ролей нет
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

---

## Источники

**OAuth / OIDC:**
- [RFC 6749 — The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7636 — PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [RFC 7662 — Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html), [Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [OAuth 2.0 Security Best Current Practice (draft-ietf-oauth-security-topics)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics) — текущее «как делать правильно» от IETF.

**SAML 2.0:**
- [SAML 2.0 OASIS Standard — Core](http://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf)
- [SAML 2.0 Bindings (HTTP-Redirect, HTTP-POST)](http://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf)

**Документация продуктов:**
- [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/) — realms, clients, identity brokering, user federation.
- [Auth0 — OAuth 2.0 / OIDC concepts](https://auth0.com/docs/authenticate/protocols/oauth) — образцовое объяснение flow с диаграммами.

**Книги / posts:**
- *OAuth 2 in Action* (Justin Richer, Antonio Sanso, Manning 2017) — авторы — Working Group участники.
- [Daniel Fett — «OAuth 2.0 Security Cheatsheet»](https://danielfett.de/) — глубокий разбор атак (mix-up, code interception).
