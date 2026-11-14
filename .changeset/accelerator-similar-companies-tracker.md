---
"@launchstack/pipelines": minor
---

Add Supported-accelerator data for Accelerators: past accepted companies with
embeddings for similarity search, and published application responses with their
provenance (original or unverified copy) and caveats. Y Combinator is the first
Supported accelerator; an operator collector fills it from the public yc-oss mirror
and founder-published pages without requesting ycombinator.com; an application
whose page lost either anchor is skipped, and only http(s) company links are kept.

Add a company-private application tracker: one opportunity per company, Program
and cycle, with priority, manual status, notes, next action, planned deadline and
tasks. Choosing a cycle upgrades a Program-only opportunity in place; a later cycle
is tracked separately. A date-only official deadline is planned against as a date
(`plannedDeadlineOn`), never given an invented time. Tracking never submits
applications or starts paid scoring.

Rubric `fit-v2` (replacing `fit-v1`): the "Similar past companies" area is graded by
rule for Supported accelerators from past-company similarity, and the rubric is
exported from `@launchstack/pipelines/accelerators/fit`, a subpath without Node-only
dependencies. Scoring runs take the chosen `programIds`, are batched, and are priced
per Program scored.

Program dossiers (`@launchstack/pipelines/accelerators/intelligence`) now carry deal
components, intake, application routes, format and location, and per-facet tags filled
by the deterministic scraper in `services/accelerator-scraper`.

Application routes are kept once per page (https preferred, tracking parameters
removed), and quoted deal wording is rejoined from overlapping quote windows and cut
at sentence boundaries, with "…" marking a cut that has none. A scraped deal gets no
generated summary; its components carry the terms.
