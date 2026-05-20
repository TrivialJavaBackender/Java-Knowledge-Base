# ML Model Serving

Развёртывание ML-моделей в production: online (real-time) vs batch inference, model registry, feature stores, A/B testing моделей. В 2024-2026 это стало стандартной темой на интервью senior backend / ML platform engineer.

> **Scope**: serving infrastructure. Vector DBs и RAG — отдельно [`VECTOR_DBS_RAG.md`](VECTOR_DBS_RAG.md).

---

## Online vs Batch Inference

### Online inference

Request-response в реальном времени: пользователь делает action → model predicts → возвращается результат.

```
User → API Gateway → Inference Service → Model
                                          ↓
                                       Prediction (~ 10-100 ms)
                  ← Response with personalized result
```

**Use cases:** recommendations на странице, fraud detection on transaction, search ranking, ad targeting.

**Latency requirements:** обычно < 100 ms p99. Иногда < 10 ms (HFT, real-time bidding).

**Challenges:**
- Low latency = небольшая модель или GPU inference
- High throughput = batching requests at inference server
- Feature freshness — feature должны быть доступны в memory / fast store

### Batch inference

Predictions computed periodically (hourly / daily) для всех users / items, stored для quick lookup.

```
Schedule: nightly
  → Load all users from DB
  → Run model on each (Spark / Flink)
  → Write predictions to DB / cache
  → Serve via key-value lookup при request

User request → DB lookup → cached prediction (< 1 ms)
```

**Use cases:** «what to show on home page» (predictions cached per user), email campaigns, churn predictions.

**Trade-offs:**
- ✓ Low query latency (KV lookup)
- ✓ Can use heavy models (нет latency budget)
- ✗ Stale predictions (могут не учитывать current session)
- ✗ Storage cost (predictions for all users × all items × N variants)

### Hybrid

Pre-compute candidates (batch), re-rank in real-time (online). 

YouTube example: batch pre-computes 100-1000 candidate videos per user; online model re-ranks based on current session + context.

---

## Inference architecture

### Model server

Specialized servers для serving ML models:

- **TensorFlow Serving** — оригинал, gRPC + REST API
- **TorchServe** — для PyTorch
- **NVIDIA Triton Inference Server** — multi-framework, GPU optimization, batching
- **Seldon Core / KServe (K8s)** — orchestration
- **BentoML** — Python-native, easy deployment

### Optimization

- **Quantization** — fp32 → int8/fp16. Smaller, faster, slight accuracy loss
- **Pruning** — remove low-importance weights
- **Distillation** — train small «student» model to mimic large «teacher»
- **Compilation** — TensorRT (NVIDIA), ONNX Runtime, OpenVINO (Intel)
- **Batching** — process multiple requests as one batch (more GPU efficient)
- **Caching** — frequent inputs → cached predictions

### Hardware

- **CPU** — small models, low-volume
- **GPU** — large models (CNNs, transformers), batch inference. NVIDIA dominant.
- **TPU** — Google's custom AI chip
- **Accelerators** — AWS Inferentia, Apple Neural Engine, Tenstorrent

---

## Feature Stores

Production ML нужен **тот же feature** для training и serving (training-serving skew problem).

### Feature store responsibilities

- **Single source of truth** для features
- **Online store** — fast lookup в serving time (Redis, DynamoDB)
- **Offline store** — historical features для training (S3, Parquet, BigQuery)
- **Feature engineering** — compute pipelines (Flink, Spark)
- **Versioning** — feature schema versions
- **Point-in-time correctness** — at training, retrieve feature values as of timestamp T

### Реализации

- **Feast** (open source) — Python-native
- **Tecton** — managed, по сути commercialized Feast
- **AWS SageMaker Feature Store**
- **Databricks Feature Store**
- **Hopsworks**
- **Custom** (Uber Michelangelo, Airbnb Zipline, LinkedIn Feathr)

---

## Model Registry

Catalog обученных models с metadata.

**Metadata:**
- Model name, version
- Training data version
- Hyperparameters
- Performance metrics (offline eval)
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

Новая модель запускается параллельно со старой; predictions сравниваются. Output не возвращается клиенту.

```
Request → Old Model (returns prediction to user)
       → New Model (prediction logged, not returned)

Compare: difference distribution, latency, errors
```

- ✓ Safe testing on real traffic
- ✗ Doubles compute cost

### A/B testing

Split traffic between models, compare business metrics.

```
50% → Model A (current production)
50% → Model B (challenger)

Track: click-through, conversion, latency
```

Statistical significance, multi-arm bandit для adaptive allocation.

### Canary rollout

Gradual rollout: 1% → 10% → 50% → 100%. Monitor metrics на каждом step, rollback если хуже.

### Multi-model

Different models for different segments / contexts.

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

ML systems decay в production без monitoring.

### Model monitoring

- **Input data drift** — distribution input features changes (например, new user behavior)
- **Concept drift** — relationship input→output changes (recession changes purchase patterns)
- **Prediction distribution** — outputs shift
- **Performance metrics** — if ground truth available (clicks, conversions)

### Tools

- **Evidently AI** — open source
- **Arize, Fiddler, WhyLabs** — managed
- **Custom dashboards** — Grafana + Prometheus

### Retraining triggers

- Scheduled (weekly / monthly)
- Threshold-based (metric drops below X)
- Continuous (production stream of new data)

---

## Real-world architectures

### Netflix — recommendations

- Offline: matrix factorization, deep learning models trained nightly
- Online: real-time re-ranking based on current session
- Personalized homepage = combination of multiple models (rows, ordering, artwork)

### Uber Michelangelo

- Feature store
- Training, serving, monitoring unified platform
- 1000+ models in production

### Spotify

- Discover Weekly = collaborative filtering + content-based
- Real-time recommendations during listening session
- Annoy library для approximate nearest neighbor (Spotify open-sourced)

### Twitter timeline ranking

- Heavy ML model per user × per tweet
- Pre-fetch candidates → score → re-rank
- Real-time signals (current trends) + slow signals (user history)

---

## Latency budget

Для real-time recommendations / search:

```
Total budget: 100 ms (user perceives instant)

Distribution:
  Network (client ↔ edge): 30 ms
  Application logic: 10 ms
  Feature fetch: 5 ms (Redis hot data)
  Model inference: 20 ms (GPU batch)
  Re-ranking + post-processing: 10 ms
  Spare: 25 ms
```

**Insight:** model latency — лишь часть. Feature fetch может быть тем же или дольше.

---

## Build vs Buy

| | Build | Buy (managed) |
|---|---|---|
| Cost (initial) | High (eng time) | Low (subscription) |
| Cost (scale) | Lower per request | Higher |
| Customization | Full | Limited |
| Team size | Need ML platform team | Smaller |
| Examples | Uber Michelangelo, Airbnb Zipline | SageMaker, Vertex AI |

Most companies < 1000 ML models — buy. FAANG-scale: build.

---

## Антипаттерны

- **Training-serving skew** — different feature pipelines for training vs serving. → use feature store.
- **No monitoring** — model decays silently, business metrics suffer.
- **Latency не measured properly** — model alone, не считая feature fetch, network, etc.
- **Re-training without validation** — new model deployed без offline + online eval. Performance regression.
- **No rollback plan** — bad model breaks production, нет way back.
- **Over-engineering** — sophisticated pipeline для simple use case. Often, simple model + good data wins.

---

## Источники

- *Designing Machine Learning Systems* (Chip Huyen, 2022) — must-read для ML in production
- *Machine Learning Design Patterns* (Lakshmanan et al., 2020)
- [Uber Engineering — Michelangelo: An Internal ML-as-a-Service Platform](https://www.uber.com/blog/michelangelo-machine-learning-platform/)
- [Netflix Tech Blog — ML Engineering](https://netflixtechblog.com/tagged/machine-learning)
- [Made With ML (Goku Mohandas)](https://madewithml.com/) — practical guide
- [Feast Documentation](https://docs.feast.dev/)
- [NVIDIA Triton Inference Server](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/index.html)
- [MLOps Community](https://mlops.community/)
- [Google ML Test Score: A Rubric for Production Readiness](https://research.google/pubs/pub46555/)
