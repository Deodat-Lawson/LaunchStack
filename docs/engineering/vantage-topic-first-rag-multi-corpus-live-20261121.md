# Vantage RAG-Multi-Corpus rescoring and Azure pilot

Azure GPT-6 Luna recovered 4 of 6 strict passages, compared with 3 of 6 for each free topic-first arm. It recovered 6 of 21 lenient passages at both thresholds and froze 16 of 20 cases. The final conservative exposure was $0.7730 against the $15 cap.

## Scoring and free arms

The document metric scores the offered and frozen version for every fact with a resolved filename. Strict passage recall retains whole-case eligibility and exact or normalized containment. It scores 6 facts in 6 pilot cases and 33 facts in 29 larger-sample cases. Document and lenient recall cover 21 facts in 20 pilot cases and 117 facts in 99 larger-sample cases. The strict scores from the earlier report reproduced unchanged. [Corpus and original evaluation](vantage-topic-first-rag-multi-corpus-20261121.md)

Lenient recall uses the best contiguous window in one frozen evidence unit of the labelled document/version. It divides the overlap of Unicode NFKC, lowercased word-token multisets by the label token count. The window is at most as long as the label. The 0.80 threshold tolerates up to one fifth of the label tokens being missing or changed. The 0.90 sensitivity check tolerates one tenth. All 18 exact and 21 normalized pinned-source matches in the 100-case sample scored 1.0 on their source, including all seven positive controls in the pilot. These controls test preservation of known matches. Lenient scores measure lexical overlap and do not establish answer equivalence.

| Sample | Arm | Cases | Offered / resolved | Selected / resolved | Strict exact + normalized / eligible | Lenient .80 / .90 | Frozen docs / excerpts | Frozen bytes | Failures |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 20 | Baseline | 20 | 17/21 | 1/21 | 0 + 0 / 6 | 0/21 · 0/21 | 53 / 0 | 114,388 | 0 |
| 20 | Seeds | 20 | 20/21 | 9/21 | 1 + 2 / 6 | 4/21 · 4/21 | 316 / 296 | 1,142,041 | 0 |
| 20 | Scripted | 20 | 20/21 | 9/21 | 1 + 2 / 6 | 4/21 · 4/21 | 294 / 300 | 804,743 | 0 |
| 100 | Baseline | 100 | 87/117 | 4/117 | 0 + 0 / 33 | 1/117 · 0/117 | 260 / 0 | 574,100 | 0 |
| 100 | Seeds | 100 | 111/117 | 45/117 | 4 + 5 / 33 | 16/117 · 13/117 | 1,580 / 1,480 | 5,863,660 | 0 |
| 100 | Scripted | 100 | 111/117 | 41/117 | 4 + 3 / 33 | 15/117 · 12/117 | 1,460 / 1,500 | 4,033,300 | 0 |
| 20 | Azure live | 20 | 20/21 | 14/21 | 2 + 2 / 6 | 6/21 · 6/21 | 33 / 21 | 10,210 | 4 |

Frozen totals cover every attempt shown and include fixed sources where applicable. Both serial larger-sample captures had identical scores across 300 case–arm pairs. The original and concurrent diagnostic runs, smoke run and configured dry run were also rescored separately. Enterprise and category breakdowns include case and fact denominators, frozen counts and failures. [Aggregate results](vantage-rag-multi-corpus-scoring-live-results-20261121.json)

## Azure configured-live pilot

All routes resolved to `gpt-6-luna` on `launchstack-cn-080d51e6.openai.azure.com`. Default and digest used Chat Completions with medium reasoning. The benchmark exploration adapter preserved high reasoning and function tools through Azure Responses with `store:false`. It replays the returned opaque reasoning state and tool outputs. The product route and 150-second shared digest/exploration deadline were unchanged. Each request had a 6,000-output-token cap. [Azure reasoning support](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning?tabs=csharp%2Cgpt-5&view=foundry-classic)

Preflight ran without inference and estimated $0.87 from the previous 215-digest and 156-exploration-call dry run at Global Standard short-context rates. Padding to 240 exploration calls and 6,000 output tokens per request gave $5.73 at $0.30 input and $0.90 output per million tokens, without cache discounts. Those rates bound the published Standard input and output rates including EU long-context cache writes. Actual requests were reserved against the $15 cap before dispatch. [Azure GPT-6 Luna pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)

```powershell
Set-Location apps/web
$cache = Join-Path $env:TEMP 'vantage-rag-multi-corpus-39071af3'
$env:CHAT_MODELS_CONFIG = 'config/chat-models.azure.yaml'
$env:VANTAGE_TOPIC_FIRST_DIGEST_ROUTE = 'default'
$env:VANTAGE_TOPIC_FIRST_EXPLORATION_ROUTE = 'reasoning'
node ../../node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/vantage-benchmark-run.ts --arm configured-live --preflight-live
node ../../node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/vantage-benchmark-run.ts --cache $cache --requests pilot20-requests.json --output live-pilot20.json --arm configured-live --approve-live --cold-digests --end-to-end 0
```

The command uses the existing `CHAT_BASE_URL` and `CHAT_API_KEY`. Case 1 reached the shared deadline with one request outstanding. The resume command replaced `--cold-digests` with `--resume-live` and kept all other flags. The runner preserved that request’s full $0.0350 reservation and the successful digest cache, then continued at case 2. The padded cumulative estimate before continuation was $5.85.

The runner attempted all 20 cases and froze 16 snapshots. Cases 1, 2 and 4 timed out with cold digests. Case 18 exceeded the eight-call per-turn limit. All 15 warm cases reached exploration with cached digests, and 14 froze. Cold digest stages took 66–124 seconds of the shared 150-second deadline. No Generator, Judge or embedding calls were made.

| Route | Requests | Native input tokens | Native output tokens | Global Standard list-rate estimate |
|---|---:|---:|---:|---:|
| Digest | 215 | 276,901 | 227,110 | $0.1461 |
| Exploration | 160 | 1,106,690 | 65,580 | $0.0674 |
| Total | 375 | 1,383,591 | 292,690 | $0.2135 |

Azure reported usage for 372 requests. The reported input includes 902,153 cached tokens and 398,464 cache-write tokens. Output includes 112,072 reasoning tokens. The three aborted exploration requests have unresolved native usage. Their full reservations total $0.0945. Settled usage priced at the conservative rates was $0.6785, for a final exposure of **$0.7730** including those reservations. Dollar values are list-rate estimates and the invoice total remains unverified.

| Stage | Samples | Median (ms) | p95 (ms) |
|---|---:|---:|---:|
| Setup | 20 | 5 | 6 |
| Collect | 20 | 45 | 77 |
| Reserve | 20 | 22 | 27 |
| Digest | 20 | 241 | 114,856 |
| Exploration | 20 | 34,978 | 67,612 |
| Freeze | 16 | 48 | 227 |
| Finalize | 16 | 6 | 29 |
| Whole case | 20 | 48,021 | 150,120 |

The model returned 272 tool calls. Traces recorded 253 requests (20 topic, 70 digest, 134 excerpt and 29 submit). Case 18 exceeded the per-turn cap before its second response was recorded, accounting for the 19-call difference. Recorded tool execution returned 15 not-offered digest responses and 48 invalid excerpt ranges. The final report counts successful freezes independently of submission requests.

- **Hit, case 8.** The model read catalogue document 4 and retried after an invalid submission. The frozen span `[1800,2165)` covered the exact label `[1835,1992)`. Two excerpts and the fixed source froze after eight model responses.
- **Miss, case 6.** The model fetched the labelled document’s digest at catalogue position 24, then read and froze excerpts only from position 25. Two reads were rejected for being shorter than 200 characters.
- **Failure, case 1.** Digests consumed 96.2 seconds and exploration consumed 53.8 seconds. Eleven responses returned before the deadline. The model read overlapping spans in one document and made no submission. The trace and digests were saved, and the outstanding response’s cost remains reserved.

The raw capture `live-pilot20.json` and peer directory `live-pilot20.evidence/` are in the external cache. The archive contains all 20 traces, 16 snapshots and 215 digests. A read-only integrity check verified all 23 files and the recorded tool-result hashes. The aggregate JSON includes the file hashes and the latency distributions.

## Candidate gaps

The counterfactual ranks question-only BM25 for offline evaluation (`k1=1.2`, `b=.75`, title weight 3, deterministic path tie-break) and replays each arm’s offer limits. It estimates offer recovery under those limits. The retriever’s seed order remains the same. Pilot case ordinals are the first 20 in the larger sample.

- **Topic-first free arms, 100 cases.** ZX Bank label documents for cases 14, 39, 65, 69, 83 and 96 were ranked 61, 54, 57, 64, 54 and 53 by the existing recency tie-break and fell outside its 50-document catalogue. The counterfactual recovered all six offers (111→117 of 117 resolved facts, six cases). Case 72 had an unresolved filename. In the pilot, only case 14 was outside the topic-first catalogue. Its offer was recovered (20→21 of 21 facts, one case).
- **Baseline, 100 cases.** Cases 14, 23, 39, 43, 65, 69, 83 and 96 were outside the 128 KB acquisition budget. The counterfactual recovered all eight (87→95 of 117 resolved facts, eight cases). The 6,000-character reader limit excluded cases 1, 7, 13, 25, 29, 35, 37×2, 48, 56, 57, 62, 68, 73, 77, 85×2, 86×2, 92×2 and 98. Case 72 had an unresolved filename. In the pilot, cases 1, 7 and 13 were limited by the reader and case 14 by acquisition (17→18 of 21 facts, one case recovered). No gap was attributed to the baseline 64-candidate cap.
- **Azure live, 20 cases.** All 20 catalogues matched the scripted arm in order and content, including four attempts that failed after collection. Case 14 was the only gap. The counterfactual recovered its offer, increasing filename-resolved offers from 20 to 21. Among the seven individually verifiable passages, it increased offers from six to seven.

## Verification

- Scoring and counterfactual `18671cf2`, Azure adapter and budget ledger `eb589112`, accounting and integrity `3d5a307d`, and catalogue attribution after freeze failures `05f07642`.
- Passed 45 importer tests, 28 loader and evaluator tests, and 88 focused web Jest tests. Web TypeScript produced zero diagnostics. Changed TypeScript lint passed. A broader Jest invocation hit a Better Auth ESM parse error and was stopped.
- Verified the pinned corpus hashes and isolated DB inventory before both live invocations. The scoring rerun reproduced the two saved free passes and consumed zero additional model calls. The benchmark kept labels in the offline evaluator, and raw evidence and corpus files remain in the external cache.
