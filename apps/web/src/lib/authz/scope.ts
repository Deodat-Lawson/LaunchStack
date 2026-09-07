/**
 * Resolves a person's `DocumentScope` and turns it into SQL.
 *
 * Three small indexed reads, only when a route reads documents, and only when
 * the workspace has at least one restricted folder or document:
 *
 *   1. the restricted folders and restricted documents of the workspace;
 *   2. the caller's group ids;
 *   3. the grants on those folders and documents whose principal is the
 *      caller, one of their groups, or their role.
 *
 * Anyone holding `folders.manage` sees everything — they could grant
 * themselves anything anyway, and pretending otherwise would only hide
 * folders from the people who administer them.
 */

import { and, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";

import { category, document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import {
    documentGrants,
    documentSettings,
    folderGrants,
    folderSettings,
    workspaceGroupMembers,
} from "~/server/db/schema";

import { normalizeRoleSlug, type Permission } from "./permissions";
import {
    SCOPE_EVERYTHING,
    SCOPE_NOTHING,
    scopeAllowsDocument,
    scopeDefaultAllow,
    scopeFolderRules,
    type DocumentScope,
} from "./scope-types";

export interface ScopeSubject {
    readonly companyId: bigint;
    readonly userPk: bigint;
    readonly role: string;
    readonly permissions: ReadonlySet<Permission>;
}

interface GrantRow {
    principalType: string;
    principalId: string;
}

function principalMatches(
    row: GrantRow,
    subject: { userPk: string; groupIds: ReadonlySet<string>; role: string }
): boolean {
    switch (row.principalType) {
        case "user":
            return row.principalId === subject.userPk;
        case "group":
            return subject.groupIds.has(row.principalId);
        case "role":
            return normalizeRoleSlug(row.principalId) === subject.role;
        default:
            return false;
    }
}

export async function resolveDocumentScope(subject: ScopeSubject): Promise<DocumentScope> {
    if (!subject.permissions.has("documents.read")) return SCOPE_NOTHING;

    const role = normalizeRoleSlug(subject.role);
    const isGuest = role === "guest";
    if (!isGuest && subject.permissions.has("folders.manage")) return SCOPE_EVERYTHING;

    // 1. What is restricted in this workspace?
    const [restrictedFolders, restrictedDocuments] = await Promise.all([
        db
            .select({ categoryId: folderSettings.categoryId, name: category.name })
            .from(folderSettings)
            .innerJoin(category, eq(category.id, folderSettings.categoryId))
            .where(
                and(
                    eq(folderSettings.companyId, subject.companyId),
                    eq(folderSettings.visibility, "restricted")
                )
            ),
        db
            .select({ documentId: documentSettings.documentId, category: document.category })
            .from(documentSettings)
            .innerJoin(document, eq(document.id, documentSettings.documentId))
            .where(
                and(
                    eq(documentSettings.companyId, subject.companyId),
                    eq(documentSettings.restricted, true)
                )
            ),
    ]);

    if (!isGuest && restrictedFolders.length === 0 && restrictedDocuments.length === 0) {
        return SCOPE_EVERYTHING;
    }

    // 2. Which principals is the caller?
    const groupRows = await db
        .select({ groupId: workspaceGroupMembers.groupId })
        .from(workspaceGroupMembers)
        .where(eq(workspaceGroupMembers.userId, subject.userPk));
    const principal = {
        userPk: subject.userPk.toString(),
        groupIds: new Set(groupRows.map(g => g.groupId.toString())),
        role,
    };

    // 3. Which grants reach the caller?
    type FolderGrantRow = GrantRow & { categoryId: bigint };
    type DocumentGrantRow = GrantRow & { documentId: bigint };
    const folderIds = restrictedFolders.map(f => f.categoryId);
    const documentIds = restrictedDocuments.map(d => d.documentId);
    const [folderGrantRows, documentGrantRows] = await Promise.all([
        folderIds.length === 0
            ? Promise.resolve<FolderGrantRow[]>([])
            : db
                  .select({
                      categoryId: folderGrants.categoryId,
                      principalType: folderGrants.principalType,
                      principalId: folderGrants.principalId,
                  })
                  .from(folderGrants)
                  .where(
                      and(
                          eq(folderGrants.companyId, subject.companyId),
                          inArray(folderGrants.categoryId, folderIds)
                      )
                  ),
        documentIds.length === 0
            ? Promise.resolve<DocumentGrantRow[]>([])
            : db
                  .select({
                      documentId: documentGrants.documentId,
                      principalType: documentGrants.principalType,
                      principalId: documentGrants.principalId,
                  })
                  .from(documentGrants)
                  .where(
                      and(
                          eq(documentGrants.companyId, subject.companyId),
                          inArray(documentGrants.documentId, documentIds)
                      )
                  ),
    ]);

    const grantedFolderIds = new Set<string>();
    for (const g of folderGrantRows) {
        if (principalMatches(g, principal)) grantedFolderIds.add(g.categoryId.toString());
    }
    const grantedDocumentIds = new Set<string>();
    for (const g of documentGrantRows) {
        if (principalMatches(g, principal)) grantedDocumentIds.add(g.documentId.toString());
    }

    const grantedCategories: string[] = [];
    const deniedCategories: string[] = [];
    for (const f of restrictedFolders) {
        (grantedFolderIds.has(f.categoryId.toString()) ? grantedCategories : deniedCategories).push(
            f.name
        );
    }

    const allowedDocumentIds: number[] = [];
    const deniedDocumentIds: number[] = [];
    for (const d of restrictedDocuments) {
        (grantedDocumentIds.has(d.documentId.toString())
            ? allowedDocumentIds
            : deniedDocumentIds
        ).push(Number(d.documentId));
    }

    if (isGuest) {
        return {
            kind: "only",
            allowedCategories: grantedCategories,
            deniedCategories,
            deniedDocumentIds,
            allowedDocumentIds,
        };
    }

    if (
        deniedCategories.length === 0 &&
        deniedDocumentIds.length === 0 &&
        allowedDocumentIds.length === 0
    ) {
        return SCOPE_EVERYTHING;
    }

    // Granted folders ride along as carve-outs: a granted subfolder beneath a
    // denied folder stays visible, because the nearest restricted ancestor wins.
    return {
        kind: "except",
        deniedCategories,
        allowedCategories: grantedCategories,
        deniedDocumentIds,
        allowedDocumentIds,
    };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** Escape a literal for a LIKE pattern (Postgres escapes with a backslash by default). */
function escapeLikeLiteral(value: string): string {
    return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/** The LIKE pattern matching everything strictly beneath a folder path. */
function descendantPattern(path: string): string {
    return `${escapeLikeLiteral(path)}/%`;
}

/**
 * The folder half of the scope as one CASE over `document.category`, rules
 * deepest first, so the nearest restricted ancestor decides. `undefined`
 * means the folders impose no filter.
 */
function folderPredicate(scope: DocumentScope): SQL | undefined {
    const rules = scopeFolderRules(scope);
    const otherwise = scopeDefaultAllow(scope);
    if (rules.length === 0) return otherwise ? undefined : sql`false`;
    const whens = rules.map(
        rule =>
            sql`WHEN (${document.category} = ${rule.path} OR ${document.category} LIKE ${descendantPattern(rule.path)}) THEN ${rule.allow ? sql`true` : sql`false`}`
    );
    return sql`(CASE ${sql.join(whens, sql` `)} ELSE ${otherwise ? sql`true` : sql`false`} END)`;
}

/**
 * The scope as a predicate over the engine `document` table. `undefined` for
 * `everything`, so callers can `and(...)` it in unconditionally.
 */
export function documentScopePredicate(scope: DocumentScope): SQL | undefined {
    if (scope.kind === "everything") return undefined;

    // `document.id` is a bigserial in number mode, so the values are numbers.
    const allowedIds = [...scope.allowedDocumentIds];
    const deniedIds = [...scope.deniedDocumentIds];

    let base = folderPredicate(scope);
    if (deniedIds.length > 0) {
        const notDenied = notInArray(document.id, deniedIds);
        base = base ? and(base, notDenied) : notDenied;
    }
    if (allowedIds.length > 0 && base) {
        base = or(base, inArray(document.id, allowedIds));
    }
    return base;
}

/** `company_id = ? AND <scope>` — the predicate every document read goes through. */
export function scopedDocumentWhere(companyId: bigint, scope: DocumentScope): SQL {
    const predicate = documentScopePredicate(scope);
    const base = eq(document.companyId, companyId);
    return predicate ? and(base, predicate)! : base;
}

/** Re-checks a row the SQL already filtered — cheap, and the belt to the braces. */
export function scopeAllows(
    scope: DocumentScope,
    doc: { id: number | bigint; category: string | null }
): boolean {
    return scopeAllowsDocument(scope, { id: Number(doc.id), category: doc.category });
}
