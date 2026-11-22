/**
 * The flowchart editor: everything a document worked as a flowchart
 * (`worksAsFlow`) does that a mindmap or a freeform drawing does not.
 *
 * | Folder    | What it is                                                                 |
 * | --------- | -------------------------------------------------------------------------- |
 * | `keys/`   | Type to start, Tab / ⇧Tab, arrows walk or nudge, Delete joins; the legend   |
 * | `pick/`   | The "What goes here?" menu: an arrow let go in space, a double-click       |
 * | `steps/`  | The Steps panel: the chart as lines, two-way                               |
 *
 * The look every new box and arrow gets, and the arrangement, are pure and
 * live in `model/flowchart/` (the server uses them too). This folder is the
 * UI, and the editor reaches it through one object, `flowUi`, at a handful of
 * hook points: the window's keys (`useKeyboard`), a label's keys
 * (`TextEditorOverlay`), a double-click on empty canvas and an arrow let go
 * in space (`useCanvasInteractions`), plus the components below. Every hook
 * is skipped on a mindmap or a freeform drawing, which stay as they were.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { worksAsFlow } from "../model/doc";
import type { EditorState, EditorStore } from "../model/store";
import { useEditor } from "../ui/EditorContext";
import { onFlowFieldKeyDown, onFlowKeyDown } from "./keys/keys";
import { openAt, openFromDrop } from "./pick/menu";
import type { CanvasPoint, ConnectDrop } from "./types";

export interface FlowUi {
    /**
     * A key on the canvas while no label is open, before the editor's own
     * handling. True when handled.
     */
    onKeyDown(e: KeyboardEvent, store: EditorStore): boolean;
    /**
     * A key inside an open box label, before the field's own handling.
     * `commit` lands the words and closes the field. True when handled.
     */
    onFieldKeyDown(
        e: ReactKeyboardEvent<HTMLTextAreaElement>,
        ctx: { store: EditorStore; nodeId: string; commit: () => void }
    ): boolean;
    /** A double-click on empty canvas. True when handled. */
    onCanvasDoubleClick(store: EditorStore, at: CanvasPoint): boolean;
    /**
     * An arrow dragged out of a box and let go over empty space. The drag has
     * already been cancelled; true when handled.
     */
    onConnectDropInSpace(store: EditorStore, drop: ConnectDrop): boolean;
}

export const flowUi: FlowUi = {
    onKeyDown: onFlowKeyDown,
    onFieldKeyDown: onFlowFieldKeyDown,
    onCanvasDoubleClick: openAt,
    onConnectDropInSpace: openFromDrop,
};

/** The flowchart UI when the open document is worked as a flowchart, for event handlers. */
export function flowUiFor(store: EditorStore): FlowUi | null {
    return worksAsFlow(store.getState().doc.settings.kind) ? flowUi : null;
}

const selectFlow = (s: EditorState) => worksAsFlow(s.doc.settings.kind);

/** Whether the open document is worked as a flowchart, for rendering. */
export function useWorksAsFlow(): boolean {
    return useEditor(selectFlow);
}

export { EmptyFlowHint } from "./EmptyFlowHint";
export { FlowOverlay } from "./FlowOverlay";
export { GhostLayer } from "./pick/GhostLayer";
export { StepsPanel, setStepsPanelOpen } from "./steps/StepsPanel";
export type { CanvasPoint, ConnectDrop } from "./types";
