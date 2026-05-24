# ML Model Serving

Развёртывание ML-моделей в production: online (real-time) vs batch inference, model registry, feature stores, A/B testing моделей. В 2024–2026 — стандартная тема на интервью senior backend / ML platform engineer.

> **Scope:** serving-инфраструктура. Vector DB и RAG — отдельно в [`VECTOR_DBS_RAG.md`](VECTOR_DBS_RAG.md).

---

## Online vs Batch Inference

### Online inference

Request-response в реальном времени: пользователь совершает действие → модель делает predict → возвращается результат.

```
User → API Gateway → Inference Service → Model
                                          ↓
                                       Prediction (~10–100 мс)
                  ← Response с персонализированным результатом
```

**Use cases:** рекомендации на странице, fraud detection на транзакции, search ranking, ad targeting.

**Latency requirements:** обычно < 100 мс p99. Иногда < 10 мс (HFT, real-time bidding).

**Сложности:**
- Низкая latency = небольшая модель или GPU inference
- Высокий throughput = batching запросов на inference-сервере
- Свежесть фичей — данные должны лежать в памяти или быстром хранилище

### Batch inference

Predictions считаются периодически (каждый час / каждую ночь) для всех пользователей / айтемов и сохраняются для быстрых lookup'ов.

```
Schedule: ночью
  → Загружаем всех пользователей из БД
  → Прогоняем модель (Spark / Flink)
  → Записываем predictions в БД / cache
  → На запрос — KV-lookup

User request → DB lookup → cached prediction (< 1 мс)
```

**Use cases:** «что показать на главной» (predictions закэшированы per user), email-кампании, churn predictions.

**Trade-offs:**
- ✓ Низкая query latency (KV lookup)
- ✓ Можно использовать тяжёлые модели (нет жёсткого latency budget)
- ✗ Stale predictions (не учитывают текущую сессию)
- ✗ Storage cost (predictions для всех пользователей × всех айтемов × N вариантов)

### Гибрид

Pre-compute кандидатов (batch), re-rank в реальном времени (online).

YouTube: batch заранее считает 100–1000 кандидатов на пользователя; online-модель re-rank'ит с учётом текущей сессии и контекста.

---

## Inference architecture

### Model server

Специализированные серверы для serving ML-моделей:

- **TensorFlow Serving** — оригинал, gRPC + REST API
- **TorchServe** — для PyTorch
- **NVIDIA Triton Inference Server** — multi-framework, GPU optimization, batching
- **Seldon Core / KServe (на Kubernetes)** — оркестрация
- **BentoML** — Python-native, простой деплой

### Оптимизация

- **Quantization** — fp32 → int8/fp16. Меньше, быстрее, небольшая потеря точности
- **Pruning** — выкидывание малозначимых весов
- **Distillation** — обучение маленькой «student»-модели имитировать большую «teacher»
- **Compilation** — TensorRT (NVIDIA), ONNX Runtime, OpenVINO (Intel)
- **Batching** — несколько запросов обрабатываются одним батчем (эффективнее на GPU)
- **Caching** — частые входы → закэшированные predictions

### Hardware

- **CPU** — небольшие модели, низкий объём
- **GPU** — большие модели (CNN, transformers), batch inference. Доминирует NVIDIA.
- **TPU** — кастомный AI-чип Google
- **Акселераторы** — AWS Inferentia, Apple Neural Engine, Tenstorrent

---

## Feature Stores

В production ML нужны **одни и те же фичи** для training и serving (проблема training-serving skew).

### Зоны ответственности feature store

- **Единый источник истины** для фичей
- **Online store** — быстрый lookup в serving (Redis, DynamoDB)
- **Offline store** — исторические фичи для training (S3, Parquet, BigQuery)
- **Feature engineering** — пайплайны вычислений (Flink, Spark)
- **Versioning** — версии схем фичей
- **Point-in-time correctness** — при обучении достаём значения фичей **на момент** timestamp T

### Реализации

- **Feast** (open source) — Python-native
- **Tecton** — managed-вариант, по сути commercialized Feast
- **AWS SageMaker Feature Store**
- **Databricks Feature Store**
- **Hopsworks**
- **Custom** (Uber Michelangelo, Airbnb Zipline, LinkedIn Feathr)

---

## Model Registry

Каталог обученных моделей с метаданными.

**Метаданные:**
- Имя и версия модели
- Версия training data
- Гиперпараметры
- Метрики (offline eval)
- Lineage (data → features → model)
- Approval status (dev → staging → prod)

**Реализации:**
- **MLflow Model Registry** (open source)
- **Weights & Biases**
- **SageMaker Model Registry**
- **Vertex AI Model Registry** (GCP)
- **Custom** (большинство FAANG имеют свои)

---

## Deployment patterns

### Shadow deployment

Новая модель работает параллельно со старой; predictions сравниваются. Output клиенту не возвращается.

```
Request → Old Model (predict → пользователю)
       → New Model (predict логируется, не возвращается)

Сравнение: распределение различий, latency, ошибки
```

- ✓ Безопасный тест на реальном трафике
- ✗ Удваивает compute cost

### A/B testing

Разделить трафик между моделями, сравнить бизнес-метрики.

```
50% → Model A (текущий prod)
50% → Model B (challenger)

Метрики: click-through, conversion, latency
```

Проверять статистическую значимость; multi-arm bandit — для адаптивного распределения трафика.

### Canary rollout

Постепенный rollout: 1% → 10% → 50% → 100%. Мониторим метрики на каждом шаге, откатываем при ухудшении.

### Multi-model

Разные модели для разных сегментов / контекстов.

```
if user.tier == "premium":
    use heavy_model
elif user.country == "US":
    use us_specific_model
else:
    use default_model
```

---

## Monitoring

ML-системы деградируют в production без мониторинга.

### Что мониторим

- **Input data drift** — распределение входных фичей меняется (новое поведение пользователей)
- **Concept drift** — меняется связь input → output (рецессия меняет паттерны покупок)
- **Prediction distribution** — выходы сдвинулись
- **Performance metrics** — если доступна ground truth (клики, конверсии)

### Инструменты

- **Evidently AI** — open source
- **Arize, Fiddler, WhyLabs** — managed
- **Кастомные дашборды** — Grafana + Prometheus

### Триггеры на переобучение

- По расписанию (раз в неделю / месяц)
- Threshold-based (метрика упала ниже X)
- Continuous (production-поток новых данных)

---

## Real-world architectures

### Netflix — recommendations

- Offline: matrix factorization и deep learning, обучаются ночью
- Online: real-time re-ranking по текущей сессии
- Персональная главная = комбинация нескольких моделей (строки, порядок, artwork)

### Uber Michelangelo

- Feature store
- Унифицированная платформа для training, serving и мониторинга
- 1000+ моделей в production

### Spotify

- Discover Weekly = collaborative filtering + content-based
- Real-time-рекомендации во время прослушивания
- Библиотека Annoy для approximate nearest neighbor (выложена Spotify в open source)

### Twitter — timeline ranking

- Тяжёлая ML-модель на каждого пользователя × каждый твит
- Pre-fetch кандидатов → scoring → re-rank
- Real-time-сигналы (текущие тренды) + медленные (история пользователя)

---

## Latency budget

Для real-time recommendations / search:

```
Общий бюджет: 100 мс (пользователь воспринимает как мгновенно)

Распределение:
  Сеть (client ↔ edge):              30 мс
  Application logic:                 10 мс
  Feature fetch:                      5 мс (Redis hot data)
  Model inference:                   20 мс (GPU batch)
  Re-ranking + постобработка:        10 мс
  Запас:                             25 мс
```

**Insight:** latency самой модели — лишь часть. Feature fetch может занимать столько же или дольше.

---

## Build vs Buy

| | Build | Buy (managed) |
|---|---|---|
| Cost (стартовый) | Высокий (инженерное время) | Низкий (подписка) |
| Cost (на масштабе) | Ниже за запрос | Выше |
| Кастомизация | Полная | Ограниченная |
| Размер команды | Нужна ML platform team | Меньше |
| Примеры | Uber Michelangelo, Airbnb Zipline | SageMaker, Vertex AI |

Большинство компаний с < 1000 ML-моделей — buy. FAANG-масштаб — build.

---

## Антипаттерны

- **Training-serving skew** — разные пайплайны фичей для training и serving → использовать feature store.
- **Нет мониторинга** — модель тихо деградирует, бизнес-метрики падают.
- **Latency измеряется неполно** — только модель, без feature fetch, сети и т. п.
- **Re-training без валидации** — новая модель деплоится без offline и online eval → регрессия качества.
- **Нет rollback-плана** — плохая модель ломает production, и нечем откатить.
- **Over-engineering** — сложный пайплайн под простой кейс. Часто простая модель + хорошие данные побеждают.

---

## Источники

- *Designing Machine Learning Systems* (Chip Huyen, 2022) — must-read для ML in production
- *Machine Learning Design Patterns* (Lakshmanan et al., 2020)
- [Uber Engineering — Michelangelo: An Internal ML-as-a-Service Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/)
- [Netflix Tech Blog — ML Engineering](https://netflixtechblog.com/tagged/machine-learning)
- [Made With ML (Goku Mohandas)](https://madewithml.com/)
- [Feast Documentation](https://docs.feast.dev/)
- [NVIDIA Triton Inference Server](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/index.html)
- [MLOps Community](https://mlops.community/)
- [Google ML Test Score: A Rubric for Production Readiness](https://research.google/pubs/pub46555/)
