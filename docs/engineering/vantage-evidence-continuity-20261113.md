# Recorded evidence continuity prototype

## Inspected persistence

`pipelines/src/vantage/schema.ts` defines mutable commitment rows with `createdByUserId`, `shared`, `contentVersion`, `createdAt`, `updatedAt`, `status`, `outcome` and `resolvedAt`. It retains the creator. The row has no latest status-author field. `updateCommitment` in `db.ts` uses an expected-version compare-and-swap and increments the version. Resolving requires an outcome. Reopening sets `resolvedAt` to null. A later resolution replaces that timestamp. These fields support a versioned observation of current recorded status. Reconstruction of previous transitions requires additional retained records.

`apps/web/src/server/vantage/weekly-review-repository.ts` validates stored decisions with `actorId`, `recordedAt`, `version`, topic and decision text. Decision inserts are serialized through the report repository, bound to company/run/actor and idempotency key. Report reads check repository authority and frozen dependencies. The report selector is owner-scoped. A continuity adapter must preserve that owner-only policy for these reports even though this prototype also supports shared commitment evidence. Decision outcome text remains a human-recorded statement.

## Bounded offline implementation

`pipelines/src/vantage/recorded-continuity.ts` accepts injected current-actor, authorized-row, report-authorization and exact-source-authorization functions. Its two operations capture a record and read a capture by trusted process-local identity plus expected content hash. The repository adapter derives company, owner, sharing, author, version and lineage from server-side data. Callers must never construct these fields from request claims.

Capture detaches and recursively freezes the row, records `observedAt`, retains its content version, creator, available author, recorded timestamp and source lineage, and computes SHA-256 over the serialized retained row. The retained JSON serialization defines this prototype's hash encoding. Adapter projections must use stable property and source ordering. Commitment adapters set `authorUserId` to null when the latest updater is unknown and use `updatedAt ?? createdAt` as the current row's recorded timestamp. Weekly-decision adapters use the stored decision author and timestamp. They select a stable identity including the report and decision revision. Both map source identities through existing authorized repositories.

Every read refreshes the actor and reads the current row. It checks current company, private ownership or sharing, report ACL and current source ACL. It also rechecks the captured report and exact captured source dependencies. Stable record, creator, owner and report identities must match. A content-version change can coexist with an earlier retained observation. The returned evidence is the original captured version and hash. A cutoff before capture returns `unknown_historical_state` after authorization, including when the current `resolvedAt` falls before that cutoff.

The evidence kinds are `human_recorded_decision` and `action_reported_status`. `executionVerification` remains `unknown`. An independently verified execution would require a separately admitted, independently authored execution record with its own provenance, source ACL and version. Existing commitment completion and decision outcome text provide reported evidence only.

Timestamps accept calendar-valid ISO dates with required seconds, up to three fractional digits and an explicit `Z` or numeric offset. Calendar components are validated before parsing, including leap-year month lengths. Invalid or non-finite injected clocks are rejected with `continuity_invalid_clock`.

Retention defaults to 100 observations, 64 KiB of UTF-8 serialized record bytes per capture and 1 MiB of aggregate UTF-8 serialized observation-envelope bytes per instance. The factory accepts positive safe-integer overrides through `ContinuityLimits`. New captures fail with `continuity_quota_exhausted` at a limit. Existing observations remain readable. Admission and insertion occur synchronously after asynchronous authorization, so concurrent captures share the same count and byte budget. Byte quotas describe retained serialization, while the JavaScript object overhead, caller-owned rows and temporary serialization/clone allocations consume additional memory.

The map is process-local and loses observations on restart. It demonstrates the semantics for injected repositories with synthetic tests. A durable implementation must store captures through the existing encrypted report/dependency persistence, bind the serialized capture hash to trusted storage, and read it under repository authority. A caller-supplied recomputed hash alone provides no storage authenticity. The prototype keeps the trusted copy internally. No route imports or normal entry points were added.

The injected readers and callbacks are the security boundary for membership, source identity, and underlying report dependencies. Production adoption requires a consistent authorized transaction or equivalent epoch validation across row and ACL checks, matching the existing weekly-review authority protocol. These tests exercise callback behavior with local fixtures. They establish neither database integration nor live-provider quality.

## Proposed transition-history migration

The following SQL is a review proposal. Deployment would require the normal migration review and a writer integration change. Application writers would use the existing transaction, lock and compare-and-swap paths to update the mutable row and append the matching event atomically. One accepted content version produces one event. Exact operation retry must compare the payload hash and return its existing event. Conflicting retry returns a conflict. Appended events carry current recorded state. `transition` events additionally require an actor and prior-version linkage.

The initial backfill can append a `baseline_observation` for each currently authorized row at migration time. Its actor is null when unavailable. `observed_at` is the actual capture time and `recorded_at` preserves the row timestamp. Earlier states remain unknown. Retention must preserve report/source lineage and enforce current authorization at read time. Events hold sensitive content and need the same encryption and access controls as the report store.

```sql
-- Proposal only. No SQL in this document was executed.
CREATE TABLE pdr_ai_v2_vantage_commitment_events (
    id uuid PRIMARY KEY,
    company_id bigint NOT NULL REFERENCES pdr_ai_v2_company(id),
    commitment_id varchar(64) NOT NULL,
    content_version integer NOT NULL CHECK (content_version > 0),
    previous_content_version integer,
    event_kind text NOT NULL CHECK
        (event_kind IN ('baseline_observation', 'created', 'transition')),
    actor_id text,
    record_creator_user_id text NOT NULL,
    recorded_at timestamptz NOT NULL,
    observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    operation_key text NOT NULL,
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    ciphertext text NOT NULL,
    -- Hash covers the versioned canonical plaintext, including encrypted lineage.
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    UNIQUE (company_id, commitment_id, content_version),
    UNIQUE (company_id, operation_key),
    FOREIGN KEY (company_id, commitment_id, previous_content_version)
        REFERENCES pdr_ai_v2_vantage_commitment_events
            (company_id, commitment_id, content_version),
    CHECK (recorded_at <= observed_at),
    CHECK (
        (event_kind = 'baseline_observation' AND previous_content_version IS NULL)
        OR
        (event_kind = 'created' AND content_version = 1
            AND previous_content_version IS NULL AND actor_id IS NOT NULL)
        OR
        (event_kind = 'transition' AND actor_id IS NOT NULL
            AND previous_content_version IS NOT NULL
            AND previous_content_version = content_version - 1)
    )
);

CREATE FUNCTION pdr_ai_v2_reject_commitment_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'commitment events are append-only';
END;
$$;
CREATE TRIGGER pdr_ai_v2_commitment_events_immutable
BEFORE UPDATE OR DELETE ON pdr_ai_v2_vantage_commitment_events
FOR EACH ROW EXECUTE FUNCTION pdr_ai_v2_reject_commitment_event_mutation();
```

Before adopting this proposal, verify the company table identifier against the deployed schema and apply grants for the deployment's actual application role. The writer's transactional company/commitment lookup must establish tenant linkage. Retained events intentionally survive commitment-row lifecycle operations, so the proposal uses a logical commitment identifier. The writer validates prior-event linkage under lock and rejects missing predecessor events after the baseline. New commitments append a created event at version 1 with an actor and no predecessor in their creation transaction. Existing weekly-review decision receipts can supply decision continuity through the authorized report reader and retain their current idempotency rules.

## Executed verification

- Focused Vitest run passed 22 tests on 2026-11-13. Coverage includes frozen current reads, reopen after capture, pre-capture unknown history, human decision provenance, source and report revocation, company isolation, private ownership, shared reads, forged hashes and replaced report identity, strict timestamp calendar/offset validation, invalid clocks, concurrent count exhaustion, UTF-8 record-size rejection/recovery and exact aggregate-envelope byte boundaries.
- The timestamp and quota regressions were reproduced before the fix with 10 failing cases and 12 passing cases. The corrected run passed all 22.
- Standalone strict TypeScript checking of the two owned TypeScript files passed. Prettier checks of all three owned files passed. Tracked diff whitespace checking passed. These are bounded file checks.
- The fixtures are synthetic and use injected authorization callbacks. Durable persistence, real repository adapters, migration execution, concurrency transactions and provider calls remain outside this prototype's verified coverage.
