/**
 * Scope checks for notes, read side.
 *
 * A note belongs to its author, but an *anchored* note quotes the document it
 * was taken against. So a note whose document the caller may not read has to
 * disappear along with the document — otherwise the quote becomes a side
 * channel around folder restrictions.
 *
 * This is the companion to `validate-note-target`, and the two answer
 * different questions on purpose:
 *
 *   - `validateNoteTarget` guards **creation**. It fails closed through
 *     `scopedDocumentWhere`, so you cannot anchor a note to a document you
 *     cannot see, and an unresolvable id is a 404.
 *   - these two guard **reading notes that already exist**, where an
 *     unresolvable id means something different (below).
 *
 * A dangling anchor stays visible. `deleteDocumentCore` does not cascade to
 * `document_notes`, so deleting a document leaves every note taken against it
 * pointing at an id that no longer resolves. Hiding those would let a
 * document deletion silently destroy the author's own notes, with nothing in
 * the UI to get them back. Keeping them leaks nothing: an id that resolves to
 * no row exposes no document's content. The check is therefore "is the
 * document this note quotes readable", not "does this id resolve".
 *
 * Both helpers short-circuit on the `everything` scope, which is every owner
 * and every workspace with no restricted folders, so the common path costs no
 * query at all.
 */

import { and, eq, inArray } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import { db } from "~/server/db";
import { scopeAllows } from "~/lib/authz/scope";
import { isEverythingScope, type DocumentScope } from "~/lib/authz/scope-types";

/** `document_notes.document_id` is a varchar holding the document's numeric id. */
function parseAnchor(documentId: string | number | null | undefined): number | null {
    if (documentId == null || documentId === "") return null;
    const id = Number(documentId);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The `{ id, category }` rows the scope decision needs, for the ids that resolve. */
async function loadAnchors(
    ids: readonly number[],
    companyId: bigint
): Promise<Map<number, { id: number; category: string | null }>> {
    if (ids.length === 0) return new Map();
    const rows = await db
        .select({ id: document.id, category: document.category })
        .from(document)
        .where(and(eq(document.companyId, companyId), inArray(document.id, [...ids])));
    return new Map(rows.map(row => [row.id, row]));
}

/**
 * Whether a note anchored to `documentId` may be shown to this caller.
 *
 * True for a freeform note (no anchor) and for an anchor that resolves to no
 * document in this workspace; otherwise the document's own scope answer.
 */
export async function isNoteDocumentVisible(
    documentId: string | number | null | undefined,
    companyId: bigint,
    scope: DocumentScope
): Promise<boolean> {
    if (isEverythingScope(scope)) return true;

    const id = parseAnchor(documentId);
    if (id === null) return true;

    const anchors = await loadAnchors([id], companyId);
    const doc = anchors.get(id);
    if (!doc) return true;

    return scopeAllows(scope, doc);
}

/**
 * The same decision over a page of notes, in one query rather than one per
 * note. Order is preserved, which matters for the caller that has already
 * restored a semantic-relevance ordering.
 */
export async function filterNotesByDocumentScope<T extends { documentId: string | number | null }>(
    notes: readonly T[],
    companyId: bigint,
    scope: DocumentScope
): Promise<T[]> {
    if (isEverythingScope(scope) || notes.length === 0) return [...notes];

    const ids = [
        ...new Set(
            notes
                .map(note => parseAnchor(note.documentId))
                .filter((id): id is number => id !== null)
        ),
    ];
    const anchors = await loadAnchors(ids, companyId);

    return notes.filter(note => {
        const id = parseAnchor(note.documentId);
        if (id === null) return true;
        const doc = anchors.get(id);
        return doc ? scopeAllows(scope, doc) : true;
    });
}
