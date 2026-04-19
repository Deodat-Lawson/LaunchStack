/**
 * Core types for the unified LLM library.
 *
 * This file is deliberately provider-agnostic — nothing here imports from
 * `@ai-sdk/*` or any other vendor package. All coupling to specific providers
 * lives in `providers.ts`. That keeps this file cheap to read and keeps call
 * sites from accidentally depending on vendor internals through a types import.
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
 * Known LLM providers. Adding a new provider is a deliberate project decision
 * that also requires updating `providers.ts` to wire up its adapter, so
 * this list is hardcoded rather than config-driven.
 *
 * - `openai`, `anthropic`, `google`: cloud providers. Require an API key.
 * - `ollama`: local inference via Ollama's OpenAI-compatible endpoint.
 *   Requires `OLLAMA_BASE_URL` to be set. Free but quality varies by model.
 */
export const PROVIDERS = ["openai", "anthropic", "google", "ollama"] as const;

export type Provider = (typeof PROVIDERS)[number];

/**
 * Per-provider configuration for a single capability.
 * Extended later with sampling params, context limits, etc. as needs arise.
 */
export interface CapabilityModelConfig {
  /** The model identifier the provider expects (e.g. "gpt-5-nano", "llama3.2:3b"). */
  model: string;
  /** Sampling temperature. Defaults to 0 for extraction tasks. */
  temperature?: number;
}

/**
 * Shape of the `config/llm-models.json` file after parsing. Validated by Zod
 * at load time; see `config.ts`.
 */
export interface LlmConfig {
  /**
   * Provider resolution order. When the caller doesn't force a specific
   * provider, the library picks the first provider in this list that is
   * available (has credentials + a configured model for the requested
   * capability).
   */
  providerPriority: Provider[];

  /**
   * For every (capability, provider) pair we support, what model to use and
   * what sampling params. Entries may be missing — e.g. if `google` has no
   * config for `smallExtraction`, the library treats that pair as unavailable
   * even if a Google API key is present.
   */
  capabilities: {
    [C in Capability]: Partial<Record<Provider, CapabilityModelConfig>>;
  };
}

/**
 * Input to `generateStructured`. Intentionally mirrors Vercel AI SDK's
 * `generateObject` shape (system + prompt + schema) so that the migration
 * path is mechanical and future callers who are familiar with the SDK can
 * read it immediately.
 */
export interface GenerateStructuredInput<TSchema> {
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
  schema: TSchema;
  /**
   * Optional override to force a specific provider for this one call,
   * bypassing the priority list. Useful for tests or per-request UI overrides.
   * If the forced provider is not available, the call fails loudly.
   */
  forceProvider?: Provider;
  /**
   * Name used by some providers (OpenAI, Anthropic) as the JSON schema
   * / tool name. Purely cosmetic but helps with provider-side logging.
   */
  schemaName?: string;
}
