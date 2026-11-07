# @launchstack/document-conversion-engine

## 0.2.0

### Minor Changes

- 10eb214: New package (ADR-009): the typed client for the Gotenberg document-rendering
  service — `officeToPdf` (DOCX and friends through LibreOffice), `htmlToPdf`
  and `markdownToPdf` (through Chromium), `health`, and typed errors carrying
  Gotenberg's trace id. Reads no environment; connection settings are injected
  by the composition root.
