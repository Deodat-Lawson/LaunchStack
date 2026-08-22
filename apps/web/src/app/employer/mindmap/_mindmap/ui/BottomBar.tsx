"use client";

import React, { useMemo, useState } from "react";
import { Copy, Map as MapIcon, Maximize, Minus, Plus, Trash2, X } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

import {
    addPage,
    deletePage,
    duplicatePage,
    fitToScreen,
    renamePage,
    setActivePage,
} from "../model/commands";
import { nextZoomStep } from "../model/geometry";
import type { EditorState } from "../model/store";
import { useCommittedDoc, useEditor, useStore } from "./EditorContext";
import { Minimap } from "./Minimap";

/**
 * Page tabs, zoom controls and the minimap toggle.
 *
 * Pages are a first-class part of the document (a flowchart's "detail" page, a
 * mindmap's parking lot), so they live in permanent chrome rather than behind a
 * menu.
 */

const selectZoom = (s: EditorState) => s.viewport.zoom;

export function BottomBar({ canvasSize }: { canvasSize: { w: number; h: number } }) {
    const store = useStore();
    // `doc.pages` is a fresh array on every frame of a drag even though the page
    // list has not changed, so read it off the committed document instead.
    const doc = useCommittedDoc();
    const pages = doc.pages;
    const activePageId = doc.activePageId;
    const zoom = useEditor(selectZoom);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [showMinimap, setShowMinimap] = useState(true);

    const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

    return (
        <>
            {showMinimap && (
                <div className="pointer-events-auto absolute bottom-14 right-3 z-10">
                    <Minimap canvasSize={canvasSize} />
                </div>
            )}

            <div className="border-line bg-panel flex h-10 shrink-0 items-center gap-1 border-t px-2">
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                    {pages.map(page => {
                        const active = page.id === activePageId;
                        if (renaming === page.id) {
                            return (
                                <input
                                    key={page.id}
                                    autoFocus
                                    defaultValue={page.name}
                                    onBlur={e => {
                                        const value = e.target.value.trim();
                                        if (value) renamePage(store, page.id, value);
                                        setRenaming(null);
                                    }}
                                    onKeyDown={e => {
                                        e.stopPropagation();
                                        if (e.key === "Enter") e.currentTarget.blur();
                                        if (e.key === "Escape") setRenaming(null);
                                    }}
                                    className="border-brand bg-panel text-ink h-7 w-32 rounded-md border px-2 text-[12px] outline-none"
                                />
                            );
                        }
                        return (
                            <DropdownMenu key={page.id}>
                                <div
                                    className={cn(
                                        "flex h-7 shrink-0 items-center rounded-md text-[12px] transition-colors",
                                        active
                                            ? "bg-brand-soft text-brand-ink"
                                            : "text-ink-2 hover:bg-panel-2"
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => setActivePage(store, page.id)}
                                        onDoubleClick={() => setRenaming(page.id)}
                                        className="max-w-[160px] truncate px-2.5 py-1"
                                    >
                                        {page.name}
                                    </button>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label={`${page.name} options`}
                                            className="text-ink-3 hover:text-ink px-1"
                                        >
                                            ⋯
                                        </button>
                                    </DropdownMenuTrigger>
                                </div>
                                <DropdownMenuContent align="start" side="top">
                                    <DropdownMenuItem onSelect={() => setRenaming(page.id)}>
                                        Rename
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() => duplicatePage(store, page.id)}
                                    >
                                        <Copy className="size-3.5" />
                                        Duplicate page
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        disabled={pages.length <= 1}
                                        onSelect={() => deletePage(store, page.id)}
                                        className="text-danger"
                                    >
                                        <Trash2 className="size-3.5" />
                                        Delete page
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        );
                    })}

                    <button
                        type="button"
                        onClick={() => addPage(store)}
                        aria-label="Add page"
                        title="Add page"
                        className="text-ink-3 hover:bg-panel-2 hover:text-ink flex size-7 shrink-0 items-center justify-center rounded-md"
                    >
                        <Plus className="size-4" />
                    </button>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                    <button
                        type="button"
                        onClick={() => setShowMinimap(v => !v)}
                        title={showMinimap ? "Hide minimap" : "Show minimap"}
                        aria-pressed={showMinimap}
                        className={cn(
                            "flex size-7 items-center justify-center rounded-md transition-colors",
                            showMinimap
                                ? "bg-brand-soft text-brand-ink"
                                : "text-ink-3 hover:bg-panel-2"
                        )}
                    >
                        {showMinimap ? <X className="size-3.5" /> : <MapIcon className="size-4" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => fitToScreen(store, canvasSize)}
                        title="Fit to screen (⌘1)"
                        aria-label="Fit to screen"
                        className="text-ink-3 hover:bg-panel-2 hover:text-ink flex size-7 items-center justify-center rounded-md"
                    >
                        <Maximize className="size-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => store.setViewport({ zoom: nextZoomStep(zoom, -1) })}
                        title="Zoom out (⌘-)"
                        aria-label="Zoom out"
                        className="text-ink-3 hover:bg-panel-2 hover:text-ink flex size-7 items-center justify-center rounded-md"
                    >
                        <Minus className="size-4" />
                    </button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="text-ink-2 hover:bg-panel-2 h-7 w-14 rounded-md text-center font-mono text-[12px] tabular-nums"
                            >
                                {zoomLabel}
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="top">
                            {[0.25, 0.5, 0.75, 1, 1.5, 2, 4].map(value => (
                                <DropdownMenuItem
                                    key={value}
                                    onSelect={() => store.setViewport({ zoom: value })}
                                >
                                    {Math.round(value * 100)}%
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => fitToScreen(store, canvasSize)}>
                                Fit to screen
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <button
                        type="button"
                        onClick={() => store.setViewport({ zoom: nextZoomStep(zoom, 1) })}
                        title="Zoom in (⌘=)"
                        aria-label="Zoom in"
                        className="text-ink-3 hover:bg-panel-2 hover:text-ink flex size-7 items-center justify-center rounded-md"
                    >
                        <Plus className="size-4" />
                    </button>
                </div>
            </div>
        </>
    );
}
