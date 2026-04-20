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

import { generateObject } from "ai";
import type { ZodType } from "zod";

import { resolveModel } from "./providers";
import type { GenerateStructuredInput } from "./types";

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

  try {
    const result = await generateObject({
      model: resolved.model,
      temperature: resolved.temperature,
      schema: input.schema,
      schemaName: input.schemaName,
      system: input.system,
      prompt: input.prompt,
    });

    const elapsed = Date.now() - startedAt;
    console.log(
      `[llm] generateStructured ok  capability=${input.capability} ` +
        `provider=${resolved.provider} model=${resolved.modelId} ` +
        `${elapsed}ms`,
    );

    // Cast is safe: `generateObject` returns `{ object: z.infer<TSchema> }`
    // when given a Zod schema. The `ZodType` generic constraint is a
    // pragmatic choice — it trades a small amount of type precision for
    // simpler call-site ergonomics.
    return result.object as ReturnType<TSchema["parse"]>;
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.error(
      `[llm] generateStructured FAIL capability=${input.capability} ` +
        `provider=${resolved.provider} model=${resolved.modelId} ` +
        `${elapsed}ms err=${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
