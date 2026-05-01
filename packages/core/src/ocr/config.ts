/**
 * Shared OCR configuration. Captures the OcrConfig slice that adapters,
 * the complexity router, and the VLM enrichment path all need. Registered
 * by the hosting app via configureOcr(config.ocr).
 */

import type { OcrConfig } from "../config/types";
import { createSlot } from "../internal/slot";

const configSlot = createSlot<OcrConfig>("ocr/config");

export function configureOcr(config: OcrConfig): void {
  configSlot.set(config);
}

export function getOcrConfig(): OcrConfig {
  return configSlot.get() ?? {};
}
