/**
 * Startup diagnostics for the LLM library.
 *
 * Call `logLlmStartupSummary()` once at server boot (e.g. from an Inngest
 * function startup hook, or a small `ensure-llm.ts` script that runs before
 * `next dev`). It logs:
 *   - Which providers are available and why
 *   - Which capability → (provider, model) bindings will actually fire
 *   - Which capabilities are NOT serviceable at all (every provider skipped)
 *
 * This runs once per process. It is safe to call from tests and from code
 * paths that execute during request handling — it has no side effects other
 * than `console.log`.
 *
 * Design choice: this NEVER throws. A missing capability is a warning, not
 * a fatal error. The corresponding feature will fail at runtime with a
 * `LlmCapabilityUnavailableError` when a call site actually tries to use
 * it, which is the right time to surface the error (per-request, with full
 * stack trace). Failing at boot would take the whole app down every time
 * someone forgets to set an env var, which is worse than the per-feature
 * failure mode.
 */

import { getLlmConfig } from "./config";
import { getAvailableProviders } from "./providers";
import { CAPABILITIES, type Capability, type Provider } from "./types";

interface CapabilityBinding {
  capability: Capability;
  /** The provider that WILL serve this capability at request time, or null if none. */
  boundProvider: Provider | null;
  boundModel: string | null;
  /** Why each provider before the chosen one was skipped. */
  skippedReasons: Array<{ provider: Provider; reason: string }>;
}

/**
 * Compute the effective capability bindings without actually instantiating
 * any models. Mirrors the logic in `resolveModel()` but returns diagnostic
 * info instead of throwing. Used for the startup log and for any admin UI
 * that wants to show "which LLM is doing what" later.
 */
export function computeCapabilityBindings(): CapabilityBinding[] {
  const config = getLlmConfig();
  const availability = getAvailableProviders();
  const availabilityByProvider = new Map(
    availability.map((a) => [a.provider, a]),
  );

  return CAPABILITIES.map((capability): CapabilityBinding => {
    const skippedReasons: CapabilityBinding["skippedReasons"] = [];

    for (const provider of config.providerPriority) {
      const avail = availabilityByProvider.get(provider);
      if (!avail?.ready) {
        skippedReasons.push({
          provider,
          reason: avail?.reason ?? "provider unknown",
        });
        continue;
      }

      const modelConfig = config.capabilities[capability][provider];
      if (!modelConfig) {
        skippedReasons.push({
          provider,
          reason: `no "${capability}" model configured for ${provider}`,
        });
        continue;
      }

      return {
        capability,
        boundProvider: provider,
        boundModel: modelConfig.model,
        skippedReasons,
      };
    }

    return {
      capability,
      boundProvider: null,
      boundModel: null,
      skippedReasons,
    };
  });
}

/**
 * Guard against duplicate log spam. Startup may be invoked from multiple
 * code paths (e.g. once from `next dev` and again from an Inngest worker
 * in the same process); only print the summary the first time.
 */
let startupLogged = false;

/**
 * Pretty-print the LLM configuration summary. Idempotent.
 */
export function logLlmStartupSummary(): void {
  if (startupLogged) return;
  startupLogged = true;

  const availability = getAvailableProviders();
  const bindings = computeCapabilityBindings();

  console.log("[llm] Provider availability:");
  for (const a of availability) {
    if (a.ready) {
      console.log(`  ✓ ${a.provider}: ready`);
    } else {
      console.log(`  ✗ ${a.provider}: ${a.reason ?? "unavailable"}`);
    }
  }

  console.log("[llm] Capability bindings:");
  for (const b of bindings) {
    if (b.boundProvider) {
      console.log(
        `  ✓ ${b.capability} → ${b.boundProvider}:${b.boundModel}`,
      );
    } else {
      console.warn(
        `  ✗ ${b.capability}: NO PROVIDER AVAILABLE — features that depend on this will fail at runtime.`,
      );
      for (const skipped of b.skippedReasons) {
        console.warn(`      - ${skipped.provider}: ${skipped.reason}`);
      }
    }
  }
}

/**
 * Test-only: force the next call to `logLlmStartupSummary` to actually log
 * again. Not exported through the barrel.
 */
export function __resetStartupLogForTests(): void {
  startupLogged = false;
}
