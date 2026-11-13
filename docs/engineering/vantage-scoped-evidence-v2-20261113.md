# Vantage scoped evidence V2 engineering checkpoint

## Baseline and authorization

The local branch `experiment/vantage-scoped-evidence-v2-20261113` starts at completed budget-aware retrieval V1 commit `4fbf006ca1ebb4ee5d4c5928c8349bd41b6ae4cb`, whose integration ancestor is `58f435d924d9010652800e18c6e93876ad96f4e8`. Core scoped evidence was committed at `c5a74e513282e84fc239899a01438bfc8976ba60`. The exact-version RAG mapper correction is separately committed at `13daad56f404480afa438072f37e8800a367ed65`.

On November 13, 2026, the user explicitly approved administrator-defined finite, version-bound Required Context spans. This implements that choice through the existing application service and authenticated context endpoint. An ID-only requirement continues to request the complete indexed document. Approval of a finite scope requires configuration authority, current document access and company-readable audience for company-required evidence. Personal Stars retain actor-level preference semantics.

Both `VANTAGE_INTERNAL_RETRIEVAL_V1_ENABLED=true` and `VANTAGE_SCOPED_EVIDENCE_V2_ENABLED=true` are required to create new scoped reviews. Both experiments default off. The existing main Weekly Review feature gate remains effective. No production environment or PR603 default was changed.

## Canonical application path

The existing `/employer/tools/vantage` Weekly Review screen uses `/api/vantage/reviews` and its context endpoint. `weekly-review-service.ts` composes the existing actor, authority collector, reservation, canonical V2.1 runner and encrypted repository. Scoped evidence enters this composition through `weekly-review-internal-selection.ts` and `weekly-review-scoped-selection.ts`.

The collector freezes one parent dependency for each approved scoped document and supplies one or more exact unit references to Generation. The canonical report remains `vantage-weekly-review/v2.1`. The report has a scoped evaluation contract, rubric and admission receipt. Configured real provider clients remain the normal execution path. All tests in this checkpoint inject deterministic Generation and Judge ports.

The new API configuration is available through the existing authenticated context endpoint. It has no separate experimental host or synthetic actor allowlist.

### Administrator configuration

`POST /api/vantage/reviews/context` accepts `requiredSourceScopes` alongside the existing architecture and required-document IDs. Each map key must be a configured document ID. A scope contains the exact version, SHA-256 of the complete canonical indexed parent, a human-readable qualification and the complete finite required-unit inventory.

```json
{
  "expectedVersion": 3,
  "architectureDocumentId": "101",
  "requiredDocumentIds": ["102"],
  "requiredSourceScopes": {
    "101": {
      "version": "201",
      "expectedParentHash": "<64 lowercase hex characters>",
      "qualification": "Administrator-approved operating responsibilities for this review",
      "requiredUnits": [
        {
          "id": "operating-responsibilities",
          "start": 0,
          "end": 120,
          "excerptHash": "<64 lowercase hex characters>"
        }
      ]
    }
  }
}
```

The example is a contract illustration. Version IDs, ranges and hashes must come from the actual authorized version. End offsets are exclusive UTF-16 code-unit offsets over canonical indexed text, joined by one newline between ordered chunks. Surrogate-pair splits, overlaps, duplicate inventories and mismatched hashes fail validation. Model output and document instructions cannot grant this scope.

`PATCH` accepts the analogous `starSourceScopes` for personal Stars. A personal scope cannot narrow an overlapping company requirement. Omitted map fields preserve surviving configured scopes. Removing a document ID prunes its scope. Explicitly changing scope configuration uses the existing expected-version mutation guard.

### Coverage and provenance

- `full_document_reviewed` requires coverage of the entire canonical indexed parent.
- `relevant_spans_reviewed` identifies administrator-approved finite coverage and retains the qualification in report readback and the UI.
- `insufficient_evidence` prevents treating incomplete required units as satisfied context.

Dependencies retain company, actor, parent document/version/hash, canonical parent length, unit hashes and chunk anchors, finite inventory, cutoff, source purpose, audience and authority metadata. Unit citations are derived `unit:<sha256>` references bound to this proof. The UI presents the coverage state and required/included unit counts. Existing indexed chunks do not establish that the original PDF or OCR extraction was complete. The server currently records that completeness as `unknown`.

## Acquisition and authorization invariants

The server loads the complete exact indexed parent under current authority before deriving a span. Parent acquisition is capped at 128,000 UTF-8 bytes and 1,024 chunks, with at most 16 units and 6,000 UTF-16 code units per unit. The SQL metadata query examines at most 1,025 ordered chunks and rejects an oversized parent before transferring its body. The body query independently enforces count and byte bounds to cover concurrent reindexing. A full-parent hash protects text outside the selected span.

The overall V1 acquisition envelope remains bounded to 64 optional candidates, 128,000 loaded text bytes, 3,000 ms and 768 counted SQL operations. Transaction-local statement and lock timeouts apply. These are chosen experiment limits. They are independent of the smaller model-facing input limits.

The exact parent version must exist by the historical cutoff. PostgreSQL performs that timestamp comparison before JavaScript millisecond normalization. Current ACL denial precedes historical-version-unavailable disclosure. Current source authority is revalidated at preparation, Generation dispatch, Judge dispatch, activation and readback. Existing company-scoped epoch locking serializes conflicting authority changes. An unrelated tenant can write independently.

Accepted historical reads use their frozen source version, scope and parent hash plus current ACL. Removing the current policy or switching the scoped experiment off preserves the compatible reader. Mutating the frozen parent, including outside its selected span, denies readback and new dispatch. A newer source head alone does not rewrite the frozen evidence.

## Budget, Generation and independent Judge

`scoped-v2` uses the shared deterministic budget calculation and a declared 2,800-byte useful report reserve. Generation's serialized data input limit is 12,000 UTF-8 bytes. The evaluation input and actual Judge human evidence payload are each checked against 14,000 bytes. These measurements cover serialized application data. HTTP framing, system instructions, response schema, provider tokenization and monetary spending require separate accounting.

Scoped descriptors, exact citation metadata and coverage proof contribute to budget calculations. Mandatory overflow fails before dispatch. Optional admission preserves the existing skip-and-continue behavior. Document bodies are never automatically truncated to satisfy a budget.

The evaluation contract is `vantage-evaluation/v2`, with scenario context completeness `scoped` and rubric `vantage-quality/2.0-scoped`. Every supplied required unit has a critical consideration expectation. The Judge receives the exact candidate and all projected user-facing output fields. The typed proof qualifies coverage, and the rubric forbids inferring whole-parent or original-file completeness. Existing complete/excerpted V1 evaluation behavior is preserved.

The accepted receipt is `vantage-admission/v3`. Activation recomputes budget feasibility, exact input/evaluation/report hashes, source registry and freeze hash, scope-to-frozen-dependency correspondence, ordinary source body hashes, mandatory coverage, evaluation/Judge input bytes and assessment candidate/scenario/input/rubric identity. It also binds the input reporting week to the reserved row. A schema downgrade or consistently rehashed mismatched packet is rejected. Invalid candidates preserve the previous accepted active report.

## Persistence and rollback

Migration `20261113215744_vantage_scoped_source_policy.sql` adds two JSONB columns with empty-object defaults to the existing policy and preference tables. The generated snapshot retains all 142 existing tables. Official engine and product migrations and both checks ran against the new task-owned PostgreSQL database. No migration touched an existing local trial or production database.

Turning off the scoped flag prevents new finite-scope generation. Turning off the internal V1 flag also disables scoped creation. Keep this checkpoint's V3 reader available while any V3 reports remain retained. Rolling application code back to a build that cannot read V3 requires an explicit compatible active-report/read strategy. The two additive configuration columns may remain in place. Their destructive removal was neither necessary nor executed.

## Executed verification

The final parent-run pipeline suite passed 105/105 tests across the four core, canonical V2.1, budget and scoped V2 files. The final parent-run web suite passed 76/76 tests across eight files, including two real PostgreSQL integration tests, rendered coverage, server/context API, repository, existing authority/budget behavior and the exact-version RAG mapper. Both runs had zero failures and zero pending tests. Machine-readable results are `test-output/vantage-roadmap-20261113/scoped-pipeline-final.json` and `scoped-web-final.json`.

The full pipeline package TypeScript check passed. The full web TypeScript check passed with zero diagnostics using an in-memory path mapping to this worktree's pipeline source. Existing ignored dependency junctions point to the older healthy checkout, so the mapping is necessary to check the changed contract. No dependency link or project compiler configuration was altered. Focused server/API lint reported zero errors and warnings. The schema/UI owner separately verified its owned files. Final changed-file Prettier and Git whitespace checks passed.

Reproduction uses the installed runners from this worktree. The web verification helper is retained in the ignored task artifacts alongside its compiler and lint logs. The PostgreSQL connection comes from the ignored task-owned connection file, which must never be printed or committed.

The real PostgreSQL test uses official migrated tables, the production Drizzle PostgreSQL adapter, real encryption and at most two connections to loopback port 55570. Its parent exceeds 32 KB across 129 chunks and its selected span crosses a chunk separator. It exercises company/personal scope persistence, exact historical versions, deterministic Generation/Judge, V3 activation, encrypted readback, packet tampering, current ACL revocation, parent changes outside the span, retained historical scope, disabled experimental flags, previous-active preservation and cross-company lock isolation. The cutoff regression covers PostgreSQL microseconds.

Development checks exposed and corrected semantic descriptor equality across JSONB object-key ordering and Jest realms, ordinary mixed-source body/hash binding, assessed-candidate identity, reserved-week binding and SQL cutoff precision. Exact serialized packet hashes remain exact. Semantic descriptor equality uses the existing canonical fingerprint function.

These are offline engineering, rendered component and database integration results. An authenticated browser walkthrough, full monorepo build, representative load, live provider quality and official Joseph/Sophia semantic evaluation were not executed for this checkpoint.

## Remaining limits and next milestone

Long required documents still require an explicit finite grant or complete indexed text that fits all budgets. A parent over the acquisition cap fails closed. The bounded scope can omit decision-relevant information beyond its approved range. Administrator review and independent corpus evaluation must measure that tradeoff.

The current configuration surface is the existing authenticated JSON API. A richer span-selection editor and source-anchor navigation were deferred. No automatic scope proposal, semantic reranking, public research or graph retrieval was added to the application.

Next, use Joseph's authoritative versioned corpus and independently reviewed evidence judgments to compare current selection, budget-aware V1, Sophia exact-version lexical retrieval and scoped evidence under frozen conditions. Keep configured-mandatory coverage, semantic relevance, citation integrity and model decision quality separate in the results. The independent review and live-quality boundaries remain release gates.
