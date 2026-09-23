"use client";

import { Fragment, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { StudioTabs, type PaneTab } from "./StudioTabs";
import { MAX_GROUPS, groupOf, openTabIds, type PaneLayout } from "./paneLayout";

export interface StudioSplitViewProps {
    layout: PaneLayout;
    /** Resolves a tab id to what the strip draws. Unknown ids are dropped. */
    tabFor: (id: string) => PaneTab | undefined;
    /**
     * The pane itself. It takes no "is it active" flag on purpose: with
     * columns there is one visible pane per column and only one focused one,
     * and a single boolean was read as both. The host owns the layout and
     * answers those questions from it.
     */
    renderPane: (id: string) => ReactNode;
    onSelect: (id: string) => void;
    onClose: (groupId: string, id: string) => void;
    onCloseOthers: (groupId: string, id: string) => void;
    onCloseToRight: (groupId: string, id: string) => void;
    onSplit: (id: string) => void;
    onMove: (id: string, toGroupId: string, beforeId: string | null) => void;
    onFocusGroup: (groupId: string) => void;
    onOpenStudio: () => void;
    /** The show-sidebar control, which belongs to the leftmost column only. */
    leadingSlot?: ReactNode;
    /** Palette, Studio and avatar — drawn once, in the leftmost column. */
    trailingSlot?: ReactNode;
    /** Shown when nothing at all is open. */
    emptyState: ReactNode;
    /**
     * False on a phone, where columns cannot sit side by side. The split
     * control is then not offered at all, rather than shown disabled with a
     * reason about columns that would make no sense there.
     */
    splittable?: boolean;
}

/**
 * The workspace centre: columns side by side, each its own strip of tabs.
 *
 * Panes are NOT rendered inside their column. Each one lives in a container of
 * its own that this component creates once and then moves, with appendChild,
 * into whichever column currently shows it. That looks roundabout and is the
 * point: a pane handed to another column keeps its React state, its scroll
 * position, its focus and its undo history, because neither the React tree
 * above it nor the DOM node under it is ever rebuilt.
 *
 * Portalling straight into the column's own slot would not do. React compares
 * a portal's container when it reconciles, so changing it tears the subtree
 * down and builds a new one — which is exactly the thing tabs exist to avoid.
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
    onMove,
    onFocusGroup,
    onOpenStudio,
    leadingSlot,
    trailingSlot,
    emptyState,
    splittable = true,
}: StudioSplitViewProps) {
    /** Where each column wants its current pane put. */
    const [slots, setSlots] = useState<Record<string, HTMLElement | null>>({});
    /** One stable host node per open tab, created once and reparented after. */
    const hosts = useRef(new Map<string, HTMLDivElement>());
    const rootRef = useRef<HTMLDivElement>(null);
    const columnCount = useRef(layout.groups.length);

    /**
     * A column's strip tries to move focus when a tab closes, but when the
     * last tab goes the whole strip goes with it and focus lands on the body.
     * This outlives the column, so it can hand focus to whichever one took
     * over — and only then, so a page load is left alone.
     */
    useLayoutEffect(() => {
        const shrank = layout.groups.length < columnCount.current;
        columnCount.current = layout.groups.length;
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

    const registerSlot = useCallback((tabId: string, element: HTMLElement | null) => {
        setSlots(prev => (prev[tabId] === element ? prev : { ...prev, [tabId]: element }));
    }, []);

    const claimColumn = (tabId: string) => {
        const group = groupOf(layout, tabId);
        if (group && group.id !== layout.activeGroupId) onFocusGroup(group.id);
    };

    const hostFor = (tabId: string) => {
        let host = hosts.current.get(tabId);
        if (!host) {
            host = document.createElement("div");
            host.className = "flex h-full min-h-0 min-w-0 flex-1 flex-col";
            hosts.current.set(tabId, host);
        }
        return host;
    };

    // Every open tab, named or not. A tab the workspace cannot currently
    // name — a source mid-refresh — is kept off the strip but keeps its pane,
    // because one unlucky render must not destroy someone's work.
    const ids = openTabIds(layout);

    // Move each host under the column showing it, and drop the hosts of tabs
    // that have closed so a reopened tab starts clean rather than resurrected.
    useLayoutEffect(() => {
        for (const id of ids) {
            const slot = slots[id];
            const host = hosts.current.get(id);
            if (!slot || !host || host.parentElement === slot) continue;

            // Taking a node out of the document blurs whatever was focused in
            // it and resets every scroller inside. `moveBefore` moves it
            // without that (Chrome 133+), but only for a node already in the
            // document — on the first mount it throws — so it is tried and
            // the manual restore below is the fallback.
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

    return (
        <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1">
            <ResizablePanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1">
                {layout.groups.map((group, index) => {
                    const tabs = group.tabIds.flatMap(id => {
                        const tab = tabFor(id);
                        return tab ? [tab] : [];
                    });
                    return (
                        <Fragment key={group.id}>
                            {index > 0 && <ResizableHandle withHandle />}
                            <ResizablePanel
                                id={group.id}
                                order={index}
                                defaultSize={100 / layout.groups.length}
                                minSize={18}
                                className="flex min-h-0 min-w-0 flex-col"
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
                                    splittable={splittable}
                                    onSelect={onSelect}
                                    onClose={id => onClose(group.id, id)}
                                    onCloseOthers={id => onCloseOthers(group.id, id)}
                                    onCloseToRight={id => onCloseToRight(group.id, id)}
                                    onSplit={onSplit}
                                    onMove={onMove}
                                    onOpenStudio={() => {
                                        onFocusGroup(group.id);
                                        onOpenStudio();
                                    }}
                                    onFocus={() => onFocusGroup(group.id)}
                                    leadingSlot={index === 0 ? leadingSlot : undefined}
                                    trailingSlot={index === 0 ? trailingSlot : undefined}
                                    registerSlot={registerSlot}
                                    emptyState={emptyState}
                                />
                            </ResizablePanel>
                        </Fragment>
                    );
                })}
            </ResizablePanelGroup>

            {ids.map(id =>
                createPortal(
                    <div
                        className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
                        // The pane is portalled, so events in it reach this
                        // component rather than its column. Tell the layout
                        // which column was touched — by pointer or by Tab,
                        // since the column verbs act on the focused one.
                        onPointerDownCapture={() => claimColumn(id)}
                        onFocusCapture={() => claimColumn(id)}
                    >
                        {renderPane(id)}
                    </div>,
                    hostFor(id),
                    id
                )
            )}
        </div>
    );
}
