"use client";

import { useEffect, useRef } from "react";

import {
    addChildTopic,
    addSiblingTopic,
    alignSelection,
    copySelection,
    cutSelection,
    deleteTopicsOrSelection,
    duplicateSelection,
    fitToScreen,
    groupSelection,
    moveSelection,
    moveTopicAmongSiblings,
    outdentTopic,
    reorder,
    selectAll,
    selectTopicInDirection,
    styleTextSelection,
    tidyUp,
    toggleCollapseSelection,
    toggleLock,
    ungroupSelection,
    setZoom,
    zoomByStep,
    zoomToSelection,
} from "../model/commands";
import { activePage, isTopicShape, nodeById, type NavDirection } from "../model/doc";
import { shapeHoldsText } from "../model/shapes";
import type { EditorStore } from "../model/store";
import type { DiagramNode, ShapeId, ToolId } from "../model/types";
import { focusEditorField } from "./EditorContext";

/**
 * The keyboard map.
 *
 * One listener on `window`, one switch — so every binding is visible in a
 * single place and the shortcuts dialog can be generated from the same table
 * (`SHORTCUTS` below) that documents them.
 *
 * Keystrokes are ignored while focus is inside a field: the canvas must never
 * steal ⌘A from the title input or Delete from a comment box.
 *
 * With a topic selected the keys are an outliner's, the way XMind, MindNode
 * and MindMeister have them: Enter adds the next sibling (the Enter that
 * finished typing was the label field's, and stopped there), Tab a child,
 * ⇧Tab outdents, the arrows walk to the nearest topic that way, ⌘↑/↓ reorder,
 * ⌘/ folds, Delete takes the branch, and typing replaces the label. Other
 * shapes keep a canvas's keys — Enter edits, arrows nudge, Delete removes
 * only what is selected.
 */

export interface KeyboardActions {
    /** A hidden editor keeps its store but must not answer window keys. */
    isActive: () => boolean;
    onSave: () => void;
    onFind: () => void;
    onCommandPalette: () => void;
    onExport: () => void;
    onTogglePresent: () => void;
    onShowShortcuts: () => void;
    /** Start editing the current selection's text. */
    onEditSelection: () => void;
    /** Canvas pixel size, for fit/zoom-to-selection. */
    getViewportSize: () => { w: number; h: number };
}

/** Single-key tool shortcuts, matching the toolbar's order. */
const TOOL_KEYS: Record<string, { tool: ToolId; shape?: ShapeId }> = {
    v: { tool: "select" },
    h: { tool: "hand" },
    c: { tool: "connector" },
    t: { tool: "text" },
    n: { tool: "sticky" },
    f: { tool: "frame" },
    p: { tool: "ink" },
    e: { tool: "eraser" },
    r: { tool: "shape", shape: "rectangle" },
    o: { tool: "shape", shape: "ellipse" },
    d: { tool: "shape", shape: "diamond" },
    s: { tool: "shape", shape: "rounded-rectangle" },
};

const ARROWS: Record<string, NavDirection> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
};

function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** A key that types a character: one code point, no ⌘/Ctrl/⌥ held. */
function isPrintable(e: KeyboardEvent): boolean {
    return Array.from(e.key).length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
}

/** Whether Enter or a typed key may open this shape's label. */
function canEditText(nd: DiagramNode): boolean {
    return !nd.locked && nd.shape !== "group" && shapeHoldsText(nd.shape);
}

export function useKeyboard(store: EditorStore, actions: KeyboardActions): void {
    const ref = useRef(actions);
    ref.current = actions;

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!ref.current.isActive() || e.defaultPrevented) return;
            if (isTypingTarget(e.target)) return;
            const state = store.getState();
            if (state.editing) {
                // A label is open but focus is not in it — the field never
                // got it, or something took it. Rather than let keystrokes
                // vanish: a character moves focus into the field during its
                // own keydown, so the browser types it there; Enter and
                // Escape finish the label, as they would from inside it.
                if (isPrintable(e)) {
                    focusEditorField(store);
                } else if (e.key === "Enter" || e.key === "Escape") {
                    e.preventDefault();
                    store.setEditing(null);
                }
                return;
            }

            const mod = e.metaKey || e.ctrlKey;
            const shift = e.shiftKey;
            const key = e.key;
            const lower = key.length === 1 ? key.toLowerCase() : key;
            const page = activePage(state.doc);
            /** The node selected, when it is the only thing selected. */
            const only =
                state.selection.length === 1 && state.selection[0]!.kind === "node"
                    ? nodeById(page, state.selection[0]!.id)
                    : undefined;
            const topic = only && isTopicShape(only.shape) ? only : undefined;

            // -- always available ------------------------------------------
            if (key === "Escape") {
                if (state.presenting) {
                    ref.current.onTogglePresent();
                } else if (state.tool !== "select") {
                    store.setTool("select");
                } else {
                    store.clearSelection();
                }
                return;
            }

            if (state.presenting) {
                // Presentation mode only listens for movement and exit — and
                // movement belongs to the Presenter and the page stepper, which
                // claim a key (preventDefault) only when they actually move.
                // Claiming it here, unconditionally, is what left → dead in
                // Present: both of them skip a key that is already claimed.
                return;
            }

            // -- modifier combos -------------------------------------------
            if (mod) {
                switch (lower) {
                    case "z":
                        e.preventDefault();
                        if (shift) store.redo();
                        else store.undo();
                        return;
                    case "y":
                        e.preventDefault();
                        store.redo();
                        return;
                    case "c":
                        e.preventDefault();
                        void copySelection(store);
                        return;
                    case "x":
                        e.preventDefault();
                        void cutSelection(store);
                        return;
                    // ⌘V is deliberately absent: `useClipboardPaste` listens for
                    // the native paste event, which arrives with the payload
                    // attached and can see pasted images. Handling it here too
                    // would paste everything twice.
                    case "v":
                        return;
                    case "d":
                        e.preventDefault();
                        duplicateSelection(store);
                        return;
                    case "a":
                        e.preventDefault();
                        selectAll(store);
                        return;
                    case "g":
                        e.preventDefault();
                        if (shift) ungroupSelection(store);
                        else groupSelection(store);
                        return;
                    case "s":
                        e.preventDefault();
                        ref.current.onSave();
                        return;
                    case "f":
                        e.preventDefault();
                        ref.current.onFind();
                        return;
                    case "k":
                        e.preventDefault();
                        ref.current.onCommandPalette();
                        return;
                    case "l":
                        e.preventDefault();
                        if (shift) tidyUp(store, "mindmap");
                        else toggleLock(store);
                        return;
                    case "b":
                        e.preventDefault();
                        toggleTextFlag(store, "bold");
                        return;
                    case "i":
                        e.preventDefault();
                        toggleTextFlag(store, "italic");
                        return;
                    case "u":
                        e.preventDefault();
                        toggleTextFlag(store, "underline");
                        return;
                    case "e":
                        e.preventDefault();
                        ref.current.onExport();
                        return;
                    // `lower` only folds single characters, so this is the
                    // key's own name, not "enter" — which never matched.
                    case "Enter":
                        e.preventDefault();
                        ref.current.onEditSelection();
                        return;
                    // ⌘/ folds, as in XMind (Whimsical has Ctrl+/). Bare /
                    // stays Find.
                    case "/":
                        e.preventDefault();
                        toggleCollapseSelection(store);
                        return;
                    case "]":
                        e.preventDefault();
                        reorder(store, shift ? "front" : "forward");
                        return;
                    case "[":
                        e.preventDefault();
                        reorder(store, shift ? "back" : "backward");
                        return;
                    case "0":
                        e.preventDefault();
                        setZoom(store, 1, ref.current.getViewportSize());
                        return;
                    case "1":
                        e.preventDefault();
                        fitToScreen(store, ref.current.getViewportSize());
                        return;
                    case "2":
                        e.preventDefault();
                        zoomToSelection(store, ref.current.getViewportSize());
                        return;
                    case "=":
                    case "+":
                        e.preventDefault();
                        zoomByStep(store, 1, ref.current.getViewportSize());
                        return;
                    case "-":
                    case "_":
                        e.preventDefault();
                        zoomByStep(store, -1, ref.current.getViewportSize());
                        return;
                    default:
                        break;
                }
                // Alignment: ⌘⇧ + arrow
                if (shift && key.startsWith("Arrow")) {
                    e.preventDefault();
                    const axis =
                        key === "ArrowLeft"
                            ? "left"
                            : key === "ArrowRight"
                              ? "right"
                              : key === "ArrowUp"
                                ? "top"
                                : "bottom";
                    alignSelection(store, axis);
                    return;
                }
                // ⌘↑ / ⌘↓: move a topic among its siblings.
                if (key === "ArrowUp" || key === "ArrowDown") {
                    e.preventDefault();
                    if (topic) moveTopicAmongSiblings(store, topic.id, key === "ArrowUp" ? -1 : 1);
                    return;
                }
                return;
            }

            // -- plain keys -------------------------------------------------
            if (key === "Delete" || key === "Backspace") {
                e.preventDefault();
                deleteTopicsOrSelection(store, { keepChildren: e.altKey });
                return;
            }

            const arrow = ARROWS[key];
            if (arrow) {
                e.preventDefault();
                // A topic's arrows walk the map; ⌥ makes them nudge it instead.
                if (topic && !e.altKey) {
                    selectTopicInDirection(store, topic.id, arrow, ref.current.getViewportSize());
                    return;
                }
                const step = shift ? state.doc.settings.gridSize * 5 : state.doc.settings.gridSize;
                const delta =
                    key === "ArrowLeft"
                        ? { x: -step, y: 0 }
                        : key === "ArrowRight"
                          ? { x: step, y: 0 }
                          : key === "ArrowUp"
                            ? { x: 0, y: -step }
                            : { x: 0, y: step };
                moveSelection(store, delta, "Nudge");
                return;
            }

            const firstNode = state.selection.find(s => s.kind === "node");

            if (key === "Tab") {
                e.preventDefault();
                if (shift) {
                    if (topic) outdentTopic(store, topic.id);
                    return;
                }
                if (firstNode) addChildTopic(store, firstNode.id);
                return;
            }

            if (key === "Enter") {
                e.preventDefault();
                const nd = firstNode ? nodeById(page, firstNode.id) : undefined;
                if (nd && isTopicShape(nd.shape)) {
                    // The label was finished by the Enter before this one;
                    // this one is "next". On the centre that is a child.
                    addSiblingTopic(store, nd.id, shift ? "before" : "after");
                } else if (nd ? canEditText(nd) : !firstNode && state.selection.length > 0) {
                    // Any other shape, or a connector: Enter opens its text,
                    // the FigJam and Lucid convention. Nothing is created.
                    ref.current.onEditSelection();
                }
                return;
            }

            if (key === "F2") {
                e.preventDefault();
                ref.current.onEditSelection();
                return;
            }

            if (key === "?" || (shift && key === "/")) {
                e.preventDefault();
                ref.current.onShowShortcuts();
                return;
            }

            if (key === "/") {
                e.preventDefault();
                ref.current.onFind();
                return;
            }

            // Bare +/- zoom, the way every canvas app does it. Safe here
            // because this whole handler already bailed out for typing
            // targets, so it cannot eat a minus sign someone is writing.
            if (lower === "+" || lower === "=") {
                e.preventDefault();
                zoomByStep(store, 1, ref.current.getViewportSize());
                return;
            }
            if (lower === "-" || lower === "_") {
                e.preventDefault();
                zoomByStep(store, -1, ref.current.getViewportSize());
                return;
            }

            // Typing on a selected topic replaces its label (XMind). Topics
            // only: on a canvas of boxes the letters are tools (R, then click,
            // places a rectangle), and renaming the selected box to "r"
            // instead broke that habit. Not default-prevented: the field
            // mounts and takes focus before the browser delivers the
            // character, and the seed covers the case where it never does —
            // see TextEditorOverlay. Space stays pan.
            if (
                only &&
                key !== " " &&
                isPrintable(e) &&
                isTopicShape(only.shape) &&
                canEditText(only)
            ) {
                store.setEditing({ kind: "node", id: only.id, seed: key });
                return;
            }

            const tool = TOOL_KEYS[lower];
            if (tool) {
                e.preventDefault();
                store.setTool(tool.tool, tool.shape ?? null);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [store]);
}

function toggleTextFlag(store: EditorStore, flag: "bold" | "italic" | "underline"): void {
    const page = activePage(store.getState().doc);
    const ids = store.selectedNodeIds();
    const first = ids.map(id => nodeById(page, id)).find(nd => nd !== undefined);
    const next = !(first?.textStyle[flag] ?? false);
    styleTextSelection(store, { [flag]: next }, `Toggle ${flag}`);
}

// ---------------------------------------------------------------------------
// Documentation table — rendered by the shortcuts dialog
// ---------------------------------------------------------------------------

export interface ShortcutRow {
    keys: string;
    label: string;
}

export interface ShortcutGroup {
    title: string;
    rows: ShortcutRow[];
}

export const SHORTCUTS: readonly ShortcutGroup[] = [
    {
        title: "Tools",
        rows: [
            { keys: "V", label: "Select" },
            { keys: "H / Space", label: "Pan" },
            { keys: "C", label: "Connector" },
            { keys: "T", label: "Text" },
            { keys: "N", label: "Sticky note" },
            { keys: "F", label: "Frame" },
            { keys: "P", label: "Pen" },
            { keys: "E", label: "Eraser" },
            { keys: "R / O / D / S", label: "Rectangle / ellipse / diamond / rounded" },
        ],
    },
    {
        title: "Topics",
        rows: [
            { keys: "Enter", label: "Finish typing · again for the next topic" },
            { keys: "⇧Enter", label: "New topic before this one" },
            { keys: "Tab", label: "Add child topic" },
            { keys: "⇧Tab", label: "Outdent topic" },
            { keys: "Arrows", label: "Go to the nearest topic that way" },
            { keys: "⌘↑ / ⌘↓", label: "Move topic up / down" },
            { keys: "⌘/", label: "Collapse / expand branch" },
            { keys: "Delete", label: "Delete topic and its branch" },
            { keys: "⌥Delete", label: "Delete topic, keep its children" },
        ],
    },
    {
        title: "Editing",
        rows: [
            { keys: "Double-click", label: "Edit text · new topic on empty canvas" },
            { keys: "Type", label: "Replace the selected shape's text" },
            { keys: "Enter / F2 / ⌘Enter", label: "Edit the selected shape's text" },
            { keys: "⇧Enter / ⌥Enter", label: "New line while typing" },
            { keys: "Esc", label: "Finish typing" },
            { keys: "⌘C / ⌘X / ⌘V", label: "Copy / cut / paste" },
            { keys: "⌘D", label: "Duplicate" },
            { keys: "Delete", label: "Delete selection" },
            { keys: "⌘Z / ⇧⌘Z", label: "Undo / redo" },
            { keys: "⌘B / ⌘I / ⌘U", label: "Bold / italic / underline" },
        ],
    },
    {
        title: "Arrange",
        rows: [
            { keys: "⌘G / ⇧⌘G", label: "Group / ungroup" },
            { keys: "⌘] / ⌘[", label: "Bring forward / send backward" },
            { keys: "⇧⌘] / ⇧⌘[", label: "Bring to front / send to back" },
            { keys: "⌘L", label: "Lock / unlock" },
            { keys: "⇧⌘L", label: "Tidy up (auto-layout)" },
            { keys: "Arrows", label: "Nudge · ⇧ for a larger step" },
            { keys: "⌥ + arrow", label: "Nudge a topic" },
            { keys: "⇧⌘ + arrow", label: "Align selection" },
        ],
    },
    {
        title: "View",
        rows: [
            { keys: "⌘0", label: "Zoom to 100%" },
            { keys: "⌘1", label: "Fit to screen" },
            { keys: "⌘2", label: "Zoom to selection" },
            { keys: "+ / −", label: "Zoom in / out" },
            { keys: "⌘= / ⌘-", label: "Zoom in / out" },
            { keys: "⌘-scroll", label: "Zoom at the cursor" },
            { keys: "Scroll", label: "Pan · ⇧ for sideways" },
            { keys: "⌘F or /", label: "Find on canvas" },
            { keys: "⌘K", label: "Command palette" },
            { keys: "⌘S", label: "Save now" },
            { keys: "⌘E", label: "Export" },
            { keys: "?", label: "This dialog" },
        ],
    },
];
