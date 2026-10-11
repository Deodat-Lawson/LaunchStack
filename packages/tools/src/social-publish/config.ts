/**
 * The social-publish tool's environment reads — the only module in this tool
 * allowed to touch process.env (lint-enforced). All keys are declared in
 * apps/web/src/env.ts; read at call time so missing credentials degrade to a
 * clear per-platform error instead of a boot failure.
 */

import { nonBlank } from "./text";

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
    return nonBlank(process.env.LINKEDIN_API_VERSION) ?? "202609";
}

/**
 * Where LinkedIn calls go. Production leaves it unset; a dev stand-in (for
 * example http://localhost:3042/dev/stand-ins/linkedin) is pointed at here.
 */
export function getLinkedInApiBaseUrl(): string {
    return withoutTrailingSlash(process.env.LINKEDIN_API_BASE_URL, "https://api.linkedin.com");
}

/** The Bluesky PDS that signs in and writes (createSession, uploadBlob, createRecord). */
export function getBlueskyServiceUrl(): string {
    return withoutTrailingSlash(process.env.BLUESKY_SERVICE_URL, "https://bsky.social");
}

/** The public Bluesky AppView for unauthenticated reads (profiles, post counts, threads). */
export function getBlueskyAppViewUrl(): string {
    return withoutTrailingSlash(process.env.BLUESKY_APPVIEW_URL, "https://public.api.bsky.app");
}

function withoutTrailingSlash(value: string | undefined, fallback: string): string {
    return (nonBlank(value) ?? fallback).replace(/\/+$/, "");
}
