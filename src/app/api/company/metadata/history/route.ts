/**
 * GET /api/company/metadata/history
 *
 * Returns the audit history for the logged-in user's company metadata.
 * Sorted newest-first, limited to 100 entries.
 */

import { NextResponse } from "next/server";
import { auth } from "~/lib/auth-server";
import { eq, desc } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { companyMetadataHistory } from "~/server/db/schema/company-metadata";

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const [userInfo] = await db
            .select({ companyId: users.companyId })
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json({ error: "User not found" }, { status: 400 });
        }

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
            .where(eq(companyMetadataHistory.companyId, userInfo.companyId))
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
