# Metrics

---

## 1. История: от SNMP до Prometheus

Прежде чем понять «зачем именно Prometheus pull», полезно знать, что было до.

- **1988: SNMP (Simple Network Management Protocol)**. Стандарт IETF для опроса сетевого оборудования. Любой роутер/коммутатор отдавал MIB tree. Очень network-centric, не для приложений.
- **1999: RRDtool** (Tobi Oetiker). Round-robin database — фиксированного размера круговой буфер, в который раз в минуту записывается значение метрики. Перезаписывает себя циклически. Использовался в Cacti, MRTG, Munin. Подход — push (наблюдаемый сам слал данные).
- **2002: Nagios**. Pull-based monitoring: центральный сервер опрашивал hosts через plugins, alerting по threshold. До сих пор живёт в legacy инфраструктуре.
- **2008: StatsD** (Etsy). UDP-based push-collector. Приложение шлёт `mymetric.foo:1|c` (counter) по UDP на StatsD daemon — он агрегирует и flush'ит в backend (Graphite). Lightweight, fire-and-forget.
- **2012: Prometheus** (SoundCloud). Open-source 2015, donate в CNCF. Pull-based, structured metrics с labels, PromQL. Заменил StatsD/Graphite во множестве проектов.
- **2017: OpenMetrics** — расширение Prometheus exposition format в CNCF-стандарт. Поддерживается Prometheus, OpenTelemetry, Datadog.

В 2026 году канонический стек для метрик в Kubernetes: **Prometheus** + **Grafana** для визуализации + **Alertmanager** для алертов. Long-term storage — **Thanos** / **Cortex** / **Mimir** / **VictoriaMetrics** через remote_write.

---

## 2. Push vs Pull — фундаментальный выбор

```
Push model (StatsD, InfluxDB telegraf):
   App ──► metrics → ──► [server]
   App ──► metrics → ──► [server]
   App ──► metrics → ──► [server]
   "Я сейчас пошлю свои метрики"

Pull model (Prometheus):
   [server] ──► scrape ──► App (отдаёт /metrics endpoint)
   [server] ──► scrape ──► App
   [server] ──► scrape ──► App
   "Я сам приду и заберу"
```

Каждая модель имеет плюсы и минусы:

| | Push (StatsD, Telegraf) | Pull (Prometheus) |
|---|------------------------|-------------------|
| **Service discovery** | App знает адрес collector'а | Server знает кто live (через service discovery) |
| **Dead instance detection** | Если App не push'ит — может быть просто quiet | Если scrape падает — instance видимо мёртв |
| **Firewall** | App инициирует connection — OK | Server должен достучаться до App — сложнее в restricted networks |
| **Short-lived jobs** | Естественно — job push'нул и умер | Сложно — job может умереть до того, как Prometheus scrape'нет |
| **Multi-tenancy** | Collector — bottleneck | Каждый Prometheus тянет своё, изоляция |
| **Custom intervals** | App может слать с любой частотой | Server решает scrape interval — обычно 15s |

Pull стал доминировать в Kubernetes из-за **service discovery**: Prometheus интегрирован с K8s API, видит все Pods и Services, автоматически scrape'ит подходящие. Push-системы требовали бы каждое приложение знать «куда слать» — статичную конфигурацию или service mesh.

### 2.1. Что делать с short-lived jobs?

Pull плохо подходит для batch jobs: запустился, отработал 5 секунд, умер. Prometheus не успел scrape — метрики потеряны.

Решение — **Pushgateway**: маленький сервер, в который job push'ит свои метрики перед smertyu. Pushgateway хранит их и отдаёт Prometheus при следующем scrape.

```bash
echo "some_metric 3.14" | curl --data-binary @- \
  http://pushgateway:9091/metrics/job/some_batch_job/instance/host_a
```

Использовать только для **batch/cron jobs**. Не как escape hatch «у меня firewall, не могу позволить scrape» — для этого есть нормальные решения.

---

## 3. Типы метрик

### 3.1. Counter

**Монотонно возрастающее значение**. Только увеличивается, сбрасывается при рестарте процесса.

```
http_requests_total{method="GET", status="200"} 1500
http_requests_total{method="POST", status="500"} 23
```

Само значение бесполезно: «1500 запросов с момента старта» — много это или мало? Имеет смысл **скорость роста**: `rate(http_requests_total[5m])` — запросов в секунду за последние 5 минут.

Counter **может** упасть: при рестарте процесса. Prometheus `rate()` это знает и корректно обрабатывает (если значение уменьшилось — считается это reset, не считается отрицательной разницы).

**Naming convention**: суффикс `_total`. `http_requests_total`, не `http_requests`.

### 3.2. Gauge

**Текущее значение**, которое может расти и убывать.

```
jvm_memory_used_bytes{area="heap"} 134217728
http_active_requests 42
queue_size 156
```

Снимок состояния. Применять `rate()` к gauge **некорректно** — это не скорость, а текущее значение. Применяемые функции: агрегации (`avg`, `max`, `min`), `delta` (для трендов).

Naming: единица в конце — `_bytes`, `_seconds`, `_celsius`.

### 3.3. Histogram

Подсчитывает наблюдения по заранее заданным buckets. Позволяет вычислять percentile.

```
http_request_duration_seconds_bucket{le="0.1"} 8000   # быстрее 100ms
http_request_duration_seconds_bucket{le="0.5"} 9500   # быстрее 500ms
http_request_duration_seconds_bucket{le="1.0"} 9900   # быстрее 1s
http_request_duration_seconds_bucket{le="+Inf"} 10000  # все запросы
http_request_duration_seconds_sum 4521.3               # суммарное время
http_request_duration_seconds_count 10000              # количество
```

Каждый bucket — **cumulative**: «сколько запросов попало в bucket le=0.1, ИЛИ быстрее». То есть `bucket{le="0.5"}` ≥ `bucket{le="0.1"}` всегда.

PromQL `histogram_quantile(0.99, rate(metric_bucket[5m]))` находит bucket, в который попадает 99-я перцентиль, и линейно интерполирует внутри bucket'а.

**Native histograms** (Prometheus 2.40+, 2022) — новый формат: вместо predefined buckets автоматически адаптируется к данным, экспоненциально. Гораздо меньше storage, точнее quantiles, но требует переписывания клиентов.

### 3.4. Summary

Считает percentile **прямо в приложении** (через streaming algorithm типа CKMS).

```
http_request_duration_seconds{quantile="0.5"} 0.045
http_request_duration_seconds{quantile="0.99"} 0.234
http_request_duration_seconds_sum 4521.3
http_request_duration_seconds_count 10000
```

**Главная проблема**: percentile, посчитанные на каждом инстансе отдельно, **нельзя агрегировать**. Если у вас 10 instance'ов, у каждого p99=200ms, общий p99 ≠ 200ms — это математика. Histogram через PromQL `histogram_quantile(0.99, sum(rate(...)) by (le))` это решает; Summary — не может.

**Правило**: используйте Histogram. Summary — только если у вас один инстанс и нужны quantiles без backend processing.

### 3.5. Histogram vs Summary — таблица

| | Histogram | Summary |
|---|----------|---------|
| Percentile вычисляется | В Prometheus (через `histogram_quantile`) | В приложении (CKMS streaming) |
| Агрегация между инстансами | ✅ Да | ❌ Нет |
| Buckets | Настраиваются | Не нужны |
| Точность quantile | Зависит от bucket boundary distribution | Глобально настроенная (`0.99 ± 0.001`) |
| Cost в приложении | Низкий (увеличить counter в bucket) | Выше (поддерживать streaming) |
| Когда использовать | Почти всегда | Только один инстанс, точные quantile |

---

## 4. Prometheus pull model в деталях

```
┌──────────────────┐                        ┌────────────┐
│  Spring Boot App │  ◄── scrape каждые 15s ─│ Prometheus │
│  :8080           │                        │            │
│  /actuator/      │  → exposition format   │  TSDB      │
│  prometheus      │                        └─────┬──────┘
└──────────────────┘                              │ PromQL
         │                                   ┌────▼───────┐
  Service Discovery                          │  Grafana   │
  (kubernetes_sd или                         │            │
   static_configs)                           └────────────┘
```

### 4.1. Exposition format

Приложение отдаёт `/metrics` (или `/actuator/prometheus` у Spring) в plain text:

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 1500 1645123200000
http_requests_total{method="POST",status="500"} 23

# HELP jvm_memory_used_bytes Memory usage
# TYPE jvm_memory_used_bytes gauge
jvm_memory_used_bytes{area="heap"} 134217728
```

Content-Type: `text/plain; version=0.0.4` или `application/openmetrics-text` (OpenMetrics 1.0).

Очень простой формат — клиентскую библиотеку легко написать в любом языке.

### 4.2. Scrape interval

По умолчанию Prometheus scrape'ит каждые 15s. Можно настроить per-target. Trade-off:
- Чаще = больше storage, нагрузка на app, точнее графики.
- Реже = меньше storage, меньше нагрузка, более «зернистые» графики.

Большинство кластеров живут на 15–30s. Особо горячие — 5s; long-term low-frequency — 60s.

### 4.3. Service discovery

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
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        target_label: __address__
        regex: (.+)
        replacement: ${1}
```

Доступные service discovery: `kubernetes_sd` (Pods/Services/Endpoints/Ingresses/Nodes), `file_sd` (читает JSON-файл, можно динамически генерировать), `ec2_sd`/`gce_sd`/`azure_sd` (облачные), `dns_sd`, `consul_sd`, `eureka_sd`. Прометей берёт реальные targets, не нужно хардкодить IP.

### 4.4. Pod annotations для scrape

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/path: "/actuator/prometheus"
    prometheus.io/port: "8080"
```

После таких аннотаций Prometheus с дефолтной конфигурацией автоматически начнёт scrape вашего Pod.

---

## 5. Federation и long-term storage

### 5.1. Federation

Одиночный Prometheus масштабируется до сотен тысяч series и долго работает на single node. Дальше — нужна **federation**: иерархия Prometheus-серверов.

```
                 ┌─────────────────┐
                 │  Global Prom    │
                 │ (агрегированные  │
                 │   метрики)      │
                 └────────┬────────┘
                          │ scrape
            ┌─────────────┼─────────────┐
            │             │             │
       ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
       │ Cluster │   │ Cluster │   │ Cluster │
       │  Prom A │   │  Prom B │   │  Prom C │
       └─────────┘   └─────────┘   └─────────┘
```

«Global» Prometheus делает scrape `/federate` endpoint local Prometheus'ов. Берутся только агрегированные метрики (через recording rules) — не все time series, только summary.

### 5.2. Remote write — long-term storage

Prometheus сам — short-term storage (по умолчанию 15 days retention). Для long-term (months / years) используется **remote write**: Prometheus стримит каждую новую точку в external storage.

Популярные long-term:
- **Thanos**: sidecar к Prometheus, читает локальные блоки и кладёт в object storage (S3, GCS). Querier объединяет данные нескольких Prometheus + S3 в одно view.
- **Cortex / Mimir** (Grafana): multi-tenant Prometheus-compatible TSDB.
- **VictoriaMetrics**: альтернативный TSDB, дроп-ин замена Prometheus с лучшей compression.
- **InfluxDB**: отдельный TSDB, через remote write от Prometheus.

Это всё **Prometheus-compatible на уровне PromQL** — Grafana query'ит их так же, как локальный Prometheus.

---

## 6. PromQL — основные операции

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

### 6.1. Instant vector vs Range vector

- **Instant vector**: `metric_name` — одно значение на series в текущий момент.
- **Range vector**: `metric_name[5m]` — все точки за последние 5 минут.

Многие функции принимают range vector и возвращают instant. `rate(metric[5m])` — производит «скорость роста за 5 минут», возвращает одно значение.

### 6.2. rate vs irate

`rate(metric[5m])`: считает среднюю скорость роста между **первой и последней** точкой в окне 5 минут. Сглажено, не показывает spike'ов меньше окна.

`irate(metric[5m])`: считает скорость роста по **последним двум точкам** внутри окна (окно нужно как guard для query). Реактивный, показывает мгновенный rate.

Правило:
- Для **алертов** и trending — `rate`. Сглажено, не реагирует на shum.
- Для **debug live spike** — `irate`. Видим мгновение.

Никогда не используйте `irate` для long-window queries (`irate(metric[1h])`) — это даёт rate последних двух точек, окно роли не играет.

### 6.3. Aggregation operators

- `sum`, `avg`, `max`, `min`, `count` — стандартные.
- `topk(N, ...)`, `bottomk(N, ...)` — N лучших/худших.
- `quantile(0.95, ...)` — 95-я перцентиль на set series (не histogram_quantile!).

С группировкой:
- `by (label1, label2)` — агрегировать, **сохраняя** эти labels.
- `without (label1)` — агрегировать, **убирая** эти labels.

```promql
# RPS на endpoint, агрегируя инстансы
sum(rate(http_requests_total[5m])) by (uri, method)
```

### 6.4. Vector matching и joins

При операции на двух vectors PromQL делает join по labels.

```promql
# error rate per endpoint
sum(rate(http_requests_total{status=~"5.."}[5m])) by (uri)
  / sum(rate(http_requests_total[5m])) by (uri)
```

По умолчанию labels должны полностью совпадать. Иначе:

```promql
sum(rate(metric_a[5m])) by (path) 
  / on(path) group_left(method)
sum(rate(metric_b[5m])) by (path, method)
```

`on(path)` — join только по `path`. `group_left(method)` — `method` присоединяется из правого vector.

Это самая сложная часть PromQL. На первых порах достаточно простых aggregation.

### 6.5. Histogram quantile внутри

```promql
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))
```

Функция работает так:
1. Берёт `rate` каждого bucket (counter → rate).
2. Находит bucket, в который попадает 99-я перцентиль.
3. **Линейно интерполирует** в пределах bucket'а.

Точность зависит от **распределения boundaries**. Если bucket boundaries `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`, а реальный p99 = 1.7 секунды, он попадает в bucket `[1, 2.5]`. Linear interpolation внутри даст значение между 1.0 и 2.5 — точность ±750ms.

Поэтому Spring Boot Actuator из коробки `publishPercentileHistogram()` использует **более частые buckets**, обеспечивая точность ±50ms в типичной latency-zone.

Native histograms (см. §3.3) решают это полностью — boundaries автоматически растут exponentially.

---

## 7. Micrometer в Spring Boot

Micrometer — **фасад** над метриками (аналог SLF4J для логов). Приложение пишет в Micrometer API, backend (Prometheus, Datadog, CloudWatch, NewRelic) — выбирается через зависимость.

```java
@Service
public class OrderService {

    private final Counter ordersCreated;
    private final Timer orderProcessingTimer;
    private final AtomicInteger activeOrders;

    public OrderService(MeterRegistry registry) {
        // Counter — с тегами для разрезки
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

Spring Boot автоматически регистрирует базовые метрики:
- JVM: `jvm_memory_used_bytes`, `jvm_gc_pause_seconds`, `jvm_threads_live`
- HTTP server: `http_server_requests_seconds` (histogram, per endpoint/status/method)
- HTTP client: `http_client_requests_seconds`
- DataSource: `jdbc_connections_active`, `jdbc_connections_idle`
- ThreadPool: `executor_active_threads`, `executor_queue_remaining`

Многие из них доступны бесплатно через `spring-boot-starter-actuator`.

---

## 8. Cardinality bomb

Каждая **уникальная комбинация label values** = **отдельный time series** в Prometheus storage и в RAM. Это основная причина, почему Prometheus падает.

```
# ПРАВИЛЬНО: конечное множество значений
http_requests_total{method="GET", status="200"}
# method ∈ {GET, POST, PUT, DELETE} → 4
# status ∈ {200, 201, 4xx, 5xx} → 4-10
# = 16-40 time series на сервис

# ОПАСНО: userId миллиарды значений → миллиарды time series
http_requests_total{userId="12345678"}
```

### 8.1. Реальный расчёт

```
метрика http_requests_total с labels:
  method (5 values)
  status (10 values)
  endpoint (50 values)
  instance (20 Pod'ов)

= 5 × 10 × 50 × 20 = 50,000 time series

Если добавить user_id (1M пользователей):
= 50,000 × 1,000,000 = 50 миллиардов time series ❌
```

Prometheus хранит каждый time series в head block в RAM. 50 миллиардов = десятки терабайт RAM. Не работает.

### 8.2. Правила

- **Никогда не используйте в labels**: userId, email, orderId, URL без нормализации, sessionId, IP адрес.
- **Нормализуйте**: вместо `/api/orders/123` → `/api/orders/{id}`. Spring Boot Actuator делает это автоматически если правильно использовать `@PathVariable` (берёт template, не resolved value).
- **Группируйте status codes**: `2xx`, `4xx`, `5xx` вместо точных `200`, `201`, `404`.
- **Если нужен high-cardinality** (например, per-customer для biggest customers): тяните **только top-N** через recording rules или храните в other storage.

### 8.3. Где упало в реальной жизни

Типичные «cardinality killers», встречающиеся в production:
- Метрика с `user_id` в labels (миллион пользователей → миллион time series на каждую метрику).
- Метрика с full URL вместо нормализованного path (`/api/orders/{id}` vs `/api/orders/12345`).
- Метрика с auto-generated UUID как identifier (request_id, trace_id, session_id).

Лечение: убрать high-cardinality labels из метрик, перенести соответствующие данные в traces (где cardinality естественна) или в логи. Метрики предназначены для агрегатов и трендов; идентификаторы конкретных запросов — для других систем observability.

---

## 9. Recording rules и Alerting rules

### 9.1. Recording rules

Предвычисленные queries. Prometheus раз в интервал считает выражение и сохраняет как новый time series.

```yaml
groups:
  - name: app_aggregations
    interval: 30s
    rules:
      - record: app:http_request_rate_5m
        expr: sum(rate(http_server_requests_seconds_count[5m])) by (uri, method)
```

После этого `app:http_request_rate_5m` доступен как обычный metric и query'ится мгновенно (не пересчитывается).

Используются для:
- **Дашбордов** — query «как rate за 5 минут» вычисляется один раз, не каждый раз когда кто-то открывает Grafana.
- **Alerting rules** — алерт «error rate > 1%» использует предвычисленную rate, быстрее.
- **Long-term aggregation** — для federation: «среднее за час, сохрани, потом forward в global Prometheus».

Convention для naming: `level:metric_name:operation`. Например `cluster:cpu_seconds:rate1h`.

### 9.2. Alerting rules + Alertmanager

```yaml
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
          runbook: "https://wiki.example.com/runbooks/high-error-rate"

      - alert: HighP99Latency
        expr: |
          histogram_quantile(0.99,
            rate(http_server_requests_seconds_bucket[5m])
          ) > 1.0
        for: 10m
        annotations:
          summary: "p99 latency > 1 second"
```

`for: 5m` — алерт fires, только если condition выполняется **5 минут подряд**. Защита от spike'ов.

Alerting rules fires алерт → Alertmanager его получает и:
- **Группирует** (5 одинаковых алертов от 5 Pod'ов → один alert).
- **Подавляет** (silence: «эту alert игнорировать с 14:00 до 15:00»).
- **Inhibits** (если есть алерт «cluster down», подавлять все per-app алерты).
- **Маршрутизирует**: critical → PagerDuty, warning → Slack.

---

## 10. Naming conventions

Соглашения Prometheus:

```
Формат: <namespace>_<name>_<unit>
Суффиксы: 
  _total для counter
  _seconds, _ms для time (предпочитать _seconds)
  _bytes для размеров
  _info для metadata-only metric (gauge = 1)
```

Примеры:

```
http_requests_total              ✅ counter
orders_created_total             ✅ counter
jvm_memory_used_bytes            ✅ gauge с единицей
http_request_duration_seconds    ✅ histogram в секундах

httpRequests                     ❌ не camelCase
order_count                      ❌ нет _total для counter
latencyMs                        ❌ нет единицы, camelCase
order_processing_duration_ms     ⚠️ предпочитать _seconds в SI
```

OpenMetrics формализовал это:

- snake_case везде.
- Counter обязательно `_total`.
- Time — `_seconds` (SI base unit).
- Size — `_bytes`.

---

## 11. Methodology: RED, USE, Four Golden Signals

При выборе «что измерять», используйте одну из проверенных методик.

### 11.1. RED (Tom Wilkie, Weaveworks)

Для **request-driven services** (микросервисы, API):

- **Rate** — requests per second.
- **Errors** — error rate (% или per second).
- **Duration** — distribution latency (p50, p95, p99).

Просто, покрывает 95% case'ов. Стандарт для backend API мониторинга.

### 11.2. USE (Brendan Gregg, Netflix)

Для **resources** (CPU, memory, disk, network):

- **Utilization** — % использования (busy time / total time).
- **Saturation** — degree of queueing/wait (run queue length, swap usage).
- **Errors** — error count (failed allocations, disk errors).

Используется для system-level метрик — node, host, container resources.

### 11.3. Four Golden Signals (Google SRE)

- **Latency** — время ответа (включая success и failure отдельно).
- **Traffic** — load (RPS, MB/s, transactions/s).
- **Errors** — rate of failed requests.
- **Saturation** — насколько «полна» система (CPU/memory utilization, queue depth).

Самый широкий. Включает аспекты и RED, и USE.

Все три можно использовать одновременно: USE для ресурсов нод, RED для каждого сервиса, Four Golden Signals для overall view.

---

## 12. Антипаттерны

| Антипаттерн | Проблема | Как правильно |
|-------------|----------|---------------|
| High-cardinality labels (`user_id`, full URL) | Cardinality bomb — Prometheus OOM | Templated paths, ID в traces/logs |
| Summary вместо Histogram для quantile | Не агрегируется между инстансами | Histogram + `histogram_quantile` |
| Метрики без `_total` для Counter | Нарушение convention, путаница | `_total` suffix |
| `rate(gauge_metric)` | rate применим только к counter | `delta()` или абсолютное значение |
| Алерт без `for:` | Spike'ы на 30 сек поднимают on-call | `for: 5m` минимум |
| Label `instance` в alerting rule | Каждый Pod даёт свой alert, забивает Alertmanager | Агрегация через `sum by (job)` |
| Один Prometheus на огромный кластер | OOM, медленные queries | Federation, или Thanos/Mimir |
| Метрики каждые 1 секунду | 60× storage без видимой пользы | 15s default, особо горячее — 5s |
| Latency в average | Скрывает p99 issue | Percentile |
| Алерт «CPU > 80%» без понимания workload | False positives под нормальной нагрузкой | RED metrics (rate/error/latency) |
| Custom dashboard без Recording Rules | Каждое открытие — пересчёт heavy queries | Recording rules для frequent queries |
| `_seconds` в `_ms` | Disagree с конвенцией | `_seconds` всегда |
| Нет namespacing в metric names | Конфликты, hard to find | `app_name_metric_name_unit_suffix` |

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
- [Tom Wilkie — «The RED Method» (Rate, Errors, Duration)](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/) — про request-driven сервисы.
- [Google SRE — «Four Golden Signals» (Latency, Traffic, Errors, Saturation)](https://sre.google/sre-book/monitoring-distributed-systems/#xref_monitoring_golden-signals)

**Engineering posts:**
- [Cindy Sridharan — «Monitoring in the time of cloud native»](https://copyconstruct.medium.com/monitoring-in-the-time-of-cloud-native-c87c7a5bfa3e) — переход от хост-метрик к request-метрикам.
