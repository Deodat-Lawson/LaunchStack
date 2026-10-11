import type { EditorStore } from "./store";
import { paintTopics } from "./theme";

/**
 * Re-apply topic styling after a topic changes depth or branch — dragged out
 * of a port, outdented, lifted by a delete. Colour and the depth's type size
 * both follow the new place. See `paintTopics`.
 *
 * Transient on purpose: it is the second half of whatever structural edit
 * just happened, and undo should take both back in one step rather than
 * first un-colouring a topic and then removing it.
 */
export function restyleMovedTopics(store: EditorStore, ids: string[]): void {
    if (ids.length === 0) return;
    const paletteId = store.getState().doc.settings.paletteId;
    store.updatePage(page => paintTopics(page, ids, paletteId, { retype: true }), {
        transient: true,
    });
}
