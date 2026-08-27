# Cloud Infrastructure

---

## 1. Что такое cloud

В 2006 году Amazon Web Services запустила два сервиса, которые задним числом стали considered moment рождения публичного облака:

- **S3** (Simple Storage Service, March 2006) — REST API для object storage. Положил файл, получил URL.
- **EC2** (Elastic Compute Cloud, August 2006) — `аpi-call → виртуальная машина на чужом железе через 5 минут`. Дёшево, оплата почасовая.

До этого «infrastructure» означало: купить сервер ($5000), привезти в дата-центр ($2000/год за rack space), нанять админа. Минимум 6 месяцев между «есть идея» и «есть production-stack». EC2 за полчаса позволял запустить prototype.

Это породило индустрию. В 2026 году рынок public cloud — порядка $700B, из которых ~30% AWS, ~25% Microsoft Azure, ~15% Google Cloud, и долгий хвост (Alibaba, Oracle, IBM, Tencent).

### 1.1. NIST определение

NIST (US National Institute of Standards and Technology) в 2011 году опубликовала формальное определение облака, которым до сих пор пользуются стандарты. **5 essential characteristics**:

1. **On-demand self-service**: пользователь самостоятельно provisions resources через API/portal без человеческого вмешательства со стороны провайдера.
2. **Broad network access**: доступ через стандартные сетевые механизмы (HTTPS, SSH, RDP) с любого устройства.
3. **Resource pooling**: provider'ы пулят ресурсы для multi-tenant модели — один физический сервер обслуживает многих клиентов через виртуализацию.
4. **Rapid elasticity**: capacity масштабируется быстро и эластично; для пользователя «бесконечно».
5. **Measured service**: pay-per-use, granular billing, оплата за то, что использовано.

Эти 5 признаков — не маркетинг, а **точное определение**. «Мы запустили VMware на bare metal, есть GUI для создания VM» — это **не** cloud, потому что нет pooling в multi-tenant и нет measured service.

### 1.2. «Cloud — это чужой компьютер»

Популярный мем. Технически — да, физически серверы стоят у Amazon/Google/Microsoft. Но это сильное упрощение, потому что:

- Сервисов выше IaaS — десятки тысяч (managed БД, ML platforms, IAM, audit logs, ...). Воспроизвести их у себя — годы работы.
- Global footprint: AWS в 32 регионах × 102 AZs (на 2024). Развернуть аналог — миллиарды USD.
- Сертификация compliance (SOC2, ISO27001, FedRAMP, HIPAA) и аудиты — отдельная индустрия.

«Свой компьютер» = бесконечная operational нагрузка. Поэтому большинство команд выбирают cloud.

---

## 2. Структура облачной инфраструктуры

### 2.1. Регионы (Regions)

**Регион** — географически изолированная площадка облачного провайдера. Содержит несколько зон доступности.

```
AWS Regions:      us-east-1 (N. Virginia), eu-west-1 (Ireland), ap-southeast-1 (Singapore)
GCP Regions:      us-central1, europe-west1, asia-east1
Azure Regions:    East US, West Europe, Southeast Asia
```

**Выбор региона:**
- Близость к пользователям (латентность).
- Требования к хранению данных (GDPR — данные граждан ЕС в ЕС).
- Доступность сервисов (новые фичи появляются сначала в us-east-1).
- Стоимость (цены отличаются между регионами — eu-central-1 дороже us-east-1 на ~10%).

**Цена «дешевизны» us-east-1**: это самый старый регион AWS (с 2006), и он испытывает наибольшее число outages в истории AWS. Все cloud control plane historically ходит через us-east-1 (например, AWS IAM до сих пор имеет single point of failure там) — поэтому global outages часто начинаются с него (см. §10).

### 2.2. Availability Zones (AZ)

**Зона доступности** — физически независимый датацентр (или группа ДЦ) в регионе.

```
eu-west-1:
  ├── eu-west-1a  (ДЦ #1 — отдельное питание, охлаждение, сеть)
  ├── eu-west-1b  (ДЦ #2)
  └── eu-west-1c  (ДЦ #3)
```

**AZ изолированы друг от друга:**
- Разные источники питания.
- Разные сетевые провайдеры.
- Физическое расстояние (несколько км).
- Катастрофа в одной AZ (пожар, наводнение, выход utility power) не влияет на другие.

**High Availability через мульти-AZ:**

```
                    Load Balancer
                   /      |      \
              AZ-1a      AZ-1b    AZ-1c
            [instance] [instance] [instance]
            [RDS Main] [RDS      ] 
                        [Standby ]
```

**Latency между AZ:** ~1–2 ms (в пределах одного региона — низкая).
**Latency между регионами:** 50–300 ms (зависит от расстояния).

Очень частая ошибка newcomer'ов: запустить весь stack в одной AZ ради «упрощения», получить outage когда эта AZ упала. Production должен быть распределён минимум по двум AZ, обычно по трём.

### 2.3. Edge Locations / Points of Presence (PoP)

**Edge Location** — ближайший к пользователям CDN-узел. Не полноценный ДЦ.

```
AWS CloudFront:  600+ edge locations (Москва, Стамбул, и т.д.)
Cloudflare:      300+ городов

Пользователь → ближайший PoP → кэш → [если нет в кэше] → исходный регион
```

**Применение:** CDN, DNS (Route53), DDoS-защита (AWS Shield at edge), WAF, edge compute (Lambda@Edge, Cloudflare Workers).

---

## 3. Облачные сервисные модели

### 3.1. IaaS → PaaS → SaaS

Канонический способ объяснить — **«pizza as a service»**:

```
SaaS  "Готовая пицца в ресторане"           Gmail, Salesforce, Jira
  ↑   (повар, печь, ингредиенты, обед — всё провайдер)
PaaS  "Пицца на вынос — несёшь и греешь"    Heroku, App Engine, Beanstalk
  ↑   (готовая пицца, остальное — твоё)
IaaS  "Бакалея + готовая печь дома"         AWS EC2, GCE, Azure VMs
  ↑   (компоненты + инфраструктура — твоё)
On-Premises  "Сам сею пшеницу, держишь корову"
      (всё ваше — поля, печь, кухня)
```

Технически:

| | On-Premises | IaaS | PaaS | SaaS |
|---|---|---|---|---|
| Приложение | Вы | Вы | Вы | Провайдер |
| Runtime (JVM, Node) | Вы | Вы | Провайдер | Провайдер |
| OS | Вы | Вы | Провайдер | Провайдер |
| Виртуализация | Вы | Провайдер | Провайдер | Провайдер |
| Серверы/Сеть | Вы | Провайдер | Провайдер | Провайдер |

Где проходит граница «вашего» зависит от модели. В PaaS вам не нужно патчить OS — это делает провайдер. В IaaS вы получаете «голую» VM с любой ОС, но патчи на вас.

### 3.2. Serverless / FaaS

Следующий шаг после PaaS — отказ от долгоживущих процессов. **Function-as-a-Service**: код функции живёт «нигде», запускается по событию, оплата за миллисекунды.

```java
// AWS Lambda handler
public class OrderHandler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {
    @Override
    public APIGatewayProxyResponseEvent handleRequest(APIGatewayProxyRequestEvent event, Context context) {
        // выполняется только при вызове, billing за ms
    }
}
```

**Преимущества:**
- Нет управления серверами.
- Автомасштабирование до 0 (нет запросов — не платишь).
- Pay-per-use в миллисекундах.

**Ограничения:**
- **Cold start**: первый запрос после простоя долгий — runtime инициализируется.
  - Node.js: 50–200 ms.
  - Python: 100–300 ms.
  - Java/JVM: **1–3 seconds** (классическая проблема — JVM warmup).
  - Java с **SnapStart** или **GraalVM Native Image**: 100–500 ms.
- **Max execution time**: AWS Lambda — 15 минут.
- **Stateless**: нет shared filesystem, нет сессии в памяти.
- **Vendor lock-in**: каждый provider свой format event'a, свой SDK.

Когда использовать:
- Event-driven workload (S3 upload → resize image; Kafka message → process).
- Sporadic traffic (отчёт раз в час, который выполняется минуту).
- API endpoint с непредсказуемой нагрузкой (от 0 до 1000 RPS).

Когда **не** использовать:
- Sustained high traffic — здесь Kubernetes/EC2 дешевле.
- Long-running batch jobs — упрётся в timeout.
- Stateful workloads — нет state.

---

## 4. Self-hosted DB vs Managed DB Service

### 4.1. Self-hosted

```
Примеры: PostgreSQL на EC2, MySQL в K8s, MongoDB Operator

Вы управляете:
- Установка и обновление версий
- Репликация и failover
- Бэкапы и restore
- Мониторинг и tuning
- Патчи безопасности
- Масштабирование (добавление реплик)
```

**Плюсы:**
- Полный контроль — любые настройки, расширения, версии.
- Нет vendor lock-in.
- Дешевле при большом масштабе (нет premium за управление).
- Данные остаются на контролируемой инфраструктуре (compliance).

**Минусы:**
- Операционная нагрузка — нужна экспертиза DBA.
- Время на настройку HA, backup, мониторинг.
- Ответственность за доступность и безопасность.
- Медленнее масштабирование.

### 4.2. Managed DB (DBaaS)

```
Примеры:
AWS:    RDS (PostgreSQL, MySQL, Oracle), Aurora, DynamoDB, ElastiCache (Redis)
GCP:    Cloud SQL, Spanner, Firestore, Memorystore
Azure:  Azure SQL, Cosmos DB, Cache for Redis
```

**Провайдер управляет:**
- Репликация и автоматический failover.
- Автоматические бэкапы (Point-in-Time Recovery).
- Патчи OS и DB engine.
- Мониторинг базовых метрик.
- Масштабирование (горизонтальное с Aurora, вертикальное resize).

**Плюсы:**
- Быстрый старт (минуты до рабочей БД).
- Встроенная HA и backup.
- Меньше операционной нагрузки.
- SLA от провайдера (99.95% – 99.99%).

**Минусы:**
- Дороже (premium за управление) — особенно при больших объёмах.
- Меньше гибкости (нельзя ставить произвольные расширения, ограниченный pg_hba.conf).
- Vendor lock-in (Aurora не совместим на 100% с PostgreSQL).
- Данные у третьей стороны (compliance для строго регулируемых отраслей).
- Иногда устаревшие версии.

### 4.3. Когда что выбирать

| Сценарий | Выбор |
|----------|-------|
| Стартап/MVP, нет DBA | Managed |
| Строгий compliance (banking, healthcare, госсектор) | Self-hosted или private cloud |
| Нестандартные расширения (PostGIS, TimescaleDB) | Self-hosted |
| Multi-cloud стратегия | Self-hosted (portable) |
| Большой масштаб, есть DBA команда | Зависит от стоимости |
| Тяжёлые OLAP нагрузки | Self-hosted (Greenplum) или managed OLAP (BigQuery, Redshift) |

---

## 5. HA vs DR — два разных понятия

Часто путают. Они отвечают на разные вопросы:

- **High Availability (HA)** — «как мы переживём отказ одной части системы без перерыва?». Один из инстансов упал → трафик уходит на другие, пользователь ничего не заметил.
- **Disaster Recovery (DR)** — «как мы переживём катастрофу, выводящую из строя весь регион, ДЦ, или даже несколько ДЦ?». Это уже не «не заметил» — это «как быстро мы восстановимся».

Разница в **scope** и **expectation**:

| | HA | DR |
|---|---|---|
| Сценарий | Один Pod / VM / AZ упал | Весь регион / ДЦ недоступен |
| Реакция | Автоматическая, < секунд | Часто manual or semi-automatic |
| Цель | Без перерыва | Минимум перерыва |
| Стоимость | Включена в архитектуру | Отдельная инвестиция |

### 5.1. RPO и RTO

Главные метрики для DR:

- **RTO (Recovery Time Objective)** — сколько времени можно быть down? «Через сколько мы вернёмся?»
  - Critical service: RTO = минуты.
  - Internal tools: RTO = часы.
  - Бэкап-офис: RTO = дни.

- **RPO (Recovery Point Objective)** — сколько данных можно потерять? «За какой период данные мы готовы потерять?»
  - Banking transaction: RPO = 0 (синхронная репликация).
  - User-generated content: RPO = минуты (async replication).
  - Logs / analytics: RPO = часы (daily backup).

Чем строже RPO/RTO — тем дороже архитектура.

### 5.2. DR-стратегии

AWS Well-Architected Framework выделяет 4 уровня:

```
                  RPO/RTO ─────────►  стоимость
Backup & Restore  hours/hours          $          бэкапы в S3 + восстановление
Pilot Light       minutes/hours        $$         core стек в standby, scale при DR
Warm Standby      seconds/minutes      $$$        полный стек в other region, минимальные replicas
Multi-Site Active-Active  0/0          $$$$       full duplicate, traffic routing
```

- **Backup & Restore**: бэкапы лежат в S3 / cross-region. При DR: восстановить из бэкапа в новом регионе. RTO часы, RPO часы.
- **Pilot Light**: «горячий минимум» — БД-реплика, шаблоны IaC. При DR: scale up app instances. RTO 30 минут, RPO минуты.
- **Warm Standby**: уменьшенная копия prod в DR-регионе. При DR: scale up до полной capacity. RTO 5–10 минут, RPO секунды.
- **Active-Active**: оба региона принимают трафик. При DR: routing к выжившему. RTO секунды, RPO ~0. Но: требует conflict resolution для данных, eventual consistency.

Выбор зависит от business cost downtime. Для checkout-сервиса банка downtime = $X/минута, и Active-Active может окупиться. Для blog about cats — Backup & Restore достаточно.

---

## 6. Cloud-native patterns

### 6.1. Stateless services

Сервис не хранит state in-memory или на локальном диске. Любой instance взаимозаменяем. Все state — внешний (БД, Redis, S3).

Преимущества:
- Auto-scaling работает (scale up = просто запустить ещё instance).
- Failure resilience (упавший instance — потеря только in-flight request).
- Rolling updates — без проблем.

«Sticky sessions» (трафик одного пользователя всегда на один instance) — anti-pattern. Используется как костыль, когда сервис не stateless. Альтернатива: session в Redis.

### 6.2. Immutable infrastructure

Не **изменять** работающую инфраструктуру (apt-upgrade, docker exec, kubectl edit). Каждое изменение = новый image / новая конфигурация / новый deploy. Старое — снести.

Преимущества:
- Воспроизводимость (что в Git — то в проде).
- Audit trail.
- Rollback тривиален.
- Нет «снежинок» (нод/инстансов с уникальной историей правок).

Pattern: Packer/Docker для images, Terraform/Pulumi для infra, GitOps (Argo CD/Flux) для K8s манифестов.

### 6.3. Externalised state

State должно жить в managed service'ах, не в коде приложения:
- Сессии / cache → Redis / Memcached.
- Files → S3.
- Search index → Elasticsearch.
- Time series → InfluxDB / TimescaleDB.
- Configuration → Consul / Etcd / ConfigMap.

Это позволяет scaling, replication, backup делать на уровне specialised service.

### 6.4. Fail-fast

При невозможности обслужить request — **сразу** отвечать с error (5xx) или timeout. Не «попытаться, потом долго ждать, потом сдаться».

Реализация: timeouts на каждом RPC, circuit breakers, bulkheads. См. [`../../microservices/theory/FAILURE_ISOLATION.md`](../../microservices/theory/FAILURE_ISOLATION.md).

### 6.5. Blast radius minimization

Compromise одного компонента не должен compromise остальных. Это про разделение:
- IAM least privilege (один service account ≠ root в кластере).
- NetworkPolicy в Kubernetes.
- Per-service Vault paths.
- Separate AWS accounts per team / environment.

---

## 7. Скрытая стоимость cloud

Базовый расчёт стоимости (EC2 + RDS + S3) обычно выглядит привлекательно. Реальный bill включает много линий, которые newcomer не предвидит.

### 7.1. Egress traffic — главный сюрприз

Pricing у AWS / GCP / Azure:
- **Inbound** (трафик в облако) — обычно бесплатно.
- **Inter-AZ** (внутри региона между AZ) — $0.01/GB.
- **Inter-region** — $0.02/GB.
- **Outbound в интернет** — $0.05–0.09/GB.

Если вы стримите видео или раздаёте big files (CDN), egress становится **главной line item** в bill. Часто 50%+ от общего AWS bill.

Альтернативы:
- **CloudFront / Cloudflare** — egress через CDN дешевле, чем напрямую из S3.
- **Egress-free zones** некоторых провайдеров (Cloudflare R2 = S3-compatible без egress fee).
- **Repatriation** — обратно on-prem для тех, кто упирается в egress (см. §11.4).

### 7.2. NAT Gateway

Очень часто #1 в bill для команд, которые этого не предвидели. NAT Gateway в AWS:
- $0.045/hour ($32/mes).
- $0.045/GB обработанных данных.

Если ваши Pods в private subnet ходят в интернет (pull Docker images из Docker Hub, обращение к external API) — каждый GB через NAT. Полтерабайта в день — $675/мес только на NAT.

Альтернатива: VPC Endpoints для AWS services (S3, ECR, Secrets Manager — не идут через NAT).

### 7.3. EBS snapshots и backups

EBS snapshot — это incremental backup. Звучит дёшево, но: тысячи RDS instance'ов × ежедневный snapshot × 30 дней retention = терабайты storage = сотни USD/мес.

### 7.4. KMS API calls

KMS используется для encryption Secret / EBS / RDS / S3 SSE-KMS. KMS API имеет cost-per-call (несколько $ per million). Если у вас много secrets pull'ов из Secrets Manager — bill растёт.

### 7.5. Premium support

AWS Business Support — $100/mes + 10% от bill (минимум $100/mes). На bill $50K = $5K/mes за support. Большая статья.

### 7.6. Cross-AZ traffic

Каждый Pod-to-Pod call между AZ = $0.01/GB в обе стороны. Микросервисы с chatty interface через AZ могут давать значительный bill. AWS Route 53 has zonal routing для уменьшения.

---

## 8. Compliance и регуляторика

### 8.1. GDPR (EU, 2018)

Главное практическое: **data residency**. Данные граждан EU должны храниться **в EU** (или в стране с adequacy decision — UK, Switzerland, Israel). Это влияет на выбор cloud-региона.

GDPR требования:
- Право на удаление (data subject deletion).
- Право на portability (export).
- Privacy by design (минимизация).
- Breach notification в 72 часа.
- Data Processing Agreement (DPA) с провайдерами.

Все major cloud providers это поддерживают и подписывают DPA. Но: USA Cloud Act (2018) позволяет US-власти запросить данные из европейских ДЦ если provider — US company. Это породило идею **sovereign cloud** — EU-controlled providers (OVH, Gaia-X initiative).

### 8.2. HIPAA (US, healthcare)

Protects PHI (Protected Health Information). Cloud providers поддерживают HIPAA-eligible services (не все services включены — список HIPAA Eligible Services AWS).

Требования: encryption at rest и in transit, audit logging, BAA (Business Associate Agreement) с провайдером.

### 8.3. PCI-DSS (карты)

Для систем, обрабатывающих кредитные карты. Уровни 1–4 (по volume transactions/year). Требует:
- Network segmentation.
- Quarterly vulnerability scans.
- Yearly penetration test.
- Encryption всего PAN.

### 8.4. SOC 2

«Trust services criteria»: security, availability, processing integrity, confidentiality, privacy. Type I — audit моментального состояния, Type II — audit процессов за 6+ месяцев.

Не required by law, но enterprise customers часто требуют SOC 2 report как ditio для покупки.

### 8.5. Sovereign cloud

Альтернатива американским provider'ам для тех, кто хочет независимости от US regulation:
- **OVH** (Франция).
- **Scaleway** (Франция).
- **Gaia-X** (initiative EU для federated cloud).
- **Russian Cloud Computing** (Россия).
- **Alibaba Cloud** (China-controlled).

Зачем: data sovereignty, защита от US Cloud Act, регуляторные требования в strict отраслях.

---

## 9. Vendor lock-in — реальные примеры

«Cloud-native = lock-in». Это не absolute, но реальный risk. Примеры, где migration трудна:

### 9.1. AWS Aurora ≠ PostgreSQL

Aurora совместим с PostgreSQL на wire protocol — приложение использует обычный JDBC. Но **не fully feature-compatible**:
- Нет logical replication.
- Backups делает Aurora-specific way, не pg_basebackup.
- Performance characteristics отличаются (Aurora storage engine).
- Некоторые extensions недоступны.

Migration с Aurora на vanilla PG — недели работы, тестирования. Multiple companies (Notion, Linear) делали это публично.

### 9.2. DynamoDB ≠ Cassandra

Оба — distributed NoSQL key-value. Идея похожая, но:
- DynamoDB: managed, partition key + sort key, strong/eventual consistency selectable.
- Cassandra: self-hosted, partition key + clustering keys, tunable consistency.
- Indexing разный.
- Pricing model радикально разный.

Migration — переписывание data layer почти с нуля.

### 9.3. Cosmos DB (Azure)

Multi-model (key-value, document, graph, column-family) с unified API. Главная фича: globally distributed, multi-master. Конкурентов в open-source — нет (CockroachDB closest, но другая модель).

### 9.4. Cloud-native сервисы без open-source аналогов

- **AWS Lambda** ≠ OpenFaaS / Knative (последние существуют, но без operational полноты AWS).
- **GCP BigQuery** — массивно-параллельный SQL — нет настоящих опен-сорс эквивалентов (TrinoDB ближе, но другая модель).
- **AWS Step Functions** — visual workflow engine — open-source альтернативы (Temporal) есть, но не drop-in.

Если build heavily на these — migration cost растёт.

---

## 10. Battle stories

### 10.1. AWS S3 outage (Feb 2017)

28 февраля 2017 года один из инженеров S3 в us-east-1 пытался диагностировать billing issue. Запустил команду с **typo** — параметр capacity вместо subset нод вывел из обслуживания **всю** S3 capacity региона. Восстановление потребовало hours.

Что упало вместе с S3: половина интернета.
- Trello, Quora, GitHub, Slack, Medium, Coursera — все использовали S3 для assets.
- Многие сторонние сервисы, использующие S3 через third-parties — даже не знали об этом, но тоже упали.

Уроки:
- **Single mistake** в one region может cascade на множество сервисов.
- **us-east-1 — критическая зависимость** глобального интернета.
- **IaC с peer-review** важнее, чем интерактивный `aws s3 ...`.

### 10.2. AWS us-east-1 outage (Dec 2021)

Декабрь 2021, проблема в internal AWS network в us-east-1. Cascade на:
- Disney+, Netflix (CDN through us-east-1 control plane).
- Slack.
- Robinhood, Coinbase.
- Множество SaaS.

Что сделалось public: на 5+ часов невозможно было даже **открыть AWS Console** для другого региона, потому что IAM API в us-east-1 (single point of authentication для global AWS).

Уроки:
- **Blast radius** одного региона огромен.
- **Global services have hidden us-east-1 dependency** (IAM, CloudFront control, Route 53).
- Real disaster recovery — multi-region, не просто multi-AZ.

### 10.3. Cloudflare global outage (July 17, 2020)

Bad configuration deployed to all PoPs за seconds. Cloudflare globally недоступен ~30 минут. Множество сайтов, использующих Cloudflare как DNS / CDN, — недоступны.

Root cause: human error в config + не было staged rollout (canary-deploy для core network configuration).

Уроки:
- **Staged rollouts** для всего, что меняет production globally. Никаких «push to all».
- **Automated rollback** при metric anomaly.

### 10.4. Knight Capital (August 2012) — $440M за 45 минут

Не cloud — но caution tale про deploy hygiene. Knight Capital — financial trading firm. Они деплоили новую алгоритмическую систему на 8 servers. На 7 — задеплоили, на 1 — нет (deployment automation glitch). Старый код на 8-м server'е под определёнными условиями превращался в crazy buying machine.

Когда рынки открылись, 8-й сервер пошёл buy stocks по any price. За 45 минут проиграли $440 миллионов. Компания обанкротилась.

Уроки:
- **Atomicity deployment**: либо все nodes на новой версии, либо все на старой. Не середина.
- **Feature flags** для critical features, deploy ≠ enable.
- **Automated checks** что deployment everywhere passed.

---

## 11. Преимущества и недостатки cloud

### 11.1. Преимущества

**Elasticity (Эластичность):** масштабировать за минуты, платить только за использование.

```
Black Friday: x10 серверов за 5 минут → трафик прошёл → scale back → платим за часы, не за год
```

**OPEX vs CAPEX:** операционные расходы (OPEX) вместо капитальных (CAPEX). Нет покупки серверов на 5 лет. Это критично для бухгалтерии и cash flow.

**Managed Services:** S3 хранилище, SQS очереди, ElastiCache, LoadBalancer — не нужно поднимать самому. Команда фокусируется на business logic.

**Глобальный охват:** развернуть в новом регионе за часы (без физических серверов).

**Reliability:** HA из коробки, SLA провайдера, географическое резервирование.

**Time to Market:** инфраструктура из кода (Terraform), CI/CD, автоматизация ускоряет разработку.

### 11.2. Недостатки

**Стоимость при росте:** при большом масштабе cloud дороже own hardware. Netflix тратит ~$100M/год на AWS.

**Vendor Lock-in:** Proprietary сервисы (DynamoDB, Aurora, Lambda) → сложно мигрировать (см. §9).

**Непредсказуемые расходы:** неправильно настроенный autoscaling → неожиданный счёт.

**Latency:** для latency-critical приложений (HFT) — cloud хуже co-location.

**Compliance и суверенитет данных:** в некоторых отраслях данные нельзя хранить за рубежом или у третьей стороны (см. §8).

**Shared Tenancy:** noisy neighbor — другие клиенты на тех же физических серверах могут влиять на производительность (решение: Dedicated Instances/Hosts).

**Outages у провайдера:** us-east-1 down → всё, что там → недоступно (см. §10.1, §10.2).

### 11.3. Cloud repatriation

В 2021–2024 наблюдается тренд **repatriation** — отъезда от cloud обратно к own hardware. Известные кейсы:

- **37signals / Basecamp** (David Heinemeier Hansson): репатриация всё с AWS, сэкономили $1M/год.
- **Dropbox**: ушли с S3 на собственное storage в 2015, сэкономили $75M за 2 года.
- **Various enterprises**: hybrid cloud — критическое on-prem, остальное в облаке.

Andreessen-Horowitz опубликовала пост «The Cost of Cloud, a Trillion Dollar Paradox» (2021), аргументирующий что для **late-stage** companies cloud может быть дороже on-prem на $X miliards collectively.

Это не «cloud не нужен» — это «на определённом scale математика меняется».

---

## 12. Infrastructure as Code

```hcl
# Terraform пример
resource "aws_rds_instance" "postgres" {
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.medium"
  multi_az          = true          # автоматический failover между AZ
  backup_retention_period = 7
}
```

Инфраструктура — код: версионирование в Git, code review, воспроизводимость.

### 12.1. State file

Terraform хранит **state file** — JSON-снимок того, что he reckon существует в реальности. Когда вы запускаете `terraform apply`, он сравнивает state file с реальным состоянием и применяет diff.

State file **критичен**:
- Содержит ID всех created resources.
- Может содержать **секреты** (passwords) в plain text.
- Конкурентные `terraform apply` ломают state.

**Best practices**:
- State в **remote backend** (S3, GCS, Azure Blob, Terraform Cloud), не в локальном файле.
- **State locking** (DynamoDB / PostgreSQL backend) — конкурентные apply блокируются.
- **Encryption** state at rest.
- **State не в Git** — там может быть всё содержимое БД в открытом виде.

### 12.2. Drift detection

«Drift» — расхождение между Terraform state и real infrastructure. Произошло, когда:
- Кто-то изменил resource вручную через AWS console.
- Resource был удалён вне Terraform.
- Что-то изменилось автоматически (auto-scaling).

`terraform plan` всегда покажет drift. Регулярный CI job, запускающий `terraform plan` против prod и сигнализирующий о drift'е — хорошая practice.

### 12.3. Альтернативы Terraform

- **Pulumi**: IaC на TypeScript / Python / Go / .NET — для тех, кто хочет программную abstraction (loops, functions, libraries).
- **AWS CDK / CDK8s**: тоже programming languages, но генерирует CloudFormation / Kubernetes YAML.
- **CloudFormation**: AWS-native, JSON/YAML, не multi-cloud.
- **Crossplane**: IaC через Kubernetes API — desired-state cloud resources как K8s ресурсы.

---

## 13. Multi-region deployment patterns

### 13.1. Active-Passive (Disaster Recovery)

```
Primary region (eu-west-1) → все запросы
Standby region (eu-central-1) → реплика, нет трафика
RTO: минуты/часы, RPO: секунды (зависит от репликации)
```

Trafik routing — DNS (Route 53 health checks). При failure primary — DNS меняет на secondary в течение TTL.

### 13.2. Active-Active

```
Обе/все регионы принимают трафик
GeoDNS/Global Load Balancer направляет к ближайшему
Требует: conflict resolution для данных, eventual consistency
RTO: секунды, RPO: ~0
```

Сложно: data write conflicts (один customer обновляет profile в EU, одновременно в US — что побеждает?). Решения:
- Last-write-wins (простой, теряет данные).
- CRDTs (conflict-free replicated data types).
- Globally consistent DB: **Spanner** (Google), **CockroachDB**, **YugabyteDB**, **Aurora Global Database**.

### 13.3. Globally distributed databases

- **Google Spanner**: глобальный strong consistency через TrueTime (atomic clocks + GPS). Pay-per-use, доступен только в GCP.
- **CockroachDB**: open-source Spanner-like. Может self-hosted или managed (Cockroach Cloud).
- **YugabyteDB**: PostgreSQL-compatible distributed SQL.
- **Aurora Global Database**: AWS managed multi-region PostgreSQL/MySQL.

Эти DB сами решают conflict resolution и consistency. Цена: latency на write (geographic distance — speed of light).

---

## Источники

**Cloud architecture frameworks (must-read):**
- [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html) — 6 столпов: Operational Excellence, Security, Reliability, Performance, Cost, Sustainability.
- [Google Cloud Architecture Framework](https://cloud.google.com/architecture/framework)
- [Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/)
- [Site Reliability Engineering (Google, free book)](https://sre.google/books/)

**Books:**
- *Cloud Native Patterns* (Cornelia Davis, Manning 2019) — паттерны cloud-native приложений.
- *Designing Distributed Systems* (Brendan Burns, O'Reilly 2018, [free PDF от Microsoft](https://azure.microsoft.com/en-us/resources/designing-distributed-systems/)) — Sidecar, Ambassador, Adapter, master-elected leader, work-queue.
- *Architecting for Scale*, 2nd ed. (Lee Atchison, O'Reilly 2020).

**Postmortems / battle stories:**
- [AWS S3 outage (Feb 2017)](https://aws.amazon.com/message/41926/) — typo в команде debugger выключил больше capacity, чем планировалось.
- [AWS us-east-1 outage (Dec 2021)](https://aws.amazon.com/message/12721/) — internal AWS network issue.
- [Cloudflare global outage (2020-07-17)](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/) — bad config rolled out to all PoPs за секунды.
- [Werner Vogels — «All Things Distributed»](https://www.allthingsdistributed.com/) — блог CTO Amazon.

**Decision frameworks:**
- [Martin Fowler — «Don't get locked up into avoiding lock-in»](https://martinfowler.com/articles/oss-lockin.html) — vendor lock-in vs cost of абстракции.
- [a16z — «The Cost of Cloud, a Trillion Dollar Paradox»](https://a16z.com/the-cost-of-cloud-a-trillion-dollar-paradox/) — почему крупные компании уезжают с cloud обратно.
