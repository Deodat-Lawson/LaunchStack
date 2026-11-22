/**
 * The flowchart's keys, answered before the editor's own (`useKeyboard`) and
 * the label field's (`TextEditorOverlay`).
 *
 * | Key                   | While typing a label          | One step selected                  | Several selected  | Empty board       |
 * | --------------------- | ----------------------------- | ---------------------------------- | ----------------- | ----------------- |
 * | Tab                   | Finish, add the next step     | Add the next step below            | —                 | —                 |
 * | ⇧Tab                  | Finish, add a branch beside   | Add a branch beside                | —                 | —                 |
 * | Enter                 | Finish                        | Open its label (the editor's own)  | —                 | Start it empty    |
 * | Esc                   | Finish; an empty step goes    | Clear the selection (the editor's) | Clear it          | —                 |
 * | ↑ ↓ ← →               | —                             | Walk the chart                     | Nudge 1px         | —                 |
 * | ⌥ / ⇧ + arrows        | —                             | Nudge 1px / 10px                   | Nudge 1px / 10px  | —                 |
 * | Delete / Backspace    | —                             | Remove it, join the line around it | Delete them       | —                 |
 * | Any character         | —                             | —                                  | —                 | Start the chart   |
 *
 * A label ending in "?" makes its box a decision when it is finished
 * (`flowchartLook.afterText`, in `commitNodeText`), so no key is needed for
 * that; its next two steps' arrows say Yes and No (`addNextStep`).
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { activePage, nodeById } from "../../model/doc";
import { isStepNode } from "../../model/flowchart/steps";
import type { Walk } from "../../model/flowchart/arrange";
import type { EditorStore } from "../../model/store";
import { addBranch, addNext, discardEmpty, nudge, removeStep, startChart, walk } from "./actions";

const WALKS: Readonly<Record<string, Walk>> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
};

/** A key that types a character: one code point, no ⌘/Ctrl/⌥ held. */
function isPrintable(e: KeyboardEvent): boolean {
    return Array.from(e.key).length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
}

/**
 * A key on the canvas while no label is open. Returns true when handled (and
 * default-prevents it where the browser would act on it).
 */
export function onFlowKeyDown(e: KeyboardEvent, store: EditorStore): boolean {
    const state = store.getState();
    if (state.presenting || e.metaKey || e.ctrlKey) return false;
    const page = activePage(state.doc);

    if (page.nodes.length === 0) {
        // Type-to-start. Not default-prevented: the label field mounts and
        // takes focus during this keydown, so the browser types the character
        // there; the seed covers a browser that does not. Space stays pan,
        // and ? stays the shortcuts dialog.
        if (isPrintable(e) && e.key !== " " && e.key !== "?") {
            startChart(store, e.key);
            return true;
        }
        // An input method composes in a field, never on the page: its first
        // key ("Process") — or Enter — opens an empty first box for the words
        // to go into.
        if (e.key === "Enter" || e.key === "Process") {
            if (e.key === "Enter") e.preventDefault();
            startChart(store);
            return true;
        }
        return false;
    }

    const { selection } = state;
    const nodes = selection.filter(s => s.kind === "node");
    /** The one box selected (connectors beside it allowed). */
    const single = nodes.length === 1 ? nodeById(page, nodes[0]!.id) : undefined;
    /** The one box selected, and nothing else. */
    const only = selection.length === 1 ? single : undefined;

    if (e.key === "Tab") {
        e.preventDefault();
        // With several boxes selected there is no one box to follow.
        if (!single) return nodes.length > 0;
        if (e.shiftKey) addBranch(store, single.id);
        else addNext(store, single.id);
        return true;
    }

    const dir = WALKS[e.key];
    if (dir) {
        e.preventDefault();
        if (nodes.length > 0 && (!only || e.altKey || e.shiftKey)) {
            // A selection of several things moves together; one box moves
            // with ⌥ (1px) or ⇧ (10px). Plain arrows on one box walk.
            nudge(store, dir, e.shiftKey);
            return true;
        }
        // A connector selected on its own: nothing to walk from or move.
        if (selection.length > 0 && !only) return true;
        if (e.altKey || e.shiftKey) return true;
        walk(store, dir);
        return true;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && only && !only.locked && !e.altKey) {
        e.preventDefault();
        removeStep(store, only.id);
        return true;
    }
    return false;
}

/**
 * A key inside an open box label, before the field's own handling. `commit`
 * lands the words and closes the field. Returns true when handled.
 */
export function onFlowFieldKeyDown(
    e: ReactKeyboardEvent<HTMLTextAreaElement>,
    ctx: { store: EditorStore; nodeId: string; commit: () => void }
): boolean {
    const { store, nodeId, commit } = ctx;
    if (e.key === "Tab") {
        e.preventDefault();
        commit();
        if (e.shiftKey) addBranch(store, nodeId);
        else addNext(store, nodeId);
        return true;
    }
    const node = nodeById(activePage(store.getState().doc), nodeId);
    // Text marks and notes keep the editor's own Enter and Esc.
    if (!node || !isStepNode(node)) return false;
    if (e.key === "Escape") {
        e.preventDefault();
        if (e.currentTarget.value.trim() === "" && node.text.trim() === "") {
            discardEmpty(store, nodeId, commit);
        } else {
            commit();
            store.selectNodes([nodeId]);
        }
        return true;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        commit();
        store.selectNodes([nodeId]);
        return true;
    }
    return false;
}
