# Vantage topic-first RAG-Multi-Corpus close-out

## What changed across the rounds

- **Pilot.** The 20-case live pilot recovered 4/6 strict passages and froze 16/20 cases. Moving digest preparation out of exploration and fixing the tool limit and seed order produced 5/6 strict passages and 20/20 freezes on the matched pilot. [Initial pilot](vantage-topic-first-rag-multi-corpus-live-20261121.md) and [Follow-up](vantage-topic-first-rag-multi-corpus-100-live-20261121.md)
- **100 cases.** Live selected 94/99 labelled documents and recovered 20/33 strict passages. Deterministic seeds reached 99/99 and 33/33. Live used a median 939 bytes against 55,516 for seeds. [100-case run](vantage-topic-first-rag-multi-corpus-100-live-20261121.md)
- **Contested 80 KB.** Live selected more supporting documents with five topics (87/99 vs 85/99). Seeds had higher strict recall with three topics (30/32 vs 21/32) and five (28/33 vs 21/33). [Contested budget](vantage-topic-first-contested-budget-20261122.md)
- **Sweep and reliability.** The four-wide sweep lost 123/300 live attempts to no-response and shared-hold failures, and seeds-only led held-out passage recall at 16 and 80 KB. The serial follow-up lost 1/76 to non-submission and recovered all 26 eligible 16 KB failures. The new fallback reserves time for a submission-only turn and uses the ordinary authorized freeze for already-read excerpts if submission fails. [Sweep](vantage-topic-first-budget-sweep-20261122.md) and [Reliability](vantage-topic-first-reliability-20261122.md)

## Final held-out comparison

| Shared cap / topics | Seeds-windows | Live | Live+backfill | Live-docs+windows (offline) |
|---|---:|---:|---:|---:|
| 8 KB / 3 | 49/90 / 19/30 | 72/90 / 18/30 | 75/90 / 19/30 | 73/90 / 21/30 |
| 8 KB / 5 | 41/99 / 16/32 | 84/99 / 13/32 | 86/99 / 13/32 | 84/99 / 13/32 |
| 16 KB / 3 | 68/90 / 24/30 | 75/90 / 18/30 | 80/90 / 19/30 | 78/90 / 26/30 |
| 16 KB / 5 | 50/99 / 20/32 | 83/99 / 17/32 | 85/99 / 18/32 | 83/99 / 22/32 |

Each cell gives **supporting documents / strict passage facts**, with failures counted as zero. The offline arm reused saved live choices, including the transport reruns, kept all 670 original excerpt ranges and 99 fixed sources, added question-centered windows, then filled remaining space in seed order. It retained the original failed attempt. Two replays matched byte for byte, with zero model calls.

At 16 KB the offline arm recovered **26/30 and 22/32** strict facts, ahead of all three table references and one fact ahead of historical seeds-only in each group size. At 8 KB it improved on live+backfill with three topics. With five, it tied live+backfill and recovered three fewer strict facts than seeds-windows. Live+backfill kept two more supporting documents in each cell. [Full counts, lenient recall, bytes and paired deltas](vantage-topic-first-rag-multi-corpus-summary-results-20261122.json)

## Default and remaining validation

**Use deterministic question-ranked retrieval by default.** For this short-document profile, use seeds-only at 16 KB and seeds-windows when limited to 8 KB. Keep model-assisted discovery opt-in. The hybrid's 16 KB gain makes it a candidate for long-document validation. Keep the existing 80 KB safety ceiling until that test.

This benchmark measures supporting-document discovery and passage recovery under a shared cap. Its 236 ingested Markdown files have a median of 3.5 KB and a maximum of 21.9 KB. Questions have one answer target and labels often closely match their wording. Strict eligibility covers only 29 questions in the original 100-case set. Lenient overlap measures wording, while live runs ended at evidence freeze. Report quality, multi-document synthesis and production-scale access behavior remain unverified.

The next evaluation should use an untouched realistic corpus of 25 to 35 KB and longer documents with deep, paraphrased evidence, cross-document dependencies, current and stale versions, conflicting metric definitions, and restricted sources. Evaluate 3- and 5-topic contention, passage recall and access checks, then separately evaluate generated reports, latency and cost.

Verified 400 scored rows and 16 cells with zero cap violations. Passed 463 Vantage web tests, 58 offline tests, 45 importer tests and 29 agent tests. Web TypeScript and changed web lint passed.
