/**
 * Host wiring for the Outlook connector: the `KnowledgeSink` that puts synced
 * conversations and attachments into the knowledge base: blob upload, then
 * the document lifecycle, then the same ingestion pipeline every other
 * upload goes through. Built like the other mail sink; the differences are
 * Outlook-shaped metadata (the conversation id and the Outlook web link).
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

/** Namespace for the document creation key. Keep stable — it is an identity. */
const CREATION_KEY_PREFIX = "connector:outlook:";

export interface OutlookSinkContext {
    readonly companyId: bigint;
    readonly connectionId: number;
    /** The owner's auth subject id — every synced document is theirs. */
    readonly userId: string;
    /** The owner's private folder (`Outlook/<address>`). */
    readonly category: string;
    readonly embeddingIndexKey?: string;
    /** Origin used to absolutize a relative blob URL; APP_PUBLIC_URL otherwise. */
    readonly requestUrl?: string;
}

interface StoredMetadata {
    readonly connector: string;
    readonly connectionId: string;
    readonly sourceId: string;
    readonly contentHash: string;
    readonly outlookKind: "conversation" | "attachment";
    readonly outlookConversationId: unknown;
    readonly outlookMessageId: unknown;
    /** Opens the conversation in Outlook on the web; null when Graph sent no link. */
    readonly outlookLink: string | null;
    readonly subject: unknown;
    readonly participants: unknown;
    readonly lastMessageAt: unknown;
    readonly relativePath: string;
    readonly modifiedAt: string;
    readonly syncedAt: string;
}

function conversationOf(sourceId: string): string {
    const colon = sourceId.indexOf(":");
    return colon === -1 ? sourceId : sourceId.slice(0, colon);
}

/**
 * The link the "Open in Outlook" action follows. The connector sends it as
 * metadata, and as `location.origin` when it has one (the origin falls back
 * to the bare conversation id, which is not a link and is never stored as
 * one).
 */
function webLinkOf(item: KnowledgeItem): string | null {
    const candidates = [item.metadata.outlookLink, item.location.origin];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
    }
    return null;
}

function creationKeyFor(connectionId: number, item: DiscoveredKnowledgeItem): string {
    return `${CREATION_KEY_PREFIX}${connectionId}:${item.sourceId}`;
}

/**
 * Blob-storage filenames must stay flat, and the extension is load-bearing —
 * the ingestion router picks its adapter from it. Conversations carry `.md`;
 * attachments carry their own.
 */
function blobFilenameFor(item: KnowledgeItem): string {
    const flattened =
        item.title.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
    const extension = item.metadata.extension;
    if (
        typeof extension === "string" &&
        extension &&
        !flattened.toLowerCase().endsWith(extension)
    ) {
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
export async function createOutlookSink(context: OutlookSinkContext): Promise<KnowledgeSink> {
    getEngine();

    const embeddingIndexKey =
        context.embeddingIndexKey ?? (await resolveIngestIndexKey(context.companyId)) ?? undefined;

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
                outlookKind: item.kind === "outlook-attachment" ? "attachment" : "conversation",
                outlookConversationId:
                    item.metadata.outlookConversationId ?? conversationOf(item.sourceId),
                outlookMessageId: item.metadata.outlookMessageId ?? null,
                outlookLink: webLinkOf(item),
                subject: item.metadata.subject ?? item.title,
                participants: item.metadata.participants ?? null,
                lastMessageAt: item.metadata.lastMessageAt ?? item.modifiedAt,
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
                // Stamps the workspace, so a member opening the source can read the file.
                companyId: context.companyId,
            });
            const processingUrl = toProcessingUrl(blob.url, context.requestUrl);

            if (!existing) {
                const lifecycle = await createDocumentLifecycle({
                    companyId: context.companyId,
                    userId: context.userId,
                    title: item.title,
                    category: context.category,
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
                category: context.category,
                url: blob.url,
                processingUrl,
                // The fingerprint is part of the key so a re-sync of the same
                // message set converges on the version it already created.
                creationKey: `${baseCreationKey}:v:${item.contentHash}`,
                mimeType: item.mimeType,
                fileSize: contentByteLength(item.content),
                changelog: `Synced from Outlook on ${syncedAt}`,
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

/** Source ids (conversation ids and `conversation:message:attachment` ids) this connection has ingested. */
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
                sql`${document.ocrMetadata} ->> 'connector' = 'outlook'`,
                sql`${document.ocrMetadata} ->> 'connectionId' = ${String(connectionId)}`
            )
        );
    return rows.map(row => row.sourceId).filter((id): id is string => Boolean(id));
}

/**
 * Deletion policy: mark, don't destroy. A conversation that left the chosen
 * folders (or was deleted in Outlook) keeps its ingested document, because
 * the owner may have cited it, but carries a flag the UI can surface.
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
            ocrMetadata: sql`${document.ocrMetadata} || '{"outlookDeleted": true}'::jsonb`,
        })
        .where(
            and(
                eq(document.companyId, companyId),
                sql`${document.ocrMetadata} ->> 'connector' = 'outlook'`,
                sql`${document.ocrMetadata} ->> 'connectionId' = ${String(connectionId)}`,
                inArray(sql`${document.ocrMetadata} ->> 'sourceId'`, [...sourceIds])
            )
        );
}
