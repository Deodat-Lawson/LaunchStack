/**
 * The web-research tool's environment reads — the only module in this tool
 * allowed to touch process.env (lint-enforced). Keys are declared and
 * validated in apps/web/src/env.ts; these getters read them at call time so
 * the tool works in any Node host without a config bootstrap.
 *
 * An empty value is the same as unset: Compose passes every allowlisted
 * variable, set or not.
 */

function read(name: string): string | undefined {
    const value = process.env[name]?.trim();
    // An empty string is unset too, which `??` would keep.
    if (!value) return undefined;
    return value;
}

export function getExaApiKey(): string | undefined {
    return read("EXA_API_KEY");
}

export function getSerperApiKey(): string | undefined {
    return read("SERPER_API_KEY");
}

export function getBraveSearchApiKey(): string | undefined {
    return read("BRAVE_SEARCH_API_KEY");
}

export function getTavilyApiKey(): string | undefined {
    return read("TAVILY_API_KEY");
}

/** The SearXNG instance's address, e.g. `http://searxng:8080`. */
export function getSearxngUrl(): string | undefined {
    return read("SEARXNG_URL");
}

/** SEARCH_PROVIDER as written, lower-cased; undefined when unset or empty. */
export function getSearchProviderSetting(): string | undefined {
    return read("SEARCH_PROVIDER")?.toLowerCase();
}
