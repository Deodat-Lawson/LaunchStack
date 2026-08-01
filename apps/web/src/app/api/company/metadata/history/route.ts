/**
 * GET /api/company/metadata/history
 *
 * Returns the audit history for the logged-in user's company metadata.
 * Sorted newest-first, limited to 100 entries.
 */

import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";

import { db } from "~/server/db";
import { companyMetadataHistory } from "@launchstack/core/db/schema/company-metadata";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const history = await db
            .select({
                id: companyMetadataHistory.id,
                changeType: companyMetadataHistory.changeType,
                diff: companyMetadataHistory.diff,
                changedBy: companyMetadataHistory.changedBy,
                documentId: companyMetadataHistory.documentId,
                createdAt: companyMetadataHistory.createdAt,
            })
            .from(companyMetadataHistory)
            .where(eq(companyMetadataHistory.companyId, ctx.data.companyId))
            .orderBy(desc(companyMetadataHistory.createdAt))
            .limit(100);

        const serializable = history.map((h) => ({
            ...h,
            documentId: h.documentId != null ? String(h.documentId) : null,
        }));

        return NextResponse.json({ history: serializable });
    } catch (error) {
        console.error("[company-metadata/history] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
