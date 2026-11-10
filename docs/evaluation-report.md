# Evaluation Report (Template — Populate Only With Measured Results)

## Dataset

- Dataset name/version:
- Number of documents:
- PDF count / page count:
- Image count:
- XLS/XLSX count:
- CSV count:
- Synthetic vs authorized real data:
- Ground-truth annotation method:
- Languages/layouts represented:
- Hardware and Docker resource limits:

## Model and pipeline configuration

- OCR engine/version/languages:
- PDF parser/version:
- LLM provider/model/version:
- Prompt version:
- Extraction schema version:
- Embedding provider/model:
- Database and queue providers:
- Processing concurrency:

## Results

| Metric | Measured result | Method / denominator |
|---|---:|---|
| Invoice number exact/normalized match | TBD | |
| Invoice date match | TBD | |
| Supplier name match | TBD | |
| Customer name match | TBD | |
| Subtotal match | TBD | |
| Tax match | TBD | |
| Total match | TBD | |
| Currency match | TBD | |
| Line-item field F1 | TBD | |
| Document-level success rate | TBD | |
| Manual-review rate | TBD | |
| Failure rate | TBD | |
| Processing time p50 | TBD | |
| Processing time p95 | TBD | |
| Throughput | TBD | |

## Failure analysis

List parser failures, OCR failures, extraction misses, ambiguous values, unsupported layouts and resource-limit events. Include representative synthetic examples only.

## Limitations

State dataset size, language coverage, model nondeterminism, hardware constraints and untested provider combinations. Do not describe preliminary results as production accuracy.
