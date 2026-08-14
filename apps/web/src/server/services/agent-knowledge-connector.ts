/**
 * Host wiring for the agent-knowledge connector.
 *
 * The connector (`@launchstack/features/connectors/agent-knowledge`) finds and
 * reads Claude Code / Codex knowledge; this module is the `KnowledgeSink` that
 * puts it in the knowledge base: blob upload → document lifecycle → the same
 * OCR/embedding pipeline every other upload goes through.
 */

import { eq } from "drizzle-orm";

import {
    syncAgentKnowledge,
    scanAgentKnowledge,
    type AgentKnowledgeScan,
    type AgentKnowledgeScanOptions,
    type AgentKnowledgeSyncResult,
} from "@launchstack/features/connectors/agent-knowledge";
import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "@launchstack/features/connectors";
import { document } from "@launchstack/core/db/schema";
import { resolveIngestIndexKey } from "@launchstack/core/embeddings";

import { db } from "~/server/db";
import { env } from "~/env";
import { uploadFile } from "~/lib/storage";
import { getEngine } from "~/server/engine";
import { toAbsoluteUrl } from "./detect-storage-type";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
} from "./document-creation";

export const AGENT_KNOWLEDGE_CATEGORY = "Agent Knowledge";

/** Namespace for the document creation key. Keep stable — it is an identity. */
const CREATION_KEY_PREFIX = "connector:agent-knowledge:";

export interface AgentKnowledgeSinkContext {
    readonly companyId: bigint;
    readonly userId: string;
    readonly category?: string;
    readonly embeddingIndexKey?: string;
    /**
     * Origin used to absolutize a relative blob URL. Pass `request.url` from a
     * route; falls back to `APP_PUBLIC_URL` for script and cron callers.
     */
    readonly requestUrl?: string;
}

interface StoredMetadata {
    readonly connector: string;
    readonly sourceId: string;
    readonly contentHash: string;
    readonly tool: unknown;
    readonly scope: unknown;
    readonly scopeKey: unknown;
    readonly kind: string;
    readonly relativePath: string;
    readonly modifiedAt: string;
    readonly syncedAt: string;
}

function creationKeyFor(item: DiscoveredKnowledgeItem): string {
    return `${CREATION_KEY_PREFIX}${item.sourceId}`;
}

/**
 * Connector metadata is `Record<string, unknown>` by contract — one connector's
 * keys are not another's — so every read out of it is narrowed here rather than
 * cast at the use site.
 */
function metaString(item: KnowledgeItem, key: string, fallback: string): string {
    const value = item.metadata[key];
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Blob-storage filenames must stay flat, so the source's directory structure
 * is folded into the name. The extension is preserved because the ingestion
 * router picks its adapter from it.
 */
function blobFilenameFor(item: KnowledgeItem): string {
    const flattened = item.location.relativePath.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const tool = metaString(item, "tool", "agent");
    const scopeKey = metaString(item, "scopeKey", "global");
    return `${tool}-${scopeKey}-${flattened}`;
}

/**
 * Retrieval sees chunks, not documents, so the provenance has to live in the
 * text itself — otherwise a chunk of a subagent definition is indistinguishable
 * from a chunk of a hand-written note.
 */
function withProvenanceHeader(item: KnowledgeItem, syncedAt: string): string {
    const toolLabel = metaString(item, "toolLabel", metaString(item, "tool", "agent"));
    const scopeKey = metaString(item, "scopeKey", "global");
    return [
        `> Imported from ${toolLabel} (${scopeKey}) — ${item.kind}: \`${item.location.relativePath}\`.`,
        `> Source last modified ${item.modifiedAt}; synced ${syncedAt}.`,
        "",
        item.content,
        "",
    ].join("\n");
}

/**
 * The database storage backend returns relative URLs (`/api/files/12`). The
 * document row keeps that relative form — the UI resolves it per request — but
 * the ingestion worker runs in a different process and fetches the URL as
 * given, so what goes into the job must be absolute.
 *
 * Failing loudly here beats dispatching a job that dies later inside the worker
 * with `Failed to parse URL from /api/files/12`.
 */
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
 * Build the sink. `resolveIngestIndexKey` is read once per sink rather than
 * per item: re-resolving mid-sync would let a concurrent reindex split one
 * batch of documents across two embedding indexes.
 */
export async function createAgentKnowledgeSink(
    context: AgentKnowledgeSinkContext
): Promise<KnowledgeSink> {
    // Populates the storage / job-dispatcher / provider slots the lifecycle
    // dispatch below depends on. Idempotent and cached.
    getEngine();

    const embeddingIndexKey =
        context.embeddingIndexKey ??
        (await resolveIngestIndexKey(context.companyId)) ??
        undefined;
    const category = context.category ?? AGENT_KNOWLEDGE_CATEGORY;

    return {
        async lastSyncedHash(item: DiscoveredKnowledgeItem): Promise<string | null> {
            const existing = await findDocumentByCreationKey(
                context.companyId,
                creationKeyFor(item)
            );
            return existing ? readContentHash(existing.ocrMetadata) : null;
        },

        async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
            const syncedAt = new Date().toISOString();
            const baseCreationKey = creationKeyFor(item);
            const body = withProvenanceHeader(item, syncedAt);
            const filename = blobFilenameFor(item);

            const metadata: StoredMetadata = {
                connector: item.connectorId,
                sourceId: item.sourceId,
                contentHash: item.contentHash,
                tool: item.metadata.tool,
                scope: item.metadata.scope,
                scopeKey: item.metadata.scopeKey,
                kind: item.kind,
                relativePath: item.location.relativePath,
                modifiedAt: item.modifiedAt,
                syncedAt,
            };

            const existing = await findDocumentByCreationKey(context.companyId, baseCreationKey);

            const blob = await uploadFile({
                filename,
                data: Buffer.from(body, "utf-8"),
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
                // The hash is part of the key so a re-sync of the *same* revised
                // content converges on the version it already created instead of
                // stacking a new one on every call.
                creationKey: `${baseCreationKey}:v:${item.contentHash}`,
                mimeType: item.mimeType,
                fileSize: Buffer.byteLength(body, "utf-8"),
                changelog: `Re-synced from ${metaString(item, "toolLabel", "agent")} on ${syncedAt}`,
                originalFilename: filename,
                embeddingIndexKey,
            });

            // The version lifecycle does not touch document-level metadata, so
            // the hash that drives change detection is written here.
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

export interface AgentKnowledgeSyncRequest extends AgentKnowledgeScanOptions {
    readonly companyId: bigint;
    readonly userId: string;
    readonly category?: string;
    readonly embeddingIndexKey?: string;
    readonly concurrency?: number;
    readonly force?: boolean;
    readonly requestUrl?: string;
}

/** Scan the local agent folders and ingest everything that changed. */
export async function runAgentKnowledgeSync(
    request: AgentKnowledgeSyncRequest
): Promise<AgentKnowledgeSyncResult> {
    const {
        companyId,
        userId,
        category,
        embeddingIndexKey,
        concurrency,
        force,
        requestUrl,
        ...scanOptions
    } = request;

    const sink = await createAgentKnowledgeSink({
        companyId,
        userId,
        category,
        embeddingIndexKey,
        requestUrl,
    });

    return syncAgentKnowledge({ ...scanOptions, sink, concurrency, force });
}

/** Preview what a sync would pick up, without reading or uploading anything. */
export async function previewAgentKnowledge(
    options: AgentKnowledgeScanOptions
): Promise<AgentKnowledgeScan> {
    return scanAgentKnowledge(options);
}
