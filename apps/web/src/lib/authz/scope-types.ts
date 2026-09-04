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
 * The same shape crosses into `@launchstack/retrieval` as its `DocumentScope`,
 * where it becomes a SQL predicate on the chunk query — the brick receives
 * names and ids, never a user, group, or grant.
 *
 * Dependency-free so the client can reason about scope for UI decisions.
 */

export type DocumentScope =
    | { readonly kind: "everything" }
    | {
          readonly kind: "except";
          /** Folder names the person may not see (restricted, no grant). */
          readonly deniedCategories: readonly string[];
          /** Restricted documents the person may not see. */
          readonly deniedDocumentIds: readonly number[];
          /** Documents the person may see even inside a denied folder (explicit grant). */
          readonly allowedDocumentIds: readonly number[];
      }
    | {
          readonly kind: "only";
          /** Folder names the person may see. */
          readonly allowedCategories: readonly string[];
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

/** The one in-memory answer every enforcement point agrees with. */
export function scopeAllowsDocument(scope: DocumentScope, doc: ScopedDocumentRef): boolean {
    if (scope.kind === "everything") return true;
    const category = doc.category ?? "";
    if (scope.allowedDocumentIds.includes(doc.id)) return true;
    if (scope.deniedDocumentIds.includes(doc.id)) return false;
    if (scope.kind === "except") return !scope.deniedCategories.includes(category);
    return scope.allowedCategories.includes(category);
}

export function scopeAllowsCategory(scope: DocumentScope, category: string): boolean {
    if (scope.kind === "everything") return true;
    if (scope.kind === "except") return !scope.deniedCategories.includes(category);
    return scope.allowedCategories.includes(category);
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
    if (scope.kind === "except") {
        return (
            scope.deniedCategories.length +
            scope.deniedDocumentIds.length +
            scope.allowedDocumentIds.length
        );
    }
    return (
        scope.allowedCategories.length +
        scope.deniedDocumentIds.length +
        scope.allowedDocumentIds.length
    );
}
