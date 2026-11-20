/**
 * Host wiring for the Microsoft 365 connector: the `KnowledgeSink` that puts
 * synced OneDrive and SharePoint files into the knowledge base (blob upload,
 * document lifecycle, then the same OCR and embedding pipeline every other
 * upload goes through). The Google Drive sink's sibling; the differences are
 * the metadata (a drive id plus an item id, and the address Microsoft gave
 * for opening the file) and that nothing is exported, so a file keeps the
 * name and extension it has in OneDrive.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "@launchstack/pipelines/connectors";
import {
    contentByteLength,
    contentToBuffer,
    SourceDeletedError,
} from "@launchstack/pipelines/connectors";
import { document } from "@launchstack/store/schema";
import { resolveIngestIndexKey } from "@launchstack/llm/embeddings";

import { db } from "~/server/db";
import { env } from "~/env";
import { uploadFile } from "~/lib/storage";
import { getEngine } from "~/server/engine";
import { toAbsoluteUrl } from "../../detect-storage-type";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
} from "../../document-creation";
import { applyDocumentCreationDefaults, type OwnerRef } from "~/server/workspace/ownership";
import { isSourceDeleted } from "../deleted-items";

export const MICROSOFT_365_CONNECTOR = "microsoft-365";

/** Where a file lands when its pick names no destination. */
export const MICROSOFT_365_CATEGORY = "Microsoft 365";

/** Where one new file goes and who it belongs to (see ./destinations). */
export interface SinkPlacement {
    readonly category: string;
    /** Set → the file gets ADR-014's defaults for this person and is attributed to them. */
    readonly owner: OwnerRef | null;
}

/** Namespace for the document creation key. Keep stable: it is an identity. */
const CREATION_KEY_PREFIX = "connector:microsoft-365:";

export interface Microsoft365SinkContext {
    readonly companyId: bigint;
    readonly connectionId: number;
    /** Auth id uploads are attributed to when a placement names no owner. */
    readonly userId: string;
    readonly category?: string;
    /**
     * Placement of a file seen for the first time. Without it every file
     * goes to `category` as a workspace import. A file already ingested
     * stays wherever it is now: people move them.
     */
    readonly place?: (item: KnowledgeItem) => Promise<SinkPlacement>;
    readonly embeddingIndexKey?: string;
    /** Origin used to absolutize a relative blob URL; APP_PUBLIC_URL otherwise. */
    readonly requestUrl?: string;
}

interface StoredMetadata {
    readonly connector: string;
    readonly connectionId: string;
    readonly sourceId: string;
    readonly contentHash: string;
    readonly driveId: unknown;
    readonly itemId: unknown;
    /** Opens the file in OneDrive or SharePoint ("Open in ..." reads it). */
    readonly webUrl: unknown;
    readonly graphMimeType: unknown;
    /** Where the file sits in its own drive, e.g. `/Clients/Acme`. */
    readonly parentPath: unknown;
    readonly relativePath: string;
    /** The pick it came through, as a source id; lets a re-picked folder find its old home. */
    readonly pickedRootId: unknown;
    readonly folderPath: unknown;
    readonly modifiedAt: string;
    readonly syncedAt: string;
}

function creationKeyFor(connectionId: number, item: DiscoveredKnowledgeItem): string {
    return `${CREATION_KEY_PREFIX}${connectionId}:${item.sourceId}`;
}

/**
 * Blob-storage filenames must stay flat, and the extension is load-bearing:
 * the ingestion router picks its adapter from it. Nothing is exported on
 * Microsoft's side, so the name already carries the right one.
 */
function blobFilenameFor(item: KnowledgeItem): string {
    return item.title.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function toProcessingUrl(blobUrl: string, requestUrl: string | undefined): string {
    if (blobUrl.startsWith("http://") || blobUrl.startsWith("https://")) return blobUrl;

    const base = requestUrl ?? env.server.APP_PUBLIC_URL;
    if (!base) {
        throw new Error(
            `Cannot dispatch ingestion for a relative document URL (${blobUrl}). ` +
                "The database storage backend is in use, so the ingestion worker needs an " +
                "absolute URL. Set APP_PUBLIC_URL, or pass requestUrl to the sink."
        );
    }
    return toAbsoluteUrl(blobUrl, base);
}

function readContentHash(ocrMetadata: unknown): string | null {
    if (typeof ocrMetadata !== "object" || ocrMetadata === null) return null;
    const hash = (ocrMetadata as Record<string, unknown>).contentHash;
    return typeof hash === "string" ? hash : null;
}

/**
 * Build the sink. The index key is read once per sink rather than per item so
 * a concurrent reindex cannot split one sync across two embedding indexes.
 */
export async function createMicrosoft365Sink(
    context: Microsoft365SinkContext
): Promise<KnowledgeSink> {
    getEngine();

    const embeddingIndexKey =
        context.embeddingIndexKey ?? (await resolveIngestIndexKey(context.companyId)) ?? undefined;
    const category = context.category ?? MICROSOFT_365_CATEGORY;

    return {
        async lastSyncedHash(item: DiscoveredKnowledgeItem): Promise<string | null> {
            const existing = await findDocumentByCreationKey(
                context.companyId,
                creationKeyFor(context.connectionId, item)
            );
            return existing ? readContentHash(existing.ocrMetadata) : null;
        },

        async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
            const syncedAt = new Date().toISOString();
            const baseCreationKey = creationKeyFor(context.connectionId, item);
            const body = contentToBuffer(item.content);
            const filename = blobFilenameFor(item);

            const metadata: StoredMetadata = {
                connector: MICROSOFT_365_CONNECTOR,
                connectionId: String(context.connectionId),
                sourceId: item.sourceId,
                contentHash: item.contentHash,
                driveId: item.metadata.driveId ?? null,
                itemId: item.metadata.itemId ?? null,
                webUrl: item.metadata.webUrl ?? null,
                graphMimeType: item.metadata.graphMimeType ?? null,
                parentPath: item.metadata.parentPath ?? null,
                relativePath: item.location.relativePath,
                pickedRootId: item.metadata.pickedRoot ?? null,
                folderPath: item.metadata.folderPath ?? [],
                modifiedAt: item.modifiedAt,
                syncedAt,
            };

            const existing = await findDocumentByCreationKey(context.companyId, baseCreationKey);
            // Deleted while this run was going (the run's list predates it).
            if (!existing && (await isSourceDeleted(context.connectionId, item.sourceId))) {
                throw new SourceDeletedError(item.sourceId);
            }
            const placement: SinkPlacement | null =
                !existing && context.place ? await context.place(item) : null;
            const userId = placement?.owner?.authUserId ?? context.userId;

            const blob = await uploadFile({
                filename,
                data: body,
                contentType: item.mimeType,
                userId,
                // Stamps the workspace, so a member opening the source can read the file.
                companyId: context.companyId,
            });
            const processingUrl = toProcessingUrl(blob.url, context.requestUrl);

            if (!existing) {
                const placedIn = placement?.category ?? category;
                const lifecycle = await createDocumentLifecycle({
                    companyId: context.companyId,
                    userId,
                    title: item.title,
                    category: placedIn,
                    url: blob.url,
                    processingUrl,
                    creationKey: baseCreationKey,
                    mimeType: item.mimeType,
                    ocrEnabled: true,
                    ocrProcessed: false,
                    ocrMetadata: { ...metadata },
                    processing: {
                        originalFilename: filename,
                        embeddingIndexKey,
                    },
                });

                // Someone picked this: the file is theirs the way an upload
                // would be (it inherits their private folder, and they can
                // share it on its own).
                if (placement?.owner && lifecycle.created) {
                    await applyDocumentCreationDefaults(db, placement.owner, [
                        { id: lifecycle.documentId, category: placedIn },
                    ]);
                }

                return {
                    sourceId: item.sourceId,
                    documentId: lifecycle.documentId,
                    versionId: lifecycle.versionId,
                    jobId: lifecycle.jobId,
                    revised: false,
                };
            }

            const lifecycle = await createDocumentVersionLifecycle({
                documentId: existing.id,
                companyId: context.companyId,
                userId,
                title: item.title,
                category: existing.category ?? category,
                url: blob.url,
                processingUrl,
                // The fingerprint is part of the key so a re-sync of the same
                // revision converges on the version it already created.
                creationKey: `${baseCreationKey}:v:${item.contentHash}`,
                mimeType: item.mimeType,
                fileSize: contentByteLength(item.content),
                changelog: `Synced from Microsoft 365 on ${syncedAt}`,
                originalFilename: filename,
                embeddingIndexKey,
            });

            // The version lifecycle does not touch document-level metadata, so
            // the fingerprint that drives change detection is written here.
            await db
                .update(document)
                .set({ ocrMetadata: { ...metadata } })
                .where(eq(document.id, existing.id));

            return {
                sourceId: item.sourceId,
                documentId: lifecycle.documentId,
                versionId: lifecycle.versionId,
                jobId: lifecycle.jobId,
                revised: true,
            };
        },
    };
}

/** A file this connection has already ingested, and the pick it came through. */
export interface KnownSource {
    readonly sourceId: string;
    readonly pickedRootId: string | null;
}

/** Everything this connection has already ingested. */
export async function listKnownSources(
    companyId: bigint,
    connectionId: number
): Promise<KnownSource[]> {
    const rows = await db
        .select({
            sourceId: sql<string>`${document.ocrMetadata} ->> 'sourceId'`,
            pickedRootId: sql<string | null>`${document.ocrMetadata} ->> 'pickedRootId'`,
        })
        .from(document)
        .where(
            and(
                eq(document.companyId, companyId),
                sql`${document.ocrMetadata} ->> 'connector' = ${MICROSOFT_365_CONNECTOR}`,
                sql`${document.ocrMetadata} ->> 'connectionId' = ${String(connectionId)}`
            )
        );
    return rows.flatMap(row =>
        row.sourceId ? [{ sourceId: row.sourceId, pickedRootId: row.pickedRootId ?? null }] : []
    );
}

/**
 * Deletion policy: mark, don't destroy. A file removed from OneDrive or
 * SharePoint (or from the picked scope) keeps its ingested document, since
 * people may have cited it, but carries a flag the UI can surface.
 */
export async function markMissingDocuments(
    companyId: bigint,
    connectionId: number,
    sourceIds: readonly string[]
): Promise<void> {
    if (sourceIds.length === 0) return;
    await db
        .update(document)
        .set({
            ocrMetadata: sql`${document.ocrMetadata} || '{"sourceMissing": true}'::jsonb`,
        })
        .where(
            and(
                eq(document.companyId, companyId),
                sql`${document.ocrMetadata} ->> 'connector' = ${MICROSOFT_365_CONNECTOR}`,
                sql`${document.ocrMetadata} ->> 'connectionId' = ${String(connectionId)}`,
                inArray(sql`${document.ocrMetadata} ->> 'sourceId'`, [...sourceIds])
            )
        );
}
