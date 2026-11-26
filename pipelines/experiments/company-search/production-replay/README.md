# Production replay

E1 to E4 asked what could work. This folder asks what the code Prospects runs does: the benchmark's pools go through production's own ranking code (`pipelines/src/distribution/`), on the two embedding models built into the app (`packages/llm/src/embeddings/index-registry.ts`).

| Replay  | Question                                                                            | Production code it runs               | Result file                              |
| ------- | ----------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------- |
| `brief` | On Norwegian company texts, does a Norwegian brief rank better than an English one? | `semanticRelevance` (today's ranking) | `results/production-brief-language.json` |

The result file has one block per embedding model:

| Model                         | What it is                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `nomic-embed-text`            | The local model E4 was recorded with.                                                    |
| `gemini-embedding-001@768`    | Index `gemini-embedding-768`: the embedder the registry recommends for a new deployment. |
| `text-embedding-3-large@1536` | Index `legacy-openai-1536`: the default embedder.                                        |

## Results

Recorded and replayed on 2026-11-26. All figures are means over E4's 20 seeds; intervals are 95%.

### The brief's language (plan item 3): not built

Good companies found in 100 checks by today's ranking, mean of the three Norwegian pools:

| Embedding model               | English brief | Norwegian brief | Norwegian minus English |
| ----------------------------- | ------------- | --------------- | ----------------------- |
| `nomic-embed-text`            | 25.0          | 58.5            | +33.5 (−1.0 to +60.7)   |
| `gemini-embedding-001@768`    | 88.3          | 88.5            | +0.2 (−3.8 to +4.4)     |
| `text-embedding-3-large@1536` | 74.5          | 69.9            | −4.6 (−10.7 to +2.4)    |

- **The gap is the local model's.** E4's finding reproduces exactly on `nomic-embed-text` and is gone on both built-in models: on `gemini-embedding-001` the two briefs are level, on `text-embedding-3-large` the Norwegian brief is behind.
- **Taking the higher of the two scores is the Norwegian brief.** A Norwegian text is closer to a Norwegian brief whatever it says, so the higher score is the Norwegian one for nearly every company and the two rows are identical.
- **The zero-score rule.** Production drops a company whose relevance is not above zero before any fit check. With an English brief it keeps this share of the good companies (coffee and tea, breweries, Bergen dentists): 93%, 60%, 11% on the local model; 91%, 94%, 95% on `gemini-embedding-001`; 85%, 93%, 94% on `text-embedding-3-large`. With a Norwegian brief it keeps 98% to 100% of them, and also 87% to 100% of the whole pool, so it stops filtering.

So Prospects does not translate the brief: on the models it runs on there is nothing to gain, and a translated brief would switch the zero-score rule off. The rule is left as it is; what it costs on the built-in models is the 5% to 15% of good companies above.

## Run it

All commands from `pipelines/`. Replays are offline: recorded pools and cached vectors only.

```sh
# The local model (a few seconds).
pnpm exec tsx experiments/company-search/production-replay/run.ts

# One of the built-in models.
pnpm exec tsx experiments/company-search/production-replay/run.ts brief --model=gemini-embedding-001@768
pnpm exec tsx experiments/company-search/production-replay/run.ts brief --model=text-embedding-3-large@1536

# The test: three seeds by default, all twenty (and a check against the result file) with the variable.
pnpm exec vitest run experiments/company-search/production-replay
COMPANY_SEARCH_REPLAY_SEEDS=20 pnpm exec vitest run experiments/company-search/production-replay
```

- A replay with all 20 seeds rewrites its model's block in the result file; two replays of the same recording write the same numbers. A run with fewer seeds (`--seeds=3`) prints its table and leaves the file alone.
- The recordings are not in git (see the folder's own README). Where they are absent, as in CI, the replay test is skipped and a small test checks the committed result file instead.

## Record it (the paid step)

One script sends texts to a paid model. It refuses to send anything without `COMPANY_SEARCH_BENCH_MODE=record` and a `--cap-usd`, prints its estimate first, stops when it is over the cap, and never sends a text twice.

```sh
# Embeddings of the four pools, the briefs and the baseline.
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/production-replay/record.ts \
  --model=gemini-embedding-001@768 --cap-usd=0.3 --via=openrouter
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/production-replay/record.ts \
  --model=text-embedding-3-large@1536 --cap-usd=0.3
```

- **What leaves the machine:** company names and their own activity texts, as the pools hold them. No address, phone or email. Sole proprietorships are often named after their owner.
- **Keys:** `GOOGLE_AI_API_KEY`, `EMBEDDING_API_KEY` or `OPENAI_API_KEY`, and `OPENROUTER_API_KEY`, from the environment.
- **`--via=openrouter`:** Google's own endpoint takes 100 texts a minute on its free tier. OpenRouter serves the same model at the same list price; eight texts recorded on both endpoints came back identical (cosine 1.000000).
- **What the recording of 2026-11-26 cost:** $0.26 (1.86 million tokens over the two models, all four pools).

## Limits

- **Three pools, one language pair.** The pools are Norwegian register entries and the briefs English and Norwegian; another language or another kind of text may behave differently.
- **The Norwegian briefs are E4's**, written by hand as a Norwegian seller would type them. A machine translation was not tried, since the hand-written one already gains nothing.
- **Labels are register codes**, as in E4: a company is good when the register files it under the segment's class.
