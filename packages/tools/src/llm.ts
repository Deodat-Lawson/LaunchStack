/**
 * Shared structured-LLM entry for tools. Each tool declares its own MODELS
 * table (`satisfies Record<string, ResolveChatModelOptions>` — the
 * email-pipeline pattern) and calls this with one of its entries, so the
 * route/temperature policy stays visible per stage and the concrete model id
 * comes back for provenance.
 */

import type { BaseMessageLike } from "@langchain/core/messages";
import {
    invokeStructured,
    resolveChatModel,
    type ResolveChatModelOptions,
} from "@launchstack/llm";
import type { z } from "zod";

export async function invokeToolStructured<T>(
    options: ResolveChatModelOptions,
    schema: z.ZodType<T>,
    messages: readonly BaseMessageLike[],
    name: string
): Promise<{ result: T; modelId: string }> {
    const resolved = resolveChatModel(options);
    const result = await invokeStructured(resolved, schema, messages, { name });
    return { result, modelId: resolved.modelId };
}
