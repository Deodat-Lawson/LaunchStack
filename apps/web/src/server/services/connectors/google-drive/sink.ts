/**
 * Host wiring for the Google Drive connector — the `KnowledgeSink` that puts
 * synced Drive files into the knowledge base: blob upload → document
 * lifecycle → the same OCR/embedding pipeline every other upload goes
 * through. Mirrors the agent-knowledge sink; the differences are binary
 * content and Drive-shaped metadata.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "@launchstack/pipelines/connectors";
import { contentByteLength, contentToBuffer } from "@launchstack/pipelines/connectors";
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

export const GOOGLE_DRIVE_CATEGORY = "Google Drive";

/** Namespace for the document creation key. Keep stable — it is an identity. */
const CREATION_KEY_PREFIX = "connector:google-drive:";

export interface GoogleDriveSinkContext {
    readonly companyId: bigint;
    readonly connectionId: number;
    readonly userId: string;
    readonly category?: string;
    readonly embeddingIndexKey?: string;
    /** Origin used to absolutize a relative blob URL; APP_PUBLIC_URL otherwise. */
    readonly requestUrl?: string;
}

interface StoredMetadata {
    readonly connector: string;
    readonly connectionId: string;
    readonly sourceId: string;
    readonly contentHash: string;
    readonly driveFileId: unknown;
    readonly driveMimeType: unknown;
    readonly relativePath: string;
    readonly modifiedAt: string;
    readonly syncedAt: string;
}

function creationKeyFor(connectionId: number, item: DiscoveredKnowledgeItem): string {
    return `${CREATION_KEY_PREFIX}${connectionId}:${item.sourceId}`;
}

/**
 * Blob-storage filenames must stay flat, and the extension is load-bearing —
 * the ingestion router picks its adapter from it. Exports carry the export
 * target's extension (a Doc exported as Markdown must land as `.md`).
 */
function blobFilenameFor(item: KnowledgeItem): string {
    const flattened = item.title.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const extension = item.metadata.extension;
    if (typeof extension === "string" && !flattened.toLowerCase().endsWith(extension)) {
        return `${flattened}${extension}`;
    }
    return flattened;
}

function toProcessingUrl(blobUrl: string, requestUrl: string | undefined): string {
    if (blobUrl.startsWith("http://") || blobUrl.startsWith("https://")) return blobUrl;

    const base = requestUrl ?? env.server.APP_PUBLIC_URL;
    if (!base) {
        throw new Error(
            `Cannot dispatch ingestion for a relative document URL (${blobUrl}). ` +
                "The database storage backend is in use, so the ingestion worker needs an " +
                "absolute URL — set APP_PUBLIC_URL, or pass requestUrl to the sink."
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
export async function createGoogleDriveSink(
    context: GoogleDriveSinkContext
): Promise<KnowledgeSink> {
    getEngine();

    const embeddingIndexKey =
        context.embeddingIndexKey ?? (await resolveIngestIndexKey(context.companyId)) ?? undefined;
    const category = context.category ?? GOOGLE_DRIVE_CATEGORY;

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
                connector: item.connectorId,
                connectionId: String(context.connectionId),
                sourceId: item.sourceId,
                contentHash: item.contentHash,
                driveFileId: item.metadata.driveFileId,
                driveMimeType: item.metadata.driveMimeType,
                relativePath: item.location.relativePath,
                modifiedAt: item.modifiedAt,
                syncedAt,
            };

            const existing = await findDocumentByCreationKey(context.companyId, baseCreationKey);

            const blob = await uploadFile({
                filename,
                data: body,
                contentType: item.mimeType,
                userId: context.userId,
            });
            const processingUrl = toProcessingUrl(blob.url, context.requestUrl);

            if (!existing) {
                const lifecycle = await createDocumentLifecycle({
                    companyId: context.companyId,
                    userId: context.userId,
                    title: item.title,
                    category,
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
                userId: context.userId,
                title: item.title,
                category,
                url: blob.url,
                processingUrl,
                // The fingerprint is part of the key so a re-sync of the same
                // Drive revision converges on the version it already created.
                creationKey: `${baseCreationKey}:v:${item.contentHash}`,
                mimeType: item.mimeType,
                fileSize: contentByteLength(item.content),
                changelog: `Synced from Google Drive on ${syncedAt}`,
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

/** Source ids (Drive file ids) this connection has already ingested. */
export async function listKnownSourceIds(
    companyId: bigint,
    connectionId: number
): Promise<string[]> {
    const rows = await db
        .select({ sourceId: sql<string>`${document.ocrMetadata} ->> 'sourceId'` })
        .from(document)
        .where(
            and(
                eq(document.companyId, companyId),
                sql`${document.ocrMetadata} ->> 'connector' = 'google-drive'`,
                sql`${document.ocrMetadata} ->> 'connectionId' = ${String(connectionId)}`
            )
        );
    return rows.map(row => row.sourceId).filter((id): id is string => Boolean(id));
}

/**
 * Deletion policy: mark, don't destroy. A file removed from Drive (or from
 * the picked scope) keeps its ingested document — people may have cited it —
 * but carries a flag the UI can surface.
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
            ocrMetadata: sql`${document.ocrMetadata} || '{"driveDeleted": true}'::jsonb`,
        })
        .where(
            and(
                eq(document.companyId, companyId),
                sql`${document.ocrMetadata} ->> 'connector' = 'google-drive'`,
                sql`${document.ocrMetadata} ->> 'connectionId' = ${String(connectionId)}`,
                inArray(sql`${document.ocrMetadata} ->> 'sourceId'`, [...sourceIds])
            )
        );
}
