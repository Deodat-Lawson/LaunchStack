import { randomUUID } from "node:crypto";

import {
    FILE_ACCESS_TOKEN_PARAM,
    buildInternalFileUrl,
    isInternalFileUrl,
    parseInternalFileId,
    signFileAccessToken,
} from "@launchstack/store/crypto";

import { env } from "~/env";
import { discardUnrecordedObject } from "~/server/storage/compensate";
import { recordStoredObject, removeStoredObject } from "~/server/storage/ledger";
import { currentStorageLocationId } from "~/server/storage/location";
import type { ObjectRef } from "~/server/storage/object-ref";

// ---------------------------------------------------------------------------
// StorageError — wraps provider errors with provider name context
// ---------------------------------------------------------------------------

export class StorageError extends Error {
    constructor(
        message: string,
        public readonly provider: string,
        public readonly cause?: Error
    ) {
        super(`[${provider}] ${message}`);
        this.name = "StorageError";
    }
}

// ---------------------------------------------------------------------------
// Backend resolution
// ---------------------------------------------------------------------------

export type StorageBackend = "s3" | "database";

function s3VarsConfigured(): boolean {
    return Boolean(
        env.server.NEXT_PUBLIC_S3_ENDPOINT &&
            env.server.S3_REGION &&
            env.server.S3_ACCESS_KEY &&
            env.server.S3_SECRET_KEY &&
            env.server.S3_BUCKET_NAME
    );
}

/**
 * Resolves the active storage backend. Honors an explicit
 * NEXT_PUBLIC_STORAGE_PROVIDER setting; otherwise infers from whether the full
 * set of S3 env vars is present (auto-fallback to Postgres).
 */
export function resolveStorageBackend(): StorageBackend {
    const explicit = env.server.NEXT_PUBLIC_STORAGE_PROVIDER;
    if (explicit === "s3" || explicit === "database") {
        return explicit;
    }
    return s3VarsConfigured() ? "s3" : "database";
}

export function isS3Storage(): boolean {
    return resolveStorageBackend() === "s3";
}

export function isLocalStorage(): boolean {
    return resolveStorageBackend() === "database";
}

// ---------------------------------------------------------------------------
// Upload interface
// ---------------------------------------------------------------------------

export interface UploadInput {
    filename: string;
    data: Buffer | ArrayBuffer | Uint8Array;
    contentType?: string;
    userId: string;
    /** Active workspace company at upload time; stamped onto file_uploads. */
    companyId?: bigint;
}

export interface UploadResult {
    url: string;
    pathname: string;
    contentType?: string;
    provider: StorageBackend;
    ref: ObjectRef;
}

// ---------------------------------------------------------------------------
// Filename sanitisation (shared with s3-client)
// ---------------------------------------------------------------------------

function sanitizeFilename(filename: string): string {
    return filename.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
}

function toBuffer(data: Buffer | ArrayBuffer | Uint8Array): Buffer {
    return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}

// ---------------------------------------------------------------------------
// uploadFile — delegates to the active backend
// ---------------------------------------------------------------------------

export async function uploadFile(input: UploadInput): Promise<UploadResult> {
    const backend = resolveStorageBackend();
    if (backend === "s3") {
        return uploadToS3(input);
    }
    return uploadToDatabase(input);
}

async function uploadToS3(input: UploadInput): Promise<UploadResult> {
    try {
        const { putObject, getObjectUrl, ensureBucketExists } = await import(
            "~/server/storage/s3-client"
        );
        const storageLocationId = currentStorageLocationId("s3");
        if (!storageLocationId) throw new StorageError("S3 location is not configured", "s3");

        const safeName = sanitizeFilename(input.filename);
        const key = `documents/${randomUUID()}-${safeName || "upload"}`;
        const body = toBuffer(input.data);

        await ensureBucketExists();
        const ref: ObjectRef = { adapter: "s3", storageLocationId, key };
        const url = getObjectUrl(key);
        // Commit inventory before writing bytes: a crash may leave an empty ledger
        // entry, never an object invisible to orphan cleanup.
        // Defer engine loading: its static storage/port import re-enters this module.
        const { getEngine } = await import("~/server/engine");
        const db = getEngine().db;
        await recordStoredObject(db, {
            ref,
            url,
            companyId: input.companyId ?? null,
            source: "upload-file",
            contentType: input.contentType,
            sizeBytes: body.length,
        });
        try {
            await putObject(key, body, input.contentType);
        } catch (error) {
            // A failed request can still have reached S3. Remove the inventory
            // only once deletion is confirmed; otherwise retain it for audit.
            if (await discardUnrecordedObject(ref, "uploadFile S3 put failed")) {
                await removeStoredObject(db, ref).catch((cleanupError: unknown) => {
                    console.warn("Failed to remove unused storage ledger row", {
                        ref,
                        cleanupError,
                    });
                });
            }
            throw error;
        }

        return { url, pathname: key, contentType: input.contentType, provider: "s3", ref };
    } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError(
            err instanceof Error ? err.message : String(err),
            "s3",
            err instanceof Error ? err : undefined
        );
    }
}

async function uploadToDatabase(input: UploadInput): Promise<UploadResult> {
    try {
        // Use getEngine().db (hoisted fn) rather than the ~/server/db Proxy const:
        // lib/storage sits inside the server/db → engine → storage/port → lib/storage
        // cycle, so a dynamic import of the un-hoisted `db` const can resolve to
        // undefined mid-init. getEngine() is immune (function declaration).
        const { getEngine } = await import("~/server/engine");
        const db = getEngine().db;
        const { fileUploads } = await import("@launchstack/store/schema");

        const body = toBuffer(input.data);
        const safeName = sanitizeFilename(input.filename);
        const pathname = `documents/${randomUUID()}-${safeName || "upload"}`;

        return await db.transaction(async tx => {
            const [row] = await tx
                .insert(fileUploads)
                .values({
                    userId: input.userId,
                    companyId: input.companyId ?? null,
                    filename: input.filename,
                    mimeType: input.contentType ?? "application/octet-stream",
                    fileData: body.toString("base64"),
                    fileSize: body.length,
                    storageProvider: "database",
                    storageUrl: null,
                    storagePathname: pathname,
                })
                .returning({ id: fileUploads.id });

            if (!row) throw new Error("Insert into fileUploads returned no row");
            const ref: ObjectRef = {
                adapter: "database",
                storageLocationId: currentStorageLocationId("database")!,
                key: String(row.id),
            };
            const url = `/api/files/${row.id}`;
            await recordStoredObject(tx, {
                ref,
                url,
                companyId: input.companyId ?? null,
                source: "upload-file",
                contentType: input.contentType,
                sizeBytes: body.length,
            });
            return { url, pathname, contentType: input.contentType, provider: "database", ref };
        });
    } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError(
            err instanceof Error ? err.message : String(err),
            "database",
            err instanceof Error ? err : undefined
        );
    }
}

// ---------------------------------------------------------------------------
// fetchFile — unified retrieval for any storage URL
// ---------------------------------------------------------------------------

/**
 * Origin used to address our own `/api/files/{id}` route from server-side
 * code. Mirrors the OCR config fallback so a deployment that never set
 * APP_PUBLIC_URL still resolves to the in-cluster app service.
 */
function internalFileOrigin(): string {
    return env.server.APP_PUBLIC_URL ?? "http://app:3000";
}

/**
 * `/api/files/{id}` requires a session or a signed token. Server-side
 * callers (OCR adapters, page counting, VLM enrichment, archive expansion)
 * have no session, so every internal file reference is rebuilt canonically
 * and signed here — one place, rather than at each of the ~6 call sites that
 * would otherwise 401.
 *
 * Returns null when the URL is not an internal file reference, so external
 * URLs stay untouched and are never handed a capability token.
 */
function signedInternalFileUrl(url: string): string | null {
    const origin = internalFileOrigin();
    const fileId = parseInternalFileId(url);
    if (fileId === null || !isInternalFileUrl(url, origin)) return null;

    const canonical = new URL(buildInternalFileUrl(origin, fileId));
    const token = signFileAccessToken(String(fileId), env.server.FILE_ACCESS_TOKEN_SECRET);
    if (!token) {
        // No secret configured: fall through unsigned rather than inventing a
        // capability. The route still accepts a session, and the ingress check in
        // internal-file-ref rejects the upload before it can reach this path.
        return null;
    }

    canonical.searchParams.set(FILE_ACCESS_TOKEN_PARAM, token);
    return canonical.toString();
}

export async function fetchFile(url: string, init?: RequestInit): Promise<Response> {
    // Internal /api/files/{id} references: sign before anything else, so the
    // token is minted fresh per fetch and never cached on a stored URL.
    const signed = signedInternalFileUrl(url);
    if (signed) {
        try {
            return await fetch(signed, init);
        } catch (err) {
            throw new StorageError(
                err instanceof Error ? err.message : String(err),
                "database",
                err instanceof Error ? err : undefined
            );
        }
    }

    const s3Endpoint = env.server.NEXT_PUBLIC_S3_ENDPOINT ?? env.client.NEXT_PUBLIC_S3_ENDPOINT;

    // S3 URLs — plain fetch
    if (s3Endpoint && url.startsWith(s3Endpoint)) {
        try {
            return await fetch(url, init);
        } catch (err) {
            throw new StorageError(
                `S3 storage unavailable at ${s3Endpoint}: ${err instanceof Error ? err.message : String(err)}`,
                "s3",
                err instanceof Error ? err : undefined
            );
        }
    }

    // Legacy private Vercel Blob URLs — delegate to fetchBlob for auth
    try {
        const { fetchBlob, isPrivateBlobUrl } = await import("~/server/storage/vercel-blob");
        if (isPrivateBlobUrl(url)) {
            return await fetchBlob(url, init);
        }
    } catch {
        // vercel-blob module unavailable — fall through to plain fetch
    }

    // Public URLs (legacy Vercel Blob, etc.) — plain fetch
    try {
        return await fetch(url, init);
    } catch (err) {
        throw new StorageError(
            err instanceof Error ? err.message : String(err),
            "s3",
            err instanceof Error ? err : undefined
        );
    }
}
