import type { AIModelType } from "@launchstack/core/llm";

/** Per-stage model config for the email pipeline (swap here to change models). */
export const EMAIL_MODELS = {
  templateGeneration: "gpt-4o" as AIModelType,
  templateReview: "gpt-4o" as AIModelType,
} as const;

/** Bump when generation/review prompts change — recorded per campaign. */
export const EMAIL_PROMPT_VERSION = "2026-08-01.1";
