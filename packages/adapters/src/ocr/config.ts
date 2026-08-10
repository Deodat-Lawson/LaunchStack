/**
 * Shared OCR configuration. Captures the OcrConfig slice that adapters,
 * the complexity router, and the VLM enrichment path all need. Registered
 * by the hosting app via configureOcr(config.ocr).
 */

import type { OcrConfig } from "../config/types";
import { createSlot } from "../internal/slot";

const configSlot = createSlot<OcrConfig>("ocr/config");

export function configureOcr(config: OcrConfig): void {
  const deprecated: string[] = [];
  if (config.workerUrl) deprecated.push("workerUrl");
  if (config.routerUrl) deprecated.push("routerUrl");
  if (config.vision && Object.values(config.vision).some(Boolean)) {
    deprecated.push("vision");
  }
  if (deprecated.length > 0) {
    console.warn(
      `[OCR] Ignoring deprecated OcrConfig field(s): ${deprecated.join(", ")}. ` +
        "The ocr-router/ocr-worker services were removed by ADR-004; " +
        "configure ocr.converter ({ url, apiKey }) to reach services/document-converter."
    );
  }
  configSlot.set(config);
}

export function getOcrConfig(): OcrConfig {
  return configSlot.get() ?? {};
}
