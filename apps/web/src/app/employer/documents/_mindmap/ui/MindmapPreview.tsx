"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Maximize, Minus, Plus } from "lucide-react";

import { TooltipProvider } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { setActivePage, zoomByStep } from "../model/commands";
import { EditorStore, type EditorState } from "../model/store";
import { litForReader } from "../model/theme";
import type { MindmapDoc } from "../model/types";
import { Canvas } from "./Canvas";
import { EditorProvider, useCommittedDoc, useEditor, useStore } from "./EditorContext";
import { Presenter } from "./Presenter";
import { useAppThemeMode } from "./useAppThemeMode";
import type { CanvasCallbacks } from "./useCanvasInteractions";
import { useAutoFit } from "./useAutoFit";
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

export interface MindmapPreviewProps {
    doc: MindmapDoc;
    /** Open straight into the branch-by-branch presenter (`?present=1`). */
    present?: boolean;
    onExitPresent?: () => void;
}

export function MindmapPreview({ doc, present = false, onExitPresent }: MindmapPreviewProps) {
    const appMode = useAppThemeMode();
    const lit = useMemo(() => litForReader(doc, appMode), [doc, appMode]);

    // The store is built once from the doc it is given, so a change of lighting
    // is a remount rather than an in-place repaint.
    return (
        <PreviewSurface key={appMode} doc={lit} present={present} onExitPresent={onExitPresent} />
    );
}

function PreviewSurface({ doc, present = false, onExitPresent }: MindmapPreviewProps) {
    const [store] = useState(() => {
        const s = new EditorStore(doc);
        s.setPresenting(true);
        return s;
    });

    const stageRef = useRef<HTMLDivElement | null>(null);
    const stageSize = useElementSize(stageRef);

    const frame = useAutoFit(store, stageSize);

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
                        {present && (
                            <Presenter
                                canvasSize={stageSize}
                                onExit={onExitPresent ?? (() => undefined)}
                            />
                        )}
                    </div>
                    {!present && <PreviewBar stageSize={stageSize} onFrame={frame} />}
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
    const t = useTranslations("mindmap.zoom");
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
                    aria-label={t("out")}
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
                    aria-label={t("in")}
                    onClick={() => zoomByStep(store, 1, stageSize)}
                    className={ICON_BUTTON}
                >
                    <Plus className="size-3.5" />
                </button>
                <button
                    type="button"
                    aria-label={t("fit")}
                    onClick={() => onFrame(stageSize)}
                    className={ICON_BUTTON}
                >
                    <Maximize className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
