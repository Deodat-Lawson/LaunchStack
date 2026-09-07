/**
 * `DocumentScope` — which documents a person may read, resolved once per
 * request and pushed into every read path.
 *
 * Three shapes, chosen so the common case costs nothing:
 *
 * - `everything`: no restricted folders or documents stand between this
 *   person and the workspace (every owner, every startup).
 * - `except`: deny-lists, bounded by the number of restricted things, never
 *   by the number of documents.
 * - `only`: allow-lists, for Guests who see nothing but what they were added to.
 *
 * Folders are paths (`Finance/Q3`), and a restriction covers the folder and
 * everything beneath it. When restricted folders nest with different
 * answers — `Finance` denied, `Finance/Shared` granted — the **nearest
 * restricted ancestor wins**, so both shapes may carry the opposite list as a
 * carve-out (`except.allowedCategories`, `only.deniedCategories`).
 *
 * The same shape crosses into `@launchstack/retrieval` as its `DocumentScope`,
 * where it becomes a SQL predicate on the chunk query — the brick receives
 * folder paths and ids, never a user, group, or grant.
 *
 * Dependency-free so the client can reason about scope for UI decisions.
 */

export type DocumentScope =
    | { readonly kind: "everything" }
    | {
          readonly kind: "except";
          /** Folder paths (and their subfolders) the person may not see. */
          readonly deniedCategories: readonly string[];
          /** Restricted subfolders beneath a denied folder that the person may see. */
          readonly allowedCategories?: readonly string[];
          /** Restricted documents the person may not see. */
          readonly deniedDocumentIds: readonly number[];
          /** Documents the person may see even inside a denied folder (explicit grant). */
          readonly allowedDocumentIds: readonly number[];
      }
    | {
          readonly kind: "only";
          /** Folder paths (and their subfolders) the person may see. */
          readonly allowedCategories: readonly string[];
          /** Restricted subfolders beneath an allowed folder that the person may not see. */
          readonly deniedCategories?: readonly string[];
          /** Restricted documents inside allowed folders that the person may not see. */
          readonly deniedDocumentIds: readonly number[];
          /** Documents the person may see regardless of folder (explicit grant). */
          readonly allowedDocumentIds: readonly number[];
      };

export const SCOPE_EVERYTHING: DocumentScope = Object.freeze({ kind: "everything" } as const);

export const SCOPE_NOTHING: DocumentScope = Object.freeze({
    kind: "only",
    allowedCategories: [],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
} as const);

export interface ScopedDocumentRef {
    id: number;
    category: string | null | undefined;
}

/** One folder decision: the folder and everything beneath it. */
export interface FolderRule {
    readonly path: string;
    readonly allow: boolean;
}

export const FOLDER_PATH_SEPARATOR = "/";

/** True when `path` is `ancestor` or sits anywhere beneath it. */
export function isFolderOrDescendant(path: string, ancestor: string): boolean {
    return path === ancestor || path.startsWith(ancestor + FOLDER_PATH_SEPARATOR);
}

function depthOf(path: string): number {
    return path.split(FOLDER_PATH_SEPARATOR).length;
}

/**
 * The scope's folder decisions, deepest first, so the first rule whose
 * folder contains a path is the nearest restricted ancestor.
 */
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

/** What applies to a folder no rule mentions: members see it, guests do not. */
export function scopeDefaultAllow(scope: DocumentScope): boolean {
    return scope.kind !== "only";
}

export function scopeAllowsCategory(scope: DocumentScope, category: string): boolean {
    if (scope.kind === "everything") return true;
    for (const rule of scopeFolderRules(scope)) {
        if (isFolderOrDescendant(category, rule.path)) return rule.allow;
    }
    return scopeDefaultAllow(scope);
}

/** The one in-memory answer every enforcement point agrees with. */
export function scopeAllowsDocument(scope: DocumentScope, doc: ScopedDocumentRef): boolean {
    if (scope.kind === "everything") return true;
    if (scope.allowedDocumentIds.includes(doc.id)) return true;
    if (scope.deniedDocumentIds.includes(doc.id)) return false;
    return scopeAllowsCategory(scope, doc.category ?? "");
}

export function filterDocumentsByScope<T extends ScopedDocumentRef>(
    scope: DocumentScope,
    docs: readonly T[]
): T[] {
    if (scope.kind === "everything") return [...docs];
    return docs.filter(d => scopeAllowsDocument(scope, d));
}

export function isEverythingScope(scope: DocumentScope): boolean {
    return scope.kind === "everything";
}

/** Rough size of the scope, for the `authz.scope.size` histogram. */
export function scopeSize(scope: DocumentScope): number {
    if (scope.kind === "everything") return 0;
    return (
        (scope.deniedCategories?.length ?? 0) +
        (scope.allowedCategories?.length ?? 0) +
        scope.deniedDocumentIds.length +
        scope.allowedDocumentIds.length
    );
}
