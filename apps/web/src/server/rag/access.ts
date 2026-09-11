/**
 * App-side access resolution for retrieval: which of the requested documents
 * a user may search, and their titles. This is product-schema knowledge
 * (memberships, roles, grants), so it stays in apps/web and is injected where
 * a retrieval tool needs it (see @launchstack/retrieval/tools/rag-search-tool).
 *
 * The answer comes from the user's active workspace membership, never from
 * the legacy global `users.role` / `users.status`: an active membership, its
 * role's permissions, and the document scope those resolve to. Anything
 * short of that — no membership, not active, no `documents.read`, no request
 * context to resolve the active workspace in — is an empty answer.
 */

import { and, eq, inArray } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";
import { resolveDocumentScope, scopedDocumentWhere } from "~/lib/authz/scope";
import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import { db } from "~/server/db/index";
import { userCompanyMemberships, users } from "~/server/db/schema";

type AccessAnswer = {
    validDocIds: number[];
    documentTitles: Map<number, string>;
    companyId: string | null;
};

const nothing = (companyId: string | null = null): AccessAnswer => ({
    validDocIds: [],
    documentTitles: new Map(),
    companyId,
});

export async function validateDocumentAccess(
    userId: string,
    requestedDocIds: (string | number)[]
): Promise<AccessAnswer> {
    const [user] = await db
        .select({ id: users.id, companyId: users.companyId })
        .from(users)
        .where(eq(users.userId, userId));

    if (!user) return nothing();

    let companyId: bigint | null;
    try {
        companyId = await resolveActiveCompanyForUser(user.id, user.companyId);
    } catch (error) {
        // No request context to read the active-workspace cookie from. Fail
        // closed: a guess at the workspace is a guess at the scope.
        console.error("[rag/access] could not resolve the active workspace:", error);
        return nothing();
    }
    if (companyId == null) return nothing();

    const userPk = BigInt(user.id);
    const [membership] = await db
        .select({ role: userCompanyMemberships.role, status: userCompanyMemberships.status })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.userId, userPk),
                eq(userCompanyMemberships.companyId, companyId)
            )
        );

    const companyIdText = companyId.toString();
    if (!membership || membership.status !== "active") return nothing(companyIdText);

    const permissions = await resolvePermissionsForRole(companyId, membership.role);
    if (!permissions.has("documents.read")) return nothing(companyIdText);

    const scope = await resolveDocumentScope({
        companyId,
        userPk,
        role: membership.role,
        permissions,
    });

    const numericIds = [
        ...new Set(requestedDocIds.map(id => Number(id)).filter(id => Number.isFinite(id))),
    ];
    if (numericIds.length === 0) return nothing(companyIdText);

    const docs = await db
        .select({ id: document.id, title: document.title, category: document.category })
        .from(document)
        .where(and(inArray(document.id, numericIds), scopedDocumentWhere(companyId, scope)));

    const validDocIds: number[] = [];
    const documentTitles = new Map<number, string>();
    for (const doc of docs) {
        // The SQL already applied the scope; re-checking the row is cheap.
        if (!scopeAllowsDocument(scope, { id: doc.id, category: doc.category })) continue;
        validDocIds.push(doc.id);
        documentTitles.set(doc.id, doc.title);
    }

    return { validDocIds, documentTitles, companyId: companyIdText };
}

export async function getUserCompanyId(userId: string): Promise<string | null> {
    const [userInfo] = await db
        .select({ companyId: users.companyId })
        .from(users)
        .where(eq(users.userId, userId));

    return userInfo?.companyId ? userInfo.companyId.toString() : null;
}
