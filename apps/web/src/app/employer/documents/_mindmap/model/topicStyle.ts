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

/**
 * Paint topics that were just made by a gesture — dragged out of a port,
 * double-clicked onto the canvas, dropped from the palette. As
 * `restyleMovedTopics`, except a new main branch takes the theme's next unused
 * hue instead of keeping the placeholder colour the factory gave it.
 */
export function paintNewTopics(store: EditorStore, ids: string[]): void {
    if (ids.length === 0) return;
    const paletteId = store.getState().doc.settings.paletteId;
    store.updatePage(page => paintTopics(page, ids, paletteId, { retype: true, fresh: true }), {
        transient: true,
    });
}
