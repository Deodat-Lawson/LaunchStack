/**
 * "Connect OpenRouter": the one subscription-style sign-in an app can offer
 * without the provider's approval.
 *
 * OpenRouter's OAuth PKCE flow (https://openrouter.ai/docs/use-cases/oauth-pkce)
 * needs no client registration. The admin approves on openrouter.ai, comes
 * back with a one-time code, and the server trades it for an API key on the
 * admin's own OpenRouter account — billed to their credits, revocable from
 * their OpenRouter dashboard. The key is then stored like any typed key.
 *
 * The verifier and state ride in a short-lived httpOnly cookie scoped to the
 * callback path, together with the workspace the flow started in; the
 * callback refuses if any of them don't match.
 */

import { createHash, randomBytes } from "node:crypto";

import { getModelProvider } from "~/lib/ai/model-providers";

export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
export const OPENROUTER_BASE_URL = getModelProvider("openrouter").baseUrl;

export const OPENROUTER_COOKIE = "ls_openrouter_pkce";
export const OPENROUTER_CALLBACK_PATH = "/api/settings/models/workspace/openrouter/callback";
/** Codes expire after ten minutes on OpenRouter's side; the cookie matches. */
export const OPENROUTER_COOKIE_MAX_AGE = 600;

export interface PkceFlow {
    verifier: string;
    challenge: string;
    state: string;
}

export function createPkceFlow(): PkceFlow {
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge, state: randomBytes(24).toString("base64url") };
}

export interface FlowCookie {
    v: string;
    s: string;
    /** The workspace the flow started in. */
    c: string;
}

export function encodeFlowCookie(cookie: FlowCookie): string {
    return Buffer.from(JSON.stringify(cookie)).toString("base64url");
}

export function decodeFlowCookie(raw: string | undefined | null): FlowCookie | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(
            Buffer.from(raw, "base64url").toString("utf8")
        ) as Partial<FlowCookie>;
        if (
            typeof value.v !== "string" ||
            typeof value.s !== "string" ||
            typeof value.c !== "string"
        ) {
            return null;
        }
        return { v: value.v, s: value.s, c: value.c };
    } catch {
        return null;
    }
}

/** Where the app is reachable from outside, for OpenRouter's redirect. */
export function appOrigin(request: Request): string {
    for (const candidate of [process.env.APP_PUBLIC_URL, process.env.BETTER_AUTH_URL]) {
        const raw = candidate?.trim();
        if (!raw) continue;
        try {
            return new URL(raw).origin;
        } catch {
            // fall through to the next candidate
        }
    }
    return new URL(request.url).origin;
}

export function openRouterAuthorizeUrl(flow: PkceFlow, callbackUrl: string): string {
    const url = new URL(OPENROUTER_AUTH_URL);
    url.searchParams.set("callback_url", callbackUrl);
    url.searchParams.set("code_challenge", flow.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", flow.state);
    return url.toString();
}

export class OpenRouterExchangeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OpenRouterExchangeError";
    }
}

/** Trade the one-time code for a key on the admin's OpenRouter account. */
export async function exchangeOpenRouterCode(
    code: string,
    verifier: string,
    fetchImpl: typeof fetch = fetch
): Promise<string> {
    const response = await fetchImpl(OPENROUTER_KEY_EXCHANGE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            code,
            code_verifier: verifier,
            code_challenge_method: "S256",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
        throw new OpenRouterExchangeError(`OpenRouter refused the code (HTTP ${response.status}).`);
    }
    const body = (await response.json().catch(() => null)) as { key?: unknown } | null;
    if (typeof body?.key !== "string" || body.key.trim() === "") {
        throw new OpenRouterExchangeError("OpenRouter didn't return a key.");
    }
    return body.key.trim();
}
