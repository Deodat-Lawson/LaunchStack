# Vantage exploration reliability and deterministic windows

The previous sweep had **123 failures in 300 live attempts (41%)**. The archive links 43 failures to requests with no HTTP response. The other 80 fit the shared-hold cascade. A model request was recorded in the trace, no corresponding dispatch reached the ledger, and the same four-group wave contained a no-HTTP failure.

| Historical terminal cause | Failed groups |
|---|---:|
| No HTTP response | 43 |
| Shared-hold cascade | 80 |
| HTTP status error | 0 |
| Timeout | 0 |
| Invalid submission | 0 |
| Missing submission | 0 |

The cascade diagnosis uses ledger order, relative run times and the old meter's hold behavior. The archive lacks absolute completion timestamps. Failures affected 33 of 75 waves. The [aggregate results](vantage-topic-first-reliability-results-20261122.json) include counts for every wave and the HTTP-status breakdown.

**Post-fix, 1 of 76 live explorations failed (1.3%).** A new 8 KB exploration ran out of turns before submitting (1/50). All 26 eligible 16 KB reruns succeeded, including 12 direct failures and 14 cascades. Keeping the 24 original successes reduced 16 KB failures in the held-out view from 26/50 to 0/50. This follow-up used concurrency one alongside the scoped retry policy. All 474 requests returned usage, and the Azure run triggered zero retries. Injected tests exercised all retryable classes.

## Held-out results with reruns

| Cap KB | Topics | Arm | Supporting docs | Strict facts | Lenient .80 / .90 | Topics without a supporting doc | Frozen bytes p50 / p90 | Failed groups |
|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 8 | 3 | Seeds-only | 45/90 | 18/30 | 28/117 · 26/117 | 45 | 7,532 / 7,957 | 0/30 |
| 8 | 3 | Seeds-windows | 49/90 | 19/30 | 28/117 · 26/117 | 41 | 8,000 / 8,000 | 0/30 |
| 8 | 3 | Live | 72/90 | 18/30 | 31/117 · 27/117 | 18 | 3,668.5 / 5,926 | 1/30 |
| 8 | 3 | Live+backfill | 75/90 | 19/30 | 32/117 · 28/117 | 15 | 8,000 / 8,000 | 1/30 |
| 8 | 5 | Seeds-only | 28/99 | 13/32 | 21/128 · 18/128 | 71 | 7,529 / 7,926 | 0/20 |
| 8 | 5 | Seeds-windows | 41/99 | 16/32 | 26/128 · 24/128 | 58 | 8,000 / 8,000 | 0/20 |
| 8 | 5 | Live | 84/99 | 13/32 | 28/128 · 23/128 | 15 | 5,136 / 7,123 | 0/20 |
| 8 | 5 | Live+backfill | 86/99 | 13/32 | 28/128 · 23/128 | 13 | 8,000 / 8,000 | 0/20 |
| 16 | 3 | Seeds-only | 60/90 | 25/30 | 36/117 · 34/117 | 30 | 15,495 / 15,930 | 0/30 |
| 16 | 3 | Seeds-windows | 68/90 | 24/30 | 36/117 · 34/117 | 22 | 16,000 / 16,000 | 0/30 |
| 16 | 3 | Live | 75/90 | 18/30 | 31/117 · 27/117 | 15 | 4,990.5 / 7,286 | 0/30 |
| 16 | 3 | Live+backfill | 80/90 | 19/30 | 32/117 · 28/117 | 10 | 16,000 / 16,000 | 0/30 |
| 16 | 5 | Seeds-only | 46/99 | 21/32 | 33/128 · 30/128 | 53 | 15,510.5 / 15,927 | 0/20 |
| 16 | 5 | Seeds-windows | 50/99 | 20/32 | 33/128 · 29/128 | 49 | 16,000 / 16,000 | 0/20 |
| 16 | 5 | Live | 83/99 | 17/32 | 27/128 · 23/128 | 16 | 6,808 / 11,765 | 0/20 |
| 16 | 5 | Live+backfill | 85/99 | 18/32 | 29/128 · 24/128 | 14 | 16,000 / 16,000 | 0/20 |

**Both live arms beat seeds-windows on supporting-document recall in all four cells.** They also beat it on lenient .80 recall at 8 KB for both group sizes and on .90 recall at 8 KB with three topics. At 16 KB, seeds-windows led on strict and both lenient measures. Seeds-windows beat live on strict recall in every cell. It tied live+backfill at 8 KB with three topics and led in the other three cells.

## Without reruns

The 8 KB rows use the same first attempts and the free arms are identical across views. The four historical 16 KB live rows are below. Counts include failed groups as zero evidence. The aggregate file includes both complete views and same-group successful comparisons.

| Cap KB | Topics | Arm | Supporting docs | Strict facts | Lenient .80 / .90 | Topics without a supporting doc | Frozen bytes p50 / p90 | Failed groups |
|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 16 | 3 | Live | 30/90 | 5/30 | 11/117 · 10/117 | 60 | 0 / 6,704 | 16/30 |
| 16 | 3 | Live+backfill | 34/90 | 5/30 | 11/117 · 10/117 | 56 | 0 / 16,000 | 16/30 |
| 16 | 5 | Live | 40/99 | 10/32 | 15/128 · 13/128 | 59 | 1,491 / 10,060 | 10/20 |
| 16 | 5 | Live+backfill | 41/99 | 11/32 | 16/128 · 14/128 | 58 | 6,572.5 / 16,000 | 10/20 |

Supporting-document recall counts resolved labelled versions per topic. Strict recall requires an exact or normalized passage in a frozen excerpt on source-eligible cases. Lenient recall uses the unchanged .80 and .90 overlap thresholds. A topic without evidence in the table has a resolved supporting document and no matching frozen version. The JSON also counts topics without matched passages.

## Changes, spend and verification

The Azure benchmark isolates transport failures by exploration. A no-response, 429 or 5xx request can retry twice after 250 and 500 ms within the original deadline. Each sent attempt has its own reservation and settlement. Unresolved charges retain their reserves. The grouped runner accepts concurrency one through four and defaults to one. Seeds-windows reuses the backfill matcher to center excerpts on question and keyword matches in seed order while retaining the reserved lane and fixed sources.

All 200 free attempts completed first with zero model calls. Seeds-only reproduced all 50 previous 16 KB snapshots. The experiment reused the held-out roster, retrieval prompt and scoring thresholds. Labels stayed in offline evaluation and the corpus and raw captures remain in the local cache. Live+backfill reused live explorations and incurred zero extra model calls.

Azure GPT-6 Luna preflight projected **$2.26 against $5**. The meter recorded **$2.04** at its conservative rates with zero unresolved usage. Azure returned 5,803,388 input tokens and 327,423 output tokens. That prices to **$0.394** at published Global Standard short-context rates. The invoice total remains unverified. [Azure pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)

Verified all 76 new live pairs and 400 arm rows in each scoring view, with zero cap violations and zero frozen-byte discrepancies. The original failure audit reproduced byte for byte. Passed 418 Vantage server tests without Postgres, 55 offline tests, and 45 importer tests. Web TypeScript and changed TypeScript lint passed. The run measured retrieval through freeze.

Implementation is `138ffd90` and exact paired scoring is `b3ce25bd`.
