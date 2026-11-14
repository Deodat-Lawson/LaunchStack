# Accelerators — discovery and matching handoff

## Current delivery scope

Help a startup find accelerator **Programs**, understand how they fit its **Core profile**, and reach the official website or application portal.

This branch delivers the whole discovery loop: a scraped, sourced Catalogue; browsing, search and tag filters; rubric-based company fit with a chosen scoring scope; ranking; similar past companies for YC; and a manual application tracker. It does not fill, draft or submit applications: the LaunchStack Form workflow (Form navigation, Application creation, answer editing, AI drafting) stays removed, and the tracker only records what the founder did on the Program's own site.

Kien will investigate application assistance separately, including a possible browser extension. That research does not block this delivery. Do not reintroduce the removed workflow as a dependency of Program discovery.

This scope replaces the Form-related assignments in [issue #510](https://github.com/Deodat-Lawson/LaunchStack/issues/510), [issue #559](https://github.com/Deodat-Lawson/LaunchStack/issues/559), [the earlier technical design](technical-design.md), and [its review](technical-design-review.md). Those documents describe historical scope, not additional requirements for this branch.

## Terms

| Term            | Meaning                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Program         | An accelerator that a startup can apply to. The Catalogue does not list other startup companies.                   |
| Cycle           | A particular batch or rolling intake of a Program.                                                                 |
| Catalogue       | The reviewed collection of public Program records.                                                                 |
| Program profile | Sourced descriptions of the Program and its target applicants, including identified AI interpretations.            |
| Core profile    | The existing company profile and its supporting evidence, not a new profile store.                                 |
| Fit result      | A company-specific comparison of a Program profile with the Core profile. A score is not an admission probability. |

## What this branch does

- **Browse:** compact, fully clickable Program rows with verified logos (a lettered tile when no logo could be verified), location, stages, upcoming deadline and saved fit ring.
- **Program page:** hero with upfront cash, fixed equity, next deadline and acceptance rate; tabs for Overview, Deal, Applying and Similar companies; fit panel and "Your application" tracker beside them. Every fact comes from the Program's dossier with its source link, or reads **Not published** (checked, not found) or **Not checked**.
- **Search and filters:** search covers name, real narrative, location and tags (scraper boilerplate is excluded). Facets for sectors, stage, region, deal (equity-free, fixed equity, not published), deadline window, tracking (all, tracked, awaiting decision, untracked) and priority run on dossier tags for the whole Catalogue; an unknown value never matches a facet. Filters combine with AND and survive opening a Program.
- **Scoring:** the **Score** control scores the chosen Programs, not the whole Catalogue: the top N of the current filtered and sorted list (default 30) or everything filtered. The button shows how many Programs will be sent and the credit estimate (167 credits per Program). Programs whose saved result is still current for the same profile, Program and rubric are skipped unless **Re-score current results** is ticked, so unchanged inputs keep their grades and are not charged again.
- **Fit rubric `fit-v2`:** seven weighted areas (sector 20, stage 15, business model 15, past companies 15, deal 15, operations 10, value 10). The model grades six areas in batches of up to 10 Programs, citing Program and company evidence for every grade; a Program whose grades fail validation keeps its previous result. "Similar past companies" is graded by rule for Supported accelerators (YC) from the similarity of the five closest past companies, and does not apply elsewhere. An overall score appears only when graded areas cover at least 70% of the applicable weight. A score is not an admission probability, and unknown is never shown as 0.
- **Ranking:** current scores high to low, then current results without enough evidence, then out of date, then not scored; other sorts are nearest deadline, name and your priority. Results go out of date when the profile, the Program record or the rubric changes.
- **Tracker:** one company-private opportunity per Program and cycle with priority, status (shortlisted to accepted/rejected/withdrawn), notes, next action, submission date, tasks and the deadline planned against (an instant, or a date when the Program gave no time). Tracking never submits anything and never starts paid scoring.
- **Access:** active membership, unrestricted access to all company documents, and read/edit permission per action, enforced on APIs and background work; output, run completion and debit commit atomically.

## Team responsibilities

### Tony — Catalogue coverage and accuracy

Own a bounded, reviewed collection for the agreed startup audience, not a quota of arbitrary scraped sites.

- Research official Program information and collect its source URLs and checked dates.
- Supply the required official logo asset with its source reference.
- Produce Program descriptions and target-applicant narratives from collected information. Identify AI interpretations; do not turn a preference into an eligibility requirement.
- Preserve useful narrative detail. Target applicants are not limited to a fixed `pre_idea` / `early_stage` enum.
- Include available location, Cycle, deadline, and other supported information. Unknown information stays unknown.
- Validate records, import them through the operator command, inspect them in the product, and prove that re-import does not create duplicates.
- Report coverage, inaccessible sources, and outstanding checks.

A one-off collector is acceptable. A maintained pipeline is welcome but not required. **Complete Form questions are not an acceptance requirement.** Cycles can omit Form metadata; never invent questions or mark an unchecked Form as checked to satisfy an import.

### Tiffany — discovery experience and match quality

The next main-product lane is making the existing finder useful with a larger Catalogue, not continuing the removed selected-text workflow.

- Build on the existing Program list/detail surfaces and shared matcher rather than creating a second implementation.
- Extend the existing search and factual filters only for agreed discovery needs backed by reliable data; do not rebuild the controls already in this base.
- Make fit reasons, concerns, missing information, and outdated results clear to users.
- Exercise representative startup profiles with different stages, sectors, locations, and incomplete information.
- Own the agreed matching or presentation fixes those cases reveal, not just a QA report. Do not make fit scores imply admission probability or invented company facts.

Search, factual filters, and the separated evaluation/detail layout are delivered in this base. Broader classification and production-quality matching evaluation remain follow-on work. Agree the specific acceptance cases with Kien before expanding the matcher or its data contract.

### Kien — product scope, integration, and application-assistance research

Set the initial startup audience, required Program coverage, and release acceptance cases. Own shared-contract changes and integration. Investigate extension/Form assistance separately; it must not block the team's discovery and matching work.

## Code and branch workflow

Start from the latest published **`origin/grants-pipeline`**, not Tiffany's earlier selected-text branch or the earlier documentation-only handoff commit. Use a clean checkout and choose the command for your task:

```sh
git fetch origin
git switch -c accelerators/tony-catalogue origin/grants-pipeline
```

```sh
git fetch origin
git switch -c accelerators/tiffany-discovery origin/grants-pipeline
```

Push your own branch and open a PR with **`grants-pipeline` as the base**. Do not push directly to the shared integration branch. Include the starting SHA, changed files, exercised checks, screenshots for UI changes, data limitations, and any schema or shared-file dependencies. Rebase or merge the latest integration base before final handoff; do not use force pushes against the shared branch.

Suggested ownership:

- Tony: `fixtures/accelerators/programs/`, `apps/web/public/accelerators/logos/`, and his collection scripts.
- Tiffany: `apps/web/src/app/employer/tools/accelerators/`, corresponding message catalogues and behavioral tests. Coordinate matcher changes in `apps/web/src/server/accelerators/` with Kien.
- Shared integration: Catalogue schemas/import, shared Proposals engine and storage, migrations, permissions, metering, and global registration. Discuss changes before editing these surfaces in parallel.

## Contracts and implementation map

| Area                                             | Location                                                        |
| ------------------------------------------------ | --------------------------------------------------------------- |
| Catalogue, Cycle, fit and API types              | `pipelines/src/proposals/accelerators/types.ts`                 |
| Catalogue import and company matches             | `pipelines/src/proposals/accelerators/db.ts`                    |
| Canonical content hashes                         | `pipelines/src/proposals/accelerators/hash.ts`                  |
| Trusted import command                           | `apps/web/scripts/import-accelerators.ts`                       |
| Access gate and matching preparation             | `apps/web/src/server/accelerators/`                             |
| Matching-only HTTP API                           | `apps/web/src/app/api/accelerators/`                            |
| Program UI and client/provider                   | `apps/web/src/app/employer/tools/accelerators/`                 |
| Existing shared AI execution and credit handling | `pipelines/src/proposals/` and `apps/web/src/server/proposals/` |

### Catalogue records

Use **schema version 2**. Existing records remain valid; Cycle Form metadata is optional. Form/Field schema definitions and historical storage can remain for existing data, but there is no active Form editor, answer API, drafting run, or suggestion contract in this delivery.

A Program contains stable identity, name, required sourced logo, official website/application URLs, sourced description and target applicants, sources, optional sourced location, and Cycles. Source references must resolve inside the same Program. Logos use committed non-empty assets under `apps/web/public/accelerators/logos/`; do not use arbitrary external image URLs or invent a replacement mark.

Importing a changed Program updates its content hash and makes affected saved fits out of date. It does not start another paid match. Company users do not receive installation-wide Catalogue write access: there is no user-facing import endpoint.

### Remaining HTTP API

The server resolves the authenticated company; clients cannot supply tenancy. Reads require `documents.read`; matching requires `documents.edit`; both require unrestricted company-document access.

| Method and path                      | Result                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `GET /api/accelerators`              | Programs, saved company fits, profile readiness, edit permission, and matching cost |
| `GET /api/accelerators/programs/:id` | Program detail and company fit                                                      |
| `POST /api/accelerators/match`       | Starts explicit matching and returns `{ run }`                                      |
| `GET /api/accelerators/runs/:id`     | Matching progress/result summary within the authenticated company                   |

The active Accelerator run kind is **`programs`**. The `accel_draft` and `accel_edit` kinds and all `/api/accelerators/applications/...` endpoints are removed. Retired stored runs must not be claimed, charged, exposed through current APIs, or allowed to block a new active run.

Existing database migrations and historical answers/results are retained. Do not drop columns or reset a database as part of this cutover. Retaining history does not make the removed feature callable.

## Local setup and operator commands

Run from the repository root. Set `DATABASE_URL` to an explicit, isolated development installation first. Do not migrate, seed, test, or import into production or an unspecified database.

```sh
pnpm install --frozen-lockfile
pnpm --filter @launchstack/web db:migrate
```

### Refreshing the Catalogue (`services/accelerator-scraper`)

The scraper is deterministic Python with no model calls; see `services/accelerator-scraper/README.md`. It honours robots.txt and crawl-delay, caches pages so reruns are stable, reads up to 15 relevant pages per Program (sitemap, apply, FAQ, terms, dates) and renders JavaScript pages with headless Chromium only when the static page is too thin. Every extracted value keeps its excerpt; a field it checked and could not find is recorded as not published with the pages checked. Y Combinator's pages are in scope by product decision, with robots.txt honoured.

```sh
uv venv --python 3.12 services/accelerator-scraper/.venv
uv pip install --python services/accelerator-scraper/.venv/bin/python \
  -r services/accelerator-scraper/requirements.txt -r services/accelerator-scraper/requirements-render.txt
services/accelerator-scraper/.venv/bin/python -m playwright install chromium

S=services/accelerator-scraper/.venv/bin/python
$S services/accelerator-scraper/scrape.py refresh            # every Program
$S services/accelerator-scraper/scrape.py discover vet       # rule-based accept/reject of candidates, with reasons
$S services/accelerator-scraper/scrape.py discover add-confirmed
$S services/accelerator-scraper/scrape.py coverage           # rewrites fixtures/accelerators/COVERAGE.md

# Validate, then import records and their dossiers (records first; dossiers reference them).
pnpm --filter @launchstack/web accelerators:import -- --validate ../../fixtures/accelerators/programs/*.json
pnpm --filter @launchstack/web accelerators:import -- --installation local-accelerators ../../fixtures/accelerators/programs/*.json
pnpm --filter @launchstack/web accelerators:import-intelligence -- --installation local-accelerators
```

### Similar YC companies

Y Combinator is the only Supported accelerator. Its past companies come from the public [yc-oss](https://github.com/yc-oss/api) mirror of YC's directory, and published applications from the founders' own pages or collection sites listed in `apps/web/scripts/yc-application-sources.ts`. That collector does not request ycombinator.com, and an application whose page no longer has both of its anchors is skipped rather than stored with the page around it. The data lands only in the target database and is never committed; neither yc-oss nor the founders grant reuse rights, so do not republish it.

```sh
# After importing the y-combinator Program. Embeddings use EMBEDDING_API_BASE_URL/EMBEDDING_API_KEY
# and wait out per-minute rate limits; re-runs embed only changed companies.
pnpm --filter @launchstack/web accelerators:collect-yc -- --installation local-accelerators
```

A Program's **Similar companies** tab lists the past companies closest to the Core profile, each with its yc-oss pitch and, when the founders published it, a link to the application. The same similarity feeds YC's "Similar past companies" grade.

## Open decision: classifying what the rules cannot

Filters only offer options that match at least one Program, with counts and "Known for N of M" per facet. Coverage from the rule-based scraper on 255 Programs (November 2026): program type 230, region 208, sector 206, technology 174, stage 171, benefits 133, deal terms 114, customers 88, business model 65, instrument 28, dated next deadline 21, acceptance rate 14.

Two kinds of gap remain, and they need different fixes:

- **Classification** (sector, stage, business model, customers, instrument, benefits): Programs usually describe these in words the rules do not match. A model-based classifier could fill them from text the scraper already cached, without fetching: fixed tag vocabulary only, a cited excerpt for every tag, labelled "AI-classified" rather than shown as fact, and rerun only when a Program's pages change.
- **Facts** (deadline dates, cash amounts, acceptance rates): published or not. A model must never fill these; they stay "Not published".

Deferred by product decision (14 November 2026): decide whether to add the classifier before release.

## Development and acceptance guidelines

- Follow `apps/web/README.md`: kit primitives, semantic tokens, Lucide icons, and English/Simplified Chinese message parity. Do not introduce raw UI colours, inline English, or a second component system.
- Keep public Program information separate from private company profiles and fits. Preserve membership, action permissions, full-document access, scope checks, and final-access rechecks.
- Reuse the existing matching run, configured model, credit adapter, and atomic commit path. Do not create unmetered model calls or a second AI job system.
- Never commit credentials, private application answers, browser sessions, or applicant data in Catalogue fixtures or screenshots.
- Keep changes focused. Do not change Grants behavior, perform unrelated rewrites, or add Form assistance to satisfy discovery acceptance.
- Run pipeline/web typechecks and affected behavioral suites. Validate record/logo assets with the real import command. UI changes need actual browser proof at desktop and narrow widths.
- For the release, prove that a startup can find relevant Programs within the agreed coverage, understand fit and uncertainty, and reach an official application link **without using a LaunchStack Form**.

## Verification (14 November 2026)

- Scraper: 64 tests pass (`scrape.py test`, also run in CI's python-services job). Four full refreshes of the 255 Programs; the record and check files each run changed went 28/52, 19/5, then 7/18. The last run's changes were compared field by field against the previous run: rotating links on the sites (member spotlights, news lists), CDN images renamed, quotes whose page text changed, and two logos that became available. The crawl itself is ordered by page kind, depth and URL, so the same site gives the same pages. Two scraper defects found this way were fixed: login and admin URLs were crawled as Program pages, and gaining a logo deleted the shared `none.png`.
- Coverage after the last refresh (`fixtures/accelerators/COVERAGE.md`): application route 245, sector 202, region 198, stage 164, deal components 108, intake 92, public email 89, instrument 28, dated next deadline 12, selectivity 5. Twelve sources on ten Programs block crawlers and were not read.
- Both import commands validated and imported all 255 records and dossiers, including every logo asset, into the local review database.
- Pipelines: typecheck and 12 files / 116 tests pass. Web: typecheck, lint of every accelerator path, and 22 suites / 327 tests pass, including the disposable-Postgres tracker and scoring tests and English/Chinese message parity.
- Browser, desktop and 420px: search, filters with counts, Program pages (facts, titled application links, the program's quoted deal wording, one source list), scoring two filtered Programs from the score control (334 credits debited, results ranked), and the tracker.

Limits: a tag the rules cannot read stays unknown (see the open decision above). Scoring is not fully repeatable: two runs on the same inputs changed 18 of 84 area grades. The matching port still rejects a `null` ledger debit inside the finalization transaction, so a run never publishes output without a debit.
