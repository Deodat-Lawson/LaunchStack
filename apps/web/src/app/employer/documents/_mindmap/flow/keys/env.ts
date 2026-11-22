/**
 * What the flowchart's key handlers need from React: the stage's size, to
 * keep new steps in view, and where the empty prompt drew the first step's
 * ghost, so type-to-start puts the box exactly there. The handlers are plain
 * functions handed only the store, so the components that know — the stage
 * overlay (`FlowOverlay`) and the empty prompt (`EmptyFlowHint`) — publish it
 * here, per editor.
 */

import type { EditorStore } from "../../model/store";
import type { Point } from "../../model/types";

export interface FlowStage {
    w: number;
    h: number;
}

const stages = new WeakMap<EditorStore, FlowStage>();
const firsts = new WeakMap<EditorStore, Point>();

/** Before the overlay has mounted (a test, say): a typical stage. */
const FALLBACK: FlowStage = { w: 1200, h: 800 };

export function setFlowStage(store: EditorStore, stage: FlowStage): void {
    stages.set(store, stage);
}

export function flowStage(store: EditorStore): FlowStage {
    return stages.get(store) ?? FALLBACK;
}

/** Where the first step goes, in px from the canvas's top-left; null clears it. */
export function setFirstStepAt(store: EditorStore, at: Point | null): void {
    if (at) firsts.set(store, at);
    else firsts.delete(store);
}

/** Where the first step goes: the empty prompt's ghost, else the stage's middle. */
export function firstStepAt(store: EditorStore): Point {
    const stage = flowStage(store);
    return firsts.get(store) ?? { x: stage.w / 2, y: stage.h / 2 };
}
