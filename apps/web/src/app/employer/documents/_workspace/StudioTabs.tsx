"use client";

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ComponentType,
    type ReactNode,
} from "react";
import { Columns2, Plus, X } from "lucide-react";

import { ContextTarget } from "~/components/context-menu";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { cn } from "~/lib/utils";
import type { IconProps } from "./icons";

/** What a tab needs to draw itself. Studio features and sources both satisfy it. */

/** Below this, the strip's chrome drops to icons. */
const STRIP_COMPACT_BELOW_PX = 440;

export interface PaneTab {
    id: string;
    label: string;
    Icon: ComponentType<IconProps>;
    desc?: string;
}

export interface StudioTabsProps {
    /** The column this strip belongs to; drops from other columns land here. */
    groupId: string;
    /** Which column this is, and how many there are, for naming the controls. */
    index: number;
    groupCount: number;
    tabs: PaneTab[];
    activeId: string;
    /** The column the workspace considers current. Only one is, at a time. */
    focused: boolean;
    /** False when every column is taken, which greys the split control. */
    canSplit: boolean;
    /** False on a phone: no split control at all, in the strip or the tab's menu. */
    splittable?: boolean;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onCloseOthers: (id: string) => void;
    onCloseToRight: (id: string) => void;
    onSplit: (id: string) => void;
    /** A drop, from this strip or another: put `id` in front of `beforeId`. */
    onMove: (id: string, toGroupId: string, beforeId: string | null) => void;
    onOpenStudio: () => void;
    onFocus: () => void;
    /** The show-sidebar control, in the leftmost column only. */
    leadingSlot?: ReactNode;
    /**
     * The workspace's own controls — palette, Studio, avatar — in the
     * leftmost column only. They live here rather than in a pane's header so
     * they are drawn exactly once however the centre is split, and whatever
     * kind of pane happens to be leftmost.
     */
    trailingSlot?: ReactNode;
    /**
     * Called with the element each tab's panel should be rendered into. The
     * host renders the panes itself and portals them here, so that handing a
     * tab to another column does not tear its pane down and build it again.
     */
    registerSlot: (tabId: string, element: HTMLElement | null) => void;
    /** Shown in place of the panels when this column holds nothing. */
    emptyState?: ReactNode;
}

/** The id being dragged, shared across strips so a drop knows what it caught. */
const DRAG_MIME = "application/x-studio-tab";

/**
 * One column of the workspace centre: a strip of tabs over a panel.
 *
 * The strip is the segmented control the rest of the workspace uses — a
 * recessed bar with the current tab raised out of it — rather than the
 * underlined file tabs of a code editor, which nothing else here looks like.
 */
export function StudioTabs({
    groupId,
    index: groupIndex,
    groupCount,
    tabs,
    activeId,
    focused,
    canSplit,
    splittable = true,
    onSelect,
    onClose,
    onCloseOthers,
    onCloseToRight,
    onSplit,
    onMove,
    onOpenStudio,
    onFocus,
    leadingSlot,
    trailingSlot,
    registerSlot,
    emptyState,
}: StudioTabsProps) {
    const stripRef = useRef<HTMLDivElement>(null);
    /**
     * Whether this column's strip is too narrow for the workspace chrome at
     * full size. The first column carries the palette, Studio and the avatar,
     * about 190px on their own; at the 208px a column can be dragged to they
     * pushed the tabs out and ran past the column's edge.
     */
    const [stripCompact, setStripCompact] = useState(false);
    useEffect(() => {
        const element = stripRef.current;
        if (!element || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(([entry]) => {
            const width = entry?.contentRect.width ?? 0;
            if (width > 0) setStripCompact(width < STRIP_COMPACT_BELOW_PX);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
    const [dropAtEnd, setDropAtEnd] = useState(false);
    const [announcement, setAnnouncement] = useState("");

    const order = tabs.map(tab => tab.id).join("|");
    useEffect(() => {
        const el = stripRef.current?.querySelector<HTMLElement>(
            '[role="tab"][data-state="active"]'
        );
        // Optional call as well as optional chain: jsdom has no scrollIntoView.
        el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        // `order`, not the tab count: a reorder can push the active tab off
        // the edge of the strip without changing either it or the count.
    }, [activeId, order]);

    /**
     * Closing the focused tab must not drop focus onto `document.body` — that
     * would strand a keyboard user at the top of the page. Focus follows to
     * whichever tab took its place, or to the Studio button when the column
     * empties.
     */
    const closeTab = (id: string) => {
        const focusWasInStrip = stripRef.current?.contains(document.activeElement);
        onClose(id);
        if (!focusWasInStrip) return;
        requestAnimationFrame(() => {
            const target =
                stripRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ??
                stripRef.current?.querySelector<HTMLElement>("[data-studio-add]");
            target?.focus();
        });
    };

    /** Alt+Arrow: step one place, expressed as the neighbour to land in front of. */
    const moveByKeyboard = (tab: PaneTab, index: number, delta: -1 | 1) => {
        const to = index + delta;
        if (to < 0 || to > tabs.length - 1) return;
        const beforeId =
            delta === -1 ? (tabs[index - 1]?.id ?? null) : (tabs[index + 2]?.id ?? null);
        onMove(tab.id, groupId, beforeId);
        setAnnouncement(`${tab.label} moved to position ${to + 1} of ${tabs.length}`);
    };

    /** "Split to the right" reads the same in every column; the column has to say which. */
    const inColumn = (label: string) =>
        groupCount > 1 ? `${label}, column ${groupIndex + 1} of ${groupCount}` : label;

    const readDragId = (event: React.DragEvent) =>
        event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData("text/plain");

    return (
        <Tabs
            value={activeId}
            onValueChange={onSelect}
            // Pointer down rather than click: the column should be current
            // before whatever was clicked acts on it.
            onPointerDownCapture={onFocus}
            onFocusCapture={onFocus}
            className="bg-surface flex h-full min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
        >
            <div
                ref={stripRef}
                data-studio-tab-strip
                data-focused={focused}
                // Marks a narrow strip so the chrome in it — the palette's
                // ⌘K, the Studio label — can drop to icons with a CSS variant
                // instead of pushing the tabs out of the column.
                data-compact={stripCompact ? "true" : undefined}
                className="border-line bg-panel-2 group/strip flex h-10 shrink-0 items-center gap-1 border-b pl-1.5 pr-1"
            >
                {leadingSlot}
                <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain px-1">
                    <TabsList
                        aria-label={inColumn("Open apps")}
                        className="h-10 w-max min-w-full items-center justify-start gap-1 rounded-none bg-transparent p-0"
                    >
                        {tabs.map((tab, index) => {
                            const active = tab.id === activeId;
                            const Icon = tab.Icon;
                            return (
                                <ContextTarget
                                    key={tab.id}
                                    target={{
                                        kind: "studio-tab",
                                        id: tab.id,
                                        label: `Actions for ${tab.label}`,
                                        data: tab,
                                        items: () => [
                                            ...(splittable
                                                ? [
                                                      {
                                                          type: "item" as const,
                                                          id: "split",
                                                          label: "Split to the right",
                                                          icon: "split" as const,
                                                          disabled: !canSplit || tabs.length < 2,
                                                          disabledReason: !canSplit
                                                              ? "Every column is taken."
                                                              : "It is already the only tab here.",
                                                          onSelect: () => onSplit(tab.id),
                                                      },
                                                      { type: "separator" as const, id: "sep" },
                                                  ]
                                                : []),
                                            {
                                                type: "item",
                                                id: "close",
                                                label: "Close",
                                                icon: "close",
                                                onSelect: () => closeTab(tab.id),
                                            },
                                            {
                                                type: "item",
                                                id: "close-others",
                                                label: "Close the others",
                                                icon: "close",
                                                disabled: tabs.length < 2,
                                                disabledReason: "Nothing else is open here.",
                                                onSelect: () => onCloseOthers(tab.id),
                                            },
                                            {
                                                type: "item",
                                                id: "close-right",
                                                label: "Close everything to the right",
                                                icon: "close",
                                                disabled: index >= tabs.length - 1,
                                                disabledReason: "Nothing is to the right.",
                                                onSelect: () => onCloseToRight(tab.id),
                                            },
                                        ],
                                    }}
                                >
                                    <div
                                        role="presentation"
                                        className={cn(
                                            "group relative flex h-7 shrink-0 items-center rounded-md pr-1 transition-colors",
                                            active
                                                ? focused
                                                    ? "bg-brand-soft text-brand-ink"
                                                    : "bg-panel ring-line text-ink-2 ring-1"
                                                : "text-ink-3 hover:bg-line-2 hover:text-ink-2",
                                            dropTarget?.id === tab.id &&
                                                (dropTarget.after
                                                    ? "after:bg-brand after:absolute after:inset-y-0.5 after:right-0 after:w-0.5 after:rounded-full"
                                                    : "before:bg-brand before:absolute before:inset-y-0.5 before:left-0 before:w-0.5 before:rounded-full")
                                        )}
                                        draggable
                                        onDragStart={event => {
                                            event.dataTransfer.effectAllowed = "move";
                                            event.dataTransfer.setData(DRAG_MIME, tab.id);
                                            event.dataTransfer.setData("text/plain", tab.label);
                                        }}
                                        onDragOver={event => {
                                            if (!event.dataTransfer.types.includes(DRAG_MIME))
                                                return;
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "move";
                                            const rect =
                                                event.currentTarget.getBoundingClientRect();
                                            setDropAtEnd(false);
                                            setDropTarget({
                                                id: tab.id,
                                                after: event.clientX > rect.left + rect.width / 2,
                                            });
                                        }}
                                        onDragLeave={event => {
                                            // Also fires crossing into the
                                            // trigger or the close button.
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
                                            const dragged = readDragId(event);
                                            if (dragged) {
                                                const rect =
                                                    event.currentTarget.getBoundingClientRect();
                                                const after =
                                                    event.clientX > rect.left + rect.width / 2;
                                                onMove(
                                                    dragged,
                                                    groupId,
                                                    after ? (tabs[index + 1]?.id ?? null) : tab.id
                                                );
                                            }
                                            setDropTarget(null);
                                        }}
                                        onDragEnd={() => {
                                            setDropTarget(null);
                                            setDropAtEnd(false);
                                        }}
                                        onAuxClick={event => {
                                            if (event.button === 1) {
                                                event.preventDefault();
                                                closeTab(tab.id);
                                            }
                                        }}
                                    >
                                        <TabsTrigger
                                            value={tab.id}
                                            aria-setsize={tabs.length}
                                            aria-posinset={index + 1}
                                            title={`${tab.label}${tab.desc ? ` — ${tab.desc}` : ""}`}
                                            className={cn(
                                                "h-7 max-w-56 flex-none justify-start gap-1.5 rounded-md border-0 bg-transparent px-2.5 text-xs shadow-none",
                                                "data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent",
                                                active
                                                    ? cn(
                                                          "font-semibold",
                                                          focused
                                                              ? "text-brand-ink data-[state=active]:text-brand-ink dark:data-[state=active]:text-brand-ink"
                                                              : "text-ink-2 data-[state=active]:text-ink-2 dark:data-[state=active]:text-ink-2"
                                                      )
                                                    : "text-ink-3 font-medium"
                                            )}
                                            onKeyDown={event => {
                                                if (
                                                    event.altKey &&
                                                    (event.key === "ArrowLeft" ||
                                                        event.key === "ArrowRight")
                                                ) {
                                                    event.preventDefault();
                                                    // Radix moves selection on
                                                    // bare arrows; a reorder
                                                    // must not also navigate.
                                                    event.stopPropagation();
                                                    moveByKeyboard(
                                                        tab,
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
                                                    // also deletes the shapes
                                                    // behind it.
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    closeTab(tab.id);
                                                }
                                            }}
                                        >
                                            <Icon size={13} />
                                            <span className="truncate">{tab.label}</span>
                                        </TabsTrigger>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={cn(
                                                "hover:bg-line-2 hover:text-ink dark:hover:bg-line-2 dark:hover:text-ink size-5 rounded-sm transition-opacity",
                                                // Reached by mouse, or by
                                                // Delete on the tab; a stop of
                                                // its own would put one in
                                                // front of every tab.
                                                active
                                                    ? "opacity-100"
                                                    : "opacity-0 group-hover:opacity-100"
                                            )}
                                            tabIndex={-1}
                                            aria-hidden
                                            title={`Close ${tab.label}`}
                                            onPointerDown={event => event.stopPropagation()}
                                            onClick={() => closeTab(tab.id)}
                                        >
                                            <X className="size-3" />
                                        </Button>
                                    </div>
                                </ContextTarget>
                            );
                        })}
                        {/* Dropping past the last tab appends to this column. */}
                        <div
                            aria-hidden
                            className={cn(
                                "h-7 min-w-8 flex-1 rounded-md border border-dashed border-transparent transition-colors",
                                dropAtEnd && "border-brand bg-brand-soft"
                            )}
                            onDragOver={event => {
                                if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                                setDropTarget(null);
                                setDropAtEnd(true);
                            }}
                            onDragLeave={() => setDropAtEnd(false)}
                            onDrop={event => {
                                event.preventDefault();
                                const dragged = readDragId(event);
                                if (dragged) onMove(dragged, groupId, null);
                                setDropAtEnd(false);
                            }}
                        />
                    </TabsList>
                </div>
                {splittable && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-ink-3 hover:bg-line-2 hover:text-ink dark:hover:bg-line-2 dark:hover:text-ink size-7 shrink-0 rounded-md"
                        aria-label={inColumn("Split to the right")}
                        title="Split to the right"
                        disabled={!canSplit || tabs.length < 2}
                        onClick={() => activeId && onSplit(activeId)}
                    >
                        <Columns2 className="size-4" />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    data-studio-add
                    className="text-ink-3 hover:bg-line-2 hover:text-ink dark:hover:bg-line-2 dark:hover:text-ink size-7 shrink-0 rounded-md"
                    aria-label={inColumn("Open a Studio app")}
                    title="Open a Studio app"
                    onClick={onOpenStudio}
                >
                    <Plus className="size-4" />
                </Button>
                {trailingSlot}
            </div>
            <span role="status" aria-live="polite" className="sr-only">
                {announcement}
            </span>
            {tabs.length === 0 && emptyState}
            {tabs.map(tab => (
                <TabsContent
                    key={tab.id}
                    value={tab.id}
                    // `forceMount` keeps every open app rendered; `hidden`
                    // is ours because forceMount stops Radix setting it.
                    forceMount
                    hidden={tab.id !== activeId}
                    className="bg-surface min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=inactive]:hidden data-[state=active]:flex-col"
                >
                    <PaneSlot tabId={tab.id} register={registerSlot} />
                </TabsContent>
            ))}
        </Tabs>
    );
}

/**
 * Where one pane goes.
 *
 * The registration lives in a layout effect rather than on the `ref` prop
 * because an inline ref callback is a new function on every render, so React
 * would call it with null and then the element each pass — which, when the
 * host keeps the slots in state, never settles.
 */
function PaneSlot({
    tabId,
    register,
}: {
    tabId: string;
    register: (tabId: string, element: HTMLElement | null) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        register(tabId, ref.current);
        return () => register(tabId, null);
    }, [tabId, register]);

    return <div ref={ref} className="flex h-full min-h-0 min-w-0 flex-1 flex-col" />;
}
