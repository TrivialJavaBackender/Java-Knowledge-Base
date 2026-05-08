# Secrets Management — управление секретами

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

## Принцип: envelope encryption

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

## Проблема bootstrap: где лежит первый секрет

Это главный вопрос. Чтобы получить пароль из Vault, нужна аутентификация в Vault. Чтобы аутентифицироваться — нужен какой-то credential. Где он лежит?

**Плохое решение:** положить Vault token в переменную окружения в коде или Dockerfile.

**Правильные решения по уровням:**

### Уровень 1 — Cloud IAM (лучшее, zero-secret)

EC2 instance, ECS task, K8s pod могут иметь IAM роль. Облако само выдаёт временные credentials через Instance Metadata Service — ни одного секрета не нужно хранить.

```
EC2 с IAM role "app-role"
  → GET http://169.254.169.254/latest/meta-data/iam/security-credentials/app-role
  ← { AccessKeyId, SecretAccessKey, Token, Expiration }  // автоматически, без секретов
  → приложение читает секрет из AWS Secrets Manager используя эти credentials
```

Никакого plain-text секрета нет нигде. IAM role назначается инфраструктурой, не кодом.

### Уровень 2 — Kubernetes Service Account (для K8s)

Каждый pod автоматически получает service account token, примонтированный как файл. Vault умеет аутентифицировать по этому токену:

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

Vault — это не просто key-value хранилище с паролем. Три ключевые идеи:

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

## Terraform и секреты — проблема state

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

## Kubernetes Secrets — почему base64 ≠ шифрование

K8s хранит секреты в etcd. По умолчанию — в plain text, просто base64-encoded.
`echo "bXlzZWNyZXQ=" | base64 -d` выдаёт `mysecret` — это кодирование, не шифрование.

Что это означает практически: любой, у кого есть доступ к etcd backup или снапшоту, видит все секреты.

**Три уровня защиты:**

**1. Encryption at rest** — включается в kube-apiserver конфиге. K8s шифрует данные перед записью в etcd ключом из KMS.

**2. RBAC** — ограничить кто может `kubectl get secret`. Используй принцип least privilege.

**3. External Secrets Operator** — секреты живут в Vault/AWS SM, ESO только синхронизирует их в K8s Secrets. Компрометация etcd не открывает доступ к источнику правды.

**Монтировать секрет как файл, не как env variable:**

```
ENV variable: видна через /proc/<pid>/environ, попадает в crash dump
Volume mount: tmpfs, readOnly, не попадает в env
```

---

## Хранение паролей пользователей

### Почему нельзя SHA-256 (и даже SHA-512)

Криптографические хэши — быстрые по дизайну. GPU выполняет миллиарды SHA-256 в секунду. При утечке БД атакующий перебирает все пароли из словаря за минуты.

Правильные алгоритмы специально медленные: содержат настраиваемую "стоимость" (число итераций, объём памяти), которая делает перебор нерентабельным.

| Алгоритм | Memory-hard | Рекомендован | Параметр сложности |
|----------|-------------|-------------|---------------------|
| MD5 / SHA-* | Нет | **Никогда** | — |
| bcrypt | Нет | Да | cost (10–12) |
| Argon2id | Да | **Лучший выбор** | memory, time, parallelism |
| PBKDF2 | Нет | Да (FIPS) | iterations (≥ 600 000) |

**Memory-hard** означает что для перебора нужно много RAM — GPU имеет быстрые ядра, но мало памяти на ядро, поэтому атака на GPU нерентабельна.

**Соль** (случайные байты, уникальные для каждого пароля) решает проблему rainbow tables: даже одинаковые пароли дают разные хэши. bcrypt и Argon2 включают соль в сам хэш — хранить отдельно не нужно.

```java
// bcrypt: cost=12 ~300ms — достаточно медленно для перебора, приемлемо для логина
PasswordEncoder encoder = new BCryptPasswordEncoder(12);
String hash = encoder.encode("userpassword");
// $2a$12$<22-char-salt><31-char-hash>

boolean ok = encoder.matches("userpassword", hash);  // true

// Ротация алгоритма без сброса паролей:
// DelegatingPasswordEncoder хранит префикс {bcrypt}$2a$...
// При следующем логине старый хэш заменяется на новый алгоритм автоматически
PasswordEncoder delegating = PasswordEncoderFactories.createDelegatingPasswordEncoder();
```

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
| MD5/SHA хэши паролей | Brute-force за минуты при утечке БД |
| K8s Secret без encryption at rest | etcd backup = все секреты открыты |
| Long-lived static credentials | Утечка не обнаружена, эксплуатируется месяцами |
