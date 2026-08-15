import type { MeteringMode } from "@launchstack/core/credits";
import { env } from "~/env";

/**
 * What kind of deployment this process is serving.
 *
 * Server-only, and deliberately not a NEXT_PUBLIC_ variable: those are inlined
 * into the bundle at build time, so a self-hoster running the published GHCR
 * image could never change one. Client code that needs this reads it from an
 * API route instead.
 */
export type DeploymentMode = "self-hosted" | "cloud";

/**
 * Unset means self-hosted — the hosted service opts in. See the DEPLOYMENT_MODE
 * comment in ~/env for why the default points this way.
 *
 * The `??` is not redundant with the Zod schema. Under SKIP_ENV_VALIDATION,
 * parseServerEnv takes the `serverSchema.partial()` branch, and `.partial()`
 * wraps every field in ZodOptional, which short-circuits on undefined before a
 * ZodDefault would run. Jest sets that flag for the whole suite, so a
 * schema-only default would silently be `undefined` in every test.
 */
export function getDeploymentMode(): DeploymentMode {
    return env.server.DEPLOYMENT_MODE ?? "self-hosted";
}

export function isCloudDeployment(): boolean {
    return getDeploymentMode() === "cloud";
}

/**
 * Self-hosted deployments record usage without gating on it.
 *
 * `record` rather than `off` because the ledger is genuinely useful to an
 * operator running on their own API keys — "which document burned 400k
 * embedding tokens" is answered by token_usage_daily and /api/credits/usage.
 * What it must not do is refuse work: there is no way to add credits from
 * anywhere in the product, so a balance gate on a self-hosted instance is a
 * one-way door.
 */
export function getMeteringMode(): MeteringMode {
    return isCloudDeployment() ? "enforce" : "record";
}

/**
 * Whether a balance check may refuse work, resolved from the environment.
 *
 * App-layer code must use this rather than the identically-named helper in
 * @launchstack/core/credits. That one reads the engine's metering slot, which
 * is only populated by createEngine — so anything running before an engine
 * exists (the signup routes, which create a token account for a company that
 * has just been inserted) would read "off" and take the wrong branch. Inside
 * packages/* the slot is correct and this module is unreachable by design.
 */
export function isMeteringEnforced(): boolean {
    return getMeteringMode() === "enforce";
}

let loggedMode = false;

/**
 * Log the resolved mode once at boot.
 *
 * This exists because the self-hosted default has one real cost: if the hosted
 * deployment ever loses its DEPLOYMENT_MODE variable, metering silently stops
 * and nothing else looks wrong. A line in the boot log — plus the same value on
 * /api/health — makes that visible instead of silent. Mirrors the
 * warn-once pattern in ~/app/api/metrics/route.ts.
 */
export function logDeploymentModeOnce(): void {
    if (loggedMode) return;
    loggedMode = true;
    const mode = getDeploymentMode();
    console.info(
        `[deployment] mode=${mode} metering=${getMeteringMode()}` +
            (mode === "self-hosted" && env.server.DEPLOYMENT_MODE == null
                ? " (DEPLOYMENT_MODE unset — defaulting to self-hosted)"
                : "")
    );
}
