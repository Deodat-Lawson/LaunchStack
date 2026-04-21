/**
 * Per-stage chat-model config for the marketing pipeline. Swap these to
 * change which model runs DNA extraction vs. content generation vs. claim
 * verification, etc. Feature code imports MARKETING_MODELS and hands each
 * value to getChatModelByType from @launchstack/core/llm.
 */

import type { AIModelType } from "@launchstack/core/llm";

export const MARKETING_MODELS = {
  dnaExtraction: "gpt-5-nano" as AIModelType,
  competitorAnalysis: "gpt-5-nano" as AIModelType,
  strategyBuilding: "gpt-5-nano" as AIModelType,
  contentGeneration: "gpt-4o" as AIModelType,
  claimVerification: "gpt-5-nano" as AIModelType,
  refinement: "gpt-4o" as AIModelType,
} as const;
