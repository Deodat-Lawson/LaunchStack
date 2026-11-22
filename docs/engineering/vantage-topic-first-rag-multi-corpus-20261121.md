# Vantage topic-first on RAG-Multi-Corpus

On the 100-case sample, 29 cases had all labelled passages verifiable in the pinned source. Across their 33 facts, baseline recovered 0 passages, seeds-only recovered 9, and scripted exploration recovered 7. Both serial free-arm passes reproduced all 300 case–arm results.

## Corpus and matching

Joseph's `fdcddae` from PR #636 was cherry-picked as `b128f866` with authorship and files preserved. The corpus is pinned at `39071af3f4dd25e59f5c59a6f9b6e8e99cd643b3`. The actual layout is `datasets/<enterprise>/<format>/<file>`, with separate Markdown, PDF, DOCX, PPTX and HTML trees. The [corpus lock](../../fixtures/vantage-benchmarks/rag-multi-corpus/corpus-lock.json) records all 1,180 paths and SHA-256 hashes. All 21,032,187 bytes were downloaded to the external cache. Redistribution remains outside this evaluation given the upstream usage note. [Pinned upstream repository](https://github.com/udayallu/RAG-Multi-Corpus/tree/39071af3f4dd25e59f5c59a6f9b6e8e99cd643b3)

| Enterprise | Corpus files | Ingested Markdown | Skipped other formats |
|---|---:|---:|---:|
| Aventro Motors | 250 | 50 | 200 |
| Cendara University | 200 | 40 | 160 |
| Cloudway 24 (`CloudWay-24` folder) | 185 | 37 | 148 |
| Velvera Technologies | 190 | 38 | 152 |
| ZX Bank | 355 | 71 | 284 |
| Total | 1,180 | 236 | 944 |

There were no plain-text files. The 944 skipped files were 236 of each remaining format. All labels in both samples referred to Markdown, so skipping formats affected zero evaluated cases. The five isolated workspaces each have the same neutral architecture source in addition to corpus documents. Canonical SQL hashes matched all 236 original Markdown files.

| Sample | Labelled facts | Exact | Normalized | Unmatched facts | Excluded cases | Scored cases/facts |
|---|---:|---:|---:|---:|---:|---:|
| Pilot 20 | 21 | 2 | 5 | 14 | 14 | 6/6 |
| Sample 100 | 118 | 18 | 21 | 79 | 71 | 29/33 |

The evaluator resolved filenames within the enterprise, then matched exact text or Unicode, whitespace and punctuation-normalized text. One larger-sample filename was unresolved. The other 78 unmatched facts did not match their named documents. An unresolved fact excludes its entire case. The per-case lists, match reasons and scores are in `pilot20-final-local.json` and `sample100A-final-local.json` under the external cache.

## Results

The unchanged importer's 20-case pilot is the exact prefix of its deterministic 100-case sample. Each arm received a fresh owner and a topic containing only the question as guidance. Corpus documents share a synthetic date before the review week, so Vantage kept its existing recency tie-break. Labels were handled by the evaluator after the freeze. Baseline “offered” means a successful authorized whole-document read before fit, including candidates omitted for budget or rank. Topic-first “offered” means membership in the actual capped catalogue.

Offered and selected columns count labelled document/version hits per fact. Documents, scoped excerpts and bytes are totals across the scored cases and include the fixed source where applicable. All 620 final retrieval snapshots completed. Two cases per arm also completed injected V2.1 Generation, Judge, admission and read-back.

| Sample | Arm | Offered facts | Selected facts | Passage recall | Docs | Excerpts | Frozen bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| Pilot | Baseline | 5/6 | 0/6 | 0/6 | 18 | 0 | 33,861 |
| Pilot | Seeds | 5/6 | 3/6 | 3/6 | 96 | 90 | 276,209 |
| Pilot | Scripted | 5/6 | 3/6 | 3/6 | 96 | 90 | 239,226 |
| Pilot | Configured live dry-run | 5/6 | 3/6 | 3/6 | 96 | 90 | 239,226 |
| 100 | Baseline | 25/33 | 0/33 | 0/33 | 83 | 0 | 166,235 |
| 100 | Seeds | 30/33 | 9/33 | 9/33 | 462 | 433 | 1,476,881 |
| 100 | Scripted | 30/33 | 8/33 | 7/33 | 450 | 435 | 1,145,358 |

| Enterprise (100-case sample) | Baseline | Seeds | Scripted |
|---|---:|---:|---:|
| Aventro Motors | 0/13 | 2/13 | 2/13 |
| Cendara University | 0/2 | 1/2 | 0/2 |
| Cloudway 24 | 0/6 | 4/6 | 4/6 |
| Velvera Technologies | 0/2 | 2/2 | 1/2 |
| ZX Bank | 0/10 | 0/10 | 0/10 |

In ZX Bank, all three free arms missed at least one supporting document at offer time in 7/20 attempts, including 3/10 scored cases. The pilot missed one of four, including one of two scored cases. The [aggregate results](./vantage-rag-multi-corpus-results-20261121.json) give both samples' full enterprise and question-category tables, including offered and selected counts, bytes, failures and reproduction hashes.

## Live pilot for approval

The injected cold-cache dry-run for 20 cases counted **215 digest calls**, **644 digest cache hits**, **156 exploration turns**, and 1,039 local tool calls. Actual exploration can use up to 240 turns on 20 cases. The cost estimate uses the dry-run payload proxy of 7,185,796 input tokens and 297,870 output tokens at approximately four characters per token. The checked-in routes use Gemini 3.8 Flash. At standard OpenRouter rates of $0.75 and $3.75 per million input and output tokens respectively, the projected cost is **$6.51** without cache discounts. With 6,000 output tokens per request on the same schedule and input estimate, it is **$13.74**. Real transcripts, reasoning tokens, turns and provider rates can change the total. [OpenRouter provider pricing](https://openrouter.ai/google/gemini-3.8-flash/providers)

The prospective command is below. It requires existing OpenRouter credentials in the environment. It was not executed.

```powershell
Set-Location apps/web
$cache = Join-Path $env:TEMP 'vantage-rag-multi-corpus-39071af3'
$env:CHAT_MODELS_CONFIG = 'config/chat-models.yaml'
$env:CHAT_BASE_URL = 'https://openrouter.ai/api/v1'
$env:VANTAGE_TOPIC_FIRST_DIGEST_ROUTE = 'default'
$env:VANTAGE_TOPIC_FIRST_EXPLORATION_ROUTE = 'reasoning'
node ../../node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/vantage-benchmark-run.ts --cache $cache --requests pilot20-requests.json --output live-pilot20.json --arm configured-live --approve-live --cold-digests --end-to-end 0
```

## Verification and scope

- Loader and lock `0f71ddff`, retrieval/scoring harness `b9353c3a`, and excerpt accounting `c2583f78`. The harness extracts provider injection from the existing topic selector so both injected and configured runs use the same collection and freeze implementation. The corpus loader reuses the Harborlight dev importer's safety and hash helpers and writes the same pre-indexed document/version/chunk shape. Corpus, larger case data and raw captures stayed outside Git.
- Joseph's 45 tests and pinned pilot `--check` passed. Loader and regression suites passed 15 tests, scoring passed 10, and focused web suites passed 39. Web TypeScript reported zero diagnostics. Changed TypeScript lint passed.
- Each final pass checked all locked file hashes and exact DB inventories, then ran with fresh owners. An early harness capture exposed double-serialized JSONB and a later concurrent capture hit serialization retries. The final harness uses the app's Drizzle parameter path and a serial schedule. The two final passes had identical offered order, selected documents, offsets, evidence hashes and bytes.
- The original ingestion ran in the task-owned loopback database `vantage_rag_benchmark_20261121`. The reusable loader's verification command ran against it. Fresh ingestion via the reusable CLI was not repeated to preserve the verified workspaces.
- Paid model and embedding calls were zero. Configured-model behavior, production ingestion and extraction of the skipped formats remain unevaluated. The scripted arm measures retrieval mechanics on the verifiable subset.
