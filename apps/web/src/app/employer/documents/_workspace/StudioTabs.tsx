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
type TabAction =
    | { type: "open"; id: string }
    | { type: "close"; id: string }
    | { type: "move"; id: string; index: number };

function reduceTabs(state: TabState, action: TabAction): TabState {
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
                        ? (ids[index] ?? ids[index - 1] ?? "")
                        : state.activeId,
            };
        }
        case "move": {
            if (index < 0) return state;
            const target = Math.max(0, Math.min(action.index, state.ids.length - 1));
            if (index === target) return state;
            const ids = [...state.ids];
            ids.splice(index, 1);
            ids.splice(target, 0, action.id);
            return { ...state, ids };
        }
    }
}

export function useStudioTabs() {
    const [state, dispatch] = useReducer(reduceTabs, { ids: ["chat"], activeId: "chat" });
    const open = useCallback((id: string) => dispatch({ type: "open", id }), []);
    const close = useCallback((id: string) => dispatch({ type: "close", id }), []);
    const move = useCallback(
        (id: string, index: number) => dispatch({ type: "move", id, index }),
        []
    );
    return { ...state, open, close, move };
}

interface StudioTabsProps {
    features: StudioFeature[];
    activeId: string;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onMove: (id: string, index: number) => void;
    onOpenStudio: () => void;
    leadingSlot?: ReactNode;
    children: (id: string) => ReactNode;
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

    useEffect(() => {
        stripRef.current
            ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [activeId, features.length]);

    const closeTab = (id: string) => {
        const focusWasInTab = stripRef.current?.contains(document.activeElement);
        onClose(id);
        if (focusWasInTab) {
            requestAnimationFrame(() => {
                const target =
                    stripRef.current?.querySelector<HTMLElement>(
                        '[role="tab"][data-state="active"]'
                    ) ??
                    stripRef.current?.querySelector<HTMLElement>('[aria-label="Open Studio apps"]');
                target?.focus();
            });
        }
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
                                    className={cn(
                                        "border-line group relative flex h-full shrink-0 items-center border-r border-t-2",
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
                                    onDragLeave={() => setDropTarget(null)}
                                    onDrop={event => {
                                        event.preventDefault();
                                        const id = draggedId.current;
                                        if (id) {
                                            const rect =
                                                event.currentTarget.getBoundingClientRect();
                                            const after =
                                                event.clientX > rect.left + rect.width / 2;
                                            const from = features.findIndex(item => item.id === id);
                                            onMove(
                                                id,
                                                index +
                                                    (after ? 1 : 0) -
                                                    (from < index + (after ? 1 : 0) ? 1 : 0)
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
                                        title={`${feature.label} — drag to reorder; Alt+Arrow to move; Delete to close`}
                                        className="text-ink-2 data-[state=active]:text-ink dark:data-[state=active]:text-ink h-full max-w-52 flex-none justify-start gap-2 rounded-none border-0 bg-transparent px-3 pr-1 text-xs shadow-none data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent"
                                        onKeyDown={event => {
                                            if (
                                                event.altKey &&
                                                (event.key === "ArrowLeft" ||
                                                    event.key === "ArrowRight")
                                            ) {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                const target = Math.max(
                                                    0,
                                                    Math.min(
                                                        features.length - 1,
                                                        index + (event.key === "ArrowLeft" ? -1 : 1)
                                                    )
                                                );
                                                onMove(feature.id, target);
                                                setAnnouncement(
                                                    `${feature.label} moved to position ${target + 1} of ${features.length}`
                                                );
                                            } else if (event.key === "Delete") {
                                                event.preventDefault();
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
            <span role="status" className="sr-only">
                {announcement}
            </span>
            {features.map(feature => (
                <TabsContent
                    key={feature.id}
                    value={feature.id}
                    forceMount
                    hidden={feature.id !== activeId}
                    className="bg-surface min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=inactive]:hidden data-[state=active]:flex-col"
                >
                    {children(feature.id)}
                </TabsContent>
            ))}
            {features.length === 0 && (
                <div className="bg-surface text-ink-3 flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                    <PanelsTopLeft className="text-ink-3 size-9" strokeWidth={1.25} />
                    <h2 className="text-ink text-base font-medium">
                        Your workspace, ready when you are
                    </h2>
                    <p className="max-w-sm text-sm">
                        Open an app from Studio to get started. Closing a tab doesn’t delete your
                        saved work.
                    </p>
                    <Button variant="outline" onClick={onOpenStudio}>
                        <Plus className="size-4" />
                        Open Studio
                    </Button>
                </div>
            )}
        </Tabs>
    );
}
