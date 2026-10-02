/**
 * The grant-search tool's environment reads — the only module in this tool
 * allowed to touch process.env (lint-enforced). Read at call time so the
 * tool works in any Node host.
 */

export const DEFAULT_GRANTS_GOV_API_URL = "https://api.grants.gov/v1/api";

/** Grants.gov's public search API. Free, no key; overridable for a mirror or a test double. */
export function getGrantsGovApiUrl(): string {
    const configured = process.env.GRANTS_GOV_API_URL?.trim();
    return configured ? configured.replace(/\/+$/, "") : DEFAULT_GRANTS_GOV_API_URL;
}

/** `GRANTS_GOV_ENABLED=0` turns the keyless source off (air-gapped deployments). */
export function isGrantsGovEnabled(): boolean {
    const value = process.env.GRANTS_GOV_ENABLED?.trim().toLowerCase();
    return !(value === "0" || value === "false" || value === "off");
}

/** The web provider needs a search key; the web-research tool owns those reads. */
export function hasWebSearchKey(): boolean {
    return Boolean(process.env.EXA_API_KEY?.trim()) || Boolean(process.env.SERPER_API_KEY?.trim());
}
