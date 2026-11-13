/**
 * Which search engine LaunchStack uses: one choice for every feature.
 *
 *  - SEARCH_PROVIDER names it (exa | serper | brave | tavily | searxng). A
 *    named provider without its key or address turns search off, with the
 *    reason logged and shown in Settings — never a quiet switch to another
 *    engine.
 *  - Unset, the first provider whose credential is present wins, in
 *    SEARCH_PROVIDER_IDS order (Exa first, as before this setting existed).
 *  - The retired trend-search strategies `fallback` and `parallel` count as
 *    unset, so old configurations keep working.
 *
 * Read at call time: a changed environment applies to the next search.
 */

import { getSearchProviderSetting } from "./config";
import { SEARCH_PROVIDERS } from "./providers/registry";
import { SEARCH_PROVIDER_IDS, type SearchProvider, type SearchProviderId } from "./types";

const RETIRED_SETTINGS = new Set(["fallback", "parallel"]);

export type SearchSetupProblem = "missing-credentials" | "unknown-provider";

export interface SearchSetup {
    /** The engine in use; null when web search is off. */
    provider: SearchProvider | null;
    /** "setting" when SEARCH_PROVIDER chose it, "auto" when the first configured one did. */
    source: "setting" | "auto" | null;
    /** SEARCH_PROVIDER as written (lower-cased), when set. */
    requested: string | null;
    /** Why a named provider isn't in use. */
    problem: SearchSetupProblem | null;
}

export function isSearchProviderId(value: string): value is SearchProviderId {
    return (SEARCH_PROVIDER_IDS as readonly string[]).includes(value);
}

const warned = new Set<string>();

/** Each configuration problem is logged once per process, not once per search. */
function warnOnce(message: string): void {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(`[web-search] ${message}`);
}

export function resolveSearchSetup(): SearchSetup {
    const requested = getSearchProviderSetting() ?? null;

    if (requested && !RETIRED_SETTINGS.has(requested)) {
        if (!isSearchProviderId(requested)) {
            warnOnce(
                `SEARCH_PROVIDER="${requested}" is not a search provider ` +
                    `(${SEARCH_PROVIDER_IDS.join(", ")}); web search is off.`
            );
            return { provider: null, source: "setting", requested, problem: "unknown-provider" };
        }
        const provider = SEARCH_PROVIDERS[requested];
        if (!provider.isConfigured()) {
            warnOnce(
                `SEARCH_PROVIDER=${requested} needs ${provider.credential}; web search is off.`
            );
            return { provider: null, source: "setting", requested, problem: "missing-credentials" };
        }
        return { provider, source: "setting", requested, problem: null };
    }

    if (requested) {
        warnOnce(
            `SEARCH_PROVIDER=${requested} is no longer supported; using the first configured provider.`
        );
    }
    const provider =
        SEARCH_PROVIDER_IDS.map(id => SEARCH_PROVIDERS[id]).find(p => p.isConfigured()) ?? null;
    return { provider, source: provider ? "auto" : null, requested, problem: null };
}

/** The engine every search uses now, or null when web search is off. */
export function activeSearchProvider(): SearchProvider | null {
    return resolveSearchSetup().provider;
}

/** The search setup in plain data, for Settings and diagnostics. Never includes a key. */
export interface SearchSetupView {
    provider: SearchProviderId | null;
    label: string | null;
    source: SearchSetup["source"];
    requested: string | null;
    problem: SearchSetupProblem | null;
    /** The setting the engine in use (or the one named but unusable) needs. */
    credential: string | null;
    capabilities: { web: boolean; news: boolean; companies: boolean };
    providers: Array<{
        id: SearchProviderId;
        label: string;
        credential: string;
        configured: boolean;
        companies: boolean;
    }>;
}

export function describeSearchSetup(): SearchSetupView {
    const setup = resolveSearchSetup();
    const named =
        setup.requested && isSearchProviderId(setup.requested)
            ? SEARCH_PROVIDERS[setup.requested]
            : null;
    const shown = setup.provider ?? (setup.problem === "missing-credentials" ? named : null);
    return {
        provider: setup.provider?.id ?? null,
        label: shown?.label ?? null,
        source: setup.source,
        requested: setup.requested,
        problem: setup.problem,
        credential: shown?.credential ?? null,
        capabilities: {
            web: setup.provider !== null,
            news: setup.provider !== null,
            companies: Boolean(setup.provider?.companies),
        },
        providers: SEARCH_PROVIDER_IDS.map(id => {
            const p = SEARCH_PROVIDERS[id];
            return {
                id,
                label: p.label,
                credential: p.credential,
                configured: p.isConfigured(),
                companies: Boolean(p.companies),
            };
        }),
    };
}

/** Why a search can't run, for the error a caller sees. */
export function searchOffReason(setup: SearchSetup = resolveSearchSetup()): string {
    if (setup.problem === "missing-credentials" && setup.requested) {
        const credential = isSearchProviderId(setup.requested)
            ? SEARCH_PROVIDERS[setup.requested].credential
            : "its key";
        return `Web search is off: SEARCH_PROVIDER=${setup.requested} needs ${credential}.`;
    }
    if (setup.problem === "unknown-provider") {
        return `Web search is off: SEARCH_PROVIDER="${setup.requested}" is not a search provider.`;
    }
    return "No web search provider is configured (set SEARCH_PROVIDER and its key).";
}
