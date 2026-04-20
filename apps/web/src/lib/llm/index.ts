/**
 * Public entry point for the unified LLM library.
 *
 * Call sites should import from this barrel only:
 *
 *   import { generateStructured } from "~/lib/llm";
 *
 * Direct imports from `@ai-sdk/*` or provider-specific packages in call
 * sites are forbidden — they defeat the point of having a unified layer.
 * If you find yourself wanting to do that, either add the missing feature
 * to this library or file an issue explaining why it can't be abstracted.
 */

export { generateStructured } from "./generate";
export {
  getAvailableProviders,
  resolveModel,
  LlmCapabilityUnavailableError,
  type ProviderAvailability,
  type ResolvedModel,
} from "./providers";
export { logLlmStartupSummary, computeCapabilityBindings } from "./startup";
export { getLlmConfig } from "./config";
export {
  CAPABILITIES,
  PROVIDERS,
  type Capability,
  type Provider,
  type LlmConfig,
  type CapabilityModelConfig,
  type GenerateStructuredInput,
} from "./types";
