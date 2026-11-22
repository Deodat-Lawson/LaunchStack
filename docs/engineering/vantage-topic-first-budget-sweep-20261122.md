# Vantage topic-first evidence-budget sweep

**Seeds-only had higher held-out passage recall at both 16 and 80 KB, for both group sizes.** That held for strict matching and both lenient thresholds, including on the same groups where live completed. On successful 16 KB groups, live and live+backfill selected more supporting documents than seeds-only and located fewer labelled passages.

## Held-out comparison

| Cap KB | Topics | Arm | Supporting docs | Strict facts | Lenient .80 | Lenient .90 | Topics without a supporting doc | Frozen bytes p50 / p90 | Failed groups |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 16 | 3 | Seeds-only | 60/90 | 25/30 | 36/117 | 34/117 | 30 | 15,495 / 15,930 | 0/30 |
| 16 | 3 | Scripted | 68/90 | 24/30 | 35/117 | 33/117 | 22 | 15,699.5 / 15,925 | 0/30 |
| 16 | 3 | Live | 30/90 | 5/30 | 11/117 | 10/117 | 60 | 0 / 6,704 | 16/30 |
| 16 | 3 | Live+backfill | 34/90 | 5/30 | 11/117 | 10/117 | 56 | 0 / 16,000 | 16/30 |
| 16 | 5 | Seeds-only | 46/99 | 21/32 | 33/128 | 30/128 | 53 | 15,510.5 / 15,927 | 0/20 |
| 16 | 5 | Scripted | 55/99 | 21/32 | 32/128 | 29/128 | 44 | 15,424.5 / 15,752 | 0/20 |
| 16 | 5 | Live | 40/99 | 10/32 | 15/128 | 13/128 | 59 | 1,491 / 10,060 | 10/20 |
| 16 | 5 | Live+backfill | 41/99 | 11/32 | 16/128 | 14/128 | 58 | 6,572.5 / 16,000 | 10/20 |
| 80 | 3 | Seeds-only | 85/90 | 28/30 | 42/117 | 38/117 | 5 | 53,770 / 78,356 | 0/30 |
| 80 | 3 | Scripted | 82/90 | 25/30 | 38/117 | 34/117 | 8 | 39,878.5 / 46,760 | 0/30 |
| 80 | 3 | Live | 33/90 | 6/30 | 12/117 | 11/117 | 57 | 0 / 12,506 | 16/30 |
| 80 | 3 | Live+backfill | 39/90 | 7/30 | 13/117 | 12/117 | 51 | 0 / 57,087 | 16/30 |
| 80 | 5 | Seeds-only | 87/99 | 30/32 | 46/128 | 41/128 | 12 | 53,734 / 78,220 | 0/20 |
| 80 | 5 | Scripted | 82/99 | 26/32 | 40/128 | 36/128 | 17 | 39,063 / 47,500 | 0/20 |
| 80 | 5 | Live | 45/99 | 14/32 | 23/128 | 22/128 | 54 | 2,881.5 / 12,173 | 9/20 |
| 80 | 5 | Live+backfill | 48/99 | 16/32 | 26/128 | 24/128 | 51 | 14,267.5 / 39,355 | 9/20 |

The table counts failures as zero evidence. On the 14 successful three-topic groups at 16 KB, live found six more supporting documents than seeds-only and live+backfill found ten more. On the ten successful five-topic groups, those gains were 14 and 15. Both live arms trailed on document and passage recall on successful held-out groups at 80 KB. Across the four held-out cells, backfill added 14 supporting-document occurrences, four strict facts and five .80 facts to the original live selections.

[Aggregate results for all 48 cells](vantage-topic-first-budget-sweep-results-20261122.json) include both recall denominators, topics without matched passages, byte distributions, source-unit limits and same-group deltas. Supporting documents count resolved labelled document versions per topic. Strict recall uses exact or normalized passage matching for source-eligible cases. Lenient recall uses the established .80 and .90 token-overlap thresholds for all resolvable facts. Both score the shared group freeze.

## Exploratory comparison

- At **8 KB** with three topics, both live arms beat seeds-only on strict (18/32 vs 16/32), lenient .80 (31/104 vs 29/104) and lenient .90 (22/104 vs 21/104). With five topics, backfill beat seeds-only on strict (12/33 vs 10/33) and .90 (15/117 vs 13/117) and tied .80. Live alone tied strict and .90 and trailed .80.
- At **16, 32 and 80 KB**, neither live arm beat seeds-only on passage recall when failures counted. Both selected more supporting documents at 16 KB in the exploratory three-topic groups. That document advantage disappeared on the full held-out sample.
- The two samples agree on failure-inclusive passage recall at their shared caps. On matched successful exploratory groups, both live arms beat seeds-only on passage recall at 16 KB. At 32 KB both won on lenient recall with three topics and backfill won on strict and .90 recall with five. Backfill also won on lenient recall with five topics at 80 KB. No matched-success passage gain replicated on the held-out sample. The 8 KB exploratory gain was outside the held-out design.

## Design and spend

The explorer received the shared byte and source-unit caps, fixed-source usage, and advisory counts for merged reads and submitted selections. Its coverage instruction spans all open questions. Backfill retained every admitted live source and appended canonical windows from remaining seed documents, centered on matching question or keyword terms. Window ranking favored distinct matching terms, then total hits, with position as the tie breaker. The existing 16-unit limit, reserved lane and tool contracts applied at all caps. The paired arm used the same exploration and zero extra model calls.

The held-out selector drew 20 cases per enterprise from the pinned benchmark with seed `vantage-heldout-20261122`. It verified zero overlap with the prior 100 on canonical IDs, source rows and normalized question strings. Semantic near-duplicates were unassessed. Each cohort has 30 three-topic groups (90 placements, with two remainders per enterprise) and 20 five-topic groups (100 placements). The retrieval runner received only questions and workspace metadata. Labels stayed in offline sampling and scoring, and corpus text and captures remain in the local cache.

All 600 free attempts ran first. Azure GPT-6 Luna then attempted all 300 explorations and produced 300 paired backfill outcomes. The 123 failed explorations (72 exploratory, 51 held-out) share the `provider_or_submission` code. The ledger has 43 requests without an HTTP response or usage. A shared hold could also fail peers in the four-group wave. Continuation retained the full unknown reserves and resumed unopened jobs. There were no retries of captured jobs, paid digest calls, embeddings, Generator or Judge calls.

Preflight projected **$8.95** against **$10**. At completion, conservative exposure was **$5.55** ($4.85 settled plus $0.70 unresolved). Azure returned native usage for 1,237 of 1,280 calls, totaling 14,107,168 input and 689,241 output tokens. At the published Global Standard short-context rates, metered usage prices to $0.96. The invoice total remains unverified. [Azure pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)

## Verification

Retrieval and scoring were locked in `cb129dc2`. The `39a7e4d2` continuation commit changed capture recovery and metering before the held-out results were scored. No retrieval or scoring settings changed after review. All 1,200 arm rows matched their planned cells and all 300 live pairs preserved lineage. There were zero cap violations or byte-count discrepancies. Observed maxima were 8,000, 16,000, 32,000 and 79,964 bytes.

Passed 384 Vantage server tests without Postgres, 44 offline loader, grouping and scorer tests, and 45 importer tests. Web TypeScript had zero diagnostics and changed TypeScript passed lint. A broader web Jest invocation encountered a Better Auth ESM loader error outside the Vantage suites. This experiment measured retrieval through freeze.
