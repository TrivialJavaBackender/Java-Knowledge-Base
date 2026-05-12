# Observability

---

## 1. Три столпа наблюдаемости

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

Они дополняют друг друга: метрика сигнализирует о проблеме → лог объясняет что произошло → трейс показывает где.

---

## 2. SLI, SLO, SLA

```
SLA (контракт с пользователем)
  └── SLO (внутренняя цель, строже SLA)
        └── SLI (что измеряем)
```

**SLI (Service Level Indicator)** — измеримый показатель качества сервиса:
- Availability: `успешные запросы / все запросы`
- Latency: `доля запросов быстрее 200ms`
- Error rate: `ошибки 5xx / все запросы`

**SLO (Service Level Objective)** — целевое значение SLI:
- "99.9% запросов успешны"
- "p99 latency < 500ms"
- "Error rate < 0.1%"

**SLA (Service Level Agreement)** — юридический договор с последствиями (скидка, штраф).
SLO всегда строже SLA: если SLA = 99.5%, то SLO = 99.9% — чтобы иметь буфер.

Пример для API сервиса в Prometheus:
```promql
# SLI: доля успешных запросов за 5 минут
rate(http_requests_total{status!~"5.."}[5m])
  / rate(http_requests_total[5m])

# Алерт: SLO нарушен
1 - (rate(http_requests_total{status!~"5.."}[1h])
     / rate(http_requests_total[1h])) > 0.001
```

---

## 3. Error Budget

```
SLO = 99.9%   →   Error Budget = 0.1%
                 = 43.8 минут недоступности в месяц
                 = 8.7 часов в год
```

**Логика работы с Error Budget:**
- Budget не исчерпан → можно деплоить новые фичи (каждый деплой — риск)
- Budget исчерпан → стоп новым фичам, фокус на надёжность
- Это баланс между скоростью (разработчики хотят деплоить) и стабильностью (надёжность)

Для разработчика: каждый deploy несёт риск — canary, feature flags, rollback plan снижают расход budget.

---

## 4. Distributed Tracing

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

**Ключевые понятия:**
- **Trace** — полный путь запроса через систему (один trace_id)
- **Span** — операция внутри trace (вызов сервиса, запрос в БД)
- **Context propagation** — передача trace_id через заголовки HTTP

**Стандарт W3C TraceContext:**
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
               version  trace-id (128bit)              span-id   flags
```

В Spring Boot + Micrometer Tracing:
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
      probability: 1.0   # 100% в dev; в prod — 0.01-0.1 (sampling снижает нагрузку)
  zipkin:
    tracing:
      endpoint: http://zipkin:9411/api/v2/spans
```

trace_id автоматически добавляется в MDC → появляется в каждой строке лога.

**Backends:** Zipkin, Jaeger, Grafana Tempo, AWS X-Ray, Datadog APM.

### Correlation ID vs Trace ID

- **Trace ID** — технический, генерируется OpenTelemetry автоматически
- **Correlation ID** — бизнесовый идентификатор запроса, может приходить от внешнего клиента

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

---

## 5. Observability vs Monitoring

| Мониторинг | Observability |
|-----------|--------------|
| Реактивный: знаешь заранее что проверять | Проактивный: можно исследовать неизвестное |
| Пороговые алерты (CPU > 80%) | Произвольные запросы к данным |
| Закрытый ящик | Открытый ящик |
| "Система работает?" | "Почему система работает медленно?" |

Мониторинг отвечает на известные вопросы. Observability позволяет задавать новые вопросы без предварительной инструментации.

---

## 6. Корреляция: Logs + Metrics + Traces

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

Ключ — общий идентификатор `trace_id` (или `request_id`) во всех трёх системах:
- В логах: MDC поле `trace_id`
- В метриках: (обычно не используют из-за кардинальности)
- В трейсах: это основной идентификатор span

Grafana 10+ позволяет из dashboard кликнуть на точку на графике и автоматически перейти к логам в Loki за этот период.

---

## Вопросы для собеседования

### Q1: Зачем нужны все три столпа — нельзя обойтись логами?
**A:** Метрики дёшевы, позволяют смотреть агрегированные тренды за месяцы и строить алерты. Логи хранить дорого, по ним сложно агрегировать — зато они дают детали. Трейсы незаменимы в микросервисах: из лога одного сервиса не видно что делали downstream сервисы. На практике: алерт от метрики → разобраться по логам → найти bottleneck через трейс.

### Q2: Что такое SLO? Чем отличается от SLA?
**A:** SLO — внутренняя цель: "99.9% запросов отвечают за < 200ms". Это ориентир для команды, нарушение SLO не влечёт юридических последствий. SLA — договор с пользователем с последствиями (штраф, скидка). SLO намеренно строже SLA, чтобы иметь запас: если SLA = 99.5%, то SLO = 99.9%. Нарушение SLO — сигнал разобраться, пока ещё не нарушен SLA.

### Q3: Как trace_id попадает в логи Spring Boot приложения?
**A:** Micrometer Tracing (или Spring Cloud Sleuth) при старте каждого запроса создаёт trace context с trace_id и span_id, и помещает их в MDC. Logback автоматически добавляет все MDC поля к каждой строке лога. При HTTP вызове другого сервиса trace_id передаётся через заголовок `traceparent` (W3C TraceContext). Так один trace_id связывает логи всех сервисов в цепочке.

### Q4: Что такое error budget и как им управлять?
**A:** Error budget = 1 - SLO. При SLO 99.9% это 43.8 минут недоступности в месяц. Пока budget не исчерпан — команда может деплоить (каждый deploy несёт риск). Когда исчерпан — деплои замораживаются до конца периода. Это объективный критерий: не "нам кажется надёжно/ненадёжно", а "осталось X минут budget". Для разработчика: canary deployments, feature flags, автоматический rollback — способы снизить риск расхода budget при деплое.

### Q5: Почему trace_id не используют как label в Prometheus метриках?
**A:** Кардинальность — каждый уникальный набор label values создаёт отдельный time series в Prometheus. trace_id уникален для каждого запроса — это миллиарды уникальных values. Prometheus хранил бы отдельный time series для каждого запроса — невозможно масштабировать. Метрики предназначены для агрегированных данных, trace_id — для трейсинговых систем (Jaeger, Tempo).

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
- [GitHub 2018 incident (24-hour outage)](https://github.blog/2018-10-30-oct21-post-incident-analysis/) — без правильного tracing восстановление заняло на порядок дольше; иллюстрация ROI инструментирования.
- [«How Slack Built a SLO-driven Engineering Culture» (talk)](https://www.youtube.com/watch?v=jhXakeIgKt4) — реальный кейс внедрения error budget.
- [Honeycomb — incident postmortems](https://www.honeycomb.io/blog/category/incident-response) — practitioner-postmortem'ы с использованием observability tools для root-cause.
