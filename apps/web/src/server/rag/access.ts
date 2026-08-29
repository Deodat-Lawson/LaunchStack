/**
 * App-side access resolution for retrieval: which documents a user may
 * search, and their titles. This is product-schema knowledge (the `users`
 * table), so it stays in apps/web and is injected where a retrieval tool
 * needs it (see @launchstack/retrieval/tools/rag-search-tool).
 */

import { db } from "~/server/db/index";
import { eq } from "drizzle-orm";
import { document } from "@launchstack/store/schema";
import { users } from "~/server/db/schema";

export async function validateDocumentAccess(
    userId: string,
    requestedDocIds: (string | number)[]
): Promise<{
    validDocIds: number[];
    documentTitles: Map<number, string>;
    companyId: string | null;
}> {
    const [userInfo] = await db.select().from(users).where(eq(users.userId, userId));

    if (!userInfo) {
        return { validDocIds: [], documentTitles: new Map(), companyId: null };
    }

    const companyId = userInfo.companyId;
    const numericIds = requestedDocIds.map(id => Number(id));

    const docs = await db
        .select({
            id: document.id,
            title: document.title,
        })
        .from(document)
        .where(eq(document.companyId, companyId));

    const validDocIds = docs.map(d => d.id).filter(id => numericIds.includes(id));

    const documentTitles = new Map<number, string>();
    docs.forEach(d => {
        if (numericIds.includes(d.id)) {
            documentTitles.set(d.id, d.title);
        }
    });

    return { validDocIds, documentTitles, companyId: companyId.toString() };
}

export async function getUserCompanyId(userId: string): Promise<string | null> {
    const [userInfo] = await db
        .select({ companyId: users.companyId })
        .from(users)
        .where(eq(users.userId, userId));

    return userInfo?.companyId ? userInfo.companyId.toString() : null;
}
