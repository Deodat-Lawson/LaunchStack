# Vantage topic-first under a contested evidence budget

Azure live beat seeds-only on evidence efficiency at both group sizes and on supporting-document coverage in five-topic groups (87/99 versus 85/99). Seeds-only had higher supporting-document coverage in three-topic groups (83/89 versus 81/89), and higher strict and lenient passage recall at both sizes.

| Topics per group | Arm | Selected supporting docs | Strict passages | Lenient .80 / .90 | Topics without a supporting doc | Frozen bytes p50 / p90 |
|---:|---|---:|---:|---:|---:|---:|
| 3 | Baseline | 4/89 | 0/32 | 1/104 · 0/104 | 85 | 5,718 / 6,375 |
| 3 | Seeds only | 83/89 | 30/32 | 48/104 · 37/104 | 6 | 54,989.5 / 78,975 |
| 3 | Scripted | 82/89 | 25/32 | 43/104 · 32/104 | 7 | 41,873 / 51,062 |
| 3 | Azure live | 81/89 | 21/32 | 36/104 · 26/104 | 8 | 2,323.5 / 4,892 |
| 5 | Baseline | 4/99 | 0/33 | 1/117 · 0/117 | 95 | 5,718 / 6,375 |
| 5 | Seeds only | 85/99 | 28/33 | 52/117 · 39/117 | 14 | 56,176 / 79,375 |
| 5 | Scripted | 83/99 | 24/33 | 47/117 · 34/117 | 16 | 42,350.5 / 55,650 |
| 5 | Azure live | 87/99 | 21/33 | 42/117 · 30/117 | 12 | 4,801 / 7,504 |

Across all pooled frozen bytes, live recovered 0.249 strict facts per KB versus 0.0168 for seeds-only in three-topic groups, and 0.219 versus 0.0235 in five-topic groups. Live used 84,213 and 95,746 total bytes respectively. Seeds used 1,786,484 and 1,190,854.

Shared-context scores count each topic's supporting document versions and passages against all evidence frozen for its group. One topic per size has an unresolved filename and is excluded from the zero-supporting-document column. Strict passage denominators cover 28 eligible topics for size 3 and 29 for size 5. A passage must be present in one frozen unit of the matching source version. Lenient recall uses the existing .80 and .90 token-overlap thresholds. The group context bytes are counted once.

[Per-run and per-topic results](vantage-topic-first-contested-budget-results-20261122.json) include zero-passage topics, source units, and document and excerpt counts. Topic slots follow the fixed roster order. The Azure submission tags assigned at least one surviving document to all 90 three-topic positions and 99 of 100 five-topic positions. This document-level diagnostic measures the model's assignments. The supporting-document and passage columns measure evidence against the offline labels.

## Saved single-topic efficiency

The four saved 100-case arms were rescored offline. Document and excerpt counts below are totals across 100 runs. The per-KB measures divide matching fact occurrences by pooled UTF-8 evidence bytes in the associated eligible snapshots, using 1,000 bytes per KB. All-run denominators and count distributions are in the results file.

| Arm | Frozen bytes p50 / p90 | Docs / excerpts | Strict passages | Lenient .80 / .90 | Facts per KB strict / .80 / .90 |
|---|---:|---:|---:|---:|---:|
| Baseline | 5,718 / 6,375 | 260 / 0 | 0/33 | 1/117 · 0/117 | 0 / 0.002 / 0 |
| Seeds only | 55,516 / 78,024 | 1,574 / 1,474 | 33/33 | 57/117 · 44/117 | 0.022 / 0.010 / 0.008 |
| Scripted | 41,258.5 / 50,634 | 1,410 / 1,500 | 28/33 | 52/117 · 39/117 | 0.024 / 0.013 / 0.010 |
| Azure live | 939 / 3,073 | 235 / 179 | 20/33 | 43/117 · 31/117 | 0.482 / 0.327 / 0.236 |

## Design and execution

The seed `vantage-contested-20261122` orders the label-free cases by SHA-256 within enterprise and group size. Each size uses a disjoint partition. Size 3 has 30 groups and 90 topic positions, with two remainder questions per enterprise. Size 5 has 20 groups and 100 positions. A question may appear in both sizes. Each group gets one personal topic per question and one shared freeze under the 80,000-byte cap and 16-source-unit limit. Fixed sources count toward the limits.

All 150 free runs finished before the Azure run. All 200 attempts produced snapshots. Cap checks found zero byte or source-unit violations and zero frozen-byte mismatches. The maximum was 79,964 bytes for seeds-only and 10,547 for live.. Seeds reached 16 source units in 40 of 50 groups and scripted reached it in all 50. The run settings and scoring method were committed as `f89001fa` before execution. The roster and method hashes are in the results file.

Azure used the existing GPT-6 Luna Azure routes and 236 grounded cached digests. Preflight projected **$4.1123** for the 190 topic positions, using the saved single-topic p90 exposure per topic with 50% padding. The meter reserved each request and reprojected the remaining run against the **$10 cap**. Azure reported **2,937,406 input** and **125,620 output tokens** across **296 exploration requests**. At published Global Standard rates, that is **$0.1780**. The conservative settled exposure was **$0.9943**, with zero unresolved requests. The invoice total remains unverified. [Azure pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)

The external cache contains `grouped-3-5-requests.json`, `grouped-3-5-free.json`, `grouped-3-5-live.json`, the live evidence directory, and the local score files. Labels were read only by the offline evaluator. Git contains the benchmark code and numeric results.

The paid invocation ran from `apps/web` with `CHAT_MODELS_CONFIG=config/chat-models.azure.yaml`, the existing Azure credential pair, and the default digest and reasoning exploration routes.

```powershell
$cache = Join-Path $env:TEMP 'vantage-rag-multi-corpus-39071af3'
node ../../node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/vantage-benchmark-run.ts --cache $cache --requests grouped-3-5-requests.json --grouped --output grouped-3-5-live.json --arm configured-live --approve-live --end-to-end 0
```

Verified 54 live archive files, the 200 grouped runs, and the UTF-8 accounting of all 400 saved single-topic runs. Passed 123 focused web tests, 45 loader/evaluator tests and 45 importer tests. Web TypeScript and changed TypeScript lint passed.
