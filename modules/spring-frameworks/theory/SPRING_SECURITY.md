# Spring Security

> **JWT структура, OAuth2 потоки, OpenID Connect** — см. [`modules/system-design/theory/auth_security.md`](../../system-design/theory/auth_security.md).

---

## Ключевые концепции: Authentication vs Authorization

Прежде чем разбирать внутренности — важно понять две принципиально разные вещи:

- **Authentication (аутентификация)** — "Кто ты?" Проверка identity: пользователь предъявляет credentials (пароль, токен, сертификат), система проверяет их подлинность.
- **Authorization (авторизация)** — "Что тебе можно?" После установления identity — проверка прав: может ли пользователь выполнить запрашиваемое действие.

Spring Security обрабатывает оба аспекта, и важно понимать где заканчивается одно и начинается другое.

---

## Архитектура: Filter Chain

Spring Security интегрируется в Servlet контейнер через стандартный механизм Java Servlet Filters — до того как запрос попадёт в Spring MVC (DispatcherServlet).

```
HTTP Request
     ↓
Servlet Container (Tomcat)
     ↓
DelegatingFilterProxy  ← обычный Servlet Filter, мост между Servlet и Spring
     ↓                    делегирует обработку в Spring бин FilterChainProxy
FilterChainProxy       ← главный координатор, выбирает SecurityFilterChain по URL
     ↓
SecurityFilterChain    ← цепочка фильтров (их порядок важен!)
  │
  ├─ DisableEncodeUrlFilter          (убирает JSESSIONID из URL)
  ├─ SecurityContextPersistenceFilter (загружает SecurityContext из сессии или создаёт пустой)
  ├─ HeaderWriterFilter              (добавляет security headers: X-Frame-Options, HSTS, ...)
  ├─ CsrfFilter                      (проверяет CSRF токен при POST/PUT/DELETE)
  ├─ LogoutFilter                    (обрабатывает /logout)
  ├─ UsernamePasswordAuthenticationFilter (form login: POST /login с username/password)
  ├─ BearerTokenAuthenticationFilter (JWT: Authorization: Bearer <token>)
  ├─ BasicAuthenticationFilter       (HTTP Basic: Authorization: Basic base64(user:pass))
  ├─ RequestCacheAwareFilter
  ├─ SecurityContextHolderAwareRequestFilter
  ├─ AnonymousAuthenticationFilter   (если никто не аутентифицировал — ставит Anonymous)
  ├─ ExceptionTranslationFilter      (перехватывает AuthenticationException → 401,
  │                                   AccessDeniedException → 403)
  └─ AuthorizationFilter             (проверяет права доступа к URL)
     ↓
DispatcherServlet → Controller
```

Каждый фильтр может:
- Пропустить запрос дальше (`chain.doFilter(request, response)`)
- Прервать цепочку (записать ответ напрямую — 401/403)
- Изменить SecurityContext (добавить Authentication после успешной проверки)

`DelegatingFilterProxy` — хитрый паттерн: Servlet Container создаёт его при старте (ещё до Spring Context), но он ленив — делегирует в `FilterChainProxy` из Spring Context только при первом запросе. Это позволяет Spring Security внедрять зависимости в фильтры как обычные Spring бины.

---

## Процесс аутентификации изнутри

Рассмотрим как именно Spring Security проверяет username/password:

```
1. Запрос: POST /login { username: "alice", password: "secret" }

2. UsernamePasswordAuthenticationFilter:
   - читает username и password из запроса
   - создаёт UsernamePasswordAuthenticationToken (authenticated=false)
   - передаёт в AuthenticationManager

3. AuthenticationManager (обычно ProviderManager):
   - перебирает список AuthenticationProvider
   - находит DaoAuthenticationProvider (подходит для username/password)

4. DaoAuthenticationProvider:
   - вызывает UserDetailsService.loadUserByUsername("alice")
   - сравнивает пароль через PasswordEncoder.matches("secret", storedHash)
   - если OK → создаёт UsernamePasswordAuthenticationToken (authenticated=true)

5. Успешная аутентификация:
   - Authentication сохраняется в SecurityContext
   - SecurityContext сохраняется в HTTP сессии (для stateful)
   - вызывается AuthenticationSuccessHandler
```

Для JWT это другой путь:
```
1. Запрос: GET /api/orders  Authorization: Bearer eyJhbGc...

2. BearerTokenAuthenticationFilter:
   - извлекает токен из заголовка
   - создаёт BearerTokenAuthenticationToken (authenticated=false)
   - передаёт в AuthenticationManager

3. JwtAuthenticationProvider:
   - вызывает JwtDecoder.decode(token)
   - проверяет подпись, exp, iss, aud claims
   - если OK → создаёт JwtAuthenticationToken (authenticated=true)

4. JwtGrantedAuthoritiesConverter:
   - извлекает роли из JWT claims (scope или roles)
   - преобразует в GrantedAuthority
```

---

## SecurityContext и SecurityContextHolder

`SecurityContext` — контейнер для объекта `Authentication` (кто аутентифицирован). `SecurityContextHolder` — хранилище текущего SecurityContext.

По умолчанию `SecurityContextHolder` хранит в **ThreadLocal** — это значит, что SecurityContext привязан к конкретному потоку выполнения. Для обычных синхронных запросов (один поток = один запрос) это прекрасно работает.

```java
// Получить текущего пользователя из любого места кода:
Authentication auth = SecurityContextHolder.getContext().getAuthentication();

// Объект Authentication содержит:
auth.getName();           // username или subject из JWT
auth.getPrincipal();      // UserDetails или Jwt объект
auth.getAuthorities();    // Set<GrantedAuthority> — роли и права
auth.isAuthenticated();   // true если прошёл аутентификацию

// В контроллере — удобные аннотации:
@GetMapping("/profile")
public UserDto getProfile(@AuthenticationPrincipal UserDetails user) {
    return userService.getProfile(user.getUsername());
}

@GetMapping("/profile")
public UserDto getProfile(@AuthenticationPrincipal Jwt jwt) {
    // Для JWT-аутентификации principal = Jwt объект
    String userId = jwt.getClaimAsString("sub");
    return userService.getProfile(userId);
}
```

### Проблема с @Async и виртуальными потоками

ThreadLocal не передаётся автоматически в новый поток. Если вызвать `@Async` метод, новый поток не будет иметь SecurityContext:

```java
@Service
public class NotificationService {
    @Async // выполняется в другом потоке из пула
    public void sendNotification(String userId) {
        // SecurityContextHolder.getContext().getAuthentication() == null!
        // Нельзя узнать кто вызвал этот метод
    }
}
```

Решение — `DelegatingSecurityContextExecutor`:

```java
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {
    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.initialize();
        // Оборачивает executor: копирует SecurityContext в каждую задачу
        return new DelegatingSecurityContextAsyncTaskExecutor(executor);
    }
}
```

---

## Конфигурация SecurityFilterChain (Spring Security 6+)

```java
@Configuration
@EnableWebSecurity  // включает Spring Security (в Boot часто не нужна — есть AutoConfiguration)
@EnableMethodSecurity  // включает @PreAuthorize, @PostAuthorize
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            // CSRF отключаем для stateless REST API.
            // Для form-based Web (SSR) — оставить включённым!
            .csrf(AbstractHttpConfigurer::disable)

            // STATELESS — Spring Security не создаёт HTTP-сессию.
            // Важно для REST API: каждый запрос должен нести аутентификацию сам по себе.
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))

            // Правила авторизации — порядок важен! Первое совпавшее правило побеждает.
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()       // без аутентификации
                .requestMatchers("/actuator/health").permitAll()      // health probe
                .requestMatchers("/api/admin/**").hasRole("ADMIN")    // только ADMIN
                .requestMatchers(HttpMethod.GET, "/api/products").hasAnyRole("USER", "ADMIN")
                .anyRequest().authenticated()                         // остальное — любой авторизованный
            )

            // Настройка JWT (Resource Server mode):
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .decoder(jwtDecoder())
                    .jwtAuthenticationConverter(jwtAuthConverter()) // как маппить claims в роли
                )
            )

            // Кастомные обработчики ошибок:
            .exceptionHandling(ex -> ex
                // 401 Unauthorized — не аутентифицирован
                .authenticationEntryPoint((req, res, e) ->
                    res.sendError(HttpServletResponse.SC_UNAUTHORIZED, e.getMessage()))
                // 403 Forbidden — аутентифицирован, но нет прав
                .accessDeniedHandler((req, res, e) ->
                    res.sendError(HttpServletResponse.SC_FORBIDDEN))
            )
            .build();
    }

    @Bean
    public JwtDecoder jwtDecoder() {
        // Симметричный ключ (HMAC-SHA256) — для монолита или когда issuer = resource server
        SecretKey key = new SecretKeySpec("my-secret-key-32-bytes-minimum!!".getBytes(), "HmacSHA256");
        return NimbusJwtDecoder.withSecretKey(key).build();

        // Асимметричный ключ (RSA) — resource server знает только public key,
        // Authorization Server хранит private key (подписывает токены)
        // return NimbusJwtDecoder.withPublicKey(rsaPublicKey).build();

        // JWKS URI — Authorization Server публикует public keys по URL,
        // resource server автоматически обновляет ключи при ротации
        // return NimbusJwtDecoder.withJwkSetUri("https://auth.example.com/.well-known/jwks.json").build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthConverter() {
        JwtGrantedAuthoritiesConverter grantedAuthoritiesConverter = new JwtGrantedAuthoritiesConverter();
        // По умолчанию Spring ищет authorities в claim "scope" с префиксом "SCOPE_"
        // Если роли в другом claim:
        grantedAuthoritiesConverter.setAuthoritiesClaimName("roles");
        grantedAuthoritiesConverter.setAuthorityPrefix("ROLE_");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(grantedAuthoritiesConverter);
        return converter;
    }
}
```

### Несколько SecurityFilterChain

Когда одно приложение обслуживает и API, и UI:

```java
@Bean
@Order(1)  // более высокий приоритет
public SecurityFilterChain apiChain(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")  // применяется только к /api/**
        .csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
        .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
        .build();
}

@Bean
@Order(2)  // обрабатывает всё остальное
public SecurityFilterChain webChain(HttpSecurity http) throws Exception {
    return http
        .formLogin(Customizer.withDefaults())  // форма логина
        .sessionManagement(s -> s.sessionCreationPolicy(IF_REQUIRED)) // сессии для UI
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/login", "/css/**").permitAll()
            .anyRequest().authenticated()
        )
        .build();
}
```

---

## Roles и Authorities: важное различие

Spring Security использует `GrantedAuthority` — строка, представляющая право.

**Authority** — конкретное право: `"ORDER_WRITE"`, `"USER_READ"`, `"REPORT_EXPORT"`.

**Role** — тоже GrantedAuthority, но с префиксом `"ROLE_"`: `"ROLE_ADMIN"`, `"ROLE_USER"`.

```java
// hasRole("ADMIN") → проверяет GrantedAuthority "ROLE_ADMIN"
// hasAuthority("ROLE_ADMIN") → то же самое, явно
// hasAuthority("ORDER_WRITE") → проверяет конкретное право без префикса

.requestMatchers("/admin/**").hasRole("ADMIN")           // ROLE_ADMIN
.requestMatchers("/orders").hasAuthority("ORDER_WRITE")  // точно "ORDER_WRITE"
```

---

## UserDetailsService — загрузка пользователя из БД

Используется при form login или HTTP Basic аутентификации. При JWT — как правило не нужен (данные пользователя в самом токене).

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository userRepo;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        // username может быть email, телефон, login — зависит от приложения
        User user = userRepo.findByEmail(username)
            .orElseThrow(() -> new UsernameNotFoundException("User not found: " + username));

        // Не раскрывай в сообщении, существует ли пользователь!
        // UsernameNotFoundException → Spring Security вернёт 401, не 404

        return UserDetails.builder()
            .username(user.getEmail())
            .password(user.getPasswordHash()) // уже захэшированный BCrypt
            .authorities(buildAuthorities(user))
            .accountLocked(user.isLocked())
            .accountExpired(!user.isActive())
            .credentialsExpired(user.isPasswordExpired())
            .disabled(!user.isEnabled())
            .build();
    }

    private Collection<? extends GrantedAuthority> buildAuthorities(User user) {
        return user.getRoles().stream()
            .flatMap(role -> role.getPermissions().stream()
                .map(perm -> new SimpleGrantedAuthority(perm.getName())))
            .collect(Collectors.toSet());
    }
}
```

---

## Method Security: @PreAuthorize и SpEL

`@EnableMethodSecurity` включает проверку прав на уровне отдельных методов через AOP.

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    // Простая проверка роли
    @GetMapping
    @PreAuthorize("hasRole('USER')")
    public List<Order> getAllOrders() { ... }

    // SpEL: параметр метода в выражении через #name
    // Пользователь может видеть только свои заказы
    @GetMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN') or @orderSecurityService.isOwner(#id, authentication)")
    public Order getOrder(@PathVariable Long id) { ... }

    // @PostAuthorize — проверка ПОСЛЕ выполнения метода
    // Метод выполнится, но результат вернётся только если условие выполнено
    // returnObject — специальная переменная для возвращаемого значения
    @GetMapping("/{id}")
    @PostAuthorize("returnObject.customerId == authentication.principal.id")
    public Order getOrder(@PathVariable Long id) { ... }

    // @PreFilter — фильтрует входную коллекцию до выполнения метода
    @PostMapping("/bulk")
    @PreFilter("filterObject.customerId == authentication.principal.id")
    public void bulkUpdate(List<Order> orders) { ... }

    // @PostFilter — фильтрует результирующую коллекцию
    @GetMapping
    @PostFilter("filterObject.customerId == authentication.principal.id")
    public List<Order> getOrders() { ... } // вернёт только заказы текущего пользователя
}

// SpEL встроенные переменные:
// authentication — текущий Authentication объект
// principal — authentication.getPrincipal() (UserDetails или Jwt)
// #paramName — параметр метода по имени
// returnObject — возвращаемое значение (@PostAuthorize, @PostFilter)
// filterObject — элемент коллекции (@PreFilter, @PostFilter)
```

```java
// Кастомный security service для сложной логики (лучше, чем громоздкий SpEL):
@Service("orderSecurityService")
public class OrderSecurityService {
    private final OrderRepository orderRepo;

    public boolean isOwner(Long orderId, Authentication auth) {
        return orderRepo.findById(orderId)
            .map(order -> order.getCustomerId().equals(getUserId(auth)))
            .orElse(false);
    }
}
```

---

## Password Encoding

**Никогда не хранить пароли в открытом виде.** Даже MD5/SHA — небезопасно (rainbow tables, GPU-атаки).

BCrypt специально спроектирован для хэширования паролей:
- Медленный по дизайну: cost factor = количество раундов = 2^cost итераций
- Встраивает соль в хэш (нет rainbow tables)
- Одинаковое время проверки для любого пароля (защита от timing attack)
- При увеличении cost старые хэши продолжают работать (DelegatingPasswordEncoder)

```java
@Bean
public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12); // 2^12 = 4096 итераций
    // cost 10 → ~100ms, cost 12 → ~400ms (достаточно медленно для атаки, приемлемо для UX)
}

// Хэширование при регистрации:
String rawPassword = "mySecretPassword123";
String hash = encoder.encode(rawPassword);
// hash = "$2a$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
// Структура BCrypt хэша: $2a$12$<22 chars соль><31 chars хэш>

// Проверка при логине:
boolean valid = encoder.matches(rawPassword, hash); // всегда O(1) по времени
```

Для поддержки нескольких алгоритмов (при миграции):
```java
return PasswordEncoderFactories.createDelegatingPasswordEncoder();
// Хэши с префиксом: {bcrypt}$2a$..., {pbkdf2}..., {scrypt}...
// Проверяет по префиксу, хэширует в bcrypt
```

---

## CSRF — понять чтобы правильно отключать

**CSRF-атака:** пользователь залогинен на bank.com. Злоумышленник заставляет браузер жертвы отправить запрос на bank.com/transfer. Браузер автоматически добавляет cookie сессии → банк думает что это легитимный запрос.

**Почему CSRF не нужен для REST API с JWT:**
- JWT передаётся в `Authorization: Bearer` заголовке
- Браузер **не добавляет** кастомные заголовки автоматически на cross-site запросах (только cookie и несколько стандартных)
- Злоумышленник не может прочитать Authorization заголовок из JavaScript другого домена (CORS)
- Значит, клиент должен явно добавить заголовок → атака невозможна

**Когда CSRF нужен:**
- Web-приложения с form submit и cookie-based сессиями
- Пользователь залогинен через форму, сессия в cookie

```java
// Правильная конфигурация для REST API:
.csrf(AbstractHttpConfigurer::disable)     // OK, если JWT в Authorization header

// Для Web UI с формами — оставить включённым (Spring добавит токен в формы):
// .csrf(Customizer.withDefaults())         // Default behaviour
```

---

## Тестирование Security

```java
@SpringBootTest
@AutoConfigureMockMvc
class OrderControllerSecurityTest {

    @Autowired MockMvc mvc;

    @Test
    void withoutAuth_returns401() throws Exception {
        mvc.perform(get("/api/orders"))
           .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(username = "alice@example.com", roles = "USER")
    void withUserRole_returns200() throws Exception {
        mvc.perform(get("/api/orders"))
           .andExpect(status().isOk());
    }

    @Test
    @WithMockUser(roles = "USER")
    void deleteWithUserRole_returns403() throws Exception {
        mvc.perform(delete("/api/admin/orders/1"))
           .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void deleteWithAdminRole_returns204() throws Exception {
        mvc.perform(delete("/api/admin/orders/1"))
           .andExpect(status().isNoContent());
    }

    // Для JWT тестирования:
    @Test
    void withJwtToken_returns200() throws Exception {
        mvc.perform(get("/api/orders")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_USER"))))
           .andExpect(status().isOk());
    }
}
```

---

## OWASP Top 10 и Spring Security

| Уязвимость | Суть | Защита в Spring |
|-----------|------|----------------|
| **SQL Injection** | Пользовательский ввод попадает в SQL как код | JPA/Spring Data — параметризованные запросы (PreparedStatement) |
| **XSS** | JS инъекция в HTML, выполняется в браузере жертвы | Thymeleaf экранирует по умолчанию; для REST — Content-Security-Policy |
| **Broken Auth** | Слабые пароли, отсутствие rate limiting | BCrypt; Spring Security rate limiting через фильтры |
| **CSRF** | Злоумышленник использует cookie пользователя | CSRF token (для form); SameSite cookie |
| **Security Misconfiguration** | Открытые actuator, дефолтные пароли | Настроить management.endpoints; отключить /h2-console в prod |
| **IDOR** | Пользователь A читает/меняет данные пользователя B | `@PreAuthorize("#id == authentication.principal.id")` |
| **Sensitive Data** | Пароли в логах, незашифрованные данные | `@JsonIgnore` на passwordHash; HTTPS; зашифрованные properties |
| **Broken Access Control** | URL-манипуляция обходит проверку прав | Spring Security URL patterns + Method Security |

---

## Источники

**Официальная документация:**
- [Spring Security Reference (current)](https://docs.spring.io/spring-security/reference/index.html) — Filter Chain architecture, OAuth2 Resource Server, Method Security, CSRF, CORS.
- [Spring Security — Architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html) — то самое каноническое описание `FilterChainProxy`/`SecurityFilterChain`/`AuthenticationManager`.
- [Spring Security 6 Migration Guide](https://docs.spring.io/spring-security/reference/migration/index.html) — переход от `WebSecurityConfigurerAdapter` к компонентному стилю.

**Books:**
- *Spring Security in Action*, 2nd ed. (Laurențiu Spilca, Manning 2024) — самая актуальная книга, обновлена под Spring Security 6.
- *OAuth 2 in Action* (Justin Richer, Antonio Sanso, Manning 2017) — фундамент OAuth/OIDC, на котором построен `oauth2ResourceServer`.

**Security guidance:**
- [OWASP Top 10 (2021)](https://owasp.org/Top10/) — особенно A01 Broken Access Control, A02 Cryptographic Failures, A07 Auth Failures.
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — параметры BCrypt/Argon2id.
- [Provos & Mazières (1999) — «A Future-Adaptive Password Scheme» (USENIX)](https://www.usenix.org/legacy/events/usenix99/provos/provos_html/) — оригинал bcrypt.

**Real-world incidents (зачем именно такое хеширование и storage):**
- [LinkedIn 2012 — 167M password hashes leaked (unsalted SHA-1)](https://www.troyhunt.com/observations-and-thoughts-on-the-linkedin-data-breach/) — каноническая иллюстрация почему BCrypt/Argon2 + соль обязательны.
- [Capital One 2019 SSRF breach (postmortem)](https://krebsonsecurity.com/2019/07/capital-one-data-theft-impacts-106m-people/) — SSRF через misconfigured WAF + over-privileged IAM role; пример того, как auth/authz failure может стоить $190M штрафов.
- [CVE-2022-22978 — Spring Security RegexRequestMatcher authorization bypass](https://nvd.nist.gov/vuln/detail/CVE-2022-22978) — regex с `.` в URL pattern мог пропустить символ `\n`, обходя auth-rule. Иллюстрация почему URL-pattern-based access control хрупок и Method Security `@PreAuthorize` надёжнее.

**Spring Security CVE feed:**
- [Spring Security Security Releases](https://spring.io/security/) — все CVE с патчами и mitigation.
