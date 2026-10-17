/**
 * Providers a workspace admin can pick when bringing their own model.
 *
 * Picking one only fills in the address, which stays visible and editable —
 * nothing is inferred from a key or a model id, and every provider is reached
 * the same way: the OpenAI chat-completions protocol at that address. "Other"
 * covers everything else that speaks it (Azure, Groq, Together, a self-hosted
 * vLLM or LM Studio server).
 *
 * Client-safe: the Settings form imports this.
 */

export const MODEL_PROVIDER_IDS = [
    "openai",
    "anthropic",
    "gemini",
    "openrouter",
    "custom",
] as const;
export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number];

export interface ModelProviderOption {
    id: ModelProviderId;
    label: string;
    /** Prefilled address. Empty for "Other". */
    baseUrl: string;
    /** Where an admin creates a key. */
    keyUrl?: string;
    /** Whether a key is expected. A self-hosted server often takes none. */
    keyRequired: boolean;
    /** One line under the picker. */
    note?: string;
}

export const MODEL_PROVIDERS: readonly ModelProviderOption[] = [
    {
        id: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        keyUrl: "https://platform.openai.com/api-keys",
        keyRequired: true,
    },
    {
        id: "anthropic",
        label: "Anthropic (Claude)",
        baseUrl: "https://api.anthropic.com/v1",
        keyUrl: "https://platform.claude.com/settings/keys",
        keyRequired: true,
        note: "Uses Anthropic's OpenAI-compatible API. A Claude Pro or Max plan can't be used here; it needs an API key.",
    },
    {
        id: "gemini",
        label: "Google Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        keyUrl: "https://aistudio.google.com/apikey",
        keyRequired: true,
    },
    {
        id: "openrouter",
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        keyUrl: "https://openrouter.ai/keys",
        keyRequired: true,
        note: "One account, hundreds of models, billed to your OpenRouter credits.",
    },
    {
        id: "custom",
        label: "Other OpenAI-compatible",
        baseUrl: "",
        keyRequired: false,
        note: "Any server that speaks the OpenAI chat-completions protocol, including one you host.",
    },
];

export function getModelProvider(id: string): ModelProviderOption {
    return MODEL_PROVIDERS.find(provider => provider.id === id) ?? MODEL_PROVIDERS.at(-1)!;
}

export function isModelProviderId(value: unknown): value is ModelProviderId {
    return typeof value === "string" && (MODEL_PROVIDER_IDS as readonly string[]).includes(value);
}
