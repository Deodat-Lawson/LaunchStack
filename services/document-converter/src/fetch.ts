/**
 * Outbound document fetching, constrained by the startup allowlist.
 *
 * The old services fetched arbitrary request-supplied URLs from inside the
 * network (SSRF: cloud metadata endpoints, internal services, file
 * exfiltration) with no size cap (disk/memory fill). Here every
 * documentUrl/url must be http(s) AND its origin must appear in
 * ALLOWED_FETCH_ORIGINS, downloads are size-capped while streaming, and
 * every fetch carries a timeout.
 */
import type { Config } from "./config.js";
import { ServiceError, errorMessage } from "./errors.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Validate a request-supplied URL against the origin allowlist.
 * Rejections use the typed code "url-not-allowed" (HTTP 400).
 */
export function assertAllowedUrl(config: Config, rawUrl: string, field: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new ServiceError(400, "url-not-allowed", `${field} is not a valid URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ServiceError(
            400,
            "url-not-allowed",
            `${field} scheme "${parsed.protocol}" is not allowed; only http and https are supported`
        );
    }
    if (!config.allowedFetchOrigins.includes(parsed.origin)) {
        throw new ServiceError(
            400,
            "url-not-allowed",
            `${field} origin ${parsed.origin} is not in ALLOWED_FETCH_ORIGINS`
        );
    }
    return parsed;
}

/**
 * Fetch a document from an allow-listed origin into memory, enforcing
 * `maxFetchBytes` while streaming and `fetchTimeoutMs` overall.
 *
 * Redirects are refused: only the initial URL is validated against the
 * allowlist, so following a redirect could tunnel to a non-allow-listed
 * origin.
 */
export async function fetchDocument(
    config: Config,
    fetchImpl: FetchLike,
    rawUrl: string,
    field = "url"
): Promise<Buffer> {
    const url = assertAllowedUrl(config, rawUrl, field);

    let response: Response;
    try {
        response = await fetchImpl(url.toString(), {
            redirect: "error",
            signal: AbortSignal.timeout(config.fetchTimeoutMs),
        });
    } catch (err) {
        throw new ServiceError(502, "fetch-failed", `document fetch failed: ${errorMessage(err)}`);
    }

    if (!response.ok) {
        throw new ServiceError(
            502,
            "fetch-failed",
            `document fetch returned HTTP ${response.status}`
        );
    }

    const tooLarge = () =>
        new ServiceError(
            413,
            "fetch-too-large",
            `document exceeds MAX_FETCH_BYTES (${config.maxFetchBytes} bytes)`
        );

    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > config.maxFetchBytes) {
        throw tooLarge();
    }

    if (!response.body) {
        const buf = Buffer.from(await response.arrayBuffer());
        if (buf.byteLength > config.maxFetchBytes) throw tooLarge();
        return buf;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > config.maxFetchBytes) {
                await reader.cancel();
                throw tooLarge();
            }
            chunks.push(Buffer.from(value));
        }
    } catch (err) {
        if (err instanceof ServiceError) throw err;
        throw new ServiceError(
            502,
            "fetch-failed",
            `document download failed: ${errorMessage(err)}`
        );
    }
    return Buffer.concat(chunks);
}
