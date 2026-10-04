/**
 * Company profile persistence: the documents and chunks a build reads, the
 * per-source rows it keeps, and the one profile row it writes. Every read
 * and write is scoped by `companyId`; a document of another workspace is
 * "not found".
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";
import { document, documentContextChunks } from "@launchstack/store/schema";
import {
    companyMetadata,
    companyMetadataHistory,
    companyProfileSources,
    type BuildStatus,
    type CompanyMetadataJSON,
    type CompanyProfileSourceRow,
    type MetadataDiff,
} from "@launchstack/tools/company-context/schema";

import type { RawChunk } from "./passages";

export interface ProfileDocument {
    id: number;
    companyId: bigint;
    title: string;
    folder: string;
    currentVersionId: number | null;
    creationKey: string | null;
    ocrMetadata: unknown;
    mimeType: string | null;
}

const documentColumns = {
    id: document.id,
    companyId: document.companyId,
    title: document.title,
    folder: document.category,
    currentVersionId: document.currentVersionId,
    creationKey: document.creationKey,
    ocrMetadata: document.ocrMetadata,
    mimeType: document.mimeType,
};

function toDocument(row: {
    id: number | bigint;
    companyId: bigint;
    title: string;
    folder: string;
    currentVersionId: number | bigint | null;
    creationKey: string | null;
    ocrMetadata: unknown;
    mimeType: string | null;
}): ProfileDocument {
    return {
        ...row,
        id: Number(row.id),
        currentVersionId: row.currentVersionId === null ? null : Number(row.currentVersionId),
    };
}

export async function listWorkspaceDocuments(companyId: bigint): Promise<ProfileDocument[]> {
    const rows = await getDb()
        .select(documentColumns)
        .from(document)
        .where(eq(document.companyId, companyId))
        .orderBy(asc(document.id));
    return rows.map(toDocument);
}

export async function getWorkspaceDocument(
    companyId: bigint,
    documentId: number
): Promise<ProfileDocument | null> {
    const [row] = await getDb()
        .select(documentColumns)
        .from(document)
        .where(and(eq(document.companyId, companyId), eq(document.id, documentId)))
        .limit(1);
    return row ? toDocument(row) : null;
}

/** The chunks of one version, in reading order. */
export async function loadVersionChunks(
    documentId: number,
    versionId: number
): Promise<RawChunk[]> {
    const rows = await getDb()
        .select({
            id: documentContextChunks.id,
            content: documentContextChunks.content,
            page: documentContextChunks.pageNumber,
            semanticType: documentContextChunks.semanticType,
        })
        .from(documentContextChunks)
        .where(
            and(
                eq(documentContextChunks.documentId, BigInt(documentId)),
                eq(documentContextChunks.versionId, BigInt(versionId))
            )
        )
        .orderBy(asc(documentContextChunks.pageNumber), asc(documentContextChunks.id));
    return rows.map(r => ({ ...r, id: Number(r.id) }));
}

// ─── Source rows ─────────────────────────────────────────────────────────────

export async function listSourceRows(companyId: bigint): Promise<CompanyProfileSourceRow[]> {
    return getDb()
        .select()
        .from(companyProfileSources)
        .where(eq(companyProfileSources.companyId, companyId))
        .orderBy(asc(companyProfileSources.documentId));
}

export async function getSourceRow(
    companyId: bigint,
    documentId: number
): Promise<CompanyProfileSourceRow | null> {
    const [row] = await getDb()
        .select()
        .from(companyProfileSources)
        .where(
            and(
                eq(companyProfileSources.companyId, companyId),
                eq(companyProfileSources.documentId, BigInt(documentId))
            )
        )
        .limit(1);
    return row ?? null;
}

export type SourceRowValues = Omit<
    typeof companyProfileSources.$inferInsert,
    "id" | "companyId" | "documentId" | "createdAt" | "updatedAt"
>;

export async function upsertSourceRow(
    companyId: bigint,
    documentId: number,
    values: SourceRowValues
): Promise<CompanyProfileSourceRow> {
    const [row] = await getDb()
        .insert(companyProfileSources)
        .values({ companyId, documentId: BigInt(documentId), ...values })
        .onConflictDoUpdate({
            target: [companyProfileSources.companyId, companyProfileSources.documentId],
            set: { ...values, updatedAt: new Date() },
        })
        .returning();
    return row!;
}

// ─── The profile row ─────────────────────────────────────────────────────────

export interface ProfileRow {
    metadata: CompanyMetadataJSON | null;
    buildStatus: BuildStatus;
    buildError: string | null;
    buildStartedAt: Date | null;
    builtAt: Date | null;
    updatedAt: Date | null;
}

export async function getProfileRow(companyId: bigint): Promise<ProfileRow | null> {
    const [row] = await getDb()
        .select({
            metadata: companyMetadata.metadata,
            buildStatus: companyMetadata.buildStatus,
            buildError: companyMetadata.buildError,
            buildStartedAt: companyMetadata.buildStartedAt,
            builtAt: companyMetadata.builtAt,
            updatedAt: companyMetadata.updatedAt,
        })
        .from(companyMetadata)
        .where(eq(companyMetadata.companyId, companyId))
        .limit(1);
    return row ?? null;
}

/** Mark a whole-profile build; creates the row when the workspace has none yet. */
export async function setBuildStatus(
    companyId: bigint,
    status: BuildStatus,
    error: string | null = null,
    startedAt: Date = new Date()
): Promise<void> {
    const set = {
        buildStatus: status,
        buildError: error,
        ...(status === "building" ? { buildStartedAt: startedAt } : {}),
    };
    await getDb()
        .insert(companyMetadata)
        .values({
            companyId,
            metadata: emptyEnvelope(companyId),
            schemaVersion: "1.1.0",
            ...set,
        })
        .onConflictDoUpdate({
            target: companyMetadata.companyId,
            set: { ...set, updatedAt: new Date() },
        });
}

/**
 * Start a build and return its token. Only the build holding the latest token
 * may finish it ({@link finishBuild}), so a short refresh that ends first
 * never marks a longer Rebuild done.
 */
export async function startBuild(companyId: bigint): Promise<Date> {
    const startedAt = new Date();
    await setBuildStatus(companyId, "building", null, startedAt);
    return startedAt;
}

export async function finishBuild(
    companyId: bigint,
    startedAt: Date,
    status: "idle" | "failed",
    error: string | null = null
): Promise<void> {
    await getDb()
        .update(companyMetadata)
        .set({ buildStatus: status, buildError: error, updatedAt: new Date() })
        .where(
            and(
                eq(companyMetadata.companyId, companyId),
                eq(companyMetadata.buildStartedAt, startedAt)
            )
        );
}

function emptyEnvelope(companyId: bigint): CompanyMetadataJSON {
    const now = new Date().toISOString();
    return {
        schema_version: "1.1.0",
        company_id: String(companyId),
        updated_at: now,
        company: {},
        people: [],
        services: [],
        markets: {},
        projects: [],
        policies: {},
        legal: [],
        profile: {},
        provenance: {
            total_documents_processed: 0,
            extraction_model: "",
            extraction_version: "1.1.0",
        },
    };
}

type Db = ReturnType<typeof getDb>;
/** The database or an open transaction — whatever a read should go through. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Write the profile under the row lock. `finish` receives the row as it is
 * NOW and the transaction to read through, so what it stores reflects every
 * source row and edit committed before the lock was taken. It must be cheap
 * — database reads only, no model calls. Returning null writes nothing.
 * `built` (default true) stamps `built_at`; an edit is not a build.
 */
export async function saveProfileLocked(
    companyId: bigint,
    finish: (
        current: CompanyMetadataJSON | null,
        tx: Executor
    ) =>
        | Promise<{ metadata: CompanyMetadataJSON; diff: MetadataDiff } | null>
        | { metadata: CompanyMetadataJSON; diff: MetadataDiff }
        | null,
    audit: {
        changedBy: string;
        documentId?: number | null;
        changeType?: "extraction" | "manual_override";
        built?: boolean;
    }
): Promise<{ metadata: CompanyMetadataJSON; diff: MetadataDiff } | null> {
    return getDb().transaction(async tx => {
        const [locked] = await tx
            .select({ metadata: companyMetadata.metadata })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, companyId))
            .for("update");
        const result = await finish(locked?.metadata ?? null, tx);
        if (!result) return null;
        const values = {
            schemaVersion: result.metadata.schema_version,
            metadata: result.metadata,
            ...(audit.built === false ? {} : { builtAt: new Date() }),
            ...(audit.documentId ? { lastExtractionDocumentId: BigInt(audit.documentId) } : {}),
        };
        if (locked) {
            await tx
                .update(companyMetadata)
                .set({ ...values, updatedAt: new Date() })
                .where(eq(companyMetadata.companyId, companyId));
        } else {
            await tx.insert(companyMetadata).values({ companyId, ...values });
        }
        const d = result.diff;
        if (d.added.length + d.updated.length + d.deprecated.length > 0) {
            await tx.insert(companyMetadataHistory).values({
                companyId,
                documentId: audit.documentId ? BigInt(audit.documentId) : null,
                changeType: audit.changeType ?? "extraction",
                diff: d,
                changedBy: audit.changedBy,
            });
        }
        return result;
    });
}

/** Source rows whose facts count, with the document title they were read from. */
export async function listCountedSources(
    companyId: bigint,
    executor: Executor = getDb()
): Promise<Array<CompanyProfileSourceRow & { title: string }>> {
    const rows = await executor
        .select({ row: companyProfileSources, title: document.title })
        .from(companyProfileSources)
        .innerJoin(document, eq(document.id, companyProfileSources.documentId))
        .where(
            and(
                eq(companyProfileSources.companyId, companyId),
                eq(companyProfileSources.status, "done"),
                isNotNull(companyProfileSources.facts)
            )
        )
        .orderBy(asc(companyProfileSources.documentId));
    return rows.filter(r => isCounted(r.row)).map(r => ({ ...r.row, title: r.title }));
}

/** A person's override wins; otherwise a source counts when it is about the organisation. */
export function isCounted(row: Pick<CompanyProfileSourceRow, "override" | "role">): boolean {
    return row.override ? row.override === "about_us" : row.role === "about_us";
}
