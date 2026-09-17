"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

import { TooltipProvider } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { fitToScreen, setActivePage, zoomByStep } from "../model/commands";
import { counterpartTheme, THEME_BY_ID, themeMode, type ThemeMode } from "../model/palette";
import { EditorStore, type EditorState } from "../model/store";
import { applyThemeToDoc } from "../model/theme";
import type { MindmapDoc, Viewport } from "../model/types";
import { Canvas } from "./Canvas";
import { EditorProvider, useCommittedDoc, useEditor, useStore } from "./EditorContext";
import { useAppThemeMode } from "./useAppThemeMode";
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

/** Viewports are floats; only a difference a reader could have caused counts. */
function sameViewport(a: Viewport, b: Viewport): boolean {
    return (
        Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 0.001
    );
}

/**
 * The same board, lit for whoever is reading it.
 *
 * Board paper is document data, not a viewer preference — picking Midnight is
 * meant to make a board dark for everyone who opens the file. That stays true:
 * nothing here writes to the document. But the ten themes are five identities
 * in two lightings, paired exactly so a board can be shown the other way up,
 * and a white page dropped into a dark app is the one case where honouring the
 * stored lighting serves nobody.
 *
 * So a *read-only* preview renders the counterpart when the two disagree:
 * same identity, same hues, lit to match the app. The editor deliberately does
 * not do this — there, the colours on screen are the colours about to be saved,
 * and showing one thing while storing another is how a document quietly
 * becomes a different document. The Theme picker's "switch to match the app"
 * hint stays the way an author changes it for real.
 */
function litForReader(doc: MindmapDoc, appMode: ThemeMode): MindmapDoc {
    const paletteId = doc.settings.paletteId;
    if (!paletteId || themeMode(paletteId) === appMode) return doc;

    const counterpart = THEME_BY_ID[counterpartTheme(paletteId)];
    // No twin (a custom or unpaired theme) means there is nothing faithful to
    // switch to, so the board is shown as its author left it.
    if (!counterpart || counterpart.mode !== appMode) return doc;

    return applyThemeToDoc(doc, counterpart.id);
}

export function MindmapPreview({ doc }: { doc: MindmapDoc }) {
    const appMode = useAppThemeMode();
    const lit = useMemo(() => litForReader(doc, appMode), [doc, appMode]);

    // The store is built once from the doc it is given, so a change of lighting
    // is a remount rather than an in-place repaint.
    return <PreviewSurface key={appMode} doc={lit} />;
}

function PreviewSurface({ doc }: { doc: MindmapDoc }) {
    const [store] = useState(() => {
        const s = new EditorStore(doc);
        s.setPresenting(true);
        return s;
    });

    const stageRef = useRef<HTMLDivElement | null>(null);
    const stageSize = useElementSize(stageRef);

    /**
     * The viewport our own framing last produced, or null before the first one.
     *
     * Auto-framing has to survive resizes: the preview commonly mounts while
     * its panel is still animating open, and a stage measured mid-animation is
     * narrow. Framing once against that measurement and never revisiting it is
     * what left the board at 8% in a pane that had since grown to full width.
     *
     * But it must also stop the moment the reader pans or zooms, or the board
     * would snap back under them on the next resize. Comparing the live
     * viewport against the one we set tells the two apart without the store
     * having to track intent.
     */
    const framedViewport = useRef<Viewport | null>(null);

    const frame = useCallback(
        (size: { w: number; h: number }) => {
            if (size.w < 40 || size.h < 40) return;
            fitToScreen(store, size);
            framedViewport.current = store.getState().viewport;
        },
        [store]
    );

    useEffect(() => {
        const framed = framedViewport.current;
        // Once the reader has moved the board, the stage is theirs.
        if (framed && !sameViewport(framed, store.getState().viewport)) return;
        frame(stageSize);
    }, [stageSize, frame, store]);

    return (
        <EditorProvider store={store}>
            <TooltipProvider delayDuration={400}>
                {/*
                 * `flex-1 min-w-0 w-full`: the viewer mounts this as an item in
                 * a flex row, where the default `flex: 0 1 auto` sized it to
                 * its own content — 158px inside a 706px pane, which is what
                 * squeezed the board down to 8%. min-w-0 lets the canvas shrink
                 * below its intrinsic width instead of overflowing.
                 */}
                <div
                    className="bg-surface flex h-full min-h-0 w-full min-w-0 flex-1 flex-col"
                    data-testid="mindmap-preview"
                >
                    <div ref={stageRef} className="relative flex min-h-0 flex-1">
                        <Canvas callbacks={NO_EDIT_CALLBACKS} />
                    </div>
                    <PreviewBar stageSize={stageSize} onFrame={frame} />
                </div>
            </TooltipProvider>
        </EditorProvider>
    );
}

const selectZoom = (s: EditorState) => s.viewport.zoom;

const ICON_BUTTON =
    "text-ink-2 hover:bg-panel-2 hover:text-ink flex size-7 items-center justify-center rounded-md transition-colors";

/** Page tabs and zoom — the two things a reader needs; nothing that edits. */
function PreviewBar({
    stageSize,
    onFrame,
}: {
    stageSize: { w: number; h: number };
    /** Frames the board *and* re-arms auto-framing — asking to fit means "track it again". */
    onFrame: (size: { w: number; h: number }) => void;
}) {
    const store = useStore();
    const doc = useCommittedDoc();
    const zoom = useEditor(selectZoom);

    const showPage = useCallback(
        (pageId: string) => {
            setActivePage(store, pageId);
            // The new page has its own content; frame it before it is shown.
            requestAnimationFrame(() => onFrame(stageSize));
        },
        [onFrame, stageSize, store]
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
                    onClick={() => onFrame(stageSize)}
                    className={ICON_BUTTON}
                >
                    <Maximize className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
