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

  const result = await generateObject({
    model: resolved.model,
    temperature: resolved.temperature,
    schema: input.schema,
    schemaName: input.schemaName,
    system: input.system,
    prompt: input.prompt,
  });

  // Cast is safe: `generateObject` returns `{ object: z.infer<TSchema> }`
  // when given a Zod schema. The `ZodType` generic constraint is a
  // pragmatic choice — it trades a small amount of type precision for
  // simpler call-site ergonomics.
  return result.object as ReturnType<TSchema["parse"]>;
}
