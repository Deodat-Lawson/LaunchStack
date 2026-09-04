/**
 * The document scope as SQL and as an in-memory check.
 *
 * Every company-scoped leg receives the caller's `DocumentScope` (folder
 * names and document ids, never a user or a grant) and turns it into a
 * predicate on the `document` table, so a chunk the caller may not read is
 * never a candidate. `scopeAllowsDocument` is the same rule for rows already
 * in memory — the belt to the SQL's braces.
 *
 * Empty lists are omitted rather than rendered: drizzle turns an empty
 * `inArray` into a constant, and a scope that denies nothing must not filter.
 */

import { and, inArray, notInArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import type { DocumentScope } from "../search-types";

/** The two columns a scope predicate reads, however the query names them. */
export interface ScopeColumns {
    id: SQLWrapper;
    category: SQLWrapper;
}

/**
 * The scope as a predicate over arbitrary id/category expressions.
 * `undefined` means "no filter", so callers can `and(...)` it unconditionally.
 */
export function documentScopeSqlFor(
    scope: DocumentScope | undefined,
    columns: ScopeColumns
): SQL | undefined {
    if (!scope || scope.kind === "everything") return undefined;

    const allowedIds = [...scope.allowedDocumentIds];
    const deniedIds = [...scope.deniedDocumentIds];

    if (scope.kind === "except") {
        const denials: SQL[] = [];
        if (scope.deniedCategories.length > 0) {
            denials.push(notInArray(columns.category, [...scope.deniedCategories]));
        }
        if (deniedIds.length > 0) denials.push(notInArray(columns.id, deniedIds));
        if (denials.length === 0) return undefined;
        const base = and(...denials)!;
        if (allowedIds.length === 0) return base;
        return or(base, inArray(columns.id, allowedIds))!;
    }

    // only
    const parts: SQL[] = [];
    if (scope.allowedCategories.length > 0) {
        const inCategories = inArray(columns.category, [...scope.allowedCategories]);
        parts.push(
            deniedIds.length > 0
                ? and(inCategories, notInArray(columns.id, deniedIds))!
                : inCategories
        );
    }
    if (allowedIds.length > 0) parts.push(inArray(columns.id, allowedIds));
    if (parts.length === 0) return sql`false`;
    return parts.length === 1 ? parts[0] : or(...parts)!;
}

/** The scope over the engine `document` table, for query-builder legs. */
export function documentScopeSql(scope: DocumentScope | undefined): SQL | undefined {
    return documentScopeSqlFor(scope, { id: document.id, category: document.category });
}

/**
 * The scope over an aliased `document` table, for hand-written SQL legs
 * (`JOIN document d ON …`). Values are bound as parameters, never inlined.
 */
export function documentScopeSqlForAlias(
    scope: DocumentScope | undefined,
    alias: string
): SQL | undefined {
    const table = sql.identifier(alias);
    return documentScopeSqlFor(scope, {
        id: sql`${table}.id`,
        category: sql`${table}.category`,
    });
}

export interface ScopedDocumentRef {
    id: number;
    category: string | null | undefined;
}

/** The in-memory rule the SQL encodes; the host's helper of the same name agrees. */
export function scopeAllowsDocument(
    scope: DocumentScope | undefined,
    doc: ScopedDocumentRef
): boolean {
    if (!scope || scope.kind === "everything") return true;
    const category = doc.category ?? "";
    if (scope.allowedDocumentIds.includes(doc.id)) return true;
    if (scope.deniedDocumentIds.includes(doc.id)) return false;
    if (scope.kind === "except") return !scope.deniedCategories.includes(category);
    return scope.allowedCategories.includes(category);
}
