/**
 * Shared OCR configuration. Captures the OcrConfig slice that adapters,
 * the complexity router, and the VLM enrichment path all need. Registered
 * by createEngine (indirectly — apps/web/src/server/engine.ts calls
 * configureOcr alongside configureOcrRouter).
 */

import type { OcrConfig } from "../config/types";

let _config: OcrConfig | null = null;

export function configureOcr(config: OcrConfig): void {
  _config = config;
}

export function getOcrConfig(): OcrConfig {
  return _config ?? {};
}
