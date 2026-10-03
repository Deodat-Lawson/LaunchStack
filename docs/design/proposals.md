# Proposals — a writing app for funding proposals

_2026-09-30. Status: shipped as its own app under Tools; runs inline by default._

## Why

A small organisation has no grants department: one person finds the calls,
reads the guidelines, writes every answer from memory and old proposals, and
keeps the deadlines in a spreadsheet. The workspace already holds what they
would reach for — past proposals, annual reports, the strategic plan, board
rosters — as cited sources. Proposals puts that knowledge to work in the
order the job happens, with the writing at the centre:

```
sources ──► organisation profile (facts with citations)
                │
                ├──► funders: plan a search from the profile
                │        Grants.gov (keyless) + web (keyed) → scored for fit
                │
                └──► proposal: a funder's request
                          │ extract → checklist + an outline of sections
                          │ write: draft each section from evidence (+ library)
                          │        rewrite: tighten · specific · plainer · stronger · your words
                          │ review → readiness + findings
                          │ approve → save to the library
                          └ preview → export to a Source, citable next time
```

Every generated sentence points at the excerpt it came from; every gap the
sources cannot fill is named rather than invented. That is the whole
difference from a "write my application" button.

## Where it lives

- **UI** — `apps/web/src/app/employer/tools/proposals`: its own rail (Home ·
  Write · Funders · Profile · Library), a run sheet, and the client contract in
  `api.ts`. The editor at `/write/[id]` is three columns: the outline, the
  section in hand, the evidence beside it. Preview without a backend at
  `/dev/proposals`.
- **Shared kit** — `apps/web/src/components/tools` (`PageHeader`, `EmptyState`,
  `SkeletonRows`, `FitMeter`) and `apps/web/src/lib/tools` (`useResource`,
  `format`), moved out of Growth so both apps read them from one place.
- **Routes** — `apps/web/src/app/api/proposals/*` (22 handlers). Thin:
  workspace context, zod, one service call.
- **Service** — `apps/web/src/server/proposals/{service,adapter,executor,ports}.ts`.
  The adapter is pure (records → DTOs, deadlines in days, the to-do list).
- **Vertical** — `pipelines/src/proposals`: vocabulary (`types.ts`), schema,
  persistence (`db.ts`), the six stages (`stages.ts`), the deterministic
  halves (`requirements.ts`, `review.ts`, `library.ts`, `evidence.ts`), the
  markdown export (`render.ts`), the run orchestrator (`run.ts`), prompts and
  model policy (`prompts.ts`, `ports.ts`).
- **Tool** — `packages/tools/src/grant-search`: Grants.gov `search2` +
  `fetchOpportunity`, web listings via web-research, one merged result with a
  per-source report. Named for what it searches; the app is named for what
  it writes.

## How it connects to the rest

- **Sources** — the profile and every draft retrieve from the workspace's
  indexed sources; a citation opens the source in the Studio; a request can
  be read straight from a Source; a finished proposal is exported into
  Sources under "Proposals" and becomes citable.
- **Chat** — "Ask in chat" on any section opens the Studio with a question
  about that section in the composer (`/employer/documents?ask=…`, a new
  parameter the workspace shell honours like `?feature=`).
- **Investor relations** — Funders links across for equity; both draft from
  the same sources.
- **History** — every run lists in the History rail with a link to its
  proposal, through its own loader.
- **Studio** — a Proposals tile under Tools, `external`, opens the app.
- **Credits** — one `proposal_writing` service in the ledger.

## Data

Six product tables (migration `20260930000238_proposals`), all `pdr_ai_v2_`,
all company-scoped with cascade delete:

| Table | One row is | Notes |
| --- | --- | --- |
| `proposal_profiles` | the workspace's organisation profile | one per company; `profile` jsonb holds summary, facts (with `cites`), numbered evidence, provenance |
| `proposal_opportunities` | one funder's call | unique on (company, source, external id); a person's `status` (saved/dismissed/applied) survives a re-search |
| `proposal_applications` | one proposal | request text/url/source id, `extracted` request, `requirements` checklist, `review`, `readiness`, exported source id |
| `proposal_sections` | one question to answer | ordered by `position`; `draft` + `draft_meta` (cites, gaps, evidence, library ids, model, prompt version) |
| `proposal_library_items` | an answer worth reusing | question, answer, tags, cited evidence, where it came from, how often reused |
| `proposal_runs` | one background job | kind, input, `steps` jsonb the sheet renders, summary headline, credits |

## Runs

Every model-backed action is a run: `profile`, `funders`, `extract`, `draft`
(one or many sections), `rewrite` (one section under an instruction),
`review`. The route creates the row and returns it with 202; the UI polls
`/api/proposals/runs/[id]` at 1.5 s while it is live and reloads its screen
when it settles. The executor is `executeProposalRun` in the vertical,
idempotent on a finished row.

- **inline (default)** — the web process runs it in `after()`, the way
  keyless Prospects runs do.
- **worker** — `PROPOSALS_EXECUTOR=worker` sends `proposals/run.requested`;
  the worker's `proposalsRunJob` executes the same function under Inngest
  retries and marks the run failed on final failure.

Credits: a pre-check when metering is enforced, a debit per completed run
(`proposal_writing`, 1k–3k per stage) through the host's ledger port.

## Stages, briefly

- **Profile** — nine retrieval queries over the workspace's sources;
  excerpts numbered; one structured call returns facts that must cite. A fact
  with no valid citation is dropped, never kept as a guess.
- **Funders** — a structured plan (keywords, applicant type, geography) from
  the profile unless keywords are given; `findGrants`; one scoring call per
  batch of 20 returning score/why/concerns per external id.
- **Extract** — the request becomes title, funder, deadline, amounts,
  eligibility rules, sections with word limits, attachments, format;
  `sanitizeExtracted` and `requirementsFromExtracted` make it a checklist
  with content-derived ids so re-reading keeps ticks and drafts.
- **Draft** — retrieval on the question, the profile block, numbered
  evidence, up to three library answers matched by keyword overlap; the
  model returns draft/cites/gaps; only real citation numbers survive.
- **Rewrite** — no retrieval: the current draft, the evidence it already
  cites, the profile, and an instruction (a preset or the person's words);
  the result may cite only that evidence, and anything the instruction
  needed that the evidence lacks is added to the gaps. The section drops
  back to *drafted* so approval is a fresh decision.
- **Review** — deterministic findings merged with the model's, blockers
  first; readiness = 70% required sections + 30% checklist.

## Tests

- `packages/tools` — Grants.gov parsing, query building, web listing filter,
  merged search with an injected fetch.
- `pipelines` — requirements, review/readiness, library matching, the six
  stages with fake ports, the markdown export.
- `apps/web` — the adapter's words and to-do order, the preview simulator's
  contract (runs that finish and change the world, rewrite, section status
  rules, checklist ticking, apply-from-funder), back targets.
