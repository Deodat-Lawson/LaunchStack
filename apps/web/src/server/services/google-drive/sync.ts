/**
 * Pull sync (Leg 3): settled Drive revisions become immutable document
 * versions through the same idempotent lifecycle every upload uses.
 *
 * Gate order, cheapest first (the embedding bill is a design input):
 *   1. revision gate — Drive's headRevisionId (or, for a file the user
 *      converted to a native Google Doc, its monotonic `version` counter)
 *      unchanged → nothing to do, no download.
 *   2. md5 gate — revision moved but the bytes didn't (binary files carry
 *      md5Checksum): advance the markers, still no download.
 *   3. settle gate — Docs autosaves per keystroke; the reconciler waits for
 *      GOOGLE_DOCS_SETTLE_MINUTES of quiet so an editing session becomes one
 *      version. Manual "Sync now" passes force=true and skips this gate only.
 *   4. download → version with creationKey `gdrive:{fileId}:{marker}` — racing
 *      pulls (cron vs button) converge on one version row.
 */
import { eq } from "drizzle-orm";

import {
    GOOGLE_DOC_MIME,
    GoogleAuthError,
    GoogleDriveError,
    downloadFileContent,
    exportFileContent,
    getFileMetadata,
    trashFile,
} from "@launchstack/google-drive";
import { document } from "@launchstack/store/schema";

import { db } from "~/server/db";
import {
    connectorConnections,
    documentDriveLinks,
    users,
    type ConnectorConnection,
    type DocumentDriveLink,
} from "~/server/db/schema";
import { env } from "~/env";
import { uploadFile } from "~/lib/storage";
import { getEngine } from "~/server/engine";
import { toAbsoluteUrl } from "~/server/services/detect-storage-type";
import { createDocumentVersionLifecycle } from "~/server/services/document-creation";

import { MAX_LINKED_FILE_BYTES, getSettleWindowMs, isDriveLinkingEnabled } from "./config";
import { getAccessTokenForConnection } from "./connections";
import { getDriveLinkForDocument, linkedFilename, resolveCanonicalMime } from "./links";

/** Fallback author stamp when the linking user no longer exists. */
const SYNC_ACTOR = "google-drive-sync";

/** A link unhealthy for this long escalates from log line to warning. */
const STALE_LINK_MS = 24 * 60 * 60 * 1000;

export type PullOutcome =
    | { kind: "disabled" }
    | { kind: "noop"; reason: "unchanged" | "identical_bytes" | "not_linked" }
    | { kind: "settling"; quietForMs: number }
    | { kind: "orphaned"; detail: string }
    | { kind: "auth_revoked"; detail: string }
    | { kind: "synced"; versionId: number; versionNumber: number; fidelityWarning: boolean }
    | { kind: "error"; detail: string; retryable: boolean };

interface PullContext {
    link: DocumentDriveLink;
    connection: ConnectorConnection;
    force: boolean;
    requestUrl?: string;
}

async function loadConnection(connectionId: number): Promise<ConnectorConnection | null> {
    const [row] = await db
        .select()
        .from(connectorConnections)
        .where(eq(connectorConnections.id, connectionId))
        .limit(1);
    return row ?? null;
}

async function updateLink(
    linkId: number,
    set: Partial<typeof documentDriveLinks.$inferInsert>
): Promise<void> {
    await db
        .update(documentDriveLinks)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(documentDriveLinks.id, linkId));
}

/**
 * The ingestion worker fetches the blob from another process, so a relative
 * database-storage URL must be absolutized (same rule as the upload flow).
 */
function toProcessingUrl(blobUrl: string, requestUrl: string | undefined): string {
    if (blobUrl.startsWith("http://") || blobUrl.startsWith("https://")) return blobUrl;
    const base = requestUrl ?? env.server.APP_PUBLIC_URL;
    if (!base) {
        throw new Error(
            `Cannot dispatch ingestion for a relative document URL (${blobUrl}). ` +
                "Set APP_PUBLIC_URL so the reconciler can hand the worker an absolute URL."
        );
    }
    return toAbsoluteUrl(blobUrl, base);
}

async function resolveActor(link: DocumentDriveLink): Promise<string> {
    if (link.linkedByUserId == null) return SYNC_ACTOR;
    const [row] = await db
        .select({ userId: users.userId })
        .from(users)
        .where(eq(users.id, Number(link.linkedByUserId)))
        .limit(1);
    return row?.userId ?? SYNC_ACTOR;
}

async function performPull(ctx: PullContext): Promise<PullOutcome> {
    const { link, connection } = ctx;

    let accessToken: string;
    try {
        accessToken = await getAccessTokenForConnection(connection);
    } catch (err) {
        if (err instanceof GoogleAuthError && err.invalidGrant) {
            await updateLink(link.id, { lastCheckedAt: new Date(), lastError: err.detail });
            return { kind: "auth_revoked", detail: err.detail };
        }
        throw err;
    }

    let meta;
    try {
        meta = await getFileMetadata({ accessToken, fileId: link.driveFileId });
    } catch (err) {
        if (err instanceof GoogleDriveError && err.isNotFound) {
            await updateLink(link.id, {
                status: "orphaned",
                lastCheckedAt: new Date(),
                lastError: "The linked Drive file no longer exists.",
            });
            return { kind: "orphaned", detail: "deleted" };
        }
        throw err;
    }

    if (meta.trashed) {
        await updateLink(link.id, {
            status: "orphaned",
            lastCheckedAt: new Date(),
            lastError: "The linked Drive file is in the Drive trash.",
        });
        return { kind: "orphaned", detail: "trashed" };
    }

    // "Save as Google Docs" converts a Word file to a native Doc: the file
    // keeps its id but loses headRevisionId/md5Checksum, and pulls must go
    // through export. Persistently flagged — export re-conversion is lossy.
    const native = meta.mimeType === GOOGLE_DOC_MIME;
    const marker = native
        ? meta.version
            ? `v${meta.version}`
            : null
        : (meta.headRevisionId ?? null);

    if (marker && marker === link.lastSyncedRevisionId) {
        await updateLink(link.id, { status: "linked", lastCheckedAt: new Date(), lastError: null });
        return { kind: "noop", reason: "unchanged" };
    }

    if (!native && meta.md5Checksum && meta.md5Checksum === link.lastSyncedMd5) {
        await updateLink(link.id, {
            status: "linked",
            lastSyncedRevisionId: marker,
            lastCheckedAt: new Date(),
            lastError: null,
        });
        return { kind: "noop", reason: "identical_bytes" };
    }

    if (!ctx.force && meta.modifiedTime) {
        const quietForMs = Date.now() - Date.parse(meta.modifiedTime);
        if (Number.isFinite(quietForMs) && quietForMs < getSettleWindowMs()) {
            await updateLink(link.id, { lastCheckedAt: new Date() });
            return { kind: "settling", quietForMs };
        }
    }

    const documentId = Number(link.documentId);
    const [doc] = await db
        .select({
            id: document.id,
            companyId: document.companyId,
            title: document.title,
            category: document.category,
            mimeType: document.mimeType,
            fileType: document.fileType,
        })
        .from(document)
        .where(eq(document.id, documentId));
    if (!doc) {
        await updateLink(link.id, {
            status: "orphaned",
            lastCheckedAt: new Date(),
            lastError: "The linked document no longer exists.",
        });
        return { kind: "orphaned", detail: "document_deleted" };
    }

    const canonicalMime =
        resolveCanonicalMime(doc.fileType, doc.mimeType, doc.title) ?? "application/octet-stream";

    const bytes = native
        ? await exportFileContent({
              accessToken,
              fileId: link.driveFileId,
              mimeType: canonicalMime,
          })
        : await downloadFileContent({ accessToken, fileId: link.driveFileId });

    if (bytes.length > MAX_LINKED_FILE_BYTES) {
        const detail = `The Drive copy grew past the ${Math.floor(MAX_LINKED_FILE_BYTES / (1024 * 1024))} MB cap and was not synced.`;
        await updateLink(link.id, { lastCheckedAt: new Date(), lastError: detail });
        return { kind: "error", detail, retryable: false };
    }

    getEngine();
    const actor = await resolveActor(link);
    const filename = linkedFilename(doc.title, canonicalMime);
    const blob = await uploadFile({
        filename,
        data: bytes,
        contentType: canonicalMime,
        userId: actor,
        companyId: doc.companyId,
    });

    const editorLabel = native ? "Google Docs" : "Google Drive";
    const byWhom = connection.providerAccountEmail ? ` by ${connection.providerAccountEmail}` : "";
    const lifecycle = await createDocumentVersionLifecycle({
        documentId,
        companyId: doc.companyId,
        userId: actor,
        title: doc.title,
        category: doc.category,
        url: blob.url,
        processingUrl: toProcessingUrl(blob.url, ctx.requestUrl),
        // The revision marker in the key is what makes racing pulls (cron vs
        // "Sync now") converge on a single version instead of two.
        creationKey: `gdrive:${link.driveFileId}:${marker ?? `t${meta.modifiedTime ?? Date.now()}`}`,
        mimeType: canonicalMime,
        fileSize: bytes.length,
        changelog: `Edited in ${editorLabel}${byWhom}`,
        originalFilename: filename,
    });

    const now = new Date();
    await updateLink(link.id, {
        status: "linked",
        lastSyncedRevisionId: marker,
        lastSyncedMd5: native ? null : (meta.md5Checksum ?? null),
        lastSyncedVersionId: BigInt(lifecycle.versionId),
        fidelityWarning: native || link.fidelityWarning,
        lastCheckedAt: now,
        lastSyncedAt: now,
        lastError: null,
    });

    return {
        kind: "synced",
        versionId: lifecycle.versionId,
        versionNumber: lifecycle.version.versionNumber,
        fidelityWarning: native || link.fidelityWarning,
    };
}

export async function pullDriveLink(
    link: DocumentDriveLink,
    options?: { force?: boolean; requestUrl?: string }
): Promise<PullOutcome> {
    if (!isDriveLinkingEnabled()) return { kind: "disabled" };
    if (link.status === "unlinked") return { kind: "noop", reason: "not_linked" };

    const connection = await loadConnection(Number(link.connectionId));
    if (!connection || connection.status !== "active") {
        const detail = connection?.lastRefreshError ?? "The Google connection was disconnected.";
        await updateLink(link.id, { lastCheckedAt: new Date(), lastError: detail });
        return { kind: "auth_revoked", detail };
    }

    try {
        return await performPull({
            link,
            connection,
            force: options?.force ?? false,
            requestUrl: options?.requestUrl,
        });
    } catch (err) {
        const retryable = err instanceof GoogleDriveError ? err.isRetryable : true;
        const detail = err instanceof Error ? err.message : String(err);
        await updateLink(link.id, { lastCheckedAt: new Date(), lastError: detail });
        return { kind: "error", detail, retryable };
    }
}

export interface UnlinkResult {
    finalPull: PullOutcome;
    trashed: boolean;
}

/**
 * Leg 5: a final blocking pull, then park the link. The Drive copy is trashed
 * by default — a live-looking Doc that silently stopped syncing is this
 * feature's worst failure seed — unless the caller asks to keep it.
 */
export async function unlinkDocument(params: {
    documentId: number;
    keepDriveFile?: boolean;
    requestUrl?: string;
}): Promise<UnlinkResult> {
    const link = await getDriveLinkForDocument(params.documentId);
    if (!link || link.status === "unlinked") {
        return { finalPull: { kind: "noop", reason: "not_linked" }, trashed: false };
    }

    const finalPull = await pullDriveLink(link, { force: true, requestUrl: params.requestUrl });
    if (finalPull.kind === "error" && finalPull.retryable) {
        // Refuse to complete: unlinking while edits may be stranded in Drive
        // is exactly the silent-loss scenario the design forbids.
        return { finalPull, trashed: false };
    }

    let trashed = false;
    if (!params.keepDriveFile && finalPull.kind !== "auth_revoked") {
        const connection = await loadConnection(Number(link.connectionId));
        if (connection && connection.status === "active") {
            try {
                const accessToken = await getAccessTokenForConnection(connection);
                await trashFile({ accessToken, fileId: link.driveFileId });
                trashed = true;
            } catch (err) {
                if (!(err instanceof GoogleDriveError && err.isNotFound)) {
                    console.warn(
                        `[google-drive] Unlink of document ${params.documentId} could not trash ` +
                            `Drive file ${link.driveFileId}: ${err instanceof Error ? err.message : String(err)}`
                    );
                }
            }
        }
    }

    await updateLink(link.id, { status: "unlinked", lastError: null });
    return { finalPull, trashed };
}

export interface ReconcileResult {
    checked: number;
    synced: number;
    settling: number;
    orphaned: number;
    errors: number;
    stale: number;
}

/**
 * The reconciler's sweep: linked rows, oldest-checked first. Each link costs
 * one metadata GET per tick; downloads happen only when a settled revision
 * moved. Idempotent by creation key, so a died-mid-run tick redoes safely.
 */
export async function pullDueLinks(options?: {
    limit?: number;
    requestUrl?: string;
}): Promise<ReconcileResult> {
    const result: ReconcileResult = {
        checked: 0,
        synced: 0,
        settling: 0,
        orphaned: 0,
        errors: 0,
        stale: 0,
    };
    if (!isDriveLinkingEnabled()) return result;

    const links = await db
        .select()
        .from(documentDriveLinks)
        .where(eq(documentDriveLinks.status, "linked"))
        .orderBy(documentDriveLinks.lastCheckedAt)
        .limit(options?.limit ?? 100);

    for (const link of links) {
        result.checked += 1;
        const outcome = await pullDriveLink(link, { requestUrl: options?.requestUrl });
        if (outcome.kind === "synced") result.synced += 1;
        else if (outcome.kind === "settling") result.settling += 1;
        else if (outcome.kind === "orphaned") result.orphaned += 1;
        else if (outcome.kind === "error" || outcome.kind === "auth_revoked") {
            result.errors += 1;
        }

        const lastHealthy = link.lastSyncedAt ?? link.createdAt;
        if (link.lastError && lastHealthy && Date.now() - lastHealthy.getTime() > STALE_LINK_MS) {
            result.stale += 1;
            console.warn(
                `[google-drive] Link for document ${link.documentId} has not synced in >24h: ${link.lastError}`
            );
        }
    }

    return result;
}
