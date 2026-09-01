/**
 * Host wiring for the agent-sessions connector.
 *
 * The connector (`@launchstack/pipelines/connectors/agent-sessions`) finds,
 * parses and renders Claude Code / Codex session transcripts; this module is
 * the `KnowledgeSink` that puts the rendered Markdown in the knowledge base:
 * blob upload → document lifecycle → the same OCR/embedding pipeline every
 * other upload goes through. Unlike the agent-knowledge sink there is no
 * provenance header to inject here — the renderer already wrote it into the
 * transcript, because it is part of the content hash.
 */

import { homedir } from "node:os";

import { and, eq, sql } from "drizzle-orm";

import {
    AGENT_SESSIONS_CONNECTOR_ID,
    DEFAULT_QUIESCENCE_MS,
    loadCodexSessionIndex,
    peekSessions,
    scanAgentSessions,
    syncAgentSessions,
    type AgentSessionsScan,
    type AgentSessionsScanOptions,
    type AgentSessionsSyncResult,
    type SessionToolId,
} from "@launchstack/pipelines/connectors/agent-sessions";
import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "@launchstack/pipelines/connectors";
import { document } from "@launchstack/store/schema";
import { resolveIngestIndexKey } from "@launchstack/llm/embeddings";

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

export const AGENT_SESSIONS_CATEGORY = "Agent Sessions";

/** Namespace for the document creation key. Keep stable — it is an identity. */
const CREATION_KEY_PREFIX = "connector:agent-sessions:";

export interface AgentSessionsSinkContext {
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
    readonly sessionId: unknown;
    readonly projectPath: unknown;
    readonly gitBranch: unknown;
    readonly startedAt: unknown;
    readonly endedAt: unknown;
    readonly dropped: unknown;
    readonly relativePath: string;
    readonly modifiedAt: string;
    readonly syncedAt: string;
}

function creationKeyFor(item: DiscoveredKnowledgeItem): string {
    return `${CREATION_KEY_PREFIX}${item.sourceId}`;
}

function metaString(item: KnowledgeItem, key: string, fallback: string): string {
    const value = item.metadata[key];
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** `claude-code-<uuid>.md` — flat, extension-bearing, unique per session. */
function blobFilenameFor(item: KnowledgeItem): string {
    const tool = metaString(item, "tool", "agent");
    const sessionUuid = metaString(item, "sessionUuid", "session").replace(
        /[^a-zA-Z0-9._-]+/g,
        "-"
    );
    return `${tool}-session-${sessionUuid}.md`;
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
 * Build the sink. `resolveIngestIndexKey` is read once per sink rather than
 * per item: re-resolving mid-sync would let a concurrent reindex split one
 * batch of documents across two embedding indexes.
 */
export async function createAgentSessionsSink(
    context: AgentSessionsSinkContext
): Promise<KnowledgeSink> {
    // Populates the storage / job-dispatcher / provider slots the lifecycle
    // dispatch below depends on. Idempotent and cached.
    getEngine();

    const embeddingIndexKey =
        context.embeddingIndexKey ?? (await resolveIngestIndexKey(context.companyId)) ?? undefined;
    const category = context.category ?? AGENT_SESSIONS_CATEGORY;

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
            const filename = blobFilenameFor(item);

            const metadata: StoredMetadata = {
                connector: item.connectorId,
                sourceId: item.sourceId,
                contentHash: item.contentHash,
                tool: item.metadata.tool,
                sessionId: item.metadata.sessionId,
                projectPath: item.metadata.projectPath,
                gitBranch: item.metadata.gitBranch,
                startedAt: item.metadata.startedAt,
                endedAt: item.metadata.endedAt,
                dropped: item.metadata.dropped,
                relativePath: item.location.relativePath,
                modifiedAt: item.modifiedAt,
                syncedAt,
            };

            const existing = await findDocumentByCreationKey(context.companyId, baseCreationKey);

            const blob = await uploadFile({
                filename,
                data: Buffer.from(item.content, "utf-8"),
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
                // The hash is part of the key so a re-sync of the *same* grown
                // session converges on the version it already created instead
                // of stacking a new one on every call.
                creationKey: `${baseCreationKey}:v:${item.contentHash}`,
                mimeType: item.mimeType,
                fileSize: Buffer.byteLength(item.content, "utf-8"),
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

export interface AgentSessionsSyncRequest extends AgentSessionsScanOptions {
    readonly companyId: bigint;
    readonly userId: string;
    readonly category?: string;
    readonly embeddingIndexKey?: string;
    readonly concurrency?: number;
    readonly force?: boolean;
    readonly requestUrl?: string;
}

/** Scan the local session folders and ingest every session that changed. */
export async function runAgentSessionsSync(
    request: AgentSessionsSyncRequest
): Promise<AgentSessionsSyncResult> {
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

    const sink = await createAgentSessionsSink({
        companyId,
        userId,
        category,
        embeddingIndexKey,
        requestUrl,
    });

    return syncAgentSessions({ ...scanOptions, sink, concurrency, force });
}

/** Preview what a sync would pick up, without reading or uploading anything. */
export async function previewAgentSessions(
    options: AgentSessionsScanOptions
): Promise<AgentSessionsScan> {
    return scanAgentSessions(options);
}

export interface AgentSessionImportState {
    readonly documentId: number;
    readonly syncedAt: string | null;
    /** The local file changed after the last import; a re-import would revise. */
    readonly stale: boolean;
}

export interface AgentSessionPreviewItem {
    readonly sourceId: string;
    readonly tool: SessionToolId;
    readonly title: string;
    /** First line of the first user prompt, when the peek could see one. */
    readonly preview: string | null;
    readonly projectSlug: string | null;
    readonly projectPath: string | null;
    readonly gitBranch: string | null;
    readonly bytes: number;
    readonly modifiedAt: string;
    readonly relativePath: string;
    readonly archived: boolean;
    /** Modified within the quiescence window — the session may still be running. */
    readonly active: boolean;
    readonly imported: AgentSessionImportState | null;
}

export interface AgentSessionsDetailedPreview {
    readonly roots: AgentSessionsScan["roots"];
    readonly truncated: boolean;
    readonly items: readonly AgentSessionPreviewItem[];
    readonly skipped: AgentSessionsScan["skipped"];
}

interface ImportedSessionRow {
    readonly documentId: number;
    readonly syncedAt: string | null;
    readonly modifiedAt: string | null;
}

/**
 * Every session this workspace has already imported, keyed by sourceId. The
 * lookup goes through the sink's own `ocrMetadata` marker rather than by
 * creation key on purpose: the key-hashing scheme is private to the lifecycle
 * module, and one marker query replaces N per-item key lookups.
 */
async function loadImportedSessions(companyId: bigint): Promise<Map<string, ImportedSessionRow>> {
    const rows = await db
        .select({ id: document.id, ocrMetadata: document.ocrMetadata })
        .from(document)
        .where(
            and(
                eq(document.companyId, companyId),
                sql`${document.ocrMetadata} ->> 'connector' = ${AGENT_SESSIONS_CONNECTOR_ID}`
            )
        );

    const imported = new Map<string, ImportedSessionRow>();
    for (const row of rows) {
        const meta = (row.ocrMetadata ?? {}) as Record<string, unknown>;
        if (typeof meta.sourceId !== "string") continue;
        imported.set(meta.sourceId, {
            documentId: Number(row.id),
            syncedAt: typeof meta.syncedAt === "string" ? meta.syncedAt : null,
            modifiedAt: typeof meta.modifiedAt === "string" ? meta.modifiedAt : null,
        });
    }
    return imported;
}

function metaOf(metadata: Readonly<Record<string, unknown>>, key: string): string | null {
    const value = metadata[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The sessions-browser view: every session on this machine with real titles,
 * first-prompt previews and this workspace's import status. Unlike a sync
 * scan it lists active (still-running) sessions too — the browser shows them
 * with a badge instead of hiding them, and a per-session import is allowed to
 * take them as they are.
 */
export async function previewAgentSessionsDetailed(
    companyId: bigint,
    options: AgentSessionsScanOptions = {}
): Promise<AgentSessionsDetailedPreview> {
    const scan = await scanAgentSessions({ ...options, quiescenceMs: 0 });

    const wantsCodex = scan.items.some(item => item.metadata.tool === "codex");
    const [peeks, codexTitles, importedSessions] = await Promise.all([
        peekSessions(scan.items),
        wantsCodex
            ? loadCodexSessionIndex(options.homeDir ?? homedir())
            : Promise.resolve(new Map<string, string>()),
        loadImportedSessions(companyId),
    ]);

    const activeSince = Date.now() - DEFAULT_QUIESCENCE_MS;

    const items = scan.items.map((item): AgentSessionPreviewItem => {
        const tool: SessionToolId = item.metadata.tool === "codex" ? "codex" : "claude-code";
        const peek = peeks.get(item.sourceId);
        const sessionUuid = metaOf(item.metadata, "sessionUuid");
        const indexTitle =
            tool === "codex" && sessionUuid ? (codexTitles.get(sessionUuid) ?? null) : null;
        const realTitle = peek?.title ?? indexTitle;
        const previewLine = peek?.preview ?? null;
        const title =
            realTitle ??
            (previewLine
                ? previewLine.length > 80
                    ? `${previewLine.slice(0, 77)}…`
                    : previewLine
                : item.title);

        const importedRow = importedSessions.get(item.sourceId);
        const imported: AgentSessionImportState | null = importedRow
            ? {
                  documentId: importedRow.documentId,
                  syncedAt: importedRow.syncedAt,
                  stale:
                      importedRow.modifiedAt !== null && item.modifiedAt > importedRow.modifiedAt,
              }
            : null;

        return {
            sourceId: item.sourceId,
            tool,
            title,
            preview: previewLine,
            projectSlug: metaOf(item.metadata, "projectSlug"),
            projectPath: peek?.projectPath ?? null,
            gitBranch: peek?.gitBranch ?? null,
            bytes: item.bytes,
            modifiedAt: item.modifiedAt,
            relativePath: item.location.relativePath,
            archived: item.metadata.archived === true,
            active: Date.parse(item.modifiedAt) > activeSince,
            imported,
        };
    });

    return { roots: scan.roots, truncated: scan.truncated, items, skipped: scan.skipped };
}
