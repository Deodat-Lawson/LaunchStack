# Northstar long-document retrieval evaluation

**Plain live was the most evidence-efficient arm on this corpus.** All three live variants tied on strict recall at every cap in both splits. On held-out runs, plain live recovered 32/32 sentences at 16 and 32 KB and 31/32 at 80 KB. It used a median 4.1, 7.1, and 6.8 KB, respectively. The hybrid selected fewer distractors than live+backfill at each held-out cap.

## Corpus

The Northstar Freight Systems spec was committed as `4a471538` before inference. It defines 50 fictional documents, 62 versions across three weeks, six development cases, and six held-out cases. Each case has two supporting sentences and three labelled distractors. All groups use the week-three cutoff. This exercises version supersession, with two fixed sources in every snapshot. [Case spec](../../fixtures/vantage-benchmarks/long-decisions/spec.json)

Azure GPT-6 Luna drafted prose in five sections per version using the neutral title and brief. The local assembler inserted the exact sentences at opaque markers and validated ownership, depth, size, and repetition. The 62 files range from 29,762 to 30,732 bytes. Anchor starts span 31.5% to 74.6% by byte offset. All 50 anchor blocks passed, with zero label leaks and one repeated sentence out of 13,199 (0.008%). All 68 lock entries were independently hash-checked. Corpus text and raw captures stay in the external cache `vantage-northstar-long-decisions-4a471538`. [Validation](vantage-topic-first-long-decisions-corpus-validation-20261122.json) · [Corpus lock](../../fixtures/vantage-benchmarks/long-decisions/corpus-lock.json)

Generation used 312 settled Azure requests and six with no HTTP response. The conservative charge was $0.3322 for reported usage and $0.0266 reserved for unresolved requests, or **$0.3588 total exposure** against $3. The canary led to paragraph-boundary fitting using the saved drafts. The transport recovery preserved the six reservations and consumed attempts, then used two workers. [Azure pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)

## Method

Each split has two groups of three and two groups of five, with declared overlap between the five-topic groups. Each arm and cap has 16 topic occurrences per split. The three live variants share one exploration per group and cap. The production fitter returns plain live and live+backfill comparison snapshots in the same authorization transaction and commits the hybrid freeze. The hybrid keeps original evidence, adds question-centered windows in explorer-selected documents, then fills from seed order. Enable it with `VANTAGE_TOPIC_FIRST_EVIDENCE_STRATEGY=live-docs+windows` when topic-first is enabled.

Each group shares 16, 32, or 80 KB of UTF-8 text, including the two scoped fixed sources, and a maximum of 16 source units. The allow-listed review actor can read 46 of the 50 documents. The scorer counts a supporting document only at the labelled version and a sentence only when it appears exactly within a frozen unit from that version. Zero evidence means no labelled sentence in the shared snapshot. Distractors are counted by selected labelled document version. The evaluation uses distinct cases within each split, one supporting document per case, and one company. The generated prose avoids unrelated quantitative claims, which may make the labelled numbers stand out.

## Results

Each row combines the 3- and 5-topic groups. Document recall, zero-evidence topics, distractors, and median bytes in this table are held-out. Full metrics for both splits and both group sizes are in the aggregate file. [Aggregate results](vantage-topic-first-long-decisions-results-20261122.json)

| Cap (KB) | Arm | Dev exact | Held-out exact | Supporting docs | Zero evidence | Distractors | Median bytes |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | seeds-only | 0/32 | 0/32 | 3/16 | 16/16 | 2 | 12,481 |
| 16 | seeds-windows | 10/32 | 8/32 | 6/16 | 12/16 | 2 | 16,000 |
| 16 | live | 32/32 | 32/32 | 16/16 | 0/16 | 0 | 4,065 |
| 16 | live+backfill | 32/32 | 32/32 | 16/16 | 0/16 | 4 | 16,000 |
| 16 | live-docs+windows | 32/32 | 32/32 | 16/16 | 0/16 | 1 | 15,984 |
| 32 | seeds-only | 0/32 | 0/32 | 7/16 | 16/16 | 5 | 30,506 |
| 32 | seeds-windows | 18/32 | 11/32 | 7/16 | 10/16 | 7 | 32,000 |
| 32 | live | 32/32 | 32/32 | 16/16 | 0/16 | 1 | 7,081 |
| 32 | live+backfill | 32/32 | 32/32 | 16/16 | 0/16 | 8 | 32,000 |
| 32 | live-docs+windows | 32/32 | 32/32 | 16/16 | 0/16 | 2 | 32,000 |
| 80 | seeds-only | 0/32 | 0/32 | 10/16 | 16/16 | 14 | 78,555 |
| 80 | seeds-windows | 20/32 | 13/32 | 10/16 | 9/16 | 14 | 80,000 |
| 80 | live | 32/32 | 31/32 | 16/16 | 0/16 | 0 | 6,798 |
| 80 | live+backfill | 32/32 | 31/32 | 16/16 | 0/16 | 10 | 45,891 |
| 80 | live-docs+windows | 32/32 | 31/32 | 16/16 | 0/16 | 4 | 58,225 |

All 120 snapshots completed without degradation. Every catalogue contained 44 documents, every freeze retained both fixed sources, and all freezes met both caps. There were zero restricted disclosures in the catalogue, digest access, read results, and frozen evidence. All selected distractors were wrong-definition versions. The prefix arm's first 6,000 characters cannot reach this corpus's deep anchors.

## Cost and verification

The locked schedule ran dev first, then held-out once with identical settings. Azure GPT-6 Luna used medium reasoning for digest Chat Completions and high reasoning for exploration Responses. Preflight projected $2.7575 against $5. The comparison used 44 settled digest requests, two digest requests with unresolved usage, and 119 settled exploration requests. The reported tokens were 1,440,795 input and 131,665 output. Upper list rates give $0.5507 settled plus $0.0304 reserved, or **$0.5812 total exposure**. Median and p90 exploration times were 27.2 and 46.4 seconds. [Azure pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)

Warm-up resumed before the first live exploration after socket resets and a Windows atomic-rename interruption. The original dev captures and settled digest were reused. The two requests with no HTTP response kept their full reserves. The interrupted reservation had no dispatch. The resume changes did not alter retrieval settings.

Verified 245 focused Jest tests, 80 pipeline tests, eight scoring tests, zero web TypeScript diagnostics, changed-file lint, and byte-identical offline rescoring. The comparison endpoint was the frozen evidence snapshot.
