/**
 * What direction B's arrows and its shape picker do to the document. Each is
 * one undo step: the box, its arrow and nothing else.
 */

import { docMode } from "../../model/commands";
import { activePage, addEdges, addNodes, nodeById } from "../../model/doc";
import { createEdge, createNodeAt } from "../../model/factory";
import { shapeDef } from "../../model/shapes";
import type { EditorStore } from "../../model/store";
import type { DiagramNode, ShapeId } from "../../model/types";
import { activeFlowLook, dressBox, edgeOptions } from "../looks";
import {
    copySize,
    offersArrows,
    placeAtDrop,
    placeBeside,
    shapeSize,
    type Side,
} from "./placement";
import type { PendingPick } from "./state";

/** The shapes the picker offers, in its order. */
export type PickerShape = "process" | "decision" | "terminator" | "data" | "document" | "database";
export const PICKER_SHAPES: readonly PickerShape[] = [
    "process",
    "decision",
    "terminator",
    "data",
    "document",
    "database",
];

/** How near (screen px) a drop must be to the source's centre line to sit on it. */
export const DROP_ALIGN = 12;

/**
 * A click on a + arrow: a copy of the box — same shape, size and colours,
 * no words — one gap out on that side (or fanned out beside whatever is
 * already there), joined by an arrow leaving from that side, label open.
 * Returns the new box's id.
 */
export function quickAdd(store: EditorStore, sourceId: string, side: Side): string | null {
    const state = store.getState();
    const page = activePage(state.doc);
    const source = nodeById(page, sourceId);
    if (!source || !offersArrows(source)) return null;

    const mode = docMode(store);
    const look = activeFlowLook(state);
    const base = look?.boxLook(source.shape, mode).size ?? shapeSize(source.shape);
    const size = copySize(source, base);
    const made = createNodeAt(source.shape, placeBeside(page, source, side, size), {
        mode,
        w: size.w,
        h: size.h,
    });
    const node: DiagramNode = {
        ...made,
        style: { ...source.style },
        textStyle: { ...source.textStyle },
        parentId: source.parentId,
    };
    const edge = createEdge({
        // The side that was clicked is the side the arrow leaves by: the new
        // box is always beyond it, so pinning it can never send the line back
        // through its own box.
        from: { nodeId: sourceId, port: side },
        to: { nodeId: node.id, port: "auto" },
        kind: state.doc.settings.defaultEdgeKind,
        ...(look ? edgeOptions(look, mode) : {}),
    });

    store.updatePage(p => addEdges(addNodes(p, [node]), [edge]), { label: "Add step" });
    // The pointer is still over the arrow just clicked, which hovers the old
    // box; the new one — selected — is the one whose arrows should show.
    store.setHover(null);
    store.selectNodes([node.id]);
    store.setEditing({ kind: "node", id: node.id });
    return node.id;
}

/**
 * A shape picked for an arrow let go over empty space: that shape, in the
 * direction's look, centred where the arrow ended (on the source's centre
 * line if it was let go just off it), joined from the source, label open.
 */
export function addPicked(store: EditorStore, pick: PendingPick, shape: ShapeId): string {
    const state = store.getState();
    const page = activePage(state.doc);
    const source = nodeById(page, pick.sourceId);
    const mode = docMode(store);
    const look = activeFlowLook(state);
    const at = placeAtDrop(source, pick.world, DROP_ALIGN / state.viewport.zoom);
    const made = createNodeAt(shape, at, { mode });
    const node = look ? dressBox(look, made, mode) : made;
    const edges = source
        ? [
              createEdge({
                  from: { nodeId: source.id, port: "auto" },
                  to: { nodeId: node.id, port: "auto" },
                  kind: state.doc.settings.defaultEdgeKind,
                  ...(look ? edgeOptions(look, mode) : {}),
              }),
          ]
        : [];

    store.updatePage(p => addEdges(addNodes(p, [node]), edges), {
        label: `Add ${shapeDef(shape).name}`,
    });
    store.selectNodes([node.id]);
    store.setEditing({ kind: "node", id: node.id });
    return node.id;
}
