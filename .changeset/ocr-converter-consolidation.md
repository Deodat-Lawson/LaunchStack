---
"@launchstack/core": minor
---

Migrate the OCR caller surface from the removed `services/ocr-router` +
`services/ocr-worker` to the consolidated `services/document-converter`
(ADR-004). Breaking for the 0.x OCR surface.

**Removed**

- The `"MARKER"` provider name, from both `OCRProvider`
  (`@launchstack/core/ocr/types`) and `OcrProviderName`
  (`@launchstack/core/config`). It never had a real implementation — it
  silently aliased Docling. Use `"DOCLING"`; configuring
  `OCR_DEFAULT_PROVIDER=MARKER` now fails validation with a message naming
  `DOCLING`.
- `createMarkerAdapter` and `processWithMarker` (aliases for the Docling
  path).
- `buildRouterEnv` and all per-request env/credential forwarding to the OCR
  router. The converter reads its own vision configuration at startup; the
  request-body `env` map (a documented `process.env` mutation race carrying
  live secrets) is gone and must not return.
- `RoutingDecision.confidence` and `RouterDecisionResult.confidence`. The
  0.99/0.95/0.5/1.0 values were fabricated constants, never model output.
  Routing now carries an enumerated `reason` plus `signals` holding real
  measurements only (`visionLabel`, `visionScore`, `hasInteractiveForm`,
  `textSampleChars`).

**Changed**

- `determineDocumentRouting` calls `POST {converter.url}/route` with the
  frozen `RouteRequest` wire contract (schemaVersion 1) and `X-API-Key`
  auth; `renderPagesToImages` calls `POST /render-pages` the same way
  (still takes 1-based page numbers; converts to the contract's 0-based
  `pageIndices`). Local fallback when the converter is unreachable keeps the
  default-provider decision with the honest reason `"vision-unavailable"`
  and no invented confidence.
- The Docling adapter (`createDoclingAdapter`) calls `POST /convert` and
  consumes the typed `EvidenceDocument`: page text/blocks become
  `textBlocks`, `"table"` layout blocks are parsed from markdown into the
  `ExtractedTable` rows downstream chunking reads.
- `metadata.confidenceScore` is now provider-reported `[0,1]` or absent —
  the fabricated 92/95/90/100 constants are removed, and Azure's measured
  word confidence is kept on its native `[0,1]` scale. The VLM-enrichment
  trigger is honest: vision-label based and/or
  `confidence !== undefined && confidence < 0.7` (the old `< 70` branch was
  dead against a fabricated 92). The integer-percent DB columns keep their
  0-100 scale via conversion at the storage boundary.
- `DoclingIngestionAdapter.canHandle` gates on `ocr.converter` presence
  instead of the removed `workerUrl`.

**Deprecated**

- `OcrConfig.workerUrl`, `OcrConfig.routerUrl`, and `OcrConfig.vision` are
  ignored at runtime with a startup warning. Configure
  `ocr.converter: { url, apiKey }` (env: `DOCUMENT_CONVERTER_URL`,
  `DOCUMENT_CONVERTER_API_KEY`) instead. Hosts may fall back to a legacy
  router URL for `converter.url`, but the API key has no fallback — the
  converter's auth fails closed.
