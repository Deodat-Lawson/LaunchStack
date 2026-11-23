# Northstar v2 long-document retrieval

**Question-centered windows improved held-out retrieval at every cap.** At 80 KB, seeds-windows froze 36/45 supporting versions, recovered 35/78 exact sentences, and froze both versions in 6/12 two-document case occurrences. Seeds-only froze 33/45 versions and recovered no exact sentences. All required versions reached the catalogue in the observed runs.

The comparison captured 117 of 270 scheduled snapshots. The two deterministic arms completed both splits. The live variants each recovered all seven sentences in the same three-topic dev group at all three caps. The $5 forecast guard stopped live dispatch before the next group. The remaining 153 live snapshots, including every held-out live snapshot, are unrun.

## Corpus and method

The approved spec has 150 fictional documents, 212 versions, 30 cases split 15/15, and 12 cases requiring two documents. The three cutoffs have 80, 111, and 142 readable non-fixed candidates, each with eight required supporting documents outside the newest 50. The production catalogue had 50 entries in every observed run. Its 2 MB body-loading limit bounds lexical ranking to about 66 documents at these sizes. The benchmark scores what was offered and frozen. Titles may include the shared project or site name and a plain document description. A token check excluded other distinctive question words from supporting and distractor titles. [Approved spec at `217ef970`](../../fixtures/vantage-benchmarks/long-decisions/spec-v2.json)

The generator supplied neutral briefs and markers to Azure GPT‑6 Luna, then inserted the exact sentences locally. All 164 labelled blocks and the placement and uniqueness checks passed across 212 files of 29,718–30,691 bytes. Dates or numbers appear in 88.2% of filler sentences, 77.8% of supporting sentences, and 84.6% of distractor sentences. Twelve of 40,786 sentences repeat across versions (0.029%). All 212 versions replayed byte for byte from 1,060 accepted generation sections. The recurring administrative paragraph structure and occasional awkward phrasing limit realism. Numeric and date parity measures one cue. The generated corpus and individual captures are in external local storage. [Corpus lock](../../fixtures/vantage-benchmarks/long-decisions/corpus-lock-v2.json) · [Validation](vantage-topic-first-long-decisions-v2-validation.json)

Each split has six three-topic groups and three five-topic groups, with 33 topic occurrences per cap. The 16, 32, and 80 KB caps are decimal UTF‑8 text budgets, with at most 16 source units and two scoped fixed sources. The three live variants share an exploration. The hybrid keeps explorer excerpts, adds question-centered windows inside the selected documents, then fills in seed order. Retrieval uses the public corpus and questions. The offline scorer uses the labels.

## Deterministic results

“Found” requires the labelled version to be frozen. “Exact” requires the sentence to occur within a frozen excerpt from that version. “Both” counts two-document case occurrences with both labelled versions frozen. Every row offered 45/45 required versions and both required versions in 12/12 such occurrences. No deterministic row recovered all labelled sentences from both documents in a two-document case. Distractors count selected version occurrences, in order of superseded status, conflicting definition, similar project, and restricted document. They are descriptive counts. [Aggregate by split, cap, arm, and group size](vantage-topic-first-long-decisions-v2-results.json)

| Split | Cap (KB) | Arm | Found | Exact | Both | Topics with zero exact | Distractors by type | Median bytes |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- | ---: |
| Dev | 16 | seeds-only | 4/45 | 0/78 | 0/12 | 33 | 3 / 2 / 0 / 0 | 12,549 |
| Dev | 16 | seeds-windows | 7/45 | 2/78 | 1/12 | 32 | 5 / 3 / 2 / 0 | 16,000 |
| Dev | 32 | seeds-only | 11/45 | 0/78 | 2/12 | 33 | 13 / 8 / 3 / 0 | 30,549 |
| Dev | 32 | seeds-windows | 12/45 | 8/78 | 2/12 | 29 | 15 / 14 / 3 / 0 | 32,000 |
| Dev | 80 | seeds-only | 33/45 | 0/78 | 5/12 | 33 | 23 / 22 / 21 / 0 | 78,557 |
| Dev | 80 | seeds-windows | 34/45 | 26/78 | 6/12 | 19 | 24 / 24 / 23 / 0 | 80,000 |
| Held-out | 16 | seeds-only | 4/45 | 0/78 | 0/12 | 33 | 0 / 1 / 4 / 0 | 12,549 |
| Held-out | 16 | seeds-windows | 11/45 | 8/78 | 0/12 | 29 | 0 / 1 / 6 / 0 | 16,000 |
| Held-out | 32 | seeds-only | 18/45 | 0/78 | 1/12 | 33 | 6 / 3 / 9 / 0 | 30,549 |
| Held-out | 32 | seeds-windows | 20/45 | 18/78 | 1/12 | 24 | 7 / 6 / 11 / 0 | 32,000 |
| Held-out | 80 | seeds-only | 33/45 | 0/78 | 5/12 | 33 | 23 / 20 / 24 / 0 | 78,553 |
| Held-out | 80 | seeds-windows | 36/45 | 35/78 | 6/12 | 15 | 24 / 20 / 24 / 0 | 80,000 |

At 80 KB, held-out seeds-windows recovered 25/42 exact sentences in triples and 10/36 in quintets. Its two-document coverage was 5/6 in triples and 1/6 in quintets.

## Matched live dev results

The only observed group was a week-one triple, with four required supporting versions, seven labelled sentences, and one two-document case. All four supporting versions were offered. In this group, seeds-only found 1, 3, and 4 versions at the three caps and recovered zero exact sentences. Seeds-windows found 2, 3, and 4 versions and recovered 0, 2, and 2 sentences. Each live variant recovered the exact evidence from both documents in the two-document case. The table describes this group only.

| Cap (KB) | Arm | Found | Exact | Both | Topics with zero exact | Distractors by type | Frozen bytes |
| ---: | --- | ---: | ---: | ---: | ---: | --- | ---: |
| 16 | live | 4/4 | 7/7 | 1/1 | 0 | 2 / 2 / 0 / 0 | 11,249 |
| 16 | live+backfill | 4/4 | 7/7 | 1/1 | 0 | 3 / 2 / 0 / 0 | 16,000 |
| 16 | live-docs+windows | 4/4 | 7/7 | 1/1 | 0 | 2 / 2 / 0 / 0 | 16,000 |
| 32 | live | 4/4 | 7/7 | 1/1 | 0 | 2 / 2 / 0 / 0 | 7,829 |
| 32 | live+backfill | 4/4 | 7/7 | 1/1 | 0 | 3 / 2 / 0 / 0 | 13,829 |
| 32 | live-docs+windows | 4/4 | 7/7 | 1/1 | 0 | 2 / 2 / 0 / 0 | 30,279 |
| 80 | live | 4/4 | 7/7 | 1/1 | 0 | 3 / 1 / 0 / 0 | 4,154 |
| 80 | live+backfill | 4/4 | 7/7 | 1/1 | 0 | 3 / 1 / 1 / 0 | 10,164 |
| 80 | live-docs+windows | 4/4 | 7/7 | 1/1 | 0 | 3 / 1 / 0 / 0 | 27,316 |

All 117 observed snapshots completed without a failed or degraded run, retained both fixed sources, and met the byte and unit caps. There were zero restricted disclosures in observed catalogues, digest access, excerpt reads, and frozen evidence.

## Spend and verification

Generation exposure was **$1.4752 of $5** including $0.0101 reserved for three no-response requests. The ledger recorded 1,193 settled requests. Four initial prose drafts failed density validation, and their costs are included. The structured renderer and recovery policies were finalized before retrieval.

Comparison exposure was **$0.8773 of $5** including $0.0458 reserved for three digest connection resets. The ledger recorded 170 settled digest requests, 22 settled exploration requests, 1,555,130 input tokens, and 405,487 output tokens. Exploration took a median 54.7 seconds across three runs. The forecast rose from $3.3302 to **$6.2962** after the first three explorations. The stop used the observed padded p90 for 51 remaining explorations, plus 34 cold digest estimates. Charges use conservative Azure list rates. [Azure pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)

The digest resumes reused saved results and retained the full unresolved reservations. The SDK transport recovery fix at `fa03798c` changed only no-response attribution. The same deterministic schedule then completed held-out once with zero provider calls, and its dev replay reproduced all 54 original deterministic captures. No retrieval settings changed after held-out. Offline rescoring produced byte-identical aggregates. Verified 253 focused Jest tests, 80 pipeline tests, 11 importer tests, 14 scorer tests, zero web TypeScript diagnostics, and zero changed-web-file lint warnings.
