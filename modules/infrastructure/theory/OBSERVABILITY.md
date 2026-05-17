# Observability

---

## 1. Откуда термин

«Observability» — слово из control theory, введённое математиком **Рудольфом Калманом** в 1960 году. Формально: система **observable**, если по последовательности её внешних выходов можно восстановить её внутреннее состояние. Не observable — значит, есть состояния, которые снаружи неразличимы; вы не можете понять, что происходит внутри.

В software этот термин появился около 2016 года, когда **Charity Majors** (CTO Honeycomb) начала писать о том, что традиционный «monitoring» — это про **known unknowns** (нам известно, что мы можем не знать ответа: «жив ли сервер?», «достаточно ли CPU?»), а реальная сложность распределённых систем требует ответов на **unknown unknowns** — вопросы, которые мы не знали, что нужно задать, пока не случился инцидент.

«В чём разница между monitoring и observability?» — это тот самый вопрос на собеседовании, который многих сбивает. Краткий ответ:

- **Monitoring**: предопределённые дашборды, алерты по известным метрикам, «всё ли в норме?». Реактивный режим: «когда оранжевая лампочка загорелась — зови SRE».
- **Observability**: возможность **исследовать** систему. Задавать новые вопросы без предварительной инструментации. «Почему 0.3% запросов от пользователей из Германии после 14:05 получили 503, при этом только когда они шли через checkout endpoint?» — вы не предсказывали этот вопрос, но должны мочь его задать.

Не «либо-либо», а **обе нужны**. Monitoring — про здоровье и алерты. Observability — про debugging и понимание.

---

## 2. Три столпа observability

```
┌─────────────────────────────────────────────────────────┐
│                   Observability                         │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐  │
│  │  Metrics │    │  Logs    │    │  Traces          │  │
│  │          │    │          │    │                  │  │
│  │ "Что     │    │ "Что     │    │ "Где именно      │  │
│  │ происхо- │    │ произо-  │    │ тратится время?" │  │
│  │ дит?"    │    │ шло?"    │    │                  │  │
│  └──────────┘    └──────────┘    └──────────────────┘  │
│  Агрегированные  Детальные        Путь запроса через    │
│  числа           события          сервисы               │
└─────────────────────────────────────────────────────────┘
```

| Столп | Что даёт | Когда использовать | Стоимость хранения |
|-------|---------|-------------------|-------------------|
| Metrics | Агрегированные тренды, алерты | Мониторинг, alerting | Низкая |
| Logs | Детали конкретного события | Debugging, аудит | Высокая |
| Traces | Путь запроса, latency по сервисам | Performance issues | Средняя |

Они **дополняют друг друга**, не заменяют:

- Метрика сигнализирует «error_rate резко вырос на gateway».
- Логи объясняют что произошло — «PaymentService вернул 503».
- Trace показывает где именно — «latency на db query от PaymentService → 30 секунд (норма 50 ms)».

Все три должны быть **скоррелированы** через общий идентификатор (`trace_id`) — иначе вы потратите час на «найти логи к этому графику».

### 2.1. Когда не хватает одного из трёх

Многие проекты живут только с логами. Они дёшевы для понимания, но это плохо масштабируется:

- **Только логи без метрик**: алерты нужно строить через querying логов — медленно и дорого. Тренды (RPS за неделю) — невозможно или очень дорого.
- **Только метрики без логов**: вы знаете, что что-то плохо, но не знаете что. Нужно либо лезть в Pod (но они уже могли быть пересозданы), либо догадываться.
- **Без трейсов в микросервисах**: при ошибке в одном из 8 сервисов вы видите 8 логов. Какой из них первопричина? Логически связать их можно только через trace_id.

### 2.2. Кардинальность как разделитель

Главное практическое различие между столпами — **уровень кардинальности**, который они выдерживают:

- **Metrics**: низкая кардинальность. Десятки–сотни уникальных значений на label. Каждая комбинация label values = отдельный time series в Prometheus. `user_id` в метрики нельзя — миллион пользователей = миллион time series.
- **Logs**: высокая кардинальность. Каждая запись лога — отдельный event с любым набором полей. Можно положить `user_id`, `request_id`, full URL, body. Но стоит дорого хранить.
- **Traces**: средняя. Каждый trace — отдельный объект с `trace_id`. Sampling сильно снижает stored volume.

Это объясняет, почему `trace_id` появляется в логах (high cardinality OK), но **никогда** не должен быть Prometheus label.

---

## 3. SLI, SLO, SLA — измерение надёжности

В книге Google SRE есть формальные определения этих терминов, которые **обязательны** для понимания на интервью.

```
SLA (контракт с пользователем)
  └── SLO (внутренняя цель, строже SLA)
        └── SLI (что измеряем)
```

### 3.1. SLI — Service Level Indicator

**Измеримый показатель качества**: одно число, отражающее «насколько хорошо мы работаем». Не любое число — а такое, которое **коррелирует с пользовательским опытом**.

Типичные категории SLI:
- **Availability**: `успешные запросы / все запросы`. Где «успешный» — это статус ≠ 5xx и latency ≤ X.
- **Latency**: доля запросов быстрее порога (`% быстрее 200 ms`). Не average! См. §3.5.
- **Quality**: для search — `% queries с релевантным результатом`; для video — `% playback без buffering events`.
- **Throughput**: для очередей — `events_processed / events_received`.

Из всех метрик системы SLI — особая. У среднестатистического сервиса 1000 метрик. SLI — это 3–4 из них, к которым привязан error budget.

### 3.2. SLO — Service Level Objective

**Целевое значение SLI** на временном окне. Примеры:
- «99.9% availability в течение rolling 28 дней».
- «99% запросов отвечают < 200 ms в течение последних 7 дней».
- «99.99% событий доставлены в очередь в течение часа».

SLO — это **обещание команды самим себе и стейкхолдерам**. Превышение — это сигнал.

### 3.3. SLA — Service Level Agreement

**Юридический контракт** с пользователем: «гарантируем 99.5% uptime в месяц, иначе скидка 10%». Это business document, не technical.

**Ключевое правило**: SLO всегда **строже** SLA. Если SLA = 99.5%, SLO = 99.9%. Зачем:
- SLO нарушен → команда чешет голову, разбирается, исправляет → SLA **не нарушен** → нет финансовых потерь.
- Если поставили SLO = SLA, то к моменту, когда команда среагировала, SLA уже нарушен — поздно.

Это buffer для реакции.

### 3.4. Пример расчёта

API сервис, SLO availability 99.9% за 30 дней.

```promql
# SLI: доля успешных запросов
sum(rate(http_requests_total{status!~"5.."}[28d]))
  / sum(rate(http_requests_total[28d]))

# Нарушение SLO
1 - (
  sum(rate(http_requests_total{status!~"5.."}[28d]))
  / sum(rate(http_requests_total[28d]))
) > 0.001
```

### 3.5. Почему percentile, а не average

Среднее (average) latency скрывает выбросы. Пример из жизни: 100 запросов, 99 из них за 50 ms, 1 — за 30 секунд. Average = 350 ms. «Норма, в пределах SLO < 500 ms». Реальность: один пользователь ждал полминуты и ушёл.

**Percentile** (p99, p99.9) показывает «худшие пользователи». p99 = 30 sec в этом примере — реальная картина.

Правило: всегда SLO формулировать через percentile, не average.

---

## 4. Error Budget

```
SLO = 99.9%   →   Error Budget = 0.1%
                 = 43.8 минут недоступности в месяц
                 = 8.7 часов в год
```

Из SLO 99.9% вытекает: вы **можете позволить себе** 0.1% неудачных запросов. Это и есть **error budget** — «бюджет ошибок».

| SLO | Error budget в месяц |
|-----|---------------------|
| 99% | 7.2 часа |
| 99.5% | 3.6 часа |
| 99.9% | 43.8 минут |
| 99.95% | 21.9 минут |
| 99.99% | 4.4 минут |
| 99.999% | 26.3 секунд |

### 4.1. Управление error budget — Google SRE policy

Книга Google SRE предлагает явную operational policy:

- **Budget не исчерпан** (например, потратили 20 из 43.8 минут): команда может **деплоить новые фичи**. Каждый деплой — риск. Используем оставшийся бюджет на «инновации».
- **Budget исчерпан** (потратили 43.8+ минут за месяц): **deploy freeze**. Команда сосредотачивается на надёжности — никаких новых фичей, только bugfixes и reliability work. Возобновление после восстановления budget.

Это **объективный критерий**. Не «нам кажется надёжно», а «осталось X минут». Снимает политические дискуссии вида «продакт vs SRE».

### 4.2. Burn rate alerts

Простой алерт «error rate > 0.1%» страдает: либо много false positives (короткий spike), либо реакция слишком поздняя (низкий threshold за длинное окно).

Google SRE Workbook предложил **multi-window multi-burn-rate alerts**:

- Алерт «critical»: за последний час сжигаем budget в 14.4× быстрее нормы **И** за последние 5 минут — тоже. (Если за 5 минут так же быстро — это не случайный spike.)
- Алерт «warning»: за 6 часов — в 6× быстрее.
- Алерт «slow burn»: за 3 дня — в 1× (постепенная утечка budget).

Это позволяет ловить и резкие отказы (быстрая реакция), и медленные деградации (которые long-window average размазывает).

---

## 5. Distributed Tracing

В монолите debugging прост: один request — один процесс — один стек вызовов. Profile показывает, где провели время.

В микросервисах: один запрос пользователя порождает десятки внутренних RPC, разбегающихся через mesh. Чтобы понять, кто потратил time, нужно собрать данные **из всех сервисов** и связать их.

```
Запрос пользователя
     │
     ▼
 [gateway]──────────────────────────── trace_id: abc123
     │  span_id: 001, latency: 5ms
     │
     ├──► [auth-service]
     │       span_id: 002, latency: 2ms
     │
     └──► [order-service]
               span_id: 003, latency: 180ms
               │
               └──► [db query]
                        span_id: 004, latency: 150ms  ← узкое место
```

### 5.1. Терминология

- **Trace** — полный путь запроса через систему. Уникальный `trace_id` (обычно 128-битное число).
- **Span** — одна операция: HTTP call, DB query, message publish. У каждого span: `span_id`, `parent_span_id`, `start_time`, `duration`, `tags`, `events`. Trace — это **дерево spans** (DAG, если есть параллельные branches).
- **Context propagation** — передача trace_id между сервисами. Обычно через HTTP-заголовки.

### 5.2. Семплирование — без него tracing неподъёмен

Если каждый request порождает trace из 20 spans, и у вас 10 000 RPS, это **17 миллиардов spans в день**. Hot storage для tracing-данных дорогой.

**Sampling**: записывать не все trace, а только часть. Стратегии:

- **Head-based sampling** (в SDK): решение «писать или нет» принимается **в начале** trace, на первом сервисе. Все downstream сервисы того же trace следуют решению (через флаг в trace context). Просто, дёшево. Но решение принимается **без знания результата** — может пропустить инцидент.
- **Tail-based sampling** (в Collector): решение принимается **после** того, как все spans собраны. Можно сохранять только trace с ошибками или с высокой latency. Лучше для инцидент-debugging, но требует временного буфера и больше ресурсов на collector.

Production-стратегия часто **гибрид**: head-sample 1% всех trace (для baseline data), tail-sample 100% trace с error/высокой latency.

### 5.3. W3C Trace Context

Раньше у каждого вендора был свой формат HTTP-заголовков: Zipkin/B3 (`X-B3-TraceId`, `X-B3-SpanId`, `X-B3-Sampled`), DataDog (`x-datadog-trace-id`), Jaeger (`uber-trace-id`). При интеграции систем — каждый sidecar должен был знать про все.

В 2020 году W3C приняла стандарт **Trace Context** — единый формат:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                                │                 │
             │  trace-id (128bit)                span-id (64bit)    trace-flags
             version
```

```
tracestate: vendor1=value1,vendor2=value2
```

Все современные libraries (OpenTelemetry, Spring Micrometer Tracing, gRPC, Envoy) генерируют и принимают этот формат. Legacy B3-поддержка обычно есть для совместимости.

### 5.4. OpenTelemetry — стандартизация всего

До 2019 было два конкурирующих standards:

- **OpenTracing** (CNCF, 2016) — API спецификация для tracing.
- **OpenCensus** (Google, 2018) — API для metrics + tracing.

В 2019 они **слились** в **OpenTelemetry** (OTel). Это:
- **Specification** — что такое span, что такое trace, как propagate'ить context.
- **API** — Java/Python/Go/JS/.NET — что приложение вызывает для инструментации.
- **SDK** — реализация API, выполняющая sampling, buffering, export.
- **Collector** — отдельный сервис, принимающий данные (OTLP protocol), процессящий (filtering, tail-sampling, batching), экспортирующий в backend (Jaeger, Tempo, Datadog).

Главное практическое следствие: **код приложения** инструментируется через OTel API, и его можно переключить между Jaeger, Datadog, NewRelic, AWS X-Ray, Honeycomb **просто меняя конфигурацию collector'а**. Это снимает vendor lock-in.

В Java OTel часто используется через **Micrometer Tracing** — фасад от Spring, аналогичный SLF4J для логов:

```xml
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-otel</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-spring-boot-starter</artifactId>
</dependency>
```

```yaml
management:
  tracing:
    sampling:
      probability: 1.0   # 100% в dev; в prod — 0.01-0.1
  otlp:
    tracing:
      endpoint: http://otel-collector:4317
```

### 5.5. Propagation через границы — частые ошибки

Propagation HTTP работает «само» — Spring/Micrometer instrumentation добавляет traceparent header. Но через другие границы — нет:

- **Kafka**: span context надо прокидывать через **Kafka headers**. OTel auto-instrumentation для KafkaTemplate/KafkaListener это делает; рукописный код через raw Producer/Consumer — нет.
- **gRPC**: через metadata. OTel-instrumented gRPC client делает это сам.
- **Async внутри одного процесса**: при `@Async` или `CompletableFuture.supplyAsync` контекст легко теряется. Spring's TaskDecorator должен копировать его (как для MDC).
- **Threads**: для virtual threads (Loom) — нужен правильно сконфигурированный OTel, новые ScopedValue API.

Если на trace «обрывается» в середине — почти всегда это пропущенный propagation на одной из границ.

---

## 6. Correlation ID vs Trace ID

Эти два термина часто путают:

| | Trace ID | Correlation ID |
|---|----------|----------------|
| Создаётся | Автоматически OpenTelemetry SDK на первом сервисе | Бизнес-логикой, часто на API gateway или клиентом |
| Формат | 128-битное число | UUID, иногда бизнес-id |
| Видим клиенту | Обычно нет | Часто возвращается клиенту в response header |
| Цель | Технический tracing | Сослаться на запрос в поддержке: «передайте номер ABC-123» |
| Связь с tracing | — | — |

Часто оба нужны:
- Trace ID — внутри system для performance debugging.
- Correlation ID — для customer support: пользователь жалуется → даёт `X-Request-ID: abc123` → инженер находит логи именно этого запроса.

```java
// Spring фильтр: пробрасывает X-Correlation-ID через сервисы
@Component
public class CorrelationIdFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String correlationId = request.getHeader("X-Correlation-ID");
        if (correlationId == null) correlationId = UUID.randomUUID().toString();
        MDC.put("correlationId", correlationId);
        response.setHeader("X-Correlation-ID", correlationId);
        try { filterChain.doFilter(request, response); }
        finally { MDC.clear(); }
    }
}
```

И в логах появится оба поля: `trace_id` (от OTel) и `correlationId` (от вашего фильтра). Оба полезны.

---

## 7. Корреляция: как связать три столпа

```
Grafana Dashboard
    │
    ├── Метрика: error_rate резко вырос в 14:05
    │              │
    │              ▼ перейти к логам в это время
    ├── Loki: ERROR OrderService - connection refused
    │         trace_id: abc123
    │              │
    │              ▼ перейти к трейсу
    └── Jaeger: trace abc123
                  order-service → postgres: timeout 30s
```

Ключ — общий идентификатор `trace_id` во всех трёх системах:
- **В логах**: MDC поле `trace_id` (Micrometer Tracing делает это автоматически).
- **В метриках**: НЕ как label (кардинальность!), а как **exemplar** — см. §7.1.
- **В трейсах**: это основной идентификатор span.

Grafana 9+ умеет cross-system navigation: из dashboard metric clickнуть на точку графика → автоматически открыть Loki за это время → найти лог с trace_id → открыть Jaeger.

### 7.1. Exemplars — мост между метриками и трейсами

Проблема: метрики имеют низкую cardinality (нельзя trace_id как label), но при инциденте хочется «вот этот latency spike — какие конкретно trace его вызвали?».

**Exemplar** (OpenMetrics, Prometheus 2.26+): одна точка histogram bucket'a может нести **дополнительную аннотацию** с конкретным trace_id. Это **не** label (на cardinality не влияет), а side-channel метаданные.

В Prometheus exposition format:

```
# HELP request_duration_seconds Request duration
# TYPE request_duration_seconds histogram
request_duration_seconds_bucket{le="1.0"} 1235 # {trace_id="4bf92f3577b34da6"} 0.987
```

После `#` идёт exemplar: «один из последних запросов в этом bucket — trace abc...». Grafana показывает их как точки рядом с гистограммой, кликаешь — открывается trace.

С этим связь metrics ↔ traces становится тривиальной без cardinality bomb.

---

## 8. Sampling strategies подробнее

### 8.1. Head-based

```
gateway: random < 0.1 → 'sampled=true' в trace context
                  ↓
           order-service: видит sampled=true → пишет spans
                  ↓
           payment-service: то же
```

Преимущества: дёшево, просто, decision'ы локальные на каждом сервисе.

Недостатки:
- Не можем выбрать ошибочные trace — решение принято до того, как ошибка случилась.
- Слабо различимые trace (один из 1000 нормальных) — теряются.

### 8.2. Tail-based

```
gateway: всегда sampled=true, запись в local buffer
order-service: то же
payment-service: то же
                  ↓
         Все spans → OTel Collector (буфер на 30 sec)
                  ↓
       Collector видит весь trace, принимает решение
                  ↓
    сохранить, если: error || latency > 1s || random < 0.01
```

Преимущества: 100% ошибок попадают в storage. Можно настроить «всё, что медленно» или «всё, что не было видно раньше».

Недостатки:
- Collector — bottleneck. Все trace должны попасть к нему до timeout buffer'а.
- Дополнительная инфраструктура (стейтфул collector).
- Латентность принятия решения (буфер).

### 8.3. Production stack

Современный production-стек:
- **Head-sample 1%** трафика — даёт baseline для performance trending.
- **100% error trace** через tail-sampling — все ошибки видны.
- **Probabilistic boost для slow** — latency > p99 baseline → keep.

---

## 9. Wide events (Honeycomb-style)

Альтернатива «три столпа» — подход, продвигаемый Honeycomb: **wide events**. Одно событие на каждую операцию, с большим количеством полей (50–200 атрибутов): user_id, region, A/B variant, build SHA, request size, response time, status code, downstream latencies, customer tier...

```json
{
  "timestamp": "...",
  "service": "orders",
  "trace_id": "abc",
  "span_id": "xyz",
  "duration_ms": 234,
  "user_id": "u-123",
  "tier": "enterprise",
  "region": "eu-west",
  "build": "a1b2c3d",
  "feature_flag_canary": true,
  "db_query_count": 4,
  "db_total_latency_ms": 89,
  "downstream_payment_latency_ms": 102,
  "status": "200",
  "endpoint": "/api/checkout",
  ...
}
```

Идея: **высокая cardinality прямо в event** + быстрое движение «column store» backend (Honeycomb proprietary, Apache Druid, ClickHouse). Можно ad-hoc запрашивать: «покажи p99 latency для enterprise клиентов в eu-west, где включен canary flag».

Это **не противоречит** OTel — span с богатыми attributes — это wide event. Но изначально OTel-stack ориентирован на «3 столпа», и не все backends умеют work с такой cardinality.

---

## 10. Антипаттерны

| Антипаттерн | Проблема | Как правильно |
|-------------|----------|---------------|
| Только логи без metrics/traces | Нет агрегатов, нет связности | Полноценный stack metrics + logs + traces |
| Average latency как SLI | Скрывает выбросы | Percentile (p99, p99.9) |
| SLO = SLA | Нет буфера для реакции | SLO строже SLA |
| `trace_id` как label в Prometheus | Cardinality bomb | Exemplars или просто в логах |
| Sampling 100% в prod | Расходы на storage растут линейно | Head + tail combo, 1% baseline + 100% errors |
| `livenessProbe` как SLI | Probe фейлы не отражают user experience | Метрики на real user requests |
| Tracing «добавим потом» | Нет propagation в legacy кодe — слепые зоны | Инструментировать с первого дня |
| Не correlate logs и traces | На инцидент тратится в 10× больше времени | trace_id в каждой строке лога (MDC + OTel) |
| Один SLO «availability» на весь продукт | Слишком грубо — checkout может быть down, а profile работает | Per-feature/per-endpoint SLO |
| Observability как cost-center | «Сократим Datadog» → следующий инцидент 24h | Считать ROI = saved downtime |

---

## 11. Battle stories

### 11.1. GitHub — October 2018, 24-hour outage

21 октября 2018 года GitHub был в degraded mode 24 часа. Root cause — split-brain в БД (network partition в кластере MySQL). Восстановление потребовало manual reconciliation с лидерами реплики.

Что подсвечивает эта история про observability: команда быстро обнаружила что-то не так через метрики, но **разобраться где именно и что делать** — заняло часы, потому что не было полноценного distributed tracing. Решение проблемы требовало понимания **цепочки событий** в реплике БД, а не моментального снимка состояния.

Этим выложен мощный аргумент: observability — не «дополнение», а инвестиция, которая платит дивиденды ровно в момент incident'а. Когда таймер тикает и каждая минута стоит $X — у вас должно быть **уже** настроено всё, что нужно для root cause analysis.

### 11.2. Slack — SLO culture

Slack — один из tex кто публично описал, как они построили SLO-culture. Чему стоит поучиться:

- SLO определены **per feature**, не общий «availability сервиса». «Messages sent» имеет свой SLO, «notifications» — свой.
- Error budget визуализирован на дашбордах. Каждый инженер видит «осталось столько-то минут».
- Burn rate alerts настроены, а не «алерт когда уже всё плохо».
- Post-mortems обязательны, blameless. Документация решений сохраняется как learning resource.

---

## Источники

**Books:**
- *Observability Engineering* (Charity Majors, Liz Fong-Jones, George Miranda, O'Reilly 2022) — каноническая книга, которая ввела термин в массовое употребление.
- *Site Reliability Engineering* (Google, [free online](https://sre.google/books/)) — главы по SLO, Error Budget, monitoring.
- *Implementing Service Level Objectives* (Alex Hidalgo, O'Reilly 2020) — практика SLI/SLO/error budget.
- *Distributed Tracing in Practice* (Austin Parker et al., O'Reilly 2020).

**Стандарты / спецификации:**
- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/otel/) — единый стандарт для metrics/logs/traces.
- [W3C TraceContext (`traceparent`, `tracestate`)](https://www.w3.org/TR/trace-context/) — каноническое описание propagation.
- [OpenMetrics specification](https://openmetrics.io/) — формат, на котором сошлись Prometheus, OpenTelemetry, Datadog.

**Engineering posts:**
- [Charity Majors — «Observability — A 3-Year Retrospective»](https://thenewstack.io/observability-a-3-year-retrospective/) — почему «monitoring» и «observability» — разные вещи.
- [Cindy Sridharan — «Distributed Systems Observability» (free O'Reilly book)](https://www.oreilly.com/library/view/distributed-systems-observability/9781492033431/) — фундаментальная статья.
- [Honeycomb — «What is observability?»](https://www.honeycomb.io/resources/getting-started/what-is-observability-engineering) — точка зрения от компании, которая на этом построилась.

**Battle stories:**
- [GitHub 2018 incident (24-hour outage)](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) — без правильного tracing восстановление заняло на порядок дольше; иллюстрация ROI инструментирования.
- [Honeycomb — incident postmortems](https://www.honeycomb.io/blog/category/incident-response) — practitioner-postmortem'ы с использованием observability tools для root-cause.
