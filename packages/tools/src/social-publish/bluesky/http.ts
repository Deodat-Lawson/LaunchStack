/**
 * XRPC plumbing for the Bluesky client: endpoint resolution, error
 * classification, and the session cache (one signed-in session per PDS and
 * account, reused for 55 minutes, renewed once when Bluesky says it expired).
 */
import { getBlueskyAppViewUrl, getBlueskyServiceUrl } from "../config";
import {
    BlueskyApiError,
    type BlueskyCredentials,
    type BlueskyOptions,
    type FetchLike,
} from "./types";

export interface BlueskyContext {
    /** The PDS: sign-in and writes. */
    service: string;
    /** The public AppView: unauthenticated reads. */
    appView: string;
    fetch: FetchLike;
}

const trimSlash = (url: string) => url.trim().replace(/\/+$/, "");

export function blueskyContext(
    creds: Pick<BlueskyCredentials, "service"> | null,
    opts: BlueskyOptions = {}
): BlueskyContext {
    return {
        service: creds?.service?.trim() ? trimSlash(creds.service) : getBlueskyServiceUrl(),
        appView: opts.appViewUrl?.trim() ? trimSlash(opts.appViewUrl) : getBlueskyAppViewUrl(),
        // Resolved per call so a test (or the host) can swap the global fetch.
        fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
    };
}

export interface XrpcRequest {
    base: string;
    nsid: string;
    method?: "GET" | "POST";
    /** Query parameters; an array value repeats the key (`uris=a&uris=b`). */
    query?: Record<string, string | number | string[] | undefined>;
    json?: unknown;
    /** Raw bytes (uploadBlob), sent with `contentType`. */
    bytes?: Uint8Array;
    contentType?: string;
    accessJwt?: string;
    /** What the call does, for error messages. */
    what: string;
    /** The message for a refused credential, when the caller has a better one. */
    authMessage?: string;
}

export async function xrpc(ctx: BlueskyContext, req: XrpcRequest): Promise<Response> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query ?? {})) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v));
    }
    const qs = params.toString();
    const url = `${req.base}/xrpc/${req.nsid}${qs ? `?${qs}` : ""}`;

    const headers: Record<string, string> = {};
    if (req.accessJwt) headers.Authorization = `Bearer ${req.accessJwt}`;
    let body: RequestInit["body"];
    if (req.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(req.json);
    } else if (req.bytes) {
        headers["Content-Type"] = req.contentType ?? "application/octet-stream";
        body = req.bytes as unknown as RequestInit["body"];
    }

    let res: Response;
    try {
        res = await ctx.fetch(url, { method: req.method ?? "GET", headers, body });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new BlueskyApiError(
            `Bluesky could not be reached to ${req.what}: ${reason}`,
            0,
            false,
            true
        );
    }
    if (res.ok) return res;
    throw await blueskyError(res, req.what, req.authMessage);
}

/** The XRPC `error` code in a failure body (`ExpiredToken`, `NotFound`, …). */
export function xrpcErrorCode(body: string): string | null {
    try {
        const parsed = JSON.parse(body) as { error?: unknown };
        return typeof parsed.error === "string" ? parsed.error : null;
    } catch {
        return null;
    }
}

const TOKEN_ERRORS = new Set(["ExpiredToken", "InvalidToken", "AuthenticationRequired"]);

async function blueskyError(
    res: Response,
    what: string,
    authMessage?: string
): Promise<BlueskyApiError> {
    const body = await res.text().catch(() => "");
    const status = res.status;
    const code = xrpcErrorCode(body);
    let detail = "";
    try {
        const parsed = JSON.parse(body) as { message?: unknown };
        if (typeof parsed.message === "string") detail = parsed.message.trim();
    } catch {
        detail = body.trim().slice(0, 300);
    }
    detail ||= code ?? "";

    const authFailed =
        status === 401 || (status === 400 && code !== null && TOKEN_ERRORS.has(code));
    const retryable = status === 429 || status >= 500;
    const suffix = detail ? `: ${detail}` : "";

    let message: string;
    if (authFailed) {
        message =
            authMessage ??
            `Bluesky refused the session while trying to ${what} (HTTP ${status})${suffix}. Reconnect Bluesky.`;
    } else if (status === 429) {
        message = `Bluesky rate-limited the request to ${what} (HTTP 429)${suffix}. Try again later.`;
    } else {
        message = `Bluesky could not ${what} (HTTP ${status})${suffix}`;
    }
    return new BlueskyApiError(message, status, authFailed, retryable, body);
}

/** The JSON body, or null when there is none. */
export async function readJson<T>(res: Response): Promise<T | null> {
    const text = await res.text().catch(() => "");
    if (!text.trim()) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Sessions

export interface BlueskySession {
    accessJwt: string;
    did: string;
    handle: string;
}

interface CachedSession extends BlueskySession {
    appPassword: string;
    expiresAt: number;
}

/**
 * Bluesky access JWTs live about two hours; signing in for every call burns
 * a round-trip and createSession's tight rate limit. Sessions are reused for
 * 55 minutes per (PDS, identifier).
 */
const SESSION_TTL_MS = 55 * 60 * 1000;
const sessions = new Map<string, CachedSession>();

const normalizeIdentifier = (identifier: string) => identifier.trim().replace(/^@/, "");

const sessionKey = (service: string, identifier: string) =>
    `${service} ${normalizeIdentifier(identifier).toLowerCase()}`;

/** Test seam: forget every cached session. */
export function resetBlueskySessions(): void {
    sessions.clear();
}

export const BLUESKY_SIGN_IN_REFUSED = "Bluesky refused that handle and app password";

/** Sign in (always a new session) and cache it. */
export async function createSession(
    ctx: BlueskyContext,
    creds: BlueskyCredentials
): Promise<BlueskySession> {
    const identifier = normalizeIdentifier(creds.identifier);
    const res = await xrpc(ctx, {
        base: ctx.service,
        nsid: "com.atproto.server.createSession",
        method: "POST",
        json: { identifier, password: creds.appPassword },
        what: "sign in",
        authMessage: BLUESKY_SIGN_IN_REFUSED,
    });
    const data = await readJson<{ accessJwt?: string; did?: string; handle?: string }>(res);
    if (!data?.accessJwt || !data.did) {
        throw new BlueskyApiError("Bluesky sign-in returned no session.", res.status, false, true);
    }
    const session: CachedSession = {
        accessJwt: data.accessJwt,
        did: data.did,
        handle: data.handle ?? identifier,
        appPassword: creds.appPassword,
        expiresAt: Date.now() + SESSION_TTL_MS,
    };
    sessions.set(sessionKey(ctx.service, identifier), session);
    return session;
}

/**
 * Run `fn` with a signed-in session: the cached one when still fresh,
 * otherwise a new sign-in. If Bluesky refuses a cached session (expired or
 * revoked JWT), sign in again once and retry; a refusal of a fresh sign-in
 * is final.
 */
export async function withSession<T>(
    ctx: BlueskyContext,
    creds: BlueskyCredentials,
    fn: (session: BlueskySession) => Promise<T>
): Promise<T> {
    const key = sessionKey(ctx.service, creds.identifier);
    const cached = sessions.get(key);
    const usable =
        cached && cached.expiresAt > Date.now() && cached.appPassword === creds.appPassword
            ? cached
            : null;
    const session = usable ?? (await createSession(ctx, creds));
    try {
        return await fn(session);
    } catch (err) {
        if (!usable || !(err instanceof BlueskyApiError) || !err.authFailed) throw err;
        sessions.delete(key);
        return fn(await createSession(ctx, creds));
    }
}
