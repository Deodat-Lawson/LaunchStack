/**
 * Which open file editors hold edits that are not saved yet, by document id.
 *
 * The editor's own Done asks before throwing work away; closing its tab (the
 * tab's ×, Close others, the close-pane shortcut) or leaving through the
 * viewer (a version in the rail) happens outside it, where the editor's
 * state is not visible. Each editor records itself here under a token of its
 * own — the same file can be open in two panes, and one of them closing must
 * not clear the other's flag — and the shell and viewer read it at the moment
 * something is about to take the editor away.
 */
const unsaved = new Map<number, Set<symbol>>();

export function setUnsavedEdits(documentId: number, editor: symbol, hasUnsaved: boolean): void {
    const editors = unsaved.get(documentId) ?? new Set<symbol>();
    if (hasUnsaved) editors.add(editor);
    else editors.delete(editor);
    if (editors.size) unsaved.set(documentId, editors);
    else unsaved.delete(documentId);
}

export function hasUnsavedEdits(documentId: number | null | undefined): boolean {
    return documentId != null && (unsaved.get(documentId)?.size ?? 0) > 0;
}
