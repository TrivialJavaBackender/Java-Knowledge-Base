# Metrics

---

## 1. Типы метрик

### Counter
Монотонно возрастающее значение. Только увеличивается, сбрасывается при рестарте.

```
http_requests_total{method="GET", status="200"} 1500
http_requests_total{method="POST", status="500"} 23
```

Для анализа используют `rate()` — скорость роста, не абсолютное значение.

### Gauge
Текущее значение, которое может расти и убывать.

```
jvm_memory_used_bytes{area="heap"} 134217728
http_active_requests 42
queue_size 156
```

Читается напрямую. `rate()` не применяется.

### Histogram
Подсчитывает наблюдения по заранее заданным bucket'ам. Позволяет вычислять percentile.

```
http_request_duration_seconds_bucket{le="0.1"} 8000   # быстрее 100ms
http_request_duration_seconds_bucket{le="0.5"} 9500   # быстрее 500ms
http_request_duration_seconds_bucket{le="1.0"} 9900   # быстрее 1s
http_request_duration_seconds_bucket{le="+Inf"} 10000  # все запросы
http_request_duration_seconds_sum 4521.3               # суммарное время
http_request_duration_seconds_count 10000              # количество
```

### Summary
Считает percentile прямо в приложении. Не агрегируется между инстансами.

| | Histogram | Summary |
|-|----------|---------|
| Percentile | Вычисляется в Prometheus | Вычисляется в приложении |
| Агрегация нескольких инстансов | ✅ Да | ❌ Нет |
| Bucket'ы | Настраиваются | Не нужны |
| Когда использовать | Почти всегда | Редко, один инстанс |

---

## 2. Prometheus Pull Model

```
┌──────────────────┐                        ┌────────────┐
│  Spring Boot App │  ◄── scrape каждые 15s ─│ Prometheus │
│  :8080           │                        │            │
│  /actuator/      │  → text format         │  TSDB      │
│  prometheus      │                        └─────┬──────┘
└──────────────────┘                              │ PromQL
         │                                   ┌────▼───────┐
  Service Discovery                          │  Grafana   │
  (kubernetes_sd или                         │            │
   static_configs)                           └────────────┘
```

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'spring-app'
    static_configs:
      - targets: ['app:8080']
    metrics_path: '/actuator/prometheus'

  # Автоматическое обнаружение в Kubernetes
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      # Scrape только Pod с аннотацией prometheus.io/scrape: "true"
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
```

---

## 3. Micrometer в Spring Boot

Micrometer — фасад над метриками, аналог SLF4J для логов. Позволяет менять backend (Prometheus, Datadog, CloudWatch) без изменения кода.

```java
@Service
public class OrderService {

    private final Counter ordersCreated;
    private final Timer orderProcessingTimer;
    private final AtomicInteger activeOrders;

    public OrderService(MeterRegistry registry) {
        // Counter — с тегами для разрезки по типу и статусу
        this.ordersCreated = Counter.builder("orders.created.total")
            .description("Total number of created orders")
            .tag("type", "standard")
            .register(registry);

        // Timer автоматически создаёт histogram метрики _bucket, _sum, _count
        this.orderProcessingTimer = Timer.builder("order.processing.duration.seconds")
            .description("Order processing duration")
            .publishPercentileHistogram()     // включает histogram_quantile в PromQL
            .register(registry);

        // Gauge — текущее значение
        this.activeOrders = registry.gauge("orders.active",
            new AtomicInteger(0));
    }

    public Order createOrder(OrderRequest request) {
        return orderProcessingTimer.record(() -> {   // автоматически измеряет время
            Order order = processOrder(request);
            ordersCreated.increment();
            return order;
        });
    }
}
```

Аннотация `@Timed` (через AOP):
```java
@Timed(value = "orders.created", description = "Order creation time")
public Order createOrder(OrderRequest request) { ... }
```

Spring Boot автоматически регистрирует:
- JVM метрики: `jvm_memory_used_bytes`, `jvm_gc_pause_seconds`
- HTTP: `http_server_requests_seconds` (histogram)
- DataSource: `jdbc_connections_active`
- ThreadPool: `executor_active_threads`

---

## 4. PromQL — основные операции

```promql
# Скорость запросов в секунду (Counter)
rate(http_server_requests_seconds_count[5m])

# Error rate (5xx / all)
rate(http_server_requests_seconds_count{status=~"5.."}[5m])
  / rate(http_server_requests_seconds_count[5m])

# p99 latency из histogram
histogram_quantile(0.99,
  rate(http_server_requests_seconds_bucket[5m])
)

# p99 latency сгруппированный по endpoint
histogram_quantile(0.99,
  sum(rate(http_server_requests_seconds_bucket[5m])) by (uri, le)
)

# Топ 5 endpoint по RPS
topk(5, rate(http_server_requests_seconds_count[5m]))

# Доступность за 1 час (для SLO)
1 - (
  rate(http_server_requests_seconds_count{status=~"5.."}[1h])
  / rate(http_server_requests_seconds_count[1h])
)
```

Правила применения:
- `rate()` / `irate()` — только к Counter
- `histogram_quantile()` — требует `_bucket` метрики и `le` label
- `by (label)` — агрегация сохраняя label
- `without (label)` — агрегация без этого label
- `sum`, `avg`, `max`, `min` — агрегирующие функции

---

## 5. Grafana Dashboard

Типичные панели для Spring Boot сервиса:

```
┌────────────────┬─────────────────┬────────────────────┐
│   RPS          │   Error Rate    │   p99 Latency      │
│   rate()[5m]   │   5xx/all [5m]  │   histogram_q(0.99)│
├────────────────┴─────────────────┴────────────────────┤
│                 JVM Memory (Heap vs Non-Heap)          │
├───────────────────────────────────────────────────────┤
│                 Active HTTP Connections                 │
└───────────────────────────────────────────────────────┘
```

Alerting в Prometheus:
```yaml
# prometheus/rules.yml
groups:
  - name: app-alerts
    rules:
      - alert: HighErrorRate
        expr: |
          rate(http_server_requests_seconds_count{status=~"5.."}[5m])
            / rate(http_server_requests_seconds_count[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error rate > 1% for 5 minutes"

      - alert: HighP99Latency
        expr: |
          histogram_quantile(0.99,
            rate(http_server_requests_seconds_bucket[5m])
          ) > 1.0
        for: 10m
        annotations:
          summary: "p99 latency > 1 second"
```

---

## 6. Кардинальность — важная концепция

```
# ПРАВИЛЬНО: конечное множество значений
http_requests_total{method="GET", status="200"}

# ОПАСНО: userId миллиарды значений → миллиарды time series
http_requests_total{userId="12345678"}  ❌
```

Каждая уникальная комбинация label values = отдельный time series в Prometheus. Высокая кардинальность:
- Потребляет гигабайты RAM
- Замедляет запросы
- Может положить Prometheus

Правила:
- Не использовать в labels: userId, email, orderId, URL без нормализации
- Нормализовать: вместо `/api/orders/123` → `/api/orders/{id}`
- Группировать status codes: `2xx`, `4xx`, `5xx`

---

## 7. Именование метрик

Соглашения Prometheus:
```
# Формат: <namespace>_<name>_<unit>
# Суффиксы: _total (counter), _seconds (time), _bytes (size)

http_requests_total              ✅ counter
orders_created_total             ✅ counter
jvm_memory_used_bytes            ✅ gauge с единицей
http_request_duration_seconds    ✅ histogram в секундах

httpRequests                     ❌ не camelCase
order_count                      ❌ нет _total для counter
latencyMs                        ❌ нет единицы, camelCase
```

---

## Вопросы для собеседования

### Q1: Чем Counter отличается от Gauge?
**A:** Counter только растёт (и сбрасывается при рестарте приложения). Примеры: запросы, ошибки, обработанные сообщения. Для анализа используют `rate(counter[5m])` — скорость роста. Gauge — текущее значение, может расти и убывать: размер очереди, память, активные соединения. Gauge читается напрямую. Применять `rate()` к Gauge нельзя — будут некорректные результаты.

### Q2: Когда Histogram, когда Summary?
**A:** Histogram считает по bucket'ам в приложении, percentile вычисляет Prometheus через `histogram_quantile()` — можно агрегировать данные нескольких инстансов и менять percentile без перезапуска. Summary считает percentile в приложении — не агрегируется между инстансами. Правило: используйте Histogram. Summary только если один инстанс и percentile нужны без PromQL.

### Q3: Что такое кардинальность и почему она опасна?
**A:** Кардинальность — количество уникальных комбинаций label values. Каждая уникальная комбинация — отдельный time series в памяти Prometheus. `userId` с миллионом пользователей × 10 метрик = 10M time series. Prometheus хранит всё в RAM — это может убить инстанс. Правило: labels должны иметь конечное, небольшое множество значений (статус, метод, endpoint без ID).

### Q4: Как работает `histogram_quantile()`?
**A:** Histogram хранит counts по bucket'ам с boundary `le` (less or equal). `histogram_quantile(0.99, rate(metric_bucket[5m]))` находит bucket, в котором находится 99-я перцентиль, и интерполирует внутри него. Точность зависит от bucket'ов: если p99 между 0.5s и 1.0s, а bucket'ов между ними нет — получим приближение. В Micrometer: `publishPercentileHistogram()` добавляет стандартные bucket'ы.

### Q5: Как добавить кастомный Counter в Spring Boot?
**A:** Инжектировать `MeterRegistry`, создать Counter через builder: `Counter.builder("orders.created.total").tag("status", "success").register(registry)`, вызывать `.increment()` в нужном месте. Тег `status` позволяет разрезать метрику: `rate(orders_created_total{status="success"}[5m])` vs `rate(orders_created_total{status="failed"}[5m])`. Имя по соглашению: snake_case, суффикс `_total` для counter.

### Q6: Что такое recording rules в Prometheus?
**A:** Предвычисленные запросы, которые Prometheus пересчитывает и сохраняет как новые time series. Полезны для дорогих запросов (сложные агрегации), которые используются в дашборд постоянно. Вместо вычисления `histogram_quantile(0.99, ...)` при каждом обновлении Grafana — один раз в минуту Prometheus считает и сохраняет результат. Dashboards читают готовый результат — быстро.

### Q7: Как Prometheus находит endpoint для scrape в Kubernetes?
**A:** Через kubernetes_sd (service discovery). Prometheus смотрит Kubernetes API на Pod/Service/Node. Через `relabel_configs` фильтрует: берёт только Pod с аннотацией `prometheus.io/scrape: "true"` и использует `prometheus.io/port` и `prometheus.io/path` для настройки scrape. Spring Boot Pod нужно аннотировать: `annotations: prometheus.io/scrape: "true"`, `prometheus.io/port: "8080"`, `prometheus.io/path: "/actuator/prometheus"`.

---

## Источники

**Официальная документация:**
- [Prometheus Documentation](https://prometheus.io/docs/) — types of metrics, storage, querying, alerting.
- [PromQL Cheat Sheet (Promlabs)](https://promlabs.com/promql-cheat-sheet/) — лучшая практическая шпаргалка.
- [Micrometer Documentation](https://micrometer.io/docs) — фасад, как и почему.
- [Spring Boot Actuator — Metrics](https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html#actuator.metrics)
- [Grafana Documentation](https://grafana.com/docs/grafana/latest/) — Dashboards, Alerting, Loki/Tempo интеграции.

**Books:**
- *Prometheus: Up & Running*, 2nd ed. (Brian Brazil, O'Reilly 2024) — автор — core developer Prometheus.
- *Site Reliability Engineering* (Google, [open book](https://sre.google/books/)) — Ch. 6 «Monitoring Distributed Systems».
- *The Site Reliability Workbook* (Google, открытая книга) — практические примеры USE/RED.

**Methodologies:**
- [Brendan Gregg — «The USE Method» (Utilization, Saturation, Errors)](https://www.brendangregg.com/usemethod.html) — про hardware ресурсы.
- [Tom Wilkie — «The RED Method» (Rate, Errors, Duration)](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/) — про request-driven сервисы.
- [Google SRE — «Four Golden Signals» (Latency, Traffic, Errors, Saturation)](https://sre.google/sre-book/monitoring-distributed-systems/#xref_monitoring_golden-signals)

**Engineering posts:**
- [Cindy Sridharan — «Monitoring in the time of cloud native»](https://copyconstruct.medium.com/monitoring-in-the-time-of-cloud-native-c87c7a5bfa3e) — переход от хост-метрик к request-метрикам.
- [Grafana Labs — «How we cut our Prometheus memory usage by 90%»](https://grafana.com/blog/) — про cardinality, recording rules.
