import { and, eq } from "drizzle-orm";

import { category } from "@launchstack/store/schema";
import { normalizeRoleSlug, type Permission } from "~/lib/authz/permissions";
import { SCOPE_EVERYTHING, type DocumentScope } from "~/lib/authz/scope-types";
import { resolveMemberContext, type WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { documentSettings, folderSettings } from "~/server/db/schema";

/** Accelerators is for the company's active members; guests are not members. */
export class AcceleratorAccessError extends Error {
    readonly status = 403;
    readonly code = "accelerators_access_denied";

    constructor() {
        super("Accelerators is available to active company members with the requested permission.");
    }
}

/**
 * Accelerators reads only what the whole company may read (see `companySharedScope`), and
 * its results are shared with every member, so it needs membership and the action's
 * permission, never access to private documents.
 */
export function assertAcceleratorAccess(
    member: WorkspaceContext,
    permission: Permission = "documents.read"
): void {
    if (
        member.status !== "active" ||
        normalizeRoleSlug(member.role) === "guest" ||
        !member.can("documents.read") ||
        !member.can(permission)
    ) {
        throw new AcceleratorAccessError();
    }
}

/** Resolve again, rather than reusing a request's membership after an AI call. */
export async function resolveAcceleratorMember(
    userId: string,
    companyId: bigint,
    permission: Permission = "documents.read"
): Promise<WorkspaceContext> {
    const member = await resolveMemberContext(userId, companyId);
    if (!member) throw new AcceleratorAccessError();
    assertAcceleratorAccess(member, permission);
    return member;
}

/**
 * What every member of the company may read: the workspace minus each restricted folder
 * (with its subfolders) and each restricted document, whoever they are shared with.
 * Fit results are saved once per company and shown to every member, so they are built
 * from this view alone; a private source never shapes what a colleague is shown.
 */
export async function companySharedScope(companyId: bigint): Promise<DocumentScope> {
    const [folders, documents] = await Promise.all([
        db
            .select({ name: category.name })
            .from(folderSettings)
            .innerJoin(category, eq(category.id, folderSettings.categoryId))
            .where(
                and(
                    eq(folderSettings.companyId, companyId),
                    eq(folderSettings.visibility, "restricted")
                )
            ),
        db
            .select({ documentId: documentSettings.documentId })
            .from(documentSettings)
            .where(
                and(
                    eq(documentSettings.companyId, companyId),
                    eq(documentSettings.restricted, true)
                )
            ),
    ]);
    if (folders.length === 0 && documents.length === 0) return SCOPE_EVERYTHING;
    return {
        kind: "except",
        deniedCategories: folders.map(folder => folder.name),
        allowedCategories: [],
        deniedDocumentIds: documents.map(row => Number(row.documentId)),
        allowedDocumentIds: [],
    };
}
