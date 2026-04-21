/**
 * OCR Adapters Index — all four adapters (Azure, Landing.AI, Datalab,
 * Marker/Docling) now live in @launchstack/core. Re-exported here so the
 * processor's `import { … } from "./adapters"` keeps working.
 */

export { createAzureAdapter } from "@launchstack/core/ocr/adapters/azureAdapter";
export { createLandingAIAdapter } from "@launchstack/core/ocr/adapters/landingAdapter";
export { createDatalabAdapter } from "@launchstack/core/ocr/adapters/datalabAdapter";
export { createMarkerAdapter, createDoclingAdapter } from "@launchstack/core/ocr/adapters/ossAdapter";
