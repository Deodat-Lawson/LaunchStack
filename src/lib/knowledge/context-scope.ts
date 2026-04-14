import { and, eq, inArray } from "drizzle-orm";
import { db } from "~/server/db";
import { document } from "~/server/db/schema";

/**
 * Ensures every document ID belongs to the given company. Use before scoped RAG
 * (Q&A, marketing pipeline, research, legal KB injection).
 */
export async function assertDocumentIdsBelongToCompany(
    documentIds: number[],
    companyId: number,
): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
    const unique = [...new Set(documentIds)];
    if (unique.length === 0) {
        return { ok: false, message: "At least one document is required for this scope.", status: 400 };
    }

    const rows = await db
        .select({ id: document.id })
        .from(document)
        .where(and(eq(document.companyId, BigInt(companyId)), inArray(document.id, unique)));

    if (rows.length !== unique.length) {
        return {
            ok: false,
            message: "One or more documents are missing or not in your company library.",
            status: 403,
        };
    }

    return { ok: true };
}
