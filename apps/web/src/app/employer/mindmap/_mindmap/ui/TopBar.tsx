"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Check,
    Cloud,
    CloudOff,
    Command,
    Download,
    Keyboard,
    Loader2,
    Network,
    PanelLeft,
    PanelRight,
    Play,
    Redo2,
    Sparkles,
    Undo2,
    Upload,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { runLayout, setTitle } from "../model/commands";
import type { EditorState } from "../model/store";
import { useEditor, useStore } from "./EditorContext";
import { PresenceAvatars } from "./PresenceLayer";
import type { PresencePeer } from "./usePresence";

/**
 * The editor's top bar: identity, history, layout, and the ways out of the
 * document (export, publish, present).
 *
 * Save state is a plain sentence rather than an icon-only affordance — "Saving…
 * / Saved / Unsaved" is the single most-checked piece of information in a
 * document editor and it should never need a hover to read.
 */

const selectTitle = (s: EditorState) => s.doc.title;
const selectSaveState = (s: EditorState) => ({
    dirty: s.dirty,
    saving: s.saving,
    savedAt: s.savedAt,
    canUndo: s.canUndo,
    canRedo: s.canRedo,
    presenting: s.presenting,
});

function saveStateEqual(
    a: ReturnType<typeof selectSaveState>,
    b: ReturnType<typeof selectSaveState>
): boolean {
    return (
        a.dirty === b.dirty &&
        a.saving === b.saving &&
        a.savedAt === b.savedAt &&
        a.canUndo === b.canUndo &&
        a.canRedo === b.canRedo &&
        a.presenting === b.presenting
    );
}

export interface TopBarProps {
    /** Other people currently in the document. */
    peers: PresencePeer[];
    onSave: () => void;
    onExport: () => void;
    onImport: () => void;
    onPublish: () => void;
    onPresent: () => void;
    onShortcuts: () => void;
    onCommandPalette: () => void;
    leftPanelOpen: boolean;
    rightPanelOpen: boolean;
    onToggleLeft: () => void;
    onToggleRight: () => void;
}

export function TopBar(props: TopBarProps) {
    const store = useStore();
    const docTitle = useEditor(selectTitle);
    const state = useEditor(selectSaveState, saveStateEqual);
    const [draft, setDraft] = useState(docTitle);

    useEffect(() => {
        setDraft(docTitle);
    }, [docTitle]);

    return (
        <header className="border-line bg-panel flex h-12 shrink-0 items-center gap-2 border-b px-2">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Link
                        href="/employer/mindmap"
                        className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors"
                        aria-label="All mindmaps"
                    >
                        <ArrowLeft className="size-4" />
                    </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom">All mindmaps</TooltipContent>
            </Tooltip>

            <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={() => setTitle(store, draft.trim() || "Untitled mindmap")}
                onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                        setDraft(docTitle);
                        e.currentTarget.blur();
                    }
                }}
                aria-label="Mindmap title"
                className="text-ink hover:border-line focus:border-brand h-8 min-w-0 max-w-[280px] flex-shrink rounded-md border border-transparent bg-transparent px-2 text-[14px] font-semibold outline-none transition-colors"
            />

            <SaveState {...state} />

            <div className="bg-line mx-1 h-5 w-px" />

            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={() => store.undo()}
                        disabled={!state.canUndo}
                        aria-label="Undo"
                        className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-35"
                    >
                        <Undo2 className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Undo ⌘Z</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={() => store.redo()}
                        disabled={!state.canRedo}
                        aria-label="Redo"
                        className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-35"
                    >
                        <Redo2 className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Redo ⇧⌘Z</TooltipContent>
            </Tooltip>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-[13px]">
                        <Network className="size-4" />
                        Layout
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => runLayout(store, { kind: "mindmap" })}>
                        Mindmap (both sides)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => runLayout(store, { kind: "tree", direction: "right" })}
                    >
                        Tree — left to right
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => runLayout(store, { kind: "tree", direction: "down" })}
                    >
                        Tree — top down
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => runLayout(store, { kind: "org" })}>
                        Org chart
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => runLayout(store, { kind: "radial" })}>
                        Radial
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => runLayout(store, { kind: "grid" })}>
                        Pack into a grid
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <span className="flex-1" />

            <PresenceAvatars peers={props.peers} />

            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={props.onCommandPalette}
                        aria-label="Command palette"
                        className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors"
                    >
                        <Command className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Commands ⌘K</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={props.onShortcuts}
                        aria-label="Keyboard shortcuts"
                        className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors"
                    >
                        <Keyboard className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Shortcuts ?</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={props.onToggleLeft}
                        aria-pressed={props.leftPanelOpen}
                        aria-label="Toggle left panel"
                        className={cn(
                            "flex size-8 items-center justify-center rounded-md transition-colors",
                            props.leftPanelOpen
                                ? "bg-brand-soft text-brand-ink"
                                : "text-ink-2 hover:bg-panel-2"
                        )}
                    >
                        <PanelLeft className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Shapes & outline</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={props.onToggleRight}
                        aria-pressed={props.rightPanelOpen}
                        aria-label="Toggle right panel"
                        className={cn(
                            "flex size-8 items-center justify-center rounded-md transition-colors",
                            props.rightPanelOpen
                                ? "bg-brand-soft text-brand-ink"
                                : "text-ink-2 hover:bg-panel-2"
                        )}
                    >
                        <PanelRight className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Properties</TooltipContent>
            </Tooltip>

            <div className="bg-line mx-1 h-5 w-px" />

            <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2"
                onClick={props.onPresent}
            >
                <Play className="size-4" />
                Present
            </Button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5">
                        <Download className="size-4" />
                        Share
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={props.onExport}>
                        <Download className="size-3.5" />
                        Export…
                        <span className="text-ink-3 ml-auto font-mono text-[11px]">⌘E</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={props.onImport}>
                        <Upload className="size-3.5" />
                        Import…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={props.onPublish}>
                        <Sparkles className="size-3.5" />
                        Add to sources
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Button size="sm" className="h-8" onClick={props.onSave} disabled={state.saving}>
                {state.saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
            </Button>
        </header>
    );
}

function SaveState({
    dirty,
    saving,
    savedAt,
}: {
    dirty: boolean;
    saving: boolean;
    savedAt: number | null;
}) {
    if (saving) {
        return (
            <span className="text-ink-3 flex items-center gap-1.5 text-[12px]">
                <Loader2 className="size-3.5 animate-spin" />
                Saving…
            </span>
        );
    }
    if (dirty) {
        return (
            <span className="text-ink-3 flex items-center gap-1.5 text-[12px]">
                <CloudOff className="size-3.5" />
                Unsaved changes
            </span>
        );
    }
    if (savedAt) {
        return (
            <span className="text-ink-3 flex items-center gap-1.5 text-[12px]">
                <Check className="text-success size-3.5" />
                Saved
            </span>
        );
    }
    return (
        <span className="text-ink-3 flex items-center gap-1.5 text-[12px]">
            <Cloud className="size-3.5" />
            Up to date
        </span>
    );
}
