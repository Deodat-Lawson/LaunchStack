/**
 * Which open file editors hold edits that are not saved yet, by document id.
 *
 * The editor's own Done asks before throwing work away; closing its tab (the
 * tab's ×, Close others, the close-pane shortcut) happens in the shell, which
 * never sees the editor's state. The editor records itself here and the
 * shell reads it at the moment a tab is about to close.
 */
const unsaved = new Set<number>();

export function setUnsavedEdits(documentId: number, hasUnsaved: boolean): void {
    if (hasUnsaved) unsaved.add(documentId);
    else unsaved.delete(documentId);
}

export function hasUnsavedEdits(documentId: number | null | undefined): boolean {
    return documentId != null && unsaved.has(documentId);
}
