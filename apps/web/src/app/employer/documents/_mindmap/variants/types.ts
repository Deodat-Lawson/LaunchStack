/**
 * Flowchart directions: prototypes of how boxes are made and joined on a
 * flowchart, and what a new box looks like, tried side by side so one can be
 * picked and built properly.
 *
 * A direction has two halves, kept apart because `model/` is pure:
 *
 * - a **look** (`FlowLook`, pure TypeScript) — the defaults every new box and
 *   arrow gets, the way the flow runs, and any re-layout after a step is
 *   added. `model/commands.ts` reads it, so Tab, the Topic tool, the palette
 *   and a double-click all make the same box.
 * - a **UI** (`FlowVariantUi`, React) — gestures and surfaces: key handling,
 *   menus over the canvas, a docked panel, marks drawn on the canvas.
 *
 * Nothing here is on in the product. `EditorState.flowVariant` is null unless
 * the editor is mounted with `flowVariant` (only `/dev/mindmap?variant=` does),
 * and every hook below is skipped when it is null or the document is not
 * worked as a flowchart.
 */

import type { ComponentType, KeyboardEvent as ReactKeyboardEvent } from "react";

import type { ThemeMode } from "../model/palette";
import type { ChromeDepth, EditorStore } from "../model/store";
import type {
    ArrowId,
    DiagramNode,
    DiagramPage,
    EdgeKind,
    EdgeStyle,
    NodeStyle,
    Point,
    PortId,
    ShapeId,
    TextStyle,
} from "../model/types";

export type FlowVariantId = "a" | "b" | "c" | "d";

export const FLOW_VARIANT_IDS: readonly FlowVariantId[] = ["a", "b", "c", "d"];

export function isFlowVariantId(value: unknown): value is FlowVariantId {
    return typeof value === "string" && (FLOW_VARIANT_IDS as readonly string[]).includes(value);
}

/** What a new box of one shape looks like under a direction. */
export interface BoxLook {
    style: Partial<NodeStyle>;
    text: Partial<TextStyle>;
    /** Its starting size. Omitted: the shape's own default. */
    size?: { w: number; h: number };
}

export interface EdgeLook {
    kind: EdgeKind;
    style: Partial<EdgeStyle>;
    startArrow?: ArrowId;
    endArrow?: ArrowId;
    /** The type of its labels. Omitted: the editor's default (12px grey). */
    text?: Partial<TextStyle>;
}

/** The pure half of a direction. See the file comment. */
export interface FlowLook {
    id: FlowVariantId;
    /** Chrome the direction opens with (`focus` = Simple, `everything`). */
    chrome: ChromeDepth;
    /** The shape of a first box, a double-clicked box, and a plain step. */
    stepShape: ShapeId;
    /** Which way a step goes when nothing on the page says otherwise. */
    direction: "right" | "down";
    /** Every new box, by every path, is given this. */
    boxLook(shape: ShapeId, mode: ThemeMode): BoxLook;
    /** Every new arrow, by every path, is given this. */
    edgeLook(mode: ThemeMode): EdgeLook;
    /**
     * The shape of the step Tab adds after `source`. Omitted: the same shape
     * (the base behaviour).
     */
    nextShape?(source: DiagramNode): ShapeId;
    /**
     * Re-lay the page after a step is added (`addNextStep`). Pure: given the
     * page with the new box and arrow in, return it arranged. `added` is the
     * new box's id.
     */
    relayout?: (page: DiagramPage, added: string) => DiagramPage;
    /**
     * A box whose label was just committed may change with its words (a label
     * ending in "?" becoming a decision, say). Return the fields to change, or
     * null. Applied in the same undo step as the words.
     */
    afterText?(
        node: DiagramNode,
        text: string
    ): Partial<Pick<DiagramNode, "shape" | "w" | "h">> | null;
}

/** Where a pointer is: on the board, and on the stage (CSS px from its top-left). */
export interface CanvasPoint {
    world: Point;
    screen: Point;
}

export interface ConnectDrop extends CanvasPoint {
    /** The box the arrow was dragged out of. */
    sourceId: string;
    /** The dot (or side) it left by. */
    port: PortId | null;
}

/** The React half of a direction. Every member is optional. */
export interface FlowVariantUi {
    /**
     * A key on the canvas while no label is open, before the editor's own
     * handling. Return true when handled; call `preventDefault` yourself.
     */
    onKeyDown?(e: KeyboardEvent, store: EditorStore): boolean;
    /**
     * A key inside an open box label, before the field's own handling
     * (Enter/Tab/Escape). `commit` lands the words and closes the field.
     * Return true when handled; call `preventDefault` yourself.
     */
    onFieldKeyDown?(
        e: ReactKeyboardEvent<HTMLTextAreaElement>,
        ctx: { store: EditorStore; nodeId: string; commit: () => void }
    ): boolean;
    /** A double-click on empty canvas. Return true when handled. */
    onCanvasDoubleClick?(store: EditorStore, at: CanvasPoint): boolean;
    /**
     * A plain click (no drag) on a box's dot, or on anything carrying
     * `data-node-id` + `data-port` outside the box. Return true when handled.
     */
    onPortClick?(store: EditorStore, nodeId: string, port: PortId | null): boolean;
    /**
     * An arrow dragged out of a box and let go over empty space. The drag has
     * already been cancelled (nothing is on the page); return true when
     * handled, or false to fall back to the editor's dangling arrow.
     */
    onConnectDropInSpace?(store: EditorStore, drop: ConnectDrop): boolean;
    /** World-space SVG in the canvas's chrome layer (omitted from exports). */
    CanvasLayer?: ComponentType;
    /** HTML laid over the canvas stage (screen space), for menus and pickers. */
    StageOverlay?: ComponentType<{ canvasSize: { w: number; h: number } }>;
    /** A panel docked to the left of the canvas. */
    SidePanel?: ComponentType<{ canvasSize: { w: number; h: number } }>;
    /** Replaces the empty-page prompt on a flowchart. */
    EmptyHint?: ComponentType<{ canvasSize: { w: number; h: number } }>;
}
