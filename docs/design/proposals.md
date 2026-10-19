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
sources ──► company profile (facts with citations; shared with Settings › Company)
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

- **Company profile** — Proposals does not build its own profile any more.
  Proposals › Profile renders the company profile (Settings › Company): one
  builder in `pipelines/src/company-metadata` reads only sources about the
  company, drops reference lists, tables and other noise, and keeps a fact
  only with a quote found verbatim in its source. The stages read it through
  `loadOrgProfile` → `profileView` → `orgProfileFromView`, filtered to the run
  writer's readable source documents while retaining the shared view's
  fact and derived-summary rules.
- **Sources** — every draft retrieves from the writer's readable indexed
  sources; a citation opens the source in the Studio; a request can be read
  straight from a Source; a finished proposal is exported into Sources under
  "Proposals" and becomes citable.
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

| Table                    | One row is              | Notes                                                                                                                |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `proposal_opportunities` | one funder's call       | unique on (company, source, external id); a person's `status` (saved/dismissed/applied) survives a re-search         |
| `proposal_applications`  | one proposal            | request text/url/source id, `extracted` request, `requirements` checklist, `review`, `readiness`, exported source id |
| `proposal_sections`      | one question to answer  | ordered by `position`; `draft` + `draft_meta` (cites, gaps, evidence, library ids, model, prompt version)            |
| `proposal_library_items` | an answer worth reusing | question, answer, tags, cited evidence, where it came from, how often reused                                         |
| `proposal_runs`          | one background job      | kind, input, `steps` jsonb the sheet renders, summary headline, credits                                              |

## Runs

Every model-backed action is a run: `funders`, `extract`, `draft`
(one or many sections), `rewrite` (one section under an instruction),
`review`. The route creates the row and returns it with 202; the UI polls
`/api/proposals/runs/[id]` at 1.5 s while it is live and reloads its screen
when it settles. Both execution modes use `executeProposalRun` in the vertical.

- **inline (default)** — the web process runs it in `after()`, the way
  keyless Prospects runs do.
- **worker** — `PROPOSALS_EXECUTOR=worker` sends `proposals/run.requested`;
  the worker's `proposalsRunJob` executes the same function under Inngest
  retries and marks the run failed on final failure.

A tenant-scoped conditional `UPDATE … RETURNING` claims `queued → running`.
Only the winning delivery executes stages or becomes eligible to debit;
concurrent deliveries and retries return the persisted running or terminal
state. A running row is never reclaimed for another execution.

The running deadline is **15 minutes from `startedAt`**, not from the last
step or `updatedAt`. Expiry is lazy: detail, list, and live-run reads
(including the home screen), progress writes, and execution delivery mark
overdue running rows failed with an error and completion time. The same
atomic update marks running steps failed with the timeout detail and a
completion timestamp, skips waiting steps, and preserves completed metadata
and step order. There is no queued-run expiry policy. The failed row stays
terminal, and the person can start a fresh run with a new id. An executor
resuming after expiry cannot
revive that row or initiate its debit; post-model checks also stop it from
persisting a late result once it observes expiry.

Credits use a pre-check when metering is enforced and the host's
`proposal_writing` ledger port at the rates in `PROPOSAL_CREDITS`; drafts
charge per generated section. Finalization takes a row lock, rechecks running
status and the deadline after acquiring it, then supplies that transaction
as the required second argument to `ProposalPorts.debitCredits`.

The app adapter forwards this executor to `debitTokens`. Balance reads,
missing-account creation, any signup grant, account debits, ledger entries,
and daily usage all use the **same connection and transaction as run
completion**. They commit or roll back together, including when metering
throws. No second pool connection is needed while holding the run lock, so
finalization works even with a one-connection pool. Guarded failure writes
cannot replace an existing terminal result, and rolled-back metering is not
reported as credits used.

A custom host's genuinely external meter cannot participate in the
Postgres transaction. Its acknowledged charge can still survive a process
crash or database rollback before completion commits. The run is never
reexecuted or automatically charged again, but this is not a cross-system
exactly-once guarantee. Eligibility is checked immediately before
dispatching the debit; an already-dispatched external operation cannot be
recalled if its response crosses the deadline.

### Generation scope

Both executors resolve the stored run writer's current active workspace
membership and document scope inside their deferred body: `after()` for
inline execution, `step.run("execute", …)` for the worker. The event's
`userId` is not authority to substitute another writer. Missing or inactive
membership, or failed scope resolution, fails the run without falling back
to workspace-wide access. Workspace model selection remains scoped inside
the same callback or step.

Execution and draft retrieval require an explicit document scope. Retrieval
uses the real document-scope SQL; profile facts are filtered by readable
source provenance. A library answer is excluded from generation if any of
its stored evidence is unreadable, missing, or belongs to another workspace.
An application's stored request source must also remain readable before its
content or extracted requirements can be used.

Rewrite and review do not retrieve new sources. Before either sends existing
draft prose to the model, its saved evidence and referenced library answers
must still be readable. Otherwise the run fails and asks for a redraft from
readable sources; dropping citations alone would leave the private prose in
the prompt. These are generation checks, not a change to read-side access
policy for shared application and library screens.

## Stages, briefly

- **Profile** — not a Proposals stage: the company profile, built per
  source (see "Company profile" above). `proposal_profiles` and the `profile`
  run kind were retired in migration `20261003225135_company_profile_sources`,
  which copied hand-added facts into the company profile as manual edits.
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
  back to _drafted_ so approval is a fresh decision.
- **Review** — deterministic findings merged with the model's, blockers
  first; readiness = 70% required sections + 30% checklist.

Approval belongs to the exact saved answer: changing approved text, including
whitespace-only changes, returns it to _edited_; clearing it returns it to
_empty_. Saving identical text preserves approval, and an explicit Approve
request can save and approve new text together. After a section save, the
editor refreshes the application so readiness and section checklist rows
immediately reflect the current approval. A saved review remains available
but does not freeze the current readiness score.

## Tests

- `packages/tools` — Grants.gov parsing, query building, web listing filter,
  merged search with an injected fetch.
- `pipelines` — requirements, review/readiness, library matching, the six
  stages with fake ports, the markdown export.
- `apps/web` — the adapter's words and to-do order, the preview simulator's
  contract (runs that finish and change the world, rewrite, section status
  rules, checklist ticking, apply-from-funder), back targets.
  `run-scope.integration.test.ts` also runs the actual inline callback and
  worker handler against migrated Postgres and production retrieval, with
  stand-in model/embedding outputs: granted-writer controls, restricted
  sources/profile/library exclusions, nonretrieving rewrite/review provenance,
  event-actor substitution, and membership removal before execution.
