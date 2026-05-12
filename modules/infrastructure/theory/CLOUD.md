# Cloud Infrastructure

## Структура облачной инфраструктуры

### Регионы (Regions)

**Регион** — географически изолированная площадка облачного провайдера. Содержит несколько зон доступности.

```
AWS Regions:      us-east-1 (N. Virginia), eu-west-1 (Ireland), ap-southeast-1 (Singapore)
GCP Regions:      us-central1, europe-west1, asia-east1
Azure Regions:    East US, West Europe, Southeast Asia
```

**Выбор региона:**
- Близость к пользователям (латентность)
- Требования к хранению данных (GDPR — данные граждан ЕС в ЕС)
- Доступность сервисов (новые фичи появляются сначала в us-east-1)
- Стоимость (цены отличаются между регионами)

### Availability Zones (AZ)

**Зона доступности** — физически независимый датацентр (или группа ДЦ) в регионе.

```
eu-west-1:
  ├── eu-west-1a  (ДЦ #1 — отдельное питание, охлаждение, сеть)
  ├── eu-west-1b  (ДЦ #2)
  └── eu-west-1c  (ДЦ #3)
```

**AZ изолированы друг от друга:**
- Разные источники питания
- Разные сетевые провайдеры
- Физическое расстояние (км)
- Катастрофа в одной AZ не влияет на другие

**High Availability через мульти-AZ:**
```
                    Load Balancer
                   /      |      \
              AZ-1a      AZ-1b    AZ-1c
            [instance] [instance] [instance]
            [RDS Main] [RDS      ] 
                        [Standby ]
```

**Latency между AZ:** ~1-2ms (в пределах одного региона — низкая).  
**Latency между регионами:** 50-300ms (зависит от расстояния).

### Edge Locations / Points of Presence (PoP)

**Edge Location** — ближайший к пользователям CDN-узел. Не полноценный ДЦ.

```
AWS CloudFront:  400+ edge locations (Москва, Стамбул, и т.д.)
Cloudflare:      300+ города

Пользователь → ближайший PoP → кэш → [если нет в кэше] → исходный регион
```

**Применение:** CDN, DNS (Route53), DDoS-защита (AWS Shield at edge), WAF.

---

## Облачные сервисы: типы

### IaaS → PaaS → SaaS

```
SaaS  Gmail, Salesforce, Jira
  ↑   (провайдер управляет всем)
PaaS  Heroku, Google App Engine, AWS Elastic Beanstalk
  ↑   (провайдер: OS, runtime, middleware)
IaaS  AWS EC2, Google Compute Engine, Azure VMs
  ↑   (провайдер: ЦОД, сеть, питание, виртуализация)
On-Premises
      (всё ваше)
```

| | On-Premises | IaaS | PaaS | SaaS |
|---|---|---|---|---|
| Приложение | Вы | Вы | Вы | Провайдер |
| Runtime | Вы | Вы | Провайдер | Провайдер |
| OS | Вы | Вы | Провайдер | Провайдер |
| Виртуализация | Вы | Провайдер | Провайдер | Провайдер |
| Серверы/Сеть | Вы | Провайдер | Провайдер | Провайдер |

### Serverless / FaaS

AWS Lambda, Google Cloud Functions, Azure Functions.

```java
// AWS Lambda handler
public class OrderHandler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {
    @Override
    public APIGatewayProxyResponseEvent handleRequest(APIGatewayProxyRequestEvent event, Context context) {
        // выполняется только при вызове, billing за ms
    }
}
```

**Преимущества:** нет управления серверами, автомасштабирование до 0, pay-per-use.  
**Ограничения:** cold start, max execution time (15 мин для Lambda), stateless.

---

## Self-hosted DB vs Managed DB Service

### Self-hosted (на своих серверах или IaaS)

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
- Полный контроль — любые настройки, расширения, версии
- Нет vendor lock-in
- Дешевле при большом масштабе (нет premium за управление)
- Данные остаются на контролируемой инфраструктуре (compliance)

**Минусы:**
- Операционная нагрузка — нужна экспертиза DBA
- Время на настройку HA, backup, мониторинг
- Ответственность за доступность и безопасность
- Медленнее масштабирование

### Managed DB (DBaaS)

```
Примеры:
AWS:    RDS (PostgreSQL, MySQL, Oracle), Aurora, DynamoDB, ElastiCache (Redis)
GCP:    Cloud SQL, Spanner, Firestore, Memorystore
Azure:  Azure SQL, Cosmos DB, Cache for Redis
```

**Провайдер управляет:**
- Репликация и автоматический failover
- Автоматические бэкапы (Point-in-Time Recovery)
- Патчи OS и DB engine
- Мониторинг базовых метрик
- Масштабирование (горизонтальное с Aurora, вертикальное resize)

**Плюсы:**
- Быстрый старт (минуты до рабочей БД)
- Встроенная HA и backup
- Меньше операционной нагрузки
- SLA от провайдера (99.95% - 99.99%)

**Минусы:**
- Дороже (premium за управление) — особенно при больших объёмах
- Меньше гибкости (нельзя ставить произвольные расширения, ограниченный pg_hba.conf)
- Vendor lock-in (Aurora не совместим на 100% с PostgreSQL)
- Данные у третьей стороны (compliance для строго регулируемых отраслей)
- Иногда устаревшие версии

### Когда что выбирать

| Сценарий | Выбор |
|----------|-------|
| Стартап/MVP, нет DBA | Managed |
| Строгий compliance (banking, healthcare, госсектор) | Self-hosted или private cloud |
| Нестандартные расширения (PostGIS, TimescaleDB) | Self-hosted |
| Multi-cloud стратегия | Self-hosted (portable) |
| Большой масштаб, есть DBA команда | Зависит от стоимости |
| Тяжёлые OLAP нагрузки | Self-hosted (Greenplum) или managed OLAP (BigQuery, Redshift) |

---

## Преимущества и недостатки Cloud

### Преимущества

**Elasticity (Эластичность):** масштабировать за минуты, платить только за использование.
```
Black Friday: x10 серверов за 5 минут → трафик прошёл → scale back → платим за часы, не за год
```

**Опекс vs Капекс:** операционные расходы (OPEX) вместо капитальных (CAPEX). Нет покупки серверов на 5 лет.

**Managed Services:** S3 хранилище, SQS очереди, ElastiCache, LoadBalancer — не нужно поднимать самому.

**Глобальный охват:** развернуть в новом регионе за часы (без физических серверов).

**Reliability:** HA из коробки, SLA провайдера, географическое резервирование.

**Time to Market:** инфраструктура из кода (Terraform), CI/CD, автоматизация ускоряет разработку.

### Недостатки

**Стоимость при росте:** при большом масштабе cloud дороже own hardware.
```
Пример: Netflix тратит ~$100M/год на AWS. Некоторые компании repatriate обратно к iron.
```

**Vendor Lock-in:** Proprietary сервисы (DynamoDB, Aurora, Lambda) → сложно мигрировать.

**Непредсказуемые расходы:** неправильно настроенный autoscaling → неожиданный счёт.

**Latency:** для latency-critical приложений (HFT) — cloud хуже co-location.

**Compliance и суверенитет данных:** в некоторых отраслях данные нельзя хранить за рубежом или у третьей стороны.

**Shared Tenancy:** noisy neighbor — другие клиенты на тех же физических серверах могут влиять на производительность (решение: Dedicated Instances/Hosts).

**Outages у провайдера:** us-east-1 down → всё, что там → недоступно. История: AWS 2021 outage вывел из строя трети интернета.

---

## Cloud-Native Паттерны

### Horizontal Scaling vs Vertical Scaling

```
Vertical (Scale Up):   увеличить CPU/RAM одной машины (предел: самый большой инстанс)
Horizontal (Scale Out): добавить больше машин (теоретически неограничено)

Cloud → предпочтительно Horizontal: stateless сервисы + auto scaling group
```

### Auto Scaling

```
AWS Auto Scaling Group: Target tracking (CPU 70%) → добавить/убрать инстансы
K8s HPA: replicas: 2..10, targetCPUUtilizationPercentage: 70
```

### Multi-Region Deployment

```
Active-Passive (Disaster Recovery):
  Primary region → все запросы
  Standby region → реплика, нет трафика
  RTO: минуты/часы, RPO: секунды (зависит от репликации)

Active-Active:
  Обе/все регионы принимают трафик
  GeoDNS/Global Load Balancer направляет к ближайшему
  Требует: conflict resolution для данных, eventual consistency
  RTO: секунды, RPO: ~0
```

### Infrastructure as Code

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

Инфраструктура — код: версионирование, code review, воспроизводимость.

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
- [AWS S3 outage (Feb 2017)](https://aws.amazon.com/message/41926/) — typo в команде debugger выключил больше capacity, чем планировалось; половина интернета лежала несколько часов. Каноническая иллюстрация почему IaC с peer-review важнее интерактивного `aws s3 ...`.
- [AWS us-east-1 outage (Dec 2021)](https://aws.amazon.com/message/12721/) — internal AWS network issue → Disney+, Netflix, Slack лежали; иллюстрация blast radius у одного региона.
- [Cloudflare global outage (2020-07-17)](https://blog.cloudflare.com/cloudflare-outage-on-july-17-2020/) — bad config rolled out to all PoPs за секунды; staged rollout уроки.
- [Werner Vogels — «All Things Distributed»](https://www.allthingsdistributed.com/) — блог CTO Amazon, многолетние разборы реальных incident'ов и решений.

**Decision frameworks:**
- [Martin Fowler — «Don't get locked up into avoiding lock-in»](https://martinfowler.com/articles/oss-lockin.html) — vendor lock-in vs cost ofабстракции.
- [Cornell — «Cloud Repatriation» (Andreessen-Horowitz, «The Cost of Cloud, a Trillion Dollar Paradox»)](https://a16z.com/the-cost-of-cloud-a-trillion-dollar-paradox/) — почему крупные компании уезжают с cloud обратно.
