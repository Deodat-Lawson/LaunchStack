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