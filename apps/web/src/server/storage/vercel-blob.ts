import { put, type PutBlobResult } from "@vercel/blob";
import { randomUUID } from "node:crypto";

import { env } from "~/env";
import { StorageError } from "~/lib/storage";
import { deleteStoredObjects } from "./delete-objects";
import { recordStoredObject } from "./ledger";
import { currentStorageLocationId } from "./location";
import type { ObjectRef } from "./object-ref";

export interface PutFileInput {
    filename: string;
    data: ArrayBuffer | Uint8Array | Buffer;
    companyId: bigint | null;
    contentType?: string;
}

export interface StoredBlobMetadata {
    url: string;
    pathname: string;
    ref: ObjectRef;
    contentType?: string;
    size?: number;
    checksum?: string | null;
}

class MissingBlobTokenError extends Error {
    constructor() {
        super("BLOB_READ_WRITE_TOKEN is not configured. Set it in your Vercel project settings.");
        this.name = "MissingBlobTokenError";
    }
}

function getBlobToken(): string {
    const token = env.server.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
        throw new MissingBlobTokenError();
    }
    return token;
}

let detectedAccess: "public" | "private" | null = null;

export async function putFile({
    filename,
    data,
    companyId,
    contentType,
}: PutFileInput): Promise<StoredBlobMetadata> {
    const token = getBlobToken();
    const storageLocationId = currentStorageLocationId("vercel-blob");
    if (!storageLocationId)
        throw new Error("BLOB_READ_WRITE_TOKEN has no parseable store identity");
    const safeName = sanitizeFilename(filename);
    const key = `documents/${randomUUID()}-${safeName.length > 0 ? safeName : "upload"}`;

    const body = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);

    const tryPut = (access: "public" | "private") => put(key, body, { access, contentType, token });

    let blob: PutBlobResult;
    if (detectedAccess) {
        blob = await tryPut(detectedAccess);
    } else {
        try {
            blob = await tryPut("public");
            detectedAccess = "public";
        } catch (err) {
            if (err instanceof Error && err.message.includes("private store")) {
                blob = await tryPut("private");
                detectedAccess = "private";
            } else {
                throw err;
            }
        }
    }

    const extended = blob as PutBlobResult & { contentHash?: string | null };
    const ref: ObjectRef = { adapter: "vercel-blob", storageLocationId, key: blob.pathname };
    try {
        // Defer the engine across its storage-port initialization cycle.
        const { getEngine } = await import("~/server/engine");
        await recordStoredObject(getEngine().db, {
            ref,
            url: blob.url,
            companyId,
            source: "vercel-blob",
            contentType: blob.contentType,
            sizeBytes: body.byteLength,
            checksum: extended.contentHash ?? null,
        });
    } catch (error) {
        try {
            const results = await deleteStoredObjects([ref]);
            if (
                results.some(
                    result => result.outcome === "blocked" || result.outcome === "retryable"
                )
            ) {
                console.warn("Failed to compensate unrecorded Vercel Blob upload", results);
            }
        } catch (cleanupError) {
            console.warn("Failed to compensate unrecorded Vercel Blob upload", cleanupError);
        }
        throw new StorageError(
            error instanceof Error ? error.message : String(error),
            "vercel-blob",
            error instanceof Error ? error : undefined
        );
    }

    return {
        url: blob.url,
        pathname: blob.pathname,
        ref,
        contentType: blob.contentType,
        checksum: extended.contentHash ?? null,
    };
}

export function isPrivateBlobUrl(url: string): boolean {
    return url.includes(".private.blob.");
}

export async function fetchBlob(url: string, init?: RequestInit): Promise<Response> {
    if (isPrivateBlobUrl(url)) {
        const token = getBlobToken();
        return fetch(url, {
            ...init,
            headers: {
                ...(init?.headers as Record<string, string> | undefined),
                Authorization: `Bearer ${token}`,
            },
        });
    }
    return fetch(url, init);
}

function sanitizeFilename(filename: string): string {
    return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}
