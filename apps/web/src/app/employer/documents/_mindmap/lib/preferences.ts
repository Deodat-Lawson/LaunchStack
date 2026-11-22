import type { ChromeDepth } from "../model/store";
import type { DiagramKind } from "../model/types";

/**
 * Per-person editor preferences. Browser-local on purpose: how much chrome
 * someone likes is theirs, not the document's, and it should not follow the
 * file to whoever it is shared with.
 *
 * Every read tolerates a missing or blocked `localStorage` — private windows
 * and some embedded contexts throw on access, and the editor must open anyway.
 */

const DEPTH_KEY = "mindmap:chrome-depth";

/**
 * What a document of this kind opens with when the person has never chosen.
 * A flowchart opens in Focus too: its keys, the "What goes here?" menu, the
 * Steps panel and the toolbar on the selection are the whole of drawing one,
 * and the shape library is a click away.
 */
export function defaultChromeDepth(kind: DiagramKind): ChromeDepth {
    return kind === "freeform" ? "everything" : "focus";
}

export function readChromeDepth(kind: DiagramKind): ChromeDepth | null {
    try {
        const raw = window.localStorage.getItem(`${DEPTH_KEY}:${kind}`);
        return raw === "focus" || raw === "everything" ? raw : null;
    } catch {
        return null;
    }
}

export function writeChromeDepth(kind: DiagramKind, depth: ChromeDepth): void {
    try {
        window.localStorage.setItem(`${DEPTH_KEY}:${kind}`, depth);
    } catch {
        // Nothing to do: the choice simply will not be remembered.
    }
}

const STEPS_KEY = "mindmap:steps-panel";

/**
 * Whether a flowchart's Steps panel opens beside the canvas: the person's
 * last choice, else open — writing the steps is one of the three ways to
 * start a chart, and the panel is where an agent's chart reads as text.
 */
export function readStepsPanel(): boolean {
    try {
        const raw = window.localStorage.getItem(STEPS_KEY);
        return raw === null ? true : raw === "open";
    } catch {
        return true;
    }
}

export function writeStepsPanel(open: boolean): void {
    try {
        window.localStorage.setItem(STEPS_KEY, open ? "open" : "closed");
    } catch {
        // Nothing to do: the choice simply will not be remembered.
    }
}
