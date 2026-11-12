# Accelerator Program collection

This note is the reproduction path for the records added on `accelerators/tony-catalogue`. It does not change the shared importer.

## Coverage in this delivery

Kien's reference records already cover Y Combinator, Techstars London, and aboveA Startup Accelerator. The first pass added a16z speedrun, Antler, and Entrepreneurs First. A later pass added the programs below. Each new record is schemaVersion 2. Descriptions are `interpretation: true` and stay inside the quoted official pages. Deadlines without a year, a clock, or an agreed date were left empty. Forms that were login-gated, split across pages, or not opened stay unsupported, so Start Application stays blocked.

| Record                               | File                                                 | Form                                                                                      |
| ------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Y Combinator                         | existing reference                                   | Unavailable. Login-gated. Not changed here.                                               |
| Techstars London                     | existing reference                                   | Unconfirmed. Not changed here.                                                            |
| aboveA Startup Accelerator           | existing reference                                   | Checked public Form. Not changed here.                                                    |
| a16z speedrun                        | `programs/a16z-speedrun.json`                        | Public markup reviewed. Repeated co-founder structure. Start Application blocked.         |
| Antler                               | `programs/antler.json`                               | Public markup reviewed. Conditional city and Elevate branch. Start Application blocked.   |
| Entrepreneurs First                  | `programs/entrepreneurs-first.json`                  | Bangalore and Bridge first steps only. Remainder is behind email verification.            |
| 500 Global                           | `programs/500-global.json`                           | Flagship page read. Close date has no year. Start Application blocked.                    |
| MassChallenge                        | `programs/masschallenge.json`                        | Accelerator groups only. Placeholder lines ignored. Start Application blocked.            |
| Alchemist                            | `programs/alchemist.json`                            | Apply page had no questions. Chicago, Doha, and Japan not opened.                         |
| SOSV                                 | `programs/sosv.json`                                 | Apply page is a chooser among NY, SF, and HAX. No single Form.                            |
| HAX                                  | `programs/hax.json`                                  | Program page read. Application not opened. Newsletter form not imported.                  |
| Founder Institute                    | `programs/founder-institute.json`                    | Washington DC - Philadelphia Fall 2026. Nov 10 and Nov 17 closings left unresolved.       |
| Berkeley SkyDeck                     | `programs/berkeley-skydeck.json`                     | Batch 23 window ends 2026-08-21 with no clock. Batch 24 says January and has no year.     |
| Creative Destruction Lab             | `programs/creative-destruction-lab.json`             | Program page read. Stream pages and the Form were not opened.                             |
| Founders Factory                     | `programs/founders-factory.json`                     | Accelerator page read. Partner programs and the Form were not opened.                     |
| AngelPad                             | `programs/angelpad.json`                             | Homepage read. On-page apply anchor was not converted into a Form.                        |
| Entrepreneurs Roundtable Accelerator | `programs/entrepreneurs-roundtable-accelerator.json` | Winter 2027 deadline is the date 2026-11-02. Questions behind Apply Now were not opened.  |
| South Park Commons                   | `programs/south-park-commons.json`                   | Residency page read. Residency and funding forms were not opened.                         |
| Techstars                            | `programs/techstars.json`                            | Network page. Distinct from Techstars London. apply.techstars.com did not show questions. |
| gener8tor                            | `programs/gener8tor.json`                            | Investment-accelerator overview. City applications were not opened.                       |
| Google for Startups                  | `programs/google-for-startups.json`                  | Programs page read. Accelerator URL was navigation only.                                  |
| HF0                                  | `programs/hf0.json`                                  | First step is name, email, and phone. Later steps not opened. Batch dates have no year.   |
| StartX                               | `programs/startx.json`                               | Fellows date is Nov 1 with no year. No equity and no fees, as the homepage states.        |
| Dreamit                              | `programs/dreamit.json`                              | First page of a two-page pitch form, including a required deck file. Not imported.        |
| Boost VC                             | `programs/boost-vc.json`                             | Homepage says $500k checks. Fellowship page says $50k and Dec 1st with no year.           |

Not collected into these records: other Techstars cities, Antler per-location investment terms, the EF hub programs whose forms were not opened, Founder Institute chapters other than Washington DC - Philadelphia, and gener8tor's individual city accelerators. Plug and Play and Neo were fetched and skipped because the public HTML did not contain a program description. Seedcamp's homepage was portfolio news rather than program terms. Bethnal Green Ventures' fetched page was a newsletter gate.

## What was collected

On 2026-10-26 and 2026-10-27, anonymous HTTP GET requests were made to the official URLs cited in each record. No account was created, no terms were accepted, no application was submitted, and no portal credentials were stored. Visible page text was quoted into `sources`. Descriptions and target-applicant narratives are marked `interpretation: true` and use only those quotes. Conflicting official statements are left as conflicts. That includes speedrun's April 16 versus April 18, 2027 residency end; Antler's 30 versus 26 locations; 500 Global's October 11th close with no year beside an unlabeled November 30, 2026 - April 9, 2027 range; Founder Institute's Nov 10 close beside a Nov 17 6:00 pm final deadline; HF0's two batch starts and two demo days with no years; and Boost VC's $500k checks beside a $50k fellowship.

Logos are official marks rasterized to PNG under `apps/web/public/accelerators/logos/`. SVG wordmarks were rasterized because the catalogue image component does not serve SVG. White header marks were not recolored. HAX is the official black file from SOSV rather than the white-and-green header SVG, so the wordmark stays visible on a light panel. Founders Factory's published wordmark is white (`#FFFFFF`) and is faint on a light panel. The 500 Global page's lorem ipsum block and MassChallenge's "Short one liner description here" placeholders were not stored as facts.

## Validate and import

Run from the repository root. `DATABASE_URL` must be your own development database.

```sh
pnpm --filter @launchstack/web accelerators:import -- --validate \
  ../../fixtures/accelerators/programs/*.json

pnpm --filter @launchstack/web accelerators:import -- --installation local-accelerators \
  ../../fixtures/accelerators/programs/*.json
```

Run the import a second time. The second run should report the same identities unchanged rather than inserted again.

Then open `/employer/documents?feature=accelerators&at=/programs` and check logos, sources, dates, and Form state. None of the Forms added in this delivery can start an Application.

## Homepage pass on 2026-11-03

A later pass retrieved public homepages for additional accelerators, incubators, fellowships, and startup programs and kept every page that returned visible text plus a downloadable official image. Pages that were empty, blocked, or had no logo were skipped. Two redirects that landed on a page already kept (Elemental Impact, and Chinaccelerator onto Orbit) were not stored twice.

These records quote that visible text and mark the summary as interpretation. They do not store a deadline, and they do not include application fields. Start Application stays blocked. The catalogue files under `programs/` are the full set; validate and import them together with the command above.

Y Combinator, Techstars London, and aboveA stay as the reference records already in the shared catalogue. This delivery does not edit them.

The shared Program record stays schema version 2. Program intelligence is a separate public contract, `program-intelligence/v1`, keyed by the same Program id. It carries source excerpts, fact versus interpretation, and explicit missing, conflicting, stale, inaccessible, not-applicable, partial, unavailable, and not-checked states. Conflicting sources stay on the operator review queue. This delivery does not score company fit and does not change screens.

| File                                    | What it holds                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deals/`                                | Formatted terms for speedrun, Y Combinator, ERA, Entrepreneur First, and SkyDeck. Cash, SAFEs, grants, and credits stay separate.                                                    |
| `portfolio/`                            | Company identities from the ERA companies page, the EF portfolio page, and the first SkyDeck companies page. speedrun's companies page and Antler's count had no company identities. |
| `taxonomy.json`                         | Tags whose labels or aliases appear in a cited source quote. Facets stay separate.                                                                                                   |
| `examples/historical-applications.json` | The public Dropbox Summer 2007 YC application. Acceptance is a separate excerpt. The answers are not copied.                                                                         |
| `gaps.json`                             | Conflicts and checks that came back unavailable or partial.                                                                                                                          |
| `intelligence/manifest.json`            | Stable Program, Cycle, portfolio-company, and tag ids, plus the content hash.                                                                                                        |
| `intelligence/review.json`              | Open conflicts, stale excerpts, and unreachable sources for an operator.                                                                                                                                                   |
| `COVERAGE.md`                           | Counts by information group.                                                                                                                                                         |

```sh
python3 fixtures/accelerators/collect.py --self-test
python3 fixtures/accelerators/collect.py --discover a16z-speedrun
python3 fixtures/accelerators/refresh.py --check a16z-speedrun
pnpm --filter @launchstack/web accelerators:publish-intelligence
pnpm --filter @launchstack/web accelerators:import-intelligence -- --validate
```

## Refreshing without an AI pass

`scrape.py` keeps the whole catalogue current from the official pages, so a refresh does not need an assistant to re-read the sites. The code is the `scraper/` package (one module per step, unit tests in `scraper/tests/`). It uses the Python standard library plus Pillow for logos, `rsvg-convert` or ImageMagick for SVG logos, and `pdftotext` for PDF discovery sources. Every fetch is an anonymous GET that honours robots.txt including `Crawl-delay`, waits at least a second between requests to one host, and backs off on `429`/`5xx` for as long as the server asks.

```sh
python3 fixtures/accelerators/scrape.py test             # unit tests, no network
python3 fixtures/accelerators/scrape.py check            # report drift, write nothing, exit 1 on drift
python3 fixtures/accelerators/scrape.py refresh --due    # what the refresh cadence says is due
python3 fixtures/accelerators/scrape.py refresh          # refresh every Program
python3 fixtures/accelerators/scrape.py refresh antler hf0
python3 fixtures/accelerators/scrape.py add acme-labs --name "Acme Labs" \
  --url https://acme.example/ --apply https://acme.example/apply

# then publish, validate, and import (absolute paths: the importer runs from apps/web)
pnpm --filter @launchstack/web accelerators:publish-intelligence
pnpm --filter @launchstack/web accelerators:import -- --installation local-accelerators \
  "$PWD"/fixtures/accelerators/programs/*.json
pnpm --filter @launchstack/web accelerators:import-intelligence -- --installation local-accelerators
```

A run does four things, in order:

1. **Quotes.** Homepage records (sources `homepage` and `official-logo`, one `public-page` cycle, no Form fields) are owned by the script. When most of the stored quote is no longer on the page, the quote and both narratives are rebuilt from the page's visible text. Every other record is curated: its quotes are re-checked exactly as `refresh.py` does, and a missing quote is reported as stale for a person to fix.
2. **Logos.** When the stored logo URL is gone, or the stored file names another company (a portfolio or partner logo), a replacement is taken from the logo the site declares in its schema.org data, the page header, or an image that names the Program, and a site icon of at least 64 px is used only to replace another company's mark (never another icon). Logos the script cannot confirm go to `intelligence/logo-review.json`.
3. **Enrichment** (`scraper/facts.py`, skipped with `refresh --no-enrich`). The homepage and up to four linked official pages (application, terms, batches, details) are read for public role addresses, `tel:` links, and the contacts the site declares in schema.org data, application routes, explicit "applications are open/closed" or "program has closed/paused" wording, dated deadlines with a year, reported acceptance rates, investment wording that names an amount, linked portfolio pages, and links to published application examples. Findings and their excerpts go to `checks/<id>.json`; linked pages go to `discoveries/<id>.json`. A group that was read and states nothing becomes "unavailable on the checked pages", never a negative finding; past dates, dates without deadline wording, personal addresses, and portfolio news are ignored.
4. **Tags.** `taxonomy.json` is rebuilt from `tag-vocabulary.json`: a vocabulary tag is attached only where one of its aliases is a whole word in a stored source quote. Curated tags are kept while their quote still supports them.

A Program file is written only when its content changed, because the Program hash covers `checkedAt` and a new hash marks saved fit results as out of date. Pass `refresh --stamp` to also move `checkedAt` on quotes that were verified. Check and discovery files are likewise rewritten only when a finding changed. Blocked, failed, or near-empty pages keep the stored text and earlier checks. Stale and inaccessible outcomes are merged into `intelligence/refresh-observations.json`, which publishing turns into operator review items while keeping the excerpt and its last successful check.

`refresh --due` follows the refresh proposal: daily for a Program with a known deadline in the next 30 days, weekly for a current intake (a future deadline, a rolling Cycle, or applications stated open), and monthly otherwise. Attempts and last successful checks are kept in `intelligence/check-ledger.json`. Scheduling the command (cron or CI) is not set up in this repository.

| File | What it holds |
| --- | --- |
| `checks/` | Per-Program findings from the official pages, each with its excerpt. |
| `discoveries/` | Linked official pages by kind, with fetch and robots outcome. |
| `tag-vocabulary.json` | The controlled tag list: stable ids, facets, labels, aliases. |
| `intelligence/refresh-observations.json` | Stale and inaccessible sources from the latest refresh of each Program. |
| `intelligence/logo-review.json` | Logos that may belong to a partner or portfolio company. |
| `intelligence/check-ledger.json` | Last attempt and last successful check per Program. |

### Finding US accelerators, incubators, and university and state programs

The catalogue is a worldwide sample, not a census; about 40 of the 249 Programs are clearly US-based. There is no official register of US startup programs: the International Trade Administration counted at least 150 strict accelerators in 2023, and commercial databases that also count incubators report 1,500 to 3,300 (those databases are paid and forbid scraping; Crunchbase and F6S disallow crawlers in robots.txt).

`scrape.py discover` builds a review list from the public lists in `discovery-sources.json`. Each source names its URL, where it came from, and a parser: `directory-links` reads any directory page of outside links (with start and end markers so navigation is ignored), and small parsers read the SBA winner lists and the state PDFs. A source whose layout changes fails loudly instead of yielding nothing. Current sources:

| Source | What it lists |
| --- | --- |
| Library of Congress evaluation of the SBA Growth Accelerator Fund, Appendix IV | 2014–16 winners |
| SBIR.gov | 2021 Growth Accelerator Fund winners |
| FORGE's copy of SBA's 2025 announcement | 2025 Lab-to-Market winners only |
| National Science Foundation | the 13 NSF I-Corps Hubs, with websites |
| New York State (Empire State Development / NYSTAR) | Certified Business Incubators and Innovation Hot Spots, with websites |
| Kentucky Cabinet for Economic Development | accelerators and incubators, with websites |
| Oklahoma Department of Commerce | Directory of Certified Incubators, with websites |
| Office of the Texas Governor | Business Incubators directory (April 2015), with websites |

Not used: Maine's directory (robots.txt refuses crawlers), Wikidata's query service (disallows crawlers), the America's Seed Fund and PR Newswire copies of the SBA lists (the names are not in their HTML), and the NYC Open Data incubator view (a 2018 company map without an incubator field).

```sh
python3 fixtures/accelerators/scrape.py discover harvest        # writes us-candidates.json
python3 fixtures/accelerators/scrape.py discover report
# edit us-candidates.json: set "website" and "status": "confirmed", or "status": "rejected" with a "note"
python3 fixtures/accelerators/scrape.py discover add-confirmed
```

Every entry waits for an operator. Entries a directory listed with a website start as `review`; the rest start as `new` with only a name and state. `kind` is the script's guess (accelerator, incubator, university program, state or public program, support organisation, unknown) and is yours to correct. A harvest merges new names, marks names or websites already in `programs/` as `in_catalogue`, and never overwrites an operator's status, website, applyUrl, kind, or note. `add-confirmed` requires the official pages to speak to startups, founders, entrepreneurs, incubation, or acceleration, plus the usual text and logo checks. Entries that fail become `held` with the reason; the rest become homepage records and are enriched. The 2026-11-11 harvest found 476 organisations in 51 states and territories: 168 with a listed website to check, 300 with a name only, and 8 already in the catalogue.

### Tags: handoff to company fit (Tiffany) and the screens (Kien)

Every published dossier now carries `tags`: a list of `{ id, facet, label, evidenceIds }` that reads on its own, alongside the existing `tagIds`. `evidenceIds` are the Program's own source ids (the quote that contains the tag's wording), so they are valid citations wherever a Program `sourceId` is accepted. The dossiers are in `accelerator_program_intelligence` after `accelerators:import-intelligence`; the vocabulary is `tag-vocabulary.json` and the derived set is `taxonomy.json`. 247 of 249 Programs have at least one tag (median 3). StartupYard and Innovation Labs have none: StartupYard's stored quote is testimonials only, and Innovation Labs' is an unsupported-browser notice, so neither states anything a tag could cite.

| Facet | Tags | Programs |
| --- | ---: | ---: |
| `program_type` (accelerator, incubator, venture studio, residency or fellowship, venture investor, corporate innovation, university, government, founder community, founder education, competition, grant program) | 12 | 166 |
| `sector` | 21 | 109 |
| `geography` | 28 | 122 |
| `stage` | 8 | 78 |
| `technology` | 4 | 70 |
| `benefit` | 6 | 56 |
| `customer_type` | 4 | 38 |
| `business_model` | 4 | 15 |
| `instrument` | 5 | 8 |

A tag means the Program's own page uses that wording. It is not an eligibility rule, and a missing tag is not a negative finding. Not changed here, for the owners to decide:

- **Matching** (`apps/web/src/server/accelerators/run.ts`) sends the model each Program's name, narratives, and sources, not its tags. Passing `tags` (label, facet, and evidenceIds) would let the sector, stage, business-model, and value dimensions cite them. A changed tag changes the dossier hash, not the Program hash, so saved fits would need the dossier hash in their freshness check to go out of date when tags change.
- **Screens** still show tags from the twelve demo stand-ins in `apps/web/src/server/accelerators/demo/`. Rendering `dossier.tags` grouped by facet would show every Program's tags; labels are English, so a Simplified Chinese catalogue keyed by tag `id` is needed.

### Outstanding checks after the 2026-11-11 run

These need an operator; the script reports them and deliberately does not resolve them.

- **Stale curated excerpts:** 37 excerpts on 23 Programs are no longer on their page (`intelligence/review.json`, state `stale`). Most are the curated records (for example Y Combinator's Winter 2027 application cycle and Antler's cohort dates); their deadlines and Forms should be rechecked by hand. Y Combinator, Techstars London, and aboveA are the shared reference records and were not edited.
- **Unreachable sources:** 9 sources on 7 Programs (`hf0` and `atomico` answer `429`, `bp-ventures`, `chain-reaction`, and `esa-bic` disallow robots, `sequoia-arc` returns `404`, and the Y Combinator portal login is disallowed).
- **Conflicts:** 5 open, none resolved by the script: speedrun's residency end, Antler's location count, and pages for ClimateLaunchpad, NEXT Canada, and South Park Commons that say both that applications are open and closed.
- **Logos:** 31 Programs in `intelligence/logo-review.json`. Some are certainly another company's mark (Peak XV shows Airalo, 3one4 shows Licious, Agoranov shows Bloomineral, T-Hub shows Monitra Health, Startuplab shows Favrit); their own marks are on hosts whose robots.txt forbids fetching or are icons under 64 px.
- **Portfolio identities:** 163 Programs link a portfolio page that the script found but did not parse into companies; their portfolio stays "not checked" with the page URL.

`collect.py` records linked official pages for details, terms, portfolio, batches, and application routes. A secondary URL is stored only when `--gap` names the hole it fills. `refresh.py` re-checks stored quotes. A quote that is still present can update `checkedAt`. A missing quote or a failed fetch is recorded as stale or inaccessible and does not replace the excerpt or create a Program, Cycle, or portfolio-company id. Import the schema-version-2 Programs before importing intelligence. The intelligence table is `accelerator_program_intelligence`.
