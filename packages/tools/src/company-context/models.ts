/**
 * Model policy for the company-context tool (design D3, mirroring
 * email-pipeline's per-stage table). Values freeze the behavior at extraction
 * time — every marketing stage ran route "fast" — so changing a route or
 * temperature is an explicit, reviewable edit here, never a side effect.
 */

import type { BaseMessageLike } from "@langchain/core/messages";
import {
    invokeStructured,
    resolveChatModel,
    type ResolveChatModelOptions,
} from "@launchstack/core/llm";
import type { z } from "zod";

export const COMPANY_CONTEXT_MODELS = {
    dnaSynthesis: { route: "fast" },
} as const satisfies Record<string, ResolveChatModelOptions>;

export async function invokeCompanyContextStructured<T>(
    stage: keyof typeof COMPANY_CONTEXT_MODELS,
    schema: z.ZodType<T>,
    messages: readonly BaseMessageLike[],
    name: string
): Promise<{ result: T; modelId: string }> {
    const resolved = resolveChatModel(COMPANY_CONTEXT_MODELS[stage]);
    const result = await invokeStructured(resolved, schema, messages, { name });
    return { result, modelId: resolved.modelId };
}
