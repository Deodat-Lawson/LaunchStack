"use client";

import { useEffect, useRef } from "react";

import {
    addChildTopic,
    addSiblingTopic,
    alignSelection,
    copySelection,
    cutSelection,
    deleteSelection,
    duplicateSelection,
    fitToScreen,
    groupSelection,
    moveSelection,
    reorder,
    selectAll,
    styleTextSelection,
    tidyUp,
    toggleLock,
    ungroupSelection,
    zoomToSelection,
} from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { nextZoomStep } from "../model/geometry";
import type { EditorStore } from "../model/store";
import type { ShapeId, ToolId } from "../model/types";

/**
 * The keyboard map.
 *
 * One listener on `window`, one switch — so every binding is visible in a
 * single place and the shortcuts dialog can be generated from the same table
 * (`SHORTCUTS` below) that documents them.
 *
 * Keystrokes are ignored while focus is inside a field: the canvas must never
 * steal ⌘A from the title input or Delete from a comment box.
 */

export interface KeyboardActions {
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

function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export function useKeyboard(store: EditorStore, actions: KeyboardActions): void {
    const ref = useRef(actions);
    ref.current = actions;

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (isTypingTarget(e.target)) return;
            const state = store.getState();
            if (state.editing) return;

            const mod = e.metaKey || e.ctrlKey;
            const shift = e.shiftKey;
            const key = e.key;
            const lower = key.length === 1 ? key.toLowerCase() : key;

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
                // Presentation mode only listens for movement and exit.
                if (key === "ArrowRight" || key === "ArrowDown" || key === " ") {
                    e.preventDefault();
                }
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
                    case "enter":
                        e.preventDefault();
                        ref.current.onEditSelection();
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
                        store.setViewport({ zoom: 1 });
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
                        store.setViewport({ zoom: nextZoomStep(state.viewport.zoom, 1) });
                        return;
                    case "-":
                        e.preventDefault();
                        store.setViewport({ zoom: nextZoomStep(state.viewport.zoom, -1) });
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
                return;
            }

            // -- plain keys -------------------------------------------------
            if (key === "Delete" || key === "Backspace") {
                e.preventDefault();
                deleteSelection(store);
                return;
            }

            if (key.startsWith("Arrow")) {
                e.preventDefault();
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
                if (firstNode) addChildTopic(store, firstNode.id);
                return;
            }

            if (key === "Enter") {
                e.preventDefault();
                if (!firstNode) return;
                const page = activePage(state.doc);
                if (!nodeById(page, firstNode.id)) return;
                addSiblingTopic(store, firstNode.id);
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
        title: "Editing",
        rows: [
            { keys: "Double-click", label: "Edit text · new topic on empty canvas" },
            { keys: "Tab", label: "Add child topic" },
            { keys: "Enter", label: "Add sibling topic" },
            { keys: "F2 / ⌘Enter", label: "Rename selection" },
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
            { keys: "Arrows", label: "Nudge · Shift for a larger step" },
            { keys: "⇧⌘ + arrow", label: "Align selection" },
        ],
    },
    {
        title: "View",
        rows: [
            { keys: "⌘0", label: "Zoom to 100%" },
            { keys: "⌘1", label: "Fit to screen" },
            { keys: "⌘2", label: "Zoom to selection" },
            { keys: "⌘= / ⌘-", label: "Zoom in / out" },
            { keys: "⌘-scroll", label: "Zoom at the cursor" },
            { keys: "⌘F or /", label: "Find on canvas" },
            { keys: "⌘K", label: "Command palette" },
            { keys: "⌘S", label: "Save now" },
            { keys: "⌘E", label: "Export" },
            { keys: "?", label: "This dialog" },
        ],
    },
];
