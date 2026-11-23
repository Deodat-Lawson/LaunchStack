# Northstar v2 long-document retrieval

**All 270 snapshots are measured.** The resume finished 24 dev and 27 held-out explorations for **$2.8875** at published list rates, including unresolved reservations. The prior 117 snapshots were reused, and comparison spend across both runs was **$3.7648**. All 54 explorations completed with traces.

On held-out data, the three live arms tied on exact recall at each cap. They recovered 62/78, 60/78, and 59/78 sentences at 16, 32, and 80 KB. Seeds-windows recovered 8/78, 18/78, and 35/78. Plain live used the fewest frozen bytes among the live variants at every cap. Live+backfill froze the most supporting versions and the most pairs, with a higher median byte count.

## Corpus and method

The approved spec contains 150 fictional documents, 212 versions, 15 dev cases, and 15 held-out cases. Twelve cases require two supporting documents. The three cutoffs have 80, 111, and 142 eligible readable non-fixed candidates and eight required supporting documents outside the newest 50 at each cutoff. Every observed catalogue had 50 entries. The existing 2 MB body-loading limit bounds lexical full-text ranking to about 66 documents at these sizes. Titles carry the shared project or site name and plain document descriptions. [Approved spec at `217ef970`](../../fixtures/vantage-benchmarks/long-decisions/spec-v2.json)

All 164 labelled blocks passed placement and uniqueness checks across 212 files of 29,718–30,691 bytes. The versions replayed byte for byte from 1,060 accepted generation sections. Dates or numbers appear in 88.2% of filler sentences and 77.8% of supporting sentences. Twelve of 40,786 sentences repeat across versions (0.029%). The recurring administrative paragraph structure and occasional awkward phrasing limit realism. Generation exposure was $1.4752 in a separate ledger. Corpus text and individual captures stay in external local storage. [Corpus lock](../../fixtures/vantage-benchmarks/long-decisions/corpus-lock-v2.json) · [Validation](vantage-topic-first-long-decisions-v2-validation.json)

Each split has six three-topic groups and three five-topic groups, with 33 topic occurrences per cap. The 16, 32, and 80 KB caps are decimal UTF-8 text budgets with at most 16 source units and two scoped fixed sources. The live variants share an exploration. Live-docs+windows keeps the explorer excerpts, adds question-centered windows in the selected documents, then fills in seed order. Retrieval uses the public corpus and questions, and the offline scorer applies the labels. The resume followed the original schedule and settings, with all dev jobs terminal before held-out. Per-split reviewer creation completed before any parallel exploration to preserve the authority epoch.

## Results

“Found” requires the labelled version to be frozen. “Exact” requires a literal match within an excerpt from that version. “Both” counts two-document case occurrences with both labelled versions frozen. All rows offered 45/45 required versions and both versions in 12/12 two-document occurrences. Except for dev exact recall, the table shows held-out metrics. Distractors count selected version occurrences in order of superseded status, conflicting definition, similar project, and restricted document. [Full aggregates by split, cap, arm, and group size](vantage-topic-first-long-decisions-v2-results.json)

| Cap (KB) | Arm | Dev exact | Found | Exact | Both | Topics with zero exact | Distractors by type | Median bytes |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 16 | seeds-only | 0/78 | 4/45 | 0/78 | 0/12 | 33 | 0 / 1 / 4 / 0 | 12,549 |
| 16 | seeds-windows | 2/78 | 11/45 | 8/78 | 0/12 | 29 | 0 / 1 / 6 / 0 | 16,000 |
| 16 | live | 67/78 | 34/45 | 62/78 | 3/12 | 2 | 17 / 21 / 7 / 0 | 8,329 |
| 16 | live+backfill | 67/78 | 36/45 | 62/78 | 4/12 | 2 | 20 / 23 / 11 / 0 | 16,000 |
| 16 | live-docs+windows | 67/78 | 34/45 | 62/78 | 3/12 | 2 | 17 / 21 / 8 / 0 | 16,000 |
| 32 | seeds-only | 0/78 | 18/45 | 0/78 | 1/12 | 33 | 6 / 3 / 9 / 0 | 30,549 |
| 32 | seeds-windows | 8/78 | 20/45 | 18/78 | 1/12 | 24 | 7 / 6 / 11 / 0 | 32,000 |
| 32 | live | 69/78 | 34/45 | 60/78 | 5/12 | 4 | 14 / 19 / 7 / 0 | 9,061 |
| 32 | live+backfill | 69/78 | 38/45 | 60/78 | 7/12 | 4 | 20 / 21 / 18 / 0 | 27,295 |
| 32 | live-docs+windows | 69/78 | 34/45 | 60/78 | 5/12 | 4 | 14 / 19 / 8 / 0 | 32,000 |
| 80 | seeds-only | 0/78 | 33/45 | 0/78 | 5/12 | 33 | 23 / 20 / 24 / 0 | 78,553 |
| 80 | seeds-windows | 26/78 | 36/45 | 35/78 | 6/12 | 15 | 24 / 20 / 24 / 0 | 80,000 |
| 80 | live | 66/78 | 33/45 | 59/78 | 5/12 | 5 | 16 / 20 / 13 / 0 | 8,930 |
| 80 | live+backfill | 68/78 | 37/45 | 59/78 | 7/12 | 5 | 23 / 22 / 21 / 0 | 28,999 |
| 80 | live-docs+windows | 67/78 | 35/45 | 59/78 | 6/12 | 5 | 19 / 20 / 14 / 0 | 61,931 |

On held-out at 80 KB, seeds-windows froze 36/45 supporting versions and both versions in 6/12 cases. Plain live froze 33/45 and both in 5/12, while recovering 59/78 exact sentences. Live+backfill raised the version count to 37/45 and the joint count to 7/12. Across the three caps, each live variant recovered all labelled sentences from both documents in 3/12, 5/12, and 5/12 held-out cases. Seeds-windows recovered 25/42 exact sentences in 80 KB triples and 10/36 in quintets. All three live variants recovered 34/42 and 25/36 on those groups.

All 270 snapshots met the byte and unit caps and retained both fixed sources. Observed catalogues, digest access, excerpt reads, and frozen evidence had zero restricted disclosures. There were zero failed, degraded, or unmeasured snapshots.

## Spend, concurrency, and verification

The resume used `--resume --post-settlement --digest-workers 2` with Azure GPT-6 Luna. The gate counted reported usage and full reservations for missing usage after settlement, with a $20 threshold for new requests. The threshold was never crossed. The resume settled 365 requests and retained ten unresolved reservations across 375 native attempts. It recorded 7,375,581 input tokens and 271,961 output tokens. Reported usage cost **$2.4574** and unresolved reservations added **$0.4301**. The total includes 16 new digest requests for $0.0595. The held-out warm-up reused 157 cached digests. All amounts use the existing conservative published rates of $0.30 per million input tokens and $0.90 per million output tokens. [Azure list rates](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)

Peak exploration concurrency was **four**. Three connection resets in the first 20 requests triggered the permanent drop to **two** new admissions, while the active jobs drained. Six explorations were admitted under the limit of four and 45 under the limit of two. The resume recorded **10 connection resets, zero HTTP 429s, and zero HTTP 5xx responses**. Ten retry attempts across six logical requests recovered all six. The largest rolling window had four failures. Median and p90 exploration times were 66.7 and 115.2 seconds for resumed dev, and 59.6 and 87.2 seconds for held-out.

The hashes of all 111 pre-resume capture files match, and the ledger has no new requests for the three previously captured live jobs. Two offline rescoring passes produced byte-identical aggregates. Verified 261 focused Jest tests, 80 pipeline tests, 11 importer tests, 14 scorer tests, zero web TypeScript diagnostics, and clean changed-file lint. Synthetic checks exercised the post-settlement threshold crossing and in-flight drain, which the live run stayed below. [Resume implementation at `2e37bcd7`](../../apps/web/scripts/vantage-long-decisions-run.ts)
