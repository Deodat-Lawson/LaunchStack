/**
 * Compatibility entry point for schema-producing application pipelines.
 * Route resolution and the structured-output mechanism live in core.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured } from "@launchstack/llm";
import { resolveConfiguredChatModel } from "~/lib/models";
import type { GenerateStructuredInput } from "./types";

/**
 * Run a structured JSON-output LLM call on the operator's `fast` route.
 *
 * The return type is inferred from the passed-in Zod schema, so the call
 * site gets full type safety without an explicit type argument:
 *
 *   const result = await generateStructured({
 *     capability: "smallExtraction",
 *     system: SYSTEM_PROMPT,
 *     prompt: buildPrompt(docText),
 *     schema: MySchema,
 *   });
 *   // result is inferred as z.infer<typeof MySchema>
 *
 * Whether the model has native structured output or falls back to strict
 * JSON prompting is decided by its declared behavior, not by this call site.
 *
 * On endpoint error (network, rate limit, unrepairable JSON) this throws.
 * Call sites that want graceful degradation should wrap in try/catch —
 * matching the existing pattern in metadata extraction where a failed batch
 * is logged and the overall pipeline continues with the successful batches.
 */
export async function generateStructured<TOutput>(
    input: GenerateStructuredInput<TOutput>
): Promise<TOutput> {
    const resolved = resolveConfiguredChatModel({ route: "fast" });

    // Diagnostic logging: capture the chosen model, prompt size, and
    // wall-clock duration for every call. This is intentionally verbose in
    // dev so slowness in any specific capability surfaces in the console.
    // If this becomes noisy in production, gate it behind an env flag.
    const promptChars = (input.system?.length ?? 0) + input.prompt.length;
    const startedAt = Date.now();
    console.log(
        `[llm] generateStructured start capability=${input.capability} ` +
            `route=${resolved.route} model=${resolved.modelId} ` +
            `prompt=${promptChars} chars`
    );

    try {
        const messages = [
            ...(input.system ? [new SystemMessage(input.system)] : []),
            new HumanMessage(input.prompt),
        ];
        const result = await invokeStructured(resolved, input.schema, messages, {
            name: input.schemaName ?? "structured_response",
        });

        console.log(
            `[llm] generateStructured ok  capability=${input.capability} ` +
                `route=${resolved.route} model=${resolved.modelId} ` +
                `${Date.now() - startedAt}ms`
        );

        return result;
    } catch (err) {
        console.error(
            `[llm] generateStructured FAIL capability=${input.capability} ` +
                `route=${resolved.route} model=${resolved.modelId} ` +
                `${Date.now() - startedAt}ms err=${err instanceof Error ? err.message : String(err)}`
        );
        throw err;
    }
}
