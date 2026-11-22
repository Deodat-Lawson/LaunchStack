# Vantage topic-first retrieval follow-up

The 100-case Azure run froze every case and selected 94 of 99 filename-resolved supporting documents. On the matched pilot, four previously failed attempts now froze.

## Retrieval changes

- Digest preparation now has a 180-second timeout before the 150-second exploration deadline starts. Production keeps the same version/content/format cache key and exact-quote grounding. The benchmark’s free scripted digests are ephemeral.
- Excerpt reads pad short windows around their centre, clamp to the canonical UTF-16 text, merge overlaps, and return the actual offsets. Documents use stable version-pinned handles and titles. The runner executes the first eight calls in a turn and returns repair instructions for overflow. The 60-call execution limit remains.
- The production seed order uses the evaluator’s lexical BM25 implementation on open questions and guidance. Fixed sources, watches, carryover and the reserved three-document change lane retain priority. The ranker probes up to 256 ACL-eligible parents, 40 KB per parent and 2 MB total, and offers up to 50 documents. Empty guidance uses the original recency acquisition.

## Document selection

The primary metric counts distinct filename-resolved supporting document versions per case. A failed attempt contributes zero selections when included. The 100-case sample has 99 cases with a resolved document. Strict and lexical passage metrics are secondary. The live comparison pairs the same first 20 questions with the [a68442c2 pilot](vantage-topic-first-rag-multi-corpus-live-20261121.md).

| Sample and arm | Prior selected | Updated selected, failures included | Updated selected, failures excluded | Updated failures |
|---|---:|---:|---:|---:|
| Free 20 baseline | 1/20 | 1/20 | 1/20 | 0 |
| Free 20 seeds | 9/20 | 20/20 | 20/20 | 0 |
| Free 20 scripted | 9/20 | 20/20 | 20/20 | 0 |
| Free 100 baseline | 4/99 | 4/99 | 4/99 | 0 |
| Free 100 seeds | 38/99 | 99/99 | 99/99 | 0 |
| Free 100 scripted | 35/99 | 99/99 | 99/99 | 0 |
| Azure matched 20 | 13/20 | 17/20 | 17/20 | 0 |
| Azure 100 | — | 94/99 | 94/99 | 0 |

The previous Azure pilot selected 13/16 documents after excluding its four failed attempts. Strict recall in the matched Azure cases rose from 4/6 to 5/6. Lenient recall rose from 6/21 at both thresholds to 8/21 at 0.80 and 7/21 at 0.90. On free 100, strict recall moved from 9/33 to 33/33 for seeds and from 7/33 to 28/33 for scripted. [Grouped scores and accounting](vantage-rag-multi-corpus-100-live-results-20261121.json)

The full Azure run offered all 117 filename-resolved fact references and selected 111. It recovered 20/33 strict passages and 43/117 and 31/117 at the 0.80 and 0.90 lenient thresholds. It froze 131,843 bytes across 235 document occurrences and 179 excerpts.

## Live tool reliability and latency

| Azure cohort | Attempts | Failures by cause | Invalid handler results per case | Instrumented validation errors per case | Exploration p50 / p90 |
|---|---:|---|---:|---:|---:|
| Previous pilot | 20 | 3 timeouts, 1 call limit | 3.15 (63 total) | Unobserved | 34.98 / 64.12 s |
| Updated matched 20 | 20 | 0 | 0.45 (9 total) | 0.05 (1 submission) | 12.88 / 22.35 s |
| Updated full 100 | 100 | 0 | 0.50 (50 total) | 0.08 (8 total) | 12.92 / 23.47 s |

The comparable handler counts include 48 invalid ranges and 15 unavailable references in the prior trace. The updated matched cases returned zero invalid ranges and nine unavailable references. The prior per-turn failure also discarded an observed 19-call batch before handler execution. Instrumented validation is recorded separately for the updated run. Case 14 entered the catalogue and selected its supporting document. Case 18 repaired its submission and froze, with its supporting document still unselected. The full run recorded 50 unavailable digest references, seven invalid submissions and one schema error. It recorded zero invalid ranges and zero overflow turns. The mocked Azure regression exercised overflow and continuation.

## Azure run and cost

The run reused **215** pilot digests and generated **21** missing ones. All **236** verified before the first case. Warm-up took **79.06 seconds** and incurred $0.0343 at the conservative rates. The live cases read shared cached digests. Default and digest resolved to medium-reasoning Chat Completions and exploration to high-reasoning Responses, all on `gpt-6-luna` at `launchstack-cn-080d51e6.openai.azure.com`.

Preflight projected **$8.1782**, using the verified missing-digest inventory and a 50% margin over the prior pilot’s p90 exploration exposure. The runner reprojects before each case and reserves each request under the **$10** cap. Azure reported **3,397,913 input** and **131,913 output tokens** across 21 digest and 496 exploration requests. Published Global Standard rates give **$0.2039**, including $0.0173 for warm-up. Conservative settled exposure was **$1.1381** with zero unresolved requests. The invoice total remains unverified. [Azure pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)

```powershell
Set-Location apps/web
$cache = Join-Path $env:TEMP 'vantage-rag-multi-corpus-39071af3'
$env:CHAT_MODELS_CONFIG = 'config/chat-models.azure.yaml'
$env:VANTAGE_TOPIC_FIRST_DIGEST_ROUTE = 'default'
$env:VANTAGE_TOPIC_FIRST_EXPLORATION_ROUTE = 'reasoning'
node ../../node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/vantage-benchmark-run.ts --cache $cache --arm configured-live --preflight-live
node ../../node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/vantage-benchmark-run.ts --cache $cache --requests sample100-requests.json --output live-100-topic-fixes.json --arm configured-live --approve-live --end-to-end 0
```

Use the existing Azure `CHAT_BASE_URL` and `CHAT_API_KEY`. The standalone dev warmer accepts `--warm-workspace <workspace-id> --output warm-workspace.json` in place of the sample request and output flags. It uses the same pinned corpus and task-owned loopback DB checks. The integrated run performed warm-up once and recorded the receipt with the live artifacts.

## Verification

Both free samples completed all 360 attempts with injected providers. Two cases per arm and sample completed injected end-to-end generation and admission. The baseline reproduction hash matched the prior 100-case run. The new 100-case first-20 hashes matched the separate new 20-case runs across all three free arms.

- The live capture and its peer evidence directory hold 100 snapshots and traces, 236 digests, the warm-up receipt and the usage ledger. The offline integrity check passed for all 104 files. Per-case tool counts are in `topic-fixes-live100-accounting.json` and `topic-fixes-live-paired20.json` in the external cache. Labels were used for offline scoring after capture. Corpus text and raw evidence remain outside Git.
- Verified the workspace-only command with read-only preflight after warm-up. It forecast zero further requests for workspace 6. The measured benchmark ran serially and used the integrated warm-up.
- Passed 110 focused web tests, 45 importer tests, 29 loader/evaluator tests, 28 agent tests and 8 digest-store tests. Web TypeScript returned zero diagnostics. Changed TypeScript lint and `git diff --check` passed.
- Retrieval changes `9682c176`, harness and evaluator `0783de5e`, and the live execution commit `8e97b3eb`. Follow-up `9adffe85` adds metadata for nonempty watch lists. The focused regression verified a byte-identical response for the benchmark’s empty-watch input.
