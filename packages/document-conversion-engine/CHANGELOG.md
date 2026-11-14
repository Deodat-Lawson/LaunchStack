# @launchstack/document-conversion-engine

## 0.2.0

### Minor Changes

- 38d39fb: `htmlToScreenshot` takes a picture of a complete HTML document through
  Gotenberg's Chromium (`/forms/chromium/screenshot/html`): the whole page by
  default, at the window size you give, as PNG, JPEG or WebP. It returns the
  image bytes, their content type and Gotenberg's trace id. The shot is taken
  after the load event plus `waitDelay`; waiting for the network to go idle is
  off, so analytics beacons and long polls can't hold a request until it times
  out.
- 10eb214: New package (ADR-009): the typed client for the Gotenberg document-rendering
  service — `officeToPdf` (DOCX and friends through LibreOffice), `htmlToPdf`
  and `markdownToPdf` (through Chromium), `health`, and typed errors carrying
  Gotenberg's trace id. Reads no environment; connection settings are injected
  by the composition root.
