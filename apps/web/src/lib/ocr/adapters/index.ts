/**
 * OCR Adapters Index — all four adapters (Azure, Landing.AI, Datalab,
 * Docling) now live in @launchstack/core. Re-exported here so the
 * processor's `import { … } from "./adapters"` keeps working.
 * (createMarkerAdapter was removed by ADR-004 — it silently aliased Docling.)
 */

export { createAzureAdapter } from "@launchstack/core/ocr/adapters/azureAdapter";
export { createLandingAIAdapter } from "@launchstack/core/ocr/adapters/landingAdapter";
export { createDatalabAdapter } from "@launchstack/core/ocr/adapters/datalabAdapter";
export { createDoclingAdapter } from "@launchstack/core/ocr/adapters/ossAdapter";
