# Sophia retrieval follow-up audit and handoff

Scope correction: the leader's subsequently supplied assignment is the
[final-output validation agent](vantage-validation-agent.md). This document records
an earlier proposed retrieval follow-up; it is not completion of that assignment.

Sophia's next deliverable is an authorized source-search adapter and a measured
retrieval-quality improvement. The Week 2 prototype is already incorporated into
the leader's synthetic demo. Rebuilding that prototype or taking over Joseph's
profile-review policy would not address the remaining retrieval gap.

This is a proposed work package based on the November 1 audit, not a newly
approved team schedule. The local implementation below is ready for review;
production activation and live acceptance are still pending.

## Baselines reviewed

- Local Sophia delivery: `c6eb63c6a6d6705b60a6ccec8bcba7704fee3532`.
- Original contract handoff: `Junkun/vantage-week2-rebuild` at `364a3c8b`.
- Stable integrated demo: `demo/vantage-integrated-mvp` at `7bf2f201`.
- Joseph integration: `feat/vantage-joseph-integration` at `301dcfc9`.

The leader cherry-picked Sophia's delivery as `71368530`. Her production
retrieval files are unchanged there; `pending-history.test.ts` adds protection
against treating historical questions as proof of current open work. The local
checkout remains on the Sophia branch; the downloaded leader branches were read
without merging or checking them out.

## Audit and solution

| Finding | Evidence | Sophia solution / remaining dependency |
| --- | --- | --- |
| The integrated experiment ranks a supplied catalog, without a production RAG connection. | Leader `sophia-composition-v0.ts` calls `runDynamicContextV0` with fixture metadata and optional injected search. | Added `createAuthorizedRagSearchV0`, an opt-in adapter for the existing `RagPort`; TL must supply authoritative bindings and fresh authorization. |
| Existing retrieval is reusable; a new vector index is unnecessary. | `apps/web/src/server/rag/port.ts` wraps the configured ensemble; BM25/vector results carry native document/version IDs. | Reuse that port; require exact native version matches and explicit document-only scope. Never use the permissive empty-context fallback helper. |
| Current search indexes select current document versions, not arbitrary historical versions. | BM25 and vector SQL join `document.currentVersionId`. | Reject mismatched versions. Use the host's version-event feed for the recent lane and exact-as-of open metadata to retain older work. Historical discovery outside that supplied feed is not solved by this adapter. |
| Source/top-k caps are not corpus or provider-cost caps. | `getCompanyChunks` in `packages/retrieval/src/algorithms/bm25/bm25.ts` loads all permitted current chunks. `RagPort` has no cancellation parameter. | Adapter bounds bindings, result count, query size and caller latency. Before live activation, the host must enforce indexed chunk/byte limits, and retrieval owners must supply backend cancellation or statement timeouts. |
| Loose selection retained irrelevant recent and older resolved documents. | Leader's October 25 integration report and the existing synthetic fixture. | Added opt-in `selectionPolicy: "focused"`, with explicit exclusion diagnostics. Broad behavior remains the default for compatibility. |
| Joseph-enabled generation is blocked by profile review semantics. | Joseph provider accepts `reviewed` / `unknowns-marked`; actual company adapter returns `unreviewed`. | TL/Joseph decision. Sophia must preserve the block; retrieval cannot manufacture approval or substitute required context. |

## Implemented behavior

The new document adapter accepts at most 128 explicit native bindings. Each
binding connects a canonical source ref to one native document/version pair and
server-owned metadata. Duplicate document or source bindings are rejected.
Native IDs are never guessed from citation strings.

For the role lane it issues at most one combined multi-role query to the existing
RAG port. The query is limited to 2,048 characters, with a default maximum of 40
results (configurable to 200). Both the search scope and document filter name the
explicit currently authorized document IDs. Empty scope never becomes a
company-wide query. Backend titles, excerpts, timestamps and scores are not
promoted into authoritative context: only a matching exact document/version hit
selects the corresponding trusted metadata. The existing deterministic relevance
ranking still decides inclusion; this is not a new semantic reranker.

The recent lane uses the supplied version-event timestamps, with the existing
half-open reporting window and as-of cutoff. It does not spend a second embedding
call. Explicit as-of open records supplement role top-k results; an old question
or absence of a completion record is never interpreted as open state.

Membership/document authorization is checked before and after each nonempty lane.
A different actor/company/ACL digest aborts the operation. Revoked documents are
removed. Missing-version, foreign, conflicting or stale hits produce partial
coverage without logging provider text or unauthorized IDs. A saturated top-k is
conservatively reported as truncated. Unsupported native evidence/observation/
commitment sources and documents without bindings also report incomplete coverage;
this document adapter must not silently claim to cover the whole source catalog.

The focused policy omits unrelated recent records and explicitly resolved records
older than the reporting window. It retains relevant recent resolutions, relevant
older unknown-status material, conflicting evidence and explicit older open work.
It does not filter mandatory company context or personal stars: their capacity
reservation precedes optional retrieval. Policy exclusions appear under
`diagnostics.excluded`; deliberate filtering does not itself imply a failed search.

## Host integration example

```ts
import {
    createAuthorizedRagSearchV0,
    runDynamicContextV0,
} from "@launchstack/pipelines/vantage/context-v0";

// All values below come from authenticated server code, never request-body scope.
const search = createAuthorizedRagSearchV0({
    actor: authorizedActor,
    bindings: nativeDocumentBindings,
    rag: configuredAppRagPort,
    authorizeDocuments: recheckCurrentDocumentAccessAndCorpusLimits,
    maxResults: 40,
    timeoutMs: 5000,
});
const prepared = await runDynamicContextV0(input, authoritativePorts, {
    retrieval: { search, selectionPolicy: "focused" },
});
```

`authorizeDocuments` returns the current authenticated actor (including ACL digest)
and the readable subset of requested native IDs. Reuse the app's membership,
`documents.read`, `resolveDocumentScope` and `scopedDocumentWhere` logic. The
existing `validateDocumentAccess` is a useful starting point, but does not itself
produce the TL actor digest or enforce corpus limits. Copying the input actor into
the response without a real authorization check is not a production implementation.

The TL source host must bound and authorize catalog acquisition before calling this
adapter, bind metadata to exact versions, supply `changedAt` and historical state,
and implement companion retrieval for non-document native sources when present.
Required company context and stars remain on their separate required-context path.
The TL's final source/version/ACL and commit guards remain mandatory: this adapter's
checks do not lock sources through generation or persistence.

Do not advertise the two lane operations as total SQL, embedding, model or token
cost. Each lane can perform two authorization callbacks; ensemble legs have their
own work. Timeout stops waiting and prevents late output/authorization steps, but
cannot cancel an underlying RAG operation that ignores cancellation. Actual provider
usage must be measured by the host before production acceptance.

## This week's proposed work and ownership

| Priority | Work | State / owner |
| --- | --- | --- |
| 1 | Reuse audit, bounded RAG adapter, exact-version/ACL regression cases | Implemented locally by Sophia; host wiring remains joint with TL. |
| 2 | Focused selection and reproducible before/after comparison | Implemented as an opt-in policy; evaluate on additional companies/weeks before making it the default. |
| 3 | Bind actual authorized document/version feeds and measure corpus/query/latency limits | Sophia + TL integration session; requires TL's authoritative source and current-state adapters. |
| 4 | Run isolated PostgreSQL/API acceptance with actual search wiring | TL owns environment/final acceptance; Sophia supplies retrieval test cases. |
| 5 | Reviewable handoff with exact commits, results and limitations | This note, exports, tests and Changeset; no remote publication performed. |

The independent unit-level handoff is complete when focused tests, pipeline
typechecking, scoped lint and the offline demos pass. Integrated retrieval is done
only after real source acquisition, access revocation, version changes, old-open
coverage, corpus bounds and measured latency are demonstrated in the isolated host.
Joseph generation may remain blocked independently until its review policy is
resolved. Public-web activation, final report prompts, role/star persistence,
production writes and deployment are outside Sophia's changes here.

## Validation

Observed locally on November 1:

- Vantage pipeline suite: **196 passed, 23 database tests skipped**; no isolated
  database was configured. The focused retrieval/context subset accounts for 114
  of the passing tests, including 24 added cases.
- Pipeline TypeScript: passed. Scoped ESLint: passed, with the existing root
  React/Next configuration notices. All six existing offline demos passed.
- `git diff --check`: passed. The tracked-file patch passed an apply check against
  `origin/feat/vantage-joseph-integration` using a temporary index; the four new
  paths are absent from that branch. This is patch compatibility, not execution
  of the leader's integrated application.
- Changes remain local and uncommitted. No branch switch, merge, push, migration,
  production activation or live provider call occurred.

Run from the repository root with the existing dependencies:

```sh
pnpm --filter @launchstack/pipelines test:retrieval
pnpm --filter @launchstack/pipelines typecheck
pnpm --filter @launchstack/pipelines demo:retrieval
pnpm exec eslint pipelines/src/vantage/dynamic-retrieval
```

The focused-selection regression compares the same four-source, two-role fixture:
broad selection returns four sources; focused selection returns the explicit old
open blocker and relevant current update, excluding the irrelevant recent item and
explicitly resolved old item. It asserts reduced context bytes without changing
source text. This synthetic result is not evidence of improved generated-report
quality across real companies.

The adapter tests use a mocked RAG backend and authorization callbacks. They cover
explicit scope, a combined multi-role query, version mismatch, missing versions,
foreign IDs, conflicting ID fields, revocation during search, actor/digest mismatch,
truncation, duplicate chunks, unsupported sources, historical state, time windows,
oversized output, timeout and cancellation. Existing public-query isolation and
required-context reservation tests are retained. No live embeddings, public search,
database, browser or production model was exercised in this local handoff.
