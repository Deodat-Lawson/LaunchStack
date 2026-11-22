"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
    ArrowLeft,
    Check,
    Cloud,
    CloudOff,
    Command,
    Download,
    Keyboard,
    ListOrdered,
    Loader2,
    Network,
    PanelLeft,
    PanelRight,
    Play,
    Redo2,
    Sparkles,
    Undo2,
    Upload,
    Palette,
    History as HistoryIcon,
    Link2,
    Save,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import {
    arrangeNow,
    runLayout,
    setAutoLayout,
    setDiagramKind,
    setFlowLayout,
    setTitle,
} from "../model/commands";
import { setStepsPanelOpen } from "../flow";
import { worksAsFlow } from "../model/doc";
import type { EditorState, ChromeDepth } from "../model/store";
import type { DiagramKind } from "../model/types";
import { useEditor, useStore } from "./EditorContext";
import { PageSettings } from "./Inspector";
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
    /**
     * Leave the editor. The workspace that mounted the editor decides where
     * "back" goes — to the map's preview, in practice — so this is a callback
     * rather than a link. Without one the arrow falls back to the library.
     */
    onBack?: () => void;
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
    /** How much chrome is showing — see `ChromeDepth`. */
    depth: ChromeDepth;
    onToggleDepth: () => void;
    /** Open the version history (the left panel's History tab). */
    onHistory: () => void;
    /** Put a link that opens the map straight into Present on the clipboard. */
    onCopyPresentLink?: () => void;
    /** The page was just arranged from the Layout menu: bring it into view. */
    onArranged?: () => void;
}

const selectAutoLayout = (s: EditorState) => s.doc.settings.autoLayout;
const selectFlowLayout = (s: EditorState) => s.doc.settings.flowLayout;
const selectStepsPanel = (s: EditorState) => s.stepsPanel;
const selectKind = (s: EditorState) => s.doc.settings.kind;
/** The Works-as choice a kind shows as; a freeform drawing shows neither. */
const KIND_CHOICE: Record<DiagramKind, string> = {
    flowchart: "flowchart",
    board: "flowchart",
    mindmap: "mindmap",
    freeform: "",
};

export function TopBar(props: TopBarProps) {
    const t = useTranslations("mindmap.topBar");
    const tc = useTranslations("common");
    const store = useStore();
    const autoLayout = useEditor(selectAutoLayout);
    const flowLayout = useEditor(selectFlowLayout);
    const stepsOpen = useEditor(selectStepsPanel);
    const kind = useEditor(selectKind);
    const flow = worksAsFlow(kind);
    const focus = props.depth === "focus";
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
                    {props.onBack ? (
                        <button
                            type="button"
                            onClick={props.onBack}
                            className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors"
                            aria-label={tc("actions.back")}
                        >
                            <ArrowLeft className="size-4" />
                        </button>
                    ) : (
                        <Link
                            href="/employer/documents"
                            className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors"
                            aria-label={t("backToLibrary")}
                        >
                            <ArrowLeft className="size-4" />
                        </Link>
                    )}
                </TooltipTrigger>
                <TooltipContent side="bottom">
                    {props.onBack ? tc("actions.back") : t("backToLibrary")}
                </TooltipContent>
            </Tooltip>

            <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={() => setTitle(store, draft.trim() || t("untitled"))}
                onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                        setDraft(docTitle);
                        e.currentTarget.blur();
                    }
                }}
                aria-label={t("titleLabel")}
                className="text-ink hover:border-line focus:border-brand h-8 min-w-0 max-w-[280px] flex-shrink rounded-md border border-transparent bg-transparent px-2 text-[14px] font-semibold outline-none transition-colors"
            />

            {/* One truth about saving: the status is the control. Autosave
                does the saving; this menu is for the two things it does not
                do on its own — snapshot a version, and look at the history. */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label={t("saveOptions")}
                        className="hover:bg-panel-2 rounded-md px-1.5 py-1 transition-colors"
                    >
                        <SaveState {...state} />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={props.onSave} disabled={state.saving}>
                        <Save className="size-3.5" />
                        {t("saveVersion")}
                        <span className="text-ink-3 ml-auto font-mono text-[11px]">⌘S</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={props.onHistory}>
                        <HistoryIcon className="size-3.5" />
                        {t("versionHistory")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <div className="bg-line mx-1 h-5 w-px" />

            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={() => store.undo()}
                        disabled={!state.canUndo}
                        aria-label={tc("actions.undo")}
                        className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-35"
                    >
                        <Undo2 className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("undoTip")}</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={() => store.redo()}
                        disabled={!state.canRedo}
                        aria-label={t("redo")}
                        className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-35"
                    >
                        <Redo2 className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("redoTip")}</TooltipContent>
            </Tooltip>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-[13px]">
                        <Network className="size-4" />
                        {t("layout")}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    {/* How the document works: Tab, Enter, Delete, the collapse
                        buttons and auto-arrange all follow this (see
                        `worksAsFlow`). A map built as a flowchart out of
                        topics is switched here, without redrawing it. */}
                    <DropdownMenuLabel className="text-ink-3 text-[11px] font-medium">
                        {t("worksAs")}
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        value={KIND_CHOICE[kind]}
                        onValueChange={value =>
                            setDiagramKind(store, value === "mindmap" ? "mindmap" : "flowchart")
                        }
                    >
                        <DropdownMenuRadioItem value="flowchart">
                            {t("kinds.flowchart")}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="mindmap">
                            {t("kinds.mindmap")}
                        </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onSelect={() => {
                            arrangeNow(store);
                            props.onArranged?.();
                        }}
                    >
                        <Network className="size-3.5" />
                        {t("arrangeNow")}
                    </DropdownMenuItem>
                    {/* A flowchart arranges itself top to bottom until a box is
                        moved by hand (`flowLayout`); this turns it back on, and
                        arranges it now. A mindmap's arranging is its own. */}
                    {flow && (
                        <DropdownMenuCheckboxItem
                            checked={flowLayout === "auto"}
                            onCheckedChange={checked => {
                                setFlowLayout(store, checked ? "auto" : "manual");
                                // Turning it on arranges the chart now: keep it on screen.
                                if (checked) props.onArranged?.();
                            }}
                        >
                            {t("arrangeAutomatically")}
                        </DropdownMenuCheckboxItem>
                    )}
                    {!flow && (
                        <DropdownMenuCheckboxItem
                            checked={autoLayout !== null}
                            onCheckedChange={checked =>
                                setAutoLayout(
                                    store,
                                    checked ? (autoLayout ?? { kind: "mindmap" }) : null
                                )
                            }
                        >
                            {t("autoArrange")}
                        </DropdownMenuCheckboxItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>{t("arrangeAs")}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            <DropdownMenuItem
                                onSelect={() => runLayout(store, { kind: "mindmap" })}
                            >
                                {t("layouts.mindmap")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() =>
                                    runLayout(store, { kind: "tree", direction: "right" })
                                }
                            >
                                {t("layouts.treeRight")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() =>
                                    runLayout(store, { kind: "tree", direction: "down" })
                                }
                            >
                                {t("layouts.treeDown")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => runLayout(store, { kind: "org" })}>
                                {t("layouts.org")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => runLayout(store, { kind: "radial" })}>
                                {t("layouts.radial")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => runLayout(store, { kind: "grid" })}>
                                {t("layouts.grid")}
                            </DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* The chart as lines, beside it: open unless this person closed it. */}
            {flow && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-pressed={stepsOpen}
                            onClick={() => setStepsPanelOpen(store, !stepsOpen)}
                            className={cn(
                                "h-8 gap-1.5 px-2 text-[13px]",
                                stepsOpen && "bg-brand-soft text-brand-ink hover:bg-brand-soft"
                            )}
                        >
                            <ListOrdered className="size-4" />
                            {t("steps")}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        {stepsOpen ? t("stepsHideTip") : t("stepsShowTip")}
                    </TooltipContent>
                </Tooltip>
            )}

            <span className="flex-1" />

            <PresenceAvatars peers={props.peers} />

            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={props.onCommandPalette}
                        aria-label={t("commandPalette")}
                        className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors"
                    >
                        <Command className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("commandsTip")}</TooltipContent>
            </Tooltip>
            {!focus && (
                <>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={props.onShortcuts}
                                aria-label={t("shortcuts")}
                                className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors"
                            >
                                <Keyboard className="size-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t("shortcutsTip")}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={props.onToggleLeft}
                                aria-pressed={props.leftPanelOpen}
                                aria-label={t("toggleLeft")}
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
                        <TooltipContent side="bottom">{t("leftTip")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={props.onToggleRight}
                                aria-pressed={props.rightPanelOpen}
                                aria-label={t("toggleRight")}
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
                        <TooltipContent side="bottom">{t("rightTip")}</TooltipContent>
                    </Tooltip>
                </>
            )}

            <Popover>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                aria-label={t("appearance")}
                                className="text-ink-2 hover:bg-panel-2 flex size-8 items-center justify-center rounded-md transition-colors"
                            >
                                <Palette className="size-4" />
                            </button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t("appearanceTip")}</TooltipContent>
                </Tooltip>
                <PopoverContent align="end" className="w-[312px] p-0">
                    <ScrollArea className="h-[520px]">
                        <PageSettings />
                    </ScrollArea>
                </PopoverContent>
            </Popover>

            <div
                role="group"
                aria-label={t("chromeDepth")}
                className="border-line bg-panel-2 flex h-8 items-center rounded-md border p-0.5 text-[12px]"
            >
                <button
                    type="button"
                    onClick={focus ? undefined : props.onToggleDepth}
                    aria-pressed={focus}
                    className={cn(
                        "h-7 rounded px-2.5 transition-colors",
                        focus ? "bg-panel text-ink shadow-sm" : "text-ink-3 hover:text-ink-2"
                    )}
                >
                    {t("simple")}
                </button>
                <button
                    type="button"
                    onClick={focus ? props.onToggleDepth : undefined}
                    aria-pressed={!focus}
                    className={cn(
                        "h-7 rounded px-2.5 transition-colors",
                        !focus ? "bg-panel text-ink shadow-sm" : "text-ink-3 hover:text-ink-2"
                    )}
                >
                    {t("everything")}
                </button>
            </div>

            <div className="bg-line mx-1 h-5 w-px" />

            <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2"
                onClick={props.onPresent}
            >
                <Play className="size-4" />
                {t("present")}
            </Button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5">
                        <Download className="size-4" />
                        {tc("actions.share")}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={props.onExport}>
                        <Download className="size-3.5" />
                        {t("export")}
                        <span className="text-ink-3 ml-auto font-mono text-[11px]">⌘E</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={props.onImport}>
                        <Upload className="size-3.5" />
                        {t("import")}
                    </DropdownMenuItem>
                    {props.onCopyPresentLink && (
                        <DropdownMenuItem onSelect={props.onCopyPresentLink}>
                            <Link2 className="size-3.5" />
                            {t("copyPresentLink")}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={props.onPublish}>
                        <Sparkles className="size-3.5" />
                        {t("addToSources")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
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
    const t = useTranslations("mindmap.topBar");
    const tc = useTranslations("common");
    if (saving) {
        return (
            <span className="text-ink-3 flex items-center gap-1.5 text-[12px]">
                <Loader2 className="size-3.5 animate-spin" />
                {tc("status.saving")}
            </span>
        );
    }
    if (dirty) {
        return (
            <span className="text-ink-3 flex items-center gap-1.5 text-[12px]">
                <CloudOff className="size-3.5" />
                {t("unsaved")}
            </span>
        );
    }
    if (savedAt) {
        return (
            <span className="text-ink-3 flex items-center gap-1.5 text-[12px]">
                <Check className="text-success-ink size-3.5" />
                {tc("status.saved")}
            </span>
        );
    }
    return (
        <span className="text-ink-3 flex items-center gap-1.5 text-[12px]">
            <Cloud className="size-3.5" />
            {t("upToDate")}
        </span>
    );
}
