/**
 * The place-search tool's environment reads — the only module in this tool
 * allowed to touch process.env (lint-enforced). The key is declared in
 * apps/web/src/env.ts; read at call time so the tool works in any Node host.
 */
export function getFoursquareServiceKey(): string | undefined {
    return process.env.FOURSQUARE_SERVICE_KEY;
}
