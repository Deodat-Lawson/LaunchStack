/**
 * The React half of every flowchart direction, and how the editor finds the
 * one in force. See `types.ts`.
 */

import { worksAsFlow } from "../model/doc";
import type { EditorState, EditorStore } from "../model/store";
import { useEditor } from "../ui/EditorContext";
import { uiA } from "./a-keyboard/ui";
import { uiB } from "./b-quick-add/ui";
import { uiC } from "./c-drop-pick/ui";
import { uiD } from "./d-write/ui";
import type { FlowVariantId, FlowVariantUi } from "./types";

export const FLOW_VARIANT_UI: Readonly<Record<FlowVariantId, FlowVariantUi>> = {
    a: uiA,
    b: uiB,
    c: uiC,
    d: uiD,
};

function uiFor(state: EditorState): FlowVariantUi | null {
    if (!state.flowVariant || !worksAsFlow(state.doc.settings.kind)) return null;
    return FLOW_VARIANT_UI[state.flowVariant];
}

/** The direction's UI in force right now, for event handlers. */
export function flowVariantUi(store: EditorStore): FlowVariantUi | null {
    return uiFor(store.getState());
}

const selectVariant = (s: EditorState) =>
    s.flowVariant && worksAsFlow(s.doc.settings.kind) ? s.flowVariant : null;

/** The direction's UI in force, for rendering. Re-renders when it changes. */
export function useFlowVariantUi(): FlowVariantUi | null {
    const id = useEditor(selectVariant);
    return id ? FLOW_VARIANT_UI[id] : null;
}
