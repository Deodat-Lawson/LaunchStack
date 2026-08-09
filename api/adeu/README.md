# api/adeu — DEPRECATED

**The authoritative DOCX-editing (Adeu) service is
[`services/document-editor`](../../services/document-editor/)** (see
[ADR-004 §4](../../docs/architecture/ADR-004-compute-service-consolidation.md)).

This directory is a Vercel-style Python serverless duplicate of the five
`/adeu/*` endpoints. It is retained — deprecated but tested — because its
authors have not signed off on removal (REPOSITORY.md open question). Do not
extend it; new functionality belongs in `services/document-editor`.

Status:

- **Not referenced** by any caller in this repository and **not deployed**
  (there is no `vercel.json`).
- **No authentication** — unlike `services/document-editor`, which requires
  `X-API-Key` (fail-closed). If this file were ever deployed as-is, all five
  ADEU operations would be public.
- Shares its request/response models with the document-editor service via a
  `sys.path` import of `services/document-editor/app/schemas/adeu.py`, so the
  wire shapes cannot drift from the authoritative service.

Tests: `tests/` pins the handler's behavior (all five routes, error shapes,
the 50 MB pre-check, and the schema import wiring). Run them with the
document-editor's dev dependencies installed:

```sh
cd api/adeu
python -m pytest tests/
```
