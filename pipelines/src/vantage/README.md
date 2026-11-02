# Vantage — the weekly founder-meeting loop

Every week, Vantage turns what a founder already knows — customer
conversations, a few numbers, last week's promises — into an agenda whose
every claim points at its source, then checks next week whether the agreed
action happened. It gives a program administrator a view of where help is
wanted, without exposing what the founder chose to keep private.

```
evidence + metric observations ──► signals (pure) ──► evidence pack
        ──► draft: model (cited) or rules ──► agenda topics
        ──► decision + commitment ──► next week's signals
```

## Final-output validation

Sophia's evaluation agent is exported separately from
`@launchstack/pipelines/vantage/validation`. It consumes Joseph's scenario documents
and expectations plus actual Vantage output, then assesses grounding, expected-item
coverage, temporal correctness, relevance, actionability and readability. It returns
traceable findings and JSON/Markdown reports without changing generation or saving actions.

Run `pnpm --filter @launchstack/pipelines demo:validation` for five labeled offline
examples, or `test:validation` for evaluator regression tests. Without an explicitly
configured judge, semantic scores stay unassessed. The demo is recorded fixture
replay, not live model validation. See the [validation agent handoff](../../../docs/design/vantage-validation-agent.md)
for Joseph's JSON format, saved-report adapters, live opt-in, scoring and calibration.

## Tables (product migration set)

| Table                                   | What one row is                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pdr_ai_v2_vantage_evidence`            | A note, interview, link, task, claim or document with the date it is _about_, a source and a visibility       |
| `pdr_ai_v2_vantage_metric_definitions`  | What a number means — signups vs activated vs paying vs active — keyed for CSV import                         |
| `pdr_ai_v2_vantage_metric_observations` | One number for one period from one source                                                                     |
| `pdr_ai_v2_vantage_agendas`             | One agenda per Monday, with the signals and model metadata it was prepared from                               |
| `pdr_ai_v2_vantage_agenda_topics`       | What happened (cited facts), why it matters, the decision, the next step, help requested, unknowns, conflicts |
| `pdr_ai_v2_vantage_commitments`         | An owner, a due date and the test that resolves the uncertainty; checked in the following week                |
| `pdr_ai_v2_vantage_program_deadlines`   | Program dates an administrator puts in front of the team                                                      |

Every read and write is scoped by `companyId`. A wrong-workspace id is "not
found", never a row.

## Modules

- `week.ts` — Monday-based week math and the rule for _which_ week an agenda
  is for (from Thursday, next week's).
- `csv.ts` — the metric spreadsheet import; bad rows are reported by line and
  the good rows still land.
- `signals.ts` — pure change detection: metric deltas against the previous
  non-overlapping period, conflicts when overlapping periods disagree,
  overdue and due commitments, evidence counts. Also the evidence pack the
  generator cites from, the citation validator, and the rules-based draft.
- `generator.ts` — the model call. Takes a `ResolvedChatModel` (the web app
  resolves it with its deployment's config); reads no environment.
- `prepare.ts` — orchestration. Model first when one is configured; the rules
  when there is none or the call fails; the agenda records which.
- `update.ts` — the weekly update as Markdown, built from shared topics only
  unless the founder asks for their private copy.
- `db.ts` — the repository. DTOs out, ISO dates, `VantageError` with a status.

## What "verified" means here

A fact on an agenda is verified when it has a reviewable source with a date
and, for a number, a definition — and the founder kept it. `validateFacts`
keeps only citations the pack can confirm; a sentence the model wrote with no
confirmable source is kept and marked `unsupported`, so the gap is visible
rather than silently deleted or silently trusted. Vantage never asserts that a
source is _true_.

Observed fact, founder interpretation and generator suggestion are separate
fields on a topic (`facts` / `whyItMatters` / `proposedNextStep`,
`rationale`), so the screen can label each and the founder can reject the
last two without losing the first.

## Sharing

`shared` on a topic and a commitment, `visibility` on evidence. The program
triage view and the weekly update read only shared rows. A private note may
inform a generated topic but is never quoted in its facts (the pack marks it
and the prompt forbids it).

## Scope note

A LaunchStack workspace is one company. The administrator triage view
therefore shows one team's shared requests, missed commitments, deadlines and
staleness. Rolling several teams into one cohort view means reading across
workspaces, which the platform does not do today; the tables are ready for it
(every row carries `company_id`).

## Proposed V0 dynamic retrieval and research

The `dynamic-retrieval/` module implements Sophia's Week 2 provider handoff on
top of the TL's `context-v0/` contracts. It is an opt-in library composition;
importing it does not register an HTTP route, change the Generate button, call a
model, or write reports. See the [shared V0 integration contract](../../../docs/design/vantage-context-v0-integration.md).

The existing V1 flow described above remains separate. In V0, permissions and
required Company Architecture/personal stars come from server-owned providers,
and all selected excerpts must resolve against the authoritative source catalog.

### Entry points

Import from `@launchstack/pipelines/vantage/context-v0`:

- `createDynamicRetrievalProviderV0({ metadata?, search?, maxCandidates?, signal? })`
  implements `retrieve(DynamicRetrievalInputV0)`. By default it evaluates the
  bounded authorized catalog in memory; `search` injects an actual ACL-aware
  RAG/database adapter. The provider never creates a new index.
- `founderChangeMetadataV0(input, rows)` reuses Founder Weekly Review's version
  window helper. Its rows must already be authorized and explicitly bound to
  canonical source refs; it does not query the database or infer those bindings.
- `createContextResearchPlannerV0({ questions, approvedPublicQueries? })` chooses
  STOP, internal research, or an approved public query. Sufficiency is currently
  deterministic term coverage over prepared context, not LLM reasoning or proof
  that a question has been answered. Configure explicit task-specific questions.
- `createContextResearchProviderV0(...)` executes injected bounded tools. Internal
  tools resolve exact authorized refs. Public tools receive only `{query, limit,
  signal}`; returned citations must already exist in the server-owned catalog and
  canonical citation list. Discovering/registering a new web source needs a
  separate authoritative integration; tool output cannot approve itself.
- `runDynamicContextV0(input, { server, roles, assembler }, options)` connects
  these providers to the existing manifest/snapshot pipeline and freshness check.
  It reserves source/excerpt/token capacity for required context and shares the
  remaining query/time budget with optional research. It returns prepared context,
  not a generated report or persisted database record.

```ts
import { runDynamicContextV0 } from "@launchstack/pipelines/vantage/context-v0";

// These are application-owned implementations of the existing V0 ports.
const prepared = await runDynamicContextV0(input, {
    server: authenticatedSourcePorts,
    roles: roleAndRequiredContextPorts,
    assembler: authoritativeManifestAssembler,
}, {
    retrieval: { metadata: sourceMetadata, search: authorizedSearchPort },
    research: {
        questions: gapQuestions,
        approvedPublicQueries: serverApprovedQueries,
        publicCitations: registeredPublicCitations,
        tools: boundedResearchTools,
    },
});
// TL integration passes prepared context through the existing guarded generation
// adapter; this call does not install or invoke that adapter.
```

### Selection and adapter requirements

Role relevance uses all verified roles' description/responsibility/priority terms,
explicit role tags, and actor ownership. Older relevant open work ranks first,
then relevance, trust, recency and canonical source key break ties. An unrelated
recent update can appear in `recentChanges` with no matched roles; recency never
manufactures role relevance. Each ref appears in only one V0 category, with other
lane membership retained in selection reasons and provider diagnostics.

Use version/event timestamps for the half-open report window `[start, end)` and
exclude versions after `asOf`. Supply `state: {asOf, value: "open" | "resolved"}`
for older unresolved items; without authoritative historical status the provider
does not infer that a record was open. `changedAt` defaults to the catalog's
`sourceDate`, so the source adapter must give that field the correct semantics.
Connector-copy deduplication requires matching origin identity/revision and
excerpt; independent conflicting measurements are retained.

The catalog is capped at 2,000 candidates by default (configurable up to 10,000).
Adapters must bound acquisition before returning a catalog or search results and
honor cancellation. UTF-8 byte length is used as a conservative token ceiling,
not provider-reported token usage. Partial, unavailable, revoked and timeout
outcomes remain explicit. Required sources are never silently pruned to fit.

### Reproduce the synthetic checks

Use the root-pinned pnpm 10.15.1 and Node 20+; from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @launchstack/pipelines test:retrieval
pnpm --filter @launchstack/pipelines typecheck
pnpm --filter @launchstack/pipelines demo:retrieval
pnpm --filter @launchstack/pipelines demo:retrieval --scenario public --json
```

After installing dependencies, a direct runner is also available from `pipelines/`:
`node --import tsx scripts/vantage-retrieval-demo.mjs --json`. The demo asserts six
scenarios: retrieval, STOP, internal, public, timeout and cross-company rejection.
It prints full manifests/snapshots with `--json`; database and public tools are
synthetic doubles, and no credentials or live services are needed. A STOP result
can produce a `partial` manifest under the inherited V0 assembler policy; that
does not mean the demo assertion failed.

### Remaining host integration

Joseph supplies verified roles and required context. TL supplies authenticated
source catalogs, live permission/version checks, the assembler, current-state
provider and guarded generation/persistence. Host adapters still need to connect
real RAG and version feeds, supply historical open/closed state, approve public
queries and validate/register public sources. Review ranking defaults and budgets
before activation, then run the signed-in database/API/browser acceptance suite.
No new environment variables, migrations, production connector setup or UI are
introduced by this provider handoff.

### Authorized RAG follow-up

`createAuthorizedRagSearchV0` now adapts the existing `RagPort` to document retrieval
using explicit native document/version bindings, current authorization callbacks,
and a document-only search scope. The recent lane uses the authorized version-event
metadata; it does not rely on semantic top-k to discover changes. Backend text is
never used to replace trusted catalog excerpts. Unverifiable hits or unsupported
source kinds mark coverage partial. Production source discovery, corpus bounds and
the TL's final ACL/version/commit checks remain host responsibilities.

`createDynamicRetrievalProviderV0({ selectionPolicy: "focused" })` optionally omits
unrelated recent updates and explicitly resolved older items. It preserves relevant
recent resolutions and reports exclusions in `diagnostics.excluded`. The default is
still `"broad"`; required company context and personal stars retain priority in
`runDynamicContextV0` regardless of this option.

See the [Sophia audit and integration handoff](../../../docs/design/vantage-sophia-retrieval-followup-2026-11-01.md)
for the wiring example, proposed weekly priorities, validation and backend limits.
