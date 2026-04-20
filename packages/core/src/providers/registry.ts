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
 *
 * Historically this module read process.env directly at module load. It now
 * takes configuration via configureProviders() so the core package can
 * consume the same resolvers without env coupling. apps/web/src/server/
 * engine.ts registers the config during startup; legacy callers continue
 * to pass per-capability env values via the `capabilityEnv` parameters.
 */

export type ProviderMode = "cloud" | "sidecar";

export interface ProvidersRegistryConfig {
    /** Global OpenAI-compatible base URL (AI_BASE_URL). */
    aiBaseUrl?: string;
    /** Global OpenAI-compatible key (AI_API_KEY). */
    aiApiKey?: string;
    /** Sidecar service URL — presence enables sidecar auto-selection. */
    sidecarUrl?: string;
    /** Explicit per-capability provider mode override (from *_PROVIDER env). */
    rerankProviderMode?: ProviderMode;
    nerProviderMode?: ProviderMode;
    transcriptionProviderMode?: ProviderMode;
    /** Presence of per-capability base URLs (factored into sidecar selection). */
    rerankBaseUrl?: string;
    nerBaseUrl?: string;
    transcriptionBaseUrl?: string;
}

let _config: ProvidersRegistryConfig | null = null;

/**
 * Register provider config. Called once at startup by the hosting app (see
 * apps/web/src/server/engine.ts). Idempotent — subsequent calls replace the
 * captured config entirely.
 */
export function configureProviders(config: ProvidersRegistryConfig): void {
    _config = config;
}

/** Returns the active config. The host must call configureProviders() first. */
function getConfig(): ProvidersRegistryConfig {
    return _config ?? {};
}

// ── Resolve helpers ─────────────────────────────────────────────────

export function resolveBaseUrl(
    capabilityEnv: string | undefined,
    defaultUrl: string,
): string {
    const url = capabilityEnv ?? getConfig().aiBaseUrl ?? defaultUrl;
    return url.replace(/\/$/, "");
}

export function resolveApiKey(
    capabilityEnv: string | undefined,
    ...legacyFallbacks: (string | undefined)[]
): string {
    if (capabilityEnv) return capabilityEnv;
    const aiKey = getConfig().aiApiKey;
    if (aiKey) return aiKey;
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

export function resolveRerankProvider(): ProviderMode {
    const c = getConfig();
    if (c.rerankProviderMode === "sidecar") return "sidecar";
    if (c.sidecarUrl && !c.rerankBaseUrl && !c.aiBaseUrl) return "sidecar";
    return "cloud";
}

export function resolveNERProvider(): ProviderMode {
    const c = getConfig();
    if (c.nerProviderMode === "sidecar") return "sidecar";
    if (c.sidecarUrl && !c.nerBaseUrl && !c.aiBaseUrl) return "sidecar";
    return "cloud";
}

export function resolveTranscriptionProvider(): ProviderMode {
    const c = getConfig();
    if (c.transcriptionProviderMode === "sidecar") return "sidecar";
    if (c.sidecarUrl && !c.transcriptionBaseUrl && !c.aiBaseUrl) return "sidecar";
    return "cloud";
}

/** Whether the current deployment uses cloud providers (tokens apply) */
export function isCloudMode(): boolean {
    return !getConfig().sidecarUrl;
}
