import { tabIdOfSource } from "./paneLayout";

/**
 * What can be dragged onto a pane, and how a drop says what it caught.
 *
 * Two things open in panes by being dropped there: a tab from any strip, and
 * a source from the sidebar. Each drag names itself with its own MIME type,
 * so the panes can offer their drop zones while it is still in the air —
 * `dataTransfer.types` is readable during a drag, the data only on drop.
 */

/** A tab being dragged, from this strip or another. The data is its tab id. */
export const STUDIO_TAB_DRAG_MIME = "application/x-studio-tab";

/** A source dragged out of the sidebar. The data is the source's id. */
export const SOURCE_DRAG_MIME = "application/x-workspace-source";

/** Whether a drag in progress is one a pane can take. */
export function isPaneDrag(types: readonly string[]): boolean {
    return types.includes(STUDIO_TAB_DRAG_MIME) || types.includes(SOURCE_DRAG_MIME);
}

/** The tab id a drop would open or move, whichever kind of drag it was. */
export function droppedTabId(data: Pick<DataTransfer, "getData">): string | null {
    const tab = data.getData(STUDIO_TAB_DRAG_MIME);
    if (tab) return tab;
    const source = data.getData(SOURCE_DRAG_MIME);
    return source ? tabIdOfSource(source) : null;
}
