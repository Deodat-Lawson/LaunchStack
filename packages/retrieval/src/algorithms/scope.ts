/**
 * The document scope as SQL and as an in-memory check.
 *
 * Every company-scoped leg receives the caller's `DocumentScope` (folder
 * paths and document ids, never a user or a grant) and turns it into a
 * predicate on the `document` table, so a chunk the caller may not read is
 * never a candidate. `scopeAllowsDocument` is the same rule for rows already
 * in memory — the belt to the SQL's braces.
 *
 * Folders are paths (`Finance/Q3`) and a folder rule covers the folder and
 * everything beneath it. Rules are evaluated deepest first, so when nested
 * folders disagree the nearest restricted ancestor decides — the host's
 * helper of the same name follows the same order.
 */

import { and, inArray, notInArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import type { DocumentScope } from "../search-types";

/** The two columns a scope predicate reads, however the query names them. */
export interface ScopeColumns {
    id: SQLWrapper;
    category: SQLWrapper;
}

export interface FolderRule {
    readonly path: string;
    readonly allow: boolean;
}

const SEPARATOR = "/";

/** True when `path` is `ancestor` or sits anywhere beneath it. */
export function isFolderOrDescendant(path: string, ancestor: string): boolean {
    return path === ancestor || path.startsWith(ancestor + SEPARATOR);
}

function depthOf(path: string): number {
    return path.split(SEPARATOR).length;
}

/** Escape a literal for a LIKE pattern (Postgres escapes with a backslash by default). */
function escapeLikeLiteral(value: string): string {
    return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/** The LIKE pattern matching everything strictly beneath a folder path. */
function descendantPattern(path: string): string {
    return `${escapeLikeLiteral(path)}${SEPARATOR}%`;
}

/** The scope's folder decisions, deepest first. */
export function scopeFolderRules(scope: DocumentScope): FolderRule[] {
    if (scope.kind === "everything") return [];
    const rules: FolderRule[] = [];
    for (const path of scope.deniedCategories ?? []) rules.push({ path, allow: false });
    for (const path of scope.allowedCategories ?? []) rules.push({ path, allow: true });
    return rules.sort((a, b) => {
        const byDepth = depthOf(b.path) - depthOf(a.path);
        if (byDepth !== 0) return byDepth;
        return b.path.length - a.path.length || a.path.localeCompare(b.path);
    });
}

/** What applies to a folder no rule mentions: `except` lets it through, `only` does not. */
export function scopeDefaultAllow(scope: DocumentScope): boolean {
    return scope.kind !== "only";
}

/**
 * The folder half of the scope as one CASE over the category column.
 * `undefined` means the folders impose no filter.
 */
function folderPredicate(scope: DocumentScope, category: SQLWrapper): SQL | undefined {
    const rules = scopeFolderRules(scope);
    const otherwise = scopeDefaultAllow(scope);
    if (rules.length === 0) return otherwise ? undefined : sql`false`;
    const whens = rules.map(
        rule =>
            sql`WHEN (${category} = ${rule.path} OR ${category} LIKE ${descendantPattern(rule.path)}) THEN ${rule.allow ? sql`true` : sql`false`}`
    );
    return sql`(CASE ${sql.join(whens, sql` `)} ELSE ${otherwise ? sql`true` : sql`false`} END)`;
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

    let base = folderPredicate(scope, columns.category);
    if (deniedIds.length > 0) {
        const notDenied = notInArray(columns.id, deniedIds);
        base = base ? and(base, notDenied) : notDenied;
    }
    if (allowedIds.length > 0 && base) {
        base = or(base, inArray(columns.id, allowedIds));
    }
    return base;
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

export function scopeAllowsCategory(scope: DocumentScope | undefined, category: string): boolean {
    if (!scope || scope.kind === "everything") return true;
    for (const rule of scopeFolderRules(scope)) {
        if (isFolderOrDescendant(category, rule.path)) return rule.allow;
    }
    return scopeDefaultAllow(scope);
}

/** The in-memory rule the SQL encodes; the host's helper of the same name agrees. */
export function scopeAllowsDocument(
    scope: DocumentScope | undefined,
    doc: ScopedDocumentRef
): boolean {
    if (!scope || scope.kind === "everything") return true;
    if (scope.allowedDocumentIds.includes(doc.id)) return true;
    if (scope.deniedDocumentIds.includes(doc.id)) return false;
    return scopeAllowsCategory(scope, doc.category ?? "");
}
