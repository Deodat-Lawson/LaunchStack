/**
 * The IO half of starter generation: read what the workspace knows about
 * itself and hand it to the pure generator as one `WorkspaceBrief`.
 *
 * Four cheap reads, run together: the company row, the extracted profile,
 * the document inventory (counts per folder plus the newest titles), and the
 * active connector list. No retrieval — starters are about what the workspace
 * *has*, not about any one passage, and a RAG pass per page load would be the
 * most expensive thing on the screen.
 */

import { count, desc, eq, max } from "drizzle-orm";
import { formatMetadataContext } from "@launchstack/tools/company-context";
import { company, document } from "@launchstack/store/schema";

import { db } from "~/server/db";
import { companyMetadata } from "~/server/db/schema";
import { listConnectionsForCompany } from "~/server/services/connectors/connection-store";
import { relativeAge, type BriefDocument, type BriefFolder, type WorkspaceBrief } from "./starters";

/** Newest titles the model may reference (and pin) — enough variety, small prompt. */
const RECENT_DOCUMENT_LIMIT = 16;
const FOLDER_LIMIT = 8;

export async function buildWorkspaceBrief(companyId: bigint): Promise<WorkspaceBrief> {
    const now = new Date();

    const [companyRows, metadataRows, folderRows, recentRows, totalRows, connections] =
        await Promise.all([
            db
                .select({
                    name: company.name,
                    description: company.description,
                    industry: company.industry,
                    size: company.numberOfEmployees,
                })
                .from(company)
                .where(eq(company.id, Number(companyId)))
                .limit(1),
            db
                .select({
                    metadata: companyMetadata.metadata,
                    updatedAt: companyMetadata.updatedAt,
                })
                .from(companyMetadata)
                .where(eq(companyMetadata.companyId, companyId))
                .limit(1),
            db
                .select({ name: document.category, count: count() })
                .from(document)
                .where(eq(document.companyId, companyId))
                .groupBy(document.category),
            db
                .select({
                    id: document.id,
                    title: document.title,
                    category: document.category,
                    createdAt: document.createdAt,
                })
                .from(document)
                .where(eq(document.companyId, companyId))
                .orderBy(desc(document.createdAt), desc(document.id))
                .limit(RECENT_DOCUMENT_LIMIT),
            db
                .select({ total: count(), maxId: max(document.id) })
                .from(document)
                .where(eq(document.companyId, companyId)),
            listConnectionsForCompany(companyId),
        ]);

    const companyRow = companyRows[0];
    const metadataRow = metadataRows[0];

    let profileText: string | null = null;
    if (metadataRow?.metadata) {
        try {
            profileText = formatMetadataContext(metadataRow.metadata) || null;
        } catch (error) {
            // A malformed profile must not take the starters down with it.
            console.warn("[ask-starters] could not format company profile:", error);
        }
    }

    const folders: BriefFolder[] = folderRows
        .map(row => ({ name: row.name || "Unfiled", count: Number(row.count) }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, FOLDER_LIMIT);

    const recentDocuments: BriefDocument[] = recentRows.map(row => ({
        id: row.id,
        title: row.title,
        folder: row.category || "Unfiled",
        ageLabel: relativeAge(row.createdAt, now),
    }));

    const activeConnections = [
        ...new Set(connections.filter(c => c.status === "active").map(c => c.provider)),
    ].sort();

    const total = Number(totalRows[0]?.total ?? 0);
    const maxId = totalRows[0]?.maxId ?? 0;
    const profileStamp = metadataRow?.updatedAt ? metadataRow.updatedAt.getTime() : 0;

    return {
        company: {
            name: nonEmpty(companyRow?.name),
            description: nonEmpty(companyRow?.description),
            industry: nonEmpty(companyRow?.industry),
            size: sizeLabel(companyRow?.size),
        },
        profileText,
        sourceCount: total,
        folders,
        recentDocuments,
        connections: activeConnections,
        fingerprint: `${total}:${maxId}:${profileStamp}:${activeConnections.join("+")}`,
    };
}

/** Signup stores empty strings for fields it did not collect; the prompt wants them absent. */
function nonEmpty(raw: string | null | undefined): string | null {
    const value = raw?.trim();
    if (!value) return null;
    return value;
}

/** Signup stores "0" for an unknown headcount; anything else is a range or a number. */
function sizeLabel(raw: string | null | undefined): string | null {
    const value = raw?.trim();
    if (!value || value === "0") return null;
    return /^\d+$/.test(value) ? `${value} employees` : value;
}
