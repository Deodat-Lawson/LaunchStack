/**
 * The web-research tool's environment reads — the only module in this tool
 * allowed to touch process.env (lint-enforced). Keys are declared and
 * validated in apps/web/src/env.ts; these getters read them at call time so
 * the tool works in any Node host without a config bootstrap.
 */

import type { ProviderStrategy } from "./types";

export function getExaApiKey(): string | undefined {
    return process.env.EXA_API_KEY;
}

export function getSerperApiKey(): string | undefined {
    return process.env.SERPER_API_KEY;
}

/** SEARCH_PROVIDER env override; anything unrecognized falls back to "exa". */
export function getSearchStrategyFromEnv(): ProviderStrategy {
    const fromEnv = process.env.SEARCH_PROVIDER;
    if (fromEnv === "serper" || fromEnv === "fallback" || fromEnv === "parallel") {
        return fromEnv;
    }
    return "exa";
}
