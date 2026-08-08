/**
 * Shared provider-neutral structured response entry point for the email
 * pipeline.
 *
 * Callers ask for a *route* (the kind of job) and the operator's configuration
 * decides which model serves it — the pipeline never names a vendor model.
 */

import type { BaseMessageLike } from "@langchain/core/messages";
import {
  invokeStructured,
  resolveChatModel,
  type ChatRoute,
} from "@launchstack/core/llm";
import type { z } from "zod";

/**
 * Per-stage routes. Generation wants a capable model; review is a short,
 * mechanical scoring pass that a cheaper route handles fine.
 */
export const EMAIL_ROUTES = {
  templateGeneration: "default" satisfies ChatRoute,
  templateReview: "fast" satisfies ChatRoute,
} as const;

/** Bump when generation/review prompts change — recorded per template version. */
export const EMAIL_PROMPT_VERSION = "2026-08-01.1";

export async function invokeEmailStructured<T>(
  route: ChatRoute,
  schema: z.ZodType<T>,
  messages: readonly BaseMessageLike[],
  name: string,
): Promise<T> {
  return invokeStructured(resolveChatModel({ route }), schema, messages, {
    name,
  });
}

/** Records which route produced a version, for reproducibility. */
export function routeLabel(route: ChatRoute): string {
  return `route:${route}`;
}
