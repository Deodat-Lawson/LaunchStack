/**
 * What direction A's key handlers need from React: the stage's size (to put
 * the first box in the middle and keep new ones in view) and the words a
 * decision's branches are labelled with, in the reader's language. The key
 * hooks are plain functions handed only the store, so the stage overlay —
 * mounted whenever the direction is on — publishes these here, per editor.
 */

import type { EditorStore } from "../../model/store";
import type { BranchWords } from "./chart";

export interface KeyboardFlowEnv {
    stage: { w: number; h: number };
    words: BranchWords;
}

const envs = new WeakMap<EditorStore, KeyboardFlowEnv>();

/**
 * Before any overlay has mounted (a test, say): a typical stage, and no words
 * — a branch is left unlabelled rather than labelled in a language nobody
 * chose.
 */
const FALLBACK: KeyboardFlowEnv = {
    stage: { w: 1200, h: 800 },
    words: { yes: "", no: "" },
};

export function setFlowEnv(store: EditorStore, env: KeyboardFlowEnv): void {
    envs.set(store, env);
}

export function flowEnv(store: EditorStore): KeyboardFlowEnv {
    return envs.get(store) ?? FALLBACK;
}
