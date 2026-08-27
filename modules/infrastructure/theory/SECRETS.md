# Секреты: где лежит пароль и кто может его прочитать

> **Какую проблему решает.** Orders API ходит в управляемый PostgreSQL — значит, где-то есть
> пароль. Положить его в `application.properties` нельзя: файл в git, а история git вечна. В
> переменную окружения — видно через `docker inspect` и `/proc/<pid>/environ`. В Kubernetes
> Secret — это base64, и он читается одной командой. Файл о том, где пароль лежать может и
> какой ценой.
> **Кому это надо.** Тому, чьё приложение подключается хоть к чему-нибудь по паролю; тому, кто
> пишет Terraform и не хочет оставить ключ в состоянии; и тому, кого спросят «а где лежит первый
> секрет» — вопрос, на котором обрывается большинство ответов.
> **Когда НЕ надо.** Vault — это ещё одна система, которую надо эксплуатировать, у которой есть
> собственная задача распечатывания и собственный отказ; для одного приложения в облаке роль IAM
> решает ту же задачу без него. Здесь также не про аутентификацию **пользователей**: хранение
> паролей учётных записей (bcrypt, Argon2id) —
> [`system-design/identity_providers.md`](../../system-design/theory/identity_providers.md),
> а SPIFFE и удостоверение нагрузки в service mesh —
> [`microservices/SERVICE_IDENTITY.md`](../../microservices/theory/SERVICE_IDENTITY.md).
> В этом файле mTLS разбирается только как транспортный механизм.

Сквозной пример модуля: Orders API — три экземпляра в Kubernetes, управляемый PostgreSQL снаружи
кластера. В этом файле он существует как приложение, которому нужен пароль к базе: откуда он
берётся при старте пода и что увидит тот, кто получил доступ к кластеру.

## Проблема: что такое секрет и от кого мы защищаемся

Секрет — любые данные, компрометация которых позволяет получить несанкционированный доступ:
пароли к БД, API-ключи сторонних сервисов, TLS-сертификаты, токены CI/CD, OAuth client_secret.

**Угрозы, от которых нужно защититься:**
- Секрет попал в git (history хранится вечно — даже после удаления файла)
- Секрет попал в лог (`log.info("Connecting with password={}", pass)`)
- Секрет виден через `docker inspect` или `ps aux` (env variables процесса)
- Утечка Terraform state файла, который лежит в S3 без шифрования
- Insider threat — разработчик, у которого нет необходимости видеть production-секреты

---

## Принцип: конвертное шифрование

Это базовый принцип всех secrets managers. Прямое шифрование большого объёма данных одним ключом неудобно — ключ сложно ротировать. Вместо этого:

```
Data Key (DEK) — шифрует сами данные (AES-256)
Key Encryption Key (KEK) — шифрует DEK (хранится в KMS)

Хранится:
  encrypted(DEK) + encrypted_with_DEK(secret_value)

Для расшифровки:
  1. KMS расшифровывает DEK (это единственное, что умеет KMS)
  2. DEK расшифровывает данные локально
```

Именно так работают Vault, AWS KMS, GCP KMS. При ротации ключа достаточно перешифровать только DEK — не все данные.

---

## Задача первого секрета: чем аутентифицироваться, чтобы получить пароль

Это главный вопрос. Чтобы получить пароль из Vault, нужна аутентификация в Vault. Чтобы аутентифицироваться — нужен какой-то credential. Где он лежит?

**Плохое решение:** положить Vault token в переменную окружения в коде или Dockerfile.

**Правильные решения по уровням:**

### Уровень 1 — Cloud IAM (лучшее, zero-secret)

EC2 instance, ECS task, K8s pod могут иметь IAM роль. Облако само выдаёт временные учётные данные через Instance Metadata Service — ни одного секрета не нужно хранить.

```
EC2 с IAM role "app-role"
  → GET http://169.254.169.254/latest/meta-data/iam/security-credentials/app-role
  ← { AccessKeyId, SecretAccessKey, Token, Expiration }  // автоматически, без секретов
  → приложение читает секрет из AWS Secrets Manager используя эти credentials
```

Никакого открытого секрета нет нигде. IAM role назначается инфраструктурой, не кодом.

### Уровень 2 — Kubernetes Service Account (для K8s)

Каждый под автоматически получает service account token, примонтированный как файл. Vault умеет аутентифицировать по этому токену:

```
Pod запускается
  → K8s автоматически монтирует /var/run/secrets/kubernetes.io/serviceaccount/token
  → Vault Agent читает этот токен
  → POST vault/auth/kubernetes/login { jwt: <token>, role: "my-app" }
  → Vault проверяет подпись у K8s API Server
  → выдаёт Vault token с нужными политиками
  → Vault Agent получает секреты и кладёт в файлы
  → приложение читает /secrets/db_password
```

Ни одного вшитого секрета. Корень доверия — K8s cluster identity.

### Уровень 3 — CI/CD protected variables (для Terraform/pipelines)

Секрет существует в одном месте — в CI/CD системе (GitLab CI protected variable, GitHub Actions secret). В git его нет.

```
GitLab CI:
  Settings → CI/CD → Variables → DB_PASSWORD (protected, masked)

Terraform apply в pipeline получает через env var:
  TF_VAR_db_password = $DB_PASSWORD  // из CI, не из кода
```

Разработчик не видит значение (masked). В лог не попадает. В git не попадает.

---

## HashiCorp Vault — концептуально

Vault — это не просто хранилище «ключ-значение» с паролем. Три ключевые идеи:

### Идея 1: Seal/Unseal — шифрование master key

Vault хранит все секреты зашифрованными (AES-256-GCM). Ключ шифрования — master key. Сам master key разбит на N шардов по алгоритму Shamir's Secret Sharing: нужно K из N частей, чтобы восстановить.

Это решает проблему: даже если атакующий получит storage backend (Consul, S3) — данные нечитаемы. Vault нужно явно "распечатать" при каждом старте.

В production используют auto-unseal — master key шифруется в AWS KMS / Azure Key Vault, unseal происходит автоматически. Тогда физический контроль над облачным KMS — это и есть корень доверия.

### Идея 2: Auth methods — несколько способов аутентификации

Vault не диктует, как именно приложение должно себя идентифицировать. Разные auth methods для разных контекстов:

| Auth method | Кто использует | Корень доверия |
|-------------|----------------|----------------|
| Kubernetes | Pod в K8s | K8s API Server |
| AWS IAM | EC2, Lambda, ECS | AWS IAM |
| AppRole | Любой процесс (CI/CD) | role_id + secret_id |
| GitHub | Разработчик | GitHub token |
| Token | Прямой вызов | Vault root token |

AppRole — для случаев где нет облачного IAM. role_id публичен (не секрет), secret_id — одноразовый (выдаётся CI/CD и используется один раз при старте приложения).

### Идея 3: Dynamic secrets — одноразовые учётки

Статический пароль к БД — риск: если утечёт, нужно ротировать вручную, нужно знать кто его знает. Dynamic secrets решают это иначе: Vault сам создаёт временного пользователя в PostgreSQL при каждом запросе, с TTL.

```
Приложение → GET vault/database/creds/my-role
Vault → CREATE USER "v-app-xyz123" WITH PASSWORD '...' VALID UNTIL '2024-01-01 11:00:00'
Vault ← username: v-app-xyz123, password: A1b2C3d4E5...
Приложение подключается к БД под этим пользователем
Через 1 час → Vault DROP USER "v-app-xyz123"
```

Утечка такого пароля не критична — он скоро сам умрёт. Каждый инстанс приложения работает под уникальным пользователем.

---

## Terraform и секреты: проблема состояния

Terraform state — это снимок всех ресурсов. Если в ресурсе есть пароль, он попадает в state **в plain text**. State нельзя держать в git.

### Правило: секрет не должен быть в коде Terraform

```hcl
// ПЛОХО
resource "aws_db_instance" "db" {
  password = "hardcoded123"   // в git и в state
}

// ПРАВИЛЬНО — значение приходит снаружи через CI/CD env var
variable "db_password" {
  type      = string
  sensitive = true   // скрывает из вывода plan/apply, но всё ещё попадает в state
}
```

### Проблема: sensitive = true не спасает от state

Значение всё равно попадает в state. Решение — remote state с шифрованием:

```hcl
terraform {
  backend "s3" {
    bucket     = "my-tf-state"
    key        = "prod/terraform.tfstate"
    encrypt    = true         // SSE-S3
    kms_key_id = "arn:aws:kms:..."  // SSE-KMS
  }
}
```

### Лучший подход: Terraform не знает секрет

Terraform создаёт ресурс и заготовку в Secrets Manager, а само значение туда никогда не пишет. Приложение читает секрет само в runtime:

```hcl
// Terraform создаёт "конверт" для секрета
resource "aws_secretsmanager_secret" "db" {
  name = "myapp/db/password"
}
// Значение задаётся отдельно — через консоль, rotation Lambda, или ручной CLI
// Terraform state чист — паролей нет
```

```java
// Приложение читает секрет при старте, используя IAM role (без credentials в коде)
var client = SecretsManagerClient.create();
String password = client
    .getSecretValue(r -> r.secretId("myapp/db/password"))
    .secretString();
```

### SOPS — зашифрованные секреты в git

Mozilla SOPS позволяет хранить зашифрованные YAML/JSON в git. Шифрование через AWS KMS, GCP KMS, или `age` (локальный ключ). Расшифровать может только тот, у кого есть IAM доступ к KMS ключу.

```
secrets.yaml (plain):        secrets.enc.yaml (в git):
  db_password: supersecret     db_password: ENC[AES256_GCM,data:xyz...]
  api_key: abc123              api_key: ENC[AES256_GCM,data:def...]
                               sops.kms: arn:aws:kms:us-east-1:123:key/abc

sops --encrypt secrets.yaml > secrets.enc.yaml   // зашифровать
sops --decrypt secrets.enc.yaml                  // расшифровать (нужен KMS доступ)
```

---

## Kubernetes Secret: почему base64 — это не шифрование

Kubernetes хранит секреты в etcd — по умолчанию открытым текстом, лишь закодированным в base64.
Это кодирование, а не шифрование, и разница проверяется за две команды (minikube v1.37.0,
kubectl v1.34.1):

```
$ kubectl create secret generic db-cred --from-literal=password='s3cr3t-p@ss'
$ kubectl get secret db-cred -o jsonpath='{.data.password}'
czNjcjN0LXBAc3M=

$ kubectl get secret db-cred -o go-template='{{.data.password | base64decode}}'
s3cr3t-p@ss
```

Ключа не понадобилось, потому что расшифровывать нечего. Практический смысл: `Secret` защищает
от **случайного** взгляда в манифест, но не от того, у кого есть право `get secret` в этом
пространстве имён или копия снимка etcd.

**Три уровня защиты:**

**1. Шифрование при хранении** — включается в конфигурации kube-apiserver. Kubernetes шифрует данные перед записью в etcd ключом из KMS.

**2. RBAC** — ограничить круг тех, кто может `kubectl get secret`. Принцип наименьших привилегий здесь работает буквально: прогон выше показывает, что право `get` равносильно знанию пароля.

**3. External Secrets Operator** — секреты живут в Vault или AWS Secrets Manager, а оператор лишь синхронизирует их в Kubernetes Secret. Компрометация etcd не открывает доступ к источнику истины.

**Монтировать секрет как файл, не как env variable:**

```
ENV variable: видна через /proc/<pid>/environ, попадает в crash dump
Volume mount: tmpfs, readOnly, не попадает в env
```

---

> **Хранение паролей пользователей** (bcrypt, Argon2id, PBKDF2, salt, `DelegatingPasswordEncoder`) — см. [`system-design/identity_providers.md`](../../system-design/theory/identity_providers.md#хранение-паролей-пользователей). Это часть аутентификации внутри приложения, а не эксплуатация секретов.

---

## Шифрование данных в транзите

TLS — стандарт для шифрования трафика. Два важных паттерна:

**TLS termination на Gateway** — распространённая схема: внешний трафик приходит по HTTPS, внутри кластера — HTTP. Удобно, но внутренний трафик не зашифрован.

**mTLS (mutual TLS)** — сервер проверяет сертификат клиента, не только наоборот. Используется в service mesh для аутентификации между сервисами.

```
Без mTLS: Payment Service не знает, от кого пришёл запрос на /charge
          Любой под в кластере может обратиться к Payment Service

С mTLS:   Order Service предъявляет свой сертификат
          Payment Service видит: это действительно Order Service, не подделка
          Istio/Linkerd автоматически управляют сертификатами — приложение не знает про TLS
```

---

## Итоговая схема — что где живёт

```
Источник правды:    Vault / AWS Secrets Manager / GCP Secret Manager
                         ↓
Terraform:          создаёт "конверты" для секретов,
                    НЕ хранит значения в state (state зашифрован в S3+KMS)
                         ↓
K8s:                External Secrets Operator синхронизирует в K8s Secrets
                    или Vault Agent монтирует через sidecar
                         ↓
Pod:                /secrets/db_password (tmpfs, readOnly volume)
                         ↓
Приложение:         Files.readString("/secrets/db_password")
                    не env variables, не hardcode, не логи
```

---

## Антипаттерны

| Паттерн | Почему плохо |
|---------|-------------|
| Секрет в git | History навсегда, невозможно "удалить" |
| ENV в Dockerfile (`ENV API_KEY=...`) | Виден через `docker inspect`, попадает в слои образа |
| Logging credentials | Логи доступны широкому кругу, агрегируются |
| Terraform state в git | Plain-text пароли в истории коммитов |
| Один секрет для всех окружений | Компрометация prod при dev-утечке |
| K8s Secret без encryption at rest | etcd backup = все секреты открыты |
| Long-lived static credentials | Утечка не обнаружена, эксплуатируется месяцами |

---

## Когда это неправильный ответ

**Vault ради одного приложения.** Vault надо развернуть, распечатать после каждого перезапуска,
резервировать и обновлять; его недоступность означает, что ваши поды не стартуют. Для Orders API
в облаке роль IAM даёт то же самое без отдельной системы: секрет не хранится нигде, потому что
его нет — есть удостоверение нагрузки, которое выдаёт облако.

**Шифрование как замена ограничению доступа.** Включить шифрование etcd при хранении и оставить
`get secret` всем в пространстве имён — значит защититься от кражи диска и не защититься от
человека. Прогон выше показывает, во что обходится широкий RBAC: пароль достаётся одной командой.

**Секрет в переменной окружения.** Виден в `docker inspect`, в `/proc/<pid>/environ`, попадает в
дамп памяти при падении и в отчёт об ошибке, который приложение отправляет наружу. Монтирование
файлом в tmpfs закрывает все четыре канала сразу.

**Ротация как разовое мероприятие.** «Поменяли пароль после инцидента» — это не ротация. Смысл
ротации в том, что украденный секрет протухает сам; если она делается руками раз в год, срок
жизни украденного пароля — год. Динамические секреты Vault решают именно это.

**Секрет, удалённый из git.** История git вечна: удаление файла следующим коммитом ничего не
меняет, значение достаётся из истории. Единственный правильный ход — считать секрет
скомпрометированным и **отозвать** его, а чистку истории делать вторым шагом.

**SOPS и Sealed Secrets как хранилище.** Оба решают задачу «зашифрованный секрет лежит в git»,
и оба не дают ни ротации, ни аудита обращений, ни отзыва. Это шаг вперёд от открытого текста и
шаг назад от Vault; выбирать их стоит осознанно, а не потому, что они проще ставятся.

---

## Шпаргалка

**Что у вас на входе → что брать**

| Ситуация | Решение | Почему |
|---|---|---|
| Приложение в облаке ходит в сервис того же облака | Роль IAM | Секрета нет вовсе — нечего красть и нечего ротировать |
| Приложение в Kubernetes, секреты в Vault | Kubernetes-аутентификация Vault по токену ServiceAccount | Токен выдаёт кластер, статического секрета нет |
| Секреты нужны вне облака и вне кластера | Vault AppRole | `role_id` в конфигурации, `secret_id` одноразовый |
| Пароль к базе нужен коротким сроком | Динамические секреты Vault | Учётная запись создаётся под запрос и истекает |
| Секреты должны лежать в git | SOPS или Sealed Secrets | Шифрование ключом KMS; ротации и аудита нет |
| Секреты в Vault, приложение хочет обычный Secret | External Secrets Operator | Источник истины снаружи, etcd — только копия |
| Секрет попал в git | Отозвать и перевыпустить | История git вечна; чистка истории — второй шаг, не первый |
| Взаимная аутентификация сервисов | mTLS | Клиент тоже предъявляет сертификат |

**Способ передачи секрета в приложение — от худшего к лучшему**

1. В образе или в `application.properties` — в git и в реестре навсегда.
2. В переменной окружения — виден в `docker inspect`, `/proc`, дампах.
3. Kubernetes Secret файлом в tmpfs — не в окружении, но в etcd и доступен по `get secret`.
4. То же плюс шифрование etcd при хранении и узкий RBAC.
5. Vault Agent или CSI-драйвер — секрет попадает прямо в файловую систему пода, минуя etcd.
6. Роль IAM без секрета вообще — красть нечего.

---

## Вопросы для самопроверки

1. В чём смысл конвертного шифрования и почему KMS шифрует ключ, а не сами данные?
2. Задача первого секрета: сформулируйте её и назовите три способа решения по возрастанию
   надёжности.
3. Почему Kubernetes Secret не является секретом? Ответ должен опираться на механизм хранения.
4. Что даёт включение шифрования etcd при хранении и от чего оно **не** защищает?
5. Переменная окружения против файла в tmpfs: перечислите каналы утечки, которые закрывает
   второе.
6. Vault перезапустился и не отвечает. Что произошло и почему это штатное поведение?
7. Чем динамический секрет отличается от статического с точки зрения ущерба при краже?
8. Секрет случайно закоммитили и удалили следующим коммитом. Что нужно сделать первым делом?
9. Terraform: как ключ оказывается в состоянии и что с этим делать?
10. SOPS и Vault решают разные задачи. Какие именно, и почему первое не заменяет второе?
11. Чем mTLS отличается от обычного TLS и какую задачу он закрывает между сервисами?

---

## Источники

**Security cheatsheets:**
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [OWASP Top 10 — A02:2021 Cryptographic Failures](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/)

**Документация продуктов:**
- [HashiCorp Vault Documentation](https://developer.hashicorp.com/vault/docs) — auth methods, dynamic secrets, Shamir, auto-unseal.
- [AWS Secrets Manager User Guide](https://docs.aws.amazon.com/secretsmanager/) — rotation Lambda, KMS-envelope encryption.
- [Mozilla SOPS](https://github.com/getsops/sops) — encrypted-secrets-in-git с KMS-провайдерами.
- [Kubernetes — Encrypting Secret Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
- [External Secrets Operator](https://external-secrets.io/) — синхронизация Vault/AWS SM в K8s Secrets.

**Engineering / case studies:**
- [GitGuardian — «State of Secrets Sprawl» annual report](https://www.gitguardian.com/state-of-secrets-sprawl-report-2024) — статистика по утечкам секретов в публичные репозитории.
- [Cloudflare — «Cloudbleed» postmortem (2017)](https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/) — пример, почему секреты не должны попадать в кэши/HTTP-ответы.
- [BeyondCorp papers (Google, USENIX ;login:)](https://research.google/pubs/beyondcorp-a-new-approach-to-enterprise-security/) — отказ от network-perimeter security, identity-aware proxies.
