/**
 * The social sign-in providers this deployment holds credentials for.
 *
 * One reader for both sides of the contract: the auth instance registers
 * exactly these, and the sign-in page renders a button for exactly these. If
 * the two drifted, a button would lead to better-auth's "provider not found".
 *
 * Plain process.env and one pure module: the auth instance sits in the
 * middleware bundle, and the sign-in page reads this at request time so a
 * prebuilt image picks up credentials added after the build.
 */
import {
    BRAND_PROVIDER_NAMES,
    cleanOidcName,
    SOCIAL_PROVIDER_IDS,
    type SocialProvider,
    type SocialProviderId,
} from "~/lib/auth/providers";

export type { SocialProvider, SocialProviderId } from "~/lib/auth/providers";

/** Where Microsoft accounts sign in when the deployment names no other cloud. */
const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com";

/** The OpenID discovery document's place under an issuer. */
const DISCOVERY_SUFFIX = "/.well-known/openid-configuration";

function both(
    id: string | undefined,
    secret: string | undefined
): { id: string; secret: string } | null {
    return id && secret ? { id, secret } : null;
}

function httpUrl(raw: string | undefined): URL | null {
    if (!raw) return null;
    try {
        const url = new URL(raw.trim());
        return url.protocol === "https:" || url.protocol === "http:" ? url : null;
    } catch {
        return null;
    }
}

/**
 * Microsoft sign-in (work, school and personal accounts), or null.
 *
 * AUTH_MICROSOFT_TENANT_ID narrows who can sign in: `common` (the default)
 * takes any Microsoft account, `organizations` only work and school
 * accounts, `consumers` only personal ones, and a tenant id one company.
 * AUTH_MICROSOFT_AUTHORITY moves sign-in to a national cloud
 * (https://login.chinacloudapi.cn, https://login.microsoftonline.us).
 */
export function microsoftSignInConfig() {
    const credentials = both(
        process.env.AUTH_MICROSOFT_CLIENT_ID,
        process.env.AUTH_MICROSOFT_CLIENT_SECRET
    );
    if (!credentials) return null;
    const authority = httpUrl(process.env.AUTH_MICROSOFT_AUTHORITY);
    // An empty value (Compose passes unset as "") means the default too.
    const tenant = process.env.AUTH_MICROSOFT_TENANT_ID?.trim();
    return {
        clientId: credentials.id,
        clientSecret: credentials.secret,
        tenantId: tenant === undefined || tenant === "" ? "common" : tenant,
        authority: authority ? authority.origin : MICROSOFT_AUTHORITY,
    };
}

/**
 * The deployment's own OpenID Connect identity provider, or null.
 *
 * AUTH_OIDC_ISSUER is the issuer URL (the one its discovery document lives
 * under); the full discovery URL is accepted too.
 */
export function oidcSignInConfig() {
    const credentials = both(process.env.AUTH_OIDC_CLIENT_ID, process.env.AUTH_OIDC_CLIENT_SECRET);
    const issuer = httpUrl(process.env.AUTH_OIDC_ISSUER);
    if (!credentials || !issuer) return null;
    const base = issuer.href.replace(/\/+$/, "");
    return {
        clientId: credentials.id,
        clientSecret: credentials.secret,
        discoveryUrl: base.endsWith(DISCOVERY_SUFFIX) ? base : `${base}${DISCOVERY_SUFFIX}`,
        name: cleanOidcName(process.env.AUTH_OIDC_NAME),
    };
}

function isEnabled(id: SocialProviderId): boolean {
    switch (id) {
        case "google":
            return Boolean(
                both(process.env.AUTH_GOOGLE_CLIENT_ID, process.env.AUTH_GOOGLE_CLIENT_SECRET)
            );
        case "github":
            return Boolean(
                both(process.env.AUTH_GITHUB_CLIENT_ID, process.env.AUTH_GITHUB_CLIENT_SECRET)
            );
        case "microsoft":
            return microsoftSignInConfig() !== null;
        case "oidc":
            return oidcSignInConfig() !== null;
    }
}

/** The providers to register and to show, in the order the page lists them. */
export function enabledSocialProviders(): SocialProvider[] {
    return SOCIAL_PROVIDER_IDS.filter(isEnabled).map(id => ({
        id,
        name: id === "oidc" ? oidcSignInConfig()!.name : BRAND_PROVIDER_NAMES[id],
    }));
}
