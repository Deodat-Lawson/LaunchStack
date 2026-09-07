/**
 * Data access for imported Claude artifacts.
 *
 * Every read is scoped by `companyId` here rather than in the route handlers,
 * so a missing `where` clause cannot leak another workspace's artifacts.
 * Summaries never select `content` — the body can be megabytes, and the list
 * view only needs metadata.
 */

import { and, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";

import { db } from "~/server/db";
import { claudeArtifacts, type ClaudeArtifact } from "~/server/db/schema";

export interface ArtifactSummary {
    id: number;
    title: string;
    description: string | null;
    folder: string;
    artifactType: string;
    sourceUrl: string | null;
    importMethod: string;
    sizeBytes: number;
    contentHash: string;
    starred: boolean;
    createdByUserId: string;
    updatedByUserId: string | null;
    deletedAt: string | null;
    openedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ArtifactDetail extends ArtifactSummary {
    content: string;
}

function iso(value: Date | string | null): string | null {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type SummaryRow = Omit<ClaudeArtifact, "content" | "searchText" | "companyId">;

export function toSummary(row: SummaryRow): ArtifactSummary {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        folder: row.folder,
        artifactType: row.artifactType,
        sourceUrl: row.sourceUrl,
        importMethod: row.importMethod,
        sizeBytes: row.sizeBytes,
        contentHash: row.contentHash,
        starred: row.starred,
        createdByUserId: row.createdByUserId,
        updatedByUserId: row.updatedByUserId,
        deletedAt: iso(row.deletedAt),
        openedAt: iso(row.openedAt),
        createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
        updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
    };
}

export function toDetail(row: ClaudeArtifact): ArtifactDetail {
    return { ...toSummary(row), content: row.content };
}

const summaryColumns = {
    id: claudeArtifacts.id,
    title: claudeArtifacts.title,
    description: claudeArtifacts.description,
    folder: claudeArtifacts.folder,
    artifactType: claudeArtifacts.artifactType,
    sourceUrl: claudeArtifacts.sourceUrl,
    importMethod: claudeArtifacts.importMethod,
    sizeBytes: claudeArtifacts.sizeBytes,
    contentHash: claudeArtifacts.contentHash,
    starred: claudeArtifacts.starred,
    createdByUserId: claudeArtifacts.createdByUserId,
    updatedByUserId: claudeArtifacts.updatedByUserId,
    deletedAt: claudeArtifacts.deletedAt,
    openedAt: claudeArtifacts.openedAt,
    createdAt: claudeArtifacts.createdAt,
    updatedAt: claudeArtifacts.updatedAt,
};

export interface ListFilters {
    companyId: bigint;
    /** `active` hides trashed artifacts; `trash` shows only those. */
    scope?: "active" | "trash";
    folder?: string;
    search?: string;
    starredOnly?: boolean;
    limit?: number;
}

export async function listArtifacts(filters: ListFilters): Promise<ArtifactSummary[]> {
    const conditions = [eq(claudeArtifacts.companyId, filters.companyId)];

    conditions.push(
        filters.scope === "trash"
            ? isNotNull(claudeArtifacts.deletedAt)
            : isNull(claudeArtifacts.deletedAt)
    );
    if (filters.folder) conditions.push(eq(claudeArtifacts.folder, filters.folder));
    if (filters.starredOnly) conditions.push(eq(claudeArtifacts.starred, true));
    if (filters.search) {
        const needle = `%${filters.search}%`;
        // Title first so a name match is cheap; the stripped body text catches
        // "that dashboard with the churn table in it".
        conditions.push(
            or(ilike(claudeArtifacts.title, needle), ilike(claudeArtifacts.searchText, needle))!
        );
    }

    const rows = await db
        .select(summaryColumns)
        .from(claudeArtifacts)
        .where(and(...conditions))
        .orderBy(desc(claudeArtifacts.updatedAt))
        .limit(Math.min(filters.limit ?? 200, 500));

    return rows.map(toSummary);
}

export async function getArtifact(id: number, companyId: bigint): Promise<ClaudeArtifact | null> {
    const [row] = await db
        .select()
        .from(claudeArtifacts)
        .where(and(eq(claudeArtifacts.id, id), eq(claudeArtifacts.companyId, companyId)))
        .limit(1);
    return row ?? null;
}

export async function listFolders(companyId: bigint): Promise<string[]> {
    const rows = await db
        .selectDistinct({ folder: claudeArtifacts.folder })
        .from(claudeArtifacts)
        .where(and(eq(claudeArtifacts.companyId, companyId), isNull(claudeArtifacts.deletedAt)));
    return rows.map(r => r.folder).sort((a, b) => a.localeCompare(b));
}
