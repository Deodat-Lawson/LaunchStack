# Founder Weekly Review (LAU-9) Handoff

## Current state

- Branch: `lau-9-founder-review-generation-flow`
- Do not commit or push without explicit approval.
- Preserve all existing uncommitted work and the four untracked local Ollama probe files.
- Do not use shared Neon for this work. Use the local PostgreSQL URL only through the isolated-schema helper.
- Do not change embeddings, retrieval, frontend/LAU-10, PDF ingestion, Peace's evaluator, or provider defaults unless a later task explicitly authorizes it.

## What has been completed locally

### Async Inngest-owned workflow

The prior synchronous POST collection flow has been refactored locally toward:

```text
POST -> queued run without snapshot + transactional outbox
Inngest workflow -> collecting -> attach immutable snapshot -> queued
                 -> generating -> draft | failed
```

Key implementation files:

- `apps/web/src/app/api/founder-weekly-reviews/route.ts`
  - POST authorizes and validates, then persists durable collection input instead of collecting evidence synchronously.
- `packages/features/src/founder-weekly-review/contracts.ts`
  - Adds `collecting` status and bounded `FounderWeeklyReviewCollectionInputSchema`:
    - `workspaceTimezone`
    - optional bounded `founderContext`
    - `actorExternalUserId`
- `packages/core/src/db/schema/founder-weekly-review.ts`
  - Allows a null `evidenceSnapshot` before collection; adds collection claim/timestamps/input fields.
- `apps/web/drizzle/0018_founder_weekly_review_async_collection.sql`
  - Forward migration for nullable snapshot and durable collection fields.
  - Backfills existing rows with bounded collection input. It must not be applied to shared Neon without separate approval.
- `packages/features/src/founder-weekly-review/repository.ts`
  - Adds conditional collection claim, insert-once snapshot attachment, and collection failure methods.
- `packages/features/src/founder-weekly-review/worker-service.ts`
  - Adds collection claim/attach/failure service methods.
- `apps/web/src/server/inngest/functions/founderWeeklyReview.ts`
  - Uses the canonical evidence collector when no snapshot exists, then runs existing generation/validation.
- `apps/web/src/server/founder-weekly-review/dispatch-service.ts`
  - Initial and retry outbox contracts accept optional snapshot plus collection input; event remains identifier-only.

Important invariants implemented:

- A generation claim requires an existing immutable snapshot.
- A collection claim only succeeds for `queued` runs whose snapshot is absent.
- Snapshot attachment requires the current collection claim and only writes when the snapshot remains absent.
- Failed retry remains the same run row and can recollect only if it still has no snapshot; otherwise it reuses the snapshot.
- Events do not contain evidence, founder context, prompts, credentials, or report text.

### Local synthetic safety baselines

Existing runner:

- `apps/web/scripts/run-founder-weekly-review-synthetic-baseline.ts`

It supports local-only synthetic fixtures, deterministic negative citation/source-semantic cases, retry snapshot immutability checks, bounded Kimi/Ollama diagnostics, optional export, and `FWR_PRINT_REPORT=1` terminal printing of a persisted/re-read report.

Known validated local outcomes from earlier work:

- Kimi partial and full synthetic cases reached persisted `draft`.
- Unknown citation IDs become sanitized `generation_failed` with no draft.
- Founder context cannot support customer testimony.
- Retry reused one row; retry count behaved `0 -> 1 -> 1`; snapshot digest was unchanged.

### Realistic isolated-database E2E baseline

New local-only assets:

- `apps/web/test-fixtures/founder-weekly-review/realistic-company/seed.json`
- `apps/web/scripts/run-founder-weekly-review-realistic-e2e.ts`
- `apps/web/__tests__/founderWeeklyReview/async-collection.test.ts`

The fixture is fictional and seeds real collector source tables:

- product release document/version;
- internal planning document/version;
- exact-category `Customer Feedback` document/version with processed context chunks;
- request-time founder context through durable collection input;
- an out-of-period control and another-company control.

The driver uses the isolated schema helper, creates a queued run via the dispatch service, claims collection, invokes `FounderWeeklyReviewEvidenceService`, attaches the actual collector output, claims generation, invokes Kimi through the local runner adapter, validates via `generateFounderWeeklyReview`, persists/re-reads the draft, optionally prints and exports it, and then drops the isolated schema.

Last successful realistic run:

- Run ID: `fwr_0029d66b-99cd-4ebf-9f7a-3da904381be6`
- Lifecycle: `queued -> collecting -> queued -> generating -> draft`
- Provider/model: `kimi` / `kimi-k2.6`
- Evidence counts: `document_change=3`, `customer_feedback=3`, `founder_context=1`
- Warning codes: none
- Snapshot digest unchanged after attachment and repository read-back.
- Canonical schema, citation validation, and source-semantic validation passed.
- One run row and one initial outbox row were present.

Export artifacts from that run are local and Git-ignored:

- `apps/web/.artifacts/founder-weekly-review/fwr_0029d66b-99cd-4ebf-9f7a-3da904381be6.md`
- `apps/web/.artifacts/founder-weekly-review/fwr_0029d66b-99cd-4ebf-9f7a-3da904381be6.json`

The Markdown did not contain the run ID or `evidenceSnapshot`. The JSON envelope did not contain the snapshot, prompts, credentials, raw provider output, or database URL.

## Current quality-improvement task (interrupted before edits)

The active next task is **Phase 1 report-quality improvement** within the existing Founder Weekly Review v2 payload schema. Do not add a V3 schema or change persisted payload shape.

Requested improvements:

1. Improve the generation prompt in `packages/features/src/founder-weekly-review/prompts.ts` so output synthesizes related evidence, explains why it matters, states limitations/evidence gaps, separates shipped work from preparation, treats customer feedback as customer-only evidence, and creates distinct grounded priorities.
2. Inspect and increase the founder-review output token budget only if an actual budget exists at the provider boundary. At the last inspection, `apps/web/src/lib/llm/generate.ts` delegates to AI SDK `generateObject` without an explicit founder-review max-output setting; the Kimi local adapters also do not currently send a max-token parameter. Do not invent a production-wide provider refactor.
3. Improve Markdown rendering in both runners (or extract a safe shared renderer) so it:
   - has no empty `Key Outcomes` heading;
   - omits or uses useful text for no-evidence sections;
   - keeps citations next to claims;
   - uses distinct evidence-reference labels for chunks from the same feedback document;
   - uses title plus bounded existing metadata (page/section) rather than category-only labels;
   - clearly labels founder context as founder-provided;
   - does not show internal IDs, snapshots, prompts, provider responses, credentials, or database URLs.
4. Update only the fictional feedback **title** in the realistic fixture to something descriptive such as `Customer Interviews - February 2026`; retain its exact category `Customer Feedback` and retain the actual fixture facts.
5. Add deterministic renderer tests; do not call a provider in those tests.
6. Rerun the local realistic Kimi E2E with `FWR_PRINT_REPORT=1` and export enabled.

Current prompt location and behavior:

- `packages/features/src/founder-weekly-review/prompts.ts`
  - system prompt currently emphasizes non-invention, citations, customer-source semantics, and no-evidence behavior but does not sufficiently ask for multi-evidence synthesis or natural founder-facing prose.
- `packages/features/src/founder-weekly-review/generator.ts`
  - parses the current V2 schema, validates citations and semantics, and builds metadata. Do not weaken this path.
- `packages/features/src/founder-weekly-review/generation-validation.ts`
  - contains the citation and source-semantic enforcement; preserve it unchanged.

Current Markdown renderers are duplicated:

- `markdownFor()` in `apps/web/scripts/run-founder-weekly-review-synthetic-baseline.ts`
- `markdown()` in `apps/web/scripts/run-founder-weekly-review-realistic-e2e.ts`

Both currently use simple title-only references and render a `## Key Outcomes` container even when only child headings carry content. A shared local renderer helper is preferable if extraction stays narrow and preserves the persisted-draft-only boundary.

## Local database and test setup

Use only:

```powershell
$env:DATABASE_URL='postgresql://postgres:password@127.0.0.1:5433/pdr_ai_v2'
$env:LAUNCHSTACK_TEST_DATABASE_URL=$env:DATABASE_URL
```

The isolated helper is:

- `apps/web/__tests__/founderWeeklyReview/testDb.ts`

It creates a temporary schema, applies migration files, sets a schema-first search path, and drops the schema during cleanup. It was expanded to include local `document_versions` and `document_context_chunks` columns required by current Drizzle inserts; this prevents accidental fallback reads/writes to `public` during realistic seeding.

Focused verification most recently passed:

```powershell
pnpm.cmd --filter @launchstack/core typecheck
pnpm.cmd --filter @launchstack/features typecheck
pnpm.cmd --filter @launchstack/web typecheck

Set-Location apps/web
pnpm.cmd exec jest --runInBand --detectOpenHandles founderWeeklyReview
```

Result: 13 suites passed, 74 tests passed, 0 skipped, no open-handle warning.

`git diff --check` also passed.

## Run commands

### Deterministic async collection test

```powershell
Set-Location apps/web
pnpm.cmd exec jest --runInBand --detectOpenHandles founderWeeklyReview/async-collection.test.ts
```

### Realistic isolated Kimi E2E

`MOONSHOT_API_KEY` is loaded by the project `.env` mechanism. Never print it or `.env` content.

```powershell
Set-Location apps/web
$env:SYNTHETIC_FWR_LOCAL='1'
$env:FWR_GENERATION_PROVIDER='kimi'
$env:KIMI_MODEL_ID='kimi-k2.6'
$env:MOONSHOT_BASE_URL='https://api.moonshot.ai/v1'
$env:FWR_PRINT_REPORT='1'
$env:SYNTHETIC_FWR_EXPORT_REPORT='1'
$env:SYNTHETIC_FWR_EXPORT_DIR='.artifacts/founder-weekly-review'
$env:DATABASE_URL='postgresql://postgres:password@127.0.0.1:5433/pdr_ai_v2'
$env:LAUNCHSTACK_TEST_DATABASE_URL=$env:DATABASE_URL
pnpm.cmd exec tsx ./scripts/run-founder-weekly-review-realistic-e2e.ts
```

The command performs one external Kimi generation request, but all database writes are inside a temporary local schema that the driver removes.

### Founder Weekly Review generation provider

Founder Weekly Review now selects its generation provider explicitly:

```powershell
# Normal/default production behavior (also used when unset)
$env:FWR_GENERATION_PROVIDER='openai'
# Requires OPENAI_API_KEY; OPENAI_MODEL_ID is optional.

# Local Moonshot/Kimi alternative
$env:FWR_GENERATION_PROVIDER='kimi'
$env:KIMI_MODEL_ID='kimi-k2.6' # optional; this is the default
# Requires MOONSHOT_API_KEY; MOONSHOT_BASE_URL is optional.
```

`FWR_GENERATION_PROVIDER` accepts only `openai` or `kimi`; an unset value is
`openai`. The Kimi path uses Moonshot Chat Completions with JSON-object output
and local canonical validation. It does not change the normal OpenAI protocol.
Kimi thinking is explicitly disabled for this path. Keep its current 1,800
output-token budget for the next baseline; revisit approximately 2,500–3,000
only if non-thinking real reports demonstrably approach the current limit.

## Working-tree precautions

Expected tracked modifications are the async workflow and test/E2E work listed by `git status -sb`. Expected untracked files include:

- `apps/web/__tests__/founderWeeklyReview/async-collection.test.ts`
- `apps/web/drizzle/0018_founder_weekly_review_async_collection.sql`
- `apps/web/scripts/run-founder-weekly-review-realistic-e2e.ts`
- `apps/web/test-fixtures/`
- four `ollama-*.json` local probe artifacts at repository root.

The Ollama probe artifacts and `.artifacts/` exports must not be committed. No commit or push has been made for the current work.

## Known limitations / next work

### Latest local transport baseline

The real isolated local transport reached a persisted draft for
`fwr_79958e72-d05c-4bc7-ad21-f6e76d490e2e` using `kimi` / `kimi-k2.6`:

```text
queued without snapshot -> collecting -> queued with immutable snapshot
-> generating -> draft
```

Canonical schema, citation, and source-semantic validation passed, with
`retryCount=0`. Founder-context-as-customer-feedback remains forbidden. A
repairable post-generation validation failure now receives exactly one explicit
same-snapshot semantic-repair call; a second failure is non-retriable for
Inngest and fails normally. The local harness now has a bounded terminal
callback drain before scoped process-tree cleanup; rerun the local-only smoke
or transport baseline to confirm it with an explicitly local database URL.

Next work is workflow comprehension and Peace evaluator integration. A broader
provider registry for Llama, Hugging Face, and Ollama remains a post-PR follow-up.

- The realistic driver invokes production-equivalent collection/worker service boundaries directly, not a live Inngest dev-server callback.
- The flat V2 schema has only sections, items, text, source IDs, confidence, and typed no-evidence states. It cannot add an executive summary, overall status, owners, metrics, or decision records without a future schema version.
- The existing collector emits the feedback document version as `document_change` in addition to its processed feedback chunks. Customer-facing claims are still constrained to `customer_feedback` evidence.
- Peace evaluator integration, real PDF ingestion, shared-dev deployment, and frontend work remain out of scope.
