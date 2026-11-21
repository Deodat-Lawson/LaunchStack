import type { FlowVariantUi } from "../types";
import { StepsEmptyHint } from "./StepsEmptyHint";
import { StepsPanel } from "./StepsPanel";

/**
 * The gestures and surfaces of direction D (see `../types.ts`): the Steps
 * panel docked left of the canvas, and an empty board that points at it.
 *
 * The canvas keeps the editor's own gestures — double-click a box to rename
 * it, Tab to add the next step, Delete — and the panel writes each one into
 * the lines (`sync.ts`), so no key needs taking over here.
 */
export const uiD: FlowVariantUi = {
    SidePanel: StepsPanel,
    EmptyHint: StepsEmptyHint,
};
