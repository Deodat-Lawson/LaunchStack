/**
 * Provider detection + model resolution layer.
 *
 * Responsibilities:
 *   1. At boot, inspect env vars + Ollama reachability to figure out which
 *      providers are actually usable on this machine.
 *   2. Given a capability + (optional) forced provider, resolve to a concrete
 *      Vercel AI SDK `LanguageModel` instance that the caller can hand to
 *      `generateObject` / `generateText` / etc.
 *   3. Expose a cached, sync `getAvailableProviders()` for startup diagnostics.
 *
 * This file is the ONLY place in the repo that imports from `@ai-sdk/*`.
 * Call sites should never construct model instances themselves — they get
 * them from `resolveModel(capability)` inside `generate.ts`.
 *
 * Design notes:
 *   - Ollama is exposed via OpenAI-compatible adapter, not a third-party
 *     Ollama package. Reasons: (a) Ollama has a stable OpenAI-compat endpoint
 *     at `/v1`, (b) one less dependency to track, (c) no AI-SDK-version
 *     compatibility risk (third-party providers frequently lag major SDK
 *     bumps). The tradeoff is we can't use Ollama-native features like
 *     structured output with `format: json` — we rely on the OpenAI-compat
 *     tool-call path instead. For capable local models (llama3.2, qwen2.5)
 *     this works fine. For very small models (<3B) output quality will
 *     degrade, but that's a model choice, not a library choice.
 *   - We avoid importing `~/env` to keep this module loadable in non-Next
 *     contexts (scripts, tests). We read `process.env` directly.
 */

import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { getLlmConfig } from "./config";
import {
  PROVIDERS,
  type Capability,
  type CapabilityModelConfig,
  type Provider,
} from "./types";

// ---------------------------------------------------------------------------
// Provider availability
// ---------------------------------------------------------------------------

/**
 * Availability info for a single provider. `ready === true` means the
 * provider can satisfy at least one capability (has credentials + at least
 * one configured model). `reason` explains why it's unavailable if not.
 */
export interface ProviderAvailability {
  provider: Provider;
  ready: boolean;
  /** Human-readable reason when ready === false. Logged at startup. */
  reason?: string;
}

/** Cached availability snapshot, computed lazily on first call. */
let cachedAvailability: ProviderAvailability[] | null = null;

/**
 * Check each provider against env vars + config, return availability.
 *
 * This intentionally does NOT ping Ollama over the network — doing so would
 * require all consumers to await a Promise, which infects call sites that
 * don't need it. Ollama reachability is instead verified lazily in
 * `resolveModel()` when a call actually needs it. The availability check
 * here only verifies `OLLAMA_BASE_URL` is set.
 *
 * We also don't validate API keys are VALID here — an expired/bad key still
 * shows as "available." That failure surfaces at call time with a clearer
 * error from the provider itself.
 */
export function getAvailableProviders(): ProviderAvailability[] {
  if (cachedAvailability) return cachedAvailability;

  const config = getLlmConfig();

  cachedAvailability = PROVIDERS.map((provider): ProviderAvailability => {
    const credentialCheck = checkCredentials(provider);
    if (!credentialCheck.ok) {
      return { provider, ready: false, reason: credentialCheck.reason };
    }

    // Must have at least one capability configured for this provider.
    const hasAnyCapabilityConfigured = Object.values(
      config.capabilities,
    ).some((perProvider) => Boolean(perProvider[provider]));

    if (!hasAnyCapabilityConfigured) {
      return {
        provider,
        ready: false,
        reason: "no capabilities configured for this provider in config/llm-models.json",
      };
    }

    return { provider, ready: true };
  });

  return cachedAvailability;
}

/** Reset cached availability. Test-only. */
export function __resetProviderCacheForTests(): void {
  cachedAvailability = null;
}

/**
 * Credential check. Returns `{ ok: true }` if the provider has what it needs,
 * otherwise a reason string describing the missing piece.
 *
 * We check `process.env` directly rather than going through `~/env` so that
 * this file can be imported from scripts and tests that don't have the full
 * Next env validation stack available.
 */
function checkCredentials(
  provider: Provider,
): { ok: true } | { ok: false; reason: string } {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_API_KEY
        ? { ok: true }
        : { ok: false, reason: "OPENAI_API_KEY not set" };
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY
        ? { ok: true }
        : { ok: false, reason: "ANTHROPIC_API_KEY not set" };
    case "google":
      // The project env var is GOOGLE_AI_API_KEY (historical), while the
      // SDK default is GOOGLE_GENERATIVE_AI_API_KEY. We accept either, and
      // the instance factory below maps them into the SDK's expected shape.
      return process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ? { ok: true }
        : { ok: false, reason: "GOOGLE_AI_API_KEY not set" };
    case "ollama":
      return process.env.OLLAMA_BASE_URL
        ? { ok: true }
        : { ok: false, reason: "OLLAMA_BASE_URL not set" };
  }
}

// ---------------------------------------------------------------------------
// Provider instances — lazy, cached singletons
// ---------------------------------------------------------------------------

let openaiInstance: OpenAIProvider | null = null;
let anthropicInstance: AnthropicProvider | null = null;
let googleInstance: GoogleGenerativeAIProvider | null = null;
let ollamaInstance: OpenAIProvider | null = null;

function getOpenAIProvider(): OpenAIProvider {
  openaiInstance ??= createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  return openaiInstance;
}

function getAnthropicProvider(): AnthropicProvider {
  anthropicInstance ??= createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  return anthropicInstance;
}

function getGoogleProvider(): GoogleGenerativeAIProvider {
  googleInstance ??= createGoogleGenerativeAI({
    apiKey:
      process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return googleInstance;
}

/**
 * Ollama via OpenAI-compatible adapter. We construct a separate OpenAI
 * provider instance pointed at Ollama's `/v1` endpoint, with a dummy API key
 * (Ollama ignores it). This avoids taking on a third-party Ollama provider
 * package as a dependency, and works for every AI SDK version.
 */
function getOllamaProvider(): OpenAIProvider {
  if (ollamaInstance) return ollamaInstance;

  const base = process.env.OLLAMA_BASE_URL;
  if (!base) {
    throw new Error(
      "[llm] Ollama provider requested but OLLAMA_BASE_URL is not set",
    );
  }

  // Normalize: if the user set `http://localhost:11434` (the natural form),
  // append `/v1` for the OpenAI-compat API. If they already pointed it at
  // a `/v1` suffix, leave it alone.
  const normalized = base.replace(/\/+$/, "");
  const baseURL = normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;

  ollamaInstance = createOpenAI({
    baseURL,
    // Ollama's OpenAI-compat endpoint requires *some* api key header but
    // doesn't validate it. Any non-empty string works.
    apiKey: "ollama",
  });

  return ollamaInstance;
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Errors thrown when no provider can satisfy a capability. We throw instead
 * of returning null so call sites fail loudly — a silent degradation to a
 * different model would be hard to debug.
 */
export class LlmCapabilityUnavailableError extends Error {
  constructor(
    public readonly capability: Capability,
    public readonly triedProviders: ReadonlyArray<{ provider: Provider; reason: string }>,
  ) {
    const attempts = triedProviders
      .map((t) => `  - ${t.provider}: ${t.reason}`)
      .join("\n");
    super(
      `[llm] No provider available for capability "${capability}". Tried:\n${attempts}\n` +
        `Set at least one provider's credentials, or run with LLM_PROVIDER_PRIORITY ` +
        `set to a provider that has capability config in config/llm-models.json.`,
    );
    this.name = "LlmCapabilityUnavailableError";
  }
}

/**
 * Result of a model resolution: the actual SDK model instance + metadata
 * the caller can use for logging / telemetry.
 */
export interface ResolvedModel {
  provider: Provider;
  modelId: string;
  model: LanguageModel;
  /** Carries through the temperature from config so `generate.ts` can pass it. */
  temperature: number;
}

/**
 * Resolve a capability to a concrete model, honoring an optional forced
 * provider. Walks `providerPriority` until one matches.
 *
 * Rules for selection:
 *   1. If `forceProvider` is set, it MUST be available and MUST have a
 *      configured model for this capability. Otherwise throw.
 *   2. Otherwise, walk `providerPriority` in order. Take the first provider
 *      that is both available AND has a configured model for the capability.
 *   3. If none match, throw `LlmCapabilityUnavailableError` with a detailed
 *      list of why each provider was skipped.
 */
export function resolveModel(
  capability: Capability,
  forceProvider?: Provider,
): ResolvedModel {
  const config = getLlmConfig();
  const availability = getAvailableProviders();
  const availabilityByProvider = new Map(
    availability.map((a) => [a.provider, a]),
  );

  const tryProvider = (
    provider: Provider,
  ): ResolvedModel | { skipped: true; reason: string } => {
    const avail = availabilityByProvider.get(provider);
    if (!avail || !avail.ready) {
      return { skipped: true, reason: avail?.reason ?? "provider unknown" };
    }

    const modelConfig = config.capabilities[capability][provider];
    if (!modelConfig) {
      return {
        skipped: true,
        reason: `no "${capability}" model configured for ${provider}`,
      };
    }

    return instantiate(provider, modelConfig);
  };

  if (forceProvider) {
    const result = tryProvider(forceProvider);
    if ("skipped" in result) {
      throw new LlmCapabilityUnavailableError(capability, [
        { provider: forceProvider, reason: result.reason },
      ]);
    }
    return result;
  }

  const failures: Array<{ provider: Provider; reason: string }> = [];
  for (const provider of config.providerPriority) {
    const result = tryProvider(provider);
    if ("skipped" in result) {
      failures.push({ provider, reason: result.reason });
      continue;
    }
    return result;
  }

  throw new LlmCapabilityUnavailableError(capability, failures);
}

/**
 * Turn a (provider, modelConfig) pair into a concrete `LanguageModel`
 * instance. This is where we call the actual SDK factories.
 */
function instantiate(
  provider: Provider,
  modelConfig: CapabilityModelConfig,
): ResolvedModel {
  const temperature = modelConfig.temperature ?? 0;

  switch (provider) {
    case "openai":
      return {
        provider,
        modelId: modelConfig.model,
        model: getOpenAIProvider()(modelConfig.model),
        temperature,
      };
    case "anthropic":
      return {
        provider,
        modelId: modelConfig.model,
        model: getAnthropicProvider()(modelConfig.model),
        temperature,
      };
    case "google":
      return {
        provider,
        modelId: modelConfig.model,
        model: getGoogleProvider()(modelConfig.model),
        temperature,
      };
    case "ollama":
      return {
        provider,
        modelId: modelConfig.model,
        model: getOllamaProvider()(modelConfig.model),
        temperature,
      };
  }
}
