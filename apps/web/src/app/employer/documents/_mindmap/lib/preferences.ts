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

/** What a document of this kind opens with when the person has never chosen. */
export function defaultChromeDepth(kind: DiagramKind): ChromeDepth {
    return kind === "mindmap" || kind === "board" ? "focus" : "everything";
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
