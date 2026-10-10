/**
 * HTTP byte ranges (RFC 9110 §14) for the routes that serve stored files.
 *
 * A `<video>` or `<audio>` element asks for `Range: bytes=N-` whenever it
 * seeks, and an MP4 whose index sits at the end of the file is read that way
 * before the first frame. A server that ignores the header still plays from
 * the start, but the element cannot seek past what it has downloaded and
 * Safari refuses to play at all. So every route that hands out stored bytes
 * answers a single range with 206 and says `Accept-Ranges: bytes`.
 *
 * Only single ranges are honoured. A multi-range request is answered with the
 * whole file, which the RFC allows and which no media element ever sends.
 */

export type RangeOutcome =
    /** No range, or one the server is allowed to ignore: send everything (200). */
    | { kind: "full" }
    /** Inclusive byte offsets to send (206). */
    | { kind: "partial"; start: number; end: number }
    /** The range starts past the end of the file (416). */
    | { kind: "unsatisfiable" };

const BYTES_RANGE = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i;

/** What to send for a request's `Range` header against a file of `size` bytes. */
export function resolveByteRange(header: string | null | undefined, size: number): RangeOutcome {
    if (!header) return { kind: "full" };
    // Another unit, a multi-range list, or garbage: the header may be ignored.
    const match = BYTES_RANGE.exec(header.trim());
    if (!match) return { kind: "full" };
    const [, rawStart = "", rawEnd = ""] = match;

    if (rawStart === "") {
        // Suffix range: the last N bytes.
        if (rawEnd === "") return { kind: "full" };
        const suffix = Number(rawEnd);
        if (suffix === 0 || size === 0) return { kind: "unsatisfiable" };
        return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
    }

    const start = Number(rawStart);
    if (start >= size) return { kind: "unsatisfiable" };
    if (rawEnd === "") return { kind: "partial", start, end: size - 1 };

    const end = Number(rawEnd);
    // last-pos before first-pos makes the range invalid, and an invalid range is ignored.
    if (end < start) return { kind: "full" };
    return { kind: "partial", start, end: Math.min(end, size - 1) };
}

/** Headers for a 206 carrying `start..end` (inclusive) of a `size`-byte file. */
export function partialContentHeaders(
    range: { start: number; end: number },
    size: number
): Record<string, string> {
    return {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
    };
}

/** The 416 for a range that starts past the end of a `size`-byte file. */
export function rangeNotSatisfiable(size: number): Response {
    return new Response(null, {
        status: 416,
        headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
    });
}

/**
 * The fetch options that pass a browser's `Range` header on to storage, so a
 * proxied file is ranged where it lives instead of read whole and cut here.
 * Plain-object headers, because `fetchBlob` spreads them.
 */
export function forwardRangeInit(request: Request): RequestInit | undefined {
    const range = request.headers.get("range");
    return range ? { headers: { Range: range } } : undefined;
}

/**
 * Status and length headers for relaying a storage response. Storage that
 * honoured a forwarded range answers 206 (or 416) with its own
 * `Content-Range`; that is passed through untouched. Storage that ignored it
 * answers 200 with the whole body, which is still a correct reply.
 */
export function relayedRangeResponse(upstream: Response): {
    status: number;
    headers: Record<string, string>;
} {
    const headers: Record<string, string> = { "Accept-Ranges": "bytes" };
    const length = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (length) headers["Content-Length"] = length;
    if ((upstream.status === 206 || upstream.status === 416) && contentRange) {
        headers["Content-Range"] = contentRange;
        return { status: upstream.status, headers };
    }
    return { status: 200, headers };
}
