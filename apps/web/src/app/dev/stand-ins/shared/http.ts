/**
 * Request/response plumbing shared by the LinkedIn and Bluesky stand-ins.
 * Everything here works on the standard `Request` / `Response` globals so the
 * dispatchers run the same under Next route handlers and under jest.
 */

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            ...headers,
        },
    });
}

export function empty(status: number, headers?: Record<string, string>): Response {
    return new Response(null, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function bytes(data: Uint8Array<ArrayBuffer>, contentType: string): Response {
    return new Response(data, {
        status: 200,
        headers: { "content-type": contentType, "cache-control": "no-store" },
    });
}

export function redirect(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location, "cache-control": "no-store" } });
}

/**
 * The origin the caller used to reach us. Behind Next's dev server the
 * forwarded headers are authoritative; jest requests only carry the URL.
 */
export function originOf(req: Request): string {
    const url = new URL(req.url);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
    const proto = (req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", ""))
        .split(",")[0]!
        .trim();
    return `${proto}://${host.split(",")[0]!.trim()}`;
}

/**
 * Path segments after `base` (e.g. "/dev/stand-ins/linkedin"), each
 * percent-decoded once — LinkedIn URNs travel encoded in paths.
 */
export function segmentsAfter(req: Request, base: string): string[] {
    const { pathname } = new URL(req.url);
    const at = pathname.indexOf(base);
    const rest = at === -1 ? pathname : pathname.slice(at + base.length);
    return rest
        .split("/")
        .filter(Boolean)
        .map(seg => {
            try {
                return decodeURIComponent(seg);
            } catch {
                return seg;
            }
        });
}

/** The raw (still percent-encoded) value of a query parameter, for Rest.li parsing. */
export function rawQueryParam(req: Request, name: string): string | null {
    const query = new URL(req.url).search.replace(/^\?/, "");
    for (const pair of query.split("&")) {
        const eq = pair.indexOf("=");
        const key = eq === -1 ? pair : pair.slice(0, eq);
        let decodedKey = key;
        try {
            decodedKey = decodeURIComponent(key);
        } catch {
            // keep the raw key
        }
        if (decodedKey === name) return eq === -1 ? "" : pair.slice(eq + 1);
    }
    return null;
}

export async function readForm(req: Request): Promise<URLSearchParams> {
    const text = await req.text();
    return new URLSearchParams(text);
}

export async function readJson(req: Request): Promise<unknown> {
    const text = await req.text();
    if (!text.trim()) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

export function bearerToken(req: Request): string | null {
    const header = req.headers.get("authorization");
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1]!.trim() : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A recent-call log entry, shown on the stand-in pages. */
export interface CallLogEntry {
    at: number;
    method: string;
    path: string;
    status: number;
}

export function pushCall(log: CallLogEntry[], entry: CallLogEntry, max = 40): void {
    log.unshift(entry);
    if (log.length > max) log.length = max;
}

/** Path + query, without the stand-in base, for the call log. */
export function displayPath(req: Request, base: string): string {
    const url = new URL(req.url);
    const at = url.pathname.indexOf(base);
    const path = at === -1 ? url.pathname : url.pathname.slice(at + base.length);
    let shown = path + url.search;
    try {
        shown = decodeURIComponent(shown);
    } catch {
        // keep it encoded
    }
    return shown.length > 160 ? `${shown.slice(0, 157)}…` : shown;
}
