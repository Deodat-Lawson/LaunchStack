"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

import { TooltipProvider } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { fitToScreen, setActivePage, zoomByStep } from "../model/commands";
import { EditorStore, type EditorState } from "../model/store";
import type { MindmapDoc } from "../model/types";
import { Canvas } from "./Canvas";
import { EditorProvider, useCommittedDoc, useEditor, useStore } from "./EditorContext";
import type { CanvasCallbacks } from "./useCanvasInteractions";
import { useElementSize } from "./useElementSize";

/**
 * A mindmap, read-only.
 *
 * This is the same canvas the editor draws with — same shapes, same routing,
 * same paper — mounted on a store that is permanently *presenting*. The
 * interaction layer already treats presenting as "look, don't touch": pointer
 * gestures on shapes are ignored and double-click does not open a label, and
 * nothing here wires up autosave or the presence heartbeat. Pan and zoom still
 * work, and pages can be flipped through, because a preview you cannot move
 * around in is a thumbnail.
 *
 * The store is built once from `doc`; mount with a `key` that changes when a
 * different document (or revision) should be shown.
 */

const NO_EDIT_CALLBACKS: CanvasCallbacks = {
    onContextMenuAt: () => undefined,
    onEditText: () => undefined,
};

export function MindmapPreview({ doc }: { doc: MindmapDoc }) {
    const [store] = useState(() => {
        const s = new EditorStore(doc);
        s.setPresenting(true);
        return s;
    });

    const stageRef = useRef<HTMLDivElement | null>(null);
    const stageSize = useElementSize(stageRef);

    // Frame the document once the stage has real dimensions.
    const framed = useRef(false);
    useEffect(() => {
        if (framed.current || stageSize.w < 40 || stageSize.h < 40) return;
        framed.current = true;
        fitToScreen(store, stageSize);
    }, [stageSize, store]);

    return (
        <EditorProvider store={store}>
            <TooltipProvider delayDuration={400}>
                <div
                    className="bg-surface flex h-full min-h-0 flex-col"
                    data-testid="mindmap-preview"
                >
                    <div ref={stageRef} className="relative flex min-h-0 flex-1">
                        <Canvas callbacks={NO_EDIT_CALLBACKS} />
                    </div>
                    <PreviewBar stageSize={stageSize} />
                </div>
            </TooltipProvider>
        </EditorProvider>
    );
}

const selectZoom = (s: EditorState) => s.viewport.zoom;

const ICON_BUTTON =
    "text-ink-2 hover:bg-panel-2 hover:text-ink flex size-7 items-center justify-center rounded-md transition-colors";

/** Page tabs and zoom — the two things a reader needs; nothing that edits. */
function PreviewBar({ stageSize }: { stageSize: { w: number; h: number } }) {
    const store = useStore();
    const doc = useCommittedDoc();
    const zoom = useEditor(selectZoom);

    const showPage = useCallback(
        (pageId: string) => {
            setActivePage(store, pageId);
            // The new page has its own content; frame it before it is shown.
            requestAnimationFrame(() => fitToScreen(store, stageSize));
        },
        [stageSize, store]
    );

    const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

    return (
        <div className="border-line bg-panel flex h-10 shrink-0 items-center gap-1 border-t px-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                {doc.pages.length > 1 &&
                    doc.pages.map(page => {
                        const active = page.id === doc.activePageId;
                        return (
                            <button
                                key={page.id}
                                type="button"
                                onClick={() => showPage(page.id)}
                                className={cn(
                                    "h-7 max-w-[160px] shrink-0 truncate rounded-md px-2.5 text-[12px] transition-colors",
                                    active
                                        ? "bg-brand-soft text-brand-ink"
                                        : "text-ink-2 hover:bg-panel-2"
                                )}
                            >
                                {page.name}
                            </button>
                        );
                    })}
            </div>
            <div className="flex items-center gap-0.5">
                <button
                    type="button"
                    aria-label="Zoom out"
                    onClick={() => zoomByStep(store, -1, stageSize)}
                    className={ICON_BUTTON}
                >
                    <Minus className="size-3.5" />
                </button>
                <span className="text-ink-2 w-12 text-center font-mono text-[11px] tabular-nums">
                    {zoomLabel}
                </span>
                <button
                    type="button"
                    aria-label="Zoom in"
                    onClick={() => zoomByStep(store, 1, stageSize)}
                    className={ICON_BUTTON}
                >
                    <Plus className="size-3.5" />
                </button>
                <button
                    type="button"
                    aria-label="Fit to screen"
                    onClick={() => fitToScreen(store, stageSize)}
                    className={ICON_BUTTON}
                >
                    <Maximize className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
