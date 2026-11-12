/**
 * The sign-in providers a deployment can offer, as the browser sees them.
 *
 * Client-safe on purpose (no env, no server imports): the sign-in, join and
 * invite pages, Settings › Account and the error sentences all name a
 * provider, and they take the list the server built from its environment
 * (~/server/auth/providers) rather than knowing the configuration themselves.
 *
 * `oidc` is the one provider whose name is not ours to spell: a self-hoster
 * points it at their own identity provider (Okta, Entra, Keycloak, Authentik…)
 * and names the button with AUTH_OIDC_NAME. The others are brands.
 */

/** Better Auth's provider ids, in the order the sign-in page lists them. */
export const SOCIAL_PROVIDER_IDS = ["oidc", "google", "microsoft", "github"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];

/** A provider this deployment offers, with the name its button and messages use. */
export interface SocialProvider {
    id: SocialProviderId;
    name: string;
}

/** The brands' names. Not translated: they are names. */
export const BRAND_PROVIDER_NAMES: Record<Exclude<SocialProviderId, "oidc">, string> = {
    google: "Google",
    microsoft: "Microsoft",
    github: "GitHub",
};

/** What the OIDC button says when the operator gave it no name: "Continue with SSO". */
export const DEFAULT_OIDC_NAME = "SSO";

/** Longest AUTH_OIDC_NAME shown; it sits inside a button and a dialog title. */
export const OIDC_NAME_MAX_LENGTH = 40;

export function isSocialProviderId(id: string): id is SocialProviderId {
    return (SOCIAL_PROVIDER_IDS as readonly string[]).includes(id);
}

/**
 * A provider's display name: the brand for the built-ins, the deployment's
 * own name for `oidc` when the offered list carries it. `undefined` for an id
 * we can't name, so callers fall back to their unnamed sentence.
 */
export function providerName(
    id: string | null | undefined,
    offered: readonly SocialProvider[] = []
): string | undefined {
    if (!id) return undefined;
    const fromList = offered.find(provider => provider.id === id)?.name;
    if (fromList) return fromList;
    return id in BRAND_PROVIDER_NAMES
        ? BRAND_PROVIDER_NAMES[id as keyof typeof BRAND_PROVIDER_NAMES]
        : undefined;
}

/** AUTH_OIDC_NAME as the page shows it: trimmed, bounded, defaulted. */
export function cleanOidcName(raw: string | null | undefined): string {
    const name = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, OIDC_NAME_MAX_LENGTH).trim();
    return name || DEFAULT_OIDC_NAME;
}
