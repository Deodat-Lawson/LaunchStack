# Vantage topic-first retrieval — implementation plan

Date: 2026-11-17. Owner of this plan: Claude (report owner). Independently reviewed in two rounds by Codex (`gpt-6.2-sol`, effort `ultra`). This is a plan only. Nothing here is implemented, and no code, test, schema or configuration changed.

**Target.** `C:\Users\junku\.codex\worktrees\vantage-retrieval-roadmap\implementation-vantage-production-20261109`, branch `codex/vantage-realistic-sample-docs-20261116`, HEAD `cd2bda46a6c5c0dba72a6512b8344d5bca40da98`. HEAD equalled `origin` after `git fetch` on 2026-11-17.

HEAD and `git status --short` were recorded:
- before Round 1;
- after Round 1;
- after Round 2;
- before this final write.

HEAD never changed. The only change was this file. Pre-existing untracked files were left untouched: `.playwright-cli/`, `docs/engineering/vantage-{mechanical-fixes,runtime-repair}-20261116.md`, `docs/reviews/` and `e.textContent`.

**Evidence convention.** Paths are relative to the target. Line numbers refer to HEAD. "Verified" means the owner opened the source for this plan. Claims taken from the reviewer without re-opening are marked "(reviewer-cited)".

**Summary.**
- The plan builds topic-first retrieval as a new default-off mode beside the existing ones.
- The tool-using exploration stage runs between seeding and the unchanged V2.1 path. The run is reserved first, every model turn is authorized, and the frozen selection is committed exactly once.
- A per-version document digest is added as an opt-in repository service.
- Personal topics start as owner-authored retrieval guidance.
- The biggest open issue is snapshot capacity (§2 F4, decision D1). The V2.1 limits hold about five Harborlight documents, so topic-first can pick better evidence but cannot cover all six review cases in one report.

## 0. Traceability: team decisions and invariants

| Team decision / invariant | Where built | Note |
| --- | --- | --- |
| 1 Start from questions: active topics, this week's changes, carryover; then retrieve | §7.1 seeds (watches → carryover → changes → recency); §3 flow | Retrieval is driven by those seeds before any recency pool |
| 2 Per-version digest keyed by content hash, repository-wide, Vantage one consumer | §5.1, §6, §4 | Key = version + canonical hash + format + reader |
| 3 Personal topics per (company, actor); model proposes, owner confirms/creates/closes; no auto-close | §5.2, §8 P1a/P1b (owner create/close with CAS), P3 (proposals → owner actions) | Inactivity only prompts |
| 4 Topic = retrieval guidance | §5.2 guidance fields (openQuestions, decisionChangers, keywords, people, metrics) + watches | |
| 5 Topic → document-version understanding, stale on new version | §5.2 understandings (P3) | Staleness is derived, not stored |
| 6 Compact catalogue always in context; details via bounded, recorded tool calls | §7.3 (catalogue contract + tools + limits); §5.2 manifest + per-turn trace | Calls are recorded in the run's snapshot record: the encrypted manifest and per-turn trace, stored with the run and bound to its id. They are kept out of the report body that the read API returns (F11). |
| 7 Exploration freezes evidence; V2.1 Generator, validation, Judge, admission unchanged | §7.2–§7.5 | Generator, deterministic validators, Judge criteria and the existing v1–v3 admission checks run unchanged on the frozen snapshot. The topic mode supplies its input through the existing optional `retrievalContext` slot (new literal beside v3). Its freeze binding runs in the accept transaction alongside the existing checks, not instead of them. |
| 8 Budgets not a concern; embeddings deferred | §2 F4, D1; §7.1 | Phase 1 needs **no embeddings**: seeds are explicit IDs and time windows, and P3 search is literal. The V2.1 limits still cap the frozen snapshot (D1). |
| ACL before the model sees anything | §7.1 (every seed authorized by ID at S0), §7.2 (every provider turn re-authorized), §6 serve rule, §5.2 denied items omitted | Applies to digests, understandings and tool results |
| Required docs and Stars always included | §7.1 item 3, §7.4 step 3.1, §7.5 admission | Fail closed if they don't fit |
| Model selects only offered IDs; server validates | §7.3 `not_offered`, §7.4 step 2, §7.5 | A non-member selection fails the run |
| Digests/understandings are inference; citations point to source text | §6 grounding, §7.3, §7.5 labels | Digest text is never citable |
| Human decisions authoritative | §7.1 carryover (no generated prose), P3 owner actions with receipts, decision UI unchanged | |
| Room for changes outside any topic | §7.1 lane candidates, §7.4 step 3.2 | Lane is never dropped by convergence |
| Saved reports still open | §5.2 `retrieval_mode` default `legacy`, §7.5, P1a tests | v1–v3 read/restore/decide across flag toggles |

---

## 1. Current-state map

### 1.1 Document pipeline (repository-wide)

| Piece | Where (verified) | Today |
| --- | --- | --- |
| Tables | `packages/store/src/db/schema/base.ts:70-150`; `rlm-knowledge-base.ts:89-457` | `document_versions` has no content-hash column. FKs do not enforce version → document → company lineage. Context chunks carry `page_number`, `line_start` and a per-chunk hash. |
| Existing "summary" | `document_metadata` (`rlm-knowledge-base.ts:346-410`), written at `packages/conversion/src/ocr-processing/processor.ts:1104-1138,1370-1394` | `summary` is the first 500 characters of the text. `topicTags: []`, `entities: {}`. Not model-generated. |
| Summary readers | Runtime: RLM overview, single and batch (`packages/retrieval/src/algorithms/rlm/rlm.ts:150-170`; batch at `:195-216` reviewer-cited). Maintenance: `apps/web/src/scripts/migrate-chunks-to-rlm.ts:200-204` | The RLM search tools (`packages/retrieval/src/tools/rlm-search/rlm-search.ts:93-285`) have no app or pipeline caller (grep). |
| Pipeline events | `packages/orchestration/src/pipeline-events.ts:45-160`; `outbox-processing/process-event.ts:79-205`; `outbox-store.ts:50-63,146-172` | `source.version.created → evidence.version.extracted → evidence.version.indexed → company.state.projection.requested → company.state.projected`. Completion enqueues children through a revive path: a processed or dead child returns to `pending` on replay. Event-ID uniqueness alone does not stop a second model call. |
| LLM post-index precedent | `apps/worker/src/ports/projection.ts:19-34`; `pipelines/src/company-metadata/build.ts:88-120`; `README.md` | Separate child event, small model, per-version cache, `READER_VERSION`, verbatim-quote rule. It reads the document's **current head**, not the indexed version, and bills the **latest** uploader, although `uploaderOfVersion` exists (`apps/web/src/server/ai-usage/uploader.ts:12-27`). |
| Grounding helper | `pipelines/src/company-metadata/passages.ts:188-224` | `quoteAppearsIn` is a normalized boolean match (case, punctuation, whitespace folded). It does not locate an exact span. |
| Runtime retrieval consumers | `apps/web/src/server/rag/port.ts:24-45` (`createAppRagPort` embeds per search). Ask route, MCP workspace search, document-generator research, scenarios, proposals (files located by grep; specific lines reviewer-cited) | Chunk-level search. None reads a document-level summary. |
| Workspace model scope | `apps/web/src/server/workspace-models/scope.ts:97-101` | With no workspace model chosen, calls fall back to the deployment scope. It carries no document authority. |
| Tool loop | `packages/llm/src/agent/runner.ts:33-222`; `types.ts` | `maxTurns`, `tokenBudget`, ≤8 calls per turn, 30,000-char tool results, `submit_result` schema, injectable `AgentModelPort`, full transcript. The transcript is returned only on success; any error throws without it. Used by `pipelines/src/repo-explainer/explain.ts:125,161` and `pipelines/src/distribution/dossier-agent.ts`. |
| Backfills | `apps/web/src/server/backfills/index.ts:55-206`; `pnpm --filter @launchstack/web db:backfill` | Idempotent registry; `2026-08-note-embeddings` is a model-backed precedent. |
| DDL owners | `packages/store/drizzle.config.ts` (engine) and `apps/web/drizzle.config.ts` (product), reviewer-cited | Document tables are engine-owned. Vantage tables are product-owned. |
| Database | `docker-compose.yml:242`, `docker-compose.prod.yml:136` | `pgvector/pgvector:pg16`, so the built-in `sha256(bytea)` is available. |

### 1.2 Vantage Weekly Review today (document-first)

| Step | Where (verified) |
| --- | --- |
| Route and NDJSON stages `gathering → writing → checking → saving` | `apps/web/src/app/api/vantage/reviews/route.ts:30-90`; `apps/web/src/server/vantage/weekly-review-client-types.ts:18`; `weekly-review-service.ts:119,179,181,233`. The client parser rejects unknown stages (`apps/web/src/app/employer/tools/vantage/api.ts:297-324`). The progress UI has its own list (`_components/ReviewGenerationProgress.tsx:11`). |
| Collection in one bounded transaction | `weekly-review-internal-selection.ts:26-33,84-117,233-330`: 3,000 ms, 768 counted statements, 128,000 loaded bytes. |
| Fixed sources first: required context, Stars, approved scoped units | `internal-selection.ts:193-212,259-300`; `weekly-review-scoped-selection.ts` |
| Optional evidence | Baseline recency, or the dynamic modes `role`, `internal-research`, `combined` (`internal-selection.ts:307`; `weekly-review-dynamic-selection.ts:40-416`; env `VANTAGE_DYNAMIC_RETRIEVAL_MODE`, default `baseline`, `weekly-review-dynamic-retrieval.ts:1-18`). |
| Role ranking, gap planner, lexical search | `pipelines/src/vantage/role-aware-ranking.ts`; `internal-retrieval-decision.ts`; `weekly-review-internal-search.ts:26-65`. The search pool is the 64 most recent eligible versions, taken before ACL filtering. |
| Exact-version reads | Skip the SQL cutoff when `exactVersion` is supplied (`internal-selection.ts:126-146`). |
| Model context `vantage-dynamic-retrieval/v3` | `pipelines/src/vantage/dynamic-retrieval-v3.ts:10-47`: one strict literal, three modes. Used at `weekly-review-v21.ts:169-170,232,343,474`. |
| Identity, reserve, dispatch, admission, read | `weekly-review-service.ts:116-168,233-249`. Repository: reserve `:316-356`, dispatch with generation-only active precheck `:358-388`, accept with pointer CAS and v1–v3 evidence `:399-660`, trace check `:487-500`, read DTO `reportReadEvidence` `:71-104` (spreads top-level evidence), `get` `:664-695`, `expireUncertain` 120 s by `created_at` `:241-254`. |
| Decisions | Append-only and encrypted. The table has no topic column; `topic-N` sits inside the payload (`apps/web/src/server/db/schema/vantage-weekly-review.ts:81-109`; `repository.ts:705-774`). Report topic IDs are assigned at `weekly-review-service.ts:226-232`. |
| Authority epoch | Bumped by AFTER triggers on ACL, document, version, chunk, policy and preference tables (`apps/web/drizzle/20261109200000_vantage_weekly_reviews.sql:40-80`; `20261109230000_vantage_authority_after_write.sql`). User and membership updates bump only when identity columns change (`20261114000000_vantage_identity_authority_updates.sql:16-38`). Dispatch and activation require equality with the collection epoch. |
| V2.1 limits | `weekly-review-v21.ts:330-405`: Generation input 12,000 B, Judge input 14,000 B, 16 sources, 6,000 chars per source, report reserve 2,800 B for internal/scoped profiles. |

### 1.3 Continuity, history and legacy

| Piece | Where | State |
| --- | --- | --- |
| Legacy agenda (company/week) and agenda topics | `pipelines/src/vantage/schema.ts:175-265`; routes `api/vantage/agendas/**`, `api/vantage/topics/[id]` | No screen. Still read by overview, triage and commitments (`docs/engineering/vantage-founder-ui-20261116.md:40-47`). |
| Commitments | `schema.ts:267-311` | Company-scoped with a `shared` flag. The list joins the legacy topic title (reviewer-cited). The current UI creates commitments without provenance. |
| Recorded continuity | `pipelines/src/vantage/recorded-continuity.ts` | Prototype with fresh-authority and unknown-history semantics. No caller (grep). |
| Founder weekly review (a separate system) | `pipelines/src/founder-weekly-review/schema.ts:46-183`; `apps/worker/src/inngest.ts:20-55`; `api/founder-weekly-reviews/**`; `apps/web/src/server/founder-weekly-review/document-version-chunks.ts` | Live API, worker jobs and persisted runs; no UI. Unaffected by this plan. |
| Harborlight sample | `docs/samples/vantage/harborlight-release/{manifest,expectations}.json` | 12 documents, 13 versions, 15,749 bytes; six authored review cases. Pre-indexed by a dev importer that bypasses ingestion (`scripts/dev/vantage-sample-documents.mjs`). |

## 2. Findings that shape the plan

- **F1 — no digest exists.** `document_metadata.summary` is a text prefix with one unused reader. Leave it alone and add a new per-version digest.
- **F2 — reuse the company-profile projection's shape, not its versioning.** Keep the child event, small-model capability and grounding. Bind to the exact version, bill per version, and claim each model call per row.
- **F3 — one parent canonical text exists.** Whole-document readers (`weekly-review-authority.ts:133-150`, `internal-selection.ts:154-188`) and the scoped parent (`scoped-selection.ts:154-175` with `pipelines/src/vantage/scoped-evidence.ts:112-125`) all use: chunks ordered by `page_number, line_start, id`, joined with LF, SHA-256 over UTF-8. So the whole-document hash equals the scoped `parentHash` for the same version. Scoped units add excerpt hashes over UTF-16 half-open offsets. Evidence inspection is a fourth reader (`weekly-review-evidence-inspection.ts:100-116`). The company profile orders differently, so its text is not the same. Reader size bounds differ and must stay as they are.
- **F4 — capacity is the binding constraint.**
  - Harborlight documents are 1,106–1,275 bytes each.
  - The 11 documents that support the six cases total 13,436 bytes, above the 12,000-byte Generation input before JSON.
  - The historical baseline admitted 5 sources.
  - Under decision 7 (V2.1, Judge and admission unchanged), topic-first can choose better evidence but not more of it.
- **F5 — exploration cannot run inside collection,** which is a single 3-second transaction.
- **F6 — `runAgent` fits but needs recording wrappers,** because it loses the transcript on error.
- **F7 — `retrievalContext` is the extension point.** Topic-first needs its own literal and a stronger admission binding.
- **F8 — "topic" already names three things.** Legacy agenda topics, run-scoped report topics (`runId` + `topic-N`) and the new personal topics (UUID) must stay distinct everywhere.
- **F9 — scope mismatch with commitments.** Commitments are company-scoped; Weekly Review and personal topics are owner-only. Private text must never join company DTOs.
- **F10 — search can't reach old watched documents.** The lexical pool is recency-bounded before ACL filtering, so watched documents enter by explicit ID.
- **F11 — the read DTO would leak an exploration trace stored in the report envelope.**

## 3. Target architecture and data flow

```
REPOSITORY-WIDE (opt-in per company, P2)
evidence.version.indexed ─► document.digest.requested{sourceId, sourceVersionId, indexEventId}
   ─► eligibility + SQL hash ─► claim row ─► token re-check ─► small model
   ─► exact-span grounding ─► publish if token and hash unchanged

VANTAGE (mode "topic-first"; env flag, default off; requires Internal V1)
POST /reviews (key)
 0 key lookup: an existing run follows today's replay rules and uses its pinned cutoff (no recollection)
 1 S0 seed (bounded tx; fresh actor; epoch E0; cutoff pinned)
      fixed sources │ watches │ carryover seed IDs │ lane candidates │ changed this week │ recency
      → S0 manifest
 2 reserve (one tx): run row (mode=topic-first, cutoff, asOf, E0) + encrypted manifest commitment      [gathering]
 3 claimExploration (run lock → epoch; E0 equal; canMutate; active-pointer precheck)                  [exploring]
 4 S1 runAgent with recording port and tools; before EACH provider turn:
      authorizeExplorationTurn tx (E0, canMutate, deadline, append the turn's request record)
 5 S2 freeze (run lock → epoch; E0 equal; deadline): exact rereads ≤ cutoff, deterministic fit,
      build the full V2.1 input, commit snapshot_hash + dependencies once
 6 existing V2.1: generation dispatch (requires committed freeze) → Generator → validation
      → judge dispatch (same freeze) → Judge                                                        [writing, checking]
 7 accept: the run's mode forces topic admission; evidence.inputSnapshot hash = snapshot_hash         [saving]
 8 This week: report. P3 adds proposals → owner actions with receipts.
```

## 4. Ownership boundary

| Repository-wide: engine (`packages/store`, `packages/orchestration`, `apps/worker`, new `pipelines/src/document-digest`) | Vantage-only: product DDL (`apps/web/src/server/vantage`) |
| --- | --- |
| Canonical text contract and helper `canonicalVersionText(versionId, bounds)`, plus SQL `canonicalVersionHash(versionId)`. Parity tests against the four Vantage readers and the founder reader. | Personal topics, watches, understandings, proposals and receipts |
| `document_version_digests` + attempts table, event, worker, reconcile sweep, company opt-in policy | Run discriminator, S0 manifest, S1 wrappers, S2 freeze, exploration trace table |
| `getDigestsForVersions({companyId, versionIds, documentScope})`: tenant-joined, eligibility- and ACL-gated, hash-checked | `vantage-topic-retrieval/v1` context, admission binding, `exploring` stage, UI, evaluation arms |

**Minimal repository-wide contract that unblocks Vantage:** the canonical text and hash helpers plus the digest read API signature. Vantage ships P1 with a deterministic preview fallback (title + first 800 characters of the readable text) and switches to digests when P2 lands.

## 5. Data model and migrations

All tables use the `pdr_ai_v2_` prefix (`packages/store/src/db/schema/helpers.ts:7`). Migrations are additive only.

### 5.1 Engine migrations (P2)

**`document_version_digests`**

| Column | Type | Notes |
| --- | --- | --- |
| id | bigserial | PK |
| company_id | bigint | FK company, cascade |
| document_id | bigint | FK document, cascade |
| version_id | bigint | FK document_versions, cascade |
| content_hash | varchar(64) | Canonical hash (F3), computed in SQL |
| index_revision | varchar(160) | `evidence.version.indexed` event ID; disambiguates reindex |
| format_version | varchar(32) | `doc-digest/1` |
| reader_version | varchar(32) | Prompt and rules revision |
| eligibility_context | varchar(64) | Hash of company policy, document restriction state and model route at claim time |
| status | varchar(16) | `running`, `ready`, `failed`, `uncertain`, `superseded`, `ineligible`, `too_large`, `no_content` |
| claim_token, claimed_at, attempt_started_at | | Lease 10 min |
| headline | text | ≤200 chars |
| items | jsonb | ≤24 items: `{kind: fact\|number\|open_item\|decision\|date\|person, text, quote, location:{start,end}}` |
| model_id, billed_user_id | | Null billed_user_id = system |
| created_at, completed_at | | |

Unique `(version_id, content_hash, format_version, reader_version)`. Indexes `(company_id, document_id)`, `(company_id, status)`, `(status, claimed_at)`.

**`document_version_digest_attempts`** (append-only): digest_id, attempt, claim_token, started_at, finished_at, outcome (`ok|failed|uncertain`), usage jsonb, model_id.

**Company policy column:** `company.document_digests_enabled boolean default false` (D4/D8).

### 5.2 Product migrations (P1a unless noted)

**`vantage_personal_topics`**
- Columns: id uuid PK; company_id; owner_id (auth user id); status `active|closed`; revision int (CAS on every owner edit, close or reopen); ciphertext; origin `owner|accepted_proposal`; origin_run_id; last_activity_at; created_at; updated_at; closed_at.
- `ciphertext` holds the encrypted `{title, guidance:{openQuestions≤8, decisionChangers≤8, keywords≤16, people≤8, metrics≤8}}`, with AAD = `vantage-topic:{company}:{owner}:{id}`. Each guidance item carries `origin: owner | proposal{runId, proposalId, sourceRefs}`.
- Index `(company_id, owner_id, status)`.

**`vantage_personal_topic_watches`**
- Columns: id; topic_id FK cascade; company_id; owner_id; document_id FK document cascade; created_at.
- Unique `(topic_id, document_id)`.
- The writer checks `document.company_id` and current read access. A watch mutation increments the parent topic's `revision` in the same transaction.

**`vantage_personal_topic_understandings`** (P3)
- Columns: id; topic_id FK cascade; company_id; owner_id; document_id; version_id FK document_versions cascade; content_hash; ciphertext; origin; origin_run_id; created_at.
- Unique `(topic_id, version_id, content_hash)`. The writer checks lineage version → document → company.
- Stale when the version eligible at the cutoff differs from `version_id`, or the current hash differs. A not-yet-indexed version is not eligible, so not stale.

**Weekly Review run additions (additive)**

| Column | Type | Purpose |
| --- | --- | --- |
| retrieval_mode | text not null default `'legacy'` | Immutable run discriminator. Pre-existing rows read as `legacy`. |
| pinned_cutoff, pinned_as_of | timestamptz null | Durable identity for topic-first |
| authority_epoch | text null | E0 |
| exploration_dispatched | boolean default false | |
| exploration_deadline_at | timestamptz null | |
| snapshot_hash | text null | Hash of the complete V2.1 input built at S2 |
| last_dispatch_at | timestamptz null | `expireUncertain` uses `coalesce(last_dispatch_at, created_at)` |

**`vantage_weekly_review_run_manifests`** (admission proof, kept for the life of the run)
- Columns: run_id PK FK runs cascade; company_id; owner_id; manifest_hash; ciphertext (encrypted S0 manifest, AAD run-bound); snapshot_ciphertext (encrypted S2 commitment); created_at.

The S0 manifest holds:
- week, cutoff, asOf, E0, configuration;
- policy, preference and role revisions;
- `topics[{id, revision, guidanceSnapshot}]`;
- fixed sources `{ref, version, hash, purpose, audience, scoped proof: parentHash, unit refs and excerpt hashes}`;
- offered refs `{ref, documentId, versionId, versionCreatedAt, purpose:"retrieved", audience, readable: textHash | metadataOnly: chunkCount, byteCount}`;
- lane candidates;
- carryover `{priorRunId, reviewVersion, seedRefs}`;
- digest row IDs used.

**`vantage_weekly_review_explorations`** (audit trace, best-effort per turn but required for the run to continue)
- Columns: run_id; turn; company_id; owner_id; ciphertext (request summary, tool calls with args and result hashes, raw model output; AAD run-bound); bytes; created_at; expires_at (D9, default 90 days).
- PK `(run_id, turn)`.

**`vantage_personal_topic_proposals`** + `..._proposal_actions` (P3)
- Proposals: run_id, proposal_id = `sha256(runId‖ordinal)`, ciphertext (immutable payload), dependency_refs (⊆ run frozen dependencies), payload_hash, expires_at (4 weeks); written in the accept transaction.
- Actions: run_id, proposal_id, action, target_topic_id, target_revision, payload_hash, idempotency_key, receipt; unique `(run_id, proposal_id)` and `(company_id, owner_id, idempotency_key)`.

**Retention.**
- The trace expires.
- Manifests and proposals live with the run.
- Report deletion cascades to all of them.
- No owner-private text appears in plaintext columns. Titles of offered documents are not stored; refs and hashes only.

## 6. Repository-wide digest contract (P2)

| Concern | Rule |
| --- | --- |
| Trigger | The `evidence.version.indexed` handler (`process-event.ts:137-162`) emits a second child, `document.digest.requested {sourceId, sourceVersionId, indexEventId}`. Event ID: `document.digest.requested:{indexEventId}`, so a reindex creates a new event instead of being absorbed. |
| Eligibility (checked at claim AND at publish) | `company.document_digests_enabled`; document not restricted by document or folder setting (restricted documents are ineligible until D8 says otherwise); a permitted model route (D4); ≥1 context chunk. |
| Bounds without loading the body | A SQL probe gives count and bytes. Above 120,000 UTF-16 units or 1,024 chunks → `too_large`. The hash is computed server-side: `encode(sha256(convert_to(string_agg(content, E'\n' ORDER BY page_number,line_start,id),'UTF8')),'hex')`. A parity test pins it to the JS readers. |
| Claim | `INSERT … ON CONFLICT DO NOTHING` on the unique key with `status='running'`, a fresh token and a lease. Only the inserter, or a reclaimer of an expired lease with no `attempt_started_at`, proceeds. |
| Before send | `UPDATE … SET attempt_started_at=now() WHERE token=$t AND status='running'`, plus an attempt row. If this fails, the call is not sent. |
| Publish | One transaction: recompute the SQL hash and eligibility. If unchanged: `UPDATE … SET status='ready' … WHERE token=$t AND status='running'`. If the hash changed: `superseded`, and a new request is enqueued. |
| Guarantees | At most one live claim per key. No send without a held token. No publish without the token and an unchanged hash. A known failure is retried up to 3 attempts. **A crash after send and before publish → `uncertain`, held (not auto-retried); explicit operator or backfill retry only.** Provider idempotency keys are not assumed. Every attempt is logged with usage or unknown. |
| Grounding | Exact UTF-16 substring search over the canonical text. For repeats, take the first match after the previous item's location, else the first match. Spans may cross chunks. No exact match → drop the item. `quoteAppearsIn` alone is never enough. Anchors are computed at read time from offsets. `text` and `headline` are retrieval inference and never citable. |
| Equal-hash copy | Allowed only within the same company and an identical `eligibility_context`. Model id `copied:<row id>`. |
| Reconcile sweep | Backfill entry `2026-11-document-digests`: (a) versions with chunks and no row for the current hash, format and reader (covers dev imports that bypass ingestion); (b) `running` rows past their lease: `attempt_started_at` null → reclaimable, set → `uncertain`. Current versions first. |
| Attribution | `uploaderOfVersion(versionId)`, else system; recorded per attempt. |
| Serve | The read API joins version → document → company and returns a row only when: (1) the hash equals the current SQL hash; (2) format and reader are current; (3) the eligibility context still holds; (4) the actor's current scope and restriction check pass. Otherwise it reports `unavailable`. |
| Other consumers | RLM overview, Ask source cards and MCP enrichment may opt in later through the same read API. They keep their current contracts until then. |

## 7. Vantage pipeline contracts

### 7.1 Key lookup and S0

1. **Key first.** If a run already exists for `(company, owner, key)`, apply today's replay rules: accepted → `get` (current read authority applies, so a permission change can 403); failed → `review_failed_use_new_key`; reserved → `review_dispatch_uncertain`. Its pinned cutoff is used and nothing is recollected. A same-key race is settled by the existing unique constraint at reserve; the loser gets the replay outcome.
2. **S0** runs as one bounded transaction under existing authority: fresh actor, `canMutate`, epoch E0, `asOf = now`, `cutoff = min(asOf, weekEnd)`.
3. **Fixed sources** use the existing code path. For an approved finite scope only its units are offered: no digest, excerpt or search outside its spans.
4. **Seeds** in priority order. Each is authorized by explicit ID with the current scope and restriction check, and only eligible versions at the cutoff are kept:
   1. watches of active topics;
   2. carryover seed refs;
   3. changed this week (version `created_at` in [weekStart, cutoff]);
   4. recency pool (existing query).
5. **Carryover (P1).**
   - Source: the previous week's active report at S0, if readable under current authority; otherwise `carryover: unavailable`.
   - Only exact source IDs are used: the documents cited by report topics that have no decision row at S0, re-resolved to their eligible version at the current cutoff.
   - **No generated prose from earlier reports reaches any model.**
   - `priorRunId` and `reviewVersion` are recorded as observed at S0. A historical run never reads later observations.
6. **Lane candidates:** up to 3 changed-this-week versions not watched by any active topic, newest first. They are authorized and size-probed, and recorded separately so the manifest cap cannot crowd them out.
7. **Manifest caps:** 120 offered metadata refs; catalogue ≤ 24,000 bytes.
8. **Readable subset:** bodies loaded inside the existing 128 KB / 768 / 3 s envelope, in seed order. Text hashes go in the manifest; bodies stay in memory for S1. Metadata-only refs pin `(documentId, versionId, versionCreatedAt, chunkCount, byteCount)`. They may be selected and S2 reads them under E0 (E0 equality implies no chunk write happened), but they cannot be excerpted.
9. **Run identity:** `input_hash = hash(week, expectedActiveId, pinned cutoff, E0, manifest_hash, configuration)`. No candidate UUID, no wall-clock time.

### 7.2 Run state machine

Lock order everywhere: run row `FOR UPDATE`, then the epoch row (as `repository.ts:358-388` does today). Each transition commits before any provider I/O.

| Transition | Predicate | Effect |
| --- | --- | --- |
| reserve | key unique | `retrieval_mode='topic-first'`, pinned fields, E0, deps = fixed sources, manifest row, `status='reserved'` |
| claimExploration | reserved ∧ mode = topic-first ∧ ¬exploration_dispatched ∧ E0 = current ∧ fresh actor `canMutate` ∧ active pointer = expectedActiveId | exploration_dispatched, `exploration_deadline_at = now + 60 s`, last_dispatch_at |
| authorizeExplorationTurn (before every provider turn) | reserved ∧ exploration_dispatched ∧ snapshot_hash IS NULL ∧ now < deadline ∧ E0 = current ∧ fresh actor `canMutate` | Append the trace row for the turn's request; last_dispatch_at. A failed trace write stops the run. |
| freeze | reserved ∧ exploration_dispatched ∧ snapshot_hash IS NULL ∧ ¬generation_dispatched ∧ now < deadline ∧ E0 = current ∧ row input_hash = manifest identity | deps := S2 frozen set; snapshot_hash; snapshot commitment row; last_dispatch_at |
| generation dispatch | existing ∧ (mode = topic-first ⇒ snapshot_hash IS NOT NULL) | existing + last_dispatch_at |
| judge dispatch | existing ∧ (mode = topic-first ⇒ snapshot_hash unchanged) | existing + last_dispatch_at |
| accept | existing ∧ (mode = topic-first ⇒ topic admission path §7.5 **regardless of the evidence's claimed schema**) | existing |

- **Expiry:** `expireUncertain` uses `coalesce(last_dispatch_at, created_at) + 120 s`. Every segment is shorter than that: S1 ≤ 60 s, Generation 30 s, Judge 31 s.
- **Late results:** an exploration port that ignores abort is fenced by the deadline and `snapshot_hash IS NULL` predicates. A late submission cannot freeze.
- **No restarts:** there is no freeze restart and no exploration restart; the user retries with a new key, as today.
- **Why E0 equality covers authority:** the epoch triggers cover ACL, document, version, chunk, policy and preference tables. With E0 unchanged and a fresh actor holding `canMutate`, every item disclosed at S0 is still authorized. That includes earlier tool results re-sent in later turns.
- **What stays pinned:** topic and watch revisions are owner guidance, not authority, so they are pinned in the manifest and do not invalidate a run. A watch mutation bumps its topic's revision, so the manifest shows which revision was used. Prior-report pointer or decision changes after S0 likewise stay pinned. Both rules are explicit.

### 7.3 S1 exploration tools

**Always-in-context catalogue** (system and user message, built from the S0 manifest, ≤ 24,000 bytes, deterministic order):
- active personal topics, compact: id, title, open-question count, watch count;
- fixed sources by ref and title;
- seed list with reason codes (watch, carryover, change, lane, recency);
- offered refs with title, category, version date, and digest headline or `unavailable`.

Everything in it is already authorized at S0. Details are fetched only through the tools below.

`runAgent` is wrapped:
- the recording `AgentModelPort` calls `authorizeExplorationTurn` before each `respond`;
- recording tools log arguments and result hashes;
- counters enforce the limits;
- the full log is per-turn durable (§7.2), so a crash loses at most the in-flight turn.

| Tool (P1) | Input (strict zod) | Output | Errors |
| --- | --- | --- | --- |
| `get_personal_topic` | `{topicId}` | Pinned guidance snapshot + offered refs of its watches | `not_offered` |
| `get_document_digest` | `{ref}` | Digest (inference-labelled) or preview fallback | `not_offered` |
| `read_document_excerpt` | `{ref, start, end}`, length ≤ 4,000, readable subset | Exact canonical slice, delimited as untrusted data | `not_offered`, `not_readable`, `range_invalid` |
| `submit_result` | `{selected:[{ref, topicIds[]}] ≤ 16}` | — | Schema or membership error back to the model |

- P3 adds `search_offered` (literal match over the readable subset and headlines) and proposals in `submit_result`.
- **Limits:** 6 turns, ≤8 calls per turn, 24 calls total, 8,000 characters per result, 512 KB total trace per run, 60 s wall time.
- **Same error for missing and denied:** unknown, denied and cross-tenant IDs all return `not_offered`.
- **Prompt:** source text is data, never instructions.
- **Replay:** re-execute the recorded calls against the pinned manifest inputs — exact versions, topic guidance snapshots and immutable digest rows — while they remain readable to the auditor. Model output is stored, not reproduced.
- **Audit access:** viewing the trace requires current read access to every document it references; per-item redaction otherwise. There is no trace UI in P1.

### 7.4 S2 freeze: deterministic fit

1. Reread fixed sources, lane candidates and model refs by exact version, with an explicit `version.created_at ≤ pinned cutoff` check on this path, using the existing readers and current authority (E0 equality required).
2. **Validate** in this order:
   - duplicate refs collapse to the first occurrence, merging topic associations;
   - a ref that is in neither the offered set nor the fixed set fails the run (`exploration_selection_invalid`);
   - a read denial under E0 fails the run (`source_authority_changed`);
   - size or availability problems skip the ref with a reason code.
3. **Fit** by building the exact final V2.1 input at every step (sources, scoped descriptors, `retrievalContext` with topic UUIDs and questions) and running the existing calculator:
   1. fixed sources must fit, else `mandatory_context_budget_exceeded`;
   2. lane: the first candidate (newest first) that is readable and fits. Record `admitted|none_eligible|capacity_shortfall` with counts only;
   3. model refs in model order, each kept only if the calculator stays feasible;
   4. convergence: if the final context grows past feasibility, drop the last admitted model ref and recompute, at most 16 iterations. Fixed sources and the lane are never dropped.
4. Commit `snapshot_hash = hash(complete WeeklyReviewInput)`: candidateId = run id, week, pinned asOf, role, mandatoryCoverage, sources, scopedEvidence, retrievalContext.

### 7.5 Context and admission

**New literal `vantage-topic-retrieval/v1`** in `pipelines/src/vantage/`, beside v3. The v3 literal and prompt are untouched. It carries:
- `topics[{id, title, openQuestions}]`: owner-authored guidance items only, labelled "owner notes, not evidence"; P3 proposal-derived items are included only while their `sourceRefs` remain readable;
- `seedReasons[{ref, reason: watch|carryover|change|lane|recency}]`;
- `lane`;
- `traceHash` = hash of the run's manifest_hash and snapshot_hash.

No S1 free text crosses into the Generator or Judge.

**Topic admission path** (forced by `retrieval_mode`):
- `hash(evidence.inputSnapshot) = snapshot_hash`. This binds context, scoped proofs, coverage and the source registry, so tampering with context or a fixed-unit proof while keeping identical source arrays fails;
- `input_hash` = manifest identity;
- the exact fixed set is present, with the scoped parent-to-unit mapping equal to the manifest proof;
- every snapshot source ref ∈ offered ∪ fixed, with version, hash recomputed from text, purpose and audience equal to the manifest and frozen dependencies — for unscoped runs too;
- every report citation ∈ snapshot (existing validators);
- existing v2/v3 evaluation, budget and Judge checks.

Pre-existing runs (`retrieval_mode='legacy'`) keep the v1–v3 paths byte-for-byte.

### 7.6 Failures, stages, DTOs

- **Failures:** no fallback in P1. Model failures (provider error, timeout, step limit, invalid or non-member submission) end with `topic_exploration_failed:<reason>`. Authority failures use the existing codes. The previous active report remains (D5 for any later fallback).
- **Stage:** add `exploring` to `WeeklyReviewStage`, the `api.ts` parser allowlist, `ReviewGenerationProgress` stages and en/zh-CN copy. Baseline never emits it.
- **DTOs:** GET, Generate and decision responses stay allowlisted. The manifest and trace never enter them. The report envelope gains only `{mode, lane, seedReasons, outcome}`. Logs carry codes only.

## 8. Phases

Each phase is independently shippable behind flags.

| Phase | Scope | Main files | Acceptance (injected providers unless noted) | Unchanged |
| --- | --- | --- | --- | --- |
| **P0 Contracts** (2 days) | Canonical text and SQL hash helpers; types for the S0 manifest, S2 snapshot commitment and trace record; both migrations drafted; `vantage-topic-retrieval/v1` schema | `packages/store` (helper), `pipelines/src/vantage/topic-retrieval-v1.ts`, `apps/web/src/server/vantage/weekly-review-topic-types.ts` | JS hash = SQL hash = whole-document hash = scoped parentHash on fixtures, including Unicode and NULL `line_start`; the founder reader agrees or its difference is documented | All behavior |
| **P1a Server slice** (flag off) | Topics and watches tables with owner API (CAS); key-first lookup; S0 manifest; run state machine; S1 wrappers with 3 tools; S2 fit; admission path; `exploring` stage | `weekly-review-service.ts`, `weekly-review-repository.ts`, new `weekly-review-topic-seed.ts`, `weekly-review-topic-exploration.ts`, `weekly-review-topic-freeze.ts`, schema and migrations, `api.ts`, `ReviewGenerationProgress.tsx` | See the P1a test list below | Baseline default; `role`, `internal-research`, `combined`; V2.1 Generator, validators, Judge criteria, activation, decisions |
| **P1b Thin UI** | "My topics" in Context (create, edit, watch, close/reopen with CAS) | `_screens/ContextScreen.tsx`, new component, i18n | Owner-only; a denied watch is hidden; CAS conflict shown | This week decision UI |
| **P2 Digest** | §6 end to end + sweep; Vantage tool switches from preview to digests | `packages/store`, `packages/orchestration`, `apps/worker`, `pipelines/src/document-digest/*`, backfill registry | Revive/redelivery after `ready` makes no model call; competing claims → one send; crash after send → `uncertain` and no auto-resend (assert provider attempts and writes); stale claimant can't publish; reindex during a claim → `superseded`; exact-span grounding; lineage mismatch rejected; restricted or disabled company → `ineligible`; eligibility change hides the row; ingestion unaffected by digest failure | Ingestion, RLM, Ask, MCP, research, scenarios, proposals |
| **P3 Understandings, search, proposals** | Understandings and stale seeds; `search_offered`; keyword seeds; role-ranking tie-break; proposals + actions + receipts; display-only duplicate hint; inactivity prompt (no auto-close) | Vantage schema, tools, This week components | Double submit idempotent; changed or closed target → CAS conflict; proposal refs ⊆ run frozen dependencies; revoked dependency hides the proposal and suppresses proposal-derived guidance; nothing closes automatically | Commitments |
| **P4 Links and commitment carryover** | Owner-confirmed links (kind-validated keys); commitment carryover recorded as "current at S0" | Links table, commitments UI | No private topic text in commitment DTOs; an inaccessible origin hides the link | Commitment visibility |
| **P5 Other signals** | Seed providers (§11) | — | — | — |

**P1a acceptance tests:**
- an old watched document behind newer denied heads is offered and selectable;
- selected ⊆ offered ∪ fixed; fabricated, retired or duplicate refs are handled per §7.4;
- required sources and Stars are always present;
- lane `admitted`, `none_eligible` and `capacity_shortfall` are all exercised;
- a late-growing context converges without dropping fixed sources or the lane;
- revocation between S0 and the first turn → claim fails;
- revocation mid-S1 → next turn denied;
- edit-right-only revocation (`canMutate` false) → turn denied;
- a crash after claim or after freeze → expiry → retry with a new key;
- a same-key race keeps the pinned cutoff;
- generation is refused before freeze;
- Judge is refused if snapshot_hash changed;
- an accept that claims legacy evidence on a topic-first run is rejected;
- tampering with context or a scoped proof while keeping identical sources is rejected;
- a stale active pointer → no exploration dispatch;
- a late concurrent activation loses the CAS;
- v1–v3 reports read, restore and decide across flag toggles;
- cross-tenant IDs → `not_offered`;
- malformed or oversized context is rejected;
- trace and manifest are absent from every DTO;
- post-accept revocation of an unselected document leaves the report readable;
- an exploration port that ignores abort cannot freeze after the deadline.

## 9. Keep / adapt / retire

| Component | Verdict | Reason |
| --- | --- | --- |
| Required context, Stars, scoped evidence | Keep | Fixed sources; their scope also bounds exploration |
| Source readers and freeze/hash/citation contracts | Keep; extract the shared helper without changing bounds or historical hashes | F3 |
| Baseline, `role`, `internal-research` | Keep runnable | Rollback and comparison arms |
| `combined` | Keep off (on hold) | Topic-first is the candidate replacement, pending evaluation |
| Role ranking | Adapt in P3 as a tie-break inside seeds | Grants no authority |
| Gap planner, lexical search | Keep until P3 callers replace them; retire only once no mode uses them | Avoid dangling modes |
| `dynamic-retrieval-v3` + trace check | Keep | Historical admission |
| `runAgent` | Reuse with wrappers | F6 |
| Recorded continuity prototype | Adopt its fresh-authority and unknown-history semantics in carryover; retire after P4 | No caller |
| Retrieval-evaluation harness | Adapt (§10) | Gold-blind design |
| `document_metadata.summary` | Untouched | A separate decision for its RLM reader |

**Backend retirement candidates (list only, outside these phases):**
- legacy agenda generator and routes (`pipelines/src/vantage/{prepare,signals,generator}.ts`, `api/vantage/agendas/**`, `api/vantage/topics/[id]`);
- agenda/topic tables, which need a retention plan for the commitment FKs;
- `founder-weekly-review` (live API and runs): inventory and retention first;
- RLM search tools (no caller; outside Vantage);
- per the founder-UI report, also: legacy read-authority, restore/recover routes and Drizzle rollback scripts, each with its listed precondition.

## 10. Evaluation plan

**Arms.** Each arm runs in an isolated, equivalent starting state: a separate owner, or a fixture database snapshot per arm, with identical configuration and no shared active pointer. All use pinned cutoff `2026-11-16T00:00:00Z`, the same fixed sources and injected Generator/Judge.
- **B:** the real default (baseline) path.
- **S:** topic-first with deterministic seeds and no agent; S2 takes seed order instead of model order.
- **T:** topic-first with a scripted exploration port. It is mechanics only, because a script can encode the answer.
- **T-live:** separately authorized and paired, with independent held-out review.

**Topic guidance** for S and T is written once, from `manifest.json` `suggestedRole` and priorities plus one topic per case question, by someone who has not read the `expectations.json` anchors. It is frozen by hash before any run.

**Mechanical gate (P1):**
- every invariant in §7;
- every P1a test;
- negative controls hold:
  - release-plan v1 is not presented as current;
  - case-6 sources are not used as readiness evidence;
  - a week of changes with no topic still admits the lane;
  - denied, revoked, scoped-parent and wrong-head-hash fixtures behave as specified;
  - empty topics behave as specified.

**Calibration (reported, not gated):**
- per case: supporting-document presence and anchor-quote presence in snapshot text;
- the per-arm feasible ceiling, computed with that arm's exact extra context (topic block, lane);
- offered pool size and lane status;
- rejection counts.

Baseline (historical injected run, 5 sources): full support for cases 1 and 4; partial for 2, 3 and 5 (`action-followup` supports rollback and security); none for 6. The six authored cases are calibration examples, not held-out Gold. Harborlight never exercises production ingestion. Semantic claims require T-live.

## 11. Room for other signal sources

Seeds come from providers with one contract: `{kind, ref, availableAt, title, reasonCode}` over ACL-filtered, versioned sources. Meeting notes, GitHub activity and customer feedback join as providers once they are stored as versioned documents, or as evidence with their own ACL. Digests apply to them unchanged. A future `vantage_personal_topic_signals` table can mirror watches. Nothing in the run state machine assumes documents are the only source kind.

## 12. Risks and decisions still needed

**Risks:**
- **R1 capacity (F4):** about 5 Harborlight documents per report.
- **R2 latency:** one extra stage of up to 60 s, before Generation (30 s) and Judge (31 s), behind proxies.
- **R3 epoch churn:** any covered write during S1 fails the run. Measure the rate.
- **R4 report-size compliance:** the useful-report reserve is 2,800 B (`weekly-review-v21.ts:360-364`). The live canary measured a 2,850 B allowance and was rejected at 5,410 B (`docs/engineering/vantage-realistic-samples-20261116.md:63-67`).
- **R5 digest cost and backfill size;** `uncertain` attempts need operator handling.
- **R6 trace privacy and retention.**

**Decisions for the team:**
- **D1:** keep the V2.1 boundary (this plan assumes yes) or raise limits for topic-first.
- **D2:** encrypt topic text (plan: yes).
- **D3:** exploration model route and payer.
- **D4:** digest model route, per-company opt-in default, backfill scope, cost owner.
- **D5:** a server-only fallback later, or never.
- **D6:** lane size (P1 = 1 admitted, 3 candidates).
- **D7:** user-facing name ("My topics").
- **D8:** whether restricted documents may ever be digested (plan: ineligible).
- **D9:** trace retention (plan: 90 days).
- **D10:** whether topic and watch edits during a run should invalidate it (plan: pinned, no invalidation).

## 13. Suggested split for next week (three people)

| Days | You (lead) | Teammate A (repository-wide) | Teammate B (Vantage store, UI, evaluation) |
| --- | --- | --- | --- |
| 1–2 | P0 with A and B: freeze the manifest, snapshot and trace types, the run columns, the topic literal | Canonical text and SQL hash helpers + parity tests (P0) | Harborlight fixtures: frozen blind guidance, watches, negative fixtures; isolated arm setup |
| 3–5 | P1a: key-first lookup, S0, state machine, S1 wrappers, S2 fit | P2 start: digest tables, claim/send/publish with attempts, SQL bounds, grounding | P1a topics/watches API with CAS + tests; `exploring` stage UI; arms B and S |

Expected end of week: P0 done, P1a server path working on fixtures with the preview fallback, P2 claim/publish core with tests, arm B and arm S runnable. Admission binding hardening and arm T likely spill into the following week.

## 14. Discussion record

| Round | Reviewer message | Task / dispatch | Owner state |
| --- | --- | --- | --- |
| Launch | Reviewer launched: Codex `gpt-6.2-sol`, effort `ultra`, confirmed from `launch.effective`; `--keep-open` | run `run_5b545ed41ceb` | — |
| 1 | `msg_0973967df2a5` (19 points, 17 blocking) | `task_53f6b040be16` / `ctx_981fbf7f987a` | Answered in draft v2 |
| 2 | `msg_ef8def74e136` (12 points, 11 blocking) | `task_738451a05b63` / `ctx_bd6afc6fc0ba` | Answered in this final revision |

The model list came from the Codex CLI model cache; `gpt-6.2-sol` had top priority among the Sol and Astra families, and `ultra` was its highest effort. The report owner is Claude, model `claude-opus-5-5` by session self-report; its effort could not be verified from this session. **The reviewer remains open:** Orca reports the worker live, its terminal retained and idle (`ctx_bd6afc6fc0ba`).

### Changes made through the discussion, and why

| Topic | Draft | Final | Trigger |
| --- | --- | --- | --- |
| Digest versioning and billing | Copy the projection | Exact version in the event, bill `uploaderOfVersion`, per-row claim | R1-2: projection reads the head; outbox revival can repeat calls |
| Model-call safety | Event-ID idempotency | Claim token, check before send, publish CAS, `uncertain` held, attempts log | R1-2, R2-8 |
| Restricted documents | Digest, ACL on read | Ineligible until D8; per-company opt-in; eligibility checked at claim, publish and serve | R2-9: the model scope carries no document authority (`scope.ts:97-101`) |
| Hash and bounds | Hash in the worker | SQL hash and probe without moving bodies; reindex-aware event ID; `superseded` | R2-10 |
| Grounding | `quoteAppearsIn` | Exact span located by the server | R1-4 |
| Digest lineage | Independent FKs | Lineage checked at write; joined at read | R1-4 |
| Canonical text | "Three readers share a hash" | Written contract, four readers, parity tests incl. the founder reader | R1-3 (partly disputed; see below) |
| Capacity | Noted | Fixed sources fit or fail closed; lane pre-reserved in S0; exact-payload fit with convergence | R1-5, R2-5 |
| S0 | 200 offered with full text | Metadata refs + bounded readable subset; lane candidates separate | R1-6 |
| Run lifecycle | Reserve, flag, one rewrite | Immutable mode discriminator; key-first lookup; pinned cutoff; state machine with freeze before any paid Generation; forced topic admission | R1-7, R2-1, R2-2 |
| Authority during exploration | New epoch at S2 | E0 pinned; every provider turn authorized (E0 + `canMutate` + deadline); freeze needs E0; exact rereads ≤ cutoff | R1-8, R2-3 |
| Admission binding | Selection hash | Committed manifest + full snapshot hash; offered/fixed equality incl. scoped proofs and unscoped runs | R1-9, R2-4 |
| Trace storage | Envelope | Separate per-turn durable trace (expires) + permanent manifest proof; never in DTOs | R1-10, R2-7 |
| Fallback | Deterministic fallback | None in P1 | R1-11 |
| Topic schema | One mixed table | Topics / watches / understandings, CAS, encryption, lineage, denied items omitted | R1-12 |
| Carryover | Prior questions to the model | Prior report seeds exact IDs only; no generated prose | R1-13, R2-6 |
| Proposals | Envelope only | Immutable proposal rows + receipts + provenance-based suppression (P3) | R1-14, R2-11 |
| P1 scope | CRUD + 4 tools + carryover + UI | P0 contracts, P1a server slice with watches, P1b UI; search and proposals to P3 | R1-15, R1-17 |
| Stage protocol | Not mentioned | Parser allowlist, progress list, i18n | R1-16 |
| Evaluation | 4/6 target; wrong baseline | Corrected baseline; mechanical gate vs calibration; blind guidance; isolated arms; per-arm ceiling | R1-18, R1-19, R2-12 |

Additional owner correction: the draft scored baseline cases 2 and 3 as "none". `action-followup` was in the snapshot and supports both, so they are partial.

### Unresolved disagreements

- **R1-3, the hash.** The reviewer said the draft overstated a common hash. The owner showed that the scoped parent is built from the same SQL order and LF join as the whole-document readers (`scoped-selection.ts:154-175`, `scoped-evidence.ts:112-125`), so `parentHash` equals the whole-document hash. Unit hashes are separate. The reviewer did not dispute this in Round 2, and the final plan adopts the reviewer's request to write the full contract and parity tests. Treated as resolved with evidence; never explicitly acknowledged.
- **No other open disagreement.** The final revision itself was not reviewed, by design: the audit-discussion protocol allows exactly two rounds, then a single owner-only revision.
  - That revision answered every Round 2 point.
  - It also added §0 (traceability to the team decisions and invariants) and the explicit catalogue contract in §7.3, closing two coverage gaps the owner found on a final self-check.
  - Neither addition changes a reviewed contract.

### What was rerun and what was not checked

**Rerun:**
- outbox revive and stale-claim behavior (`outbox-store.ts:50-63,146-172`);
- `uploaderOfVersion`;
- runner error paths;
- client stage allowlist;
- read-DTO spread;
- exact-version cutoff bypass;
- scoped parent join;
- identity-epoch migration;
- workspace model fallback;
- PostgreSQL version.

**Not checked:**
- runtime behavior: no tests, database, browser, provider or embedding calls were made;
- the Ask, MCP, scenarios and proposals internals beyond reviewer-cited lines;
- the founder pipeline in depth;
- ingestion transaction internals;
- SQL `sha256(string_agg(...))` cost on large versions;
- provider idempotency support;
- Harborlight capacity under the actual calculator, which was taken from the saved report plus file sizes, not recomputed;
- reviewer-cited lines not reopened, among them: RLM batch (`rlm.ts:195-216`), company-metadata ordering (`db.ts:108-126`), `outbox-store.ts:229-250,310-320`, `pipeline-events.ts:219-243`, `scope.ts:145-158,270-296`, commitment list join.

### Suspected issues not verified

- The epoch-churn rate in a busy workspace may make 60-second explorations fail often (R3).
- The in-SQL canonical hash may differ from the JS hash for edge Unicode or NULL ordering until the P0 parity test proves otherwise.
- Long explorations may hit proxy timeouts on the streaming route.
