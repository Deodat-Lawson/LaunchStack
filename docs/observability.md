# Observability & Metrics

The Launchstack backend exposes Prometheus-compatible metrics for request health, cache efficiency, and search behavior.

## Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `pdr_predictive_analysis_duration_seconds` | Histogram | End-to-end latency for predictive document analysis, labeled by `result` and `cached` |
| `pdr_predictive_analysis_requests_total` | Counter | Request totals labeled by success/error and cache usage |
| `pdr_predictive_analysis_cache_hits_total` | Counter | Number of cached analysis results returned |
| `pdr_predictive_analysis_ai_calls` | Histogram | GPT call counts per analysis (cost/latency) |
| `pdr_qa_request_duration_seconds` | Histogram | Latency for Q&A requests labeled by `result` and retrieval strategy |
| `pdr_qa_requests_total` | Counter | Total Q&A requests split by `result` (`success`, `empty`, `error`) |

All metrics use the `pdr_` prefix alongside `prom-client` default process metrics.

## Scraping the Endpoint

1. Run the application (`pnpm --filter @launchstack/web dev` or Docker).
2. Scrape `http://localhost:3000/api/metrics`:

```bash
curl -s http://localhost:3000/api/metrics
```

3. Configure Prometheus:

```yaml
scrape_configs:
  - job_name: pdrai
    scrape_interval: 10s
    static_configs:
      - targets: ["host.docker.internal:3000"]
```

## Grafana Ideas

- **Predictive Analysis Dashboard**
  - Request rate & errors: `rate(pdr_predictive_analysis_requests_total[5m])`
  - Cache hit %: `rate(pdr_predictive_analysis_cache_hits_total[5m]) / rate(pdr_predictive_analysis_requests_total{cached="true"}[5m])`
  - GPT call histogram: `histogram_quantile(0.95, sum(rate(pdr_predictive_analysis_ai_calls_bucket[5m])) by (le))`

- **Q&A Reliability**
  - Latency (P95) by retrieval: `histogram_quantile(0.95, sum(rate(pdr_qa_request_duration_seconds_bucket[5m])) by (le,retrieval))`
  - Fallback ratio: `rate(pdr_qa_requests_total{retrieval="ann_fallback"}[5m]) / rate(pdr_qa_requests_total[5m])`

These dashboards help spot cache regressions, GPT usage spikes, or ensemble search issues before users are affected.

## Storage Deletion Lifecycle Observability

Storage deletion lifecycle health is intentionally exposed as a read-only JSON
surface (separate from Prometheus counters):

- `GET /api/storage/deletion-metrics`
- UI surface: Documents → Settings → **Storage operations**

Key fields:

- `flags.lifecycleEnabled` / `flags.workerEnabled`
- backlog: request count, oldest age, retries, blocked/quarantined counts
- provider cleanup: pending/completed/blocked item counts
- SQL purge: completed vs pending request totals

This endpoint is the primary rollout guardrail while enabling
`STORAGE_DELETION_LIFECYCLE_ENABLED` and then
`STORAGE_DELETION_WORKER_ENABLED` in stages.

### Orphan Audit (read-only by default)

Use the orphan inventory tool to audit provider objects against manifest/legacy
references without deleting anything:

```bash
pnpm --dir apps/web exec tsx scripts/audit-storage-orphans.ts --adapter s3
```

Only explicit `--backfill` writes high-confidence manifest rows; default mode is
read-only. See [storage-orphan-audit.md](./storage-orphan-audit.md) and
[storage-deletion-rollout.md](./storage-deletion-rollout.md).
