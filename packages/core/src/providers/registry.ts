/**
 * Provider registry — resolves configuration for each capability.
 *
 * Resolution order for base URL / API key / model:
 *   1. Per-capability env: RERANK_API_BASE_URL, RERANK_API_KEY, RERANK_MODEL
 *   2. Global fallback:    AI_BASE_URL, AI_API_KEY
 *   3. Built-in default:   Gemini's OpenAI-compatible endpoint.
 *
 * Every capability now resolves to one vendor unless the operator names
 * another, including the two that used to have hosts of their own: reranking
 * runs on the chat endpoint (Google serves no /rerank) and transcription
 * passes audio into chat completions (Google serves no /audio/transcriptions).
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

import { createSlot } from "../internal/slot";
import { GEMINI_BASE_URL } from "../llm/types";

const configSlot = createSlot<ProvidersRegistryConfig>("providers/registry");

/**
 * Register provider config. Called once at startup by the hosting app (see
 * apps/web/src/server/engine.ts). Idempotent — subsequent calls replace the
 * captured config entirely.
 */
export function configureProviders(config: ProvidersRegistryConfig): void {
    configSlot.set(config);
}

/** Returns the active config. The host must call configureProviders() first. */
function getConfig(): ProvidersRegistryConfig {
    return configSlot.get() ?? {};
}

// ── Resolve helpers ─────────────────────────────────────────────────

/**
 * Resolve a capability's endpoint, defaulting to {@link GEMINI_BASE_URL}.
 *
 * `defaultUrl` remains for a provider that can only ever talk to one host;
 * nothing passes it today, because every capability is now reachable at an
 * arbitrary OpenAI-compatible endpoint. The Gemini fallback means a capability
 * the operator never configured still runs — against Google, with whatever key
 * `resolveApiKey` found. Set the capability's `*_API_BASE_URL`, or
 * `providers.aiBaseUrl` on the host, to send it elsewhere.
 */
export function resolveBaseUrl(
    capabilityEnv: string | undefined,
    defaultUrl?: string,
): string {
    const url =
        capabilityEnv ?? getConfig().aiBaseUrl ?? defaultUrl ?? GEMINI_BASE_URL;
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
