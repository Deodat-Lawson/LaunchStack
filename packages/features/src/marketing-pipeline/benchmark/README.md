# Campaign Planner Evaluation Benchmark

An LLM-as-judge benchmark for the Campaign Planner. It scores generated marketing
posts 0–100 per criterion using platform reference standards — the appraisal-style
benchmark (like the GPT/Perplexity model evals). **Raw scores only; the judge never
rewrites.**

## Layout

```
benchmark/
  schema/            frozen contract (fixtures, results, scorer interfaces)
  judges/
    rubric.ts        criteria + rubric + structured-output schema + prompt
    judge.ts         scorePost() — LLM judge, no rewrite, version-pinned
  references/
    x.md             platform standard fed to the judge (good/bad examples)
    linkedin.md      (fill these — see TODO-member.md)
    reddit.md
  setup.ts           configureJudgeFromEnv() — wires the judge to OPENAI_API_KEY
  candidates.sample.json   posts to score (replace with real outputs)
  TODO-lead.md / TODO-member.md   work split
```

## How it works

1. A **reference md** per platform (`references/*.md`) holds labeled GOOD/BAD
   marketing posts, each with the **company-context window** it was written from
   (the same shape the generator builds in `../context.ts`, incl. DB provenance).
2. `scorePost()` feeds that reference + the candidate's company context + the
   candidate post to the judge (`gpt-4o`, temp 0) and returns raw per-criterion
   scores, an overall score, and a rationale — **no rewrite**.
3. The runner aggregates scores and writes `results.json` under
   `docs/pipeline/benchmarks/<runId>/`.

## Run it

The judge calls the OpenAI API, so it's gated behind `RUN_LLM_BENCHMARK`:

```bash
# PowerShell
$env:RUN_LLM_BENCHMARK=1; pnpm --filter @launchstack/web test -- campaign-benchmark

# bash
RUN_LLM_BENCHMARK=1 pnpm --filter @launchstack/web test -- campaign-benchmark
```

`OPENAI_API_KEY` is read from the repo-root `.env`. Without `RUN_LLM_BENCHMARK`
the suite is skipped, so normal CI never pays for API calls.

## Next steps (not in this slice)

- Fill `references/*.md` (member) and add real candidates / wire Mode-A generation.
- Judge stability: N-sample median + recorded variance (lead, TODO-lead Phase 1).
- Cost/token axis + Score-vs-cost frontier chart (deferred for now).
- Baseline + regression CI gate (lead, TODO-lead Phase 3).
