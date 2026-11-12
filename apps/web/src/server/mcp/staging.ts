/**
 * What an assistant handed over but has not filed yet (`mcp_staged_files`).
 *
 * - A **draft**: content the assistant sent to `add_document` before the
 *   person said where it goes. It is stored once, and the assistant files it
 *   later by passing `draftId`, so a long artifact is never sent twice.
 * - An **upload**: a slot `start_upload` opens for a file on the person's own
 *   machine. The CLI sends the bytes to a one-time URL (`PUT
 *   /api/mcp/uploads/<token>`), and the assistant files it with `uploadId`.
 *
 * Every row belongs to one person in one workspace: nobody else can file,
 * see or reuse it. A row is filed at most once (a conditional update from
 * `ready` to `used`), and anything not filed within the hour is swept,
 * stored bytes included. Filed rows keep their bytes: the document points at
 * them.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";

import { deleteFile, uploadFile, type StorageBackend } from "~/lib/storage";
import { db } from "~/server/db";
import { mcpStagedFiles, users, type McpStagedFile, type McpStagedKind } from "~/server/db/schema";

/** A draft or upload must be filed within this long. */
export const STAGED_TTL_MS = 60 * 60 * 1000;
/** An upload slot's URL accepts bytes for this long. */
export const UPLOAD_WINDOW_MS = 15 * 60 * 1000;
/** The largest file an upload slot takes, matching the app's own upload limit. */
export const MAX_STAGED_BYTES = 128 * 1024 * 1024;
/** Expired rows removed per sweep; sweeping rides on new staging, so it stays small. */
const SWEEP_BATCH = 50;

export interface StagingOwner {
    authUserId: string;
    userPk: bigint;
    companyId: bigint;
}

export class StagingError extends Error {
    constructor(
        readonly code: "not_found" | "expired" | "used" | "too_large" | "empty" | "gone",
        message: string
    ) {
        super(message);
        this.name = "StagingError";
    }
}

function newStagedId(kind: McpStagedKind): string {
    return `${kind}_${randomBytes(18).toString("base64url")}`;
}

export function hashUploadToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Removes expired rows, deleting the stored bytes of any that were never
 * filed. Best effort: a failure is logged and never fails the caller.
 */
export async function sweepExpiredStagedFiles(now = new Date()): Promise<number> {
    try {
        const expired = await db
            .select({
                id: mcpStagedFiles.id,
                status: mcpStagedFiles.status,
                storageUrl: mcpStagedFiles.storageUrl,
                storageProvider: mcpStagedFiles.storageProvider,
            })
            .from(mcpStagedFiles)
            .where(lt(mcpStagedFiles.expiresAt, now))
            .limit(SWEEP_BATCH);
        if (expired.length === 0) return 0;
        for (const row of expired) {
            if (row.status !== "used" && row.storageUrl) {
                await deleteFile(
                    row.storageUrl,
                    (row.storageProvider as StorageBackend | null) ?? undefined
                ).catch((error: unknown) =>
                    console.warn("[mcp] could not delete an expired staged file", {
                        id: row.id,
                        error,
                    })
                );
            }
        }
        await db.delete(mcpStagedFiles).where(
            inArray(
                mcpStagedFiles.id,
                expired.map(row => row.id)
            )
        );
        return expired.length;
    } catch (error) {
        console.warn("[mcp] staged-file sweep failed", error);
        return 0;
    }
}

export interface StageDraftInput {
    data: Buffer;
    filename: string;
    mimeType: string;
    details: Record<string, unknown>;
}

/** Stores content now, to be filed later by `draftId`. */
export async function stageDraft(
    owner: StagingOwner,
    input: StageDraftInput,
    now = new Date()
): Promise<McpStagedFile> {
    if (input.data.byteLength === 0) {
        throw new StagingError("empty", "There is nothing to add: the content is empty.");
    }
    if (input.data.byteLength > MAX_STAGED_BYTES) {
        throw new StagingError(
            "too_large",
            `The content is larger than ${MAX_STAGED_BYTES / (1024 * 1024)} MB.`
        );
    }
    await sweepExpiredStagedFiles(now);
    const stored = await uploadFile({
        filename: input.filename,
        data: input.data,
        contentType: input.mimeType,
        userId: owner.authUserId,
        companyId: owner.companyId,
    });
    const [row] = await db
        .insert(mcpStagedFiles)
        .values({
            id: newStagedId("draft"),
            companyId: owner.companyId,
            userId: owner.userPk,
            kind: "draft",
            status: "ready",
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.data.byteLength,
            storageUrl: stored.url,
            storageProvider: stored.provider,
            details: input.details,
            expiresAt: new Date(now.getTime() + STAGED_TTL_MS),
        })
        .returning();
    if (!row) throw new Error("A staged draft was stored but not recorded");
    return row;
}

export interface UploadSlot {
    id: string;
    /** The one-time secret in the upload URL. Only its hash is stored. */
    token: string;
    uploadExpiresAt: Date;
    expiresAt: Date;
}

/** Opens a slot a CLI can send one file's bytes to. */
export async function createUploadSlot(
    owner: StagingOwner,
    input: { filename: string; mimeType: string; details: Record<string, unknown> },
    now = new Date()
): Promise<UploadSlot> {
    await sweepExpiredStagedFiles(now);
    const token = randomBytes(32).toString("base64url");
    const uploadExpiresAt = new Date(now.getTime() + UPLOAD_WINDOW_MS);
    const expiresAt = new Date(now.getTime() + STAGED_TTL_MS);
    const id = newStagedId("upload");
    await db.insert(mcpStagedFiles).values({
        id,
        companyId: owner.companyId,
        userId: owner.userPk,
        kind: "upload",
        status: "awaiting_bytes",
        uploadTokenHash: hashUploadToken(token),
        uploadExpiresAt,
        filename: input.filename,
        mimeType: input.mimeType,
        details: input.details,
        expiresAt,
    });
    return { id, token, uploadExpiresAt, expiresAt };
}

/** Reads a request body into memory, refusing once it passes `limit` bytes. */
export async function readBodyWithLimit(
    body: ReadableStream<Uint8Array> | null,
    limit: number
): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
            await reader.cancel().catch(() => undefined);
            throw new StagingError(
                "too_large",
                `The file is larger than ${limit / (1024 * 1024)} MB.`
            );
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
}

export interface ReceivedUpload {
    id: string;
    filename: string;
    sizeBytes: number;
}

/**
 * Takes a file's bytes for the upload slot whose URL carries `token`. The
 * token works once: it is cleared before the bytes are stored, so a second
 * request with the same URL finds nothing, whatever happens to the first.
 */
export async function receiveUpload(
    token: string,
    body: ReadableStream<Uint8Array> | null,
    declaredLength: number | null,
    now = new Date()
): Promise<ReceivedUpload> {
    if (declaredLength !== null && declaredLength > MAX_STAGED_BYTES) {
        throw new StagingError(
            "too_large",
            `The file is larger than ${MAX_STAGED_BYTES / (1024 * 1024)} MB.`
        );
    }
    const [slot] = await db
        .update(mcpStagedFiles)
        .set({ uploadTokenHash: null })
        .where(
            and(
                eq(mcpStagedFiles.uploadTokenHash, hashUploadToken(token)),
                eq(mcpStagedFiles.kind, "upload"),
                eq(mcpStagedFiles.status, "awaiting_bytes"),
                gt(mcpStagedFiles.uploadExpiresAt, now)
            )
        )
        .returning();
    if (!slot) {
        throw new StagingError(
            "gone",
            "This upload link is not valid: it was already used or it expired. Ask the assistant for a new one."
        );
    }

    const data = await readBodyWithLimit(body, MAX_STAGED_BYTES);
    if (data.byteLength === 0) {
        throw new StagingError("empty", "The upload was empty. Ask the assistant for a new link.");
    }
    const [owner] = await db
        .select({ authUserId: users.userId })
        .from(users)
        .where(eq(users.id, Number(slot.userId)))
        .limit(1);
    if (!owner) throw new StagingError("gone", "The person this upload link belongs to is gone.");
    const stored = await uploadFile({
        filename: slot.filename,
        data,
        contentType: slot.mimeType,
        userId: owner.authUserId,
        companyId: slot.companyId,
    });
    await db
        .update(mcpStagedFiles)
        .set({
            status: "ready",
            sizeBytes: data.byteLength,
            storageUrl: stored.url,
            storageProvider: stored.provider,
        })
        .where(eq(mcpStagedFiles.id, slot.id));
    return { id: slot.id, filename: slot.filename, sizeBytes: data.byteLength };
}

/**
 * A draft or upload this person staged in this workspace, ready to file.
 * Says plainly when it was already filed, has not received its bytes yet, or
 * expired; anything that is not theirs reads as not found.
 */
export async function loadStagedFile(
    owner: StagingOwner,
    id: string,
    now = new Date()
): Promise<McpStagedFile> {
    const [row] = await db
        .select()
        .from(mcpStagedFiles)
        .where(
            and(
                eq(mcpStagedFiles.id, id),
                eq(mcpStagedFiles.companyId, owner.companyId),
                eq(mcpStagedFiles.userId, owner.userPk)
            )
        )
        .limit(1);
    const label = id.startsWith("upload_") ? "upload" : "draft";
    if (!row) {
        throw new StagingError(
            "not_found",
            `No ${label} "${id}" of yours exists in this workspace. Send the content again.`
        );
    }
    if (row.status === "used") {
        throw new StagingError(
            "used",
            `That ${label} was already added${row.documentId ? ` as document ${row.documentId}` : ""}.`
        );
    }
    if (row.expiresAt.getTime() <= now.getTime()) {
        throw new StagingError(
            "expired",
            `That ${label} expired (they last an hour). Send the content again.`
        );
    }
    if (row.status !== "ready" || !row.storageUrl) {
        throw new StagingError(
            "not_found",
            "That upload has not received its file yet. Upload the file to the URL start_upload gave, then try again."
        );
    }
    return row;
}

/**
 * Claims a staged row for filing: `ready` → `used`, in one conditional update,
 * before any document is made. False when another call claimed it first, so
 * two concurrent calls can never file it twice.
 */
export async function claimStagedFile(id: string): Promise<boolean> {
    const rows = await db
        .update(mcpStagedFiles)
        .set({ status: "used", usedAt: new Date() })
        .where(and(eq(mcpStagedFiles.id, id), eq(mcpStagedFiles.status, "ready")))
        .returning({ id: mcpStagedFiles.id });
    return rows.length > 0;
}

/** Records the source a claimed row became. */
export async function recordStagedDocument(id: string, documentId: number): Promise<void> {
    await db.update(mcpStagedFiles).set({ documentId }).where(eq(mcpStagedFiles.id, id));
}

/** Puts a claimed row back when filing failed, so the person can try again. */
export async function releaseStagedFile(id: string): Promise<void> {
    await db
        .update(mcpStagedFiles)
        .set({ status: "ready", usedAt: null })
        .where(and(eq(mcpStagedFiles.id, id), eq(mcpStagedFiles.status, "used")));
}

/** Drops a staged row the person declined to file, with its bytes. */
export async function discardStagedFile(owner: StagingOwner, id: string): Promise<void> {
    const [row] = await db
        .delete(mcpStagedFiles)
        .where(
            and(
                eq(mcpStagedFiles.id, id),
                eq(mcpStagedFiles.companyId, owner.companyId),
                eq(mcpStagedFiles.userId, owner.userPk),
                ne(mcpStagedFiles.status, "used")
            )
        )
        .returning();
    if (row?.storageUrl) {
        await deleteFile(
            row.storageUrl,
            (row.storageProvider as StorageBackend | null) ?? undefined
        ).catch((error: unknown) =>
            console.warn("[mcp] could not delete a discarded staged file", { id, error })
        );
    }
}

/** Staged rows still waiting in this person's workspace (for tests and Settings). */
export async function countOpenStagedFiles(owner: StagingOwner): Promise<number> {
    const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(mcpStagedFiles)
        .where(
            and(
                eq(mcpStagedFiles.companyId, owner.companyId),
                eq(mcpStagedFiles.userId, owner.userPk),
                ne(mcpStagedFiles.status, "used"),
                isNotNull(mcpStagedFiles.expiresAt)
            )
        );
    return Number(row?.count ?? 0);
}
