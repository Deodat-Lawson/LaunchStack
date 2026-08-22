# CALL-NOTES-005 Handoff

## 1. Scope

This branch implements Junkun's assigned Call Notes lane:

- post-call AI enrichment core;
- structured-output and semantic provenance validation;
- projection of accepted Call Notes into LaunchStack Knowledge;
- embedding and retrieval safety for Call Notes; and
- real-model smoke evidence.

It does not take ownership of the application lifecycle or Accept/Reject orchestration. That seam remains with the team lead.

## 2. Final Architecture

```text
Finalized Transcript + Bookmarks + Current Call Note
        |
        v
EnrichmentInput
        |
        v
A1 Enrichment Core
- deterministic/versioned prompt
- configured/model-neutral generation boundary
- structured proposal
- semantic provenance validation
        |
        v
EnrichmentResult
        |
        v
[APPLICATION LIFECYCLE / TEAM-LEAD SEAM]
- persist run/proposal
- user review
- Accept/Reject
- stale base revision handling
- create canonical Call Note revision
        |
        v
KnowledgeNote
        |
        v
A2 Knowledge Integration
- KnowledgeNoteSink
- eligibility/current-revision validation
- existing note.embedding.requested path
- race-safe embedding replacement
- company retrieval live eligibility filtering
- notes-only retrieval
- RAG Call Note metadata
        |
        v
LaunchStack Knowledge / RAG
```

Three distinctions are architectural invariants:

- Transcript != canonical Call Note.
- AI proposal != canonical Call Note.
- Embedding != canonical Call Note.

The accepted, current Call Note is canonical.

## 3. A1 — Enrichment Core

A1 validates `EnrichmentInput`, serializes it deterministically, and sends it through the configured `reasoning` route behind the model-neutral `EnrichmentModel` boundary. The prompt preserves the owner-authored note as source context, treats finalized Transcript segments as factual evidence, marks gaps as unavailable evidence, and treats Bookmark comments as strong guidance rather than independent evidence. It prohibits inventing decisions, action owners, deadlines, speakers, Bookmark IDs, or Transcript segment IDs and prohibits inference across gaps.

The model returns the frozen `EnrichedNoteProposal` structure. Zod validates the proposal, then semantic validation checks every model-produced Bookmark citation against the canonical Bookmark and Transcript segment, including identity, linkage, speaker, timestamp, and timestamp-range validity. A1 returns `EnrichmentResult` with the resolved model ID and versioned prompt metadata; it does not persist a run or mutate a Call Note.

Key files:

- `packages/features/src/call-notes/contracts.ts`
- `packages/features/src/call-notes/ports.ts`
- `apps/web/src/server/call-notes/enrichment-prompts.ts`
- `apps/web/src/server/call-notes/enrichment-model.ts`
- `apps/web/src/server/call-notes/enrichment-validation.ts`
- `apps/web/__tests__/callNotes/enrichment-core.test.ts`

## 4. Shared Structured Output Fix

Commit `cc4c415c` fixes provider-neutral structured output for Zod object schemas with optional or defaulted properties. The shared layer converts the schema for compatibility inspection, recursively detects object properties that strict native JSON Schema cannot represent as optional, and safely selects the existing validated JSON fallback before spending an incompatible native request.

Zod remains authoritative for parsing, validation, and defaults. The generic signature permits differing Zod input and output types. Compatible schemas can still use native structured output; fallback responses receive one existing repair attempt, not an open-ended retry loop.

Key file: `packages/adapters/src/llm/structured-output.ts`.

## 5. A2 — Knowledge Integration

`KnowledgeNoteSink.upsert/remove` is the application-facing A2 boundary. `upsert` accepts only a `KnowledgeNote` that matches live canonical state:

- canonical Call and document-note identity;
- Call, document-note, and payload owner/company identity;
- current positive revision;
- `knowledgeIncluded = true`;
- company visibility; and
- completed Call state.

It also verifies current canonical title and Markdown before removing the old searchable projection and enqueueing the existing durable `note.embedding.requested` path. `remove` deletes only the searchable projection; it does not delete or edit the canonical Call Note.

Key files:

- `apps/web/src/server/call-notes/knowledge-note-sink.ts`
- `packages/features/src/call-notes/contracts.ts`
- `packages/features/src/call-notes/ports.ts`
- `apps/web/__tests__/callNotes/knowledge-note-sink.test.ts`

## 6. Embedding Race Safety

Embedding computation occurs outside the final transaction. Before replacement, the writer locks the canonical note and associated Call in a consistent order and rechecks live identity, revision, content, visibility, knowledge inclusion, and completed state:

```text
old embedding job
        |
        v
final live state / revision / content recheck
        |
        +--> stale, private, or knowledge-off: discard/remove safely
        |
        `--> still current and eligible: atomic projection replacement
```

The delete-and-insert replacement is atomic. Stale cleanup cannot erase a newer eligible projection, and ordinary non-Call Note behavior remains compatible.

Key files: `apps/web/src/server/notes/embed-note.ts` and `apps/web/__tests__/callNotes/note-embedding-race.test.ts`.

## 7. Retrieval Safety

Ordinary Notes retain their existing retrieval behavior. A company-scoped Call Note must additionally match current live Call state: canonical document-note and owner identity, company identity, completed status, company visibility, enabled knowledge inclusion, and a positive current revision.

This is defense in depth:

- write-side eligibility prevents ineligible projections from being created or refreshed; and
- read-side eligibility filters stale or newly ineligible projections even if one remains temporarily.

Company retrieval also supports the notes-only case, so eligible Notes and Call Notes remain searchable when the company has no document chunks. RAG results preserve `source`, `noteId`, and, for Call Notes, `callId` and `revision`.

Key files:

- `apps/web/src/lib/tools/rag/retrievers/notes-retriever.ts`
- `apps/web/src/lib/tools/rag/search/ensemble-search.ts`
- `apps/web/src/server/rag/port.ts`
- `apps/web/__tests__/callNotes/notes-retriever-call-notes.test.ts`
- `apps/web/__tests__/callNotes/company-notes-only-search.test.ts`
- `apps/web/__tests__/callNotes/rag-call-note-metadata.test.ts`

## 8. Embedding Index Decision

Note writes and Note queries use the same legacy Note embedding space (`text-embedding-3-large`, 1,536 dimensions, with a 512-dimension short vector). Call Notes reuse the Note runtime and do not hardcode provider-specific embedding behavior.

`resolveNoteEmbeddingRuntime` is the single resolver boundary for future configurable Note indexes. Arbitrary-dimension schema migration, reindexing, and cutover are intentionally deferred.

Key file: `apps/web/src/server/notes/embedding-config.ts`.

## 9. Live Kimi Smoke Evidence

- Provider: Kimi / Moonshot
- Endpoint: `https://api.moonshot.ai/v1`
- Model: `kimi-k2.6`
- Structured-output path: validated JSON fallback
- Prompt version: `call-notes-enrichment-generation/v1`
- Latency: approximately 153,758 ms
- Result: PASS
- Generated evidence: 2 grounded key points, 1 grounded action item, and 1 valid Bookmark citation
- Semantic provenance: PASS
- Final `EnrichmentResultSchema`: PASS

This was one successful real-model invocation through an opt-in developer Kimi adapter. Production configured reasoning routing was not changed. The smoke performed no database mutation, lifecycle mutation, `KnowledgeNoteSink` invocation, or embedding write.

Smoke tooling:

- `apps/web/scripts/run-call-notes-enrichment-smoke.ts`
- `apps/web/scripts/call-notes-kimi-smoke-adapter.ts`
- `apps/web/scripts/run-call-notes-kimi-smoke.ts`

## 10. Tests / Validation

Validation collected on this branch:

- consolidated Call Notes suites: 8 suites, 73 tests PASS;
- `enrichment-core.test.ts`: 18 tests PASS (included in the consolidated count);
- structured-output/transport regression suite: 1 suite, 34 tests PASS;
- `@launchstack/web` typecheck: PASS;
- `@launchstack/adapters` typecheck: PASS;
- targeted ESLint for the three smoke scripts: PASS; and
- targeted Prettier for the three smoke scripts: PASS.

No live provider request was made during finalization validation.

## 11. Commit Map

Relevant commits in branch order:

1. `72507a61` — specs and prototype
2. `ea89902e` — frozen Zoom-first architecture contract
3. `dd0b521f` — implementation ownership alignment
4. `c4d1a55f` — A1 enrichment core
5. `65ba4857` — A2.1 `KnowledgeNoteSink`
6. `ca582113` — A2.2 race-safe Call Note embeddings
7. `8424ffda` — A2.3 live Call Note eligibility filtering
8. `2a9a0aa3` — A2.4 notes-only company retrieval
9. `b90eeb0e` — A2.5 Call Note retrieval metadata
10. `cc4c415c` — optional/defaulted Zod structured-output compatibility
11. `469b981c` — opt-in Kimi enrichment smoke tooling

## 12. Remaining Integration Seams

Application/team-lead-owned:

- build and supply production `EnrichmentInput`;
- persist enrichment runs and proposals, including failures;
- provide proposal review and Accept/Reject;
- handle base-revision conflicts and create canonical revisions;
- invoke A2 after canonical lifecycle changes; and
- remove knowledge before deleting a Call.

Still deferred:

- canonical Calls deep-link route;
- guided enrichment rerun/revision;
- fully configurable, dimension-aware Note embedding migration; and
- production Kimi provider routing, if ever desired.

These are integration or deferred product seams, not unfinished Junkun-owned application lifecycle work.

## 13. Integration Contract

The clean handoff boundary is:

```text
Application layer provides: EnrichmentInput
A1 returns:                EnrichmentResult

After the application creates or updates the accepted canonical Call Note:
Application layer provides: KnowledgeNote
A2 provides:                KnowledgeNoteSink.upsert/remove
```

The application can wire these contracts without copying A1 prompt, validation, embedding, or retrieval logic.

## 14. Known Limitations

- The Kimi smoke took approximately 154 seconds on the synthetic fixture.
- The live smoke uses an opt-in developer Kimi adapter; production routing remains separately configured.
- The canonical Calls deep-link route is not finalized.
- Configurable arbitrary-dimension Note embedding migration and reindexing are deferred.
