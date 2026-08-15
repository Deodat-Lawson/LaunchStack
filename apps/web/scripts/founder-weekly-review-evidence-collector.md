# Founder Weekly Review - Evidence Collector Handoff

Read-only tooling that produces a canonical FounderWeeklyReviewEvidenceSnapshot
for a company + reporting week. The collector command only reads and normalizes:
it never calls an LLM, writes to the database, or touches embeddings. The
optional seed script writes local fixture data only so the example snapshot can
be regenerated.

## Entry point

```ts
import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";

const service = new FounderWeeklyReviewEvidenceService(db); // db: DbClient
const snapshot = await service.collectFounderWeeklyReviewEvidence({
  companyId,            // bigint
  reportingPeriod,      // { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }  (end is inclusive)
  workspaceTimezone,    // IANA zone, e.g. "America/New_York"
  founderContext,       // optional string (request-time founder input)
  actor,                // optional { externalUserId }; required if founderContext is set
  contextEntryId,       // optional stable id for founder context
  requestKey,           // optional fallback stable id for founder context
  capturedAt,           // optional Date override, mainly for deterministic tests
  maxItems,             // optional snapshot item cap, bounded by the service maximum
});
```

Returned type: `FounderWeeklyReviewEvidenceSnapshot` - the canonical snapshot the LAU-9
generation pipeline consumes directly. **No adapter is needed** between this output and
the downstream generation step.

## Local developer command

Runs the collector without starting generation and prints the snapshot as JSON.

```bash
pnpm --filter @launchstack/web fwr:collect-evidence \
  --company 2 \
  --start 2026-07-20 --end 2026-07-26 \
  --tz America/New_York \
  --founder-context "This week we shipped X; blocked on Y." \
  --actor demo-founder \
  --out scripts/examples/founder-weekly-review-evidence.example.json
```

- `--company --start --end --tz` are required. `--founder-context` (with `--actor`),
  and `--out` are optional. Using `--out` also writes the JSON to a file; without it the
  snapshot only prints to stdout.
- Source: `apps/web/scripts/collect-founder-weekly-review-evidence.ts` (actual entrypoint)
  + `.lib.ts` (arg-parsing / URL-guard helpers).

### Required environment

The command resolves one URL: `LAUNCHSTACK_TEST_DATABASE_URL ?? DATABASE_URL`,
refuses to run unless the URL is `localhost`/`127.0.0.1`, and
refuses when `NODE_ENV=production`. Point it at a local DB only:

```bash
LAUNCHSTACK_TEST_DATABASE_URL="postgresql://postgres:password@localhost:5433/pdr_ai_v2" \
  pnpm --filter @launchstack/web fwr:collect-evidence <...>
```

## Example snapshot + how to regenerate

A committed example lives at
`apps/web/scripts/examples/founder-weekly-review-evidence.example.json`.
To regenerate an example snapshot against a local DB:

```bash
# 1. seed the local fixture data; this prints the companyId to use below
LAUNCHSTACK_TEST_DATABASE_URL="postgresql://postgres:password@localhost:5433/pdr_ai_v2" \
  pnpm --filter @launchstack/web tsx scripts/seed-founder-weekly-review-evidence-example.ts

# 2. run the read-only collector command with --company <that id>
LAUNCHSTACK_TEST_DATABASE_URL="postgresql://postgres:password@localhost:5433/pdr_ai_v2" \
  pnpm --filter @launchstack/web fwr:collect-evidence \
    --company <that id> \
    --start 2026-07-20 --end 2026-07-26 \
    --tz America/New_York \
    --founder-context "This week focused on pricing clarity and onboarding. Main blocker: choosing an SSO vendor before we can ship SAML." \
    --actor demo-founder \
    --out scripts/examples/founder-weekly-review-evidence.example.json
```

The example intentionally shows all three source types, deterministic ordering, and
reporting-window filter (an out-of-window version is seeded and correctly excluded).

## Tests

```bash
# unit (no DB): arg parsing + local-URL guard
pnpm --filter @launchstack/web exec jest founderWeeklyReview/collect-evidence.unit.test.ts

# integration (needs a local db url)
LAUNCHSTACK_TEST_DATABASE_URL="postgresql://postgres:password@localhost:5433/pdr_ai_v2" \
  pnpm --filter @launchstack/web exec jest founderWeeklyReview/collect-evidence.integration.test.ts
```

Integration coverage: company isolation / no cross-company leakage, in-window vs
out-of-window boundaries, chunk-based customer feedback, empty snapshot, and
`founder_context` never classified as `customer_feedback`.

## Sources

| Source | sourceType | Status | Origin |
| --- | --- | --- | --- |
| Document changes | `document_change` | **Supported** | `document_versions` joined to `document`, scoped by company and reporting window |
| Customer feedback | `customer_feedback` | **Supported** | processed `document_context_chunks` from documents whose category is exactly `Customer Feedback` |
| Founder context | `founder_context` | **Supported** | request-time input from `--founder-context` or API collection input; no DB source |
| GitHub activity | `github_activity` | **Not emitted by this collector** | separate LAU-8 adapter work |
| `workspace_document` / `manual_note` / `other` | - | **Reserved / not used** | accepted by the contract enum but not emitted by the current collector |

## Stable source IDs

- `document_change:doc:<documentId>:version:<documentVersionId>`
- `customer_feedback:doc:<documentId>:version:<documentVersionId>:section:<chunkId>`
- `founder_context:entry:<entryId>` - where `entryId` is the caller-supplied
  `contextEntryId` (falling back to `requestKey`). The developer command builds that
  value as `cli:<companyId>:<start>:<end>`, so a snapshot produced by the command looks
  like `founder_context:entry:cli:2:2026-07-20:2026-07-26`.

IDs derive from stable DB primary keys (document/version/chunk) or the supplied stable
request identity, so re-running against unchanged data yields identical IDs.

## Reporting period & timezone

Calendar dates are interpreted in the **workspace timezone** and converted to a
half-open UTC interval `[start 00:00 local, (end + 1 day) 00:00 local)`, so `end` is
the **last included day**. Conversion is DST-aware (dayjs + IANA data). Invalid zones
throw. `start == end` is a valid single-day period.

## Dedup & ordering

- **Dedup:** by `sourceId`. Two items with the same `sourceId` but different content
  throw `FounderWeeklyReviewEvidenceConflictError` (fail-loud on an ID collision).
- **Ordering:** by `sourceTimestamp` ascending (items without a timestamp, currently
  founder context, sort first), then `sourceType`, then `sourceId`, using ordinal
  (locale-independent) comparison. Deterministic across machines.

## Safety / limits

- Per-source cap `250`, snapshot cap `500`, excerpt cap `4000` chars; overflow emits a
  warning (`document_change_truncated`, `customer_feedback_truncated`,
  `evidence_snapshot_truncated`) rather than dropping data silently.
- Non-critical gaps emit safe warnings, not raw errors:
  `customer_feedback_unavailable` (no feedback docs in the window),
  `customer_feedback_missing_sections` (feedback doc had no citeable chunks).
- The immutable snapshot carries no credentials/tokens/signed URLs; `canonicalUrl` is
  omitted (source `document.url` is inconsistent); `workspaceDeepLink` is a host-less
  relative path.
- No LLM calls, no embedding/reindex writes; the collector command is read-only.

## Known limitations / open questions

1. **Customer-feedback documents also appear as `document_change`.** The
   `document_change` query has no category filter, so a `"Customer Feedback"` document's
   version is emitted **both** as `document_change` **and** as `customer_feedback` chunks.
   Visible in the example snapshot. Should feedback-category documents be
   excluded from `document_change`?
2. **Formatting-only / near-duplicate versions** are not de-noised; every in-window
   version becomes a `document_change` item.
