# services/adeu-ai-docs-editing

The authoritative Word-editing service (ADR-004, renamed and re-scoped in
[ADR-007](../../docs/architecture/ADR-007-adeu-docs-editing-service.md)).
FastAPI over the [`adeu`](https://pypi.org/project/adeu/) redlining engine —
MIT, © 2026 Dealfluence Oy — pinned at `2.4.1`.

It writes real OOXML revision markup: an edit applied here opens in Microsoft
Word as a tracked change attributed to an author, individually acceptable or
rejectable, with formatting, numbering, and comment anchors intact. That is the
thing `mammoth` (read-only, lossy) and `docxtemplater` (fills a template)
cannot do.

## Routes

All require `X-API-Key` and fail closed. `/health` does not.

| Route | Purpose |
| --- | --- |
| `POST /adeu/read` | Document text as CriticMarkup, or the accepted ("clean") view. |
| `POST /adeu/review-items` | **Every tracked change and comment as data** — id, kind, author, date, text, anchor, pairing. |
| `POST /adeu/process-batch` | Apply edits and/or review actions in one pass, with a per-edit report. |
| `POST /adeu/accept-all` | Accept every revision; `remove_comments` defaults to `true`. |
| `POST /adeu/reject-all` | Reject every revision, restoring the original text. |
| `POST /adeu/apply-edits-markdown` | Preview proposed edits as CriticMarkup, without touching the file. |
| `POST /adeu/diff` | Compare two documents. |
| `GET /health` | Unauthenticated; reports adeu availability and version. |

### Why `review-items` exists

Review actions address changes by ids like `Chg:12`, but adeu only emits those
ids *inside* its CriticMarkup output — which is how its CLI and MCP server are
meant to consume them. A UI needs them as objects. `app/critic.py` is that
translation, and the only place in the service that knows the markup grammar.

A replacement is reported as a `delete`/`insert` pair via `paired_with`:
resolving either resolves both, so a reviewer must be shown one decision, not
two.

### Per-edit reporting

`process-batch` returns the document with counts in `X-Batch-Summary`. Send
`Accept: application/json` to get the document base64'd alongside the full
report instead — which edit applied, which did not, and why. Aggregate counts
cannot express that, and a per-edit array does not belong in a header.

`partial: true` applies what validates and reports the rest. The default is
all-or-nothing: a batch that cannot apply everything returns `422` with the
reasons.

## Input

Upload a file part, **or** pass an object reference:

```json
{ "source": { "url": "http://app:3000/api/files/123", "filename": "nda.docx" } }
```

References are guarded by `ALLOWED_FETCH_ORIGINS` — http(s) only, origin must
be allow-listed, redirects refused, size-capped, timed out — the same rules
`services/document-converter` enforces (ADR-004 §6). Unset means references are
disabled, not that everything is permitted.

## Configuration

| Variable | Notes |
| --- | --- |
| `ADEU_SERVICE_API_KEY` | Required. `DOCUMENT_EDITOR_API_KEY` / `SIDECAR_API_KEY` are deprecated fallbacks. |
| `ALLOWED_FETCH_ORIGINS` | Comma-separated origins for object references. Unset disables them. |
| `MAX_FETCH_BYTES` | Default 50 MB, matching the upload limit. |
| `FETCH_TIMEOUT_SECONDS` | Default 30. |

The app reaches the service at `ADEU_SERVICE_URL` (`DOCUMENT_EDITOR_URL` is a
deprecated fallback).

## Upgrading adeu

Two things to check against a new release, both of which have bitten already:

1. **`accept_all_revisions()`** changed its `remove_comments` default to
   `False` at 2.4. This service passes `True` explicitly to preserve its
   behaviour; a future change would be silent otherwise.
2. **The CriticMarkup grammar.** `tests/test_critic.py` pins the metadata block
   format (`[Chg:N insert] Author (pairs with M)`, `[Com:N] Author @ date: body`)
   as unit tests, so a format change fails loudly there instead of quietly
   producing an empty review pane.

## Tests

```sh
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests -q
```

`tests/test_contract.py` validates the wire models against the JSON Schemas
generated from `packages/protocol`. Those schema files keep their
`document-editor.*` names: they are versioned wire identifiers, not directory
names, and renaming them would break the frozen v1 contract.
