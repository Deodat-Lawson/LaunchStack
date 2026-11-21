import { activePage, nodeById } from "../../model/doc";
import { worldToScreen } from "../../model/geometry";
import type { FlowVariantUi } from "../types";
import { QuickAddLayer } from "./ArrowsLayer";
import { quickAdd } from "./commands";
import { arrowAnchor, isSide } from "./placement";
import { ShapePicker } from "./ShapePicker";
import { quickAddState } from "./state";

/**
 * The gestures and surfaces of direction B. See `../types.ts`.
 *
 * - **Click a + arrow**: a copy of the box one gap out that way, joined.
 * - **Drag a + arrow** (or any dot): the canvas's own connector drag. On a
 *   box it joins them; over empty space the picker asks what goes there.
 *
 * Everything else — Tab, double-click, the palette, the side panels — is
 * today's editor, dressed in this direction's look (`look.ts`).
 */
export const uiB: FlowVariantUi = {
    onPortClick(store, nodeId, port) {
        const qs = quickAddState(store);
        // A plain click on an ordinary dot comes here too, and must only
        // select its box: the base stopped clicks near a box's edge minting
        // boxes nobody asked for. Only a press that began on an arrow adds.
        if (!qs.takeArmed(nodeId, port) || !isSide(port)) return false;
        const source = nodeById(activePage(store.getState().doc), nodeId);
        if (!source) return false;
        const at = arrowAnchor(source, port, store.getState().viewport.zoom);
        if (!quickAdd(store, nodeId, port)) return false;
        qs.forgetNear();
        qs.setGuard({ at, nodeId });
        return true;
    },

    onConnectDropInSpace(store, drop) {
        const qs = quickAddState(store);
        qs.disarm();
        const state = store.getState();
        if (!nodeById(activePage(state.doc), drop.sourceId)) return false;
        const onSvg = worldToScreen(state.viewport, drop.world);
        qs.openPick({
            sourceId: drop.sourceId,
            port: drop.port,
            world: drop.world,
            offset: { x: drop.screen.x - onSvg.x, y: drop.screen.y - onSvg.y },
        });
        return true;
    },

    CanvasLayer: QuickAddLayer,
    StageOverlay: ShapePicker,
};
