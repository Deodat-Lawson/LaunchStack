# E4: whom to check next

In production every candidate company gets an expensive check: a chat-model verdict ("would this business buy this?"), then a research run on its website, then a person's decision. The order of checking is a fixed ranking (`semanticRelevance` of the company's text to the segment's brief, top down). Nothing learned from one verdict changes who is checked next.

This experiment asks: **if the ranking learned from each verdict, would the same number of checks find more good companies?**

It simulates the checking on pools of real companies whose "good" label is known but hidden, and compares today's fixed ranking with seven policies that learn. Results: `../results/e4-whom-to-check.json` (aggregates only; the `findings` array says it in sentences).

## Headline result

The headline condition gives every pool a brief in its companies' own language: the four Y Combinator pools keep their English briefs, the three Norwegian register pools use Norwegian briefs. Mean over the seven pools, recording of 2026-11-24, differences paired by seed with 95% intervals over pools and seeds:

| Good companies found after                               | 25 checks           | 50 checks             | 100 checks             | 200 checks             |
| -------------------------------------------------------- | ------------------- | --------------------- | ---------------------- | ---------------------- |
| Today's fixed ranking                                    | 18.8                | 33.7                  | 59.2                   | 96.4                   |
| `linucb`, the learner picked on the development segments | 20.8                | 42.0                  | 80.9                   | 139.2                  |
| `linucb` minus today                                     | +2.0 (−0.5 to +4.8) | +8.3 (+2.5 to +15.3)  | +21.7 (+11.4 to +33.0) | +42.8 (+31.5 to +53.6) |
| `cal-logreg`, the best learner in hindsight              | 21.8                | 43.7                  | 83.2                   | 140.4                  |
| `cal-logreg` minus today                                 | +3.0 (+0.6 to +5.9) | +10.0 (+4.8 to +16.5) | +24.0 (+14.4 to +34.6) | +44.0 (+33.0 to +54.6) |

- **Shortlist of 25.** Today's ranking fills it in 28.8 checks in the median pool and 67.9 in the worst. `linucb` needs 28.6 and 45.9, `cal-logreg` 26.8 and 41.3.
- **Where the gain comes from.** At 100 checks `linucb` gains +15.4 on the four English-language pools and +30.1 on the three Norwegian ones.
- **Early checks.** At 25 checks the gain is small and its interval includes zero for `linucb`; the learners pay off from about 50 checks on.

These figures are `results.sameLanguageBriefs` in the results file, and `run.ts` prints them first. No extra simulation stands behind them: each Norwegian pool contributes its Norwegian-brief run, each Y Combinator pool the run it has.

### The first run

The first run gave all seven pools an English brief. It is still in the results file (`results.overall`, `results.perPool`, and the findings marked `[First run]`), with every number unchanged.

An English brief handicaps today's ranking on Norwegian text. On the three register pools it finds 11.5 / 16.6 / 25.0 good companies after 25 / 50 / 100 checks, against 20.0 / 34.3 / 58.5 with a Norwegian brief, and on Bergen dentists it needs 338 checks to fill the shortlist against 29. That makes the learners look better than they would for a seller who writes in the buyers' language: over seven pools `linucb` gains +34.7 at 100 checks in the first run and +21.7 under the headline condition.

The headline condition was chosen after the first run was reviewed. Its Norwegian-brief runs were planned as a sensitivity check, their briefs were written before any policy ran, and nothing was re-tuned for it. Of the two conditions it is the less favourable one for the learners.

## How to run it

All commands from `pipelines/`.

```sh
# 1. Record: fetch the pools and compute the embeddings (network + Ollama with nomic-embed-text).
COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e4-whom-to-check/record.ts

# 2. Replay: run the experiment and write ../results/e4-whom-to-check.json (no network, no model).
pnpm exec tsx experiments/company-search/e4-whom-to-check/run.ts
```

- `record.ts` sends 99 requests (one Y Combinator document, 98 register pages, at most one every 0.7 s to the register) and embeds 31,456 texts with the local model. The first recording took 10 minutes, nearly all of it embedding. Run again it answers from the cache in seconds. Without `COMPANY_SEARCH_BENCH_MODE=record` it only checks that the cache is complete.
- `run.ts` never touches the network: it reads recorded responses in replay mode and cached vectors only, and stops with an error if either is missing. Every random draw is seeded and the results file has no timestamp, so two runs write the same bytes.
- `run.ts` spreads the pools over up to five processes (the Y Combinator pool over two). `E4_WORKERS=1` keeps everything in one process, `E4_WORKERS=3` uses three; the numbers are the same either way.
- Time for `run.ts` on a 10-core Apple M4, with the default five processes: 69 seconds when the machine was mostly free, 2.5 minutes when it was busy with other work (3.5 to 5 minutes of processor time). With `E4_WORKERS=1`: about 4 minutes.

Two optional scripts, both offline:

```sh
# The hyper-parameter search on the two development segments (writes tuning.json).
pnpm exec tsx experiments/company-search/e4-whom-to-check/tune.ts
# The policies' arithmetic checked against slow, obvious versions on a synthetic pool (2 s).
pnpm exec tsx experiments/company-search/e4-whom-to-check/selfcheck.ts
```

The cache (`../.cache/`, never committed) holds register records that can name people and carry contact details. Nothing in this folder prints, logs or writes a company row.

## The simulation

- A **pool** is a set of companies. A **segment** is what a seller types into the segment form plus a hidden rule saying which companies of the pool are good for it.
- A policy starts with the brief and no labels. A **check** reveals one company's label and costs 1. Checks come in batches of 5: the policy names 5 companies, sees their verdicts, and may re-rank.
- 20 seeds. Each seed draws a random 80% of the pool and fixes the order that breaks ties; every policy sees the same draw, so differences are paired by seed.
- Budgets of 25, 50, 100 and 200 checks. A run that has not yet found 25 good companies after 200 checks goes on until it has, up to 500 checks.

### Policies

| Policy               | What it does                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `today-semantic`     | Production today: `semanticRelevance(embed, brief, texts)`, top down.                                                                                                                                                                                                                                                                                                                                    |
| `today-lexical`      | Production with no embedder: `lexicalRelevance` (word overlap with the segment's categories), top down. Its many ties fall in seeded random order.                                                                                                                                                                                                                                                       |
| `rocchio`            | After each batch the brief's vector becomes 1·brief + 0.75·(mean of checked positives) − 0.15·(mean of checked negatives); companies are re-scored with production's formula (cosine to that vector minus cosine to "A business."). Before any verdict it is today's ranking exactly.                                                                                                                    |
| `cal-logreg`         | Continuous active learning as in technology-assisted review. L2 logistic regression on the embedding (centred on the pool's mean), today's score (standardised) and an intercept. Retrained before every batch on: the brief as a positive, every checked company, and 100 random unchecked companies as provisional negatives, retired one for one as real negatives arrive. Checks the highest-scored. |
| `cal-uncertainty`    | The same model; checks the company closest to even odds. The textbook contrast.                                                                                                                                                                                                                                                                                                                          |
| `cal-logreg-egreedy` | `cal-logreg` with 10% of checks spent on a random unchecked company.                                                                                                                                                                                                                                                                                                                                     |
| `thompson`           | Bayesian linear model of the verdict on 48 principal directions of the pool's embeddings, today's score and an intercept. Prior mean: today's score as it is (weight 1 on it, 0 elsewhere). For each check, one draw from the posterior; checks the company that draw scores highest.                                                                                                                    |
| `linucb`             | The same model; checks the highest predicted score plus a bonus proportional to the model's uncertainty about that company. Inside a batch the uncertainty is updated after each pick.                                                                                                                                                                                                                   |
| `knn-feedback`       | Today's score + weight × (mean cosine to the 3 nearest checked positives − mean cosine to the 3 nearest checked negatives).                                                                                                                                                                                                                                                                              |
| `random`, `oracle`   | Bounds: a random order; every good company first.                                                                                                                                                                                                                                                                                                                                                        |

The two fixed rankings and the brief are computed by the production functions themselves (`buyerBrief`, `companyText`, `semanticRelevance`, `lexicalRelevance` in `pipelines/src/distribution/semantic.ts`), fed with the recorded vectors.

### Metrics

Per pool and overall: good companies found after 25, 50, 100 and 200 checks; precision of the first 25 checks; checks needed to find 25 good companies (production's shortlist size); and each of these as a paired difference to `today-semantic`. Average precision of the two fixed rankings shows how good the starting point is.

The overall figures exist twice in the results file, computed the same way: `results.sameLanguageBriefs.overall` for the headline condition and `results.overall` for the first run. The headline block adds, for checks to 25, the median pool and the worst pool, and splits every figure by brief language (`byBriefLanguage`).

Intervals are 95% percentile bootstraps (2,000 resamples, `../lib/stats.ts`). Within a pool they resample seeds. The overall figures average the pools and resample pools first, then seeds inside each drawn pool: seeds of one pool share most of their companies, so treating all (pool, seed) pairs as independent would make the intervals too narrow.

## The pools

Recorded on 2026-11-24. A fresh recording will differ slightly as the directory and the register change; the results file carries a fingerprint of each pool.

| Pool                  | Companies | Source                                                                                                                                                                   |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `yc`                  | 6,246     | Y Combinator directory (`yc-oss.github.io/api/companies/all.json`): every company with a one-liner. Text: name, one-liner, first 600 characters of the long description. |
| `brreg-food`          | 4,355     | Norwegian register (Brreg): units whose primary NACE code is 10.x, food manufacturing.                                                                                   |
| `brreg-drinks`        | 1,422     | Brreg: primary code 11.x or 56.3x, beverage manufacturing and bars.                                                                                                      |
| `brreg-health-bergen` | 3,692     | Brreg: primary code 86.x, health services, registered in Bergen (municipality 4601).                                                                                     |

Register text: name, activity (`aktivitet`) and, when it does not repeat the activity word for word, the statutory purpose (`vedtektsfestetFormaal`). Left out of the register pools: 114 units a query returned on a secondary code only, and 1 unit that lists the target class as a secondary code (its label would be ambiguous).

Tags, industries, NACE codes and their official descriptions never reach a company's text: they are the hidden labels.

## The briefs

Written before any policy was run and not changed since, except the word order of one Norwegian sentence ("te i løsvekt"), fixed before any run on the register pools.

Each segment is what a seller would type into the segment form: what it offers and to whom (`offering`), and the buyer types it lists (`categories`). The brief every policy starts from is production's `buyerBrief` of the two, for example:

> Businesses that would buy, stock or resell what this seller offers: Brewing malt, hops and yeast in bulk, with recipe support, for companies that brew their own beer: craft breweries, microbreweries and brewpubs. Buyer types or categories: breweries, craft beer producers.

The word-overlap baseline reads the same `categories`, which is how the form holds them.

### Y Combinator directory (English briefs; the same in the headline and in the first run)

| Segment             | Offering                                                                                                                                                                                                                   | Categories                                                                      | A company is good when                                                                     | Good        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| `yc-devtools`       | Technical writing and developer-relations services for companies whose product is used by software engineers: APIs, SDKs, databases, cloud infrastructure, and testing, deployment and monitoring tools.                   | developer tools; API and SDK platforms; DevOps and infrastructure software      | it is tagged Developer Tools, DevOps or DevSecOps                                          | 615 (9.8%)  |
| `yc-healthcare`     | Regulatory and clinical-compliance consulting for companies building products or services for patients, clinicians, hospitals and insurers: digital health, medical devices, diagnostics, and biotech and drug developers. | healthcare companies; digital health; medical devices; biotech and therapeutics | its industry is Healthcare                                                                 | 702 (11.2%) |
| `yc-climate-energy` | Carbon accounting and life-cycle assessment for companies whose business is cutting emissions or producing clean energy: solar, batteries and energy storage, electric vehicles, carbon removal and energy efficiency.     | climate tech; clean energy; carbon removal; energy storage                      | its sub-industry is Energy or Climate, or it carries one of eleven climate and energy tags | 238 (3.8%)  |
| `yc-logistics`      | Cargo insurance and claims handling for companies that move, store or track physical goods: freight forwarders, trucking and delivery fleets, warehouses, and the software that runs supply chains.                        | logistics; freight and shipping; supply chain software; warehousing             | its sub-industry is Supply Chain and Logistics, or it carries one of six logistics tags    | 245 (3.9%)  |

### Norwegian register, English briefs (the first run; company texts are Norwegian)

| Segment               | Pool                  | Offering                                                                                                                                                          | Categories                                 | A company is good when          | Good        |
| --------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------- | ----------- |
| `brreg-coffee-tea`    | `brreg-food`          | Green coffee beans and bulk loose-leaf tea, sold by the pallet to businesses that roast coffee or blend and pack tea under their own label.                       | coffee roasters; tea blenders and packers  | its primary NACE code is 10.830 | 109 (2.5%)  |
| `brreg-breweries`     | `brreg-drinks`        | Brewing malt, hops and yeast in bulk, with recipe support, for companies that brew their own beer: craft breweries, microbreweries and brewpubs.                  | breweries; craft beer producers            | its primary NACE code is 11.050 | 233 (16.4%) |
| `brreg-dental-bergen` | `brreg-health-bergen` | Dental consumables, instruments and sterilisation equipment, delivered weekly to dental practices and clinics: general dentists, orthodontists and oral surgeons. | dental practices; dentists; dental clinics | its primary NACE code is 86.230 | 421 (11.4%) |

### Norwegian register, Norwegian briefs (the headline condition)

The same three segments as a Norwegian seller would type them. These runs were planned as a sensitivity check and now carry the headline for the register pools.

| Segment               | Offering                                                                                                                                                                         | Categories                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `brreg-coffee-tea`    | Råkaffe og te i løsvekt, solgt pallevis til bedrifter som brenner kaffe eller blander og pakker te under eget merke.                                                             | kaffebrennerier; teblandere og tepakkerier |
| `brreg-breweries`     | Malt, humle og gjær i bulk, med hjelp til oppskrifter, for bedrifter som brygger sitt eget øl: håndverksbryggerier, mikrobryggerier og bryggeripuber.                            | bryggerier; ølprodusenter                  |
| `brreg-dental-bergen` | Forbruksvarer, instrumenter og steriliseringsutstyr til tannbehandling, levert ukentlig til tannlegekontorer og tannklinikker: allmenntannleger, kjeveortopeder og oralkirurger. | tannlegekontorer; tannleger; tannklinikker |

### Development segments (used to pick hyper-parameters; never reported)

| Segment        | Offering                                                                                                                                                       | Categories                                            | A company is good when                                                                          | Good        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------- |
| `yc-education` | Curriculum design and learning-science review for companies that teach: online courses, tutoring, school software and learning apps for students and teachers. | education; online learning; tutoring; school software | its industry is Education, or it is tagged Education, eLearning, AI-Enhanced Learning or Edtech | 216 (3.5%)  |
| `yc-fintech`   | Fraud screening and identity verification for companies that move or manage money: payments, lending, banking, insurance, investing and accounting software.   | fintech; payments; lending and banking; insurance     | its industry is Fintech                                                                         | 664 (10.6%) |

The exact tag lists are in `segments.ts`.

## Choices fixed before the reported run

**Vectors.** nomic-embed-text (Ollama, 768 dimensions) recommends task prefixes (`search_query: ` on the brief and on the baseline text, `search_document: ` on companies). Both kinds were recorded. On the two development segments today's ranking has a mean average precision of 0.388 without the prefixes and 0.366 with them, so **every policy uses the vectors without prefixes**. The results file shows the same comparison for each reported pool.

**Hyper-parameters.** Rocchio's weights (1, 0.75, 0.15), the batch sizes, budgets, seeds and the 80% draw come from the experiment's brief. Fixed by judgement and never varied: 100 provisional negatives (the count used in the technology-assisted-review reference implementation), 10% random checks for ε-greedy, 48 projected dimensions, a verdict noise of 0.5 and prior spreads of 0.25 on the weight of today's score and 1 on the intercept for the Bayesian model, 3 neighbours for `knn-feedback`.

The rest were searched by `tune.ts` on `yc-education` and `yc-fintech` only, with seeds 101 to 110 (the reported runs use 1 to 20), keeping per learner the value that finds the most good companies after 100 checks:

| Learner                             | Grid                                                             | Kept                  |
| ----------------------------------- | ---------------------------------------------------------------- | --------------------- |
| `cal-logreg` (and its two variants) | C: 1, 10, 100, 1000                                              | 10                    |
| `thompson`                          | prior spread of the projection weights: 0.05, 0.1, 0.2, 0.4, 0.8 | 0.1                   |
| `linucb`                            | the same spread × bonus: 0.1, 0.25, 0.5, 1, 2                    | spread 0.4, bonus 0.5 |
| `knn-feedback`                      | weight: 0.5, 1, 2, 4, 8, 16                                      | 4                     |

The first search had a narrower grid for the bonus (0.5 to 2) and the weight (0.5 to 4); both optima sat on an edge, so the grids were widened once, still on the development segments. `tuning.json` holds the full table. The same search also names the learner one would ship from the development segments alone (`linucb`, a whisker ahead of `cal-logreg`); the results file reports it next to the learner that came out best on the reported pools, since a best-of-seven picked after the fact leans optimistic.

No reported segment was run before these choices were written into `config.ts`. The one choice made after results were seen is which set of briefs carries the headline (see "The first run" above); it changed no run and no hyper-parameter.

## Files

| File                                 | Role                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `record.ts`                          | Entry point: fetch pools, compute embeddings.                                                           |
| `run.ts`                             | Entry point: the experiment, offline and deterministic.                                                 |
| `tune.ts`, `tuning.json`             | The hyper-parameter search on the development segments, and its table.                                  |
| `selfcheck.ts`                       | Checks of the policies' arithmetic on a synthetic pool.                                                 |
| `segments.ts`, `briefs.ts`           | Pools, segments, label rules; the brief via production's `buyerBrief`.                                  |
| `config.ts`                          | Every number the experiment depends on.                                                                 |
| `data.ts`                            | Pools from the recorder, texts via production's `companyText`, vectors from the local embedder's cache. |
| `maths.ts`, `linalg.ts`              | Today's scores via the production functions; the similarity matrix and projection the learners share.   |
| `policies.ts`                        | The eleven policies.                                                                                    |
| `simulate.ts`, `job.ts`, `worker.ts` | The checking loop; one pool's worth of runs; the child process that runs it.                            |
| `prefix.ts`                          | The with/without-prefix decision.                                                                       |
| `stats.ts`, `report.ts`              | Intervals; the results file, the table and the findings.                                                |

## Limits

- **Labels are directory tags and register codes, not buying decisions.** A company can be a real prospect without the tag, and a register code can disagree with what the company says it does (some units coded as coffee processors describe themselves as holding companies). Every policy is scored against the same labels.
- **These labels are the easy kind to learn.** They follow from what a company's text is about (its industry, its registered activity), and that is what an embedding captures best. A real verdict also turns on things the text does not say (size, timing, an existing supplier). Expect smaller gains in production than here.
- **A check here always tells the truth.** In production the verdict comes from a chat model and then a person, and both are sometimes wrong. No label noise is simulated; a learner fed wrong verdicts would learn less.
- **The headline condition was chosen after the first run was reviewed.** It is the less favourable one for the learners and nothing was re-tuned for it, but it was not the plan: the Norwegian-brief runs were made as a sensitivity check.
- **No pool starts almost empty.** In every pool, under either set of briefs, today's first 25 checks hold more than 8 good companies on average, so the experiment does not show how a learner fares when the first batches bring back no positive at all.
- **The embedding model is the local nomic-embed-text**, weaker than a paid model, most of all on Norwegian text read against an English brief. A stronger model would lift today's ranking and leave the learners less to add.
- **The briefs carry no seller profile and no partner kind.** Production appends both ("As: retailer." and "Seller: ..."); a real brief is longer and sits further from the buyers' own words.
- **Production's gate is ignored.** Production drops every company whose relevance is not above zero before any check; the simulation lets a policy reach them. With every brief in the buyers' language the gate would keep 98% of the good companies; with English briefs on the Norwegian pools it would keep 79% over the seven pools and 11% of Bergen's dentists.
- **Seven pools from two sources.** Hyper-parameters were picked on two other segments of the Y Combinator directory, so the four reported YC segments share that pool's companies (not its labels); the three register pools were never seen before the reported run. The overall intervals resample pools as well as seeds, but seven pools cannot stand for every segment a customer will write.
- **Checks to 25 is capped.** A run that has not found 25 good companies within 500 checks counts as 500, which understates how much slower it is. For the fixed rankings the uncapped figure is reported too.
- **Batch-size runs cover six policies and the first run only.** The runs with batches of 1 and 10 leave out the two variants of `cal-logreg` and the policies a batch size cannot change, and they use the English briefs.
- **Cost is counted in checks only.** A learner's own computation (a small model refit per batch) is ignored; it is milliseconds against a check that costs a model call and a website read.
