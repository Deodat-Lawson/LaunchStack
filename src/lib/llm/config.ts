/**
 * Loads `config/llm-models.json` once at process startup, validates it with
 * Zod, then applies environment variable overrides. The resulting `LlmConfig`
 * is the single source of truth for capability → model mapping.
 *
 * Override hierarchy (highest wins):
 *   1. Environment variables (see `applyEnvOverrides`)
 *   2. `config/llm-models.json` file
 *   3. Hardcoded defaults (see `HARDCODED_DEFAULTS`)
 *
 * The file is read exactly once per process. Changes require a restart.
 * We deliberately do not hot-reload: the config is load-bearing and silent
 * swap under a running server is a recipe for confusing bugs.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { CAPABILITIES, PROVIDERS, type LlmConfig } from "./types";

// ---------------------------------------------------------------------------
// Zod schema matching the shape of llm-models.json
// ---------------------------------------------------------------------------

const ProviderEnum = z.enum(PROVIDERS);
const CapabilityEnum = z.enum(CAPABILITIES);

const CapabilityModelConfigSchema = z.object({
  model: z.string().min(1, "model must be a non-empty string"),
  temperature: z.number().min(0).max(2).optional(),
});

// Zod shape for the per-capability provider map. Each provider entry is
// optional — missing entries mean "this provider doesn't service this
// capability" and the resolver will skip it at runtime. Typed as `unknown`
// intermediate then cast because Zod's inferred type from `Object.fromEntries`
// doesn't match our explicit LlmConfig type literally, but the runtime shape
// is identical.
const PerProviderSchema = z.object(
  Object.fromEntries(
    PROVIDERS.map((p) => [p, CapabilityModelConfigSchema.optional()]),
  ),
);

const CapabilitiesSchema = z.object(
  Object.fromEntries(CAPABILITIES.map((cap) => [cap, PerProviderSchema])),
);

const LlmConfigSchema = z.object({
  providerPriority: z.array(ProviderEnum).min(1, "providerPriority must list at least one provider"),
  capabilities: CapabilitiesSchema,
});

// ---------------------------------------------------------------------------
// Hardcoded defaults — used if the config file is missing or unreadable.
// These are identical to the shipped `config/llm-models.json` so the app
// works even on a misconfigured deploy where the config file was left behind.
// ---------------------------------------------------------------------------

const HARDCODED_DEFAULTS: LlmConfig = {
  providerPriority: ["openai", "anthropic", "google", "ollama"],
  capabilities: {
    smallExtraction: {
      openai: { model: "gpt-5-nano", temperature: 0 },
      anthropic: { model: "claude-3-5-haiku-latest", temperature: 0 },
      google: { model: "gemini-2.0-flash", temperature: 0 },
      ollama: { model: "llama3.2:3b", temperature: 0 },
    },
  },
};

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

/**
 * Attempt to load `config/llm-models.json` relative to the current working
 * directory. Falls back to hardcoded defaults if:
 *   - The file is missing (fresh clone, minimal deploy)
 *   - The file is unreadable (permissions, corrupted)
 *   - The file is valid JSON but fails Zod validation
 *
 * In the last case we log a loud error and fall back, rather than crashing,
 * so a broken edit doesn't take the whole app down — but the error is
 * visible in the server logs so the operator can fix it.
 */
function loadConfigFromFile(): LlmConfig {
  const configPath = path.resolve(process.cwd(), "config", "llm-models.json");

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    // File missing or unreadable — fall back silently. This is the common
    // case during tests and on minimal deployments that don't ship the config
    // directory; we don't want to spam logs for it.
    return HARDCODED_DEFAULTS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[llm/config] Failed to parse ${configPath} as JSON — falling back to defaults:`,
      err instanceof Error ? err.message : String(err),
    );
    return HARDCODED_DEFAULTS;
  }

  // Strip the optional "$schema" key before validation so Zod's strict mode
  // (if we enable it later) doesn't complain.
  if (parsed && typeof parsed === "object" && "$schema" in parsed) {
    delete (parsed as Record<string, unknown>).$schema;
  }

  const result = LlmConfigSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `[llm/config] ${configPath} failed schema validation — falling back to defaults:`,
      result.error.format(),
    );
    return HARDCODED_DEFAULTS;
  }

  // The parsed shape is structurally identical to `LlmConfig` but Zod's
  // inferred generics don't line up with our exported type, so we narrow
  // here via unknown.
  return result.data as unknown as LlmConfig;
}

// ---------------------------------------------------------------------------
// Environment variable overrides
// ---------------------------------------------------------------------------

/**
 * Allows ops to override any single capability/provider model without
 * editing files. Variable names follow the pattern:
 *
 *   LLM_MODEL_<CAPABILITY>_<PROVIDER>=<model-id>
 *
 * Capability and provider names are uppercased. Example:
 *
 *   LLM_MODEL_SMALLEXTRACTION_OPENAI=gpt-6-nano
 *   LLM_MODEL_SMALLEXTRACTION_OLLAMA=qwen2.5:7b
 *
 * Unknown variables are silently ignored so mis-typed env vars don't break
 * startup — they just don't apply. Typos are obvious from the startup log
 * output (see `startup.ts`).
 */
function applyEnvOverrides(config: LlmConfig): LlmConfig {
  // Deep clone so we don't mutate the input (important because the file
  // loader may have returned the shared HARDCODED_DEFAULTS reference).
  const next: LlmConfig = {
    providerPriority: [...config.providerPriority],
    capabilities: Object.fromEntries(
      CAPABILITIES.map((cap) => [
        cap,
        { ...config.capabilities[cap] },
      ]),
    ) as LlmConfig["capabilities"],
  };

  for (const cap of CAPABILITIES) {
    for (const provider of PROVIDERS) {
      const envKey = `LLM_MODEL_${cap.toUpperCase()}_${provider.toUpperCase()}`;
      const override = process.env[envKey];
      if (override && override.trim().length > 0) {
        const existing = next.capabilities[cap][provider];
        next.capabilities[cap][provider] = {
          model: override.trim(),
          temperature: existing?.temperature ?? 0,
        };
      }
    }
  }

  // Optional: LLM_PROVIDER_PRIORITY=ollama,openai,anthropic,google
  // Lets ops force a non-default ordering without editing the JSON.
  const priorityEnv = process.env.LLM_PROVIDER_PRIORITY;
  if (priorityEnv && priorityEnv.trim().length > 0) {
    const parsedPriority = priorityEnv
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is (typeof PROVIDERS)[number] =>
        (PROVIDERS as readonly string[]).includes(s),
      );
    if (parsedPriority.length > 0) {
      next.providerPriority = parsedPriority;
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Public API — cached single-call loader
// ---------------------------------------------------------------------------

let cachedConfig: LlmConfig | null = null;

/**
 * Return the effective LLM config. Loads and validates on first call,
 * caches the result for every subsequent call. Restart the process to
 * pick up file or env var changes.
 */
export function getLlmConfig(): LlmConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = applyEnvOverrides(loadConfigFromFile());
  return cachedConfig;
}

/**
 * Force-reset the cache. Only used by tests — production code should never
 * call this. Exposed here so tests can swap env vars between runs.
 */
export function __resetLlmConfigForTests(): void {
  cachedConfig = null;
}
