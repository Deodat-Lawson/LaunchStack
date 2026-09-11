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

/**
 * "sidecar" survives only for transcription, where it names the real
 * self-hosted Whisper service (services/transcription, ADR-004). The sidecar
 * embed/rerank/NER providers were phantoms — no service ever implemented
 * those routes — and were removed rather than stubbed (ADR-004 §5).
 */
export type ProviderMode = "cloud" | "sidecar";

export interface ProvidersRegistryConfig {
    /** Global OpenAI-compatible base URL (AI_BASE_URL). */
    aiBaseUrl?: string;
    /** Global OpenAI-compatible key (AI_API_KEY). Belongs to aiBaseUrl. */
    aiApiKey?: string;
    /**
     * Credential for the Gemini fallback (GOOGLE_AI_API_KEY), kept separate
     * from {@link aiApiKey} so the two are never mixed. A capability that falls
     * back to Gemini authenticates with this and nothing else.
     */
    googleApiKey?: string;
    /**
     * Explicit transcription mode override (TRANSCRIPTION_PROVIDER).
     * "sidecar" routes uploads to the self-hosted transcription service.
     * This is the ONLY way a self-hosted mode is selected: service URLs
     * (SIDECAR_URL and its successors) never auto-select a provider.
     */
    transcriptionProviderMode?: ProviderMode;
    /**
     * Per-capability endpoint overrides (RERANK_API_* / NER_API_* in the
     * hosting app's env). Registered by the host alongside the globals so
     * the provider constructors read configuration from one slot instead of
     * process.env (ADR-002).
     */
    rerank?: CapabilityEndpointConfig;
    ner?: CapabilityEndpointConfig;
}

/** A capability's own endpoint/credential/model, all optional. */
export interface CapabilityEndpointConfig {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
}

import { createSlot } from "@launchstack/runtime";
import { GEMINI_BASE_URL } from "../types";

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

/**
 * A capability's registered endpoint override. Replaces the providers'
 * direct RERANK_API_* / NER_API_* process.env reads: the host registers the
 * same values through configureProviders() (see apps/web/src/server/
 * engine.ts, which builds them from CoreConfig.providers).
 */
export function getCapabilityConfig(capability: "rerank" | "ner"): CapabilityEndpointConfig {
    const config = getConfig();
    return (capability === "rerank" ? config.rerank : config.ner) ?? {};
}

// ── Resolve helpers ─────────────────────────────────────────────────

export interface ResolvedEndpoint {
    baseUrl: string;
    apiKey: string;
}

/**
 * Resolve a capability's endpoint and credential together.
 *
 * They must be resolved as a PAIR. Picking them independently is how a key
 * ends up at a service it does not belong to: with `AI_API_KEY` set but no
 * `AI_BASE_URL`, an independent URL resolver would choose Gemini while an
 * independent key resolver chose that unrelated global key, and the two would
 * meet in an Authorization header addressed to Google.
 *
 *   1. The capability names a URL — use it, keyed by the capability's own key
 *      or the global one.
 *   2. The host names a global URL — same, keyed by the global key.
 *   3. Nothing names a URL — Gemini, authenticated *only* by the Google
 *      credential.
 *
 * A non-Google key with no URL therefore stays unusable until its matching URL
 * is supplied, which is the correct outcome: it names who you are, not where
 * the request goes.
 */
export function resolveEndpoint(
    capabilityBaseUrl: string | undefined,
    capabilityApiKey: string | undefined
): ResolvedEndpoint {
    const c = getConfig();
    const strip = (url: string) => url.replace(/\/$/, "");

    /**
     * Which credential belongs to this URL.
     *
     * The Google key is only ever offered to Google's own endpoint — but it is
     * offered there however that URL was chosen. An operator who points
     * RERANK_API_BASE_URL at Gemini explicitly, rather than relying on the
     * fallback, still means the Google credential; without this they would send
     * an empty bearer token to an endpoint they named on purpose.
     */
    const keyFor = (baseUrl: string): string => {
        if (capabilityApiKey) return capabilityApiKey;
        if (baseUrl === GEMINI_BASE_URL) return c.googleApiKey ?? c.aiApiKey ?? "";
        return c.aiApiKey ?? "";
    };

    if (capabilityBaseUrl) {
        const baseUrl = strip(capabilityBaseUrl);
        return { baseUrl, apiKey: keyFor(baseUrl) };
    }

    if (c.aiBaseUrl) {
        const baseUrl = strip(c.aiBaseUrl);
        return { baseUrl, apiKey: keyFor(baseUrl) };
    }

    if (!c.googleApiKey && (capabilityApiKey ?? c.aiApiKey)) {
        console.warn(
            "[providers] A credential is configured but no endpoint names where " +
                "it belongs. Falling back to Gemini, which that key is not for — so " +
                "it will not be sent. Set the capability's *_API_BASE_URL (or " +
                "AI_BASE_URL) to pair it, or GOOGLE_AI_API_KEY to use Gemini."
        );
    }

    return { baseUrl: GEMINI_BASE_URL, apiKey: c.googleApiKey ?? "" };
}

export function resolveModel(capabilityEnv: string | undefined, defaultModel: string): string {
    return capabilityEnv ?? defaultModel;
}

// ── Provider type resolution ────────────────────────────────────────
//
// Reranking and NER have exactly one mode now: cloud. Their "sidecar"
// providers called ${SIDECAR_URL}/rerank and /extract-entities, routes no
// service in this repository ever implemented, so the resolvers (and the
// SIDECAR_URL-presence auto-selection that made a compose stack 404 at
// runtime) were deleted with them (ADR-004 §5).

/**
 * Transcription still has a real self-hosted implementation
 * (services/transcription). It is selected ONLY by the explicit
 * TRANSCRIPTION_PROVIDER=sidecar override — never inferred from a URL.
 */
export function resolveTranscriptionProvider(): ProviderMode {
    return getConfig().transcriptionProviderMode === "sidecar" ? "sidecar" : "cloud";
}

// `isCloudMode()` used to live here, hardcoded to `true` since ADR-004 §5
// removed the SIDECAR_URL switch it was keyed off. Metering is not a provider
// concern — it only sat in this registry because of that historical
// derivation — and hardcoding it made every deployment behave as if it were
// billing, which permanently bricked uploads on self-hosted instances once a
// workspace exhausted its signup grant.
//
// It is replaced by the metering slot in ../credits/slot.ts, fed from
// CoreConfig.credits.metering. Use isMeteringEnforced() for blocking checks.
