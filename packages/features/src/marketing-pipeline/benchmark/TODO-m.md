# Campaign Planner Eval Todo

The goal is to have a benchmark evaluating content of the posts from angles, checkout [Campaign Planner ] Build a reproducible evaluation suite on Linear Issues for criteria for evaluating. Evaluation is done by having a evaluation.md sent to LLM containing good and bad examples from big tech company marketing teams. Main job is selecting post examples from the 4 target media platforms(if you can't find such posts on blusky, skip it). BE SURE TO USE MARKETING ADVERTISEMENT POSTS NOT BRAND NEW PRODUCT LAUNCH, some minor features updates to a product counts as marketing ad post. Select 10 good posts and 5 bad posts from each platform from >3 big companies like Applovin, Cursor, perplexity, General Translation, Posthog... Bad posts doesn't need to be from big tech companies marketing teams

**Contract you build against (frozen):** [`schema/`](./schema/index.ts) —
`Fixture`, `CompanyFixture`, `ExpectedConstraints`, `CriterionSpec`,
`CriterionScore`, `DeterministicAssertion`, `EvalContext`. Every assertion you
write returns a `CriterionScore`; every fixture you author parses against
`FixtureSchema` / `CompanyFixtureSchema`.

**Golden rule (from the ticket):** deterministic wherever possible. If a criterion
can be checked with a string/number/length/similarity, it's yours. Subjective ones
(voice, hook, audience, goal) are the lead's judge — don't duplicate them.

---

## Phase 0 — Contract review (blocks nothing, do first)
- [ ] Read [`schema/index.ts`](./schema/index.ts) end to end. Confirm the fixture
      shape can express every case in Scope. File issues on the lead if a field
      is missing (e.g. a constraint you need has nowhere to live).
- If have any improve ideas we can discuss.

## Phase 1 — Reference posts + mock data

You own **two distinct datasets — do not conflate them** (see the graph):

### 1a. Reference posts → `references/evaluation.md` (the success standard)
Real, public marketing posts that teach the judge "good" vs "bad".
- [ ] Per platform (**X, LinkedIn, Reddit, Bluesky**): **10 good** + **3–5 bad** posts.
- [ ] Pull good ones from **>3 big companies** — AppLovin, Cursor, Perplexity,
      General Translation, PostHog, etc. Spread across companies (≈10 ÷ 3+ companies).
- [ ] **Use marketing / advertisement posts, NOT brand-new product-launch
      announcements.** A minor feature update promoted as an ad counts; an
      "introducing our new product" launch does not. (Graph: *differentiate
      marketing material from product launches*.)
- [ ] "Bad" = generic AI slop, feature-dump, wrong-platform tone, engagement-bait, bad post stats...
- [ ] Tag each entry with `platform`, `company`, `label: good|bad`
- [ ] **Split into `## anchors` (go into the judge prompt) and `## held-out`
      (the calibration test later grades these) — never overlap them.**
- [ ] Store as `.md`. If an image carried the message, describe it in text
      (pipeline is text-first); attach the image in the folder only if useful.

FOR EACH REFERENCE POST, ATTACH RELEVANT COMPANY BACKGROUND AND PRODUCT-RELATED KNOWLEDGE MIMICING THE COMPANY CONTEXT THE POST GENERATION PIPELINE IS USING

### 1b. Mock companies → `fixtures/companies/` (generation input)
Synthetic companies the pipeline generates FROM (so runs never touch prod data).
- [ ] Create **4 seed companies**: 3 `strong` knowledge, one `missing`.
      Each: `company.json` (parses `CompanyFixtureSchema`) + docs in the repo
      (`docs/*.md`, plus `.pdf`/images where relevant) + `sourceFacts` mixing
      `supported` / `contradictory` / `distractor`.
- [ ] You may model a mock company on a real one's public info, but change the name and keep the docs synthetic — this is test data, not the reference posts from 1a.

Note that the information regarding these mocks mimic the structrue from company metadata database, referene the metadata database schema and clearly list what field has what information


- **DoD:** `evaluation.md` has the full good/bad set per platform, split
  anchors/held-out; `zod.parse` succeeds on all seed companies + fixtures; the
  lead's calibration test can import `evaluation.md`.

## Phase 2 — Deterministic assertion library
Location: `assertions/`. Each is a `DeterministicAssertion` (pure, sync, no model
calls, stable across repeats) returning a normalized `CriterionScore` (`score` in
[0..1], `passed`, `detail`, `raw` evidence). Register by `criterionId`.
- [ ] `platform_structure` — length vs `maxChars`/`minChars`, hashtag min/max,
      thread-shape for `contentType: thread`, link presence when `requireLink`.
- [ ] `cta_quality` (presence half only) — CTA/link present when `requireCta`.
- [ ] `citation_coverage` — ≥ `minCitations` when `requireCitations`.
- [ ] `cliche_generic` — cliché wordlist density + n-gram repetition; penalize
      `forbiddenPhrases` hits.
- [ ] `variant_diversity` — pairwise similarity (distinct-n or Jaccard) ≤
      `maxVariantSimilarity`.
- [ ] `specificity` (deterministic half) — all `requiredKeywords` (e.g. product
      name) appear.
- [ ] `groundedness` (deterministic half) — every numeric/`metric` claim in the
      output string-matches a `supported` SourceFact; any match to a
      `contradictory` fact or no match ⇒ fail when `allowUnsupportedClaims` is false.
- [ ] Unit-test each assertion with tiny hand-made `EvalContext`s (these ARE
      deterministic, so they're normal always-on Jest tests — no API cost).
- **DoD:** every non-subjective criterion has a registered, unit-tested assertion.

## Phase 3 — Full fixture matrix
- [ ] Expand to the full grid: **4 platforms** (LinkedIn, X, Reddit, Bluesky) ×
      **5 categories** (launch, thought-leadership, educational, proof, community) ×
      **4 knowledge states** (strong, sparse, missing, contradictory), plus varied
      audiences / voices / goals / content types.
- [ ] Add **failure/fallback fixtures**: `simulateNoResearch`,
      `simulateNoPerformanceHistory`, an unsupported-claims trap, and a
      contradictory-knowledge case — set `expectedFailureMode` appropriately.
- [ ] Every fixture defines inputs, source facts (via its company),
      `expectedConstraints`, and `criteria`.
- [ ] Bump `FixtureSet.version` and record it (reproducibility).
  > **Resolve with the lead:** your reference posts (1a) deliberately avoid
  > product-launch announcements, but this matrix lists `product_launch` as a
  > category. Decide whether to keep `product_launch` fixtures (judged against
  > non-launch references) or replace it with feature-update / marketing-ad cases
  > so the fixtures and the success standard measure the same thing.
- **DoD:** matrix committed; a coverage check confirms every
      platform×category×knowledge-state combination is represented.

## Phase 4 — Summary, command, docs
- [ ] **Human-readable summary** renderer: consume the lead's `BenchmarkRun` JSON →
      concise console/markdown table (per-platform + per-criterion means, failures,
      cost/latency, baseline delta if present). Render only — never recompute scores.
- [ ] Wire the **single documented command** `pnpm eval:campaign` (invokes the
      lead's runner) in `package.json`.
- [ ] **Runbook** (`README.md`): how to run, how to add a company/fixture, how to
      read results, and how baseline promotion works.
- **DoD:** one documented command runs the suite and prints the summary.

---

## Dependencies on the lead
- Phase 2/4 need the finalized `EvalContext` + `CriterionScore` + `BenchmarkRun`
  shapes (all in `schema/` — already frozen).
- Phase 4's summary needs a sample `BenchmarkRun` JSON from the lead's runner.
- Your seed fixtures (Phase 1) are what unblock the lead's first real baseline —
  prioritize them.

## Hard rules
- No real publishing, no production data. Reference posts in `evaluation.md` are
  real *public* marketing posts — fine to quote as exemplars (keep excerpts short,
  attribute the company). Mock **company docs** (1b) must be synthetic — model them
  on public info, never commit real internal docs.
- Deterministic assertions must never call a model or the network.
- Keep `anchors` and `held-out` exemplars disjoint, or calibration tests memorize.
