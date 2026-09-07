/**
 * Compatibility types for the original small-extraction helper. Model and
 * provider selection now comes from the canonical structured chat profile.
 */

/**
 * A capability class describes *what kind of LLM work* a caller needs, not
 * *which model* does it. Call sites pick a capability; the provider layer
 * maps (capability, active provider) → a concrete model.
 *
 * Start narrow. We only add new classes when a genuinely new kind of work
 * appears that can't be satisfied by the existing ones — not when a new
 * model ships. A new model is a config file change, not a code change.
 *
 * Current classes:
 *   - `smallExtraction`: cheap structured JSON extraction over short inputs.
 *     Used by metadata extraction, query planners, field scorers, etc.
 *     Must support JSON schema output. Does NOT need vision, long context,
 *     or high-quality free-form generation.
 */
export const CAPABILITIES = ["smallExtraction"] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Input to the compatibility `generateStructured` helper. The underlying
 * implementation resolves the operator's `fast` route; callers never name a
 * model or an endpoint.
 */
export interface GenerateStructuredInput<TOutput> {
    /** Which capability class this call needs. */
    capability: Capability;
    /** System message; optional but recommended for extraction tasks. */
    system?: string;
    /** User prompt. */
    prompt: string;
    /**
     * Zod schema describing the expected output shape. The return type of
     * `generateStructured` is inferred from this schema, so no cast is needed
     * at the call site.
     */
    schema: ZodType<TOutput>;
    /**
     * Name used as the JSON schema / tool name. Purely cosmetic, but it shows
     * up in endpoint-side logs.
     */
    schemaName?: string;
}
import type { ZodType } from "zod";
