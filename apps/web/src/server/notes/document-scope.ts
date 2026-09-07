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
 * An anchor can land in three states, and they are deliberately distinct:
 *
 *   1. it resolves to a document in this workspace — the scope decides;
 *   2. it resolves to a document in ANOTHER workspace — never visible,
 *      whatever the scope says;
 *   3. it resolves to no document at all — visible.
 *
 * The third case is not an anomaly to fail closed on, it is the normal state
 * of a note whose document was deleted. `document_notes.document_id` is a
 * plain varchar with no foreign key, `deleteDocumentCore` does not cascade to
 * it, and the only statement in the app that deletes a note is the author
 * deleting it themselves. So hiding unresolvable anchors would let deleting a
 * document silently destroy the author's own notes, with no way to reach them
 * again — and it would protect nothing, because an id that names no row
 * exposes no document's content.
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
 * The scope's answer for each id that names a real document, resolved in one
 * query. Ids absent from the result named no document at all — the caller
 * decides what that means, and both callers here read it as visible.
 */
async function resolveAnchors(
    documentIds: readonly number[],
    companyId: bigint,
    scope: DocumentScope
): Promise<Map<number, boolean>> {
    if (documentIds.length === 0) return new Map();

    const rows = await db
        .select({ id: document.id, category: document.category, companyId: document.companyId })
        .from(document)
        .where(inArray(document.id, [...new Set(documentIds)]));

    const decided = new Map<number, boolean>();
    for (const row of rows) {
        // Cross-company rows can never be visible, whatever the scope says.
        const allowed =
            row.companyId === companyId &&
            scopeAllows(scope, { id: row.id, category: row.category });
        decided.set(Number(row.id), allowed);
    }
    return decided;
}

/**
 * Whether a note anchored to `documentId` may be read.
 *
 * `null` — an unanchored note — is visible: there is no document to inherit a
 * restriction from. So is an anchor that resolves to no document (case 3).
 */
export async function isNoteDocumentVisible(
    documentId: string | null | undefined,
    companyId: bigint,
    scope: DocumentScope
): Promise<boolean> {
    const id = toDocumentId(documentId);
    if (id === null) return true;
    if (scope.kind === "everything") return true;

    const decided = await resolveAnchors([id], companyId, scope);
    return decided.get(id) ?? true;
}

/**
 * Drop the notes whose anchor document this scope hides. Unanchored notes and
 * notes whose document no longer exists are kept. One query for the whole
 * batch, not one per note.
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

    const decided = await resolveAnchors(anchored, companyId, scope);

    return notes.filter(note => {
        const id = toDocumentId(note.documentId);
        return id === null || (decided.get(id) ?? true);
    });
}
