# ADR-009: Gotenberg Renders PDFs

**Status:** Accepted
**Date:** 2026-08-29
**Deciders:** Repository maintainers

## Context

The product generates and edits Word documents (docxtemplater templates,
the adeu tracked-changes editor per ADR-007) but could not produce a real
PDF from any of them. The only PDF writer in the repository was
`api/document-generator/export`, which flattened markdown to plain text and
drew it line by line with pdf-lib in Times Roman — no headings, no tables,
no styling, and no way at all to turn a DOCX into a PDF. Meanwhile every
document a user touches ends life as "send me the PDF".

Building this in-process was rejected twice over:

1. **Faithful DOCX → PDF requires a layout engine.** Reimplementing Word
   pagination is not a feature, it is a product. LibreOffice is the only
   maintained open-source engine that does it acceptably.
2. **Faithful HTML → PDF requires a browser.** Print-CSS support in
   pure-JS PDF writers is a fraction of Chromium's.

Both engines are heavyweight native processes — exactly what ADR-004 moved
out of the app into single-owner compute services. The popular npm/Python
shortcuts were rejected on license: `pdf2docx`-style tooling depends on
PyMuPDF (AGPL-3.0), which is not compatible with shipping a closed SaaS.

## Decision

**Deploy [Gotenberg](https://gotenberg.dev) (`gotenberg/gotenberg:8`, MIT)
as a Compose service** — LibreOffice and Chromium behind one multipart HTTP
API. Like `docling-serve`, it is an off-the-shelf image, so there is no
`services/` directory: the deployment unit is the Compose entry.

**One brick owns the wire: `packages/rendering`** (`@launchstack/rendering`),
the typed client — `officeToPdf` (LibreOffice), `htmlToPdf` /
`markdownToPdf` (Chromium), `health`, and typed errors carrying Gotenberg's
trace id. Unlike the adeu client it reads **no environment**: connection
settings are injected by the composition root
(`apps/web/src/server/rendering.ts`), which is the ADR-008 rule with zero
exceptions this time.

**Security follows the ADR-004 service contract, translated:**

- Auth fails closed. Gotenberg ships basic auth rather than X-API-Key, so
  the service runs with `--api-enable-basic-auth` and a local-default
  password (`pdr_local_gotenberg_key`) that production overrides.
- SSRF is denied at the service. The other services guard object fetches
  with `ALLOWED_FETCH_ORIGINS`; here the equivalent surface is Chromium
  fetching subresources out of user HTML, so the Compose entry sets a
  `--chromium-deny-list` covering loopback, RFC-1918/link-local ranges, and
  every Compose service name (and re-states Gotenberg's own `file:` default,
  which overriding the flag would otherwise drop).
- JavaScript is off (`--chromium-disable-javascript`): nothing the product
  renders needs it, and user HTML must not get a scripting engine.

**Three call sites, each degrading differently by design:**

| Caller                                                    | Path                                      | Without Gotenberg                                                                   |
| --------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/documents/pdf?documentId=`                      | DOCX and friends → LibreOffice → download | typed 503; DOCX download unaffected                                                 |
| `api/document-generator/export` (`format: "pdf"`)         | the export's own styled HTML → Chromium   | falls back to the old pdf-lib text rendering                                        |
| `api/document-generator/legal-generate` (`format: "pdf"`) | generated DOCX → LibreOffice              | typed 503 — a legal document with approximated layout is worse than an honest error |

The documents route follows the adeu routes' shape: `documentId` in,
company scope enforced in SQL, foreign and missing documents
indistinguishable, service 4xx relayed, service 5xx an opaque 502.

## Consequences

- `make up` now starts one more container (~130MB image; Chromium and
  LibreOffice start on demand, so idle cost is small). Port 8004 on the
  host for `pnpm dev` against the Docker backend.
- The export route's HTML and PDF outputs can no longer drift: both render
  `buildHtmlDocument`.
- The old pdf-lib renderer survives as the export fallback only. New PDF
  features must target the service, not extend it.
- `@launchstack/rendering` joins the published set and the lint boundary
  table (imports nothing, nothing below pipelines/apps imports it).
- PDF → DOCX (the opposite direction) is deliberately out of scope:
  LibreOffice's PDF import is line-per-paragraph noise. The credible path
  is docling's structured output re-serialized as DOCX, which would belong
  to `services/document-converter`, not here.

### Still open

- The worker inherits the `GOTENBERG_*` variables through the shared env
  but has no rendering call sites yet; batch/export jobs would need their
  own timeout budget.
- `docker-compose.ci.yml`'s smoke does not exercise the service — the
  package's vitest suite and the web routes' Jest suite cover the client
  and the degradation paths instead.
