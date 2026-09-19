"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { PanelsTopLeft, Plus, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { cn } from "~/lib/utils";
import type { StudioFeature } from "./types";

interface TabState {
    ids: string[];
    activeId: string;
}

/**
 * A move names the neighbour it lands in front of, not a numeric index:
 * the strip renders a *filtered* list (permission-gated apps are absent)
 * while the reducer owns the unfiltered one, so any index the strip computed
 * would address the wrong slot the moment the two lists disagree.
 * `beforeId: null` means "to the end".
 */
type TabAction =
    | { type: "open"; id: string }
    | { type: "close"; id: string }
    | { type: "move"; id: string; beforeId: string | null };

export function reduceTabs(state: TabState, action: TabAction): TabState {
    const index = state.ids.indexOf(action.id);
    switch (action.type) {
        case "open":
            return {
                ids: index < 0 ? [...state.ids, action.id] : state.ids,
                activeId: action.id,
            };
        case "close": {
            if (index < 0) return state;
            const ids = state.ids.filter(id => id !== action.id);
            return {
                ids,
                activeId:
                    state.activeId === action.id
                        ? // Whatever slid into this slot; closing the last tab
                          // falls back to the new last, and closing the only
                          // tab leaves nothing open.
                          (ids[index] ?? ids.at(-1) ?? "")
                        : state.activeId,
            };
        }
        case "move": {
            if (index < 0 || action.beforeId === action.id) return state;
            const rest = state.ids.filter(id => id !== action.id);
            const at = action.beforeId === null ? rest.length : rest.indexOf(action.beforeId);
            if (at < 0) return state;
            const ids = [...rest.slice(0, at), action.id, ...rest.slice(at)];
            if (ids.every((id, i) => id === state.ids[i])) return state;
            return { ...state, ids };
        }
    }
}

/** Chat is the workspace's front door, so it is the one tab open on arrival. */
const INITIAL_TABS: TabState = { ids: ["chat"], activeId: "chat" };

export function useStudioTabs() {
    const [state, dispatch] = useReducer(reduceTabs, INITIAL_TABS);
    const open = useCallback((id: string) => dispatch({ type: "open", id }), []);
    const close = useCallback((id: string) => dispatch({ type: "close", id }), []);
    const move = useCallback(
        (id: string, beforeId: string | null) => dispatch({ type: "move", id, beforeId }),
        []
    );
    return { ...state, open, close, move };
}

interface StudioTabsProps {
    /** Open apps, in strip order, already filtered to what this person may see. */
    features: StudioFeature[];
    activeId: string;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onMove: (id: string, beforeId: string | null) => void;
    onOpenStudio: () => void;
    leadingSlot?: ReactNode;
    /**
     * `active` is false for every pane but the one on screen. Panes that own
     * window listeners, polling or autosave gate on it rather than inspecting
     * the DOM for a `hidden` ancestor.
     */
    children: (id: string, active: boolean) => ReactNode;
}

/** One mounted panel per open app. Switching never discards local drafts or scroll. */
export function StudioTabs({
    features,
    activeId,
    onSelect,
    onClose,
    onMove,
    onOpenStudio,
    leadingSlot,
    children,
}: StudioTabsProps) {
    const stripRef = useRef<HTMLDivElement>(null);
    const draggedId = useRef<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
    const [announcement, setAnnouncement] = useState("");

    const order = features.map(feature => feature.id).join("|");
    useEffect(() => {
        const el = stripRef.current?.querySelector<HTMLElement>(
            '[role="tab"][data-state="active"]'
        );
        // Optional call as well as optional chain: jsdom has no scrollIntoView.
        el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        // `order`, not `features.length`: a reorder can push the active tab
        // off the edge of the overflow strip without changing either.
    }, [activeId, order]);

    /**
     * Closing the focused tab must not drop focus onto `document.body` — that
     * would strand a keyboard user at the top of the page. Focus follows to
     * whichever tab took its place, or to the Studio button when the last one
     * closes.
     */
    const closeTab = (id: string) => {
        const focusWasInStrip = stripRef.current?.contains(document.activeElement);
        onClose(id);
        if (!focusWasInStrip) return;
        requestAnimationFrame(() => {
            const target =
                stripRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ??
                stripRef.current?.querySelector<HTMLElement>('[aria-label="Open Studio apps"]');
            target?.focus();
        });
    };

    /** Alt+Arrow: step one place, expressed as the neighbour to land in front of. */
    const moveByKeyboard = (feature: StudioFeature, index: number, delta: -1 | 1) => {
        const to = index + delta;
        if (to < 0 || to > features.length - 1) return;
        const beforeId =
            delta === -1 ? (features[index - 1]?.id ?? null) : (features[index + 2]?.id ?? null);
        onMove(feature.id, beforeId);
        setAnnouncement(`${feature.label} moved to position ${to + 1} of ${features.length}`);
    };

    return (
        <Tabs
            value={activeId}
            onValueChange={onSelect}
            className="h-full min-h-0 min-w-0 flex-1 gap-0 overflow-hidden"
        >
            <div
                ref={stripRef}
                data-studio-tab-strip
                className="border-line bg-panel-2 flex min-h-10 shrink-0 items-center border-b"
            >
                {leadingSlot}
                <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
                    <TabsList
                        aria-label="Studio apps"
                        className="h-10 min-w-full justify-start gap-0 rounded-none bg-transparent p-0"
                    >
                        {features.map((feature, index) => {
                            const active = feature.id === activeId;
                            const Icon = feature.Icon;
                            return (
                                <div
                                    key={feature.id}
                                    role="presentation"
                                    className={cn(
                                        "border-line relative flex h-full shrink-0 items-center border-r border-t-2",
                                        active
                                            ? "border-t-brand bg-panel"
                                            : "text-ink-3 border-t-transparent",
                                        dropTarget?.id === feature.id &&
                                            (dropTarget.after
                                                ? "after:bg-brand after:absolute after:inset-y-0 after:right-0 after:w-0.5"
                                                : "before:bg-brand before:absolute before:inset-y-0 before:left-0 before:w-0.5")
                                    )}
                                    draggable
                                    onDragStart={event => {
                                        draggedId.current = feature.id;
                                        event.dataTransfer.effectAllowed = "move";
                                        event.dataTransfer.setData("text/plain", feature.id);
                                    }}
                                    onDragOver={event => {
                                        if (!draggedId.current) return;
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "move";
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setDropTarget({
                                            id: feature.id,
                                            after: event.clientX > rect.left + rect.width / 2,
                                        });
                                    }}
                                    onDragLeave={event => {
                                        // Fires when the pointer crosses into
                                        // the trigger or the close button too.
                                        if (
                                            !event.currentTarget.contains(
                                                event.relatedTarget as Node | null
                                            )
                                        ) {
                                            setDropTarget(null);
                                        }
                                    }}
                                    onDrop={event => {
                                        event.preventDefault();
                                        const id = draggedId.current;
                                        if (id) {
                                            const rect =
                                                event.currentTarget.getBoundingClientRect();
                                            const after =
                                                event.clientX > rect.left + rect.width / 2;
                                            onMove(
                                                id,
                                                after
                                                    ? (features[index + 1]?.id ?? null)
                                                    : feature.id
                                            );
                                        }
                                        draggedId.current = null;
                                        setDropTarget(null);
                                    }}
                                    onDragEnd={() => {
                                        draggedId.current = null;
                                        setDropTarget(null);
                                    }}
                                    onAuxClick={event => {
                                        if (event.button === 1) {
                                            event.preventDefault();
                                            closeTab(feature.id);
                                        }
                                    }}
                                >
                                    <TabsTrigger
                                        value={feature.id}
                                        aria-setsize={features.length}
                                        aria-posinset={index + 1}
                                        title={`${feature.label} — drag to reorder; Alt+Arrow to move; Delete to close`}
                                        className="text-ink-2 data-[state=active]:text-ink dark:data-[state=active]:text-ink h-full max-w-52 flex-none justify-start gap-2 rounded-none border-0 bg-transparent px-3 pr-1 text-xs shadow-none data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent"
                                        onKeyDown={event => {
                                            if (
                                                event.altKey &&
                                                (event.key === "ArrowLeft" ||
                                                    event.key === "ArrowRight")
                                            ) {
                                                event.preventDefault();
                                                // Radix moves selection on bare
                                                // arrows; this is a reorder, so
                                                // it must not also navigate.
                                                event.stopPropagation();
                                                moveByKeyboard(
                                                    feature,
                                                    index,
                                                    event.key === "ArrowLeft" ? -1 : 1
                                                );
                                            } else if (
                                                event.key === "Delete" ||
                                                event.key === "Backspace"
                                            ) {
                                                // Both halves matter: the
                                                // mindmap editor's keyboard
                                                // hook bails on
                                                // `defaultPrevented`, so
                                                // without this a tab Delete
                                                // also deletes the selected
                                                // shapes behind it.
                                                event.preventDefault();
                                                event.stopPropagation();
                                                closeTab(feature.id);
                                            }
                                        }}
                                    >
                                        <Icon size={14} />
                                        <span className="truncate">{feature.label}</span>
                                    </TabsTrigger>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-ink-3 mx-1 size-6 rounded-sm"
                                        // Reached by mouse, or by Delete on
                                        // the tab; a stop of its own here
                                        // would put one in front of every tab.
                                        tabIndex={-1}
                                        aria-label={`Close ${feature.label} tab`}
                                        title={`Close ${feature.label} tab`}
                                        onPointerDown={event => event.stopPropagation()}
                                        onClick={() => closeTab(feature.id)}
                                    >
                                        <X className="size-3" />
                                    </Button>
                                </div>
                            );
                        })}
                    </TabsList>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="text-ink-3 mx-1 size-8"
                    aria-label="Open Studio apps"
                    title="Open Studio apps"
                    onClick={onOpenStudio}
                >
                    <Plus className="size-4" />
                </Button>
            </div>
            <span role="status" aria-live="polite" className="sr-only">
                {announcement}
            </span>
            {features.map(feature => (
                <TabsContent
                    key={feature.id}
                    value={feature.id}
                    // `forceMount` keeps every open app rendered; `hidden`
                    // is ours because forceMount stops Radix setting it.
                    forceMount
                    hidden={feature.id !== activeId}
                    className="bg-surface min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=inactive]:hidden data-[state=active]:flex-col"
                >
                    {children(feature.id, feature.id === activeId)}
                </TabsContent>
            ))}
            {features.length === 0 && (
                <div className="bg-surface text-ink-3 flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                    <PanelsTopLeft className="text-ink-3 size-9" strokeWidth={1.25} />
                    <h2 className="text-ink text-base font-medium">
                        Your workspace, ready when you are
                    </h2>
                    <p className="max-w-sm text-sm">Open an app from Studio to get started.</p>
                    <Button variant="outline" onClick={onOpenStudio}>
                        <Plus className="size-4" />
                        Open Studio
                    </Button>
                </div>
            )}
        </Tabs>
    );
}
