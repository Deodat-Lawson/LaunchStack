# ADR-007: The Adeu Docs-Editing Service Owns Document Editing

**Status:** Accepted
**Date:** 2026-08-22
**Deciders:** Repository maintainers
**Supersedes:** ADR-004 §4 (the `api/adeu` retention decision)

## Context

ADR-004 named `services/document-editor` the authoritative DOCX-editing
service and kept `api/adeu` as a deprecated, tested duplicate pending its
authors' sign-off. Tracing the product's actual Word-document workflow end to
end surfaced four problems that the earlier decision did not anticipate.

**1. The service was a library proxy, not a service.** Each of its five routes
mapped to exactly one `adeu` call. Holding no logic of its own, it forced every
caller to assemble the workflow — and `apps/web` did, in the wrong places:
target disambiguation (`tryDisambiguate`) and raw OOXML string surgery
(`cleanupRemainingTokens`) lived in a Next.js route handler, and sentinel-token
minting lived in a React component.

**2. Half its API was uncallable.** Review actions address changes by ids like
`Chg:12`, but no route enumerated them — the ids exist only inside adeu's
CriticMarkup output. `ACCEPT` / `REJECT` / `REPLY` could not be driven from a
UI at all. A repo-wide search found those ids only as hardcoded test literals.

**3. A legal-review endpoint lied on failure.** `/api/legal/apply-edits`
applied edits one at a time — two full-document round trips per edit — inside a
`try/catch` that swallowed *every* error, including "service unreachable". Any
failure fell through to plain-string replacement in the document XML, producing
a document with **no tracked changes**, and returned `200 success`. In a flow
whose purpose is showing a lawyer what an AI proposed, that is the worst
available outcome.

**4. Nothing could hand it a real user document.** The redline UI required a
`templateId` resolvable in `TEMPLATE_REGISTRY` and was rendered only by the
template generator, so an uploaded `.docx` could never reach it. The Inngest
`modifyDocument` job was registered and subscribed to
`document/modify.requested`, which no production code ever sent. Uploaded
documents went down a separate, read-only path: mammoth to HTML to text to
embeddings, one-way and lossy.

Separately, `adeu` had moved from the pinned `0.9.0` to `2.4.1` — two majors,
~62 releases — and 2.4 added exactly the primitives the gaps called for:
`process_batch()` with per-edit reports and a `partial` mode,
`make_edits_self_contained()` for target resolution, `reject_all_revisions()`,
and `get_pending_revision_authors()`.

## Decision

1. **Rename to `services/adeu-ai-docs-editing`** and raise its altitude: it
   owns the whole editing workflow, not one library call per route.
   `ADEU_SERVICE_URL` / `ADEU_SERVICE_API_KEY` are canonical;
   `DOCUMENT_EDITOR_*` and `SIDECAR_API_KEY` remain deprecated fallbacks so
   existing deployments keep working.

2. **Upgrade to `adeu==2.4.1`.** One behaviour change needs an explicit opt-in:
   `accept_all_revisions()` defaulted to removing comments before 2.4 and
   defaults to keeping them after, so the service passes `remove_comments=True`
   and exposes it as a request field.

3. **Add `POST /adeu/review-items`.** Returns every tracked change and comment
   as data — id, kind, author, date, text, anchor, and the id it pairs with —
   by parsing adeu's CriticMarkup in `app/critic.py`. This is what makes review
   actions addressable. A replacement's delete/insert pair is reported as such,
   because resolving either resolves both and a UI must present one decision.

4. **Per-edit reporting and partial application.** Batches go through
   `process_batch`; the report is returned intact. `Accept: application/json`
   returns the document inline with the full report, since per-edit detail
   outgrows an HTTP header. All-or-nothing remains the default; `partial: true`
   applies what validates and reports the rest.

5. **Target resolution moves into the service**, via
   `make_edits_self_contained()`, where the document is already parsed. N edits
   cost one round trip instead of 2N.

6. **Object references (closing the ADR-004 §6 gap).** The service now accepts
   `{source: {url}}` guarded by `ALLOWED_FETCH_ORIGINS` — http(s) only, no
   redirects, size-capped, timed out — mirroring `document-converter`'s rules.

7. **A real Word editor in `apps/web`.** `DocxEditor` renders the OOXML with
   `docx-preview` at Word's own page geometry and run formatting, alongside a
   review pane driven by `/adeu/review-items`. It replaces the mammoth-to-HTML
   viewer for any persisted `.docx`. New routes under
   `/api/documents/adeu/*` take a `documentId`, scope it to the caller's
   company, and never accept a client-supplied blob or URL.

8. **No silent fallback, ever.** The untracked string-substitution path is
   removed. If the service is unreachable the request fails and says so.

9. **`api/adeu` is deleted**, superseding ADR-004 §4. Its `sys.path` import of
   a sibling directory was never bundler-visible, so it would have failed on
   import in the one environment it existed for; there is no Vercel pipeline in
   this repository; and nothing referenced it. Its history remains in git.

## Consequences

- `DOCUMENT_EDITOR_URL` / `DOCUMENT_EDITOR_API_KEY` still work, with a single
  deprecation warning. Compose publishes the service as `adeu-docs-editing`.
- The `document-editor.*` JSON Schema names in `packages/protocol/schemas/v1/`
  are **unchanged**: they are versioned wire identifiers, not directory names,
  and renaming them would break the frozen v1 contract. New contracts
  (`batch-result`, `review-item`, `review-items-response`) join them.
- `apps/web` gains `docx-preview`. It is loaded through `next/dynamic` so only
  documents that are actually `.docx` pay for the bundle.
- Applying an edit writes a new object and repoints `document.url`, matching
  what `modifyDocument` already did; the previous bytes stay recoverable.
- `adeu` is MIT-licensed (© 2026 Dealfluence Oy) and compatible with this
  repository's Apache-2.0. It is redistributed inside the service's container
  image, so its notice belongs in a third-party attribution file — tracked
  separately from this ADR.

### Still open

- `document/modify.requested` has no producer. The Inngest path is left in
  place but remains unreachable until something emits it; the synchronous
  `/api/documents/adeu/apply` route is what the editor uses.
- The legacy `/api/legal/apply-edits` route and its template token flow are
  untouched by this ADR. They should migrate onto the batch API, which would
  retire the sentinel-token dance entirely.
