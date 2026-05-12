# Logging

---

## 1. Структурированное логирование

```
# Plain text (плохо для machine processing):
2024-01-15 14:05:23 ERROR OrderService - Failed to process order 123 for user 456: connection refused

# Структурированный JSON (хорошо):
{
  "timestamp": "2024-01-15T14:05:23.456Z",
  "level": "ERROR",
  "logger": "by.pavel.OrderService",
  "message": "Failed to process order",
  "orderId": "123",
  "userId": "456",
  "error": "connection refused",
  "trace_id": "4bf92f3577b34da6a",
  "app": "infra-learn",
  "env": "production"
}
```

Преимущества JSON:
- Фильтрация без regex: `userId = "456" AND level = "ERROR"`
- Агрегации: `COUNT errors GROUP BY userId`
- Автоматическая индексация в Elasticsearch/Loki
- Не ломается при многострочных stacktrace

---

## 2. Уровни логирования — что куда

| Уровень | Когда использовать | Кто читает |
|---------|-------------------|-----------|
| `ERROR` | Неожиданное исключение, потеря данных, недоступность зависимости | Алерт → on-call |
| `WARN` | Нештатная, но обработанная ситуация (retry успешен, rate limit) | Разработчик, периодически |
| `INFO` | Нормальные бизнес-события (заказ создан, платёж прошёл) | Разработчик, при расследовании |
| `DEBUG` | Детали реализации, промежуточные состояния | Только при разработке |
| `TRACE` | Очень детальная трассировка | Только при отладке конкретной проблемы |

**Правила для ERROR:**
```java
// Правильно — ERROR это неожиданное
try {
    paymentGateway.charge(order);
} catch (PaymentGatewayException e) {
    log.error("Payment failed for orderId={}", order.getId(), e);  // stacktrace!
    throw new PaymentException("Payment failed", e);
}

// Неправильно — это ожидаемая бизнес-ситуация
if (!order.isValid()) {
    log.error("Invalid order");  // WARN или INFO
}
```

---

## 3. MDC — Mapped Diagnostic Context

MDC — это thread-local Map, автоматически добавляемая ко всем строкам лога в текущем потоке.

```java
// Один раз добавил в MDC...
MDC.put("requestId", "abc-123");
MDC.put("userId", "user-456");

// ...и это поле появляется в КАЖДОЙ строке лога без явного указания
log.info("Processing order");        // → {"requestId": "abc-123", "message": "Processing order", ...}
log.debug("Querying database");      // → {"requestId": "abc-123", "message": "Querying database", ...}
orderService.process(order);         // вызовы вглубь стека тоже получают этот контекст

// В конце — обязательно очищать!
MDC.clear();
```

**MDC с async — проблема и решение:**

```java
// ПРОБЛЕМА: MDC не копируется в новый поток автоматически
@Async
public void processOrderAsync(Order order) {
    // MDC пустой! requestId не передался из родительского потока
    log.info("Processing async");
}

// РЕШЕНИЕ: TaskDecorator копирует MDC перед выполнением задачи
@Configuration
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setTaskDecorator(runnable -> {
            Map<String, String> mdcContext = MDC.getCopyOfContextMap();
            return () -> {
                try {
                    if (mdcContext != null) MDC.setContextMap(mdcContext);
                    runnable.run();
                } finally {
                    MDC.clear();   // очищаем после задачи
                }
            };
        });
        executor.initialize();
        return executor;
    }
}
```

---

## 4. Correlation ID — паттерн

```
Client ──► API Gateway ──► Order Service ──► Payment Service
           X-Request-ID:    MDC: requestId   MDC: requestId
           "abc-123"        = "abc-123"      = "abc-123"
                            HTTP header →    в downstream вызовах
```

```java
// OncePerRequestFilter: добавить requestId в MDC на весь запрос
@Component
public class CorrelationFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws IOException, ServletException {
        String requestId = request.getHeader("X-Request-ID");
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }

        MDC.put("requestId", requestId);
        response.setHeader("X-Request-ID", requestId);  // прокидываем в ответ

        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear();   // ОБЯЗАТЕЛЬНО — иначе утечка в thread pool
        }
    }
}
```

Для downstream HTTP вызовов через RestTemplate/WebClient:
```java
// RestTemplate interceptor
restTemplate.getInterceptors().add((request, body, execution) -> {
    String requestId = MDC.get("requestId");
    if (requestId != null) {
        request.getHeaders().add("X-Request-ID", requestId);
    }
    return execution.execute(request, body);
});
```

---

## 5. Logback конфигурация (Spring Boot)

```xml
<!-- src/main/resources/logback-spring.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<configuration>

    <!-- JSON appender для production -->
    <springProfile name="production">
        <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
            <encoder class="net.logstash.logback.encoder.LogstashEncoder">
                <!-- Кастомные поля во всех строках -->
                <customFields>{"app":"infra-learn","env":"production"}</customFields>
                <!-- MDC поля включаются автоматически -->
            </encoder>
        </appender>

        <root level="INFO">
            <appender-ref ref="STDOUT"/>
        </root>
    </springProfile>

    <!-- Обычный текст для разработки -->
    <springProfile name="!production">
        <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
            <encoder>
                <pattern>%d{HH:mm:ss} [%X{requestId}] %-5level %logger{36} - %msg%n</pattern>
            </encoder>
        </appender>

        <root level="DEBUG">
            <appender-ref ref="STDOUT"/>
        </root>
    </springProfile>

</configuration>
```

---

## 6. Loki — логирование в Kubernetes

```
┌─────────────┐  stdout   ┌──────────┐  push    ┌──────┐  query   ┌─────────┐
│  App Pod    │──────────►│ Promtail │─────────►│ Loki │─────────►│ Grafana │
└─────────────┘           └──────────┘           └──────┘  LogQL   └─────────┘
                   читает логи контейнеров
                   через Docker/containerd API
```

```yaml
# promtail-config.yaml — конфиг сбора логов
scrape_configs:
  - job_name: kubernetes-pods
    kubernetes_sd_configs:
      - role: pod
    pipeline_stages:
      - docker: {}              # парсит Docker json log format
      - json:                   # парсит структурированные поля из контента лога
          expressions:
            level: level
            requestId: requestId
      - labels:
          level:                # делает level полем для фильтрации в Loki
          app:
```

LogQL запросы в Grafana:
```
# Все ERROR логи приложения
{app="infra-learn"} |= "ERROR"

# По requestId
{app="infra-learn"} | json | requestId="abc-123"

# Подсчёт ошибок за 5 минут
rate({app="infra-learn"} |= "ERROR" [5m])
```

---

## 7. Антипаттерны

| Антипаттерн | Проблема | Как правильно |
|-------------|----------|---------------|
| Log & throw | Дублирование stacktrace на каждом уровне | Либо log, либо throw |
| `log.error("Error: " + e.getMessage())` | Теряется stacktrace | `log.error("message", e)` — второй аргумент |
| Чувствительные данные в логах | Утечка паролей, token, PII | Маскировать до логирования |
| `log.info("Order: " + order)` | Конкатенация строк даже если DEBUG выключен | `log.info("Order: {}", order)` — lazy evaluation |
| MDC без finally | Утечка в thread pool | Всегда `MDC.clear()` в finally |
| Нет requestId | Невозможно найти все логи одного запроса | Correlation ID через MDC filter |

---

## Вопросы для собеседования

### Q1: Почему структурированные логи лучше plain text?
**A:** Plain text требует regex для парсинга — хрупко и медленно. JSON логи автоматически индексируются: можно фильтровать `userId = "123"` без regex, строить агрегации "сколько ошибок у этого userId за час". В Loki/Elasticsearch индексация по полям даёт быстрый поиск. Структурированные логи — это разница между grep в панике и SQL-запросом к логам.

### Q2: Что такое MDC и почему нужно очищать в finally?
**A:** MDC — thread-local Map, значения из которой добавляются к каждой строке лога. Очищать нужно потому что в production используются thread pool: после обработки запроса поток не умирает, а возвращается в pool. Если не очистить MDC — следующий запрос, попавший на этот поток, унаследует requestId предыдущего запроса. Всегда: `try { MDC.put(...); chain.doFilter(...); } finally { MDC.clear(); }`.

### Q3: Как передать correlation ID в async метод?
**A:** Spring `@Async` выполняется в другом потоке — MDC не передаётся автоматически. Решение: `TaskDecorator` в `ThreadPoolTaskExecutor`. Decorator перед выполнением задачи копирует `MDC.getCopyOfContextMap()` из родительского потока и устанавливает в рабочем: `MDC.setContextMap(mdcContext)`. В finally очищает. Это позволяет async методам иметь тот же requestId, что и исходный HTTP запрос.

### Q4: Что такое антипаттерн "log and throw"?
**A:** `catch (Exception e) { log.error("Error", e); throw e; }` — на каждом уровне вызовов логируется один и тот же stacktrace. В итоге один запрос порождает 5-10 одинаковых строк ERROR в логах. Правильно: либо поймать и обработать (log + handle), либо пробросить без логирования (throw). Логировать один раз — там где exception обрабатывается окончательно (верхний exception handler / @ControllerAdvice).

### Q5: Как настроить разные уровни логирования для prod и dev?
**A:** В `logback-spring.xml` использовать `<springProfile name="production">` и `<springProfile name="!production">`. В prod — INFO уровень и JSON encoder. В dev — DEBUG уровень и человекочитаемый pattern. Также можно динамически менять уровень в runtime через Spring Actuator: `POST /actuator/loggers/by.pavel.OrderService` с body `{"configuredLevel": "DEBUG"}` — не требует рестарта.

### Q6: Как работает Loki в отличие от ELK?
**A:** ELK (Elasticsearch) полностью индексирует все поля логов — быстрый поиск по любому полю, но дорого по памяти и диску. Loki индексирует только labels (небольшой набор полей: app, env, namespace) и хранит содержимое сжатым без индексации. Запросы по содержимому делаются через grep по compressed chunks — медленнее ELK, но в 10x дешевле. Для большинства use cases скорости Loki достаточно.

### Q7: Что нельзя логировать?
**A:** PII (персональные данные): имена, email, телефоны — нарушение GDPR. Credentials: пароли, токены, API keys. Данные платёжных карт (PCI DSS). Медицинские данные. Полные тела HTTP запросов без фильтрации — могут содержать всё перечисленное. Правило: логировать идентификаторы (userId, orderId), а не значения (email, cardNumber). При необходимости — маскировать: `"****1234"`.

### Q8: Что такое async appender и зачем он нужен?
**A:** По умолчанию Logback пишет синхронно — поток приложения блокируется пока лог запись не записана. Async appender (`AsyncAppender`) ставит запись в очередь и отдаёт управление обратно немедленно. Отдельный поток пишет из очереди в реальный appender. Ускоряет запись логов, особенно при медленных appender (файл, сеть). В production обязательно для высоконагруженных приложений. Риск: при переполнении очереди записи могут теряться.

---

## Источники

**Стандарты / официальная документация:**
- [The Twelve-Factor App — XI. Logs](https://12factor.net/logs) — каноническое «приложение пишет в stdout, инфраструктура агрегирует» — основа всего современного логирования.
- [SLF4J Manual](https://www.slf4j.org/manual.html) и [Logback Documentation](https://logback.qos.ch/documentation.html) — фасад и реализация.
- [OpenTelemetry Logs Specification](https://opentelemetry.io/docs/specs/otel/logs/) — будущий стандарт корреляции logs/metrics/traces.

**Books:**
- *Logging in Action* (Phil Wilkins, Manning 2022) — современный гайд по structured logging, MDC, аггрегации.

**Engineering blogs / specs:**
- [«Best practices for logging in Java» (Baeldung)](https://www.baeldung.com/java-logging-best-practices) — argument matchers, lazy evaluation, exception handling.
- [Brett Slatkin — «Effective Python: logging» principles](https://effectivepython.com/) — переносимы на Java.
- [Grafana Loki — Best Practices](https://grafana.com/docs/loki/latest/best-practices/) — labels vs message body, кардинальность.
- [Elastic — «Common patterns in observability data»](https://www.elastic.co/observability) — ECS (Elastic Common Schema) — стандартизированные имена полей в JSON-логах.

**Battle stories:**
- [Cloudflare «Cloudbleed» (2017)](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/) — утечка приватных данных (cookies, tokens) через логи и кэши, проиндексированные поисковиками. Иллюстрация почему PII/credentials в логи попадать не должны никогда.
- [Equifax 2017 breach (US House report)](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf) — отсутствие логирования и мониторинга позволило атаке длиться 76 дней незамеченной. Иллюстрация что «нет логов» не безопаснее «есть логи».
