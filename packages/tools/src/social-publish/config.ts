/**
 * The social-publish tool's environment reads — the only module in this tool
 * allowed to touch process.env (lint-enforced). All keys are declared in
 * apps/web/src/env.ts; read at call time so missing credentials degrade to a
 * clear per-platform error instead of a boot failure.
 */

export function getTwitterBearerToken(): string | undefined {
    return process.env.TWITTER_BEARER_TOKEN;
}

export function getBlueskyCredentials(): { handle: string; appPassword: string } | null {
    const handle = process.env.BLUESKY_HANDLE;
    const appPassword = process.env.BLUESKY_APP_PASSWORD;
    if (!handle || !appPassword) return null;
    return { handle, appPassword };
}

export function getRedditCredentials(): {
    clientId: string;
    clientSecret: string;
    userAgent: string;
} | null {
    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    const userAgent = process.env.REDDIT_USER_AGENT;
    if (!clientId || !clientSecret || !userAgent) return null;
    return { clientId, clientSecret, userAgent };
}

export function getLinkedInAccessToken(): string | undefined {
    return process.env.LINKEDIN_ACCESS_TOKEN;
}

/**
 * The versioned Posts API requires a `LinkedIn-Version` header in YYYYMM form.
 * LinkedIn only supports each version for ~12 months, so this default must be
 * rotated within that window as new versions ship; override via env.
 */
export function getLinkedInApiVersion(): string {
    return process.env.LINKEDIN_API_VERSION ?? "202506";
}
