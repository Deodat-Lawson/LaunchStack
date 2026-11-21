/**
 * The pure half of every flowchart direction, and the helpers the model uses
 * to dress a new box or arrow in it. No React here: `model/commands.ts`
 * imports this file. See `types.ts`.
 */

import { worksAsFlow } from "../model/doc";
import type { CreateEdgeOptions } from "../model/factory";
import { themeMode, type ThemeMode } from "../model/palette";
import type { DiagramNode, MindmapDoc } from "../model/types";
import { lookA } from "./a-keyboard/look";
import { lookB } from "./b-quick-add/look";
import { lookC } from "./c-drop-pick/look";
import { lookD } from "./d-write/look";
import type { FlowLook, FlowVariantId } from "./types";

export const FLOW_LOOKS: Readonly<Record<FlowVariantId, FlowLook>> = {
    a: lookA,
    b: lookB,
    c: lookC,
    d: lookD,
};

/**
 * The look in force: a direction is chosen and the document is worked as a
 * flowchart. Null otherwise — every caller then does exactly what it did
 * before directions existed.
 */
export function activeFlowLook(state: {
    doc: MindmapDoc;
    flowVariant: FlowVariantId | null;
}): FlowLook | null {
    if (!state.flowVariant || !worksAsFlow(state.doc.settings.kind)) return null;
    return FLOW_LOOKS[state.flowVariant];
}

/** The board's lighting, for picking a look's colours. */
export function boardMode(doc: MindmapDoc): ThemeMode {
    return themeMode(doc.settings.paletteId);
}

/**
 * A new box in the direction's look: its colours and type, and its starting
 * size about the same centre unless the caller chose the size (a box drawn
 * by dragging out a rectangle keeps the rectangle).
 */
export function dressBox(
    look: FlowLook,
    node: DiagramNode,
    mode: ThemeMode,
    opts: { keepSize?: boolean } = {}
): DiagramNode {
    const box = look.boxLook(node.shape, mode);
    const size = !opts.keepSize && box.size ? box.size : { w: node.w, h: node.h };
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    return {
        ...node,
        x: cx - size.w / 2,
        y: cy - size.h / 2,
        w: size.w,
        h: size.h,
        style: { ...node.style, ...box.style },
        textStyle: { ...node.textStyle, ...box.text },
    };
}

/** The look's arrow, as `createEdge` options. */
export function edgeOptions(
    look: FlowLook,
    mode: ThemeMode
): Pick<CreateEdgeOptions, "kind" | "style" | "startArrow" | "endArrow"> {
    const e = look.edgeLook(mode);
    return {
        kind: e.kind,
        style: e.style,
        ...(e.startArrow ? { startArrow: e.startArrow } : {}),
        ...(e.endArrow ? { endArrow: e.endArrow } : {}),
    };
}
