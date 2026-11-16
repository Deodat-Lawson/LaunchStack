import { put, type PutBlobResult } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { env } from "~/env";
import { StorageError } from "~/lib/storage";
import { storageObjects } from "~/server/db/schema/storage";
import { discardUnrecordedObject } from "./compensate";
import { recordStoredObject, removeStoredObject } from "./ledger";
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

    const body =
        data instanceof ArrayBuffer
            ? Buffer.from(data)
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const ref: ObjectRef = { adapter: "vercel-blob", storageLocationId, key };
    const storeId = storageLocationId.slice("vercel-blob:".length);
    let access = detectedAccess ?? "public";
    const attemptedUrl = (mode: "public" | "private") =>
        `https://${storeId}.${mode}.blob.vercel-storage.com/${key}`;

    // Defer the engine across its storage-port initialization cycle.
    const { getEngine } = await import("~/server/engine");
    const db = getEngine().db;
    const identity = and(
        eq(storageObjects.adapter, ref.adapter),
        eq(storageObjects.storageLocationId, ref.storageLocationId),
        eq(storageObjects.objectKey, ref.key)
    );
    const updateLedger = async (metadata: {
        url: string;
        contentType?: string;
        checksum?: string | null;
    }) => {
        try {
            await db.update(storageObjects).set(metadata).where(identity);
        } catch (error) {
            throw new StorageError(
                error instanceof Error ? error.message : String(error),
                "vercel-blob",
                error instanceof Error ? error : undefined
            );
        }
    };
    const compensate = async () => {
        if (await discardUnrecordedObject(ref, "Failed to compensate Vercel Blob upload")) {
            try {
                await removeStoredObject(db, ref);
            } catch (error) {
                console.warn("Failed to remove compensated Vercel Blob ledger entry", error);
            }
        }
    };

    try {
        // The SDK's suffix is disabled, so this identity exists before any bytes do.
        await recordStoredObject(db, {
            ref,
            url: attemptedUrl(access),
            companyId,
            source: "vercel-blob",
            contentType,
            sizeBytes: body.byteLength,
            checksum: null,
        });
    } catch (error) {
        throw new StorageError(
            error instanceof Error ? error.message : String(error),
            "vercel-blob",
            error instanceof Error ? error : undefined
        );
    }

    let blob: PutBlobResult;
    try {
        blob = await put(key, body, { access, addRandomSuffix: false, contentType, token });
    } catch (error) {
        if (
            !detectedAccess &&
            access === "public" &&
            error instanceof Error &&
            error.message.includes("private store")
        ) {
            // A private store rejects public access without writing. Keep the same
            // inventory row, correcting its URL before the private write can start.
            access = "private";
            await updateLedger({ url: attemptedUrl(access) });
            try {
                blob = await put(key, body, {
                    access,
                    addRandomSuffix: false,
                    contentType,
                    token,
                });
            } catch (privateError) {
                await compensate();
                throw privateError;
            }
        } else {
            await compensate();
            throw error;
        }
    }
    detectedAccess = access;

    const extended = blob as PutBlobResult & { contentHash?: string | null };
    const checksum = extended.contentHash ?? blob.etag ?? null;
    try {
        await updateLedger({
            url: blob.url,
            contentType: blob.contentType,
            ...(checksum !== null ? { checksum } : {}),
        });
    } catch (error) {
        await compensate();
        throw error;
    }

    return {
        url: blob.url,
        pathname: key,
        ref,
        contentType: blob.contentType,
        checksum,
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
