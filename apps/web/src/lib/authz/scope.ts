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
 * Nobody reads past a restriction by role (ADR-014): private means private,
 * Owners and Admins included. `folders.manage` governs workspace-wide folders;
 * a restricted folder is reached only through a grant — to the person, one of
 * their groups, or their role.
 */

import { and, eq, inArray, notInArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

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
    scopeAllowsCategory,
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

    // 4. Reach-in grants (ADR-014): a person added to a folder or file that
    //    only *inherits* a restriction — "Same as Q4 planning", plus Ada — sees
    //    it although they are not on the restricted folder's list. Only grants
    //    that change the answer are kept, so the scope grows with what was
    //    shared into closed places, not with everything someone uploaded.
    const interim: DocumentScope = isGuest
        ? {
              kind: "only",
              allowedCategories: grantedCategories,
              deniedCategories,
              deniedDocumentIds,
              allowedDocumentIds,
          }
        : {
              kind: "except",
              deniedCategories,
              allowedCategories: grantedCategories,
              deniedDocumentIds,
              allowedDocumentIds,
          };
    const reach = await reachInGrants(subject.companyId, principal, {
        restrictedFolderIds: new Set(folderIds.map(String)),
        restrictedDocumentIds: new Set(documentIds.map(String)),
    });
    for (const path of reach.folders) {
        if (!scopeAllowsCategory(interim, path)) grantedCategories.push(path);
    }
    for (const doc of reach.documents) {
        if (!scopeAllowsCategory(interim, doc.category ?? "")) allowedDocumentIds.push(doc.id);
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

/**
 * Grants reaching the caller on folders and documents that are not
 * themselves restricted — the candidates for a reach-in exception.
 */
async function reachInGrants(
    companyId: bigint,
    principal: { userPk: string; groupIds: ReadonlySet<string>; role: string },
    restricted: {
        restrictedFolderIds: ReadonlySet<string>;
        restrictedDocumentIds: ReadonlySet<string>;
    }
): Promise<{ folders: string[]; documents: { id: number; category: string | null }[] }> {
    const groupIds = [...principal.groupIds];
    const reaches = (table: typeof folderGrants | typeof documentGrants) =>
        or(
            and(eq(table.principalType, "user"), eq(table.principalId, principal.userPk)),
            groupIds.length > 0
                ? and(eq(table.principalType, "group"), inArray(table.principalId, groupIds))
                : undefined,
            eq(table.principalType, "role")
        );
    const [folderRows, documentRows] = await Promise.all([
        db
            .select({
                categoryId: folderGrants.categoryId,
                name: category.name,
                principalType: folderGrants.principalType,
                principalId: folderGrants.principalId,
            })
            .from(folderGrants)
            .innerJoin(category, eq(category.id, folderGrants.categoryId))
            .where(and(eq(folderGrants.companyId, companyId), reaches(folderGrants))),
        db
            .select({
                documentId: documentGrants.documentId,
                category: document.category,
                principalType: documentGrants.principalType,
                principalId: documentGrants.principalId,
            })
            .from(documentGrants)
            .innerJoin(document, eq(document.id, documentGrants.documentId))
            .where(and(eq(documentGrants.companyId, companyId), reaches(documentGrants))),
    ]);
    const folders = new Set<string>();
    for (const row of folderRows) {
        if (restricted.restrictedFolderIds.has(row.categoryId.toString())) continue;
        if (principalMatches(row, principal)) folders.add(row.name);
    }
    const documents = new Map<number, string | null>();
    for (const row of documentRows) {
        if (restricted.restrictedDocumentIds.has(row.documentId.toString())) continue;
        if (principalMatches(row, principal)) documents.set(Number(row.documentId), row.category);
    }
    return {
        folders: [...folders],
        documents: [...documents].map(([id, cat]) => ({ id, category: cat })),
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
 * The folder half of the scope as one CASE over a folder-path column
 * (`document.category` unless told otherwise), rules deepest first, so the
 * nearest restricted ancestor decides. `undefined` means the folders impose
 * no filter. Exported for other rows filed in folders — mindmap drafts — so
 * they are listed by exactly the rule documents are.
 */
export function folderScopePredicate(
    scope: DocumentScope,
    column: AnyColumn = document.category
): SQL | undefined {
    const rules = scopeFolderRules(scope);
    const otherwise = scopeDefaultAllow(scope);
    if (rules.length === 0) return otherwise ? undefined : sql`false`;
    const whens = rules.map(
        rule =>
            sql`WHEN (${column} = ${rule.path} OR ${column} LIKE ${descendantPattern(rule.path)}) THEN ${rule.allow ? sql`true` : sql`false`}`
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

    let base = folderScopePredicate(scope);
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
