/**
 * Public entry points for LLM generation.
 *
 * This is the ONLY file call sites should import from (via the barrel in
 * `index.ts`). It resolves a capability to a concrete model via `providers.ts`
 * and then delegates to Vercel AI SDK's `generateObject` (or similar) for
 * the actual call.
 *
 * For this first PR we expose just one function: `generateStructured`.
 * `generateText` / `streamText` / vision variants get added in follow-up PRs
 * as call sites need them.
 */

import { generateObject, zodSchema } from "ai";
import type { ZodType } from "zod";

import { resolveModel } from "./providers";
import type {
  GenerateStructuredInput,
  StructuredGenerationResult,
} from "./types";

/**
 * Run a structured JSON-output LLM call against whichever provider is
 * currently active for the given capability.
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
 * On provider error (network, rate limit, bad JSON) this throws. Call sites
 * that want graceful degradation should wrap in try/catch — matching the
 * existing pattern in metadata extraction where a failed batch is logged
 * and the overall pipeline continues with the successful batches.
 */
export async function generateStructured<TSchema extends ZodType>(
  input: GenerateStructuredInput<TSchema>,
): Promise<ReturnType<TSchema["parse"]>> {
  const result = await generateStructuredWithMetadata(input);
  return result.object;
}

/**
 * Structured generation plus the single resolved model's reproducibility
 * metadata. This is a companion API; generateStructured remains source and
 * behavior compatible for existing callers.
 */
export async function generateStructuredWithMetadata<TSchema extends ZodType>(
  input: GenerateStructuredInput<TSchema>,
): Promise<StructuredGenerationResult<ReturnType<TSchema["parse"]>>> {
  const resolved = resolveModel(input.capability, input.forceProvider);

  // Diagnostic logging: capture the chosen provider/model, prompt size, and
  // wall-clock duration for every call. This is intentionally verbose in
  // dev so slowness in any specific capability surfaces in the console.
  // If this becomes noisy in production, gate it behind an env flag.
  const promptChars =
    (input.system?.length ?? 0) + input.prompt.length;
  const startedAt = Date.now();
  console.log(
    `[llm] generateStructured start capability=${input.capability} ` +
      `provider=${resolved.provider} model=${resolved.modelId} ` +
      `prompt=${promptChars} chars`,
  );
  if (input.capability === "founderWeeklyReview") {
    console.log(`[llm] FWR generation phase=${input.generationPhase ?? "initial"} provider=${resolved.provider} model=${resolved.modelId} protocol=${resolved.structuredOutputMode === "json_object" ? "chat-completions" : "responses"}`);
  }

  try {
    const common = {
      model: resolved.model,
      ...(resolved.temperature === undefined ? {} : { temperature: resolved.temperature }),
      ...(input.maxOutputTokens !== undefined
        ? { maxOutputTokens: input.maxOutputTokens }
        : input.capability === "founderWeeklyReview" ? { maxOutputTokens: 1800 } : {}),
      ...((input.timeoutMs !== undefined || resolved.structuredOutputMode === "json_object")
        ? { abortSignal: AbortSignal.timeout(input.timeoutMs ?? 90_000) }
        : {}),
      prompt: input.prompt,
    };
    // Moonshot/Kimi supports Chat Completions JSON-object mode, not the
    // Responses API JSON-schema protocol. Keep schema validation local and
    // deterministic after parsing the provider's JSON object.
    const result = resolved.structuredOutputMode === "json_object"
      ? await generateObject({
          ...common,
          output: "no-schema",
          system: `${input.system ?? ""}\nReturn one JSON object only. Required structural schema: ${JSON.stringify(zodSchema(input.schema).jsonSchema)}`,
        })
      : await generateObject({
          ...common,
          schema: input.schema,
          schemaName: input.schemaName,
          system: input.system,
        });

    const elapsed = Date.now() - startedAt;
    console.log(
      `[llm] generateStructured ok  capability=${input.capability} ` +
      `provider=${resolved.provider} model=${resolved.modelId} ` +
        `phase=${input.generationPhase ?? "initial"} ${elapsed}ms`,
    );

    // Cast is safe: `generateObject` returns `{ object: z.infer<TSchema> }`
    // when given a Zod schema. The `ZodType` generic constraint is a
    // pragmatic choice — it trades a small amount of type precision for
    // simpler call-site ergonomics.
    const responseResult = result as unknown as {
      finishReason?: string;
      usage?: Record<string, string | number | boolean | null>;
      response?: { id?: string };
    };
    return {
      object: resolved.structuredOutputMode === "json_object"
        ? input.schema.parse(result.object) as ReturnType<TSchema["parse"]>
        : result.object as ReturnType<TSchema["parse"]>,
      metadata: {
        provider: resolved.provider,
        model: resolved.modelId,
        capability: input.capability,
        ...(resolved.temperature === undefined ? {} : { temperature: resolved.temperature }),
        ...(responseResult.finishReason ? { finishReason: responseResult.finishReason } : {}),
        ...(responseResult.usage ? { usage: responseResult.usage } : {}),
        ...(responseResult.response?.id
          ? { providerRequestId: responseResult.response.id }
          : {}),
      },
    };
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.error(
      `[llm] generateStructured FAIL capability=${input.capability} ` +
      `provider=${resolved.provider} model=${resolved.modelId} ` +
        `phase=${input.generationPhase ?? "initial"} ${elapsed}ms err=${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
