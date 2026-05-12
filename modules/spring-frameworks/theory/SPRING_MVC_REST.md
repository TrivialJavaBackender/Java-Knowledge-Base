# Spring MVC и REST

## Архитектура: DispatcherServlet как Front Controller

Spring MVC построен на классическом паттерне **Front Controller**: все HTTP-запросы проходят через единую точку входа — `DispatcherServlet`. Он не обрабатывает запросы сам, а делегирует их подходящим компонентам.

```
HTTP Request (GET /api/orders/42)
     ↓
Tomcat (Servlet Container) → выбирает DispatcherServlet (он зарегистрирован на /*)
     ↓
DispatcherServlet
     │
     ├─── HandlerMapping → "GET /api/orders/{id}" → OrderController.getOrder(Long)
     │    (RequestMappingHandlerMapping сканирует @RequestMapping аннотации при старте)
     │
     ├─── HandlerAdapter → вызывает метод, разрешая аргументы
     │    (@PathVariable, @RequestBody, @RequestParam, @AuthenticationPrincipal...)
     │
     ├─── HttpMessageConverter → десериализует JSON → Java объект (для @RequestBody)
     │    (по умолчанию: MappingJackson2HttpMessageConverter)
     │
     ├─── [Выполняется метод контроллера]
     │
     ├─── HttpMessageConverter → сериализует Java объект → JSON (для @ResponseBody)
     │
     └─── ResponseEntity с нужным статусом → HTTP Response
```

DispatcherServlet создаётся Spring Boot автоматически через `DispatcherServletAutoConfiguration`. Раньше (до Boot) его надо было регистрировать в `web.xml`.

---

## @RestController и маппинг запросов

`@RestController = @Controller + @ResponseBody`. `@ResponseBody` означает: возвращаемый объект метода — это тело HTTP-ответа, а не имя View (Thymeleaf-шаблона). Spring автоматически сериализует объект в JSON через Jackson.

```java
@RestController
@RequestMapping("/api/orders")  // базовый путь для всего контроллера
public class OrderController {

    // GET /api/orders/42
    @GetMapping("/{id}")
    public ResponseEntity<OrderDto> getOrder(@PathVariable Long id) {
        return orderService.findById(id)
            .map(ResponseEntity::ok)                           // 200 OK с телом
            .orElse(ResponseEntity.notFound().build());        // 404 без тела
    }

    // POST /api/orders → 201 Created
    @PostMapping
    public ResponseEntity<OrderDto> createOrder(
            @RequestBody @Valid CreateOrderRequest request,
            UriComponentsBuilder uriBuilder) {                  // для построения Location header
        OrderDto created = orderService.create(request);
        URI location = uriBuilder
            .path("/api/orders/{id}")
            .buildAndExpand(created.id())
            .toUri();
        return ResponseEntity.created(location).body(created); // 201 + Location: /api/orders/42
    }

    // PUT /api/orders/42 — полная замена ресурса
    @PutMapping("/{id}")
    @ResponseStatus(HttpStatus.OK)  // если не нужен ResponseEntity
    public OrderDto updateOrder(@PathVariable Long id,
                                @RequestBody @Valid UpdateOrderRequest request) {
        return orderService.update(id, request);
    }

    // PATCH /api/orders/42 — частичное обновление
    @PatchMapping("/{id}")
    public OrderDto patchOrder(@PathVariable Long id,
                               @RequestBody Map<String, Object> fields) {
        return orderService.patch(id, fields);
    }

    // DELETE /api/orders/42 → 204 No Content
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteOrder(@PathVariable Long id) {
        orderService.delete(id);
    }

    // GET /api/orders?status=PENDING&page=0&size=20&sort=createdAt,desc
    @GetMapping
    public Page<OrderDto> listOrders(
            @RequestParam(required = false) OrderStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @SortDefault(sort = "createdAt", direction = Sort.Direction.DESC) Pageable pageable) {
        return orderService.findAll(status, pageable);
    }
}
```

### ResponseEntity vs @ResponseStatus

`ResponseEntity<T>` — гибкий: можно установить статус, заголовки, тело программно. Полезен когда статус зависит от результата операции (создан/не найден).

`@ResponseStatus` — декларативный: статус зафиксирован в аннотации. Проще для случаев где статус всегда одинаковый.

---

## HttpMessageConverter: сериализация/десериализация

MessageConverter преобразует между HTTP body (bytes/string) и Java-объектами. Spring выбирает конвертер по `Content-Type` (для входящего запроса) и `Accept` заголовку (для ответа).

По умолчанию в Spring Boot Web:
- `MappingJackson2HttpMessageConverter` — JSON (`application/json`)
- `StringHttpMessageConverter` — plain text (`text/plain`)
- `ByteArrayHttpMessageConverter` — бинарные данные (`application/octet-stream`)

```java
@Configuration
public class JacksonConfig {

    @Bean
    public ObjectMapper objectMapper() {
        return JsonMapper.builder()
            // JavaTimeModule: LocalDateTime, LocalDate → ISO-8601 строки
            .addModule(new JavaTimeModule())
            // Не сериализовать null поля (меньше payload):
            .serializationInclusion(JsonInclude.Include.NON_NULL)
            // LocalDateTime как "2024-01-15T10:30:00" а не timestamp:
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            // Неизвестные поля в JSON не бросают исключение:
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            // snake_case → camelCase автоматически (опционально):
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .build();
    }
}
```

Content Negotiation — выбор формата ответа на основе `Accept` заголовка:

```java
@GetMapping(
    value = "/report",
    produces = {MediaType.APPLICATION_JSON_VALUE, MediaType.APPLICATION_XML_VALUE}
)
public Report getReport() { ... }

// Accept: application/json  → Jackson → JSON
// Accept: application/xml   → Jackson XML → XML (нужна зависимость jackson-dataformat-xml)
// Accept: text/html         → 406 Not Acceptable
```

---

## Обработка ошибок: @RestControllerAdvice

Без централизованной обработки ошибок каждый контроллер сам ловит исключения — дублирование кода. `@RestControllerAdvice` — глобальный обработчик: перехватывает исключения из всех контроллеров.

```java
@RestControllerAdvice  // = @ControllerAdvice + @ResponseBody
public class GlobalExceptionHandler {

    // Обработка конкретного бизнес-исключения
    @ExceptionHandler(OrderNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse handleNotFound(OrderNotFoundException ex) {
        return new ErrorResponse("ORDER_NOT_FOUND", ex.getMessage());
    }

    // Bean Validation ошибки (@Valid)
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ValidationErrorResponse handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> fieldErrors = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors()
            .forEach(err -> fieldErrors.put(err.getField(), err.getDefaultMessage()));

        return new ValidationErrorResponse(
            "VALIDATION_FAILED",
            "Request validation failed",
            fieldErrors
        );
    }

    // Ошибки путевых переменных (неверный тип: /orders/abc вместо /orders/42)
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return new ErrorResponse("INVALID_PARAMETER",
            "Parameter '%s' must be of type %s".formatted(
                ex.getName(), ex.getRequiredType().getSimpleName()));
    }

    // Fallback для неожиданных исключений
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleGeneric(Exception ex, HttpServletRequest request) {
        // Логируй с request URI для удобства диагностики
        log.error("Unhandled exception for {}: {}", request.getRequestURI(), ex.getMessage(), ex);
        return new ErrorResponse("INTERNAL_ERROR", "An unexpected error occurred");
    }
}

public record ErrorResponse(String code, String message) {}

public record ValidationErrorResponse(String code, String message, Map<String, String> fields) {}
```

**Что происходит с исключением без обработки:** Spring возвращает `DefaultErrorAttributes` — стандартный JSON с timestamp, status, error, message, path. Это дефолтное поведение Spring Boot. `@RestControllerAdvice` его переопределяет.

---

## Bean Validation (@Valid)

Стандарт Bean Validation (Jakarta Validation, бывший JSR-303/380) + Hibernate Validator как реализация.

```java
// DTO с валидацией
public record CreateOrderRequest(

    @NotNull(message = "Customer ID is required")
    Long customerId,

    @NotEmpty(message = "Order must have at least one item")
    @Size(max = 100, message = "Order cannot have more than 100 items")
    List<@Valid OrderItemRequest> items,  // @Valid на элементах коллекции!

    @FutureOrPresent(message = "Delivery date cannot be in the past")
    LocalDate deliveryDate,

    @NotBlank
    @Size(max = 500)
    String deliveryAddress
) {}

public record OrderItemRequest(
    @NotNull Long productId,
    @Min(value = 1, message = "Quantity must be at least 1")
    @Max(100)
    int quantity
) {}
```

```java
// Кастомный валидатор
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ValidCurrencyValidator.class)
public @interface ValidCurrency {
    String message() default "Invalid currency code";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

@Component
public class ValidCurrencyValidator implements ConstraintValidator<ValidCurrency, String> {
    private static final Set<String> VALID_CODES = Set.of("USD", "EUR", "GBP", "RUB");

    @Override
    public boolean isValid(String code, ConstraintValidatorContext ctx) {
        return code != null && VALID_CODES.contains(code.toUpperCase());
    }
}

// Использование:
public record PaymentRequest(
    @NotBlank @ValidCurrency String currency,
    @Positive BigDecimal amount
) {}
```

**Validation Groups** — разные правила для создания и обновления:
```java
interface OnCreate {}
interface OnUpdate {}

public class UserRequest {
    @Null(groups = OnCreate.class)   // id не должен быть при создании
    @NotNull(groups = OnUpdate.class) // id обязателен при обновлении
    Long id;

    @NotBlank(groups = {OnCreate.class, OnUpdate.class})
    String email;
}

@PostMapping
public void create(@Validated(OnCreate.class) @RequestBody UserRequest req) { ... }

@PutMapping("/{id}")
public void update(@Validated(OnUpdate.class) @RequestBody UserRequest req) { ... }
```

---

## Фильтры и Interceptors: разница и порядок

```
HTTP Request
     ↓
[Servlet Filters]           ← до Spring MVC
     └─ SecurityFilter
     └─ LoggingFilter
     └─ CorsFilter
     ↓
DispatcherServlet
     ↓
[HandlerInterceptors]       ← внутри Spring MVC
     └─ AuthInterceptor.preHandle
     ↓
[Argument Resolvers]        ← разрешают аргументы метода
     ↓
Controller Method
     ↓
[HandlerInterceptors]
     └─ AuthInterceptor.postHandle
     ↓
Response rendering
     ↓
[HandlerInterceptors]
     └─ AuthInterceptor.afterCompletion
     ↓
[Servlet Filters] (обратном порядке)
```

**Servlet Filter** — работает на уровне Servlet Container. Видит сырой `HttpServletRequest`/`HttpServletResponse`. Может полностью обходить Spring. Используется для: аутентификация (Spring Security), CORS, rate limiting, сжатие.

```java
@Component
@Order(1) // порядок фильтров
public class RequestIdFilter implements Filter {

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        // Добавляем X-Request-ID для трейсинга
        String requestId = Optional.ofNullable(request.getHeader("X-Request-ID"))
            .orElse(UUID.randomUUID().toString());

        MDC.put("requestId", requestId);        // в логи
        response.setHeader("X-Request-ID", requestId); // в ответ

        try {
            chain.doFilter(req, res);            // передать запрос дальше
        } finally {
            MDC.remove("requestId");             // очистить MDC
        }
    }
}
```

**HandlerInterceptor** — работает внутри Spring MVC. Видит обработанные параметры, `ModelAndView`. Используется для: проверка прав на уровне MVC, логирование времени выполнения, модификация модели.

```java
@Component
public class PerformanceInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                              Object handler) {
        request.setAttribute("startTime", System.currentTimeMillis());
        return true; // true = продолжить цепочку, false = прервать (ответ уже записан)
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                 Object handler, Exception ex) {
        long start = (Long) request.getAttribute("startTime");
        long duration = System.currentTimeMillis() - start;

        if (handler instanceof HandlerMethod method) {
            log.info("{}.{} took {}ms",
                method.getBeanType().getSimpleName(),
                method.getMethod().getName(),
                duration);
        }
    }
}

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(performanceInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/public/**", "/actuator/**");
    }
}
```

---

## CORS — Cross-Origin Resource Sharing

Браузер блокирует Ajax-запросы с одного домена на другой (same-origin policy). CORS — механизм, позволяющий серверу явно разрешить cross-origin запросы.

```java
// Глобальная настройка CORS:
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins("https://myapp.com", "https://dev.myapp.com")
            .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
            .allowedHeaders("*")
            .allowCredentials(true)   // разрешить cookies (нужно для session-based auth)
            .maxAge(3600);            // кэшировать preflight на 1 час
    }
}

// На уровне контроллера (переопределяет глобальное):
@CrossOrigin(origins = "https://admin.myapp.com")
@RestController
public class AdminController { ... }

// При использовании Spring Security — CORS надо настраивать через HttpSecurity,
// не через WebMvcConfigurer! Иначе Spring Security перехватит OPTIONS запрос раньше MVC:
http.cors(cors -> cors.configurationSource(corsConfigurationSource()));

@Bean
public CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOrigins(List.of("https://myapp.com"));
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/api/**", config);
    return source;
}
```

---

## Тестирование MVC слоя

`@WebMvcTest` — слайс-тест, загружает только MVC компоненты (контроллеры, фильтры, конвертеры). Не загружает сервисы, репозитории — их нужно мокировать:

```java
@WebMvcTest(OrderController.class)
class OrderControllerTest {

    @Autowired MockMvc mvc;
    @MockBean OrderService orderService;  // мок, т.к. @WebMvcTest не загружает сервисы

    @Test
    void getOrder_found_returns200() throws Exception {
        OrderDto order = new OrderDto(42L, "PENDING", BigDecimal.valueOf(100));
        when(orderService.findById(42L)).thenReturn(Optional.of(order));

        mvc.perform(get("/api/orders/42")
                .accept(MediaType.APPLICATION_JSON))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.id").value(42))
           .andExpect(jsonPath("$.status").value("PENDING"))
           .andExpect(jsonPath("$.amount").value(100));

        verify(orderService).findById(42L);
    }

    @Test
    void getOrder_notFound_returns404() throws Exception {
        when(orderService.findById(99L)).thenReturn(Optional.empty());

        mvc.perform(get("/api/orders/99"))
           .andExpect(status().isNotFound());
    }

    @Test
    void createOrder_invalidBody_returns400() throws Exception {
        String invalidJson = """
            {
                "customerId": null,
                "items": []
            }
            """;

        mvc.perform(post("/api/orders")
                .contentType(MediaType.APPLICATION_JSON)
                .content(invalidJson))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
           .andExpect(jsonPath("$.fields.customerId").exists());
    }
}
```

---

## Источники

**Спецификации / документация:**
- [Spring Framework Reference — Web on Servlet Stack (Spring MVC)](https://docs.spring.io/spring-framework/reference/web/webmvc.html) — `DispatcherServlet`, handler mappings, message converters, exception handling.
- [Jakarta Servlet 6.0 Specification](https://jakarta.ee/specifications/servlet/6.0/) — стандарт, поверх которого работает Spring MVC.
- [Jakarta Bean Validation 3.0](https://jakarta.ee/specifications/bean-validation/3.0/) — `@Valid`, `@NotBlank`, групповая валидация.

**Books:**
- *Spring in Action*, 6th ed. (Craig Walls, Manning 2022) — главы по MVC, REST, validation, exception handling.
- *Spring Microservices with Spring Boot 3 and Spring Cloud*, 3rd ed. (Magnus Larsson, Packt 2023).

**Engineering blogs:**
- [Baeldung — Spring MVC tutorials](https://www.baeldung.com/spring-mvc-tutorial) — большая коллекция how-to'у с edge-cases.
- [Josh Long — «Bootiful» series (Spring blog)](https://spring.io/blog) — guidance от Spring developer advocate.
- [«ResponseEntity vs `@ResponseStatus`» (Baeldung)](https://www.baeldung.com/spring-response-entity)

**Security / battle stories:**
- [CVE-2022-22965 «Spring4Shell»](https://nvd.nist.gov/vuln/detail/CVE-2022-22965) — RCE через `getClass().getProtectionDomain()...` в data binding (Java 9+, Tomcat). [Подробный postmortem (Praetorian)](https://www.praetorian.com/blog/spring-core-jdk9-rce/) описывает цепочку: forms binding → ClassLoader → AccessLogValve → web shell. Это иллюстрация ровно того, почему `disallowedFields` в `WebDataBinder` важен.
- [CVE-2024-22243 — Open Redirect в `UriComponentsBuilder`](https://spring.io/security/cve-2024-22243) — пример того, что user-controlled URI parsing требует whitelisting.
- [OWASP — Top 10 for Web Application Security](https://owasp.org/Top10/) — A03:2021 Injection, A07:2021 Auth Failures и т.д. — практический чек-лист для REST API.
