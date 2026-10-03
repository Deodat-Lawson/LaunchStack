/**
 * One way to talk to LinkedIn: base URL and version resolution, the Rest.li
 * 2.0 headers, URN encoding, and turning a non-2xx answer into a classified
 * LinkedInApiError (reconnect vs retry vs give up).
 */
import { getLinkedInApiBaseUrl, getLinkedInApiVersion } from "../config";
import { nonBlank } from "../text";
import { LinkedInApiError, type FetchLike, type LinkedInClientOptions } from "./types";

export interface LinkedInContext {
    token: string;
    base: string;
    version: string;
    fetch: FetchLike;
}

export function linkedInContext(opts: LinkedInClientOptions): LinkedInContext {
    return {
        token: opts.accessToken,
        base: (nonBlank(opts.apiBaseUrl) ?? getLinkedInApiBaseUrl()).replace(/\/+$/, ""),
        version: nonBlank(opts.version) ?? getLinkedInApiVersion(),
        // Resolved per call so a test (or the host) can swap the global fetch.
        fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
    };
}

/**
 * Rest.li 2.0 wants URNs in paths and query values fully percent-encoded,
 * including the parentheses and commas of compound URNs
 * (`urn:li:comment:(urn:li:activity:1,2)`), which encodeURIComponent leaves
 * alone.
 */
export function encodeUrn(urn: string): string {
    return encodeURIComponent(urn).replace(
        /[!'()*]/g,
        ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

export interface LinkedInRequest {
    /** Path under the API base (`/rest/…`, `/v2/…`) or an absolute URL (an upload URL). */
    path: string;
    method?: string;
    /** What the call does, for error messages: "publish the post", "list Pages". */
    what: string;
    /** Send the versioned-API headers. Defaults to true for `/rest/` paths. */
    versioned?: boolean;
    headers?: Record<string, string>;
    json?: unknown;
    body?: Uint8Array;
    /** Non-2xx statuses the caller handles itself (404 on delete, 403 on a probe). */
    allow?: number[];
}

export async function linkedInRequest(
    ctx: LinkedInContext,
    req: LinkedInRequest
): Promise<Response> {
    const absolute = /^https?:\/\//i.test(req.path);
    const url = absolute ? req.path : `${ctx.base}${req.path}`;
    const versioned = req.versioned ?? (!absolute && req.path.startsWith("/rest/"));

    const headers: Record<string, string> = { Authorization: `Bearer ${ctx.token}` };
    if (versioned) {
        headers["LinkedIn-Version"] = ctx.version;
        headers["X-Restli-Protocol-Version"] = "2.0.0";
    }
    let body: RequestInit["body"];
    if (req.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(req.json);
    } else if (req.body) {
        body = req.body as unknown as RequestInit["body"];
    }
    Object.assign(headers, req.headers);

    let res: Response;
    try {
        res = await ctx.fetch(url, { method: req.method ?? "GET", headers, body });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new LinkedInApiError(
            `LinkedIn could not be reached to ${req.what}: ${reason}`,
            0,
            false,
            true
        );
    }
    if (res.ok || req.allow?.includes(res.status)) return res;
    throw await linkedInError(res, req.what);
}

/** A 403 that is about the token itself rather than a missing permission. */
const TOKEN_PROBLEM = /(expired|revoked|invalid[^.]*token)/i;

export async function linkedInError(res: Response, what: string): Promise<LinkedInApiError> {
    const body = await res.text().catch(() => "");
    const detail = errorDetail(body);
    const status = res.status;
    const authFailed = status === 401 || (status === 403 && TOKEN_PROBLEM.test(detail || body));
    const retryable = status === 429 || status >= 500;
    const suffix = detail ? `: ${detail}` : "";

    let message: string;
    if (authFailed) {
        message = `LinkedIn refused the access token while trying to ${what} (HTTP ${status})${suffix}. Reconnect LinkedIn.`;
    } else if (status === 403) {
        message = `LinkedIn denied permission to ${what} (HTTP 403)${suffix || ": the connection lacks a permission LinkedIn requires for this"}`;
    } else if (status === 429) {
        message = `LinkedIn rate-limited the request to ${what} (HTTP 429)${suffix}. Try again later.`;
    } else {
        message = `LinkedIn could not ${what} (HTTP ${status})${suffix}`;
    }
    return new LinkedInApiError(message, status, authFailed, retryable, body);
}

function errorDetail(body: string): string {
    if (!body.trim()) return "";
    try {
        const parsed = JSON.parse(body) as {
            message?: unknown;
            error_description?: unknown;
            error?: unknown;
        };
        for (const value of [parsed.message, parsed.error_description, parsed.error]) {
            if (typeof value === "string" && value.trim()) return value.trim();
        }
        return "";
    } catch {
        return body.trim().slice(0, 300);
    }
}

/** `x-restli-id` is sometimes percent-encoded (`urn%3Ali%3Ashare%3A1`). */
export function decodeId(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    try {
        return decodeURIComponent(trimmed);
    } catch {
        return trimmed;
    }
}

/** The JSON body, or null when there is none (201/204 with an empty body). */
export async function readJson<T>(res: Response): Promise<T | null> {
    const text = await res.text().catch(() => "");
    if (!text.trim()) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]!);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
