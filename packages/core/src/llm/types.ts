/**
 * LLM model / provider types. Lifted from the feature-side services/types
 * module so core can consume them without reaching into app layers. The
 * app's original file now re-exports these so existing callers continue to
 * work unchanged.
 */

/**
 * Supported AI model types for chat generation.
 */
export type AIModelType =
  | "gpt-4o"
  | "gpt-5.2"
  | "gpt-5.1"
  | "gpt-5-nano"
  | "gpt-5-mini"
  | "claude-sonnet-4"
  | "claude-opus-4.5"
  | "gemini-2.5-flash"
  | "gemini-3-flash"
  | "gemini-3-pro"
  | "llama3.1:8b"
  | "llama3.2:3b"
  | "mistral:7b"
  | "codellama:7b"
  | "gemma2:9b"
  | "phi3:mini"
  | "qwen2.5:7b";

/**
 * Tuple of all supported AI model names — useful for validation.
 */
export const AIModelTypes = [
  "gpt-4o",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5-nano",
  "gpt-5-mini",
  "claude-sonnet-4",
  "claude-opus-4.5",
  "gemini-2.5-flash",
  "gemini-3-flash",
  "gemini-3-pro",
  "llama3.1:8b",
  "llama3.2:3b",
  "mistral:7b",
  "codellama:7b",
  "gemma2:9b",
  "phi3:mini",
  "qwen2.5:7b",
] as const;

export function isAIModelType(value: string): value is AIModelType {
  return AIModelTypes.includes(value as AIModelType);
}

export const LLMProviders = ["openai", "anthropic", "google", "ollama"] as const;
export type LLMProvider = (typeof LLMProviders)[number];

export const ProviderModelMap = {
  openai: ["gpt-4o", "gpt-5.2", "gpt-5.1", "gpt-5-nano", "gpt-5-mini"] as const,
  anthropic: ["claude-sonnet-4", "claude-opus-4.5"] as const,
  google: ["gemini-2.5-flash", "gemini-3-flash", "gemini-3-pro"] as const,
  ollama: ["llama3.1:8b", "llama3.2:3b", "mistral:7b", "codellama:7b", "gemma2:9b", "phi3:mini", "qwen2.5:7b"] as const,
} satisfies Record<LLMProvider, readonly AIModelType[]>;

export const ProviderDefaultModels: Record<LLMProvider, AIModelType> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4",
  google: "gemini-2.5-flash",
  ollama: "llama3.1:8b",
};

export function isModelAllowedForProvider(
  provider: LLMProvider,
  model: string | undefined,
): model is AIModelType {
  if (!model) return false;
  return (ProviderModelMap[provider] as readonly string[]).includes(model);
}
