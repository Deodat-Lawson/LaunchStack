/**
 * Provider registry — resolves configuration for each capability.
 *
 * Resolution order for base URL / API key / model:
 *   1. Per-capability env: RERANK_API_BASE_URL, RERANK_API_KEY, RERANK_MODEL
 *   2. Global fallback:    AI_BASE_URL, AI_API_KEY
 *   3. Legacy keys:        JINA_API_KEY, GROQ_API_KEY, OPENAI_API_KEY
 *   4. Built-in defaults:  (provider-specific, e.g. api.openai.com)
 *
 * This means a user can set AI_BASE_URL + AI_API_KEY once to route
 * ALL capabilities to one provider (e.g. SiliconFlow), then override
 * individual capabilities as needed.
 */

// ── Global fallback ─────────────────────────────────────────────────

const AI_BASE_URL = process.env.AI_BASE_URL; // e.g. https://api.siliconflow.cn/v1
const AI_API_KEY = process.env.AI_API_KEY;

// ── Resolve helpers ─────────────────────────────────────────────────

export function resolveBaseUrl(
    capabilityEnv: string | undefined,
    defaultUrl: string,
): string {
    const url = capabilityEnv ?? AI_BASE_URL ?? defaultUrl;
    return url.replace(/\/$/, "");
}

export function resolveApiKey(
    capabilityEnv: string | undefined,
    ...legacyFallbacks: (string | undefined)[]
): string {
    if (capabilityEnv) return capabilityEnv;
    if (AI_API_KEY) return AI_API_KEY;
    for (const key of legacyFallbacks) {
        if (key) return key;
    }
    return "";
}

export function resolveModel(
    capabilityEnv: string | undefined,
    defaultModel: string,
): string {
    return capabilityEnv ?? defaultModel;
}

// ── Provider type resolution ────────────────────────────────────────

export type ProviderMode = "cloud" | "sidecar";

const SIDECAR_URL = process.env.SIDECAR_URL;

export function resolveRerankProvider(): ProviderMode {
    if (process.env.RERANK_PROVIDER?.toLowerCase() === "sidecar") return "sidecar";
    if (SIDECAR_URL && !process.env.RERANK_API_BASE_URL && !AI_BASE_URL) return "sidecar";
    return "cloud";
}

export function resolveNERProvider(): ProviderMode {
    if (process.env.NER_PROVIDER?.toLowerCase() === "sidecar") return "sidecar";
    if (SIDECAR_URL && !process.env.NER_API_BASE_URL && !AI_BASE_URL) return "sidecar";
    return "cloud";
}

export function resolveTranscriptionProvider(): ProviderMode {
    if (process.env.TRANSCRIPTION_PROVIDER?.toLowerCase() === "sidecar") return "sidecar";
    if (SIDECAR_URL && !process.env.TRANSCRIPTION_API_BASE_URL && !AI_BASE_URL) return "sidecar";
    return "cloud";
}

/** Whether the current deployment uses cloud providers (tokens apply) */
export function isCloudMode(): boolean {
    return !SIDECAR_URL;
}
