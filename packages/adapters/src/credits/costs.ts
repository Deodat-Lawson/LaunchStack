/**
 * Token cost constants and calculators.
 * All costs expressed in token equivalents.
 *
 * Policy choice — hosts that want different pricing should implement their
 * own CreditsPort and compute costs themselves before calling
 * creditsDebitSafe. These defaults exist so the built-in ingestion and
 * transcription pipelines have a usable cost model out of the box.
 */

import type { TokenService } from "./types";

/** Default token costs per operation unit. */
export const TOKEN_COSTS = {
  /** Per actual token embedded (1:1) */
  embedding: 1,
  /** Per rerank query (~200 tokens avg) */
  rerank: 200,
  /** Per chunk of NER extraction (~500 tokens in+out) */
  ner: 500,
  /** Per minute of audio transcription */
  transcription: 5_000,
  /** Per page of Azure Document Intelligence OCR */
  ocr_azure: 15_000,
  /** Per page of LandingAI OCR */
  ocr_landingai: 8_000,
  /** Per page of Datalab/Marker OCR */
  ocr_datalab: 8_000,
  /** Native PDF extraction (no external API) */
  ocr_native: 0,
  /** Per actual LLM token (prompt + completion, 1:1) */
  llm_chat: 1,
} as const satisfies Record<TokenService, number>;

/** Calculate embedding token cost from actual token count */
export function embeddingTokens(totalTokens: number): number {
  return Math.max(1, totalTokens) * TOKEN_COSTS.embedding;
}

/** Calculate LLM chat token cost from prompt + completion tokens */
export function llmChatTokens(
  promptTokens: number,
  completionTokens: number,
): number {
  return (promptTokens + completionTokens) * TOKEN_COSTS.llm_chat;
}

/** Calculate transcription tokens from audio duration in seconds */
export function transcriptionTokens(durationSeconds: number): number {
  const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
  return minutes * TOKEN_COSTS.transcription;
}

/** Estimate transcription tokens from file size (~1MB/min for MP3) */
export function estimateTranscriptionTokens(fileSizeBytes: number): number {
  const estimatedMinutes = Math.max(1, Math.ceil(fileSizeBytes / (1024 * 1024)));
  return estimatedMinutes * TOKEN_COSTS.transcription;
}

/** Calculate OCR tokens from page count and provider */
export function ocrTokens(
  pageCount: number,
  provider: "azure" | "landingai" | "datalab" | "native",
): number {
  const key = `ocr_${provider}` as TokenService;
  return pageCount * TOKEN_COSTS[key];
}

/** Map OCR provider names to token cost keys */
export function ocrProviderToTokenKey(
  provider: string,
): "azure" | "landingai" | "datalab" | "native" {
  const normalized = provider.toLowerCase();
  if (normalized.includes("azure")) return "azure";
  if (normalized.includes("landing")) return "landingai";
  if (normalized.includes("datalab") || normalized.includes("marker"))
    return "datalab";
  return "native";
}
