"use client";

import React from "react";
import { ClipboardPaste } from "lucide-react";

import { insertShape, styleTextSelection } from "../model/commands";
import { activePage } from "../model/doc";
import { screenToWorld } from "../model/geometry";
import type { EditorState } from "../model/store";
import { useCommittedDoc, useEditor, useStore } from "./EditorContext";

/**
 * What a blank canvas says.
 *
 * Nothing, today. This puts a ghost topic where the first one will go, and
 * the three keys that grow it, so the first question — "where do I type?" —
 * is answered on the canvas instead of in a side panel. Focus depth only, and
 * only while the page has no shapes; the first node removes it.
 */

/** The shape a mindmap's centre is drawn with. */
const CENTRAL_SHAPE = "mind-root";

const selectDepth = (s: EditorState) => s.chromeDepth;
const selectPresenting = (s: EditorState) => s.presenting;
const selectViewport = (s: EditorState) => s.viewport;

export function EmptyCanvasHint({
    canvasSize,
    onPasteOutline,
}: {
    canvasSize: { w: number; h: number };
    onPasteOutline: () => void;
}) {
    const store = useStore();
    const doc = useCommittedDoc();
    const depth = useEditor(selectDepth);
    const presenting = useEditor(selectPresenting);
    const viewport = useEditor(selectViewport);

    if (depth !== "focus" || presenting) return null;
    if (activePage(doc).nodes.length > 0) return null;

    const start = () => {
        const at = screenToWorld(viewport, { x: canvasSize.w / 2, y: canvasSize.h / 2 });
        const id = insertShape(store, CENTRAL_SHAPE, at, { w: 210, h: 78 });
        styleTextSelection(store, { size: 18, bold: true, align: "center" }, "Central topic");
        store.setEditing({ kind: "node", id });
    };

    return (
        <div
            data-export="omit"
            className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-5"
        >
            <button
                type="button"
                onClick={start}
                className="border-brand/40 text-brand-ink hover:border-brand hover:bg-brand-soft pointer-events-auto rounded-xl border-2 border-dashed px-8 py-4 text-lg font-semibold transition-colors"
            >
                Type your idea
            </button>

            <p className="text-ink-3 flex items-center gap-3 text-[12.5px]">
                <span>
                    <Key>Enter</Key> sibling
                </span>
                <span className="text-line">·</span>
                <span>
                    <Key>Tab</Key> child
                </span>
                <span className="text-line">·</span>
                <span>
                    <Key>⌘K</Key> everything else
                </span>
            </p>

            <button
                type="button"
                onClick={onPasteOutline}
                className="text-ink-2 hover:text-brand-ink pointer-events-auto flex items-center gap-1.5 text-[12.5px] underline-offset-4 hover:underline"
            >
                <ClipboardPaste className="size-3.5" />
                Paste an outline instead
            </button>
        </div>
    );
}

function Key({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="border-line bg-panel text-ink-2 rounded border px-1.5 py-0.5 font-mono text-[11px]">
            {children}
        </kbd>
    );
}
