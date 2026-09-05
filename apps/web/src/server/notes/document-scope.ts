/**
 * Scoping notes by the document they are anchored to (ADR-010).
 *
 * A note belongs to its author, but an anchored note quotes a document — so
 * when the document falls outside the reader's `DocumentScope`, the note goes
 * with it. An unanchored note has no document to inherit from and stays
 * visible to its workspace.
 *
 * Both helpers resolve the document rows themselves rather than trusting a
 * `documentId` handed in by a caller, and re-check each row with
 * `scopeAllows` — the same belt-and-braces pass `~/lib/authz/scope` applies
 * after its SQL predicate.
 *
 * NOTE: this module was lost before it reached the repository — `.gitignore`
 * carried a bare `notes/` rule that silently matched
 * `apps/web/src/server/notes/`, so the commit that introduced its three
 * callers never carried the file. It has been reconstructed from those call
 * sites and from `~/lib/authz/scope`. The behaviour it implements is an
 * access-control decision, so it deserves a read against the ADR-010 intent
 * rather than a rubber stamp.
 */

import { inArray } from "drizzle-orm";

import { document } from "@launchstack/store/schema";

import { db } from "~/server/db";
import { scopeAllows } from "~/lib/authz/scope";
import { type DocumentScope } from "~/lib/authz/scope-types";

/** `document_notes.document_id` is a varchar; document ids are numeric. */
function toDocumentId(value: string | null | undefined): number | null {
    if (value === null || value === undefined || value.trim() === "") return null;
    const id = Number(value);
    return Number.isFinite(id) ? id : null;
}

/**
 * Which of `documentIds` this scope permits, resolved in one query.
 * Ids that name no document in this company are simply absent from the result,
 * so a dangling reference reads as "not visible" rather than as "unrestricted".
 */
async function visibleDocumentIds(
    documentIds: readonly number[],
    companyId: bigint,
    scope: DocumentScope
): Promise<Set<number>> {
    if (documentIds.length === 0) return new Set();

    const rows = await db
        .select({ id: document.id, category: document.category, companyId: document.companyId })
        .from(document)
        .where(inArray(document.id, [...new Set(documentIds)]));

    const visible = new Set<number>();
    for (const row of rows) {
        // Cross-company rows can never be visible, whatever the scope says.
        if (row.companyId !== companyId) continue;
        if (scopeAllows(scope, { id: row.id, category: row.category })) {
            visible.add(Number(row.id));
        }
    }
    return visible;
}

/**
 * Whether a note anchored to `documentId` may be read.
 *
 * `null` — an unanchored note — is visible: there is no document to inherit a
 * restriction from.
 */
export async function isNoteDocumentVisible(
    documentId: string | null | undefined,
    companyId: bigint,
    scope: DocumentScope
): Promise<boolean> {
    const id = toDocumentId(documentId);
    if (id === null) return true;
    if (scope.kind === "everything") return true;

    const visible = await visibleDocumentIds([id], companyId, scope);
    return visible.has(id);
}

/**
 * Drop the notes whose anchor document this scope hides. Unanchored notes are
 * kept. One query for the whole batch, not one per note.
 */
export async function filterNotesByDocumentScope<T extends { documentId: string | null }>(
    notes: readonly T[],
    companyId: bigint,
    scope: DocumentScope
): Promise<T[]> {
    if (scope.kind === "everything") return [...notes];

    const anchored = notes
        .map(note => toDocumentId(note.documentId))
        .filter((id): id is number => id !== null);

    const visible = await visibleDocumentIds(anchored, companyId, scope);

    return notes.filter(note => {
        const id = toDocumentId(note.documentId);
        return id === null || visible.has(id);
    });
}
