import { activePage, nodeById } from "../../model/doc";
import type { FlowVariantUi } from "../types";
import {
    addBranch,
    addNext,
    discardEmpty,
    finishLabel,
    removeStep,
    startChart,
    walk,
} from "./actions";
import type { Walk } from "../../model/flowchart/arrange";
import { EmptyHint } from "./EmptyHint";
import { KeyLegend } from "./KeyLegend";

/**
 * The gestures and surfaces of direction A. See `../types.ts`.
 *
 * | Key                   | While typing a label          | With a step selected                  | On an empty board   |
 * | --------------------- | ----------------------------- | ------------------------------------- | ------------------- |
 * | Tab                   | Finish, add the next step     | Add the next step below               | —                   |
 * | ⇧Tab                  | Finish, add a branch beside   | Add a branch beside (Tab on a start)  | —                   |
 * | Enter                 | Finish                        | Open its label (the editor's own)     | —                   |
 * | Esc                   | Finish; an empty step goes    | Clear the selection (the editor's)    | —                   |
 * | ↑ ↓ ← →               | —                             | Walk the chart (⌥ nudges)             | —                   |
 * | Delete / Backspace    | —                             | Remove it, join the line around it    | —                   |
 * | Any character         | —                             | —                                     | Start the chart     |
 * | Enter (or an IME key) | —                             | —                                     | Start it empty      |
 *
 * Every add and remove lays the chart out top to bottom; finishing a label
 * does too, when the words grew the box or made it a decision.
 */

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

export const uiA: FlowVariantUi = {
    onKeyDown(e, store) {
        const state = store.getState();
        if (state.presenting || e.metaKey || e.ctrlKey) return false;
        const page = activePage(state.doc);

        if (page.nodes.length === 0) {
            // Type-to-start. Not default-prevented: the label field mounts and
            // takes focus during this keydown, so the browser types the
            // character there; the seed covers a browser that does not.
            // Space stays pan, and ? stays the shortcuts dialog.
            if (isPrintable(e) && e.key !== " " && e.key !== "?") {
                startChart(store, e.key);
                return true;
            }
            // An input method composes in a field, never on the page: its
            // first key ("Process") — or Enter — opens an empty first box
            // for the words to go into.
            if (e.key === "Enter" || e.key === "Process") {
                if (e.key === "Enter") e.preventDefault();
                startChart(store);
                return true;
            }
            return false;
        }

        const { selection } = state;
        const only =
            selection.length === 1 && selection[0]!.kind === "node"
                ? nodeById(page, selection[0]!.id)
                : undefined;

        if (e.key === "Tab") {
            if (!only) return false;
            e.preventDefault();
            if (e.shiftKey) addBranch(store, only.id);
            else addNext(store, only.id);
            return true;
        }

        const dir = WALKS[e.key];
        if (dir && !e.altKey && !e.shiftKey) {
            // ⌥ and ⇧ arrows are the editor's nudges; a multi-selection or a
            // connector keeps them too.
            if (!only && selection.length > 0) return false;
            e.preventDefault();
            walk(store, dir);
            return true;
        }

        if ((e.key === "Delete" || e.key === "Backspace") && only && !only.locked && !e.altKey) {
            e.preventDefault();
            removeStep(store, only.id);
            return true;
        }
        return false;
    },

    onFieldKeyDown(e, { store, nodeId, commit }) {
        if (e.key === "Tab") {
            e.preventDefault();
            finishLabel(store, nodeId, commit);
            if (e.shiftKey) addBranch(store, nodeId);
            else addNext(store, nodeId);
            return true;
        }
        const node = nodeById(activePage(store.getState().doc), nodeId);
        // Text marks and notes keep the editor's own Enter and Esc.
        if (!node || (node.shape !== "process" && node.shape !== "decision")) return false;
        if (e.key === "Escape") {
            e.preventDefault();
            if (e.currentTarget.value.trim() === "" && node.text.trim() === "") {
                discardEmpty(store, nodeId, commit);
            } else {
                finishLabel(store, nodeId, commit);
                store.selectNodes([nodeId]);
            }
            return true;
        }
        if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            finishLabel(store, nodeId, commit);
            store.selectNodes([nodeId]);
            return true;
        }
        return false;
    },

    StageOverlay: KeyLegend,
    EmptyHint,
};
