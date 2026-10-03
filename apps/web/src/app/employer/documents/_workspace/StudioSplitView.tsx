"use client";

import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "~/lib/utils";
import { StudioTabs, type PaneTab } from "./StudioTabs";
import { SOURCE_DRAG_MIME, droppedTabId, isPaneDrag } from "./dragData";
import {
    MAX_GROUPS,
    groupOf,
    openTabIds,
    type PaneGroup,
    type PaneLayout,
    type SplitSide,
} from "./paneLayout";
import {
    FULL_FRAME,
    dividerStyle,
    dragSizes,
    frameStyle,
    layoutFrames,
    type DividerFrame,
    type SizesDraft,
} from "./paneFrames";

export interface StudioSplitViewProps {
    layout: PaneLayout;
    /** Resolves a tab id to what the strip draws. Unknown ids are dropped. */
    tabFor: (id: string) => PaneTab | undefined;
    /**
     * The pane itself. It takes no "is it active" flag on purpose: with
     * several panes there is one visible tab per pane and only one focused
     * one, and a single boolean was read as both. The host owns the layout
     * and answers those questions from it.
     */
    renderPane: (id: string) => ReactNode;
    onSelect: (id: string) => void;
    onClose: (groupId: string, id: string) => void;
    onCloseOthers: (groupId: string, id: string) => void;
    onCloseToRight: (groupId: string, id: string) => void;
    /**
     * Give a tab a pane of its own on `side` of `targetGroupId` (default: its
     * own). The id may not be open yet — a source dropped from the sidebar.
     */
    onSplit: (id: string, side: SplitSide, targetGroupId?: string) => void;
    /** The same, along a whole side of the workspace. */
    onSplitRoot: (id: string, side: SplitSide) => void;
    /** A new, empty pane on `side` of this one. */
    onSplitPane: (groupId: string, side: SplitSide) => void;
    /** Close a pane and everything in it. */
    onCloseGroup: (groupId: string) => void;
    onToggleZoom: (groupId: string) => void;
    /** A divider settled: new shares for the children of `splitId`. */
    onResize: (splitId: string, sizes: number[]) => void;
    onMove: (id: string, toGroupId: string, beforeId: string | null) => void;
    onFocusGroup: (groupId: string) => void;
    onOpenStudio: () => void;
    /** The show-sidebar control, which belongs to the first pane only. */
    leadingSlot?: ReactNode;
    /** Palette, Studio and avatar — drawn once, in the first pane. */
    trailingSlot?: ReactNode;
    /** Shown in a pane that holds nothing — the whole workspace, or one split off to fill. */
    renderEmpty: (groupId: string) => ReactNode;
    /**
     * False on a phone, where panes cannot sit side by side. The split
     * controls are then not offered at all, rather than shown disabled with
     * a reason about panes that would make no sense there.
     */
    splittable?: boolean;
    /** The key for Studio's picker, for the "+" tooltips. */
    studioKeys?: string | null;
    /** The member's keys for the pane verbs, shown in each pane's menu. */
    paneKeys?: { splitRight?: string | null; splitDown?: string | null; zoom?: string | null };
}

/**
 * Below these a pane's strip cannot show one tab and its controls, so a
 * divider stops there.
 */
const MIN_PANE_PX = { row: 240, column: 140 } as const;

/** A keyboard nudge, as a share of the split: 2%, or 10% with Shift. */
const KEY_STEP = 0.02;
const KEY_STEP_LARGE = 0.1;

/** How far in from a pane's edge a dropped tab splits rather than joins. */
const EDGE_ZONE = 0.25;

/**
 * The band along the workspace's own edges where a drop makes a pane the
 * whole height or width, rather than splitting the pane underneath.
 */
const ROOT_EDGE_PX = 24;

type DropZone = SplitSide | "center";

/** Which of a pane's drop zones are open: its middle, and which of its sides. */
interface ZoneSet {
    center: boolean;
    row: boolean;
    column: boolean;
}

/** What is being dragged over the panes, while something is. */
type PaneDrag = { kind: "tab"; id: string } | { kind: "source" };

/**
 * The workspace centre: panes arranged by the split tree, each its own strip
 * of tabs.
 *
 * Panes are NOT rendered inside their pane's slot. Each one lives in a
 * container of its own that this component creates once and then moves, with
 * appendChild, into whichever pane currently shows it. That looks roundabout
 * and is the point: a tab handed to another pane keeps its React state, its
 * scroll position, its focus and its undo history, because neither the React
 * tree above it nor the DOM node under it is ever rebuilt.
 *
 * Portalling straight into the pane's own slot would not do. React compares a
 * portal's container when it reconciles, so changing it tears the subtree
 * down and builds a new one — which is exactly the thing tabs exist to avoid.
 *
 * For the same reason the panes themselves are siblings placed by the tree's
 * frames (see paneFrames), not containers nested the way the tree is.
 */
export function StudioSplitView({
    layout,
    tabFor,
    renderPane,
    onSelect,
    onClose,
    onCloseOthers,
    onCloseToRight,
    onSplit,
    onSplitRoot,
    onSplitPane,
    onCloseGroup,
    onToggleZoom,
    onResize,
    onMove,
    onFocusGroup,
    onOpenStudio,
    leadingSlot,
    trailingSlot,
    renderEmpty,
    splittable = true,
    studioKeys,
    paneKeys,
}: StudioSplitViewProps) {
    /** Where each pane wants its current tab's content put. */
    const [slots, setSlots] = useState<Record<string, HTMLElement | null>>({});
    /** One stable host node per open tab, created once and reparented after. */
    const hosts = useRef(new Map<string, HTMLDivElement>());
    const rootRef = useRef<HTMLDivElement>(null);
    const paneCount = useRef(layout.groups.length);

    /** A divider being dragged: its shares move here and commit on release. */
    const [draft, setDraft] = useState<SizesDraft | null>(null);
    const draftRef = useRef<SizesDraft | null>(null);
    const dividerDrag = useRef<{
        divider: DividerFrame;
        start: number;
        lengthPx: number;
    } | null>(null);
    /**
     * Hosts are DOM nodes and portals do not render on the server, so the
     * panes arrive with the first client commit rather than in the HTML. The
     * flag lives here, not in PanePortals, so that the render it causes also
     * runs the effect below that puts each host in its slot.
     */
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    /** What is being dragged, while something is — which is when panes show drop zones. */
    const [drag, setDrag] = useState<PaneDrag | null>(null);
    const dragLive = useRef(false);
    /** The centre's size, for refusing splits that would leave a pane too small to use. */
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(([entry]) => {
            if (!entry) return;
            const { width, height } = entry.contentRect;
            setSize(prev =>
                prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
                    ? prev
                    : { width, height }
            );
        });
        observer.observe(root);
        return () => observer.disconnect();
    }, []);

    /**
     * Show the drop zones for a drag once it is under way. Changing the page
     * inside `dragstart` can make Chrome cancel the drag, so this waits a
     * tick — and checks the drag is still live when it comes.
     */
    const beginDrag = useCallback((next: PaneDrag) => {
        dragLive.current = true;
        window.setTimeout(() => {
            if (dragLive.current) setDrag(next);
        }, 0);
    }, []);

    // A source dragged out of the sidebar is a drag the panes can take too;
    // the sidebar knows nothing of panes, so its drags are noticed here.
    useEffect(() => {
        const onDragStart = (event: DragEvent) => {
            const types = [...(event.dataTransfer?.types ?? [])];
            if (types.includes(SOURCE_DRAG_MIME)) beginDrag({ kind: "source" });
        };
        document.addEventListener("dragstart", onDragStart);
        return () => document.removeEventListener("dragstart", onDragStart);
    }, [beginDrag]);

    const { panes: frames, dividers } = useMemo(
        () => layoutFrames(layout.root, draft),
        [layout.root, draft]
    );

    /**
     * A pane's strip tries to move focus when a tab closes, but when the last
     * tab goes the whole pane goes with it and focus lands on the body. This
     * outlives the pane, so it can hand focus to whichever one took over —
     * and only then, so a page load is left alone.
     */
    useLayoutEffect(() => {
        const shrank = layout.groups.length < paneCount.current;
        paneCount.current = layout.groups.length;
        if (!shrank) return;
        if (document.activeElement && document.activeElement !== document.body) return;
        const strip = rootRef.current?.querySelector<HTMLElement>(
            '[data-studio-tab-strip][data-focused="true"]'
        );
        const target =
            strip?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ??
            strip?.querySelector<HTMLElement>("[data-studio-add]");
        target?.focus();
    }, [layout.groups.length, layout.activeGroupId]);

    /**
     * A drag ends on the tab it started from, but a drop that moved that tab
     * has already taken it out of the page, and its `dragend` goes nowhere.
     * The drop itself always lands in the page, so either one ends it.
     *
     * The zones go a tick later, never here. These listeners run in the
     * capture phase, before the drop reaches its target, and for a real drag
     * the browser lets React apply updates between listeners: clearing the
     * zones here removed them before their own drop handler could run, and
     * every drop did nothing. (A drag simulated from a script flushes only
     * afterwards, which is why only a real mouse showed it.)
     */
    useEffect(() => {
        if (!drag) return;
        const end = () => {
            dragLive.current = false;
            window.setTimeout(() => {
                if (!dragLive.current) setDrag(null);
            }, 0);
        };
        window.addEventListener("drop", end, true);
        window.addEventListener("dragend", end, true);
        return () => {
            window.removeEventListener("drop", end, true);
            window.removeEventListener("dragend", end, true);
        };
    }, [drag]);

    const registerSlot = useCallback((tabId: string, element: HTMLElement | null) => {
        setSlots(prev => (prev[tabId] === element ? prev : { ...prev, [tabId]: element }));
    }, []);

    const claimPane = useCallback(
        (tabId: string) => {
            const group = groupOf(layout, tabId);
            if (group && group.id !== layout.activeGroupId) onFocusGroup(group.id);
        },
        [layout, onFocusGroup]
    );

    const hostFor = useCallback((tabId: string) => {
        let host = hosts.current.get(tabId);
        if (!host) {
            host = document.createElement("div");
            // A size container, so what is inside can fit the pane rather
            // than the window: the `@max-sm:`-style variants in
            // tailwind.config.ts query it.
            host.className =
                "flex h-full min-h-0 min-w-0 flex-1 flex-col [container-type:inline-size]";
            hosts.current.set(tabId, host);
        }
        return host;
    }, []);

    // Every open tab, named or not. A tab the workspace cannot currently
    // name — a source mid-refresh — is kept off the strip but keeps its pane,
    // because one unlucky render must not destroy someone's work.
    const ids = useMemo(() => openTabIds(layout), [layout]);

    // Move each host under the pane showing it, and drop the hosts of tabs
    // that have closed so a reopened tab starts clean rather than resurrected.
    useLayoutEffect(() => {
        for (const id of ids) {
            const slot = slots[id];
            const host = hosts.current.get(id);
            if (!slot || !host || host.parentElement === slot) continue;

            // Taking a node out of the document blurs whatever was focused in
            // it, resets every scroller inside and reloads every frame.
            // `moveBefore` moves it without that (Chrome 133+), but only for a
            // node already in the document — on the first mount it throws —
            // so it is tried and the manual restore below is the fallback.
            const moveBefore = (slot as { moveBefore?: (node: Node, ref: Node | null) => void })
                .moveBefore;
            if (typeof moveBefore === "function" && host.isConnected) {
                try {
                    moveBefore.call(slot, host, null);
                    continue;
                } catch {
                    // Not a move the browser can make state-preserving.
                }
            }
            const focused = host.contains(document.activeElement)
                ? (document.activeElement as HTMLElement)
                : null;
            const scrolled = [...host.querySelectorAll<HTMLElement>("*")]
                .filter(el => el.scrollTop || el.scrollLeft)
                .map(el => ({ el, top: el.scrollTop, left: el.scrollLeft }));
            slot.appendChild(host);
            for (const { el, top, left } of scrolled) {
                el.scrollTop = top;
                el.scrollLeft = left;
            }
            focused?.focus({ preventScroll: true });
        }
        const open = new Set(ids);
        for (const [id, host] of hosts.current) {
            if (!open.has(id)) {
                host.remove();
                hosts.current.delete(id);
            }
        }
    });

    const setDraftSizes = (next: SizesDraft | null) => {
        draftRef.current = next;
        setDraft(next);
    };

    /** The divider's split, in pixels along its axis, and the smallest share a pane may take of it. */
    const measure = (divider: DividerFrame) => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const lengthPx =
            divider.axis === "row"
                ? rect.width * divider.split.width
                : rect.height * divider.split.height;
        if (lengthPx <= 0) return null;
        return { lengthPx, min: MIN_PANE_PX[divider.axis] / lengthPx };
    };

    const startDividerDrag = (divider: DividerFrame, event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        const measured = measure(divider);
        if (!measured) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dividerDrag.current = {
            divider,
            start: divider.axis === "row" ? event.clientX : event.clientY,
            lengthPx: measured.lengthPx,
        };
        setDraftSizes({ splitId: divider.splitId, sizes: divider.sizes });
    };

    const moveDividerDrag = (event: ReactPointerEvent<HTMLElement>) => {
        const drag = dividerDrag.current;
        if (!drag) return;
        const position = drag.divider.axis === "row" ? event.clientX : event.clientY;
        setDraftSizes({
            splitId: drag.divider.splitId,
            sizes: dragSizes(
                drag.divider.sizes,
                drag.divider.index,
                (position - drag.start) / drag.lengthPx,
                MIN_PANE_PX[drag.divider.axis] / drag.lengthPx
            ),
        });
    };

    const endDividerDrag = () => {
        if (!dividerDrag.current) return;
        dividerDrag.current = null;
        const settled = draftRef.current;
        setDraftSizes(null);
        if (settled) onResize(settled.splitId, settled.sizes);
    };

    const nudgeDivider = (divider: DividerFrame, event: ReactKeyboardEvent<HTMLElement>) => {
        const back = divider.axis === "row" ? "ArrowLeft" : "ArrowUp";
        const forward = divider.axis === "row" ? "ArrowRight" : "ArrowDown";
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        const measured = measure(divider);
        const step = (event.shiftKey ? KEY_STEP_LARGE : KEY_STEP) * (event.key === back ? -1 : 1);
        onResize(
            divider.splitId,
            dragSizes(divider.sizes, divider.index, step, measured?.min ?? 0.1)
        );
    };

    /** Double-click: the two panes either side share the space evenly. */
    const evenDivider = (divider: DividerFrame) => {
        const first = divider.sizes[divider.index] ?? 0;
        const second = divider.sizes[divider.index + 1] ?? 0;
        onResize(divider.splitId, dragSizes(divider.sizes, divider.index, (second - first) / 2, 0));
    };

    /**
     * Why a pane cannot be halved each way, or null where it can: a split
     * that would leave either half narrower (or shorter) than a strip needs
     * is refused up front rather than made and left unusable.
     */
    const roomIn = (group: PaneGroup): { right: string | null; down: string | null } => {
        const frame = frames.get(group.id);
        if (!size || !frame) return { right: null, down: null };
        return {
            right:
                (size.width * frame.width) / 2 < MIN_PANE_PX.row
                    ? "Too narrow to split side by side."
                    : null,
            down:
                (size.height * frame.height) / 2 < MIN_PANE_PX.column
                    ? "Too short to split top and bottom."
                    : null,
        };
    };

    /** Which drop zones a pane offers what is being dragged. */
    const zonesFor = (group: PaneGroup): ZoneSet | null => {
        if (!drag) return null;
        const room = roomIn(group);
        const sides = (canGrow: boolean): ZoneSet => ({
            center: true,
            row: splittable && canGrow && room.right === null,
            column: splittable && canGrow && room.down === null,
        });
        // A source is not open anywhere: it can join any pane or split it.
        if (drag.kind === "source") return sides(layout.groups.length < MAX_GROUPS);
        const from = groupOf(layout, drag.id);
        if (!from) return null;
        if (from.id === group.id) {
            // Alone in its pane, a tab has nowhere in that pane to go.
            if (from.tabIds.length < 2) return null;
            return sides(layout.groups.length < MAX_GROUPS);
        }
        return sides(layout.groups.length < MAX_GROUPS || from.tabIds.length === 1);
    };

    /** Whether the workspace's own edges take a drop — a pane the whole height or width. */
    const rootZones = (() => {
        if (!drag || !splittable || layout.groups.length < 2 || layout.zoomedGroupId) return false;
        if (drag.kind === "source") return layout.groups.length < MAX_GROUPS;
        const from = groupOf(layout, drag.id);
        return Boolean(from) && (layout.groups.length < MAX_GROUPS || from!.tabIds.length === 1);
    })();

    const zoomedId = layout.zoomedGroupId;

    return (
        <div ref={rootRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {layout.groups.map((group, index) => {
                const zoomed = zoomedId === group.id;
                const behindZoom = zoomedId !== null && !zoomed;
                const frame = zoomed ? FULL_FRAME : (frames.get(group.id) ?? FULL_FRAME);
                const tabs = group.tabIds.flatMap(id => {
                    const tab = tabFor(id);
                    return tab ? [tab] : [];
                });
                const zones = behindZoom ? null : zonesFor(group);
                const room = roomIn(group);
                return (
                    <div
                        key={group.id}
                        data-studio-pane={group.id}
                        className={cn(
                            "absolute flex min-h-0 min-w-0 flex-col overflow-hidden",
                            zoomed && "z-10",
                            // Hidden, not unmounted: every tab stays alive
                            // behind a zoom, and `invisible` also takes the
                            // pane out of the tab order.
                            behindZoom && "invisible"
                        )}
                        style={frameStyle(frame)}
                    >
                        <StudioTabs
                            groupId={group.id}
                            index={index}
                            groupCount={layout.groups.length}
                            tabs={tabs}
                            activeId={
                                tabs.some(tab => tab.id === group.activeId)
                                    ? group.activeId
                                    : (tabs[0]?.id ?? "")
                            }
                            focused={group.id === layout.activeGroupId}
                            canSplit={splittable && layout.groups.length < MAX_GROUPS}
                            splitRefusal={room}
                            splittable={splittable}
                            zoomed={zoomed}
                            studioKeys={studioKeys}
                            paneKeys={paneKeys}
                            onSelect={onSelect}
                            onClose={id => onClose(group.id, id)}
                            onCloseOthers={id => onCloseOthers(group.id, id)}
                            onCloseToRight={id => onCloseToRight(group.id, id)}
                            onSplit={(id, side) => onSplit(id, side)}
                            onSplitPane={side => onSplitPane(group.id, side)}
                            onClosePane={() => onCloseGroup(group.id)}
                            onToggleZoom={() => onToggleZoom(group.id)}
                            onMove={onMove}
                            onDragTab={id => {
                                if (id) beginDrag({ kind: "tab", id });
                                else {
                                    dragLive.current = false;
                                    setDrag(null);
                                }
                            }}
                            onOpenStudio={() => {
                                onFocusGroup(group.id);
                                onOpenStudio();
                            }}
                            onFocus={() => onFocusGroup(group.id)}
                            leadingSlot={index === 0 ? leadingSlot : undefined}
                            trailingSlot={index === 0 ? trailingSlot : undefined}
                            registerSlot={registerSlot}
                            emptyState={renderEmpty(group.id)}
                        />
                        {zones && (
                            <PaneDropZones
                                groupId={group.id}
                                zones={zones}
                                onDropTab={(id, zone) => {
                                    if (zone === "center") onMove(id, group.id, null);
                                    else onSplit(id, zone, group.id);
                                }}
                            />
                        )}
                    </div>
                );
            })}

            {zoomedId === null &&
                dividers.map(divider => {
                    const first = divider.sizes[divider.index] ?? 0;
                    const second = divider.sizes[divider.index + 1] ?? 0;
                    const dragging =
                        draft?.splitId === divider.splitId &&
                        dividerDrag.current?.divider.index === divider.index;
                    return (
                        <div
                            key={`${divider.splitId}:${divider.index}`}
                            role="separator"
                            tabIndex={0}
                            data-studio-divider={divider.axis}
                            aria-orientation={divider.axis === "row" ? "vertical" : "horizontal"}
                            aria-label={
                                divider.axis === "row"
                                    ? "Resize the panes either side"
                                    : "Resize the panes above and below"
                            }
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round((first / (first + second || 1)) * 100)}
                            title="Drag to resize · double-click to even out"
                            className={cn(
                                "group absolute flex touch-none items-center justify-center outline-none",
                                divider.axis === "row"
                                    ? "w-2 -translate-x-1/2 cursor-col-resize"
                                    : "h-2 -translate-y-1/2 cursor-row-resize"
                            )}
                            style={dividerStyle(divider)}
                            onPointerDown={event => startDividerDrag(divider, event)}
                            onPointerMove={moveDividerDrag}
                            onPointerUp={endDividerDrag}
                            onPointerCancel={endDividerDrag}
                            onLostPointerCapture={endDividerDrag}
                            onKeyDown={event => nudgeDivider(divider, event)}
                            onDoubleClick={() => evenDivider(divider)}
                        >
                            <span
                                aria-hidden
                                className={cn(
                                    "group-hover:bg-brand-hi group-focus-visible:bg-brand transition-colors",
                                    divider.axis === "row" ? "h-full w-px" : "h-px w-full",
                                    dragging ? "bg-brand" : "bg-line"
                                )}
                            />
                        </div>
                    );
                })}

            {/* While a divider is dragged, nothing under the pointer — a
                document's frame above all — may take the pointer from it. */}
            {draft && (
                <div
                    aria-hidden
                    className={cn(
                        "fixed inset-0 z-50",
                        dividers.find(divider => divider.splitId === draft.splitId)?.axis ===
                            "column"
                            ? "cursor-row-resize"
                            : "cursor-col-resize"
                    )}
                />
            )}

            {rootZones && <RootDropZones onDrop={(id, side) => onSplitRoot(id, side)} />}

            {mounted && (
                <PanePortals
                    ids={ids}
                    renderPane={renderPane}
                    hostFor={hostFor}
                    claim={claimPane}
                />
            )}
        </div>
    );
}

/**
 * The panes' content, portalled into their hosts. Kept apart and memoised so
 * that dragging a divider — which re-renders the frames many times a second —
 * does not re-render every open app with it.
 */
const PanePortals = memo(function PanePortals({
    ids,
    renderPane,
    hostFor,
    claim,
}: {
    ids: string[];
    renderPane: (id: string) => ReactNode;
    hostFor: (id: string) => HTMLDivElement;
    claim: (id: string) => void;
}) {
    return (
        <>
            {ids.map(id =>
                createPortal(
                    <div
                        className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
                        // The pane is portalled, so events in it reach this
                        // component rather than its pane. Tell the layout
                        // which pane was touched — by pointer or by Tab,
                        // since the pane verbs act on the focused one.
                        onPointerDownCapture={() => claim(id)}
                        onFocusCapture={() => claim(id)}
                    >
                        {renderPane(id)}
                    </div>,
                    hostFor(id),
                    id
                )
            )}
        </>
    );
});

const ZONE_FRAME: Record<DropZone, string> = {
    center: "inset-2",
    left: "inset-y-2 left-2 right-1/2",
    right: "inset-y-2 right-2 left-1/2",
    up: "inset-x-2 top-2 bottom-1/2",
    down: "inset-x-2 bottom-2 top-1/2",
};

const ZONE_LABEL: Record<DropZone, string> = {
    center: "Open here",
    left: "Split left",
    right: "Split right",
    up: "Split up",
    down: "Split down",
};

/** The drop highlight: where the thing being dragged would go, and what it would do. */
function DropPreview({ frame, label }: { frame: string; label: string }) {
    return (
        <div
            className={cn(
                "border-brand bg-brand-soft/70 text-brand-ink pointer-events-none absolute flex items-center justify-center rounded-md border-2 border-dashed text-xs font-medium transition-all duration-100",
                frame
            )}
        >
            {label}
        </div>
    );
}

/** Accept a drag that a pane can take, and read what it was on the drop. */
function acceptPaneDrag(event: React.DragEvent<HTMLElement>): boolean {
    if (!isPaneDrag([...event.dataTransfer.types])) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    return true;
}

/**
 * What a pane offers something dragged over it, as cmux does: its outer
 * quarter on each side splits the pane that way, and the middle takes it in
 * as one more tab. Tabs and sources from the sidebar both land here. It
 * covers the pane's content — so a document's frame cannot swallow the
 * drag — but not its strip, which keeps its own finer targets for ordering.
 */
function PaneDropZones({
    groupId,
    zones,
    onDropTab,
}: {
    groupId: string;
    /** Which zones are open: sides close when the pane is full or too small to halve. */
    zones: ZoneSet;
    onDropTab: (id: string, zone: DropZone) => void;
}) {
    const [zone, setZone] = useState<DropZone | null>(null);

    const zoneAt = (event: React.DragEvent<HTMLElement>): DropZone => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const edges: [SplitSide, number][] = [
            ...(zones.row
                ? ([
                      ["left", x],
                      ["right", 1 - x],
                  ] as [SplitSide, number][])
                : []),
            ...(zones.column
                ? ([
                      ["up", y],
                      ["down", 1 - y],
                  ] as [SplitSide, number][])
                : []),
        ];
        const nearest = edges.reduce<[SplitSide, number] | null>(
            (near, edge) => (!near || edge[1] < near[1] ? edge : near),
            null
        );
        return nearest && nearest[1] < EDGE_ZONE ? nearest[0] : "center";
    };

    return (
        <div
            data-studio-drop-zone={groupId}
            className="absolute inset-x-0 bottom-0 top-10 z-30"
            onDragOver={event => {
                if (acceptPaneDrag(event)) setZone(zoneAt(event));
            }}
            onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setZone(null);
            }}
            onDrop={event => {
                event.preventDefault();
                const id = droppedTabId(event.dataTransfer);
                const landed = zoneAt(event);
                setZone(null);
                if (id) onDropTab(id, landed);
            }}
        >
            {zone && <DropPreview frame={ZONE_FRAME[zone]} label={ZONE_LABEL[zone]} />}
        </div>
    );
}

/**
 * Below the top strips (`top-10`, the strip's height), so a tab dropped on a
 * strip to reorder it is never taken for a full-width split.
 */
const ROOT_BAND: Record<SplitSide, string> = {
    left: "top-10 bottom-0 left-0",
    right: "top-10 bottom-0 right-0",
    up: "inset-x-0 top-10",
    down: "inset-x-0 bottom-0",
};

const ROOT_PREVIEW: Record<SplitSide, string> = {
    left: "inset-y-2 left-2 w-1/3",
    right: "inset-y-2 right-2 w-1/3",
    up: "inset-x-2 top-2 h-1/3",
    down: "inset-x-2 bottom-2 h-1/3",
};

const ROOT_LABEL: Record<SplitSide, string> = {
    left: "Full height, on the left",
    right: "Full height, on the right",
    up: "Full width, along the top",
    down: "Full width, along the bottom",
};

/**
 * Bands along the workspace's own edges. Dropping on one makes a pane that
 * spans that whole side — beside every column rather than inside one — the
 * way an editor's outer drop targets do. They sit above the panes' own
 * zones, and are narrow, so the pane's edge is still where most drops land.
 */
function RootDropZones({ onDrop }: { onDrop: (id: string, side: SplitSide) => void }) {
    const [side, setSide] = useState<SplitSide | null>(null);
    return (
        <>
            {side && (
                <DropPreview frame={cn("z-40", ROOT_PREVIEW[side])} label={ROOT_LABEL[side]} />
            )}
            {(["left", "right", "up", "down"] as const).map(edge => (
                <div
                    key={edge}
                    data-studio-root-drop={edge}
                    className={cn("absolute z-40", ROOT_BAND[edge])}
                    style={
                        edge === "left" || edge === "right"
                            ? { width: ROOT_EDGE_PX }
                            : { height: ROOT_EDGE_PX }
                    }
                    onDragOver={event => {
                        if (acceptPaneDrag(event)) setSide(edge);
                    }}
                    onDragLeave={() => setSide(current => (current === edge ? null : current))}
                    onDrop={event => {
                        event.preventDefault();
                        const id = droppedTabId(event.dataTransfer);
                        setSide(null);
                        if (id) onDrop(id, edge);
                    }}
                />
            ))}
        </>
    );
}
