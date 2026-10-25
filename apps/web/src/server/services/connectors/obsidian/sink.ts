/**
 * Host wiring for the Obsidian vault import — the `KnowledgeSink` that puts
 * imported notes into the knowledge base: blob upload → document lifecycle →
 * the same ingestion pipeline every other upload goes through. Mirrors the
 * Notion and Gmail sinks; the differences are that every note is filed in
 * the vault's own folder structure, and the identity includes the person,
 * since a vault is one person's.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import type {
    DiscoveredKnowledgeItem,
    KnowledgeItem,
    KnowledgeSink,
    StoredKnowledgeItem,
} from "@launchstack/pipelines/connectors";
import { contentByteLength, contentToBuffer } from "@launchstack/pipelines/connectors";
import { OBSIDIAN_CONNECTOR_ID } from "@launchstack/pipelines/connectors/obsidian";
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
const CREATION_KEY_PREFIX = "connector:obsidian:";

export interface ObsidianSinkContext {
    readonly companyId: bigint;
    /** users.id of whoever is importing — part of every note's identity. */
    readonly ownerUserPk: bigint;
    /** Their auth subject id; every imported note is theirs. */
    readonly userId: string;
    readonly vaultName: string;
    /** The LaunchStack folder for a note's vault-relative folder. */
    readonly folderFor: (noteFolder: string) => Promise<string>;
    readonly embeddingIndexKey?: string;
    /** Origin used to absolutize a relative blob URL; APP_PUBLIC_URL otherwise. */
    readonly requestUrl?: string;
}

interface StoredMetadata {
    readonly connector: string;
    readonly sourceId: string;
    readonly contentHash: string;
    readonly obsidianOwner: string;
    readonly obsidianVault: string;
    readonly obsidianPath: string;
    readonly modifiedAt: string;
    readonly syncedAt: string;
}

function creationKeyFor(context: ObsidianSinkContext, item: DiscoveredKnowledgeItem): string {
    return `${CREATION_KEY_PREFIX}${context.ownerUserPk}:${context.vaultName}:${item.sourceId}`;
}

/** Flat, with the `.md` the ingestion router picks its adapter by. */
function blobFilenameFor(item: KnowledgeItem): string {
    const flattened =
        item.title.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "obsidian-note";
    return flattened.toLowerCase().endsWith(".md") ? flattened : `${flattened}.md`;
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

/** The stored fingerprint; null for a note flagged missing, so a restored note is stored again. */
function readContentHash(ocrMetadata: unknown): string | null {
    if (typeof ocrMetadata !== "object" || ocrMetadata === null) return null;
    const metadata = ocrMetadata as Record<string, unknown>;
    if (metadata.obsidianDeleted === true) return null;
    return typeof metadata.contentHash === "string" ? metadata.contentHash : null;
}

function metaString(item: DiscoveredKnowledgeItem, key: string, fallback: string): string {
    const value = item.metadata[key];
    return typeof value === "string" ? value : fallback;
}

export async function createObsidianSink(context: ObsidianSinkContext): Promise<KnowledgeSink> {
    getEngine();

    const embeddingIndexKey =
        context.embeddingIndexKey ?? (await resolveIngestIndexKey(context.companyId)) ?? undefined;

    return {
        async lastSyncedHash(item: DiscoveredKnowledgeItem): Promise<string | null> {
            const existing = await findDocumentByCreationKey(
                context.companyId,
                creationKeyFor(context, item)
            );
            return existing ? readContentHash(existing.ocrMetadata) : null;
        },

        async store(item: KnowledgeItem): Promise<StoredKnowledgeItem> {
            const syncedAt = new Date().toISOString();
            const baseCreationKey = creationKeyFor(context, item);
            const body = contentToBuffer(item.content);
            const filename = blobFilenameFor(item);
            const category = await context.folderFor(metaString(item, "obsidianFolder", ""));

            const metadata: StoredMetadata = {
                connector: item.connectorId,
                sourceId: item.sourceId,
                contentHash: item.contentHash,
                obsidianOwner: context.ownerUserPk.toString(),
                obsidianVault: context.vaultName,
                obsidianPath: metaString(item, "obsidianPath", item.sourceId),
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
                // The fingerprint is part of the key so re-importing the same
                // edit converges on the version it already created.
                creationKey: `${baseCreationKey}:v:${item.contentHash}`,
                mimeType: item.mimeType,
                fileSize: contentByteLength(item.content),
                changelog: `Re-imported from the Obsidian vault "${context.vaultName}" on ${syncedAt}`,
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

function ownVaultDocuments(companyId: bigint, ownerUserPk: bigint, vaultName?: string) {
    return and(
        eq(document.companyId, companyId),
        sql`${document.ocrMetadata} ->> 'connector' = ${OBSIDIAN_CONNECTOR_ID}`,
        sql`${document.ocrMetadata} ->> 'obsidianOwner' = ${ownerUserPk.toString()}`,
        ...(vaultName === undefined
            ? []
            : [sql`${document.ocrMetadata} ->> 'obsidianVault' = ${vaultName}`])
    );
}

/** Vault-relative paths this person imported from this vault and that are still present. */
export async function listKnownNotePaths(
    companyId: bigint,
    ownerUserPk: bigint,
    vaultName: string
): Promise<string[]> {
    const rows = await db
        .select({ sourceId: sql<string>`${document.ocrMetadata} ->> 'sourceId'` })
        .from(document)
        .where(
            and(
                ownVaultDocuments(companyId, ownerUserPk, vaultName),
                sql`coalesce((${document.ocrMetadata} ->> 'obsidianDeleted')::boolean, false) = false`
            )
        );
    return rows.map(row => row.sourceId).filter((id): id is string => Boolean(id));
}

/** Deletion policy: mark, don't destroy — a note may have been cited. */
export async function markMissingNotes(
    companyId: bigint,
    ownerUserPk: bigint,
    vaultName: string,
    paths: readonly string[]
): Promise<void> {
    if (paths.length === 0) return;
    await db
        .update(document)
        .set({
            ocrMetadata: sql`${document.ocrMetadata} || '{"obsidianDeleted": true}'::jsonb`,
        })
        .where(
            and(
                ownVaultDocuments(companyId, ownerUserPk, vaultName),
                inArray(sql`${document.ocrMetadata} ->> 'sourceId'`, [...paths])
            )
        );
}

export interface ImportedVault {
    readonly vaultName: string;
    readonly notes: number;
    readonly lastImportedAt: string | null;
}

/** The vaults this person has imported, newest first — what the panel offers to refresh. */
export async function listImportedVaults(
    companyId: bigint,
    ownerUserPk: bigint
): Promise<ImportedVault[]> {
    const vault = sql<string>`${document.ocrMetadata} ->> 'obsidianVault'`;
    const lastImportedAt = sql<string | null>`max(${document.ocrMetadata} ->> 'syncedAt')`;
    const rows = await db
        .select({
            vaultName: vault,
            notes: sql<number>`count(*)::int`,
            lastImportedAt,
        })
        .from(document)
        .where(
            and(
                ownVaultDocuments(companyId, ownerUserPk),
                sql`coalesce((${document.ocrMetadata} ->> 'obsidianDeleted')::boolean, false) = false`
            )
        )
        .groupBy(vault)
        .orderBy(sql`max(${document.ocrMetadata} ->> 'syncedAt') desc`);
    return rows
        .filter(row => Boolean(row.vaultName))
        .map(row => ({
            vaultName: row.vaultName,
            notes: Number(row.notes),
            lastImportedAt: row.lastImportedAt,
        }));
}
