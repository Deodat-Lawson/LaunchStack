# Production replay

E1 to E4 asked what could work. This folder asks what the code Prospects runs does: the benchmark's pools go through production's own ranking code (`pipelines/src/distribution/`), on the two embedding models built into the app (`packages/llm/src/embeddings/index-registry.ts`), beside today's ranking through the same code.

| Replay      | Question                                                                                         | Production code it runs                              | Result file                              |
| ----------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------- |
| `brief`     | On Norwegian company texts, does a Norwegian brief rank better than an English one?              | `semanticRelevance` (today's ranking)                | `results/production-brief-language.json` |
| `shortlist` | Does a shortlist that learns from each verdict find more good companies per fit check?           | `fillShortlist` and `createShortlistLearner`         | `results/production-shortlist.json`      |
| `verdicts`  | Does it still, when a check answers what the real fit check said? And what do kept verdicts buy? | the same, over recorded verdicts of `createFitJudge` | `results/production-verdicts.json`       |

Every result file has one block per embedding model:

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

### The shortlist that learns (plan item 4): built

Seven pools, each with a brief in its companies' language. "Today" is the fixed ranking through production's loop; the learner is `createShortlistLearner` picking every round of ten.

| Embedding model               | Today, found in 100 checks | Learner | Learner minus today    | Pools better / worse |
| ----------------------------- | -------------------------- | ------- | ---------------------- | -------------------- |
| `nomic-embed-text`            | 59.2                       | 80.7    | +21.5 (+11.9 to +32.1) | 7 / 0                |
| `gemini-embedding-001@768`    | 69.7                       | 84.5    | +14.9 (+5.1 to +25.2)  | 5 / 2                |
| `text-embedding-3-large@1536` | 67.0                       | 82.5    | +15.5 (+6.5 to +23.4)  | 5 / 2                |

- **The local model's row is E4's.** Today's 59.2 is E4's figure to the decimal, and the production learner's 80.7 is E4's `linucb` (80.9) with two differences: it asks ten at a time instead of five, and it finds the main directions of the embeddings in 6 passes instead of 20.
- **On the built-in models the gain is smaller**, about 15 good companies in 100 checks, because their fixed ranking is better to begin with. The four pools that are worse are worse by 0.2 to 1.7 companies in 100 checks over the 20 seeds (over three seeds one of them is 3.3 behind); in each of them today's ranking already finds 80 to 98.
- **The first 25 checks are level.** Learner minus today after 25 checks: +1.4 (−0.5 to +3.5), +0.6 (−1.0 to +2.3) and +1.0 (−1.0 to +3.2). The gain comes from about the 50th check on: +8.0, +3.4 and +4.8 after 50, and +42.1, +34.5 and +34.6 after 200.
- **Filling a 25-place shortlist.** Checks production's loop makes before the shortlist is full:

| Embedding model               | Today | Today's order, ten at a time | Learner |
| ----------------------------- | ----- | ---------------------------- | ------- |
| `nomic-embed-text`            | 53.4  | 41.9                         | 32.9    |
| `gemini-embedding-001@768`    | 50.0  | 34.9                         | 33.0    |
| `text-embedding-3-large@1536` | 52.5  | 38.2                         | 32.3    |

Most of that saving is the round size, not the learning: today's first round asks about 50 companies whatever the first 25 answer. On the built-in models learning adds 2 to 6 checks on top. So at the default shortlist of 25 a run ends after about 33 checks, before the learner's lead has opened; the +15 in 100 checks is what a longer search gets, a larger shortlist or a pool where few companies fit. The number of model calls is about the same either way: three to four (the fit check makes one call per twenty companies, so today's round of fifty is three calls).

### Real fit-check verdicts

Every company of the drinks pool (1,422) was judged once by production's fit check for the breweries segment: `createFitJudge` unchanged, English brief, on the dev setup's fast route.

- **The fit check and the register mostly agree.** It said yes to 225 companies; the register calls 233 good; 206 are both, 19 only the fit check's, 27 only the register's. They agree on 96.8% of the pool.
- **A verdict is stable.** 200 companies were asked about a second time in other batches: 3 verdicts changed.
- **The learner behaves on real verdicts as it does on labels.** A company counts as good when the fit check said yes:

| Embedding model               | Today, yes in 25 / 50 / 100 checks | Learner            | At 100 checks, over seeds |
| ----------------------------- | ---------------------------------- | ------------------ | ------------------------- |
| `nomic-embed-text`            | 9.6 / 22.2 / 36.7                  | 15.7 / 38.3 / 84.7 | +48.0 (+46.7 to +49.2)    |
| `gemini-embedding-001@768`    | 24.6 / 47.0 / 91.9                 | 24.0 / 47.9 / 95.3 | +3.4 (+2.8 to +4.1)       |
| `text-embedding-3-large@1536` | 21.7 / 44.9 / 81.4                 | 21.3 / 45.0 / 92.4 | +11.0 (+10.1 to +11.9)    |

Where today's ranking is poor (the local model reading Norwegian against an English brief) the verdicts rescue it. Where it is already good (`gemini-embedding-001`: 92 of the first 100 are a yes) there is little left to add, and the first 25 checks cost half a company.

- **What kept verdicts buy.** The pool is split in two; a first run fills its shortlist on one half and keeps its verdicts (30 to 40 of them); a second run then meets the other half, companies it has never seen:

| Embedding model               | Second run                     | Yes in its first 10 / 25 checks | Checks to fill 25 places |
| ----------------------------- | ------------------------------ | ------------------------------- | ------------------------ |
| `nomic-embed-text`            | today's ranking                | 4.9 / 10.2                      | 70.3                     |
|                               | learner, starting from nothing | 4.4 / 15.9                      | 38.1                     |
|                               | learner, from kept verdicts    | 9.6 / 23.9                      | 30.0                     |
| `gemini-embedding-001@768`    | today's ranking                | 10.0 / 24.4                     | 50.0                     |
|                               | learner, starting from nothing | 9.0 / 23.4                      | 30.0                     |
|                               | learner, from kept verdicts    | 10.0 / 24.7                     | 30.0                     |
| `text-embedding-3-large@1536` | today's ranking                | 8.3 / 22.2                      | 50.0                     |
|                               | learner, starting from nothing | 7.7 / 21.3                      | 30.4                     |
|                               | learner, from kept verdicts    | 10.0 / 24.1                     | 30.0                     |

With a poor ranking the kept verdicts make the second run's first round right from the start (+5.2 yes's in the first ten, 4.6 to 5.7). With a good ranking they give back the one or two companies in ten that a learner starting from nothing spends on looking around (+1.0 and +2.3).

## Run it

All commands from `pipelines/`. Replays are offline: recorded pools and cached vectors only.

```sh
# Both replays that need no recorded verdicts, on the local model (about 6 minutes).
pnpm exec tsx experiments/company-search/production-replay/run.ts

# One replay, one model.
pnpm exec tsx experiments/company-search/production-replay/run.ts shortlist --model=gemini-embedding-001@768
pnpm exec tsx experiments/company-search/production-replay/run.ts brief --model=text-embedding-3-large@1536
pnpm exec tsx experiments/company-search/production-replay/run.ts verdicts --model=nomic-embed-text

# The tests: three seeds by default, all twenty (and a check against the result files) with the variable.
pnpm exec vitest run experiments/company-search/production-replay
COMPANY_SEARCH_REPLAY_SEEDS=20 pnpm exec vitest run experiments/company-search/production-replay
```

- A replay with all 20 seeds rewrites its model's block in the result file; two replays of the same recording write the same numbers. A run with fewer seeds (`--seeds=3`) prints its table and leaves the files alone.
- The recordings are not in git (see the folder's own README). Where they are absent, as in CI, the replay tests are skipped and a small test checks the committed result files instead.
- With all 20 seeds the `shortlist` replay takes about 8 minutes on a 768-dimension model and 15 to 30 on the 1,536-dimension one, depending on what else the machine is doing; the other two replays take under 3 minutes. The tests with all twenty seeds take about 35 minutes together.

## Record it (the paid steps)

Two scripts send texts to a paid model. Both refuse to send anything without `COMPANY_SEARCH_BENCH_MODE=record` and a `--cap-usd`, print their estimate first, stop when it is over the cap, and never send a text twice.

```sh
# Embeddings of the four pools, the briefs and the baseline.
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/production-replay/record.ts \
  --model=gemini-embedding-001@768 --cap-usd=0.3 --via=openrouter
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/production-replay/record.ts \
  --model=text-embedding-3-large@1536 --cap-usd=0.3

# The real fit check on every company of one pool, and 200 of them a second time.
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/production-replay/record-verdicts.ts \
  --segment=brreg-breweries --cap-usd=1 --again=200
```

- **What leaves the machine:** company names and their own activity texts, as the pools hold them. No address, phone or email. Sole proprietorships are often named after their owner.
- **Keys:** `GOOGLE_AI_API_KEY`, `EMBEDDING_API_KEY` or `OPENAI_API_KEY`, and `OPENROUTER_API_KEY`, from the environment.
- **`--via=openrouter`:** Google's own endpoint takes 100 texts a minute on its free tier. OpenRouter serves the same model at the same list price; eight texts recorded on both endpoints came back identical (cosine 1.000000).
- **What the recording of 2026-11-26 cost:** embeddings $0.26 (1.86 million tokens over the two models), fit-check verdicts about $0.59 (82 calls).

## Limits

- **The brief replay is three pools and one language pair.** The pools are Norwegian register entries and the briefs English and Norwegian; another language or another kind of text may behave differently. The Norwegian briefs are E4's, written by hand; a machine translation was not tried, since the hand-written one already gains nothing.
- **Labels are still directory tags and register codes** in the `shortlist` replay, as in E4, and only one pool has real verdicts. That pool is one where the fit check and the register agree on 96.8%; a segment where a verdict turns on what a listing does not say would teach the learner less.
- **The judge is one chat model**: the fast route of the committed `apps/web/config/chat-models.yaml`, through OpenRouter. A deployment whose chat routes point at another model may judge differently; none was called.
- **The real verdicts were recorded once**, in batches of twenty in pool order. The replay answers the same verdict whatever batch a company is asked about in; asked twice, 3 of 200 differed.
- **One pool, split in two, stands in for "a later run".** Both halves come from the same register query, so the second run's companies are as like the first run's as they can be.
- **The pools are far larger than a keyless run's.** A replayed run has 1,100 to 5,000 candidates. The keyless Prospects runs made in the app on 2026-11-26 found 8 places for their segment, of which the fit check read 5 or 6 in a single round: with that few there is nothing to rank, so no live run has re-ranked anything yet, and the learner changes nothing until discovery brings more.
- **The replay ranks every company of a pool; a run first drops those whose relevance is not above zero.** With that rule applied first (`run.ts shortlist --zero-score-rule` and `run.ts verdicts --zero-score-rule`, 20 seeds, no result file written), today's figures do not move, since nobody the rule drops is among the first 200 of the fixed ranking. The learner's lead in 100 checks over the seven pools becomes +21.3, +15.9 and +16.1 on the three models, against +21.5, +14.9 and +15.5 above. On the judged pool it becomes +42.7, +3.8 and +10.6, against +48.0, +3.4 and +11.0: the rule costs the local model there, because with an English brief it drops 40% of that pool's good companies before any check. The later-run table always ranks the whole half.
- **Nothing was re-tuned.** The learner's settings are E4's: it tuned two of them on its two development segments with the local model (the prior spread of the direction weights and the bonus) and fixed the others by design. One setting is not E4's: production finds the main directions in 6 passes where E4 makes 20.
