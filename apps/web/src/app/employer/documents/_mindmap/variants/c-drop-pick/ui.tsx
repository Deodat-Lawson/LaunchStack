import type { FlowVariantUi } from "../types";
import { EmptyHint } from "./EmptyHint";
import { GhostLayer } from "./GhostLayer";
import { openAt, openFromDrop } from "./menu";
import { PickMenuOverlay } from "./PickMenuOverlay";

/**
 * The gestures and surfaces of direction C. See `../types.ts`.
 *
 * - An arrow pulled out of a box and let go in space opens the pick menu
 *   there (`openFromDrop`), aligned with the box's centre line when close.
 * - A double-click on empty canvas opens it too, without "Just the arrow".
 * - The menu is laid over the stage; the preview of the pick is drawn on the
 *   board; the empty page has its own invitation.
 */
export const uiC: FlowVariantUi = {
    onConnectDropInSpace: (store, drop) => openFromDrop(store, drop),
    onCanvasDoubleClick: (store, at) => openAt(store, at),
    StageOverlay: PickMenuOverlay,
    CanvasLayer: GhostLayer,
    EmptyHint,
};
