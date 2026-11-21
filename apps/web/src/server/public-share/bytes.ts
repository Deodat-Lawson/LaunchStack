/**
 * A shared file's stored bytes, read the way `/api/files/:id` and
 * `/api/documents/:id/content` read them, but keyed only on the document row
 * a public link resolved to — never on an id or URL the caller sent.
 *
 * A document's `url` is one of:
 * - `/api/files/<id>`: a `file_uploads` row, held in the database or proxied
 *   from S3/SeaweedFS/private Blob (it must belong to the link's workspace);
 * - an S3 or private Blob URL, fetched with the server's credentials;
 * - a public http(s) URL (UploadThing, a public bucket), which the browser
 *   may fetch itself.
 */

import { and, eq } from "drizzle-orm";

import { fileUploads } from "@launchstack/store/schema";
import { fetchFile, isS3Storage } from "~/lib/storage";
import { db } from "~/server/db";
import {
    forwardRangeInit,
    partialContentHeaders,
    rangeNotSatisfiable,
    relayedRangeResponse,
    resolveByteRange,
} from "~/server/storage/byte-range";
import { storedFileHeaders } from "~/server/security/stored-file-headers";
import { isPrivateBlobUrl } from "~/server/storage/vercel-blob";

/** `/api/files/<id>`, relative or with an origin in front. */
const FILE_API_PATH = /^(?:https?:\/\/[^/]+)?\/api\/files\/(\d+)(?:[?#].*)?$/;

export type StoredBytes =
    /** Bytes held in the database, with the file's own name and type. */
    | { kind: "buffer"; data: Buffer; filename: string | null; mimeType: string | null }
    /** An upstream response from object storage (streamed, Range forwarded). */
    | { kind: "upstream"; response: Response; filename: string | null; mimeType: string | null }
    /** A public URL the browser can fetch itself. */
    | { kind: "redirect"; location: string }
    | { kind: "missing" };

function isHttpUrl(value: string): boolean {
    try {
        const { protocol } = new URL(value);
        return protocol === "https:" || protocol === "http:";
    } catch {
        return false;
    }
}

/**
 * Open the bytes behind a document URL inside one workspace. `init` carries a
 * Range header on to storage; a database-held file is sliced by the caller.
 */
export async function openStoredBytes(
    url: string,
    companyId: bigint,
    init?: RequestInit
): Promise<StoredBytes> {
    const fileMatch = FILE_API_PATH.exec(url);
    if (fileMatch) {
        const [file] = await db
            .select({
                filename: fileUploads.filename,
                mimeType: fileUploads.mimeType,
                storageProvider: fileUploads.storageProvider,
                storageUrl: fileUploads.storageUrl,
                fileData: fileUploads.fileData,
            })
            .from(fileUploads)
            .where(
                and(eq(fileUploads.id, Number(fileMatch[1])), eq(fileUploads.companyId, companyId))
            )
            .limit(1);
        if (!file) return { kind: "missing" };
        if (file.storageProvider !== "database" && file.storageUrl) {
            const proxied =
                file.storageProvider === "s3" ||
                file.storageProvider === "seaweedfs" ||
                isPrivateBlobUrl(file.storageUrl);
            if (!proxied) {
                return isHttpUrl(file.storageUrl)
                    ? { kind: "redirect", location: file.storageUrl }
                    : { kind: "missing" };
            }
            return {
                kind: "upstream",
                response: await fetchFile(file.storageUrl, init),
                filename: file.filename,
                mimeType: file.mimeType?.trim() || null,
            };
        }
        if (!file.fileData) return { kind: "missing" };
        return {
            kind: "buffer",
            data: Buffer.from(file.fileData, "base64"),
            filename: file.filename,
            mimeType: file.mimeType?.trim() || null,
        };
    }

    if (isS3Storage() || isPrivateBlobUrl(url)) {
        return {
            kind: "upstream",
            response: await fetchFile(url, init),
            filename: null,
            mimeType: null,
        };
    }
    return isHttpUrl(url) ? { kind: "redirect", location: url } : { kind: "missing" };
}

/** `inline` to view, `attachment` to save; the name is quoted both ways RFC 6266 allows. */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
    const safe = encodeURIComponent(filename);
    return `${kind}; filename="${safe}"; filename*=UTF-8''${safe}`;
}

/**
 * The bytes as an HTTP response: ranged for media, typed by the stored
 * claim but sandboxed by `storedFileHeaders`, with the caller's extra
 * headers (no-store, noindex) on top.
 */
export async function storedBytesResponse(
    request: Request,
    input: {
        url: string;
        companyId: bigint;
        title: string;
        fallbackMimeType: string;
        disposition: "inline" | "attachment";
        headers: Record<string, string>;
    }
): Promise<Response | null> {
    const opened = await openStoredBytes(input.url, input.companyId, forwardRangeInit(request));
    if (opened.kind === "missing") return null;
    if (opened.kind === "redirect") {
        return new Response(null, {
            status: 307,
            headers: { ...input.headers, Location: opened.location },
        });
    }

    const filename = opened.filename ?? input.title;
    const disposition = contentDisposition(input.disposition, filename);

    if (opened.kind === "upstream") {
        const relayed = relayedRangeResponse(opened.response);
        if (relayed.status === 416) return new Response(null, relayed);
        if (!opened.response.ok) return null;
        const mimeType =
            opened.response.headers.get("content-type") ??
            opened.mimeType ??
            input.fallbackMimeType;
        return new Response(opened.response.body, {
            status: relayed.status,
            headers: {
                ...storedFileHeaders(mimeType),
                ...relayed.headers,
                ...input.headers,
                "Content-Disposition": disposition,
            },
        });
    }

    const data = opened.data;
    const headers = {
        ...storedFileHeaders(opened.mimeType ?? input.fallbackMimeType),
        ...input.headers,
        "Content-Disposition": disposition,
        "Accept-Ranges": "bytes",
    };
    const range = resolveByteRange(request.headers.get("range"), data.length);
    if (range.kind === "unsatisfiable") {
        const refused = rangeNotSatisfiable(data.length);
        return new Response(null, {
            status: refused.status,
            headers: { ...Object.fromEntries(refused.headers), ...input.headers },
        });
    }
    if (range.kind === "partial") {
        return new Response(new Uint8Array(data.subarray(range.start, range.end + 1)), {
            status: 206,
            headers: { ...headers, ...partialContentHeaders(range, data.length) },
        });
    }
    return new Response(new Uint8Array(data), {
        status: 200,
        headers: { ...headers, "Content-Length": String(data.length) },
    });
}

/** Up to `maxBytes` of the file as UTF-8 text, for a text-like file with no indexed text yet. */
export async function readStoredText(
    url: string,
    companyId: bigint,
    maxBytes: number
): Promise<string | null> {
    const opened = await openStoredBytes(url, companyId);
    if (opened.kind === "buffer") return opened.data.subarray(0, maxBytes).toString("utf8");
    if (opened.kind === "upstream") {
        if (!opened.response.ok) return null;
        const buffer = Buffer.from(await opened.response.arrayBuffer());
        return buffer.subarray(0, maxBytes).toString("utf8");
    }
    return null;
}
