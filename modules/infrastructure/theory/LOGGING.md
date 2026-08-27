# Журналирование: как найти один запрос среди трёх миллионов строк

> **Какую проблему решает.** Пользователь пишет: «заказ не создался в 04:12». У Orders API три
> экземпляра, каждый пишет в stdout, за ночь набежало несколько миллионов строк. Вопрос не в том,
> есть ли нужная запись, — она есть. Вопрос в том, как её достать и как понять, что происходило
> вокруг неё. Журналирование про это: не «писать логи», а «уметь их потом читать машиной».
> **Кому это надо.** Тому, кто дежурит и расследует инциденты; тому, кто пишет `log.info` и должен
> решить, что туда класть; и тому, кого спросят «зачем структурированный журнал, если grep
> работает».
> **Когда НЕ надо.** Журнал — самый дорогой из трёх столпов наблюдаемости: он хранит каждое
> событие целиком. Отвечать по нему на вопрос «сколько запросов в секунду» — значит платить за
> хранение того, что метрика даёт за копейки ([`METRICS.md`](METRICS.md)). Журнал также не
> заменяет трассировку: он говорит, что произошло в одном сервисе, но не показывает, где ушло
> время в цепочке ([`OBSERVABILITY.md`](OBSERVABILITY.md) §5). И это не хранилище персональных
> данных — что туда класть нельзя, разбирается в §9.

Сквозной пример модуля: Orders API — три экземпляра, 200 запросов в секунду. В этом файле он
существует как источник журнала: как связать три экземпляра одним идентификатором запроса, что
происходит с контекстом при уходе в пул потоков и почему `log.info` в горячем пути стоит дороже,
чем кажется.

## 1. Зачем нужны логи и откуда они пришли

Логи — это **записи о произошедших событиях**. Без них разбор инцидента распределённой системы превращается в гадание: вчера в 14:05 у пользователя что-то отвалилось — что именно? Логи это рассказывают, если правильно собраны.

История логирования в Unix-мире:

- **syslog** (1980, Eric Allman, sendmail) — первая стандартная система логов. Программа пишет через syslog(3) → systemd-journald или /var/log/messages. До сих пор работает.
- **log4j** (1999, Ceki Gülcü) — Java логгер с конфигурируемыми levels, appenders, layouts. Породил идиому «log frameworks», скопированную везде.
- **SLF4J** (2005, Gülcü ещё раз) — **фасад** над log frameworks. Java-приложения зависят от SLF4J API, реальная реализация (Logback, log4j, JUL) выбирается на старте. Аналог JDBC для баз.
- **Structured logging** (~2014, with рост Splunk/ELK) — формат JSON, а не free text. Машины могут парсить.
- **OpenTelemetry Logs** (2022+) — попытка унифицировать журналы с metrics/traces под одним SDK.

В Java production-стек: SLF4J API + Logback (или Log4j2) как implementation + JSON encoder (Logstash или ECS) + центральный aggregator (ELK / Loki / Splunk / Datadog).

### 1.1. Twelve-Factor App XI: писать в stdout

12 Factor App (Heroku, 2011) сформулировал принцип:

> A twelve-factor app never concerns itself with routing or storage of its output stream. It should not attempt to write to or manage logfiles. Instead, each running process writes its event stream, unbuffered, to stdout.

Почему это критически важно:

- **Контейнеры**: в Docker/Kubernetes stdout автоматически собирается средой выполнения (containerd ловит каждую строку, пишет в `/var/log/containers/`).
- **Ротация**: запись в файл требует logrotate, mount external storage, размер контейнера растёт. stdout — без ротации, log shipper читает поток.
- **Multiple instances**: пишите в файл — каждый под в свой файл, нужна aggregation. stdout — kubelet это знает, в одну кучу к журнальному агенту доставки.
- **Failures**: файл может закончиться место на диске → приложение виснет. stdout — drop при backpressure, приложение продолжает.

**Анти-pattern, который до сих пор живёт**: приложения, пишущие в `/var/log/myapp/app.log`. В Kubernetes это означает либо emptyDir (потерять при restart), либо PVC (overhead, complexity). Правильно — stdout.

---

## 2. Структурированное логирование

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
- **Фильтрация без regex**: `userId = "456" AND level = "ERROR"` в Kibana/Grafana, не через grep.
- **Агрегации**: «сколько ошибок у этого `userId` за час?» — `COUNT(*) WHERE userId = "456" AND level = "ERROR"` за 5 мс.
- **Автоматическая индексация** в Elasticsearch/Loki/Splunk — поля становятся searchable.
- **Не ломается на multiline**: stacktrace в plain text-логах часто парсится как несколько отдельных записей. В JSON — одно поле `stacktrace` со строкой.

### 2.1. Событие против состояния

Есть две школы того, что логировать:

**State-oriented** (плохо): «процесс работает», «получили запрос», «выполнили запрос». Логи описывают что приложение **делает** в текущий момент. Получается много шума на нормальной работе и ничего не понятно при инциденте.

**Event-oriented** (хорошо): «order created», «payment confirmed», «db query timed out». Логи — это **бизнес-события**, не technical noise. На каждое событие — много полей контекста (user_id, order_id, amount, latency). Это близко к подходу **wide events** в [OBSERVABILITY.md](OBSERVABILITY.md#9-wide-events-honeycomb-style).

Правило большого пальца: если журнальному сообщение похоже на `"Processing request"` или `"Method called"` — это шум, удалить. Если на `"Order 12345 created for user 678 with amount 199.00"` — это event, оставить (но переписать на структурированный формат с полями).

---

## 3. Уровни логирования

| Уровень | Когда использовать | Кто читает |
|---------|-------------------|-----------|
| `ERROR` | Неожиданное исключение, потеря данных, недоступность зависимости | Алерт → on-call |
| `WARN` | Нештатная, но обработанная ситуация (retry успешен, rate limit, fallback) | Разработчик, периодически |
| `INFO` | Нормальные бизнес-события (заказ создан, платёж прошёл) | Разработчик, при расследовании |
| `DEBUG` | Детали реализации, промежуточные состояния | Только при разработке / временно в проде |
| `TRACE` | Очень детальная трассировка | Только при отладке конкретной проблемы |

### 3.1. Главное правило ERROR

**ERROR — это unexpected**. Если ситуация ожидаемая (валидация не прошла, юзер ввёл неверный пароль, ничего не нашлось по поисковой строке) — это **не ERROR**.

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
    log.error("Invalid order");  // должен быть INFO или WARN
}
```

Почему важно: на `ERROR` обычно алерты. Каждый «false positive» ERROR — будит дежурного в 3:00. После третьего такого «ничего страшного, валидация» — on-call перестаёт реагировать на `ERROR` алерты вообще. **Alert fatigue** — реальная проблема.

### 3.2. WARN — обработанные аномалии

WARN это «что-то странное произошло, но мы знали что делать»:
- Retry успешен после 1 failure.
- Cache miss и пришлось идти в БД.
- Rate limit от downstream.
- Fallback на старую версию data.

Часто на `WARN` тоже строят дашборды — «сколько retry/fallback за день» — это business insight.

### 3.3. INFO — бизнес-события

INFO в современных приложениях — это **что-то полезное** для расследования инцидентов или для аудита. Не «вошёл в метод», а «order created», «user logged in».

В production уровень обычно INFO (включая INFO, исключая DEBUG/TRACE). На особо горячих сервисах опускают до WARN — экономия на storage.

### 3.4. DEBUG и TRACE — обычно выключены

В prod выключены по умолчанию. Включаются:
- Через Spring Actuator `POST /actuator/loggers/by.pavel.OrderService` с body `{"configuredLevel": "DEBUG"}` — без рестарта приложения. Полезно для targeted debug в bound time.
- Через пересборку с conf change — медленно.

Никогда не оставляйте `DEBUG` в prod permanently — даже если у вас «дешёвый storage». Высокий volume DEBUG может скрыть важные ERROR.

---

## 4. MDC — Mapped Diagnostic Context

MDC — это **thread-local Map**, ключ-значение которого автоматически добавляются ко всем строкам лога в текущем потоке. Без MDC вы бы в каждом `log.info(...)` явно прокидывали `requestId`:

```java
log.info("Processing order, requestId={}", requestId);
log.debug("Querying database, requestId={}", requestId);
log.warn("Slow query detected, requestId={}", requestId);
```

С MDC:

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

### 4.1. Внутреннее устройство

В Logback `MDC` — это:

```java
public class MDC {
    static final ThreadLocal<Map<String, String>> contextMap = new ThreadLocal<>();
    // ...
}
```

Каждый поток имеет свою копию `Map`. Logback при записи каждой строки лога **копирует** этот `Map` в LogEvent → JSON encoder выводит ключи как поля верхнего уровня поля.

Это даёт автоматическую корреляцию без шума в коде. Цена — поток thread-bound, и при переходе на другой поток (async, thread pool) MDC **не копируется автоматически**. См. §6.

### 4.2. Зачем `MDC.clear()` в finally

Главный пункт: в продакшене используются **thread pool**. Поток обработал HTTP запрос, вернулся в пул, ждёт следующий. Если не очистили MDC, следующий запрос (другого пользователя) **унаследует MDC старого** — в логах user-456 будет идти контекст user-123.

```java
// ВСЕГДА:
try {
    MDC.put("requestId", id);
    chain.doFilter(request, response);
} finally {
    MDC.clear();    // ОБЯЗАТЕЛЬНО
}
```

Spring's `OncePerRequestFilter` обычно сам управляет lifecycle, но при кастомных filter — `finally` ваша ответственность.

---

## 5. Correlation ID: как идентификатор доезжает до соседа

```
Client ──► API Gateway ──► Order Service ──► Payment Service
           X-Request-ID:    MDC: requestId   MDC: requestId
           "abc-123"        = "abc-123"      = "abc-123"
                            HTTP header →    в downstream вызовах
```

Идея: на гранизе системы (API gateway или первый сервис) рождается `X-Request-ID` (или используется присланный клиентом). Каждый нижестоящий сервис добавляет его в свой MDC и передаёт дальше в HTTP/Kafka headers. В логах всех сервисов one request = same `requestId` — можно собрать полную цепочку через aggregation system.

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

### 5.1. Trace ID vs Correlation ID — снова о различии

Подробно описано в [OBSERVABILITY.md §6](OBSERVABILITY.md#6-correlation-id-vs-trace-id). Суть:
- **Trace ID** — технический, ставится OpenTelemetry автоматически.
- **Correlation ID** — бизнесовый, может приходить от клиента или генерироваться gateway, отдаётся обратно в response.

Обычно нужны оба. И оба попадают в MDC, и оба видны в логах.

---

## 6. Асинхронность и MDC: потерянный контекст

```java
// ПРОБЛЕМА: MDC не копируется в новый поток автоматически
@Async
public void processOrderAsync(Order order) {
    // MDC пустой! requestId не передался из родительского потока
    log.info("Processing async");
}
```

Spring `@Async` или явное использование thread pool / `CompletableFuture.supplyAsync(...)` создаёт **новый рабочий поток**. У него свой `ThreadLocal`, в котором MDC пуст.

### 6.1. Решение для Spring: TaskDecorator

```java
@Configuration
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setTaskDecorator(runnable -> {
            // Снимок MDC из родительского потока (того, кто вызывает @Async)
            Map<String, String> mdcContext = MDC.getCopyOfContextMap();
            return () -> {
                try {
                    if (mdcContext != null) MDC.setContextMap(mdcContext);
                    runnable.run();
                } finally {
                    MDC.clear();   // очищаем после задачи, поток вернётся в пул
                }
            };
        });
        executor.initialize();
        return executor;
    }
}
```

`TaskDecorator` оборачивает каждую задачу: **на момент submit** в пул берётся снимок текущего MDC, **в момент выполнения** ставится в новый поток.

### 6.2. Корутины Kotlin

В coroutines контекст вообще другая семантика — это `CoroutineContext`. Для MDC есть отдельная зависимость:

```kotlin
// build.gradle
implementation("org.jetbrains.kotlinx:kotlinx-coroutines-slf4j")

// usage
withContext(MDCContext()) {
    log.info("hello")    // MDC из родительского scope копируется
}
```

`MDCContext` — это `ThreadContextElement` (см. [`kotlin-coroutines/theory/SCOPE_CONTEXT.md`](../../kotlin-coroutines/theory/SCOPE_CONTEXT.md) и [`DISPATCHERS.md`](../../kotlin-coroutines/theory/DISPATCHERS.md)). Корутины при смене dispatcher (Default → IO) корректно копируют MDC.

### 6.3. Виртуальные потоки (Project Loom, Java 21+)

В Java 21 GA virtual threads. Они работают с обычным `ThreadLocal`, но **ThreadLocal в virtual threads рекомендован к ограниченному использованию** — каждый virtual thread имеет свой ThreadLocal, миллион virtual threads = миллион копий MDC. Производственная альтернатива — **`ScopedValue`** (preview API в 21, стабилизируется позже).

Logback с Spring Boot уже умеет работать с virtual threads + MDC корректно. Если у вас своя инфраструктура — стоит проверить.

---

## 7. Конфигурация Logback в Spring Boot

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

Ключевые элементы:
- `LogstashEncoder` (логstash-logback-encoder library): пишет JSON, автоматически включает все MDC поля.
- `%X{requestId}` в шаблоне для dev — выводит конкретное MDC поле.
- `springProfile` — разные конфиги для prod / dev — без перекомпиляции.

### 7.1. Динамическая смена уровня в production

Spring Actuator endpoint `/actuator/loggers`:

```bash
# Получить текущий уровень
curl http://app:8080/actuator/loggers/by.pavel.OrderService

# Включить DEBUG на лету (без рестарта)
curl -X POST http://app:8080/actuator/loggers/by.pavel.OrderService \
  -H "Content-Type: application/json" \
  -d '{"configuredLevel": "DEBUG"}'

# Вернуть к default
curl -X POST http://app:8080/actuator/loggers/by.pavel.OrderService \
  -H "Content-Type: application/json" \
  -d '{"configuredLevel": null}'
```

Critically useful при дебаге production-инцидента без полного rebuild & deploy.

---

## 8. Системы агрегации: ELK, Loki, Splunk, Datadog

Логи сами по себе бесполезны — нужно куда-то их собрать и научиться искать. Производственные системы:

### 8.1. ELK / Elastic Stack

```
App stdout → Filebeat / Fluent Bit → Logstash → Elasticsearch ← Kibana
                                              (полная индексация)
```

- **Elasticsearch**: полнотекстовый поиск. **Каждое поле каждой строки лога индексируется**. Поэтому: «найди `ERROR` за последний час, где userId = X» — миллисекунды.
- **Kibana**: UI для поиска и визуализации.
- **Logstash** или **Fluent Bit / Fluentd**: парсинг и обогащение перед записью.
- **Filebeat**: lightweight log shipper.

Преимущества: быстрый поиск по любому полю, мощная query language (KQL/DSL). Недостатки: дорого по storage (индексы 3–5× размера raw logs), сложно эксплуатировать.

### 8.2. Loki

Loki (Grafana Labs, 2018) — анти-ELK подход:

```
App stdout → Promtail → Loki ← Grafana (LogQL)
                       (индексирует только labels,
                        сами логи лежат сжатыми)
```

Идея: **не индексировать содержимое**, только небольшой набор labels (app, env, namespace, pod). Сами строки логов лежат сжатыми блобами. Поиск по содержимому — grep по chunks.

Преимущества: **в 10× дешевле ELK** по storage. Хорошо работает с Kubernetes (labels-driven).
Недостатки: запросы по содержимому медленнее. Высококардинальные поля (user_id) не должны быть labels — они должны идти в JSON body, поиск по ним = grep.

LogQL пример:

```
# Все ERROR логи приложения
{app="infra-learn"} |= "ERROR"

# JSON parsing и фильтр по полю
{app="infra-learn"} | json | requestId="abc-123"

# Подсчёт ошибок за 5 минут
rate({app="infra-learn"} |= "ERROR" [5m])
```

### 8.3. Splunk

Enterprise-grade, проприетарный, дорогой. Технически — полнотекстовый search engine с очень мощным query language (SPL). Используется в больших enterprise, особенно security (SIEM).

### 8.4. Datadog / NewRelic / Honeycomb logs

Облачные managed-solutions. Удобно (нет операционной нагрузки), но дорого ($X / GB / month).

### 8.5. Что выбрать

- **Стартап / небольшой scale**: Loki + Grafana. Дёшево, окей по фичам.
- **Enterprise, нужен полный поиск, есть бюджет**: ELK self-hosted или managed.
- **Compliance/security focus**: Splunk SIEM.
- **«не хочу заниматься»**: Datadog/NewRelic logs.

---

## 9. Что НИКОГДА не должно попадать в логи

### 9.1. PII — персональные данные

GDPR (EU, 2018), CCPA (California, 2020), LGPD (Бразилия, 2020) и масса региональных аналогов жёстко регулируют **personal identifiable information**:
- Имена, email, телефоны, домашние адреса.
- IP адреса (в EU — это PII).
- Дата рождения, gender, национальность.
- Cookie IDs.

Логировать **identifiers** (userId, orderId), а не **значения**. Если очень нужно — **mask**: `john.doe@example.com` → `j***@example.com`, `+34123456789` → `+341****789`.

GDPR Article 5(1)(c): «collection minimisation» — собирай только необходимое. Article 32: «security of processing» — защити то, что собрал. Логи попадают в обе статьи.

### 9.2. Учётные данные

- Passwords (даже хешированные — не нужно).
- API keys, tokens (JWT, OAuth).
- TLS private keys.
- DB connection strings с паролем.

Случается часто: разработчик пишет `log.debug("Request: {}", request)` — а в `request` лежит `Authorization: Bearer ABCDEF...`. JWT в логах = JWT в Splunk = compromise всех систем, доступных через этот токен.

### 9.3. Платёжные данные (PCI-DSS)

Если ваш сервис касается карт, действует **PCI-DSS** — стандарт безопасности. Логировать **никогда**:
- Полный номер карты (PAN).
- CVV.
- Track data (магнитная полоса).
- PIN.

Допустимо: первые 6 + последние 4 цифры PAN (`452000******1234`). И только если это действительно нужно.

### 9.4. Медицинские данные (HIPAA)

Если ваш сервис касается health-related data в US, действует **HIPAA**. Регулирует **PHI** (Protected Health Information). Диагнозы, treatments, страховки — нельзя в логи без encryption.

### 9.5. Разбор инцидента: Cloudflare Cloudbleed (февраль 2017)

В feb 2017 Cloudflare обнаружила, что один из их краевые прокси (cf-html) **протекал содержимое чужой памяти** в HTTP response под определёнными условиями. В **протёкшую** память попадали:
- Cookies, tokens, headers других пользователей.
- Полные POST bodies (логины/пароли, личные сообщения, payment data).
- Private keys и API keys.

Хуже всего: **этот трафик прошёл через CDN, попал в логи и кэши поисковых систем** (Google, Bing, Yahoo). К моменту, когда Cloudflare обнаружили — данные сидели в search engine кэшах. Удаление потребовало работы с поисковиками и месяцев.

Урок: даже если **у вас** логи защищены, и backup encrypted, и retention 7 дней — данные **могли уже** уйти куда-то ещё. Не помещайте sensitive data в логи **никогда**. Это не «защитим в Splunk» — это «вообще не пишем».

---

## 10. Производительность: асинхронный appender и ленивое форматирование

### 10.1. Асинхронный appender

По умолчанию Logback пишет синхронно — поток приложения **блокируется** пока строка не записана в файл/stdout. На медленном I/O (например, шифрованный диск или сетевой syslog) это замедляет hot path.

```xml
<appender name="ASYNC" class="ch.qos.logback.classic.AsyncAppender">
    <queueSize>2048</queueSize>
    <discardingThreshold>0</discardingThreshold>
    <appender-ref ref="STDOUT"/>
</appender>
```

`AsyncAppender` ставит `LogEvent` в `BlockingQueue` (по умолчанию `ArrayBlockingQueue` ёмкостью 256) и сразу возвращает управление приложению. Отдельный consumer-поток пишет в реальный appender. У Log4j2 есть похожая идея с более продвинутой реализацией — `AsyncLogger` на базе **LMAX Disruptor** (lock-free ring buffer), которая на горячем пути ещё быстрее.

`discardingThreshold=0` означает: при переполнении queue **дроп** TRACE/DEBUG/INFO ради того, чтобы не блокировать приложение. WARN/ERROR пишутся всегда (синхронно при необходимости).

Cost: данные могут быть **потеряны** при crash (что в очереди — не успело записаться). Для критически важных audit logs — не подходит, syncronous всё-таки.

### 10.2. Ленивое форматирование

```java
// ПЛОХО: даже если DEBUG выключен, выполняется конкатенация
log.debug("Order: " + order.toString());

// ХОРОШО: {} placeholders; toString вызывается только если уровень включен
log.debug("Order: {}", order);
```

SLF4J pattern `{}` — это **lazy formatting**: текст собирается только если уровень логирования включает текущий уровень сообщения. С `+` на каждом вызове даже выключенного `DEBUG` строится строка.

Для tight loops это серьёзный overhead.

Аналогично для exception:

```java
// ПЛОХО: теряется stacktrace, обрезается до message
log.error("Error: " + e.getMessage());

// ХОРОШО: exception как последний аргумент — Logback выведет полный stacktrace
log.error("Error processing order={}", orderId, e);
```

---

## 11. Антипаттерны

| Антипаттерн | Проблема | Как правильно |
|-------------|----------|---------------|
| **Log & throw** | Один и тот же stacktrace 5× в логах на разных уровнях call stack | Либо `log.error + handle`, либо `throw` без логирования. Логировать на самом верхнем уровне (ControllerAdvice). |
| `log.error("Error: " + e.getMessage())` | Теряется stacktrace | `log.error("message", e)` |
| Чувствительные данные в логах | Утечка, GDPR violation | Маскировать; ID, не values |
| `log.info("Order: " + order)` конкатенация | Работа даже если уровень выключен | `log.info("Order: {}", order)` |
| MDC без `finally { clear() }` | Утечка в thread pool, чужой контекст | Всегда `finally` |
| Нет requestId / trace_id | Невозможно найти все логи одного запроса | Correlation ID через MDC filter |
| Файловое логирование в Kubernetes | Сложность ротации, расход PVC | stdout, log shipper читает |
| Один уровень для prod и dev | Шумно или undebug-able | Spring profiles для разных configs |
| Log на каждый метод (`Entering doX()`) | Шум, скрывает важные events | Логировать **business events**, не control flow |
| Логирование в hot loop | Падает performance, забивает aggregation | Sampling, или RateLimitingLogger |
| `@Transactional` плюс log внутри | rollback откатывает логи (если в DB), теряет события | Logger не в БД; писать события вне транзакции |
| ERROR для бизнес-валидации | Alert fatigue | INFO/WARN |
| Логирование без структуры в production | Невозможно агрегировать | JSON, structured |

---

## 12. Когда это неправильный ответ

**Журнал вместо метрики.** «Посчитаем количество заказов запросом по журналу» работает, пока
журнал за сутки. На месяце это полное сканирование терабайтов ради числа, которое счётчик отдаёт
мгновенно и хранит в килобайтах ([`METRICS.md`](METRICS.md) §3). Признак ошибки: регулярный
отчёт, который строят по журналу.

**Журнал вместо трассировки.** По записям видно, что Orders API отвечал 2.8 секунды, но не видно,
что 2.6 из них он ждал платёжный сервис. Соединять записи трёх сервисов по времени вручную —
занятие на час; трасса отвечает за секунду ([`OBSERVABILITY.md`](OBSERVABILITY.md) §5).

**Журнал как хранилище бизнес-событий.** Если факт «заказ создан» существует только в журнале,
то срок хранения журнала стал сроком хранения бизнес-данных, а политика ротации — политикой
удаления. Событие, которое кому-то нужно через полгода, живёт в базе или в брокере
([`microservices/ASYNC_MESSAGING.md`](../../microservices/theory/ASYNC_MESSAGING.md)), а в журнале
остаётся его след.

**DEBUG, включённый в продакшене «на всякий случай».** Объём растёт на порядок, попадает под
хранение и оплату, а полезность падает: нужное тонет. Правильный ответ — возможность **временно**
поднять уровень для конкретного логгера (§3, §7), а не постоянный DEBUG.

**Логирование и проброс исключения одновременно.** `log.error(...)` перед `throw` даёт один и тот
же стектрейс на каждом уровне вызова: одна ошибка выглядит в журнале как четыре. Обрабатывает
и логирует тот, кто принимает решение, — остальные пробрасывают (§11).

**Строковая конкатенация в горячем пути.** `log.debug("state=" + heavyToString())` вычисляет
аргумент даже при выключенном DEBUG. При 200 запросах в секунду это работа, результат которой
выбрасывается (§10).

---

## 13. Шпаргалка

**Что у вас на входе → что брать**

| Ситуация | Решение | Почему |
|---|---|---|
| Нужно посчитать, сколько чего было | Метрика, не журнал | Агрегат вместо полного сканирования |
| Нужно понять, что было с конкретным запросом | Журнал по `traceId` | Детали конкретного события |
| Нужно понять, где ушло время в цепочке | Трасса | Причинно связанные отрезки |
| Контекст запроса нужен во всех записях | MDC + фильтр на входе | Не тащить `orderId` параметром через все слои |
| Работа уходит в пул потоков | `TaskDecorator` / копирование MDC | MDC живёт в `ThreadLocal` и не переезжает |
| Ищем по произвольному полю среди терабайтов | ELK | Полнотекстовый индекс, дорого |
| Ищем по метке, объём большой, бюджет нет | Loki | Индексируются только метки |
| Запись в горячем пути | `log.debug("x={}", x)` | Аргументы не вычисляются при выключенном уровне |

**Уровень выбирается по тому, кто и когда прочитает**

| Уровень | Условие | Кто читает |
|---|---|---|
| `ERROR` | Неожиданное; на это есть алерт и есть действие | Дежурный, ночью |
| `WARN` | Нештатное, но обработанное: повтор удался, сработал запасной путь | Разработчик, периодически |
| `INFO` | Бизнес-событие: заказ создан, платёж прошёл | Разработчик, при расследовании |
| `DEBUG` | Детали реализации | Только при разработке или временно в продакшене |
| `TRACE` | Пошаговая трассировка | Только при отладке конкретной проблемы |

Ожидаемая ситуация — валидация не прошла, пароль неверный, ничего не нашлось — это **не** ERROR.
Проверка простая: если на запись нельзя написать осмысленный алерт, уровень выбран неверно.

**Что в журнал не попадает никогда**

Пароли и токены, номера карт целиком, персональные данные без необходимости, содержимое запросов
с медицинскими сведениями, ключи и сертификаты, тело ответа платёжного провайдера. Основание —
не гигиена, а GDPR, PCI-DSS и HIPAA (§9). Журнал уезжает в систему агрегации, живёт там месяцами
и доступен шире, чем база.

---

## Вопросы для самопроверки

1. Чем структурированный журнал отличается от текстового на уровне того, что с ним можно сделать?
2. `log.error` на неверный пароль пользователя — что здесь не так и к чему приводит через месяц?
3. Где физически живёт MDC и что из этого следует при работе через пул потоков?
4. Запрос прошёл через три сервиса. Что должно случиться на границе каждого, чтобы записи
   связались в одну картину?
5. Чем correlation ID отличается от trace ID и когда одного недостаточно?
6. `log.debug("payload=" + payload)` при выключенном DEBUG — какая работа всё равно выполняется?
7. ELK и Loki индексируют разное. Что именно, и как это отражается на стоимости и на скорости
   поиска?
8. Асинхронный appender ускоряет запись. Что вы теряете и в какой момент это становится заметно?
9. Приложение в контейнере пишет в файл. Почему это ошибка и куда писать вместо этого?
10. Одно исключение дало в журнале четыре стектрейса. Как это получилось?
11. Почему срок хранения журнала не должен быть сроком жизни бизнес-факта?

---

## Упражнения

- [Ex19: Logback JSON](../exercises/logging/Ex19_LogbackJson) — `logback-spring.xml`, §7.
- [Ex20: correlation ID](../exercises/logging/Ex20_CorrelationId) — `X-Request-ID`, фильтр MDC, §5.
- [Ex21: структурированное журналирование](../exercises/logging/Ex21_StructuredLogging) — MDC и бизнес-контекст, §2, §4.
- [Ex22: MDC в асинхронности](../exercises/logging/Ex22_MDCContext) — `TaskDecorator`, §6.
- [Ex23: уровни по профилям](../exercises/logging/Ex23_LogLevels) — §3, §7.
- [Ex24: Loki, Promtail, Grafana](../exercises/logging/Ex24_LokiIntegration) — §8.

---

## Источники

**Стандарты / официальная документация:**
- [The Twelve-Factor App — XI. Logs](https://12factor.net/logs) — каноническое «приложение пишет в stdout, инфраструктура агрегирует» — основа всего современного логирования.
- [SLF4J Manual](https://www.slf4j.org/manual.html) и [Logback Documentation](https://logback.qos.ch/documentation.html) — фасад и реализация.
- [OpenTelemetry Logs Specification](https://opentelemetry.io/docs/specs/otel/logs/) — будущий стандарт корреляции logs/metrics/traces.

**Books:**
- *Logging in Action* (Phil Wilkins, Manning 2022) — современный гайд по structured logging, MDC, аггрегации.

**Engineering blogs / specs:**
- [Grafana Loki — Best Practices](https://grafana.com/docs/loki/latest/best-practices/) — labels vs message body, кардинальность.
- [Elastic Common Schema (ECS)](https://www.elastic.co/guide/en/ecs/current/index.html) — стандартизированные имена полей в JSON-логах.

**Battle stories:**
- [Cloudflare «Cloudbleed» (2017)](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/) — утечка приватных данных (cookies, tokens) через логи и кэши, проиндексированные поисковиками. Иллюстрация почему PII/credentials в логи попадать не должны никогда.
- [Equifax 2017 breach (US House report)](https://oversight.house.gov/wp-content/uploads/2018/12/Equifax-Report.pdf) — отсутствие логирования и мониторинга позволило атаке длиться 76 дней незамеченной. Иллюстрация что «нет логов» не безопаснее «есть логи».
